import type Database from 'better-sqlite3';
import { ensureStockForSalesWithSku } from './stockAssociation';

export interface AutoLinkResult {
  linked: number;
  ambiguous: number; // multiple stock matches, needs manual choice
  noStock: number;  // sku without stock match
}

/**
 * After a Vinteer sales import, walk through newly-imported declarable sales that
 * have a SKU but no linked_stock_item_id, and try to auto-link:
 *  - exactly 1 in_stock/listed item with that SKU → link + OUT_SOLD movement (qty 1).
 *  - multiple matches → leave unlinked, marked as ambiguous (count returned).
 *  - no matches → leave unlinked.
 *
 * Idempotent: skips sales that already have a link or whose status is canceled/refunded.
 */
export function autoLinkVinteerSales(
  db: Database.Database,
  importId?: number
): AutoLinkResult {
  const r = ensureStockForSalesWithSku(db, { importId });
  return {
    linked: r.linked + r.created,
    ambiguous: r.ambiguous,
    noStock: r.skipped
  };
}
