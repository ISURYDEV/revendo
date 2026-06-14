import type Database from 'better-sqlite3';
import { effectivePeriod } from '../declarations/quarters';
import { getActivityStartDate } from '../sales/repository';
import type { QuarterCode } from '../../../shared/types';

export interface QuarterPrediction {
  year: number;
  quarter: QuarterCode;
  periodStart: string;
  periodEnd: string;
  caSoFar: number;                  // CA URSSAF déjà encaissé dans le trimestre
  daysElapsed: number;              // jours déjà passés dans le trimestre
  daysRemaining: number;            // jours restants
  daysTotal: number;
  caProjectedEndOfQuarter: number;  // projection linéaire
  cotisationsProjected: number;     // projection de cotisations
  confidenceLabel: 'low' | 'medium' | 'high';
}

/**
 * Linear projection of CA URSSAF for current quarter end, based on pace so far.
 * Confidence: based on how many days have elapsed.
 */
export function predictCurrentQuarter(db: Database.Database): QuarterPrediction | null {
  const activityStart = getActivityStartDate(db);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const q = (m <= 3 ? 1 : m <= 6 ? 2 : m <= 9 ? 3 : 4) as QuarterCode;

  const period = effectivePeriod(y, q, activityStart);
  const start = period.periodStart;
  const end = period.periodEnd;
  if (today < start || today > end) return null;

  const caSoFarRow = db.prepare(
    `SELECT COALESCE(SUM(declarable_amount), 0) AS v FROM sales
     WHERE urssaf_declarable=1 AND classification != 'pre_activity'
       AND deleted_at IS NULL
       AND declared_encashment_date >= ? AND declared_encashment_date <= ?`
  ).get(`${start}T00:00:00.000Z`, `${end}T23:59:59.999Z`) as { v: number };

  const dayMs = 24 * 60 * 60 * 1000;
  const daysTotal = Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / dayMs) + 1);
  const daysElapsed = Math.max(1, Math.round((Date.now() - new Date(start).getTime()) / dayMs));
  const daysRemaining = Math.max(0, daysTotal - daysElapsed);
  const dailyRate = caSoFarRow.v / daysElapsed;
  const projected = caSoFarRow.v + dailyRate * daysRemaining;

  // Use applicable rate (ACRE check simplified: use ACRE rate if ACRE is enabled)
  const activityType = (db.prepare(`SELECT value FROM settings WHERE key='activity_type'`).get() as { value: string } | undefined)?.value ?? 'vente_marchandises_bic';
  const rate = db.prepare(`SELECT normal_rate, acre_rate FROM contribution_rates WHERE year=? AND activity_type=?`).get(y, activityType) as { normal_rate: number; acre_rate: number } | undefined;
  const acreEnabled = (db.prepare(`SELECT value FROM settings WHERE key='acre_enabled'`).get() as { value: string } | undefined)?.value === 'true';
  const cotisationsProjected = projected * (acreEnabled ? rate?.acre_rate ?? 0.062 : rate?.normal_rate ?? 0.123);

  const confidence: 'low' | 'medium' | 'high' =
    daysElapsed < daysTotal * 0.25 ? 'low' :
    daysElapsed < daysTotal * 0.66 ? 'medium' : 'high';

  return {
    year: y, quarter: q,
    periodStart: start, periodEnd: end,
    caSoFar: caSoFarRow.v,
    daysElapsed, daysRemaining, daysTotal,
    caProjectedEndOfQuarter: projected,
    cotisationsProjected,
    confidenceLabel: confidence
  };
}
