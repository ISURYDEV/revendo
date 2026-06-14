import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migration001Initial } from '../electron/db/migrations/001_initial';
import { migration002 } from '../electron/db/migrations/002_classification_and_links';
import { migration005 } from '../electron/db/migrations/005_pre_activity_and_dedup';
import { buildFirstDeclarationSummary } from '../electron/services/declarations/firstDeclaration';
import { buildQuarterlySummary } from '../electron/services/declarations/summary';

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);`);
  migration001Initial.up(db);
  migration002.up(db);
  migration005.up(db);
  db.prepare(`INSERT INTO settings (key, value) VALUES ('activity_start_date', '2026-03-09')
              ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run();
  db.prepare(`UPDATE settings SET value='true' WHERE key='acre_enabled'`).run();
  db.prepare(`INSERT INTO settings (key, value) VALUES ('acre_start_date', '2026-03-09')`).run();
  db.prepare(`INSERT INTO settings (key, value) VALUES ('acre_end_date', '2026-12-31')`).run();
  return db;
}

function insertPro(db: Database.Database, ext: string, amount: number, date: string) {
  db.prepare(
    `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable,
                        declarable_amount, amount_received, declared_encashment_date, sale_date)
     VALUES ('vinteer', ?, 'completed', 'professional_resale', 1, ?, ?, ?, ?)`
  ).run(ext, amount, amount, `${date}T10:00:00.000Z`, `${date}T10:00:00.000Z`);
}

function insertPersonal(db: Database.Database, ext: string, amount: number, date: string) {
  db.prepare(
    `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable,
                        declarable_amount, amount_received, declared_encashment_date, sale_date)
     VALUES ('vinteer', ?, 'completed', 'personal_item', 0, 0, ?, ?, ?)`
  ).run(ext, amount, `${date}T10:00:00.000Z`, `${date}T10:00:00.000Z`);
}

function insertCanceled(db: Database.Database, ext: string, amount: number, date: string) {
  db.prepare(
    `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable,
                        declarable_amount, amount_received, declared_encashment_date, sale_date)
     VALUES ('vinteer', ?, 'canceled', 'excluded', 0, 0, ?, ?, ?)`
  ).run(ext, amount, `${date}T10:00:00.000Z`, `${date}T10:00:00.000Z`);
}

function insertPreActivity(db: Database.Database, ext: string, amount: number, date: string) {
  db.prepare(
    `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable,
                        declarable_amount, amount_received, declared_encashment_date, sale_date)
     VALUES ('vinteer', ?, 'completed', 'pre_activity', 0, 0, ?, ?, ?)`
  ).run(ext, amount, `${date}T10:00:00.000Z`, `${date}T10:00:00.000Z`);
}

describe('P0.1 — première déclaration combinée Q1+Q2', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => { db = freshDb(); });

  it('combine bien Q1 (à partir du 09/03) et Q2 en une seule déclaration', () => {
    insertPro(db, 'Q1-A', 200, '2026-03-15');
    insertPro(db, 'Q1-B', 100, '2026-03-25');
    insertPro(db, 'Q2-A', 300, '2026-04-10');
    insertPro(db, 'Q2-B', 400, '2026-06-20');

    const decl = buildFirstDeclarationSummary(db, 2026);
    expect(decl).not.toBeNull();
    expect(decl!.quarters).toEqual([1, 2]);
    expect(decl!.periodStart).toBe('2026-03-09');
    expect(decl!.periodEnd).toBe('2026-06-30');
    expect(decl!.dueDate).toBe('2026-07-31');
    expect(decl!.caGoods).toBeCloseTo(1000, 2);
    expect(decl!.includedSalesCount).toBe(4);
  });

  it("CA combiné ne déduit ni dépenses ni boosts (garde-fou fiscal)", () => {
    insertPro(db, 'A', 500, '2026-03-15');
    insertPro(db, 'B', 500, '2026-04-15');
    db.prepare(`INSERT INTO expenses (date, category, amount_ttc) VALUES ('2026-03-20', 'emballages', 80)`).run();
    db.prepare(`INSERT INTO expenses (date, category, amount_ttc) VALUES ('2026-04-20', 'emballages', 90)`).run();
    db.prepare(
      `INSERT INTO boosts (source, external_id, start_date, amount_ttc) VALUES ('vinteer', 'B1', '2026-04-01T10:00:00.000Z', 50)`
    ).run();

    const decl = buildFirstDeclarationSummary(db, 2026)!;
    expect(decl.caGoods).toBe(1000); // surtout pas 1000 - 80 - 90 - 50
  });

  it('exclut bien les ventes personnelles, annulées et pre_activity du CA combiné', () => {
    insertPro(db, 'P1', 100, '2026-03-15');
    insertPro(db, 'P2', 200, '2026-05-15');
    insertPersonal(db, 'PERS1', 30, '2026-03-15');
    insertPersonal(db, 'PERS2', 40, '2026-04-10');
    insertCanceled(db, 'CAN1', 25, '2026-03-20');
    insertCanceled(db, 'CAN2', 15, '2026-05-22');
    insertPreActivity(db, 'PRE1', 18, '2026-03-05');
    insertPreActivity(db, 'PRE2', 12, '2026-03-07');

    const decl = buildFirstDeclarationSummary(db, 2026)!;
    expect(decl.caGoods).toBe(300); // 100 + 200, rien d'autre
    expect(decl.includedSalesCount).toBe(2);
    expect(decl.personalSalesCount).toBe(2);
    expect(decl.personalSalesAmount).toBeCloseTo(70, 2);
    expect(decl.canceledSalesCount).toBe(2);
    expect(decl.preActivitySalesCount).toBe(2);
    expect(decl.preActivitySalesAmount).toBeCloseTo(30, 2);
  });

  it("renvoie null si aucune activity_start_date n'est définie", () => {
    db.prepare(`DELETE FROM settings WHERE key='activity_start_date'`).run();
    expect(buildFirstDeclarationSummary(db, 2026)).toBeNull();
  });

  it("renvoie null pour une année différente de celle du début d'activité", () => {
    expect(buildFirstDeclarationSummary(db, 2027)).toBeNull();
  });

  it("renvoie null si le début d'activité est en Q4 (pas de fusion nécessaire)", () => {
    db.prepare(`UPDATE settings SET value='2026-11-15' WHERE key='activity_start_date'`).run();
    expect(buildFirstDeclarationSummary(db, 2026)).toBeNull();
  });

  it('la somme combinée Q1+Q2 = somme des CA des deux trimestres pris séparément', () => {
    insertPro(db, 'A', 123.45, '2026-03-15');
    insertPro(db, 'B', 67.89, '2026-04-15');
    insertPro(db, 'C', 200, '2026-05-15');
    const decl = buildFirstDeclarationSummary(db, 2026)!;
    const q1 = buildQuarterlySummary(db, 2026, 1);
    const q2 = buildQuarterlySummary(db, 2026, 2);
    expect(decl.caGoods).toBeCloseTo(q1.caGoods + q2.caGoods, 2);
  });

  it('expose isInsideFirstDeclaration sur Q2 quand activité commence en Q1', () => {
    const q2 = buildQuarterlySummary(db, 2026, 2);
    expect(q2.isInsideFirstDeclaration).toBe(true);
    const q1 = buildQuarterlySummary(db, 2026, 1);
    expect(q1.isFirstDeclaration).toBe(true);
  });
});
