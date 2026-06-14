import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migration001Initial } from '../electron/db/migrations/001_initial';
import { migration002 } from '../electron/db/migrations/002_classification_and_links';
import { createStockManual } from '../electron/services/stock/repository';
import { buildProfitabilitySummary } from '../electron/services/profitability/calculator';

describe('rentabilité COGS quantité', () => {
  it('calcule le coût stock comme coût unitaire × quantité vendue', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);`);
    migration001Initial.up(db);
    migration002.up(db);
    const { id } = createStockManual(db, { name: 'Lot WhatNot', quantity: 3, origin: 'compra_whatnot', unit_cost_ttc: 10 });
    db.prepare(`
      INSERT INTO sales (source, external_id, status, classification, urssaf_declarable, declarable_amount, amount_received, quantity, linked_stock_item_id, sale_date, declared_encashment_date)
      VALUES ('manual', 'LOT-1', 'completed', 'professional_resale', 1, 50, 50, 3, ?, '2026-03-15T10:00:00.000Z', '2026-03-15T10:00:00.000Z')
    `).run(id);
    const summary = buildProfitabilitySummary(db, 2026, 1);
    expect(summary.cogs).toBe(30);
    expect(summary.margeBrute).toBe(20);
  });
});
