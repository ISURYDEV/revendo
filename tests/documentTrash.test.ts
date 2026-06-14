import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runMigrations } from '../electron/db/migrations';
import { addDocument } from '../electron/services/documents/storage';
import { moveDocumentToTrash, purgeTrash } from '../electron/services/documents/trash';

vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'revendo-test-userData')
  }
}));

function tmpFile(name: string, content: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revendo-doc-trash-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content, 'utf-8');
  return file;
}

describe('corbeille documents', () => {
  it('déplace un document supprimé vers _trash puis le purge après rétention', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const source = tmpFile('facture.pdf', 'PDF test');
    const doc = addDocument(db, {
      sourcePath: source,
      document_type: 'facture_achat',
      date: '2026-05-01',
      amount: 12
    });
    const originalPath = doc.document.file_path;
    expect(fs.existsSync(originalPath)).toBe(true);

    const moved = moveDocumentToTrash(db, doc.id);
    expect(moved.trashPath).toBeTruthy();
    expect(fs.existsSync(originalPath)).toBe(false);
    expect(fs.existsSync(moved.trashPath!)).toBe(true);
    expect(moved.trashPath).toContain(`${path.sep}_trash${path.sep}`);
    let row = db.prepare(`SELECT deleted_at, file_path FROM documents WHERE id=?`).get(doc.id) as { deleted_at: string | null; file_path: string };
    expect(row.deleted_at).toBeTruthy();
    expect(row.file_path).toBe(moved.trashPath);

    db.prepare(`UPDATE documents SET deleted_at='2000-01-01T00:00:00.000Z' WHERE id=?`).run(doc.id);
    const purged = purgeTrash(db, 0);

    expect(purged.purged).toBe(1);
    expect(fs.existsSync(moved.trashPath!)).toBe(false);
    row = db.prepare(`SELECT deleted_at, file_path FROM documents WHERE id=?`).get(doc.id) as { deleted_at: string | null; file_path: string };
    expect(row).toBeUndefined();
  });
});
