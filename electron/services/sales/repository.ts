import type Database from 'better-sqlite3';
import { ensureSoftDeleteColumns } from '../../db/softDelete';
import { classifySale, declaredPeriod, type Classification } from './classification';

/** Read activity_start_date from settings as YYYY-MM-DD, or null if unset. */
export function getActivityStartDate(db: Database.Database): string | null {
  const row = db
    .prepare(`SELECT value FROM settings WHERE key='activity_start_date'`)
    .get() as { value: string } | undefined;
  if (!row?.value) return null;
  return row.value.slice(0, 10);
}

/** Reclassify ONE sale using current DB state; writes audit row if changed. */
export function reclassifySale(
  db: Database.Database,
  saleId: number,
  options: { manual?: boolean; note?: string; forcedClassification?: Classification } = {}
): { changed: boolean; classification: Classification; urssaf_declarable: 0 | 1 } {
  const row = db
    .prepare(
      `SELECT id, status, sku, linked_purchase_id, linked_stock_item_id, classification,
              urssaf_declarable, classification_reason, manual_override, override_note
       FROM sales WHERE id=?`
    )
    .get(saleId) as
    | {
        id: number;
        status: string;
        sku: string | null;
        linked_purchase_id: number | null;
        linked_stock_item_id: number | null;
        classification: Classification | null;
        urssaf_declarable: number;
        classification_reason: string | null;
        manual_override: number;
        override_note: string | null;
      }
    | undefined;

  if (!row) throw new Error(`Sale ${saleId} not found`);

  // Get encashment date for pre_activity check
  const encRow = db
    .prepare(`SELECT declared_encashment_date FROM sales WHERE id=?`)
    .get(saleId) as { declared_encashment_date: string | null } | undefined;
  const activityStart = getActivityStartDate(db);

  const keepManualOverride = row.manual_override === 1 && options.manual !== true;
  const manualOverride = options.manual === true || keepManualOverride;
  const forcedClassification =
    options.forcedClassification ?? (keepManualOverride ? row.classification ?? undefined : undefined);
  const overrideNote = options.note ?? (keepManualOverride ? row.override_note ?? undefined : undefined);

  const result = classifySale({
    status: row.status,
    sku: row.sku,
    linkedPurchaseId: row.linked_purchase_id,
    linkedStockItemId: row.linked_stock_item_id,
    manualOverride,
    forcedClassification,
    overrideNote,
    activityStartDate: activityStart,
    encashmentDate: encRow?.declared_encashment_date ?? null
  });

  const changed =
    row.classification !== result.classification ||
    row.urssaf_declarable !== result.urssaf_declarable;

  if (changed) {
    db.prepare(
      `INSERT INTO sale_classification_audit
         (sale_id, prev_classification, new_classification, prev_urssaf_declarable,
          new_urssaf_declarable, prev_reason, new_reason, manual, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      saleId,
      row.classification,
      result.classification,
      row.urssaf_declarable,
      result.urssaf_declarable,
      row.classification_reason,
      result.classification_reason,
      options.manual ? 1 : 0,
      options.note ?? null
    );
  }

  db.prepare(
    `UPDATE sales SET
       classification=?, urssaf_declarable=?, classification_reason=?,
       manual_override=?, override_note=?,
       is_declarable=?,
       updated_at=datetime('now')
     WHERE id=?`
  ).run(
    result.classification,
    result.urssaf_declarable,
    result.classification_reason,
    manualOverride ? 1 : 0,
    overrideNote ?? null,
    result.urssaf_declarable, // keep legacy column in sync
    saleId
  );

  return { changed, classification: result.classification, urssaf_declarable: result.urssaf_declarable };
}

/** Re-derive declared_period from declared_encashment_date. */
export function recomputeDeclaredPeriod(db: Database.Database, saleId: number): void {
  const row = db
    .prepare(`SELECT declared_encashment_date FROM sales WHERE id=? AND deleted_at IS NULL`)
    .get(saleId) as { declared_encashment_date: string | null } | undefined;
  if (!row) return;
  db.prepare(`UPDATE sales SET declared_period=? WHERE id=?`).run(
    declaredPeriod(row.declared_encashment_date),
    saleId
  );
}

/**
 * Reclassify ALL sales using current settings (activity_start_date, etc.).
 * Skips manually-overridden sales unless `force=true`.
 */
export function reclassifyAllSales(
  db: Database.Database,
  options: { force?: boolean } = {}
): { processed: number; changed: number } {
  ensureSoftDeleteColumns(db, ['sales']);
  const rows = db
    .prepare(
      `SELECT id FROM sales WHERE deleted_at IS NULL ${options.force ? '' : 'AND manual_override=0'}`
    )
    .all() as { id: number }[];
  let changed = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      const res = reclassifySale(db, r.id, {});
      recomputeDeclaredPeriod(db, r.id);
      if (res.changed) changed += 1;
    }
  });
  tx();
  return { processed: rows.length, changed };
}

/** Insert a fully manual sale and classify it. */
export function insertManualSale(
  db: Database.Database,
  payload: {
    platform: string;
    sale_date?: string | null;
    finalization_date?: string | null;
    declared_encashment_date?: string | null;
    status: string;
    article_name: string;
    quantity?: number;
    sku?: string | null;
    sale_price_ttc?: number | null;
    amount_received?: number | null;
    buyer_username?: string | null;
    buyer_country?: string | null;
    shipping_cost_ttc?: number | null;
    note?: string | null;
    linked_stock_item_id?: number | null;
    linked_purchase_id?: number | null;
    forcedClassification?: Classification;
    overrideNote?: string;
  }
): { id: number } {
  const amount = payload.amount_received ?? payload.sale_price_ttc ?? 0;
  const declared = payload.declared_encashment_date ?? payload.finalization_date ?? payload.sale_date ?? null;
  const cls = classifySale({
    status: payload.status,
    sku: payload.sku,
    linkedPurchaseId: payload.linked_purchase_id,
    linkedStockItemId: payload.linked_stock_item_id,
    manualOverride: !!payload.forcedClassification,
    forcedClassification: payload.forcedClassification,
    overrideNote: payload.overrideNote,
    activityStartDate: getActivityStartDate(db),
    encashmentDate: declared
  });

  const info = db
    .prepare(
      `INSERT INTO sales (
         source, external_id, sale_date, finalization_date, declared_encashment_date, status,
         platform, article_name, quantity, sku,
         buyer_username, buyer_country,
         sale_price_ttc, amount_received, shipping_cost_ttc,
         note,
         linked_stock_item_id, linked_purchase_id,
         classification, urssaf_declarable, classification_reason, manual_override, override_note,
         is_declarable, declarable_amount, exclusion_reason, declared_period
       ) VALUES (
         'manual', NULL, ?, ?, ?, ?,
         ?, ?, ?, ?,
         ?, ?,
         ?, ?, ?,
         ?,
         ?, ?,
         ?, ?, ?, ?, ?,
         ?, ?, ?, ?
       )`
    )
    .run(
      payload.sale_date ?? null,
      payload.finalization_date ?? null,
      declared,
      payload.status,
      payload.platform,
      payload.article_name,
      payload.quantity ?? 1,
      payload.sku ?? null,
      payload.buyer_username ?? null,
      payload.buyer_country ?? null,
      payload.sale_price_ttc ?? null,
      amount,
      payload.shipping_cost_ttc ?? null,
      payload.note ?? null,
      payload.linked_stock_item_id ?? null,
      payload.linked_purchase_id ?? null,
      cls.classification,
      cls.urssaf_declarable,
      cls.classification_reason,
      payload.forcedClassification ? 1 : 0,
      payload.overrideNote ?? null,
      cls.urssaf_declarable,
      cls.urssaf_declarable ? amount : 0,
      cls.urssaf_declarable ? null : cls.classification_reason,
      declaredPeriod(declared)
    );

  return { id: Number(info.lastInsertRowid) };
}
