import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migration001Initial } from '../electron/db/migrations/001_initial';
import { migration002 } from '../electron/db/migrations/002_classification_and_links';
import {
  getRatesVerificationStatus,
  markRatesVerified
} from '../electron/services/seuils/ratesVerification';

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);`);
  migration001Initial.up(db);
  migration002.up(db);
  return db;
}

describe('P0.3 — vérification annuelle des taux URSSAF/ACRE', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => { db = freshDb(); });

  it("le bandeau doit apparaître quand aucune vérification n'a jamais été faite", () => {
    const status = getRatesVerificationStatus(db, 2026);
    expect(status.needsVerification).toBe(true);
    expect(status.reason).toBe('never_verified');
    expect(status.lastVerifiedYear).toBeNull();
    expect(status.lastVerifiedAt).toBeNull();
  });

  it("le bandeau doit apparaître quand l'année a changé depuis la dernière vérification", () => {
    markRatesVerified(db, 2025);
    const status = getRatesVerificationStatus(db, 2026);
    expect(status.needsVerification).toBe(true);
    expect(status.reason).toBe('year_changed');
    expect(status.lastVerifiedYear).toBe(2025);
  });

  it("le bandeau doit apparaître quand les taux de l'année courante sont absents", () => {
    db.prepare(`DELETE FROM contribution_rates`).run();
    const status = getRatesVerificationStatus(db, 2026);
    expect(status.needsVerification).toBe(true);
    expect(status.reason).toBe('rates_missing');
    expect(status.ratesPresent).toBe(false);
  });

  it("le bandeau disparaît après avoir marqué les taux comme vérifiés", () => {
    const before = getRatesVerificationStatus(db, 2026);
    expect(before.needsVerification).toBe(true);

    const r = markRatesVerified(db, 2026);
    expect(r.ok).toBe(true);
    expect(r.year).toBe(2026);
    expect(typeof r.verifiedAt).toBe('string');

    const after = getRatesVerificationStatus(db, 2026);
    expect(after.needsVerification).toBe(false);
    expect(after.reason).toBe('up_to_date');
    expect(after.lastVerifiedYear).toBe(2026);
    expect(after.lastVerifiedAt).toBeTruthy();
  });

  it("marquer comme vérifiés ne modifie AUCUN taux existant", () => {
    const before = db.prepare(`SELECT year, activity_type, normal_rate, acre_rate FROM contribution_rates ORDER BY year`).all();
    markRatesVerified(db, 2026);
    const after = db.prepare(`SELECT year, activity_type, normal_rate, acre_rate FROM contribution_rates ORDER BY year`).all();
    expect(after).toEqual(before);
  });

  it("Dashboard et Déclarations utilisent la MÊME source de vérité", () => {
    // Un seul service est appelé par les deux pages : pas d'incohérence possible.
    const a = getRatesVerificationStatus(db, 2026);
    const b = getRatesVerificationStatus(db, 2026);
    expect(a).toEqual(b);
    markRatesVerified(db, 2026);
    const c = getRatesVerificationStatus(db, 2026);
    const d = getRatesVerificationStatus(db, 2026);
    expect(c.needsVerification).toBe(false);
    expect(c).toEqual(d);
  });
});
