import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { decryptFile, looksEncryptedFile } from '../security/crypto';
import { createExpense } from '../expenses/repository';
import { createStockManual, moveOut } from '../stock/repository';
import { markReviewItem } from '../review/reviewCenter';
import { recordCreate } from '../audit/guarded';
import {
  mobileActionSchema,
  type MobileAction,
  type MobileActionsBundle
} from '../../../shared/mobile/actions';
import {
  COMPATIBLE_ACTION_VERSIONS,
  MOBILE_ACTIONS_SCHEMA_VERSION
} from '../../../shared/mobile/schemaVersion';
import type { ReviewModule } from '../../../shared/types';

export interface MobileActionPreviewItem {
  id: string;
  type: MobileAction['type'];
  summary: string;
  payload: Record<string, unknown>;
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export interface MobileActionPreview {
  schemaVersion: string;
  generatedAt: string | null;
  device: string | null;
  total: number;
  validCount: number;
  invalidCount: number;
  fileHash: string;
  alreadyImported: boolean;
  items: MobileActionPreviewItem[];
}

export interface MobileActionApplyResult {
  total: number;
  applied: number;
  rejected: number;
  importId: number;
  items: Array<{
    id: string;
    type: MobileAction['type'];
    status: 'applied' | 'rejected';
    error?: string;
    insertedId?: number;
  }>;
}

function hashFile(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readBundle(filePath: string, password?: string): MobileActionsBundle {
  let raw: string;
  if (looksEncryptedFile(filePath)) {
    if (!password) throw new Error('Fichier chiffré : mot de passe requis.');
    const tmp = path.join(require('node:os').tmpdir(), `_revendo_actions_${Date.now()}.json`);
    try {
      decryptFile(filePath, tmp, password);
      raw = fs.readFileSync(tmp, 'utf-8');
    } finally {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
  } else {
    raw = fs.readFileSync(filePath, 'utf-8');
  }
  const json = JSON.parse(raw);
  // Lax envelope validation only — individual actions are validated per-item
  // by previewMobileActions / applyMobileActions so that one invalid action
  // doesn't reject the whole bundle.
  if (!json || typeof json !== 'object') throw new Error('Bundle JSON invalide.');
  if (typeof json.schema_version !== 'string') {
    throw new Error('Champ "schema_version" manquant dans le bundle.');
  }
  if (!Array.isArray(json.actions)) {
    throw new Error('Champ "actions" manquant ou invalide.');
  }
  return json as MobileActionsBundle;
}

function describeAction(a: MobileAction): string {
  switch (a.type) {
    case 'add_expense':
      return `Dépense — ${a.payload.category} · ${a.payload.amount_ttc.toFixed(2)} € · ${a.payload.date.slice(0, 10)}`;
    case 'add_stock_item':
      return `Stock — ${a.payload.name} (x${a.payload.quantity})`;
    case 'add_stock_movement':
      return `Mouvement stock #${a.payload.stock_item_id} — ${a.payload.movement_type} x${a.payload.quantity}`;
    case 'mark_review_done':
      return `Révision — ${a.payload.module} (${a.payload.status})`;
    case 'add_note':
      return `Note — ${a.payload.entity_type}${a.payload.entity_id ? ` #${a.payload.entity_id}` : ''}`;
  }
}

function validateAgainstDb(db: Database.Database, action: MobileAction): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (action.type === 'add_stock_movement') {
    const row = db.prepare(
      `SELECT id, quantity, status, deleted_at FROM stock_items WHERE id=?`
    ).get(action.payload.stock_item_id) as
      | { id: number; quantity: number; status: string; deleted_at: string | null }
      | undefined;
    if (!row) {
      errors.push(`Article de stock #${action.payload.stock_item_id} introuvable sur le PC.`);
    } else if (row.deleted_at) {
      errors.push(`Article de stock #${action.payload.stock_item_id} supprimé.`);
    } else if (row.quantity < action.payload.quantity) {
      errors.push(
        `Quantité insuffisante : stock actuel ${row.quantity}, demandée ${action.payload.quantity}.`
      );
    }
  }

  if (action.type === 'add_expense') {
    const vatRegime = (db.prepare(`SELECT value FROM settings WHERE key='vat_regime'`).get() as
      | { value: string }
      | undefined)?.value ?? 'franchise_en_base';
    if (vatRegime === 'franchise_en_base') {
      warnings.push('TVA non récupérable (régime franchise en base).');
    }
  }

  if (action.type === 'add_stock_item') {
    if (!action.payload.unit_cost_ttc) {
      warnings.push("Coût unitaire absent : la rentabilité sera approximative jusqu'à correction.");
    }
  }

  return { warnings, errors };
}

export function previewMobileActions(
  db: Database.Database,
  filePath: string,
  password?: string
): MobileActionPreview {
  if (!fs.existsSync(filePath)) throw new Error('Fichier introuvable.');
  const fileHash = hashFile(filePath);
  const alreadyImported = !!(db
    .prepare(`SELECT id FROM mobile_action_imports WHERE file_hash=?`)
    .get(fileHash));

  const bundle = readBundle(filePath, password);
  if (!COMPATIBLE_ACTION_VERSIONS.includes(bundle.schema_version)) {
    throw new Error(`Schéma d'actions incompatible : ${bundle.schema_version}.`);
  }

  const items: MobileActionPreviewItem[] = bundle.actions.map((rawAction) => {
    const parsed = mobileActionSchema.safeParse(rawAction);
    if (!parsed.success) {
      return {
        id: String((rawAction as { id?: unknown }).id ?? 'sans-id'),
        type: ((rawAction as { type?: MobileAction['type'] }).type ?? 'add_note') as MobileAction['type'],
        summary: 'Action invalide',
        payload: (rawAction as Record<string, unknown>) ?? {},
        valid: false,
        warnings: [],
        errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
      };
    }
    const action = parsed.data;
    const { warnings, errors } = validateAgainstDb(db, action);
    return {
      id: action.id,
      type: action.type,
      summary: describeAction(action),
      payload: action.payload as Record<string, unknown>,
      valid: errors.length === 0,
      warnings,
      errors
    };
  });

  return {
    schemaVersion: bundle.schema_version,
    generatedAt: bundle.generated_at,
    device: bundle.device ?? null,
    total: items.length,
    validCount: items.filter((i) => i.valid).length,
    invalidCount: items.filter((i) => !i.valid).length,
    fileHash,
    alreadyImported,
    items
  };
}

function applyOne(db: Database.Database, action: MobileAction): { ok: true; insertedId?: number } | { ok: false; error: string } {
  try {
    if (action.type === 'add_expense') {
      const r = createExpense(db, {
        date: action.payload.date.slice(0, 10),
        category: action.payload.category,
        supplier: action.payload.supplier ?? null,
        description: action.payload.description ?? null,
        amount_ttc: action.payload.amount_ttc,
        payment_method: action.payload.payment_method ?? null,
        notes: [action.payload.notes ?? '', `(action mobile ${action.id})`].filter(Boolean).join(' ')
      });
      recordCreate(db, 'expense', r.id, `Dépense importée du mobile (${action.id})`);
      // Mark source on the row for traceability
      db.prepare(`UPDATE expenses SET source='mobile' WHERE id=?`).run(r.id);
      return { ok: true, insertedId: r.id };
    }
    if (action.type === 'add_stock_item') {
      const r = createStockManual(db, {
        name: action.payload.name,
        quantity: action.payload.quantity,
        origin: action.payload.origin,
        unit_cost_ttc: action.payload.unit_cost_ttc ?? null,
        sku: action.payload.sku ?? null,
        brand: action.payload.brand ?? null,
        location: action.payload.location ?? null,
        notes: [action.payload.notes ?? '', `(action mobile ${action.id})`].filter(Boolean).join(' ')
      });
      recordCreate(db, 'stock_item', r.id, `Stock créé depuis mobile (${action.id})`);
      return { ok: true, insertedId: r.id };
    }
    if (action.type === 'add_stock_movement') {
      // Map mobile movement types (including ADJUSTMENT) to desktop equivalents
      const movementType = action.payload.movement_type === 'OUT_ADJUSTMENT'
        ? 'OUT_DISCARDED'
        : action.payload.movement_type;
      moveOut(db, {
        stock_item_id: action.payload.stock_item_id,
        movement_type: movementType,
        quantity: action.payload.quantity,
        reason: action.payload.reason ?? `Action mobile ${action.id}`,
        notes: action.payload.notes ?? null,
        movement_date: action.payload.movement_date ?? undefined
      });
      return { ok: true };
    }
    if (action.type === 'mark_review_done') {
      markReviewItem(db, {
        key: action.payload.review_key,
        module: action.payload.module as ReviewModule,
        entity_type: action.payload.entity_type ?? null,
        entity_id: action.payload.entity_id ?? null,
        status: action.payload.status,
        note: `${action.payload.note} (mobile ${action.id})`
      });
      return { ok: true };
    }
    if (action.type === 'add_note') {
      // Use diary_entries as a generic store for standalone notes if no entity ref,
      // or update notes column on the entity if reachable.
      if (action.payload.entity_type === 'standalone' || !action.payload.entity_id) {
        const info = db.prepare(
          `INSERT INTO diary_entries (entry_date, note, tags) VALUES (?, ?, ?)`
        ).run(action.payload.date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10), action.payload.note, 'mobile');
        return { ok: true, insertedId: Number(info.lastInsertRowid) };
      }
      const tableByEntity: Record<string, string> = {
        sale: 'sales', stock_item: 'stock_items', purchase: 'purchases',
        expense: 'expenses', document: 'documents'
      };
      const table = tableByEntity[action.payload.entity_type];
      if (!table) return { ok: false, error: `Entité inconnue : ${action.payload.entity_type}` };
      // Append note in the right column (note for sales, notes for the others)
      const noteCol = table === 'sales' ? 'note' : 'notes';
      db.prepare(
        `UPDATE ${table} SET ${noteCol} = trim(COALESCE(${noteCol}, '') || CASE WHEN ${noteCol} IS NULL OR ${noteCol}='' THEN '' ELSE ' | ' END || ?), updated_at=datetime('now') WHERE id=?`
      ).run(`(mobile ${action.id}) ${action.payload.note}`, action.payload.entity_id);
      return { ok: true };
    }
    return { ok: false, error: 'Type d\'action non géré.' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function applyMobileActions(
  db: Database.Database,
  filePath: string,
  password?: string
): MobileActionApplyResult {
  const preview = previewMobileActions(db, filePath, password);
  if (preview.alreadyImported) {
    throw new Error('Ce fichier a déjà été importé. Re-générez un nouvel export depuis le mobile.');
  }
  const bundle = readBundle(filePath, password);
  const items: MobileActionApplyResult['items'] = [];
  const errors: Array<{ id: string; type: string; error: string }> = [];
  let importRowId = 0;

  const tx = db.transaction(() => {
    for (const rawAction of bundle.actions) {
      const parsed = mobileActionSchema.safeParse(rawAction);
      if (!parsed.success) {
        const id = String((rawAction as { id?: unknown }).id ?? 'sans-id');
        const errMsg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
        items.push({ id, type: 'add_note', status: 'rejected', error: errMsg });
        errors.push({ id, type: 'invalid', error: errMsg });
        continue;
      }
      const action = parsed.data;
      // Pre-validate (esp. stock negative) before mutating
      const v = validateAgainstDb(db, action);
      if (v.errors.length > 0) {
        items.push({ id: action.id, type: action.type, status: 'rejected', error: v.errors.join('; ') });
        errors.push({ id: action.id, type: action.type, error: v.errors.join('; ') });
        continue;
      }
      const res = applyOne(db, action);
      if (res.ok) {
        items.push({ id: action.id, type: action.type, status: 'applied', insertedId: res.insertedId });
      } else {
        items.push({ id: action.id, type: action.type, status: 'rejected', error: res.error });
        errors.push({ id: action.id, type: action.type, error: res.error });
      }
    }

    const auditInfo = db.prepare(
      `INSERT INTO mobile_action_imports
        (file_name, file_hash, bundle_schema_version, bundle_generated_at, bundle_device,
         total, applied, rejected, errors_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      path.basename(filePath),
      preview.fileHash,
      bundle.schema_version,
      bundle.generated_at,
      bundle.device ?? null,
      bundle.actions.length,
      items.filter((i) => i.status === 'applied').length,
      items.filter((i) => i.status === 'rejected').length,
      JSON.stringify(errors)
    );
    importRowId = Number(auditInfo.lastInsertRowid);
  });
  tx();

  return {
    total: bundle.actions.length,
    applied: items.filter((i) => i.status === 'applied').length,
    rejected: items.filter((i) => i.status === 'rejected').length,
    importId: importRowId,
    items
  };
}

export function listMobileActionImports(db: Database.Database) {
  return db.prepare(
    `SELECT id, imported_at, file_name, bundle_schema_version, bundle_device, total, applied, rejected
     FROM mobile_action_imports ORDER BY imported_at DESC LIMIT 50`
  ).all();
}

export { MOBILE_ACTIONS_SCHEMA_VERSION };
