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
import { applyMobileActions, previewMobileActions } from '../electron/services/mobile/actionImporter';
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

function writeBundle(actions: unknown[], tmpDir: string, name = 'actions.json'): string {
  const bundle = {
    schema_version: MOBILE_ACTIONS_SCHEMA_VERSION,
    generated_at: '2026-05-28T10:00:00.000Z',
    device: 'mobile_test',
    actions
  };
  const fp = path.join(tmpDir, name);
  fs.writeFileSync(fp, JSON.stringify(bundle), 'utf-8');
  return fp;
}

function baseAction() {
  return {
    id: newLocalActionId(),
    schema_version: MOBILE_ACTIONS_SCHEMA_VERSION,
    source: 'mobile',
    status: 'pending',
    created_at: '2026-05-28T10:00:00.000Z',
    device: 'mobile_test'
  };
}

describe('mobile actions desktop import', () => {
  let db: Database.Database;
  let tmp: string;
  beforeEach(() => {
    db = freshDb();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'revendo-actions-'));
  });

  it('preview liste actions et valide les payloads', () => {
    const fp = writeBundle([
      { ...baseAction(), type: 'add_expense', payload: { date: '2026-05-28', category: 'emballages', amount_ttc: 5 } },
      { ...baseAction(), type: 'add_expense', payload: { date: '2026-05-28', category: 'emballages', amount_ttc: -1 } }
    ], tmp);
    const preview = previewMobileActions(db, fp);
    expect(preview.total).toBe(2);
    expect(preview.validCount).toBe(1);
    expect(preview.invalidCount).toBe(1);
  });

  it('applique un add_expense et marque source=mobile', () => {
    const fp = writeBundle([
      { ...baseAction(), type: 'add_expense', payload: { date: '2026-05-28', category: 'emballages', amount_ttc: 12.5 } }
    ], tmp);
    const r = applyMobileActions(db, fp);
    expect(r.applied).toBe(1);
    expect(r.rejected).toBe(0);
    const row = db.prepare(`SELECT amount_ttc, category, source FROM expenses ORDER BY id DESC LIMIT 1`).get() as any;
    expect(row.amount_ttc).toBe(12.5);
    expect(row.category).toBe('emballages');
    expect(row.source).toBe('mobile');
  });

  it('applique un add_stock_item nouveau', () => {
    const fp = writeBundle([
      {
        ...baseAction(), type: 'add_stock_item',
        payload: { name: 'Pull mobile', quantity: 2, origin: 'compra_vinted', unit_cost_ttc: 5 }
      }
    ], tmp);
    const r = applyMobileActions(db, fp);
    expect(r.applied).toBe(1);
    const row = db.prepare(`SELECT name, quantity, source FROM stock_items WHERE name='Pull mobile'`).get() as any;
    expect(row.quantity).toBe(2);
  });

  it('applique un mouvement de stock partiel et met à jour quantity', () => {
    const created = createStockManual(db, {
      name: 'Pull existant', quantity: 5, origin: 'compra_vinted', unit_cost_ttc: 4
    });
    const fp = writeBundle([
      {
        ...baseAction(), type: 'add_stock_movement',
        payload: { stock_item_id: created.id, movement_type: 'OUT_SOLD', quantity: 2 }
      }
    ], tmp);
    const r = applyMobileActions(db, fp);
    expect(r.applied).toBe(1);
    const after = db.prepare(`SELECT quantity FROM stock_items WHERE id=?`).get(created.id) as { quantity: number };
    expect(after.quantity).toBe(3);
  });

  it("refuse stock négatif", () => {
    const created = createStockManual(db, {
      name: 'Petit stock', quantity: 1, origin: 'compra_vinted', unit_cost_ttc: 4
    });
    const fp = writeBundle([
      {
        ...baseAction(), type: 'add_stock_movement',
        payload: { stock_item_id: created.id, movement_type: 'OUT_SOLD', quantity: 5 }
      }
    ], tmp);
    const r = applyMobileActions(db, fp);
    expect(r.applied).toBe(0);
    expect(r.rejected).toBe(1);
    const after = db.prepare(`SELECT quantity FROM stock_items WHERE id=?`).get(created.id) as { quantity: number };
    expect(after.quantity).toBe(1); // unchanged
  });

  it("refuse de réimporter le même fichier", () => {
    const fp = writeBundle([
      { ...baseAction(), type: 'add_expense', payload: { date: '2026-05-28', category: 'emballages', amount_ttc: 1 } }
    ], tmp, 'once.json');
    applyMobileActions(db, fp);
    expect(() => applyMobileActions(db, fp)).toThrow(/déjà été importé/i);
  });

  it("audit dans mobile_action_imports avec compte applied/rejected", () => {
    const fp = writeBundle([
      { ...baseAction(), type: 'add_expense', payload: { date: '2026-05-28', category: 'emballages', amount_ttc: 5 } },
      { ...baseAction(), type: 'add_expense', payload: { date: '2026-05-28', category: 'emballages', amount_ttc: -1 } }
    ], tmp);
    applyMobileActions(db, fp);
    const audit = db.prepare(`SELECT total, applied, rejected FROM mobile_action_imports`).get() as { total: number; applied: number; rejected: number };
    expect(audit.total).toBe(2);
    expect(audit.applied).toBe(1);
    expect(audit.rejected).toBe(1);
  });

  it('rejette schema_version incompatible', () => {
    const fp = path.join(tmp, 'bad.json');
    fs.writeFileSync(fp, JSON.stringify({
      schema_version: 'revendo-mobile-actions-v0',
      generated_at: '2026-05-28T10:00:00.000Z',
      actions: []
    }), 'utf-8');
    expect(() => previewMobileActions(db, fp)).toThrow();
  });
});
