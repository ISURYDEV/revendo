import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migration001Initial } from '../electron/db/migrations/001_initial';
import { migration002 } from '../electron/db/migrations/002_classification_and_links';
import { buildQuarterlySummary } from '../electron/services/declarations/summary';
import { exportLivreRecettes } from '../electron/services/declarations/exportRecettes';
import { buildProfitabilitySummary } from '../electron/services/profitability/calculator';

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);`);
  migration001Initial.up(db);
  migration002.up(db);
  db.exec(`ALTER TABLE sales ADD COLUMN deleted_at TEXT`);
  return db;
}

describe('soft-delete fiscal', () => {
  it('exclut les ventes supprimées du CA, du livre et de la rentabilité', () => {
    const db = freshDb();
    const stmt = db.prepare(`
      INSERT INTO sales (source, external_id, status, classification, urssaf_declarable, declarable_amount, amount_received, sale_date, declared_encashment_date)
      VALUES ('manual', ?, 'completed', 'professional_resale', 1, ?, ?, '2026-03-10T10:00:00.000Z', '2026-03-10T10:00:00.000Z')
    `);
    const a = Number(stmt.run('A', 20, 20).lastInsertRowid);
    stmt.run('B', 30, 30);
    expect(buildQuarterlySummary(db, 2026, 1).caGoods).toBe(50);
    db.prepare(`UPDATE sales SET deleted_at=datetime('now') WHERE id=?`).run(a);
    expect(buildQuarterlySummary(db, 2026, 1).caGoods).toBe(30);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revendo-soft-delete-'));
    const csv = exportLivreRecettes(db, 2026, 1, dir);
    expect(csv.rowCount).toBe(1);
    expect(buildProfitabilitySummary(db, 2026, 1).caUrssaf).toBe(30);
  });
});
