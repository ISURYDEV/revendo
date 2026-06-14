import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migration001Initial } from '../electron/db/migrations/001_initial';
import { migration002 } from '../electron/db/migrations/002_classification_and_links';
import { migration005 } from '../electron/db/migrations/005_pre_activity_and_dedup';
import { migration009 } from '../electron/db/migrations/009_usability_phase2';
import { migration010 } from '../electron/db/migrations/010_marketplace_scaling';
import { migration011 } from '../electron/db/migrations/011_document_stock_automation';
import { migration012 } from '../electron/db/migrations/012_security_sync_mobile_future';
import { buildProfitabilitySummary } from '../electron/services/profitability/calculator';
import { buildReviewCenter } from '../electron/services/review/reviewCenter';
import { buildQuarterlySummary } from '../electron/services/declarations/summary';

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

function insertStock(
  db: Database.Database,
  code: string,
  unit_cost_ttc: number | null
): number {
  return Number(
    db.prepare(
      `INSERT INTO stock_items (internal_code, sku, name, status, quantity, unit_cost_ttc)
       VALUES (?, ?, 'Article', 'in_stock', 1, ?)`
    ).run(code, code, unit_cost_ttc).lastInsertRowid
  );
}

function insertProSale(
  db: Database.Database,
  ext: string,
  amount: number,
  date: string,
  linked_stock_item_id: number | null,
  purchase_cost_total: number | null
): number {
  return Number(
    db.prepare(
      `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable,
                          declarable_amount, amount_received, purchase_cost_total,
                          declared_encashment_date, sale_date, linked_stock_item_id, quantity)
       VALUES ('manual', ?, 'completed', 'professional_resale', 1, ?, ?, ?, ?, ?, ?, 1)`
    ).run(ext, amount, amount, purchase_cost_total, `${date}T10:00:00.000Z`, `${date}T10:00:00.000Z`, linked_stock_item_id).lastInsertRowid
  );
}

describe('P1.4 — fallback COGS quand stock linké sans coût', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => { db = freshDb(); });

  it('utilise unit_cost_ttc quand il est présent (cas nominal)', () => {
    const stockId = insertStock(db, 'STK-A', 30);
    insertProSale(db, 'S1', 100, '2026-03-15', stockId, null);
    const s = buildProfitabilitySummary(db, 2026, 1);
    expect(s.cogs).toBe(30);
    expect(s.missingCostSalesCount).toBe(0);
  });

  it("fallback : si stock linké a unit_cost_ttc null mais sales.purchase_cost_total>0 → utilise purchase_cost_total", () => {
    const stockId = insertStock(db, 'STK-B', null);
    insertProSale(db, 'S2', 120, '2026-03-15', stockId, 70);
    const s = buildProfitabilitySummary(db, 2026, 1);
    expect(s.cogs).toBe(70);
    expect(s.missingCostSalesCount).toBe(0);
    expect(s.margeBrute).toBe(120 - 70);
  });

  it('compte la vente comme « coût manquant » quand ni stock ni purchase_cost_total ne fournissent un coût', () => {
    const stockId = insertStock(db, 'STK-C', null);
    insertProSale(db, 'S3', 50, '2026-03-15', stockId, null);
    const s = buildProfitabilitySummary(db, 2026, 1);
    expect(s.cogs).toBe(0); // pas inventé
    expect(s.missingCostSalesCount).toBe(1);
  });

  it("le CA URSSAF n'est PAS affecté par le fallback COGS", () => {
    const stockId = insertStock(db, 'STK-D', null);
    insertProSale(db, 'S4', 200, '2026-03-15', stockId, null);
    const fiscal = buildQuarterlySummary(db, 2026, 1);
    expect(fiscal.caGoods).toBe(200);
    const profit = buildProfitabilitySummary(db, 2026, 1);
    expect(profit.caUrssaf).toBe(200);
    expect(profit.missingCostSalesCount).toBe(1);
  });

  it("la marge n'est plus surestimée silencieusement : missingCostSalesCount > 0 alerte l'utilisateur", () => {
    const stockA = insertStock(db, 'STK-E1', null);
    const stockB = insertStock(db, 'STK-E2', null);
    insertProSale(db, 'S-A', 100, '2026-03-15', stockA, null);
    insertProSale(db, 'S-B', 60, '2026-03-15', stockB, null);
    const s = buildProfitabilitySummary(db, 2026, 1);
    expect(s.missingCostSalesCount).toBe(2);
  });

  it('le Centre de révision liste les ventes liées à un stock sans coût', () => {
    const stockId = insertStock(db, 'STK-F', null);
    insertProSale(db, 'S-F', 50, '2026-03-15', stockId, null);
    const review = buildReviewCenter(db);
    const item = review.items.find((i) => i.issue === 'sale_linked_stock_missing_cost');
    expect(item).toBeTruthy();
    expect(item?.title).toMatch(/Vente liée à un stock sans coût/);
    expect(item?.description).toMatch(/coût manquant/i);
  });
});
