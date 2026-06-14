import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migration001Initial } from '../electron/db/migrations/001_initial';
import { migration002 } from '../electron/db/migrations/002_classification_and_links';
import { migration005 } from '../electron/db/migrations/005_pre_activity_and_dedup';
import { migration009 } from '../electron/db/migrations/009_usability_phase2';
import { migration010 } from '../electron/db/migrations/010_marketplace_scaling';
import { migration011 } from '../electron/db/migrations/011_document_stock_automation';
import { migration012 } from '../electron/db/migrations/012_security_sync_mobile_future';
import { ensureStockForSalesWithSku } from '../electron/services/sales/stockAssociation';
import { createStockManual } from '../electron/services/stock/repository';
import { matchBoostInvoiceToExpense } from '../electron/services/documents/boostInvoiceMatcher';
import { extractSkusFromText, matchSalesInvoiceBySku } from '../electron/services/documents/salesInvoiceMatcher';
import { markWhatNotPurchasesJustified } from '../electron/services/documents/whatnotCsvJustificatif';
import { buildReviewCenter } from '../electron/services/review/reviewCenter';
import { isPathInsideDirectory } from '../electron/services/documents/storage';
import { ensurePurchaseFromPurchaseDocument, runAutomaticLinking } from '../electron/services/automation/startupLinking';

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
    sku: 'SULLICO-21',
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

function insertDocument(db: Database.Database, patch: Record<string, unknown> = {}) {
  const p = {
    file_name: 'doc.pdf',
    original_file_name: 'doc.pdf',
    file_path: 'C:/Revendo/documents/doc.pdf',
    file_hash: `hash-${Math.random()}`,
    document_type: 'facture_vente',
    source: 'manual',
    date: '2026-05-24',
    amount: 20,
    ...patch
  };
  return Number(db.prepare(
    `INSERT INTO documents (file_name, original_file_name, file_path, file_hash, document_type, source, date, amount)
     VALUES (@file_name, @original_file_name, @file_path, @file_hash, @document_type, @source, @date, @amount)`
  ).run(p).lastInsertRowid);
}

describe('Stock associé automatique par SKU', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  // P0.2 — Par défaut, ensureStockForSalesWithSku NE CRÉE PAS de stock automatiquement.
  // La vente est marquée needs_review_no_stock pour passer au Centre de révision.
  it('ne crée PAS de stock automatiquement pour une vente avec SKU sans stock', () => {
    const saleId = insertSale(db);
    const r = ensureStockForSalesWithSku(db, { saleId });
    expect(r.created).toBe(0);
    expect(r.needsReview).toBe(1);
    const sale = db.prepare(`SELECT linked_stock_item_id, stock_association_status FROM sales WHERE id=?`).get(saleId) as { linked_stock_item_id: number | null; stock_association_status: string };
    expect(sale.linked_stock_item_id).toBeNull();
    expect(sale.stock_association_status).toBe('needs_review_no_stock');
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM stock_items`).get() as { n: number }).n
    ).toBe(0);
  });

  it("crée le stock UNIQUEMENT sur demande explicite (createMissing: true)", () => {
    const saleId = insertSale(db);
    const r = ensureStockForSalesWithSku(db, { saleId, createMissing: true });
    expect(r.created).toBe(1);
    const sale = db.prepare(`SELECT linked_stock_item_id, classification, urssaf_declarable FROM sales WHERE id=?`).get(saleId) as { linked_stock_item_id: number; classification: string; urssaf_declarable: number };
    expect(sale.linked_stock_item_id).toBeTruthy();
    expect(sale.classification).toBe('professional_resale');
    expect(sale.urssaf_declarable).toBe(1);
    const movement = db.prepare(`SELECT movement_type FROM stock_movements WHERE linked_sale_id=?`).get(saleId) as { movement_type: string };
    expect(movement.movement_type).toBe('OUT_SOLD');
  });

  it('associe un stock existant sans le dupliquer', () => {
    createStockManual(db, { name: 'Sac test', quantity: 1, origin: 'brocante', sku: 'SULLICO-21', unit_cost_ttc: 5 });
    const saleId = insertSale(db);
    const r = ensureStockForSalesWithSku(db, { saleId });
    expect(r.linked).toBe(1);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM stock_items WHERE sku='SULLICO-21'`).get() as { n: number }).n).toBe(1);
  });

  it('marque à vérifier quand plusieurs stocks portent le même SKU', () => {
    createStockManual(db, { name: 'Sac A', quantity: 1, origin: 'brocante', sku: 'DUP-1' });
    createStockManual(db, { name: 'Sac B', quantity: 1, origin: 'brocante', sku: 'DUP-1' });
    const saleId = insertSale(db, { sku: 'DUP-1' });
    const r = ensureStockForSalesWithSku(db, { saleId });
    expect(r.ambiguous).toBe(1);
    const sale = db.prepare(`SELECT linked_stock_item_id, stock_association_status FROM sales WHERE id=?`).get(saleId) as { linked_stock_item_id: number | null; stock_association_status: string };
    expect(sale.linked_stock_item_id).toBeNull();
    expect(sale.stock_association_status).toBe('ambiguous');
  });

  it('vente annulée avec SKU sans stock : marquée needs_review, pas de mouvement OUT_SOLD ni CA (createMissing par défaut: false)', () => {
    const saleId = insertSale(db, { status: 'canceled', classification: 'excluded', amount_received: 10 });
    const r = ensureStockForSalesWithSku(db, { saleId });
    expect(r.created).toBe(0);
    expect(r.needsReview).toBe(1);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM stock_movements WHERE linked_sale_id=? AND movement_type='OUT_SOLD'`).get(saleId) as { n: number }).n).toBe(0);
    const sale = db.prepare(`SELECT urssaf_declarable, declarable_amount, classification FROM sales WHERE id=?`).get(saleId) as { urssaf_declarable: number; declarable_amount: number | null; classification: string };
    expect(sale.urssaf_declarable).toBe(0);
    expect(sale.declarable_amount ?? 0).toBe(0);
    // La classification d'origine 'excluded' (canceled) ne doit pas changer.
    expect(sale.classification).toBe('excluded');
  });

  it("le traitement automatique au démarrage ne crée pas de stock par défaut (P0.2)", async () => {
    const saleId = insertSale(db, {
      article_name: 'Pantalon Large Fluide Be Fun | Taille M | Vert Kaki',
      sku: 'SULLICO-21'
    });
    const r = await runAutomaticLinking(db);
    expect(r.stockCreated).toBe(0);
    expect(r.stockNeedsReview).toBe(1);
    const sale = db.prepare(`SELECT linked_stock_item_id, stock_association_status FROM sales WHERE id=?`).get(saleId) as { linked_stock_item_id: number | null; stock_association_status: string };
    expect(sale.linked_stock_item_id).toBeNull();
    expect(sale.stock_association_status).toBe('needs_review_no_stock');
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM stock_items`).get() as { n: number }).n
    ).toBe(0);
  });
});

describe('Factures et justificatifs automatiques', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it('associe une facture de vente PDF à une vente par SKU', async () => {
    const saleId = insertSale(db, { classification: 'professional_resale', urssaf_declarable: 1, amount_received: 20 });
    const docId = insertDocument(db, { amount: 20 });
    const r = await matchSalesInvoiceBySku(db, docId, {
      text: 'Facture vente\nSKU : SULLICO-21\nTotal 20,00 €',
      date: '2026-05-24',
      amount: 20,
      candidates: { amounts: [20], dates: ['2026-05-24'] }
    });
    expect(r.status).toBe('matched');
    expect(r.linkedSales).toContain(saleId);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM document_links WHERE document_id=? AND entity_type='sale'`).get(docId) as { n: number }).n).toBe(1);
  });

  it('la facture de vente avec SKU ambigu reste au Centre de révision', async () => {
    insertSale(db, { sku: 'AMB-1' });
    insertSale(db, { sku: 'AMB-1', article_name: 'Autre sac' });
    const docId = insertDocument(db, { amount: 20 });
    const r = await matchSalesInvoiceBySku(db, docId, {
      text: 'Référence : AMB-1',
      date: '2026-05-24',
      amount: 20,
      candidates: { amounts: [20], dates: ['2026-05-24'] }
    });
    expect(r.status).toBe('ambiguous');
    const review = buildReviewCenter(db).items.map((i) => i.key);
    expect(review.some((k) => String(k).includes('document_match_ambiguous'))).toBe(true);
  });

  it('détecte les SKU depuis texte et ne matche pas sans SKU', async () => {
    expect(extractSkusFromText('Article SKU: SULLICO-21', [])).toContain('SULLICO-21');
    const docId = insertDocument(db, { amount: 20 });
    const r = await matchSalesInvoiceBySku(db, docId, {
      text: 'Facture sans référence produit',
      date: null,
      amount: null,
      candidates: { amounts: [], dates: [] }
    });
    expect(r.status).toBe('unmatched');
  });

  it('associe une facture boost à une dépense boost par montant et date', () => {
    const expenseId = Number(db.prepare(
      `INSERT INTO expenses (date, category, supplier, platform, description, amount_ttc)
       VALUES ('2026-05-24', 'boost_marketing', 'Vinted', 'Vinted', 'Boost Vinted', 12.5)`
    ).run().lastInsertRowid);
    const docId = insertDocument(db, { document_type: 'facture_boost', date: '2026-05-24', amount: 12.5 });
    const r = matchBoostInvoiceToExpense(db, docId);
    expect(r.status).toBe('matched');
    expect(r.linkedExpenseId).toBe(expenseId);
  });

  it('la facture boost ambiguë crée des candidats à vérifier', () => {
    db.prepare(`INSERT INTO expenses (date, category, supplier, amount_ttc) VALUES ('2026-05-24', 'boost_marketing', 'Vinted', 8)`).run();
    db.prepare(`INSERT INTO expenses (date, category, supplier, amount_ttc) VALUES ('2026-05-24', 'boost_marketing', 'Vinted', 8)`).run();
    const docId = insertDocument(db, { document_type: 'facture_boost', date: '2026-05-24', amount: 8 });
    const r = matchBoostInvoiceToExpense(db, docId);
    expect(r.status).toBe('ambiguous');
    expect(r.candidates).toBe(2);
  });

  it('un CSV WhatNot lié sert de justificatif et retire achat sans justificatif', () => {
    const importId = Number(db.prepare(`INSERT INTO imports (source, file_name, file_hash, import_type) VALUES ('whatnot', 'w.csv', 'h', 'whatnot_purchases')`).run().lastInsertRowid);
    db.prepare(
      `INSERT INTO purchases (source, external_id, import_id, platform, articles, quantity, total_ttc)
       VALUES ('whatnot', 'W1', ?, 'WhatNot', 'Lot', 1, 20)`
    ).run(importId);
    const docId = insertDocument(db, { document_type: 'whatnot_purchase_csv', original_file_name: 'w.csv' });
    const r = markWhatNotPurchasesJustified(db, { importId, documentId: docId });
    expect(r.linkedPurchases).toBe(1);
    const reviewKeys = buildReviewCenter(db).items.map((i) => i.key);
    expect(reviewKeys.some((k) => k.includes('purchase_missing_document'))).toBe(false);
  });

  it('crée un achat AliExpress justifié depuis une facture PDF importée', () => {
    const docId = insertDocument(db, {
      document_type: 'facture_achat',
      source: 'aliexpress',
      original_file_name: 'commande_aliexpress.pdf',
      amount: 42.9,
      date: '2026-05-20'
    });
    const r = ensurePurchaseFromPurchaseDocument(db, docId, 'AliExpress');
    expect(r.created).toBe(true);
    const purchase = db.prepare(`SELECT platform, seller, total_ttc, justificatif_status FROM purchases WHERE id=?`).get(r.purchaseId) as { platform: string; seller: string; total_ttc: number; justificatif_status: string };
    expect(purchase.platform).toBe('AliExpress');
    expect(purchase.seller).toBe('AliExpress');
    expect(purchase.total_ttc).toBe(42.9);
    expect(purchase.justificatif_status).toBe('present');
    expect((db.prepare(`SELECT COUNT(*) AS n FROM document_links WHERE document_id=? AND entity_type='purchase' AND entity_id=?`).get(docId, r.purchaseId) as { n: number }).n).toBe(1);
  });
});

describe('Centre de révision documents', () => {
  it('expose une action document et refuse les chemins hors dossier contrôlé', () => {
    const db = freshDb();
    const docId = insertDocument(db, { document_type: 'facture_achat', original_file_name: 'orphan.pdf' });
    const item = buildReviewCenter(db).items.find((i) => i.entity_type === 'document' && i.entity_id === docId);
    expect(item?.document_id).toBe(docId);
    expect(item?.document_file_name).toBe('orphan.pdf');

    expect(isPathInsideDirectory('C:/Revendo/documents/2026/a.pdf', 'C:/Revendo/documents')).toBe(true);
    expect(isPathInsideDirectory('C:/Windows/system32/a.pdf', 'C:/Revendo/documents')).toBe(false);
  });
});
