import type Database from 'better-sqlite3';
import { ensureSoftDeleteColumns } from '../../db/softDelete';
import type { Channel, CsvMappingTemplate, Marketplace, Supplier } from '../../../shared/types';

export function listMarketplaces(db: Database.Database): Marketplace[] {
  ensureSoftDeleteColumns(db, ['marketplaces']);
  return db.prepare(`SELECT * FROM marketplaces WHERE deleted_at IS NULL ORDER BY is_active DESC, name`).all() as Marketplace[];
}

export function updateMarketplace(
  db: Database.Database,
  id: number,
  patch: Partial<Pick<Marketplace, 'name' | 'type' | 'website' | 'is_active' | 'default_currency' | 'notes'>>
): { ok: true } {
  const allowed = ['name', 'type', 'website', 'is_active', 'default_currency', 'notes'] as const;
  const entries = Object.entries(patch).filter(([k]) => allowed.includes(k as typeof allowed[number]));
  if (entries.length === 0) return { ok: true };
  const sets = entries.map(([k]) => `${k}=?`).join(', ');
  db.prepare(`UPDATE marketplaces SET ${sets}, updated_at=datetime('now') WHERE id=?`).run(...entries.map(([, v]) => v), id);
  return { ok: true };
}

export function findMarketplaceBySlug(db: Database.Database, slug: string): Marketplace | undefined {
  ensureSoftDeleteColumns(db, ['marketplaces']);
  return db.prepare(`SELECT * FROM marketplaces WHERE slug=? AND deleted_at IS NULL`).get(slug) as Marketplace | undefined;
}

export function listChannels(db: Database.Database): Channel[] {
  ensureSoftDeleteColumns(db, ['channels', 'marketplaces']);
  return db.prepare(`
    SELECT c.*, m.name AS marketplace_name
    FROM channels c
    LEFT JOIN marketplaces m ON m.id=c.marketplace_id AND m.deleted_at IS NULL
    WHERE c.deleted_at IS NULL
    ORDER BY c.is_active DESC, m.name, c.name
  `).all() as Channel[];
}

export function upsertChannel(
  db: Database.Database,
  payload: { id?: number; marketplace_id?: number | null; slug: string; name: string; channel_type?: string; is_active?: number; notes?: string | null }
): { id: number } {
  if (payload.id) {
    db.prepare(`
      UPDATE channels SET marketplace_id=?, slug=?, name=?, channel_type=?, is_active=?, notes=?, updated_at=datetime('now')
      WHERE id=?
    `).run(
      payload.marketplace_id ?? null,
      payload.slug,
      payload.name,
      payload.channel_type ?? 'mixed',
      payload.is_active ?? 1,
      payload.notes ?? null,
      payload.id
    );
    return { id: payload.id };
  }
  const info = db.prepare(`
    INSERT INTO channels (marketplace_id, slug, name, channel_type, is_active, notes)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      marketplace_id=excluded.marketplace_id,
      name=excluded.name,
      channel_type=excluded.channel_type,
      is_active=excluded.is_active,
      notes=excluded.notes,
      updated_at=datetime('now')
  `).run(
    payload.marketplace_id ?? null,
    payload.slug,
    payload.name,
    payload.channel_type ?? 'mixed',
    payload.is_active ?? 1,
    payload.notes ?? null
  );
  const row = db.prepare(`SELECT id FROM channels WHERE slug=? AND deleted_at IS NULL`).get(payload.slug) as { id: number };
  return { id: Number(info.lastInsertRowid || row.id) };
}

export function listSuppliers(db: Database.Database): Supplier[] {
  ensureSoftDeleteColumns(db, ['suppliers', 'marketplaces']);
  return db.prepare(`
    SELECT s.*, m.name AS platform_name
    FROM suppliers s
    LEFT JOIN marketplaces m ON m.id=s.platform_id AND m.deleted_at IS NULL
    WHERE s.deleted_at IS NULL
    ORDER BY s.name
  `).all() as Supplier[];
}

export function upsertSupplier(
  db: Database.Database,
  payload: { id?: number; name: string; platform_id?: number | null; supplier_type?: string; website?: string | null; contact?: string | null; notes?: string | null }
): { id: number } {
  if (payload.id) {
    db.prepare(`
      UPDATE suppliers SET name=?, platform_id=?, supplier_type=?, website=?, contact=?, notes=?, updated_at=datetime('now')
      WHERE id=?
    `).run(
      payload.name,
      payload.platform_id ?? null,
      payload.supplier_type ?? 'other',
      payload.website ?? null,
      payload.contact ?? null,
      payload.notes ?? null,
      payload.id
    );
    return { id: payload.id };
  }
  const info = db.prepare(`
    INSERT INTO suppliers (name, platform_id, supplier_type, website, contact, notes)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(name, platform_id) DO UPDATE SET
      supplier_type=excluded.supplier_type,
      website=excluded.website,
      contact=excluded.contact,
      notes=COALESCE(excluded.notes, suppliers.notes),
      updated_at=datetime('now')
  `).run(
    payload.name,
    payload.platform_id ?? null,
    payload.supplier_type ?? 'other',
    payload.website ?? null,
    payload.contact ?? null,
    payload.notes ?? null
  );
  const row = db.prepare(`SELECT id FROM suppliers WHERE name=? AND platform_id IS ? AND deleted_at IS NULL`).get(payload.name, payload.platform_id ?? null) as { id: number } | undefined;
  return { id: Number(info.lastInsertRowid || row?.id) };
}

export function listCsvMappingTemplates(db: Database.Database, entityType?: string): CsvMappingTemplate[] {
  ensureSoftDeleteColumns(db, ['csv_mapping_templates']);
  const sql = entityType
    ? `SELECT * FROM csv_mapping_templates WHERE entity_type=? AND deleted_at IS NULL ORDER BY updated_at DESC`
    : `SELECT * FROM csv_mapping_templates WHERE deleted_at IS NULL ORDER BY entity_type, updated_at DESC`;
  return (entityType ? db.prepare(sql).all(entityType) : db.prepare(sql).all()) as CsvMappingTemplate[];
}

export function createCsvMappingTemplate(
  db: Database.Database,
  payload: {
    name: string;
    entity_type: 'sales' | 'purchases' | 'expenses' | 'stock';
    platform_id?: number | null;
    adapter_id?: string | null;
    mapping: Record<string, string>;
    date_format?: string | null;
    decimal_separator?: string | null;
    delimiter?: string | null;
    currency?: string | null;
  }
): { id: number } {
  const info = db.prepare(`
    INSERT INTO csv_mapping_templates
      (name, entity_type, platform_id, adapter_id, mapping_json, date_format, decimal_separator, delimiter, currency)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payload.name,
    payload.entity_type,
    payload.platform_id ?? null,
    payload.adapter_id ?? null,
    JSON.stringify(payload.mapping),
    payload.date_format ?? null,
    payload.decimal_separator ?? null,
    payload.delimiter ?? null,
    payload.currency ?? 'EUR'
  );
  return { id: Number(info.lastInsertRowid) };
}

export function updateCsvMappingTemplate(
  db: Database.Database,
  id: number,
  patch: Partial<{
    name: string;
    entity_type: 'sales' | 'purchases' | 'expenses' | 'stock';
    platform_id: number | null;
    adapter_id: string | null;
    mapping: Record<string, string>;
    date_format: string | null;
    decimal_separator: string | null;
    delimiter: string | null;
    currency: string;
  }>
): { ok: true } {
  const updates: Record<string, unknown> = {};
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.entity_type !== undefined) updates.entity_type = patch.entity_type;
  if (patch.platform_id !== undefined) updates.platform_id = patch.platform_id;
  if (patch.adapter_id !== undefined) updates.adapter_id = patch.adapter_id;
  if (patch.mapping !== undefined) updates.mapping_json = JSON.stringify(patch.mapping);
  if (patch.date_format !== undefined) updates.date_format = patch.date_format;
  if (patch.decimal_separator !== undefined) updates.decimal_separator = patch.decimal_separator;
  if (patch.delimiter !== undefined) updates.delimiter = patch.delimiter;
  if (patch.currency !== undefined) updates.currency = patch.currency;
  const entries = Object.entries(updates);
  if (entries.length === 0) return { ok: true };
  db.prepare(`UPDATE csv_mapping_templates SET ${entries.map(([k]) => `${k}=?`).join(', ')}, updated_at=datetime('now') WHERE id=?`)
    .run(...entries.map(([, v]) => v), id);
  return { ok: true };
}

export function deleteCsvMappingTemplate(db: Database.Database, id: number): { ok: true } {
  db.prepare(`DELETE FROM csv_mapping_templates WHERE id=?`).run(id);
  return { ok: true };
}

export function recordCsvMappingTemplateUsage(
  db: Database.Database,
  payload: { template_id: number; import_id?: number | null; rows_imported: number; rows_skipped: number; rows_error: number }
): void {
  db.prepare(`
    INSERT INTO csv_mapping_template_usage (template_id, import_id, rows_imported, rows_skipped, rows_error)
    VALUES (?, ?, ?, ?, ?)
  `).run(payload.template_id, payload.import_id ?? null, payload.rows_imported, payload.rows_skipped, payload.rows_error);
}
