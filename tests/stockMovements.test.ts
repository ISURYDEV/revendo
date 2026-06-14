import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migration001Initial } from '../electron/db/migrations/001_initial';
import { migration002 } from '../electron/db/migrations/002_classification_and_links';
import { migration003 } from '../electron/db/migrations/003_audit_log';
import { createStockManual, moveOut, listMovements, reserveOrList } from '../electron/services/stock/repository';
import { ensureSoldMovementForSale, restoreStockForCanceledSale } from '../electron/services/sales/stockSync';
import { deleteWithAudit } from '../electron/services/audit/guarded';

function db() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);`);
  migration001Initial.up(d);
  migration002.up(d);
  migration003.up(d);
  return d;
}

describe('stock movements', () => {
  let d: Database.Database;
  beforeEach(() => { d = db(); });

  it('createStockManual generates ITEM-YYYY-NNNNNN and IN movement', () => {
    const r = createStockManual(d, {
      name: 'Camiseta test', quantity: 3, origin: 'compra_vinted',
      total_cost_ttc: 30, unit_cost_ttc: 10
    });
    expect(r.internal_code).toMatch(/^ITEM-\d{4}-\d{6}$/);
    const movs = listMovements(d, r.id) as { movement_type: string; quantity: number }[];
    expect(movs).toHaveLength(1);
    expect(movs[0].movement_type).toBe('IN_PURCHASE');
    expect(movs[0].quantity).toBe(3);
  });

  it('OUT_DONATED quantity 2 from 5 keeps 3 available without marking full line donated', () => {
    const { id } = createStockManual(d, { name: 'X', quantity: 5, origin: 'brocante', unit_cost_ttc: 2 });
    const r = moveOut(d, { stock_item_id: id, movement_type: 'OUT_DONATED', quantity: 2, reason: 'Donado a asociación' });
    expect(r.new_quantity).toBe(3);
    expect(r.new_status).toBe('in_stock');
    const item = d.prepare(`SELECT quantity, status FROM stock_items WHERE id=?`).get(id) as { quantity: number; status: string };
    expect(item.quantity).toBe(3);
    expect(item.status).toBe('in_stock');
    const salesCount = (d.prepare('SELECT COUNT(*) AS n FROM sales').get() as { n: number }).n;
    expect(salesCount).toBe(0);
    const movs = listMovements(d, id) as { movement_type: string }[];
    expect(movs.some((m) => m.movement_type === 'OUT_DONATED')).toBe(true);
  });

  it('OUT_SOLD quantity 1 from 3 keeps 2 available', () => {
    const { id } = createStockManual(d, { name: 'Lot', quantity: 3, origin: 'brocante', unit_cost_ttc: 2 });
    const r = moveOut(d, { stock_item_id: id, movement_type: 'OUT_SOLD', quantity: 1, reason: 'Vente partielle' });
    expect(r.new_quantity).toBe(2);
    expect(r.new_status).toBe('in_stock');
    const item = d.prepare(`SELECT quantity, status FROM stock_items WHERE id=?`).get(id) as { quantity: number; status: string };
    expect(item.quantity).toBe(2);
    expect(item.status).toBe('in_stock');
  });

  it('OUT_GIFTED quantity 1 from 1 sets final status gifted', () => {
    const { id } = createStockManual(d, { name: 'Cadeau', quantity: 1, origin: 'brocante', unit_cost_ttc: 2 });
    const r = moveOut(d, { stock_item_id: id, movement_type: 'OUT_GIFTED', quantity: 1, reason: 'Cadeau' });
    expect(r.new_quantity).toBe(0);
    expect(r.new_status).toBe('gifted');
    const item = d.prepare(`SELECT quantity, status FROM stock_items WHERE id=?`).get(id) as { quantity: number; status: string };
    expect(item.quantity).toBe(0);
    expect(item.status).toBe('gifted');
  });

  it('OUT_SOLD links sale and updates sale.linked_stock_item_id', () => {
    const { id } = createStockManual(d, { name: 'X', quantity: 1, origin: 'compra_vinted', unit_cost_ttc: 5 });
    // Create a sale
    const info = d.prepare(
      `INSERT INTO sales (source, status, classification, urssaf_declarable, article_name, amount_received)
       VALUES ('manual', 'completed', 'professional_resale', 1, 'X', 15)`
    ).run();
    const saleId = Number(info.lastInsertRowid);
    moveOut(d, { stock_item_id: id, movement_type: 'OUT_SOLD', quantity: 1, linked_sale_id: saleId });
    const sale = d.prepare(`SELECT linked_stock_item_id FROM sales WHERE id=?`).get(saleId) as { linked_stock_item_id: number };
    expect(sale.linked_stock_item_id).toBe(id);
  });

  it('moveOut beyond available throws', () => {
    const { id } = createStockManual(d, { name: 'X', quantity: 2, origin: 'brocante' });
    expect(() => moveOut(d, { stock_item_id: id, movement_type: 'OUT_LOST', quantity: 5 })).toThrow();
  });

  it('reserveOrList LIST → status listed', () => {
    const { id } = createStockManual(d, { name: 'X', quantity: 1, origin: 'brocante' });
    reserveOrList(d, { stock_item_id: id, action: 'LIST' });
    const row = d.prepare(`SELECT status FROM stock_items WHERE id=?`).get(id) as { status: string };
    expect(row.status).toBe('listed');
  });

  it('completed sale linked to stock creates OUT_SOLD, canceled sale restores stock', () => {
    const { id } = createStockManual(d, { name: 'Sac exemple', quantity: 1, origin: 'compra_vinted', unit_cost_ttc: 5 });
    const info = d.prepare(
      `INSERT INTO sales (source, status, classification, urssaf_declarable, article_name, quantity, amount_received, linked_stock_item_id)
       VALUES ('manual', 'completed', 'professional_resale', 1, 'Sac exemple', 1, 15, ?)`
    ).run(id);
    const saleId = Number(info.lastInsertRowid);

    expect(ensureSoldMovementForSale(d, saleId).created).toBe(1);
    let item = d.prepare(`SELECT quantity, status FROM stock_items WHERE id=?`).get(id) as { quantity: number; status: string };
    expect(item.quantity).toBe(0);
    expect(item.status).toBe('sold_completed');

    d.prepare(`UPDATE sales SET status='canceled', classification='excluded', urssaf_declarable=0 WHERE id=?`).run(saleId);
    expect(restoreStockForCanceledSale(d, saleId).restored).toBe(1);
    item = d.prepare(`SELECT quantity, status FROM stock_items WHERE id=?`).get(id) as { quantity: number; status: string };
    expect(item.quantity).toBe(1);
    expect(item.status).toBe('in_stock');
    expect(restoreStockForCanceledSale(d, saleId).restored).toBe(0);
  });

  it('sale quantity greater than 1 restores all quantities on cancellation', () => {
    const { id } = createStockManual(d, { name: 'Lot chaussettes', quantity: 5, origin: 'compra_vinted', unit_cost_ttc: 1 });
    const info = d.prepare(
      `INSERT INTO sales (source, status, classification, urssaf_declarable, article_name, quantity, amount_received, linked_stock_item_id)
       VALUES ('manual', 'completed', 'professional_resale', 1, 'Lot chaussettes', 2, 20, ?)`
    ).run(id);
    const saleId = Number(info.lastInsertRowid);

    expect(ensureSoldMovementForSale(d, saleId).created).toBe(2);
    let item = d.prepare(`SELECT quantity, status FROM stock_items WHERE id=?`).get(id) as { quantity: number; status: string };
    expect(item.quantity).toBe(3);
    expect(item.status).toBe('in_stock');

    d.prepare(`UPDATE sales SET status='refunded', classification='excluded', urssaf_declarable=0 WHERE id=?`).run(saleId);
    expect(restoreStockForCanceledSale(d, saleId).restored).toBe(2);
    item = d.prepare(`SELECT quantity, status FROM stock_items WHERE id=?`).get(id) as { quantity: number; status: string };
    expect(item.quantity).toBe(5);
    expect(item.status).toBe('in_stock');
  });

  it('personal sale without stock does not affect stock on cancellation', () => {
    const info = d.prepare(
      `INSERT INTO sales (source, status, classification, urssaf_declarable, article_name, quantity, amount_received)
       VALUES ('manual', 'completed', 'personal_item', 0, 'Livre perso', 1, 8)`
    ).run();
    const saleId = Number(info.lastInsertRowid);
    d.prepare(`UPDATE sales SET status='canceled' WHERE id=?`).run(saleId);
    expect(restoreStockForCanceledSale(d, saleId).restored).toBe(0);
  });

  it('deleting linked stock requires explicit unlink and then clears sale association', () => {
    const { id } = createStockManual(d, { name: 'Sac associé', quantity: 1, origin: 'compra_vinted', unit_cost_ttc: 5 });
    const info = d.prepare(
      `INSERT INTO sales (source, status, classification, urssaf_declarable, article_name, quantity, amount_received, linked_stock_item_id)
       VALUES ('manual', 'completed', 'professional_resale', 1, 'Sac associé', 1, 15, ?)`
    ).run(id);
    const saleId = Number(info.lastInsertRowid);

    expect(() => deleteWithAudit(d, 'stock_item', id)).toThrow(/Désassociez/);
    deleteWithAudit(d, 'stock_item', id, { unlinkSales: true });

    const sale = d.prepare(`SELECT linked_stock_item_id FROM sales WHERE id=?`).get(saleId) as { linked_stock_item_id: number | null };
    const stock = d.prepare(`SELECT id FROM stock_items WHERE id=?`).get(id);
    const auditCount = (d.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE entity_type='sale' AND entity_id=?`).get(saleId) as { n: number }).n;
    expect(sale.linked_stock_item_id).toBeNull();
    expect(stock).toBeUndefined();
    expect(auditCount).toBeGreaterThan(0);
  });
});
