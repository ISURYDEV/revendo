import type Database from 'better-sqlite3';

export interface StaleStockItem {
  id: number;
  internal_code: string;
  name: string | null;
  status: string;
  quantity: number;
  unit_cost_ttc: number | null;
  estimated_sale_price: number | null;
  updated_at: string;
  days_since_update: number;
}

/** Stock items listed/in_stock for more than `daysThreshold` days. */
export function buildStaleStock(db: Database.Database, daysThreshold: number = 90): StaleStockItem[] {
  const cutoff = new Date(Date.now() - daysThreshold * 24 * 60 * 60 * 1000).toISOString();
  const rows = db
    .prepare(
      `SELECT id, internal_code, name, status, quantity, unit_cost_ttc, estimated_sale_price, updated_at
       FROM stock_items
       WHERE status IN ('listed', 'in_stock', 'received')
         AND deleted_at IS NULL
         AND quantity > 0
         AND updated_at < ?
       ORDER BY updated_at ASC
       LIMIT 50`
    )
    .all(cutoff) as Omit<StaleStockItem, 'days_since_update'>[];

  return rows.map((r) => ({
    ...r,
    days_since_update: Math.floor((Date.now() - new Date(r.updated_at).getTime()) / (24 * 60 * 60 * 1000))
  }));
}
