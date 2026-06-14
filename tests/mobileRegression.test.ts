/**
 * Regression tests : importing mobile actions must NOT alter URSSAF CA logic,
 * partial stock logic, or break the action-only audit trail.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migration001Initial } from '../electron/db/migrations/001_initial';
import { migration002 } from '../electron/db/migrations/002_classification_and_links';
import { migration003 } from '../electron/db/migrations/003_audit_log';
import { migration005 } from '../electron/db/migrations/005_pre_activity_and_dedup';
import { migration009 } from '../electron/db/migrations/009_usability_phase2';
import { migration010 } from '../electron/db/migrations/010_marketplace_scaling';
import { migration011 } from '../electron/db/migrations/011_document_stock_automation';
import { migration012 } from '../electron/db/migrations/012_security_sync_mobile_future';
import { migration015 } from '../electron/db/migrations/015_mobile_action_imports';
import { applyMobileActions } from '../electron/services/mobile/actionImporter';
import { buildQuarterlySummary } from '../electron/services/declarations/summary';
import { createStockManual } from '../electron/services/stock/repository';
import { MOBILE_ACTIONS_SCHEMA_VERSION, newLocalActionId } from '../shared/mobile';

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);`);
  migration001Initial.up(db);
  migration002.up(db);
  migration003.up(db);
  migration005.up(db);
  migration009.up(db);
  migration010.up(db);
  migration011.up(db);
  migration012.up(db);
  migration015.up(db);
  return db;
}

function insertSale(db: Database.Database) {
  db.prepare(
    `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable, declarable_amount,
                        amount_received, sale_date, declared_encashment_date)
     VALUES ('vinteer', ?, 'completed', 'professional_resale', 1, 18, 18,
             '2026-03-15T10:00:00.000Z', '2026-03-15T10:00:00.000Z')`
  ).run('S-pro-1');
}

describe('mobile regression', () => {
  let db: Database.Database;
  let tmp: string;
  beforeEach(() => {
    db = freshDb();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'revendo-reg-'));
  });

  it("l'import d'une dépense mobile NE change PAS le CA URSSAF du trimestre", () => {
    insertSale(db);
    const before = buildQuarterlySummary(db, 2026, 1);
    expect(before.caGoods).toBe(18);

    const bundle = {
      schema_version: MOBILE_ACTIONS_SCHEMA_VERSION,
      generated_at: '2026-05-28T10:00:00.000Z',
      actions: [{
        id: newLocalActionId(),
        schema_version: MOBILE_ACTIONS_SCHEMA_VERSION,
        source: 'mobile' as const,
        status: 'pending' as const,
        created_at: '2026-05-28T10:00:00.000Z',
        type: 'add_expense' as const,
        payload: { date: '2026-03-20', category: 'emballages', amount_ttc: 50 }
      }]
    };
    const fp = path.join(tmp, 'a.json');
    fs.writeFileSync(fp, JSON.stringify(bundle), 'utf-8');
    const r = applyMobileActions(db, fp);
    expect(r.applied).toBe(1);

    const after = buildQuarterlySummary(db, 2026, 1);
    expect(after.caGoods).toBe(18); // identique
    expect(after.includedSalesCount).toBe(1);
  });

  it("mouvement partiel mobile préserve quantité restante (pas d'écrasement)", () => {
    const created = createStockManual(db, {
      name: 'Stock partiel', quantity: 5, origin: 'compra_vinted', unit_cost_ttc: 6
    });
    const bundle = {
      schema_version: MOBILE_ACTIONS_SCHEMA_VERSION,
      generated_at: '2026-05-28T10:00:00.000Z',
      actions: [{
        id: newLocalActionId(),
        schema_version: MOBILE_ACTIONS_SCHEMA_VERSION,
        source: 'mobile' as const,
        status: 'pending' as const,
        created_at: '2026-05-28T10:00:00.000Z',
        type: 'add_stock_movement' as const,
        payload: { stock_item_id: created.id, movement_type: 'OUT_SOLD' as const, quantity: 2 }
      }]
    };
    const fp = path.join(tmp, 'b.json');
    fs.writeFileSync(fp, JSON.stringify(bundle), 'utf-8');
    applyMobileActions(db, fp);

    const item = db.prepare(`SELECT quantity, status FROM stock_items WHERE id=?`).get(created.id) as { quantity: number; status: string };
    expect(item.quantity).toBe(3);
    // Status doit rester en in_stock car la sortie est partielle
    expect(item.status).toBe('in_stock');

    const moves = db.prepare(`SELECT movement_type, quantity FROM stock_movements WHERE stock_item_id=? ORDER BY id`).all(created.id) as Array<{ movement_type: string; quantity: number }>;
    // 1 mouvement IN_PURCHASE initial + 1 OUT_SOLD partiel
    expect(moves.some((m) => m.movement_type === 'OUT_SOLD' && m.quantity === 2)).toBe(true);
  });
});
