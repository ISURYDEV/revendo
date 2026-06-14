import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { getDocumentsDir } from '../../db/connection';

function trashPath(originalPath: string): string {
  const year = new Date().getUTCFullYear();
  return path.join(getDocumentsDir(), '_trash', String(year), path.basename(originalPath));
}

export function moveDocumentToTrash(db: Database.Database, documentId: number): { ok: true; trashPath: string | null } {
  const row = db.prepare(`SELECT file_path FROM documents WHERE id=? AND deleted_at IS NULL`).get(documentId) as { file_path: string } | undefined;
  if (!row) throw new Error('Document introuvable.');
  let target: string | null = null;
  if (row.file_path && fs.existsSync(row.file_path)) {
    target = trashPath(row.file_path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    let finalTarget = target;
    let i = 1;
    while (fs.existsSync(finalTarget)) {
      const ext = path.extname(target);
      finalTarget = path.join(path.dirname(target), `${path.basename(target, ext)}_${i}${ext}`);
      i += 1;
    }
    fs.renameSync(row.file_path, finalTarget);
    target = finalTarget;
  }
  db.prepare(`UPDATE documents SET deleted_at=datetime('now'), deleted_reason='Corbeille locale 30 jours', file_path=COALESCE(?, file_path), updated_at=datetime('now') WHERE id=?`)
    .run(target, documentId);
  return { ok: true, trashPath: target };
}

export function purgeTrash(db: Database.Database, retentionDays = 30): { purged: number } {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(`SELECT id, file_path FROM documents WHERE deleted_at IS NOT NULL AND deleted_at < ?`).all(cutoff) as Array<{ id: number; file_path: string | null }>;
  const tx = db.transaction(() => {
    for (const row of rows) {
      if (row.file_path) {
        try { if (fs.existsSync(row.file_path)) fs.unlinkSync(row.file_path); } catch { /* ignore */ }
      }
      db.prepare(`DELETE FROM document_links WHERE document_id=?`).run(row.id);
      db.prepare(`DELETE FROM documents WHERE id=?`).run(row.id);
    }
  });
  tx();
  return { purged: rows.length };
}
