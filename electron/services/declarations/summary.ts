import type Database from 'better-sqlite3';
import { ensureSoftDeleteColumns } from '../../db/softDelete';
import { effectivePeriod } from './quarters';
import { getActivityStartDate } from '../sales/repository';
import type { DeclarationSummary, QuarterCode } from '../../../shared/types';

/**
 * Build a quarterly URSSAF summary.
 *
 * FISCAL RULES (memory/feedback_fiscal_guardrails.md):
 *  - CA = SUM(declarable_amount) WHERE urssaf_declarable=1 AND classification != 'pre_activity'
 *  - Expenses, boosts, COGS NEVER subtracted from CA.
 *  - pre_activity sales (encashment < activity_start_date) EXCLUDED from CA, listed separately.
 *  - ACRE applied PER SALE based on encashment date being within the ACRE window.
 *  - First declaration period adjusted via effectivePeriod() — activity start replaces 01/01, etc.
 */
export function buildQuarterlySummary(
  db: Database.Database,
  year: number,
  quarter: QuarterCode
): DeclarationSummary {
  ensureSoftDeleteColumns(db, ['sales', 'declarations']);
  const activityStart = getActivityStartDate(db);
  const period = effectivePeriod(year, quarter, activityStart);
  const startIso = `${period.periodStart}T00:00:00.000Z`;
  const endIso = `${period.periodEnd}T23:59:59.999Z`;

  // Included sales (professional + declarable, NOT pre_activity)
  const includedSales = db
    .prepare(
      `SELECT id, declarable_amount, declared_encashment_date
       FROM sales
       WHERE urssaf_declarable=1
         AND classification != 'pre_activity'
         AND deleted_at IS NULL
         AND declared_encashment_date IS NOT NULL
         AND declared_encashment_date >= ?
         AND declared_encashment_date <= ?`
    )
    .all(startIso, endIso) as { id: number; declarable_amount: number; declared_encashment_date: string }[];

  const caGoods = includedSales.reduce((s, r) => s + (r.declarable_amount ?? 0), 0);

  // Excluded breakdown (by sale_date or finalization_date so the user sees them in the quarter window)
  const breakdown = db
    .prepare(
      `SELECT
         SUM(CASE WHEN classification='personal_item' THEN 1 ELSE 0 END) AS personal,
         SUM(CASE WHEN classification='uncertain_to_review' THEN 1 ELSE 0 END) AS uncertain,
         SUM(CASE WHEN classification='excluded' AND status IN ('canceled','refunded') THEN 1 ELSE 0 END) AS canceled,
         SUM(CASE WHEN classification='pre_activity' THEN 1 ELSE 0 END) AS pre_activity
       FROM sales
       WHERE urssaf_declarable=0
         AND deleted_at IS NULL
         AND ((sale_date >= ? AND sale_date <= ?)
              OR (finalization_date >= ? AND finalization_date <= ?))`
    )
    .get(
      `${period.rawPeriodStart}T00:00:00.000Z`, endIso,
      `${period.rawPeriodStart}T00:00:00.000Z`, endIso
    ) as { personal: number | null; uncertain: number | null; canceled: number | null; pre_activity: number | null };

  const personalAmount = db
    .prepare(
      `SELECT COALESCE(SUM(amount_received), 0) AS total
       FROM sales
       WHERE classification='personal_item'
         AND deleted_at IS NULL
         AND ((sale_date >= ? AND sale_date <= ?) OR (finalization_date >= ? AND finalization_date <= ?))`
    )
    .get(`${period.rawPeriodStart}T00:00:00.000Z`, endIso, `${period.rawPeriodStart}T00:00:00.000Z`, endIso) as { total: number };

  const preActivityAmount = db
    .prepare(
      `SELECT COALESCE(SUM(amount_received), 0) AS total
       FROM sales
       WHERE classification='pre_activity'
         AND deleted_at IS NULL
         AND ((sale_date >= ? AND sale_date <= ?) OR (finalization_date >= ? AND finalization_date <= ?))`
    )
    .get(`${period.rawPeriodStart}T00:00:00.000Z`, endIso, `${period.rawPeriodStart}T00:00:00.000Z`, endIso) as { total: number };

  // Rates
  const activityType =
    (db.prepare(`SELECT value FROM settings WHERE key='activity_type'`).get() as { value: string } | undefined)?.value ?? 'vente_marchandises_bic';
  const rate = db
    .prepare(`SELECT normal_rate, acre_rate FROM contribution_rates WHERE year=? AND activity_type=?`)
    .get(year, activityType) as { normal_rate: number; acre_rate: number } | undefined;
  const normalRate = rate?.normal_rate ?? 0.123;
  const acreRate = rate?.acre_rate ?? 0.062;

  // ACRE window
  const acreEnabled =
    (db.prepare(`SELECT value FROM settings WHERE key='acre_enabled'`).get() as { value: string } | undefined)?.value === 'true';
  const acreStartIso =
    (db.prepare(`SELECT value FROM settings WHERE key='acre_start_date'`).get() as { value: string } | undefined)?.value ?? null;
  const acreEndIso =
    (db.prepare(`SELECT value FROM settings WHERE key='acre_end_date'`).get() as { value: string } | undefined)?.value ?? null;
  const acreStart = acreStartIso ? acreStartIso.slice(0, 10) : null;
  const acreEnd = acreEndIso ? acreEndIso.slice(0, 10) : null;

  // Per-sale ACRE: apply per-sale rate based on encashment date
  let contributionsApplied = 0;
  let salesInAcre = 0;
  for (const s of includedSales) {
    const enc = s.declared_encashment_date.slice(0, 10);
    const inAcre = !!acreEnabled
      && (!acreStart || enc >= acreStart)
      && (!acreEnd || enc <= acreEnd);
    contributionsApplied += (s.declarable_amount ?? 0) * (inAcre ? acreRate : normalRate);
    if (inAcre) salesInAcre += 1;
  }
  const acreApplied = salesInAcre > 0;
  const acreFullPeriod = acreApplied && salesInAcre === includedSales.length && includedSales.length > 0;

  const declStatusRow = db
    .prepare(`SELECT status FROM declarations WHERE year=? AND quarter=? AND deleted_at IS NULL`)
    .get(year, quarter) as { status: 'draft' | 'declared' } | undefined;

  const personalCount = breakdown.personal ?? 0;
  const uncertainCount = breakdown.uncertain ?? 0;
  const canceledCount = breakdown.canceled ?? 0;
  const preActivityCount = breakdown.pre_activity ?? 0;
  const totalExcluded = personalCount + uncertainCount + canceledCount + preActivityCount;

  return {
    year,
    quarter,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    dueDate: period.dueDate,
    rawPeriodStart: period.rawPeriodStart,
    rawDueDate: period.rawDueDate,
    caGoods,
    includedSalesCount: includedSales.length,
    excludedSalesCount: totalExcluded,
    personalSalesCount: personalCount,
    personalSalesAmount: personalAmount.total,
    uncertainSalesCount: uncertainCount,
    canceledSalesCount: canceledCount,
    preActivitySalesCount: preActivityCount,
    preActivitySalesAmount: preActivityAmount.total,
    contributionsNormal: caGoods * normalRate,
    contributionsAcre: caGoods * acreRate,
    contributionsApplied,
    acreApplied,
    acreFullPeriod,
    rateNormal: normalRate,
    rateAcre: acreRate,
    activityStartDate: activityStart,
    isFirstDeclaration: period.isFirstDeclaration,
    isInsideFirstDeclaration: period.isInsideFirstDeclaration,
    firstDeclarationLabel: period.firstDeclarationLabel,
    status: declStatusRow?.status ?? 'draft'
  };
}

export function upsertDeclarationDraft(db: Database.Database, s: DeclarationSummary): { id: number } {
  const total = s.caGoods;
  const existing = db
    .prepare(`SELECT id FROM declarations WHERE year=? AND quarter=? AND deleted_at IS NULL`)
    .get(s.year, s.quarter) as { id: number } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE declarations SET
        ca_goods=?, total_ca=?, included_sales_count=?, excluded_sales_count=?,
        estimated_contributions_normal=?, estimated_contributions_acre=?,
        period_start=?, period_end=?, due_date=?,
        updated_at=datetime('now')
       WHERE id=?`
    ).run(
      s.caGoods, total, s.includedSalesCount, s.excludedSalesCount,
      s.contributionsNormal, s.contributionsApplied,
      s.periodStart, s.periodEnd, s.dueDate,
      existing.id
    );
    return existing;
  }

  const info = db
    .prepare(
      `INSERT INTO declarations
        (year, period_type, quarter, period_start, period_end, due_date,
         ca_goods, ca_services, total_ca, included_sales_count, excluded_sales_count,
         estimated_contributions_normal, estimated_contributions_acre, status)
       VALUES (?, 'trimestrial', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'draft')`
    )
    .run(
      s.year, s.quarter,
      s.periodStart, s.periodEnd, s.dueDate,
      s.caGoods, total, s.includedSalesCount, s.excludedSalesCount,
      s.contributionsNormal, s.contributionsApplied
    );
  return { id: Number(info.lastInsertRowid) };
}
