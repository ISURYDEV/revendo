import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migration001Initial } from '../electron/db/migrations/001_initial';
import { migration002 } from '../electron/db/migrations/002_classification_and_links';
import { migration009 } from '../electron/db/migrations/009_usability_phase2';
import { migration010 } from '../electron/db/migrations/010_marketplace_scaling';
import { migration011 } from '../electron/db/migrations/011_document_stock_automation';
import { migration012 } from '../electron/db/migrations/012_security_sync_mobile_future';
import { buildReviewCenter, markReviewItem } from '../electron/services/review/reviewCenter';
import { createSavedFilter, deleteSavedFilter, listSavedFilters, updateSavedFilter } from '../electron/services/savedFilters/repository';
import { globalSearch } from '../electron/services/search/globalSearch';
import { bulkClassifySales, bulkStockMoveOut, bulkUpdateDocumentType, bulkUpdateExpenseCategory, bulkUpdateStockLocation, markEntitiesVerified } from '../electron/services/bulkActions/service';
import { createStockManual } from '../electron/services/stock/repository';

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);`);
  migration001Initial.up(db);
  migration002.up(db);
  migration009.up(db);
  migration010.up(db);
  migration011.up(db);
  migration012.up(db);
  return db;
}

describe('Phase 2 — Centre de révision', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it('detects sales, stock, expenses and documents to review without changing data', () => {
    db.prepare(
      `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable, article_name, amount_received, sale_date)
       VALUES ('manual', 'S-REVIEW', 'completed', 'uncertain_to_review', 0, 'Vente douteuse', 20, '2026-03-10T00:00:00.000Z')`
    ).run();
    createStockManual(db, { name: 'Stock sans emplacement', quantity: 1, origin: 'brocante', unit_cost_ttc: 5 });
    db.prepare(`INSERT INTO expenses (date, category, supplier, description, amount_ttc) VALUES ('2026-03-10', 'autre', 'Test', 'Dépense vague', 12)`).run();
    db.prepare(
      `INSERT INTO documents (file_name, original_file_name, file_path, file_hash, document_type)
       VALUES ('a.pdf', 'a.pdf', 'C:/tmp/a.pdf', 'hash-a', 'facture_achat')`
    ).run();

    const before = (db.prepare(`SELECT COUNT(*) AS n FROM sales`).get() as { n: number }).n;
    const review = buildReviewCenter(db);
    expect(review.items.some((i) => i.issue === 'sale_classification_review')).toBe(true);
    expect(review.items.some((i) => i.issue === 'stock_missing_location')).toBe(true);
    expect(review.items.some((i) => i.issue === 'expense_missing_category')).toBe(true);
    expect(review.items.some((i) => i.issue === 'document_unlinked')).toBe(true);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM sales`).get() as { n: number }).n).toBe(before);
  });

  it('markReviewItem hides a reviewed issue', () => {
    db.prepare(
      `INSERT INTO documents (file_name, original_file_name, file_path, file_hash, document_type)
       VALUES ('b.pdf', 'b.pdf', 'C:/tmp/b.pdf', 'hash-b', 'facture_achat')`
    ).run();
    const item = buildReviewCenter(db).items.find((i) => i.issue === 'document_unlinked')!;
    markReviewItem(db, { key: item.key, module: item.module, entity_type: item.entity_type, entity_id: item.entity_id, status: 'verified', note: 'Vu' });
    expect(buildReviewCenter(db).items.some((i) => i.key === item.key)).toBe(false);
  });

  it('ne signale pas une vente annulée avec montant source positif si elle ne génère ni CA ni bénéfice', () => {
    db.prepare(
      `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable, is_declarable, declarable_amount, article_name, amount_received)
       VALUES ('manual', 'CANCELED-SOURCE-AMOUNT', 'canceled', 'excluded', 0, 0, 0, 'Nike Air Max Plus TN Triple Black', 30)`
    ).run();
    expect(buildReviewCenter(db).items.some((i) => i.issue === 'sale_canceled_still_declarable')).toBe(false);
  });

  it('signale une vente annulée uniquement si elle reste déclarable par erreur', () => {
    db.prepare(
      `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable, is_declarable, declarable_amount, article_name, amount_received)
       VALUES ('manual', 'CANCELED-DECLARABLE', 'canceled', 'excluded', 1, 1, 30, 'Vente annulée mal classée', 30)`
    ).run();
    expect(buildReviewCenter(db).items.some((i) => i.issue === 'sale_canceled_still_declarable')).toBe(true);
  });
});

describe('Phase 2 — saved filters', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it('creates, loads, renames, favorites and deletes a filter', () => {
    const created = createSavedFilter(db, { entity_type: 'sales', name: 'Ventes perso', filter_state: { classification: 'personal_item' } });
    expect(listSavedFilters(db, 'sales')).toHaveLength(1);
    updateSavedFilter(db, created.id, { name: 'Ventes personnelles', is_favorite: true });
    const row = listSavedFilters(db, 'sales')[0];
    expect(row.name).toBe('Ventes personnelles');
    expect(row.is_favorite).toBe(1);
    expect(JSON.parse(row.filter_state_json)).toEqual({ classification: 'personal_item' });
    deleteSavedFilter(db, created.id);
    expect(listSavedFilters(db, 'sales')).toHaveLength(0);
  });
});

describe('Phase 2 — global search', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it('finds sale by external_id, stock by SKU, document by filename and expense by supplier', () => {
    db.prepare(
      `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable, article_name, amount_received)
       VALUES ('manual', 'SALE-ABC', 'completed', 'professional_resale', 1, 'Sac noir', 30)`
    ).run();
    createStockManual(db, { name: 'Chemise bleue', quantity: 1, origin: 'brocante', sku: 'SKU-BLEU' });
    db.prepare(`INSERT INTO expenses (date, category, supplier, description, amount_ttc) VALUES ('2026-03-10', 'emballages', 'La Poste', 'Cartons', 12)`).run();
    db.prepare(
      `INSERT INTO documents (file_name, original_file_name, file_path, file_hash, document_type)
       VALUES ('facture_whatnot.pdf', 'facture_whatnot.pdf', 'C:/tmp/facture_whatnot.pdf', 'hash-c', 'facture_achat')`
    ).run();

    expect(globalSearch(db, 'SALE-ABC').some((r) => r.type === 'sale')).toBe(true);
    expect(globalSearch(db, 'SKU-BLEU').some((r) => r.type === 'stock_item')).toBe(true);
    expect(globalSearch(db, 'whatnot').some((r) => r.type === 'document')).toBe(true);
    expect(globalSearch(db, 'Poste').some((r) => r.type === 'expense')).toBe(true);
  });
});

describe('Phase 2 — bulk actions', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it('updates location of several stock items', () => {
    const a = createStockManual(db, { name: 'A', quantity: 1, origin: 'brocante' });
    const b = createStockManual(db, { name: 'B', quantity: 1, origin: 'brocante' });
    const r = bulkUpdateStockLocation(db, [a.id, b.id], 'Caisse A', 'Rangement');
    expect(r.updated).toBe(2);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM stock_items WHERE location='Caisse A'`).get() as { n: number }).n).toBe(2);
  });

  it('prevents bulk stock movement that would cause negative stock', () => {
    const a = createStockManual(db, { name: 'A', quantity: 1, origin: 'brocante' });
    expect(() => bulkStockMoveOut(db, [a.id], 'OUT_LOST', 2, 'Inventaire')).toThrow(/Action annulée/);
    expect((db.prepare(`SELECT quantity FROM stock_items WHERE id=?`).get(a.id) as { quantity: number }).quantity).toBe(1);
  });

  it('classifies sales and requires fiscal note', () => {
    const info = db.prepare(
      `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable, article_name, amount_received)
       VALUES ('manual', 'S1', 'completed', 'personal_item', 0, 'Vente perso', 25)`
    ).run();
    expect(() => bulkClassifySales(db, [Number(info.lastInsertRowid)], 'professional_resale', '')).toThrow(/note/i);
    bulkClassifySales(db, [Number(info.lastInsertRowid)], 'professional_resale', 'Stock acheté pour revente');
    const row = db.prepare(`SELECT classification, urssaf_declarable FROM sales WHERE id=?`).get(Number(info.lastInsertRowid)) as { classification: string; urssaf_declarable: number };
    expect(row.classification).toBe('professional_resale');
    expect(row.urssaf_declarable).toBe(1);
  });

  it('updates expense category and document type, and marks review issues verified', () => {
    const expenseId = Number(db.prepare(`INSERT INTO expenses (date, category, supplier, amount_ttc) VALUES ('2026-03-10', 'autre', 'Test', 10)`).run().lastInsertRowid);
    const docId = Number(db.prepare(
      `INSERT INTO documents (file_name, original_file_name, file_path, file_hash, document_type)
       VALUES ('x.pdf', 'x.pdf', 'C:/tmp/x.pdf', 'hash-x', NULL)`
    ).run().lastInsertRowid);
    expect(bulkUpdateExpenseCategory(db, [expenseId], 'emballages').updated).toBe(1);
    expect(bulkUpdateDocumentType(db, [docId], 'facture_achat').updated).toBe(1);
    const verified = markEntitiesVerified(db, 'document', [docId], 'Classé manuellement');
    expect(verified.updated).toBeGreaterThanOrEqual(1);
  });
});
