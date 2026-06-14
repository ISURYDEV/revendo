import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migration001Initial } from '../electron/db/migrations/001_initial';
import { migration002 } from '../electron/db/migrations/002_classification_and_links';
import { migration005 } from '../electron/db/migrations/005_pre_activity_and_dedup';
import { importVinteerSales } from '../electron/services/importers/vinteerSales';

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);`);
  migration001Initial.up(db);
  migration002.up(db);
  migration005.up(db);
  db.prepare(`INSERT INTO imports (source, file_name, file_hash, import_type) VALUES ('test', 'x.csv', 'h', 'vinteer_sales')`).run();
  return db;
}

describe('protection reimport Vinteer', () => {
  it('ne remplace pas amount_received modifié manuellement', () => {
    const db = freshDb();
    const row = {
      'ID Transaction': 'MANUAL-1',
      Statut: 'completed',
      'Date de finalisation': '2026-03-15 10:00:00',
      'Montant encaissé': '18,00',
      Articles: 'Article protégé',
      SKU: 'SKU-PROT'
    };
    importVinteerSales(db, [row], 1);
    db.prepare(`UPDATE sales SET manual_override=1, amount_received=25 WHERE external_id='MANUAL-1'`).run();
    importVinteerSales(db, [row], 1);
    const sale = db.prepare(`SELECT amount_received FROM sales WHERE external_id='MANUAL-1'`).get() as { amount_received: number };
    expect(sale.amount_received).toBe(25);
  });
});
