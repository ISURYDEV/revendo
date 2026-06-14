import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { migration001Initial } from '../electron/db/migrations/001_initial';
import { migration002 } from '../electron/db/migrations/002_classification_and_links';
import { buildQuarterlySummary } from '../electron/services/declarations/summary';
import { exportLivreRecettes } from '../electron/services/declarations/exportRecettes';
import { exportLivreRecettesXlsx } from '../electron/services/excel/livreRecettesXlsx';

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);`);
  migration001Initial.up(db);
  migration002.up(db);
  return db;
}

describe('buildQuarterlySummary with classification', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => { db = freshDb(); });

  it('returns zero CA when no sales', () => {
    const s = buildQuarterlySummary(db, 2026, 1);
    expect(s.caGoods).toBe(0);
    expect(s.includedSalesCount).toBe(0);
    expect(s.personalSalesCount).toBe(0);
  });

  it('only sums professional+declarable in CA, excludes personal_item', () => {
    const ins = db.prepare(
      `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable, declarable_amount,
                          amount_received, sale_date, declared_encashment_date)
       VALUES ('vinteer', ?, 'completed', ?, ?, ?, ?, ?, ?)`
    );
    // Professional
    ins.run('P1', 'professional_resale', 1, 18, 18, '2026-03-15T10:00:00.000Z', '2026-03-15T10:00:00.000Z');
    ins.run('P2', 'professional_resale', 1, 12.5, 12.5, '2026-03-20T10:00:00.000Z', '2026-03-20T10:00:00.000Z');
    // Personal (excluded)
    ins.run('Pers1', 'personal_item', 0, 0, 22, '2026-03-15T10:00:00.000Z', '2026-03-15T10:00:00.000Z');
    ins.run('Pers2', 'personal_item', 0, 0, 8, '2026-03-22T10:00:00.000Z', '2026-03-22T10:00:00.000Z');
    // Q2 — not in scope
    ins.run('Q2', 'professional_resale', 1, 100, 100, '2026-04-05T10:00:00.000Z', '2026-04-05T10:00:00.000Z');

    const s = buildQuarterlySummary(db, 2026, 1);
    expect(s.caGoods).toBeCloseTo(30.5);
    expect(s.includedSalesCount).toBe(2);
    expect(s.personalSalesCount).toBe(2);
    expect(s.personalSalesAmount).toBeCloseTo(30);
  });

  it('includes colis perdu indemnisé when it is declarable', () => {
    db.prepare(
      `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable,
                          declarable_amount, amount_received, sale_date, declared_encashment_date)
       VALUES ('vinteer', 'LOST-1', 'colis_perdu', 'professional_resale', 1, 18, 18,
               '2026-05-01T10:00:00.000Z', '2026-05-01T10:00:00.000Z')`
    ).run();
    const s = buildQuarterlySummary(db, 2026, 2);
    expect(s.caGoods).toBe(18);
    expect(s.includedSalesCount).toBe(1);
  });

  it('counts canceled/refunded separately', () => {
    const ins = db.prepare(
      `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable, sale_date)
       VALUES ('vinteer', ?, ?, 'excluded', 0, '2026-03-15T10:00:00.000Z')`
    );
    ins.run('C1', 'canceled');
    ins.run('C2', 'refunded');
    const s = buildQuarterlySummary(db, 2026, 1);
    expect(s.canceledSalesCount).toBe(2);
    expect(s.caGoods).toBe(0);
  });

  it('marks uncertain ones in uncertainSalesCount', () => {
    db.prepare(
      `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable, sale_date)
       VALUES ('manual', 'U1', 'completed', 'uncertain_to_review', 0, '2026-03-15T10:00:00.000Z')`
    ).run();
    const s = buildQuarterlySummary(db, 2026, 1);
    expect(s.uncertainSalesCount).toBe(1);
    expect(s.caGoods).toBe(0);
  });

  it('FISCAL GUARDRAIL: expenses, boosts, COGS do NOT reduce CA', () => {
    db.prepare(
      `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable,
                          declarable_amount, amount_received, purchase_cost_total,
                          sale_date, declared_encashment_date)
       VALUES ('vinteer', 'A1', 'completed', 'professional_resale', 1, 100, 100, 80,
               '2026-03-15T10:00:00.000Z', '2026-03-15T10:00:00.000Z')`
    ).run();
    db.prepare(`INSERT INTO expenses (date, category, amount_ttc) VALUES ('2026-03-15', 'emballages', 50)`).run();
    db.prepare(
      `INSERT INTO boosts (source, external_id, start_date, amount_ttc)
       VALUES ('vinteer', 'B1', '2026-03-15T10:00:00.000Z', 20)`
    ).run();
    const s = buildQuarterlySummary(db, 2026, 1);
    expect(s.caGoods).toBe(100); // NOT 100 - 80 - 50 - 20
  });

  it('ACRE rate applied if window covers period end', () => {
    db.prepare(`UPDATE settings SET value='true' WHERE key='acre_enabled'`).run();
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('acre_start_date', '2026-01-01T00:00:00.000Z'),
                                                ('acre_end_date',   '2026-12-31T00:00:00.000Z')`
    ).run();
    db.prepare(
      `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable,
                          declarable_amount, declared_encashment_date)
       VALUES ('vinteer', 'A1', 'completed', 'professional_resale', 1, 1000, '2026-03-15T10:00:00.000Z')`
    ).run();
    const s = buildQuarterlySummary(db, 2026, 1);
    expect(s.acreApplied).toBe(true);
    expect(s.contributionsAcre).toBeCloseTo(62);   // 1000 * 0.062
    expect(s.contributionsNormal).toBeCloseTo(123); // 1000 * 0.123
  });
});

describe('first declaration scenario (user real case: début 09/03/2026, ACRE)', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => {
    db = freshDb();
    // Setup user's exact context
    db.prepare(`INSERT INTO settings (key, value) VALUES ('activity_start_date', '2026-03-09')
                ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run();
    db.prepare(`UPDATE settings SET value='true' WHERE key='acre_enabled'`).run();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('acre_start_date', '2026-03-09')`).run();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('acre_end_date', '2026-12-31')`).run();
  });

  it('excludes encashments before 09/03/2026 from CA URSSAF', () => {
    // 6 ventes avant le 09/03 totalisant 70.70 €
    const before = [
      { ext: 'A1', date: '2026-03-05', amt: 8.00 },
      { ext: 'A2', date: '2026-03-05', amt: 18.00 },
      { ext: 'A3', date: '2026-03-07', amt: 12.50 },
      { ext: 'A4', date: '2026-03-07', amt: 10.20 },
      { ext: 'A5', date: '2026-03-08', amt: 12.00 },
      { ext: 'A6', date: '2026-03-08', amt: 10.00 }
    ];
    // 55 ventes >= 09/03 totalisant 832.60 €
    for (let i = 0; i < 55; i += 1) {
      const d = '2026-03-15';
      db.prepare(
        `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable, declarable_amount,
                            amount_received, declared_encashment_date, sale_date)
         VALUES ('vinteer', ?, 'completed', 'professional_resale', 1, ?, ?, ?, ?)`
      ).run(`S${i}`, 832.60 / 55, 832.60 / 55, `${d}T10:00:00.000Z`, `${d}T10:00:00.000Z`);
    }
    for (const v of before) {
      db.prepare(
        `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable, declarable_amount,
                            amount_received, declared_encashment_date, sale_date)
         VALUES ('vinteer', ?, 'completed', 'pre_activity', 0, 0, ?, ?, ?)`
      ).run(v.ext, v.amt, `${v.date}T10:00:00.000Z`, `${v.date}T10:00:00.000Z`);
    }

    const s = buildQuarterlySummary(db, 2026, 1);
    expect(s.caGoods).toBeCloseTo(832.60, 2);
    expect(s.includedSalesCount).toBe(55);
    expect(s.preActivitySalesCount).toBe(6);
    expect(s.preActivitySalesAmount).toBeCloseTo(70.70, 2);
  });

  it('uses ACRE rate 6.2% per sale when in ACRE window', () => {
    db.prepare(
      `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable, declarable_amount,
                          amount_received, declared_encashment_date, sale_date)
       VALUES ('vinteer', 'X', 'completed', 'professional_resale', 1, 832.60, 832.60,
               '2026-03-15T10:00:00.000Z', '2026-03-15T10:00:00.000Z')`
    ).run();
    const s = buildQuarterlySummary(db, 2026, 1);
    expect(s.acreApplied).toBe(true);
    expect(s.contributionsApplied).toBeCloseTo(832.60 * 0.062, 2); // ≈ 51.62 €
  });

  it('first declaration Q1 → due date = 31/07 (combined Q1+Q2)', () => {
    const s = buildQuarterlySummary(db, 2026, 1);
    expect(s.isFirstDeclaration).toBe(true);
    expect(s.dueDate).toBe('2026-07-31');
    expect(s.rawDueDate).toBe('2026-04-30'); // standard Q1 due date
    expect(s.periodStart).toBe('2026-03-09'); // overridden to activity start
    expect(s.firstDeclarationLabel).toMatch(/Première déclaration combine Q1\+Q2/);
  });

  it('Q2 2026 is marked as inside-first-declaration', () => {
    const s = buildQuarterlySummary(db, 2026, 2);
    expect(s.isFirstDeclaration).toBe(false);
    // periodStart remains 01/04 (Q2 start), but due is 31/07 (same as Q1's combined due)
    expect(s.periodStart).toBe('2026-04-01');
    expect(s.dueDate).toBe('2026-07-31');
  });

  it('Q3 2026 is back to standard (no first-declaration override)', () => {
    const s = buildQuarterlySummary(db, 2026, 3);
    expect(s.isFirstDeclaration).toBe(false);
    expect(s.periodStart).toBe('2026-07-01');
    expect(s.dueDate).toBe('2026-10-31');
  });

  it('CSV livre des recettes uses the effective first-declaration period', () => {
    db.prepare(
      `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable, declarable_amount,
                          amount_received, declared_encashment_date, sale_date)
       VALUES ('manual', 'IN', 'completed', 'professional_resale', 1, 100, 100,
               '2026-03-15T10:00:00.000Z', '2026-03-15T10:00:00.000Z')`
    ).run();
    db.prepare(
      `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable, declarable_amount,
                          amount_received, declared_encashment_date, sale_date)
       VALUES ('manual', 'PRE', 'completed', 'pre_activity', 0, 0, 20,
               '2026-03-05T10:00:00.000Z', '2026-03-05T10:00:00.000Z')`
    ).run();

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revendo-recettes-'));
    const out = exportLivreRecettes(db, 2026, 1, dir);
    const csv = fs.readFileSync(out.path, 'utf-8');
    expect(out.rowCount).toBe(1);
    expect(csv).toContain('Période effective;09/03/2026;31/03/2026;Échéance;31/07/2026');
    expect(csv).not.toContain('01/01/2026');
    expect(csv).not.toContain('30/04/2026');
  });

  it('Excel livre des recettes uses the effective first-declaration period', async () => {
    db.prepare(
      `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable, declarable_amount,
                          amount_received, declared_encashment_date, sale_date)
       VALUES ('manual', 'IN', 'completed', 'professional_resale', 1, 100, 100,
               '2026-03-15T10:00:00.000Z', '2026-03-15T10:00:00.000Z')`
    ).run();

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revendo-recettes-xlsx-'));
    const file = path.join(dir, 'livre.xlsx');
    const out = await exportLivreRecettesXlsx(db, 2026, 1, file);
    expect(out.rowCount).toBe(1);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(out.path);
    const ws = wb.getWorksheet(1)!;
    expect(String(ws.getCell('A1').value)).toContain('Revendo');
    expect(String(ws.getCell('A2').value)).toContain('09/03/2026 → 31/03/2026');
    expect(String(ws.getCell('A2').value)).toContain('31/07/2026');
    expect(String(ws.getCell('A2').value)).not.toContain('01/01/2026');
  });
});

describe('per-sale ACRE rate vs partial window', () => {
  it('applies ACRE rate only to sales inside window, normal rate otherwise', () => {
    const db = freshDb();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('activity_start_date', '2026-03-09')`).run();
    db.prepare(`UPDATE settings SET value='true' WHERE key='acre_enabled'`).run();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('acre_start_date', '2026-03-09')`).run();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('acre_end_date', '2026-12-31')`).run();

    // Sale in ACRE window (Q4 2026)
    db.prepare(
      `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable, declarable_amount,
                          amount_received, declared_encashment_date, sale_date)
       VALUES ('manual', 'A', 'completed', 'professional_resale', 1, 100, 100,
               '2026-12-15T00:00:00.000Z', '2026-12-15T00:00:00.000Z')`
    ).run();
    // Sale outside ACRE window (Q1 2027)
    db.prepare(
      `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable, declarable_amount,
                          amount_received, declared_encashment_date, sale_date)
       VALUES ('manual', 'B', 'completed', 'professional_resale', 1, 100, 100,
               '2027-01-15T00:00:00.000Z', '2027-01-15T00:00:00.000Z')`
    ).run();
    // Add 2027 contribution rates
    db.prepare(`INSERT INTO contribution_rates (year, activity_type, normal_rate, acre_rate, versement_liberatoire_rate, notes)
                VALUES (2027, 'vente_marchandises_bic', 0.123, 0.062, 0.01, 'test')`).run();

    const sQ4 = buildQuarterlySummary(db, 2026, 4);
    expect(sQ4.contributionsApplied).toBeCloseTo(100 * 0.062, 2);

    const sQ1_2027 = buildQuarterlySummary(db, 2027, 1);
    expect(sQ1_2027.acreApplied).toBe(false);
    expect(sQ1_2027.contributionsApplied).toBeCloseTo(100 * 0.123, 2);
  });
});

describe('migration 002 backfill', () => {
  it('classifies pre-existing sales correctly', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);`);
    migration001Initial.up(db);

    // Insert legacy sales BEFORE migration 002 runs
    db.prepare(
      `INSERT INTO sales (source, external_id, status, sku, declarable_amount, amount_received, is_declarable)
       VALUES ('vinteer', 'A', 'completed', 'SULLICO-1', 18, 18, 1)`
    ).run();
    db.prepare(
      `INSERT INTO sales (source, external_id, status, sku, declarable_amount, amount_received, is_declarable)
       VALUES ('vinteer', 'B', 'completed', NULL, 22, 22, 1)`
    ).run();
    db.prepare(
      `INSERT INTO sales (source, external_id, status, sku, is_declarable)
       VALUES ('vinteer', 'C', 'canceled', NULL, 0)`
    ).run();

    migration002.up(db);

    const a = db.prepare(`SELECT * FROM sales WHERE external_id='A'`).get() as Record<string, unknown>;
    const b = db.prepare(`SELECT * FROM sales WHERE external_id='B'`).get() as Record<string, unknown>;
    const c = db.prepare(`SELECT * FROM sales WHERE external_id='C'`).get() as Record<string, unknown>;

    expect(a.classification).toBe('professional_resale');
    expect(a.urssaf_declarable).toBe(1);
    expect(b.classification).toBe('personal_item');
    expect(b.urssaf_declarable).toBe(0);
    expect(c.classification).toBe('excluded');
    expect(c.urssaf_declarable).toBe(0);
  });
});
