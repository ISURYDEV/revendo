import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migration001Initial } from '../electron/db/migrations/001_initial';
import { migration002 } from '../electron/db/migrations/002_classification_and_links';
import { reclassifyAllSales } from '../electron/services/sales/repository';

describe('reclassification globale', () => {
  it('recalcule declared_period après reclassification', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);`);
    migration001Initial.up(db);
    migration002.up(db);
    db.prepare(`UPDATE settings SET value='2026-03-09' WHERE key='activity_start_date'`).run();
    const id = Number(db.prepare(`
      INSERT INTO sales (source, external_id, status, classification, urssaf_declarable, sale_date, declared_encashment_date, amount_received)
      VALUES ('manual', 'R1', 'completed', 'personal_item', 0, '2026-02-15T10:00:00.000Z', '2026-02-15T10:00:00.000Z', 15)
    `).run().lastInsertRowid);

    db.prepare(`UPDATE settings SET value='2026-01-01' WHERE key='activity_start_date'`).run();
    // P0.2 : on associe explicitement un stock pour confirmer la nature pro de la vente.
    const stockId = Number(db.prepare(
      `INSERT INTO stock_items (internal_code, sku, name, status, quantity, unit_cost_ttc)
       VALUES ('ITEM-TEST-R1', 'SKU-R1', 'Article test', 'in_stock', 1, 5)`
    ).run().lastInsertRowid);
    db.prepare(`UPDATE sales SET sku='SKU-R1', linked_stock_item_id=? WHERE id=?`).run(stockId, id);
    reclassifyAllSales(db, { force: true });
    const sale = db.prepare(`SELECT classification, declared_period FROM sales WHERE id=?`).get(id) as { classification: string; declared_period: string };
    expect(sale.classification).toBe('professional_resale');
    expect(sale.declared_period).toBe('2026-Q1');
  });
});
