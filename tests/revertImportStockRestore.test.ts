import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../electron/db/migrations';
import { createStockManual } from '../electron/services/stock/repository';
import { importVinteerSales } from '../electron/services/importers/vinteerSales';
import { revertImport } from '../electron/services/importers';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  const importId = Number(
    db
      .prepare(
        `INSERT INTO imports (source, file_name, file_hash, import_type)
         VALUES ('vinteer_sales', 'ventes.csv', 'hash-revert', 'vinteer_sales')`
      )
      .run().lastInsertRowid
  );
  return { db, importId };
}

describe('revertImport', () => {
  it('restaure le stock vendu automatiquement avant de supprimer les ventes importées', () => {
    const { db, importId } = freshDb();
    const stock = createStockManual(db, {
      name: 'Article existant',
      quantity: 1,
      origin: 'brocante',
      sku: 'SKU-REVERT',
      unit_cost_ttc: 8
    });

    importVinteerSales(
      db,
      [
        {
          'ID Transaction': 'REV-1',
          Statut: 'completed',
          'Date de finalisation': '15/03/2026 10:00:00',
          'Montant encaissé': '20,00',
          Articles: 'Article existant',
          SKU: 'SKU-REVERT'
        }
      ],
      importId
    );

    let item = db.prepare(`SELECT quantity, status FROM stock_items WHERE id=?`).get(stock.id) as { quantity: number; status: string };
    expect(item.quantity).toBe(0);
    expect(item.status).toBe('sold_completed');
    expect((db.prepare(`SELECT COUNT(*) AS n FROM stock_movements WHERE stock_item_id=? AND movement_type='OUT_SOLD'`).get(stock.id) as { n: number }).n).toBe(1);

    const result = revertImport(db, importId);

    item = db.prepare(`SELECT quantity, status FROM stock_items WHERE id=?`).get(stock.id) as { quantity: number; status: string };
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(item.quantity).toBe(1);
    expect(item.status).toBe('in_stock');
    expect((db.prepare(`SELECT COUNT(*) AS n FROM stock_movements WHERE stock_item_id=? AND movement_type='IN_RETURN'`).get(stock.id) as { n: number }).n).toBe(1);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM sales WHERE import_id=?`).get(importId) as { n: number }).n).toBe(0);
  });
});
