import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDocumentsDir } from '../../db/connection';
import type { Document, DocumentLink, DocumentType } from '../../../shared/types';

const SUBFOLDER_BY_TYPE: Record<string, string> = {
  facture_vente: 'sales',
  facture_achat: 'purchases',
  ticket_caisse: 'expenses',
  facture_boost: 'boosts',
  justificatif_urssaf: 'urssaf',
  export_vinteer: 'imports',
  export_whatnot: 'imports',
  whatnot_purchase_csv: 'purchases',
  autre: 'other'
};

function targetSubfolder(type?: string | null): string {
  if (!type) return 'other';
  return SUBFOLDER_BY_TYPE[type] ?? 'other';
}

export function hashFile(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function mimeOf(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.pdf': return 'application/pdf';
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.csv': return 'text/csv';
    case '.xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.txt': return 'text/plain';
    default: return 'application/octet-stream';
  }
}

/**
 * Add a document by copying it into the managed documents/ folder.
 * Dedups by SHA-256 — if a document with same hash already exists, returns the existing id.
 */
export function addDocument(
  db: Database.Database,
  payload: {
    sourcePath: string;
    document_type?: DocumentType | null;
    date?: string | null;
    amount?: number | null;
    supplier_or_customer?: string | null;
    external_reference?: string | null;
    notes?: string | null;
  }
): { id: number; deduplicated: boolean; document: Document } {
  if (!fs.existsSync(payload.sourcePath)) {
    throw new Error(`Fichier introuvable : ${payload.sourcePath}`);
  }
  const hash = hashFile(payload.sourcePath);

  const existing = db
    .prepare(`SELECT * FROM documents WHERE file_hash=?`)
    .get(hash) as Document | undefined;
  if (existing) {
    return { id: existing.id, deduplicated: true, document: existing };
  }

  const baseDir = getDocumentsDir();
  const year = (payload.date ?? new Date().toISOString()).slice(0, 4);
  const subfolder = targetSubfolder(payload.document_type);
  const destDir = path.join(baseDir, year, subfolder);
  fs.mkdirSync(destDir, { recursive: true });

  const originalName = path.basename(payload.sourcePath);
  const safeBase = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const destPath = path.join(destDir, `${hash.slice(0, 8)}_${safeBase}`);
  fs.copyFileSync(payload.sourcePath, destPath);

  const info = db
    .prepare(
      `INSERT INTO documents (
         file_name, original_file_name, file_path, file_hash, mime_type,
         document_type, source, date, amount, supplier_or_customer, external_reference, notes
       ) VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?)`
    )
    .run(
      path.basename(destPath),
      originalName,
      destPath,
      hash,
      mimeOf(destPath),
      payload.document_type ?? null,
      payload.date ?? null,
      payload.amount ?? null,
      payload.supplier_or_customer ?? null,
      payload.external_reference ?? null,
      payload.notes ?? null
    );

  const doc = db.prepare(`SELECT * FROM documents WHERE id=?`).get(info.lastInsertRowid) as Document;
  return { id: doc.id, deduplicated: false, document: doc };
}

export function linkDocument(
  db: Database.Database,
  payload: { document_id: number; entity_type: DocumentLink['entity_type']; entity_id: number }
): { ok: true } {
  db.prepare(
    `INSERT INTO document_links (document_id, entity_type, entity_id)
     SELECT ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM document_links
       WHERE document_id=? AND entity_type=? AND entity_id=?
     )`
  ).run(
    payload.document_id,
    payload.entity_type,
    payload.entity_id,
    payload.document_id,
    payload.entity_type,
    payload.entity_id
  );
  return { ok: true };
}

export function isPathInsideDirectory(filePath: string, directory: string): boolean {
  const target = path.resolve(filePath);
  const root = path.resolve(directory);
  const normalizedTarget = process.platform === 'win32' ? target.toLowerCase() : target;
  const normalizedRoot = process.platform === 'win32' ? root.toLowerCase() : root;
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(normalizedRoot + path.sep);
}

export function safeDocumentPath(db: Database.Database, documentId: number): string {
  const row = db.prepare(`SELECT file_path FROM documents WHERE id=?`).get(documentId) as { file_path: string } | undefined;
  if (!row) throw new Error('Document introuvable');
  if (!isPathInsideDirectory(row.file_path, getDocumentsDir())) {
    throw new Error("Chemin de document non autorisé");
  }
  if (!fs.existsSync(row.file_path)) {
    throw new Error('Fichier introuvable');
  }
  return row.file_path;
}

export async function openDocumentFile(db: Database.Database, documentId: number): Promise<{ ok: true }> {
  const filePath = safeDocumentPath(db, documentId);
  const { shell } = await import('electron');
  const err = await shell.openPath(filePath);
  if (err) throw new Error(err);
  return { ok: true };
}

export function unlinkDocument(db: Database.Database, linkId: number): { ok: true } {
  db.prepare(`DELETE FROM document_links WHERE id=?`).run(linkId);
  return { ok: true };
}

export function listDocuments(
  db: Database.Database,
  filters: { type?: string; search?: string; orphan?: boolean; limit?: number } = {}
) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.type === '__none') {
    where.push('(document_type IS NULL OR document_type="")');
  } else if (filters.type) {
    where.push('document_type=?');
    params.push(filters.type);
  }
  if (filters.search) {
    where.push('(original_file_name LIKE ? OR supplier_or_customer LIKE ? OR external_reference LIKE ?)');
    const like = `%${filters.search}%`;
    params.push(like, like, like);
  }
  if (filters.orphan) {
    where.push(`NOT EXISTS (SELECT 1 FROM document_links dl WHERE dl.document_id = documents.id)`);
  }
  const sql = `SELECT * FROM documents ${
    where.length ? 'WHERE ' + where.join(' AND ') : ''
  } ORDER BY created_at DESC LIMIT ?`;
  params.push(filters.limit ?? 500);
  return db.prepare(sql).all(...params) as Document[];
}

export function linksFor(
  db: Database.Database,
  entityType: DocumentLink['entity_type'],
  entityId: number
): (Document & { link_id: number })[] {
  return db
    .prepare(
      `SELECT d.*, dl.id AS link_id
       FROM documents d
       JOIN document_links dl ON dl.document_id = d.id
       WHERE dl.entity_type=? AND dl.entity_id=?
       ORDER BY d.created_at DESC`
    )
    .all(entityType, entityId) as (Document & { link_id: number })[];
}

/**
 * Bulk lookup: fetch document links for multiple entities of same type in ONE query.
 * Avoids N+1 queries on Purchases/Expenses pages.
 */
export function linksForBulk(
  db: Database.Database,
  entityType: DocumentLink['entity_type'],
  entityIds: number[]
): Record<number, (Document & { link_id: number })[]> {
  if (entityIds.length === 0) return {};
  const placeholders = entityIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT d.*, dl.id AS link_id, dl.entity_id AS _entity_id
       FROM documents d
       JOIN document_links dl ON dl.document_id = d.id
       WHERE dl.entity_type=? AND dl.entity_id IN (${placeholders})
       ORDER BY d.created_at DESC`
    )
    .all(entityType, ...entityIds) as (Document & { link_id: number; _entity_id: number })[];
  const out: Record<number, (Document & { link_id: number })[]> = {};
  for (const id of entityIds) out[id] = [];
  for (const r of rows) {
    const eid = r._entity_id;
    delete (r as { _entity_id?: number })._entity_id;
    out[eid].push(r);
  }
  return out;
}
