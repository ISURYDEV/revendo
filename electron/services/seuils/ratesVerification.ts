import type Database from 'better-sqlite3';
import type { RatesVerificationStatus } from '../../../shared/types';

/**
 * P0.3 — Vérification annuelle des taux URSSAF / ACRE.
 *
 * Les taux sont éditables mais doivent être validés manuellement chaque année
 * sur autoentrepreneur.urssaf.fr. Tant que l'utilisateur n'a pas confirmé qu'il
 * a vérifié les taux pour l'année en cours, un bandeau orange s'affiche dans
 * Dashboard et Déclarations.
 *
 * Les valeurs des taux NE SONT JAMAIS modifiées automatiquement.
 * Aucune requête réseau n'est effectuée.
 */

function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare(`SELECT value FROM settings WHERE key=?`).get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).run(key, value);
}

function getActivityType(db: Database.Database): string {
  return getSetting(db, 'activity_type') ?? 'vente_marchandises_bic';
}

function ratesPresent(db: Database.Database, year: number, activityType: string): boolean {
  const row = db
    .prepare(
      `SELECT normal_rate, acre_rate FROM contribution_rates WHERE year=? AND activity_type=?`
    )
    .get(year, activityType) as { normal_rate: number; acre_rate: number } | undefined;
  return !!row;
}

export function getRatesVerificationStatus(
  db: Database.Database,
  currentYearOverride?: number
): RatesVerificationStatus {
  const currentYear = currentYearOverride ?? new Date().getUTCFullYear();
  const activityType = getActivityType(db);
  const present = ratesPresent(db, currentYear, activityType);

  const lastYearRaw = getSetting(db, 'rates_verified_year');
  const lastVerifiedYear = lastYearRaw != null && /^\d+$/.test(lastYearRaw) ? Number(lastYearRaw) : null;
  const lastVerifiedAt = getSetting(db, 'rates_verified_at');

  let reason: RatesVerificationStatus['reason'];
  let needsVerification: boolean;

  if (!present) {
    needsVerification = true;
    reason = 'rates_missing';
  } else if (lastVerifiedYear == null) {
    needsVerification = true;
    reason = 'never_verified';
  } else if (lastVerifiedYear < currentYear) {
    needsVerification = true;
    reason = 'year_changed';
  } else {
    needsVerification = false;
    reason = 'up_to_date';
  }

  return {
    needsVerification,
    currentYear,
    lastVerifiedYear,
    lastVerifiedAt,
    ratesPresent: present,
    reason
  };
}

export function markRatesVerified(
  db: Database.Database,
  currentYearOverride?: number
): { ok: true; year: number; verifiedAt: string } {
  const year = currentYearOverride ?? new Date().getUTCFullYear();
  const verifiedAt = new Date().toISOString();
  setSetting(db, 'rates_verified_year', String(year));
  setSetting(db, 'rates_verified_at', verifiedAt);
  return { ok: true, year, verifiedAt };
}
