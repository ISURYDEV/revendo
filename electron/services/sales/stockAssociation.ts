import type Database from 'better-sqlite3';
import type { SaleStatus, StockItemStatus } from '../../../shared/types';
import { createStockManual } from '../stock/repository';
import { reclassifySale } from './repository';
import { ensureSoldMovementForSale } from './stockSync';

interface SaleForStock {
  id: number;
  source: string;
  external_id: string | null;
  platform: string | null;
  status: SaleStatus;
  article_name: string | null;
  quantity: number | null;
  sku: string;
  brand: string | null;
  size: string | null;
  color: string | null;
  amount_received: number | null;
  purchase_cost_total: number | null;
  purchase_cost_base_margin: number | null;
  linked_stock_item_id: number | null;
}

export interface StockAssociationResult {
  linked: number;
  created: number;
  ambiguous: number;
  skipped: number;
  soldMovements: number;
  needsReview: number;
}

function isCompleted(status: string | null): boolean {
  return status === 'completed' || status === 'colis_perdu';
}

function isCanceledOrRefunded(status: string | null): boolean {
  return status === 'canceled' || status === 'refunded';
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

function initialStatusForSale(status: SaleStatus): StockItemStatus {
  if (status === 'completed' || status === 'colis_perdu') return 'in_stock';
  if (status === 'shipped' || status === 'processing') return 'sold_pending';
  return 'in_stock';
}

function costFromSale(sale: SaleForStock): number | null {
  const qty = Math.max(sale.quantity ?? 1, 1);
  if (sale.purchase_cost_total != null && Number.isFinite(sale.purchase_cost_total) && sale.purchase_cost_total > 0) {
    return sale.purchase_cost_total / qty;
  }
  if (sale.purchase_cost_base_margin != null && Number.isFinite(sale.purchase_cost_base_margin) && sale.purchase_cost_base_margin > 0) {
    return sale.purchase_cost_base_margin;
  }
  return null;
}

function appendReason(db: Database.Database, saleId: number, reason: string): void {
  db.prepare(
    `UPDATE sales
     SET classification_reason=trim(COALESCE(classification_reason, '') || CASE WHEN classification_reason IS NULL OR classification_reason='' THEN '' ELSE ' | ' END || ?),
         updated_at=datetime('now')
     WHERE id=?`
  ).run(reason, saleId);
}

function activeStockMatches(db: Database.Database, sku: string): Array<{ id: number; quantity: number; status: string }> {
  return db.prepare(
    `SELECT id, quantity, status
     FROM stock_items
     WHERE sku=?
       AND quantity > 0
       AND status NOT IN ('sold_completed','donated','gifted','personal_use','lost','discarded','archived')
     ORDER BY (status='listed') DESC, (status='in_stock') DESC, updated_at ASC`
  ).all(sku) as Array<{ id: number; quantity: number; status: string }>;
}

export function createStockFromSale(db: Database.Database, sale: SaleForStock): number {
  const qty = Math.max(sale.quantity ?? 1, 1);
  const unitCost = costFromSale(sale);
  const created = createStockManual(db, {
    name: sale.article_name ?? `Vente #${sale.id}`,
    quantity: qty,
    origin: 'autre',
    unit_cost_ttc: unitCost,
    brand: sale.brand,
    size: sale.size,
    color: sale.color,
    sku: sale.sku,
    estimated_sale_price: sale.amount_received ?? null,
    status: initialStatusForSale(sale.status),
    notes: `Créé automatiquement depuis vente avec SKU #${sale.id}${sale.external_id ? ` (${sale.external_id})` : ''}`
  });

  const sets = [`updated_at=datetime('now')`];
  const params: unknown[] = [];
  if (hasColumn(db, 'stock_items', 'auto_created_from_sale_id')) {
    sets.push(`auto_created_from_sale_id=?`);
    params.push(sale.id);
  }
  if (hasColumn(db, 'stock_items', 'auto_created_reason')) {
    sets.push(`auto_created_reason='Créé automatiquement depuis vente avec SKU'`);
  }
  if (hasColumn(db, 'stock_items', 'source_adapter_id')) {
    sets.push(`source_adapter_id=COALESCE(source_adapter_id, 'auto_stock_from_sale')`);
  }
  if (hasColumn(db, 'stock_items', 'canonical_platform')) {
    sets.push(`canonical_platform=COALESCE(canonical_platform, lower(COALESCE(?, platform, source, 'autre')))`);
    params.push(sale.platform);
  }
  if (hasColumn(db, 'stock_items', 'external_reference')) {
    sets.push(`external_reference=COALESCE(external_reference, ?)`);
    params.push(sale.external_id ?? `sale:${sale.id}`);
  }
  if (hasColumn(db, 'stock_items', 'dedup_key')) {
    sets.push(`dedup_key=COALESCE(dedup_key, ?)`);
    params.push(`stock_item|auto_sale|${sale.id}|sku|${sale.sku.toLowerCase().trim()}`);
  }
  if (hasColumn(db, 'stock_items', 'dedup_confidence')) {
    sets.push(`dedup_confidence=COALESCE(dedup_confidence, 'high')`);
  }
  params.push(created.id);
  db.prepare(`UPDATE stock_items SET ${sets.join(', ')} WHERE id=?`).run(...params);
  return created.id;
}

function linkSaleToStock(db: Database.Database, saleId: number, stockItemId: number, status: 'associated' | 'created'): void {
  if (hasColumn(db, 'sales', 'stock_association_status')) {
    db.prepare(
      `UPDATE sales
       SET linked_stock_item_id=?,
           stock_association_status=?,
           updated_at=datetime('now')
       WHERE id=?`
    ).run(stockItemId, status, saleId);
  } else {
    db.prepare(
      `UPDATE sales
       SET linked_stock_item_id=?,
           updated_at=datetime('now')
       WHERE id=?`
    ).run(stockItemId, saleId);
  }
}

export function ensureStockForSalesWithSku(
  db: Database.Database,
  options: { importId?: number; saleId?: number; createMissing?: boolean } = {}
): StockAssociationResult {
  const result: StockAssociationResult = { linked: 0, created: 0, ambiguous: 0, skipped: 0, soldMovements: 0, needsReview: 0 };
  // SÉCURITÉ (P0.2) : la création automatique de stock à partir d'une vente avec SKU
  // doit être un opt-in explicite, jamais le défaut. Sans cela, une vente personnelle
  // saisie par erreur avec un SKU pourrait générer un stock fantôme et être déclarée
  // comme professionnelle. L'utilisateur doit explicitement choisir
  // « Créer un stock à partir de cette vente » depuis le Centre de révision.
  const createMissing = options.createMissing === true;
  const params: unknown[] = [];
  const where = [`sku IS NOT NULL`, `trim(sku) != ''`, `linked_stock_item_id IS NULL`];
  if (options.importId != null) {
    where.push(`import_id=?`);
    params.push(options.importId);
  }
  if (options.saleId != null) {
    where.push(`id=?`);
    params.push(options.saleId);
  }

  const sales = db.prepare(
    `SELECT id, source, external_id, platform, status, article_name, quantity, sku, brand, size, color,
            amount_received, purchase_cost_total, purchase_cost_base_margin, linked_stock_item_id
     FROM sales
     WHERE ${where.join(' AND ')}
     ORDER BY id ASC`
  ).all(...params) as SaleForStock[];

  const tx = db.transaction(() => {
    for (const sale of sales) {
      if (!sale.sku?.trim()) {
        result.skipped += 1;
        continue;
      }

      const matches = activeStockMatches(db, sale.sku.trim());
      if (matches.length > 1) {
        if (hasColumn(db, 'sales', 'stock_association_status')) {
          db.prepare(
            `UPDATE sales SET stock_association_status='ambiguous', updated_at=datetime('now') WHERE id=?`
          ).run(sale.id);
        }
        appendReason(db, sale.id, `Plusieurs stocks possibles pour le SKU ${sale.sku}`);
        result.ambiguous += 1;
        continue;
      }

      let stockItemId: number;
      let associationStatus: 'associated' | 'created' = 'associated';
      if (matches.length === 1) {
        stockItemId = matches[0].id;
        result.linked += 1;
      } else if (createMissing) {
        stockItemId = createStockFromSale(db, sale);
        associationStatus = 'created';
        result.created += 1;
      } else {
        // P0.2 : pas d'auto-création silencieuse. On marque la vente pour vérification.
        if (hasColumn(db, 'sales', 'stock_association_status')) {
          db.prepare(
            `UPDATE sales SET stock_association_status='needs_review_no_stock', updated_at=datetime('now') WHERE id=?`
          ).run(sale.id);
        }
        appendReason(db, sale.id, 'SKU détecté sans stock associé : vérification requise');
        result.needsReview += 1;
        continue;
      }

      linkSaleToStock(db, sale.id, stockItemId, associationStatus);
      reclassifySale(db, sale.id, { manual: false });

      if (isCompleted(sale.status)) {
        try {
          ensureSoldMovementForSale(db, sale.id, associationStatus === 'created'
            ? 'Stock créé automatiquement depuis vente avec SKU'
            : 'Association automatique vente-stock par SKU');
          result.soldMovements += 1;
        } catch (err) {
          if (hasColumn(db, 'sales', 'stock_association_status')) {
            db.prepare(
              `UPDATE sales SET stock_association_status='ambiguous', updated_at=datetime('now') WHERE id=?`
            ).run(sale.id);
          }
          appendReason(db, sale.id, `Mouvement OUT_SOLD impossible : ${err instanceof Error ? err.message : String(err)}`);
          result.ambiguous += 1;
        }
      } else if (isCanceledOrRefunded(sale.status)) {
        db.prepare(
          `UPDATE sales
           SET urssaf_declarable=0, is_declarable=0, declarable_amount=0
           WHERE id=?`
        ).run(sale.id);
      }
    }
  });

  tx();
  return result;
}

/**
 * Action explicite (P0.2) : créer un stock à partir d'une vente avec SKU
 * et lier la vente à ce stock. Reclasse ensuite la vente en
 * professional_resale et génère le mouvement OUT_SOLD si la vente est completed.
 *
 * À n'utiliser que sur demande explicite de l'utilisateur (Centre de révision
 * ou bouton dédié dans Sales), JAMAIS automatiquement.
 */
export function createStockFromSaleAction(
  db: Database.Database,
  saleId: number
): { ok: true; stock_item_id: number; classification: string; urssaf_declarable: 0 | 1 } {
  const sale = db.prepare(
    `SELECT id, source, external_id, platform, status, article_name, quantity, sku, brand, size, color,
            amount_received, purchase_cost_total, purchase_cost_base_margin, linked_stock_item_id
     FROM sales
     WHERE id=?`
  ).get(saleId) as SaleForStock | undefined;
  if (!sale) throw new Error('Vente introuvable.');
  if (!sale.sku || !sale.sku.trim()) {
    throw new Error("Cette vente n'a pas de SKU : impossible de créer un stock à partir d'elle.");
  }
  if (sale.linked_stock_item_id) {
    throw new Error('Cette vente est déjà associée à un stock.');
  }

  let stockItemId = 0;
  const tx = db.transaction(() => {
    stockItemId = createStockFromSale(db, sale);
    linkSaleToStock(db, sale.id, stockItemId, 'created');
    if (isCompleted(sale.status)) {
      ensureSoldMovementForSale(db, sale.id, 'Stock créé manuellement depuis la vente');
    }
  });
  tx();

  // Reclasse hors transaction : reclassifySale ouvre sa propre transaction implicite
  // via les UPDATE individuels et fait référence à la nouvelle association.
  const reclass = reclassifySale(db, sale.id, { manual: false });
  return {
    ok: true,
    stock_item_id: stockItemId,
    classification: reclass.classification,
    urssaf_declarable: reclass.urssaf_declarable
  };
}
