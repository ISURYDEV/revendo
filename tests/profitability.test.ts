import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migration001Initial } from '../electron/db/migrations/001_initial';
import { migration002 } from '../electron/db/migrations/002_classification_and_links';
import { buildProfitabilitySummary } from '../electron/services/profitability/calculator';
import { createExpense } from '../electron/services/expenses/repository';
import { createManualBoost } from '../electron/services/boosts/repository';
import { createStockManual } from '../electron/services/stock/repository';

function freshDb() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);`);
  migration001Initial.up(d);
  migration002.up(d);
  return d;
}

describe('buildProfitabilitySummary', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it('expenses DO NOT reduce CA URSSAF but DO reduce margeReelleEstimee', () => {
    db.prepare(
      `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable,
                          declarable_amount, amount_received, sale_date, declared_encashment_date)
       VALUES ('vinteer', 'A', 'completed', 'professional_resale', 1, 100, 100,
               '2026-03-15T10:00:00.000Z', '2026-03-15T10:00:00.000Z')`
    ).run();
    createExpense(db, { date: '2026-03-15', category: 'emballages', amount_ttc: 25 });
    const s = buildProfitabilitySummary(db, 2026, 1);
    expect(s.caUrssaf).toBe(100);              // CA NOT reduced
    expect(s.expensesTotal).toBe(25);
    expect(s.margeReelleEstimee).toBe(100 - 25); // 75 (no COGS, no boosts)
  });

  it('boosts reduce profitability when in period', () => {
    db.prepare(
      `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable,
                          declarable_amount, amount_received, sale_date, declared_encashment_date)
       VALUES ('manual', 'A', 'completed', 'professional_resale', 1, 50, 50,
               '2026-03-15T10:00:00.000Z', '2026-03-15T10:00:00.000Z')`
    ).run();
    createManualBoost(db, { start_date: '2026-03-10T00:00:00.000Z', boost_type: 'listing', amount_ttc: 10 });
    const s = buildProfitabilitySummary(db, 2026, 1);
    expect(s.caUrssaf).toBe(50);
    expect(s.boostsTotal).toBe(10);
    expect(s.margeReelleEstimee).toBe(50 - 10);
  });

  it('personal sales are reported separately (not in caUrssaf)', () => {
    db.prepare(
      `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable,
                          amount_received, sale_date)
       VALUES ('manual', 'P', 'completed', 'personal_item', 0, 30, '2026-03-15T10:00:00.000Z')`
    ).run();
    const s = buildProfitabilitySummary(db, 2026, 1);
    expect(s.caUrssaf).toBe(0);
    expect(s.personalSalesAmount).toBe(30);
  });

  it('colis perdu indemnisé contributes to CA and profitability', () => {
    db.prepare(
      `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable,
                          declarable_amount, amount_received, purchase_cost_total,
                          sale_date, declared_encashment_date)
       VALUES ('vinteer', 'LOST-1', 'colis_perdu', 'professional_resale', 1, 18, 18, 5,
               '2026-05-01T10:00:00.000Z', '2026-05-01T10:00:00.000Z')`
    ).run();
    const s = buildProfitabilitySummary(db, 2026, 2);
    expect(s.caUrssaf).toBe(18);
    expect(s.margeBrute).toBe(13);
  });

  it('COGS uses linked stock cost when present', () => {
    const { id: stockId } = createStockManual(db, { name: 'X', quantity: 1, origin: 'brocante', unit_cost_ttc: 5 });
    db.prepare(
      `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable,
                          declarable_amount, amount_received, linked_stock_item_id,
                          sale_date, declared_encashment_date)
       VALUES ('manual', 'A', 'completed', 'professional_resale', 1, 20, 20, ?,
               '2026-03-15T10:00:00.000Z', '2026-03-15T10:00:00.000Z')`
    ).run(stockId);
    const s = buildProfitabilitySummary(db, 2026, 1);
    expect(s.cogs).toBe(5);
    expect(s.margeBrute).toBe(20 - 5);
  });
});
