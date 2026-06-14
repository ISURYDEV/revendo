import type Database from 'better-sqlite3';
import { ensureSoftDeleteColumns } from '../../db/softDelete';
import type {
  StockItem,
  StockItemStatus,
  StockMovementType,
  StockOrigin
} from '../../../shared/types';

/** Generate the next ITEM-YYYY-NNNNNN internal code for the current year. */
function nextInternalCode(db: Database.Database): string {
  const year = new Date().getUTCFullYear();
  const seqName = `stock_items_${year}`;
  db.prepare(`INSERT OR IGNORE INTO _sequences (name, value) VALUES (?, 0)`).run(seqName);
  const seq = db
    .prepare(`UPDATE _sequences SET value=value+1 WHERE name=? RETURNING value`)
    .get(seqName) as { value: number };
  return `ITEM-${year}-${String(seq.value).padStart(6, '0')}`;
}

export function listStock(
  db: Database.Database,
  filters: {
    status?: StockItemStatus | 'all';
    search?: string;
    location?: string;
    origin?: StockOrigin | 'all';
    limit?: number;
    offset?: number;
  } = {}
): StockItem[] {
  ensureSoftDeleteColumns(db, ['stock_items']);
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.status && filters.status !== 'all') {
    where.push('status=?');
    params.push(filters.status);
  }
  if (filters.location) {
    where.push('location=?');
    params.push(filters.location);
  }
  if (filters.origin && filters.origin !== 'all') {
    where.push('source=?');
    params.push(filters.origin);
  }
  if (filters.search) {
    where.push('(name LIKE ? OR sku LIKE ? OR brand LIKE ? OR supplier LIKE ? OR internal_code LIKE ?)');
    const like = `%${filters.search}%`;
    params.push(like, like, like, like, like);
  }
  const sql = `SELECT * FROM stock_items ${
    where.length ? 'WHERE deleted_at IS NULL AND ' + where.join(' AND ') : 'WHERE deleted_at IS NULL'
  } ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
  params.push(filters.limit ?? 500, filters.offset ?? 0);
  return db.prepare(sql).all(...params) as StockItem[];
}

export function getStockOverview(db: Database.Database) {
  ensureSoftDeleteColumns(db, ['stock_items']);
  const counts = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status IN ('in_stock','received','listed','reserved') THEN quantity ELSE 0 END), 0) AS at_home,
         COALESCE(SUM(CASE WHEN status='listed' THEN quantity ELSE 0 END), 0) AS listed,
         COALESCE(SUM(CASE WHEN status='reserved' THEN quantity ELSE 0 END), 0) AS reserved,
         COALESCE(SUM(CASE WHEN status='sold_pending' THEN quantity ELSE 0 END), 0) AS sold_pending,
         COALESCE(SUM(CASE WHEN status='sold_completed' THEN quantity ELSE 0 END), 0) AS sold_completed,
         COALESCE(SUM(CASE WHEN status IN ('donated','gifted','personal_use','lost','discarded') THEN quantity ELSE 0 END), 0) AS out_of_business,
         COUNT(*) AS total_items
       FROM stock_items
       WHERE deleted_at IS NULL`
    )
    .get() as Record<string, number>;

  const totals = db
    .prepare(
      `SELECT
         COALESCE(SUM(total_cost_ttc), 0) AS cost_total,
         COALESCE(SUM(estimated_sale_price * quantity), 0) AS estimated_revenue,
         SUM(CASE WHEN location IS NULL OR location = '' THEN 1 ELSE 0 END) AS no_location,
         SUM(CASE WHEN unit_cost_ttc IS NULL THEN 1 ELSE 0 END) AS no_cost
       FROM stock_items
       WHERE deleted_at IS NULL
         AND status IN ('in_stock','received','listed','reserved')`
    )
    .get() as Record<string, number>;

  return { counts, totals };
}

export function createStockManual(
  db: Database.Database,
  payload: {
    name: string;
    quantity: number;
    isLot?: boolean;
    origin: StockOrigin;
    total_cost_ttc?: number | null;
    unit_cost_ttc?: number | null;
    brand?: string | null;
    size?: string | null;
    color?: string | null;
    sku?: string | null;
    estimated_sale_price?: number | null;
    status?: StockItemStatus;
    location?: string | null;
    notes?: string | null;
  }
): { id: number; internal_code: string } {
  const internalCode = nextInternalCode(db);
  const total =
    payload.total_cost_ttc ??
    (payload.unit_cost_ttc != null ? payload.unit_cost_ttc * payload.quantity : null);
  const unit =
    payload.unit_cost_ttc ??
    (payload.total_cost_ttc != null ? payload.total_cost_ttc / Math.max(payload.quantity, 1) : null);

  const info = db
    .prepare(
      `INSERT INTO stock_items (
         internal_code, sku, name, source, supplier, platform,
         status, quantity, unit_cost_ttc, total_cost_ttc, estimated_sale_price,
         brand, size, color, location, purchase_date, received_date, notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)`
    )
    .run(
      internalCode,
      payload.sku ?? null,
      payload.name,
      payload.origin,
      null,
      payload.origin,
      payload.status ?? 'in_stock',
      payload.quantity,
      unit,
      total,
      payload.estimated_sale_price ?? null,
      payload.brand ?? null,
      payload.size ?? null,
      payload.color ?? null,
      payload.location ?? null,
      payload.notes ?? null
    );

  const stockItemId = Number(info.lastInsertRowid);

  const movType = movementForOrigin(payload.origin);
  db.prepare(
    `INSERT INTO stock_movements (stock_item_id, movement_type, quantity, unit_cost_ttc, total_cost_ttc, reason)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(stockItemId, movType, payload.quantity, unit, total, `Entrée manuelle : ${payload.origin}`);

  return { id: stockItemId, internal_code: internalCode };
}

function movementForOrigin(origin: StockOrigin): StockMovementType {
  switch (origin) {
    case 'stock_inicial':
      return 'IN_INITIAL_STOCK';
    case 'regalo_recibido':
      return 'IN_GIFT_RECEIVED';
    case 'donacion_recibida':
      return 'IN_DONATION_RECEIVED';
    case 'compra_vinted':
    case 'compra_whatnot':
    case 'brocante':
      return 'IN_PURCHASE';
    default:
      return 'IN_MANUAL';
  }
}

/** Status transition rules for outbound movements. */
const OUT_TO_STATUS: Record<string, StockItemStatus> = {
  OUT_SOLD: 'sold_completed',
  OUT_DONATED: 'donated',
  OUT_GIFTED: 'gifted',
  OUT_PERSONAL_USE: 'personal_use',
  OUT_LOST: 'lost',
  OUT_DISCARDED: 'discarded'
};

export function moveOut(
  db: Database.Database,
  payload: {
    stock_item_id: number;
    movement_type: StockMovementType;
    quantity: number;
    reason?: string | null;
    linked_sale_id?: number | null;
    linked_document_id?: number | null;
    notes?: string | null;
    movement_date?: string;
  }
): { ok: true; new_status: StockItemStatus; new_quantity: number } {
  ensureSoftDeleteColumns(db, ['stock_items', 'stock_movements', 'sales']);
  const item = db
    .prepare(`SELECT id, quantity, unit_cost_ttc, status FROM stock_items WHERE id=? AND deleted_at IS NULL`)
    .get(payload.stock_item_id) as
    | { id: number; quantity: number; unit_cost_ttc: number | null; status: StockItemStatus }
    | undefined;
  if (!item) throw new Error('Article de stock introuvable');
  if (payload.quantity > item.quantity) {
    throw new Error(`Quantité insuffisante (stock : ${item.quantity}, demandée : ${payload.quantity})`);
  }
  const remaining = item.quantity - payload.quantity;
  const targetStatus =
    OUT_TO_STATUS[payload.movement_type] ?? (remaining === 0 ? 'archived' : item.status);
  const newStatus = remaining === 0 ? targetStatus : item.status;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO stock_movements
        (stock_item_id, movement_date, movement_type, quantity, unit_cost_ttc, total_cost_ttc, reason, linked_sale_id, linked_document_id, notes)
       VALUES (?, COALESCE(?, datetime('now')), ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      payload.stock_item_id,
      payload.movement_date ?? null,
      payload.movement_type,
      payload.quantity,
      item.unit_cost_ttc,
      item.unit_cost_ttc != null ? item.unit_cost_ttc * payload.quantity : null,
      payload.reason ?? null,
      payload.linked_sale_id ?? null,
      payload.linked_document_id ?? null,
      payload.notes ?? null
    );

    // Partial exits keep the current item status. Only a full exit moves the
    // stock line to the final status (donated/gifted/sold/lost/etc.).
    db.prepare(
      `UPDATE stock_items SET quantity=?, status=?, updated_at=datetime('now') WHERE id=?`
    ).run(remaining, newStatus, payload.stock_item_id);

    if (payload.movement_type === 'OUT_SOLD' && payload.linked_sale_id) {
      db.prepare(
        `UPDATE sales SET linked_stock_item_id=COALESCE(linked_stock_item_id, ?), updated_at=datetime('now') WHERE id=?`
      ).run(payload.stock_item_id, payload.linked_sale_id);
    }
  });
  tx();

  return { ok: true, new_status: newStatus, new_quantity: remaining };
}

export function reserveOrList(
  db: Database.Database,
  payload: { stock_item_id: number; action: 'RESERVE' | 'UNRESERVE' | 'LIST' | 'UNLIST' | 'ARCHIVE' }
): { ok: true } {
  const stateAfter: Record<typeof payload.action, StockItemStatus> = {
    RESERVE: 'reserved',
    UNRESERVE: 'in_stock',
    LIST: 'listed',
    UNLIST: 'in_stock',
    ARCHIVE: 'archived'
  };
  db.prepare(
    `INSERT INTO stock_movements (stock_item_id, movement_type, quantity, reason) VALUES (?, ?, 0, ?)`
  ).run(payload.stock_item_id, payload.action, `Status → ${stateAfter[payload.action]}`);
  db.prepare(`UPDATE stock_items SET status=?, updated_at=datetime('now') WHERE id=?`).run(
    stateAfter[payload.action],
    payload.stock_item_id
  );
  return { ok: true };
}

export function bulkUpdateLocation(
  db: Database.Database,
  ids: number[],
  location: string
): { updated: number } {
  if (ids.length === 0) return { updated: 0 };
  const stmt = db.prepare(`UPDATE stock_items SET location=?, updated_at=datetime('now') WHERE id=?`);
  const tx = db.transaction(() => ids.forEach((id) => stmt.run(location, id)));
  tx();
  return { updated: ids.length };
}

/**
 * Hard-delete a stock_item and its movements. Use for data-entry mistakes only.
 * Refuses to delete if the item is linked to a confirmed sale (would leave dangling reference).
 */
export function deleteStockItem(
  db: Database.Database,
  stockItemId: number
): { ok: true; deleted: number } {
  ensureSoftDeleteColumns(db, ['sales']);
  const linked = db
    .prepare(`SELECT COUNT(*) AS n FROM sales WHERE linked_stock_item_id=? AND deleted_at IS NULL`)
    .get(stockItemId) as { n: number };
  if (linked.n > 0) {
    throw new Error(
      `Suppression impossible : l'article est associé à ${linked.n} vente(s). ` +
        `Si l'association est erronée, désassociez d'abord la vente.`
    );
  }
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM stock_movements WHERE stock_item_id=?`).run(stockItemId);
    const info = db.prepare(`DELETE FROM stock_items WHERE id=?`).run(stockItemId);
    return info.changes;
  });
  const deleted = tx();
  return { ok: true, deleted };
}

export function listMovements(db: Database.Database, stockItemId: number) {
  ensureSoftDeleteColumns(db, ['stock_movements', 'sales', 'purchases']);
  return db
    .prepare(
      `SELECT m.*, s.article_name AS linked_sale_name, p.articles AS linked_purchase_name
       FROM stock_movements m
       LEFT JOIN sales s ON s.id = m.linked_sale_id AND s.deleted_at IS NULL
       LEFT JOIN purchases p ON p.id = m.linked_purchase_id AND p.deleted_at IS NULL
       WHERE stock_item_id=?
         AND m.deleted_at IS NULL
       ORDER BY movement_date DESC`
    )
    .all(stockItemId);
}

export function findBySku(db: Database.Database, sku: string) {
  ensureSoftDeleteColumns(db, ['stock_items']);
  return db
    .prepare(
      `SELECT id, internal_code, sku, name, status, quantity, unit_cost_ttc
       FROM stock_items WHERE sku=? AND quantity > 0 AND deleted_at IS NULL
       ORDER BY status, updated_at DESC LIMIT 20`
    )
    .all(sku);
}

/** Split a purchase into N stock_items, distributing cost equally or proportionally. */
export function splitPurchaseLot(
  db: Database.Database,
  payload: {
    purchase_id: number;
    items: {
      name: string;
      quantity: number;
      brand?: string | null;
      size?: string | null;
      color?: string | null;
      sku?: string | null;
      cost_share?: number; // explicit cost; if absent, equal split
      estimated_sale_price?: number | null;
    }[];
    cost_method: 'equal' | 'proportional' | 'manual';
    include_shipping?: boolean;
  }
): { created: number } {
  ensureSoftDeleteColumns(db, ['purchases']);
  const purchase = db
    .prepare(`SELECT total_ttc, shipping_fee, protection_fee, items_price FROM purchases WHERE id=? AND deleted_at IS NULL`)
    .get(payload.purchase_id) as
    | { total_ttc: number; shipping_fee: number | null; protection_fee: number | null; items_price: number | null }
    | undefined;
  if (!purchase) throw new Error('Achat introuvable');

  const baseCost = payload.include_shipping
    ? purchase.total_ttc
    : (purchase.items_price ?? purchase.total_ttc);
  const totalUnits = payload.items.reduce((s, it) => s + it.quantity, 0);
  const totalEstimated = payload.items.reduce(
    (s, it) => s + (it.estimated_sale_price ?? 0) * it.quantity,
    0
  );

  const tx = db.transaction(() => {
    for (const it of payload.items) {
      let cost: number;
      if (payload.cost_method === 'manual' && it.cost_share != null) {
        cost = it.cost_share;
      } else if (payload.cost_method === 'proportional' && totalEstimated > 0) {
        cost = baseCost * (((it.estimated_sale_price ?? 0) * it.quantity) / totalEstimated);
      } else {
        cost = baseCost * (it.quantity / totalUnits);
      }
      const internalCode = nextInternalCode(db);
      const info = db
        .prepare(
          `INSERT INTO stock_items (
             internal_code, sku, name, source, purchase_id, status, quantity,
             unit_cost_ttc, total_cost_ttc, estimated_sale_price, brand, size, color
           ) VALUES (?, ?, ?, 'split_lot', ?, 'in_stock', ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          internalCode,
          it.sku ?? null,
          it.name,
          payload.purchase_id,
          it.quantity,
          cost / it.quantity,
          cost,
          it.estimated_sale_price ?? null,
          it.brand ?? null,
          it.size ?? null,
          it.color ?? null
        );
      db.prepare(
        `INSERT INTO stock_movements
          (stock_item_id, movement_type, quantity, unit_cost_ttc, total_cost_ttc, reason, linked_purchase_id)
         VALUES (?, 'IN_PURCHASE', ?, ?, ?, ?, ?)`
      ).run(
        Number(info.lastInsertRowid),
        it.quantity,
        cost / it.quantity,
        cost,
        `Division de l'achat #${payload.purchase_id}`,
        payload.purchase_id
      );
    }
  });
  tx();
  return { created: payload.items.length };
}
