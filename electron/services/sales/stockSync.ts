import type Database from 'better-sqlite3';
import { moveOut } from '../stock/repository';

type SaleStatusLike = string | null | undefined;

function isCanceledOrRefunded(status: SaleStatusLike): boolean {
  const s = String(status ?? '').toLowerCase().trim();
  return s === 'canceled' || s === 'cancelled' || s === 'annulé' || s === 'annule' || s === 'refunded' || s === 'remboursé' || s === 'rembourse';
}

function isCompleted(status: SaleStatusLike): boolean {
  const s = String(status ?? '').toLowerCase().trim();
  return s === 'completed' || s === 'colis_perdu';
}

function quantityForSale(row: { quantity: number | null }): number {
  const q = Number(row.quantity ?? 1);
  return Number.isFinite(q) && q > 0 ? q : 1;
}

function soldMovementBalance(db: Database.Database, saleId: number): { stockItemId: number; netQuantity: number }[] {
  return db.prepare(
    `SELECT stock_item_id AS stockItemId,
            COALESCE(SUM(CASE WHEN movement_type='OUT_SOLD' THEN quantity ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN movement_type='IN_RETURN' THEN quantity ELSE 0 END), 0) AS netQuantity
     FROM stock_movements
     WHERE linked_sale_id=?
       AND movement_type IN ('OUT_SOLD', 'IN_RETURN')
     GROUP BY stock_item_id
     HAVING netQuantity > 0`
  ).all(saleId) as { stockItemId: number; netQuantity: number }[];
}

export function ensureSoldMovementForSale(
  db: Database.Database,
  saleId: number,
  reason = 'Synchronisation automatique vente-stock'
): { created: number } {
  const sale = db.prepare(
    `SELECT id, status, quantity, linked_stock_item_id
     FROM sales
     WHERE id=?`
  ).get(saleId) as { id: number; status: string; quantity: number | null; linked_stock_item_id: number | null } | undefined;

  if (!sale || !sale.linked_stock_item_id || !isCompleted(sale.status)) return { created: 0 };

  const desired = quantityForSale(sale);
  const currentSold = (db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN movement_type='OUT_SOLD' THEN quantity ELSE -quantity END), 0) AS q
     FROM stock_movements
     WHERE linked_sale_id=?
       AND stock_item_id=?
       AND movement_type IN ('OUT_SOLD', 'IN_RETURN')`
  ).get(sale.id, sale.linked_stock_item_id) as { q: number }).q;

  const missing = desired - currentSold;
  if (missing <= 0) return { created: 0 };

  moveOut(db, {
    stock_item_id: sale.linked_stock_item_id,
    movement_type: 'OUT_SOLD',
    quantity: missing,
    linked_sale_id: sale.id,
    reason
  });
  return { created: missing };
}

export function restoreStockForCanceledSale(
  db: Database.Database,
  saleId: number,
  reason = 'Retour automatique suite annulation/remboursement'
): { restored: number } {
  const sale = db.prepare(
    `SELECT id, status, linked_stock_item_id
     FROM sales
     WHERE id=?`
  ).get(saleId) as { id: number; status: string; linked_stock_item_id: number | null } | undefined;

  const forceRestore = reason.startsWith('Annulation import');
  if (!sale || (!forceRestore && !isCanceledOrRefunded(sale.status))) return { restored: 0 };

  const balances = soldMovementBalance(db, sale.id);
  if (balances.length === 0) return { restored: 0 };

  let restored = 0;
  const tx = db.transaction(() => {
    for (const b of balances) {
      const item = db.prepare(
        `SELECT id, quantity, unit_cost_ttc, status
         FROM stock_items
         WHERE id=?`
      ).get(b.stockItemId) as { id: number; quantity: number; unit_cost_ttc: number | null; status: string } | undefined;
      if (!item) continue;

      db.prepare(
        `INSERT INTO stock_movements
          (stock_item_id, movement_type, quantity, unit_cost_ttc, total_cost_ttc, reason, linked_sale_id, notes)
         VALUES (?, 'IN_RETURN', ?, ?, ?, ?, ?, ?)`
      ).run(
        b.stockItemId,
        b.netQuantity,
        item.unit_cost_ttc,
        item.unit_cost_ttc != null ? item.unit_cost_ttc * b.netQuantity : null,
        reason,
        sale.id,
        'Réversion vente-stock automatique'
      );

      const nextQuantity = item.quantity + b.netQuantity;
      const nextStatus = item.status === 'listed' || item.status === 'reserved' ? item.status : 'in_stock';
      db.prepare(
        `UPDATE stock_items SET quantity=?, status=?, updated_at=datetime('now') WHERE id=?`
      ).run(nextQuantity, nextStatus, b.stockItemId);
      restored += b.netQuantity;
    }
  });
  tx();
  return { restored };
}

export function syncSaleStockAfterStatusChange(
  db: Database.Database,
  saleId: number
): { soldCreated: number; restored: number } {
  const sale = db.prepare(`SELECT status FROM sales WHERE id=?`).get(saleId) as { status: string } | undefined;
  if (!sale) return { soldCreated: 0, restored: 0 };
  if (isCompleted(sale.status)) {
    return { soldCreated: ensureSoldMovementForSale(db, saleId).created, restored: 0 };
  }
  if (isCanceledOrRefunded(sale.status)) {
    return { soldCreated: 0, restored: restoreStockForCanceledSale(db, saleId).restored };
  }
  return { soldCreated: 0, restored: 0 };
}
