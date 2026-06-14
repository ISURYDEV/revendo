import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migration001Initial } from '../electron/db/migrations/001_initial';
import { migration002 } from '../electron/db/migrations/002_classification_and_links';
import { migration005 } from '../electron/db/migrations/005_pre_activity_and_dedup';
import { migration009 } from '../electron/db/migrations/009_usability_phase2';
import { migration010 } from '../electron/db/migrations/010_marketplace_scaling';
import { migration011 } from '../electron/db/migrations/011_document_stock_automation';
import { migration012 } from '../electron/db/migrations/012_security_sync_mobile_future';
import {
  ensureStockForSalesWithSku,
  createStockFromSaleAction
} from '../electron/services/sales/stockAssociation';
import { importVinteerSales } from '../electron/services/importers/vinteerSales';
import { buildReviewCenter } from '../electron/services/review/reviewCenter';
import { reclassifySale } from '../electron/services/sales/repository';

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);`);
  migration001Initial.up(db);
  migration002.up(db);
  migration005.up(db);
  migration009.up(db);
  migration010.up(db);
  migration011.up(db);
  migration012.up(db);
  return db;
}

function insertSale(db: Database.Database, patch: Record<string, unknown> = {}) {
  const p = {
    source: 'manual',
    status: 'completed',
    classification: 'uncertain_to_review',
    urssaf_declarable: 0,
    is_declarable: 0,
    article_name: 'Sac test',
    quantity: 1,
    sku: 'SKU-X1',
    amount_received: 20,
    declarable_amount: 0,
    ...patch
  };
  return Number(db.prepare(
    `INSERT INTO sales (source, status, classification, urssaf_declarable, is_declarable,
                        article_name, quantity, sku, amount_received, declarable_amount)
     VALUES (@source, @status, @classification, @urssaf_declarable, @is_declarable,
             @article_name, @quantity, @sku, @amount_received, @declarable_amount)`
  ).run(p).lastInsertRowid);
}

describe('P0.2 — vente avec SKU sans stock : pas de création automatique', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => { db = freshDb(); });

  it("une vente completed avec SKU sans stock NE crée PAS de stock automatiquement", () => {
    const saleId = insertSale(db);
    const r = ensureStockForSalesWithSku(db, { saleId });
    expect(r.created).toBe(0);
    expect(r.needsReview).toBe(1);
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM stock_items`).get() as { n: number }).n
    ).toBe(0);
  });

  it("la vente apparaît dans le Centre de révision avec un motif clair", () => {
    insertSale(db, { sku: 'NEED-REVIEW-1' });
    ensureStockForSalesWithSku(db, {});
    const review = buildReviewCenter(db);
    const item = review.items.find((i) => i.issue === 'sale_sku_no_stock_needs_decision');
    expect(item).toBeTruthy();
    expect(item?.title).toMatch(/SKU détecté sans stock/i);
    expect(item?.description).toMatch(/Créez un stock|Marquez comme bien personnel/i);
  });

  it("import Vinteer : vente avec SKU sans stock → uncertain_to_review (non déclarable)", () => {
    db.prepare(
      `INSERT INTO imports (source, file_name, file_hash, import_type)
       VALUES ('vinteer', 'x.csv', 'h', 'vinteer_sales')`
    ).run();
    const r = importVinteerSales(
      db,
      [
        {
          'ID Transaction': 'TX-NEW-1',
          Statut: 'completed',
          'Date de finalisation': '2026-05-15 10:00:00',
          'Montant encaissé': '25,00',
          Articles: 'Article SKU sans stock',
          SKU: 'SKU-VINTED-1'
        }
      ],
      1
    );
    expect(r.created).toBe(1);
    const sale = db.prepare(`SELECT classification, urssaf_declarable, declarable_amount FROM sales WHERE external_id='TX-NEW-1'`).get() as Record<string, unknown>;
    expect(sale.classification).toBe('uncertain_to_review');
    expect(sale.urssaf_declarable).toBe(0);
    expect(sale.declarable_amount).toBe(0);
  });

  it("réimporter ne saute pas la protection (la vente reste à vérifier)", () => {
    db.prepare(
      `INSERT INTO imports (source, file_name, file_hash, import_type)
       VALUES ('vinteer', 'x.csv', 'h', 'vinteer_sales')`
    ).run();
    const row = {
      'ID Transaction': 'TX-RE-1',
      Statut: 'completed',
      'Date de finalisation': '2026-05-15 10:00:00',
      'Montant encaissé': '40,00',
      Articles: 'Re-import',
      SKU: 'SKU-RE-1'
    };
    importVinteerSales(db, [row], 1);
    // Le réimport ne doit pas créer de stock fantôme.
    importVinteerSales(db, [row], 1);
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM stock_items`).get() as { n: number }).n
    ).toBe(0);
    const sale = db.prepare(`SELECT classification, stock_association_status, urssaf_declarable FROM sales WHERE external_id='TX-RE-1'`).get() as Record<string, unknown>;
    expect(sale.classification).toBe('uncertain_to_review');
    expect(sale.urssaf_declarable).toBe(0);
  });
});

describe('P0.2 — actions explicites pour résoudre une vente SKU sans stock', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => { db = freshDb(); });

  it("createStockFromSaleAction crée le stock, lie la vente et la reclasse en professional_resale", () => {
    const saleId = insertSale(db, { sku: 'SKU-EXP-1', article_name: 'Sac explicite', amount_received: 35 });
    ensureStockForSalesWithSku(db, { saleId }); // déclenche le marquage needs_review
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM stock_items`).get() as { n: number }).n
    ).toBe(0);

    const res = createStockFromSaleAction(db, saleId);
    expect(res.ok).toBe(true);
    expect(res.classification).toBe('professional_resale');
    expect(res.urssaf_declarable).toBe(1);
    const sale = db.prepare(`SELECT linked_stock_item_id, classification, stock_association_status FROM sales WHERE id=?`).get(saleId) as Record<string, unknown>;
    expect(sale.linked_stock_item_id).toBe(res.stock_item_id);
    expect(sale.classification).toBe('professional_resale');
    expect(sale.stock_association_status).toBe('created');
    const movement = db.prepare(`SELECT movement_type, quantity FROM stock_movements WHERE linked_sale_id=?`).get(saleId) as Record<string, unknown>;
    expect(movement.movement_type).toBe('OUT_SOLD');
  });

  it("createStockFromSaleAction refuse si la vente n'a pas de SKU", () => {
    const saleId = insertSale(db, { sku: null });
    expect(() => createStockFromSaleAction(db, saleId)).toThrow(/SKU/);
  });

  it("createStockFromSaleAction refuse si la vente est déjà associée à un stock", () => {
    const saleId = insertSale(db, { sku: 'SKU-DUP', amount_received: 10 });
    const existingStockId = Number(db.prepare(
      `INSERT INTO stock_items (internal_code, sku, name, status, quantity, unit_cost_ttc)
       VALUES ('ITEM-EXIST', 'SKU-DUP', 'Stock existant', 'in_stock', 1, 5)`
    ).run().lastInsertRowid);
    db.prepare(`UPDATE sales SET linked_stock_item_id=? WHERE id=?`).run(existingStockId, saleId);
    expect(() => createStockFromSaleAction(db, saleId)).toThrow(/déjà associée/i);
  });

  it("« Marquer comme bien personnel hors activité » : la vente n'est pas déclarable", () => {
    const saleId = insertSale(db, { sku: 'SKU-PERSO' });
    ensureStockForSalesWithSku(db, { saleId });
    const r = reclassifySale(db, saleId, {
      manual: true,
      forcedClassification: 'personal_item',
      note: 'Vente personnelle malgré le SKU'
    });
    expect(r.classification).toBe('personal_item');
    expect(r.urssaf_declarable).toBe(0);
    const sale = db.prepare(`SELECT classification, urssaf_declarable, manual_override FROM sales WHERE id=?`).get(saleId) as Record<string, unknown>;
    expect(sale.classification).toBe('personal_item');
    expect(sale.urssaf_declarable).toBe(0);
    expect(sale.manual_override).toBe(1);
  });
});
