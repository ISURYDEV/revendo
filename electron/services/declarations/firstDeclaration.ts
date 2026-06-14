import type Database from 'better-sqlite3';
import { buildQuarterlySummary } from './summary';
import { getActivityStartDate } from '../sales/repository';
import type { CombinedFirstDeclaration, DeclarationSummary, QuarterCode } from '../../../shared/types';

/**
 * P0.1 — Construit le récapitulatif UNIFIÉ de la première déclaration URSSAF
 * lorsqu'elle combine plusieurs trimestres (Qs + Qs+1).
 *
 * GARDE-FOUS FISCAUX (memory/feedback_fiscal_guardrails.md) :
 *  - caGoods = somme des declarable_amount des trimestres combinés
 *    (urssaf_declarable=1, hors pre_activity), JAMAIS de déduction de dépenses,
 *    boosts ou COGS.
 *  - Ventes personnelles hors activité, annulées et remboursées exclues du CA.
 *  - Si l'activité commence en Q4, la première déclaration n'a qu'un trimestre :
 *    on ne fusionne pas et on renvoie null.
 *  - Si l'activité commence dans une autre année, on renvoie null aussi.
 *
 * Renvoie `null` quand aucune fusion ne s'applique pour `year` ;
 * dans ce cas l'UI doit afficher les 4 cards trimestrielles classiques.
 */
export function buildFirstDeclarationSummary(
  db: Database.Database,
  year: number
): CombinedFirstDeclaration | null {
  const activityStart = getActivityStartDate(db);
  if (!activityStart) return null;
  const startYear = Number(activityStart.slice(0, 4));
  if (year !== startYear) return null;

  const startMonth = Number(activityStart.slice(5, 7));
  const startQuarter: QuarterCode = startMonth <= 3 ? 1 : startMonth <= 6 ? 2 : startMonth <= 9 ? 3 : 4;

  // Q4 : la première déclaration n'a qu'un seul trimestre, échéance 31/01 N+1.
  // Pas de fusion nécessaire — l'UI affiche la card Q4 standard.
  if (startQuarter === 4) return null;

  const qs: QuarterCode[] = [startQuarter, (startQuarter + 1) as QuarterCode];
  const summaries: DeclarationSummary[] = qs.map((q) => buildQuarterlySummary(db, year, q));

  // Sanity : on n'utilise la combinaison que si Qs est bien la première déclaration
  // et Qs+1 est marqué « inclus dans la première déclaration ».
  const first = summaries[0];
  const next = summaries[1];
  if (!first.isFirstDeclaration || !next.isInsideFirstDeclaration) return null;

  const caGoods = summaries.reduce((s, q) => s + q.caGoods, 0);
  const includedSalesCount = summaries.reduce((s, q) => s + q.includedSalesCount, 0);
  const excludedSalesCount = summaries.reduce((s, q) => s + q.excludedSalesCount, 0);
  const personalSalesCount = summaries.reduce((s, q) => s + q.personalSalesCount, 0);
  const personalSalesAmount = summaries.reduce((s, q) => s + q.personalSalesAmount, 0);
  const uncertainSalesCount = summaries.reduce((s, q) => s + q.uncertainSalesCount, 0);
  const canceledSalesCount = summaries.reduce((s, q) => s + q.canceledSalesCount, 0);
  const preActivitySalesCount = summaries.reduce((s, q) => s + q.preActivitySalesCount, 0);
  const preActivitySalesAmount = summaries.reduce((s, q) => s + q.preActivitySalesAmount, 0);
  const contributionsNormal = summaries.reduce((s, q) => s + q.contributionsNormal, 0);
  const contributionsAcre = summaries.reduce((s, q) => s + q.contributionsAcre, 0);
  const contributionsApplied = summaries.reduce((s, q) => s + q.contributionsApplied, 0);

  const acreApplied = summaries.some((q) => q.acreApplied);
  const acreFullPeriod = summaries.every((q) => q.acreFullPeriod);

  // Tous les trimestres combinés doivent être marqués comme déclarés pour
  // considérer la première déclaration comme déclarée.
  const status: 'draft' | 'declared' = summaries.every((q) => q.status === 'declared')
    ? 'declared'
    : 'draft';

  return {
    year,
    quarters: qs,
    periodStart: first.periodStart,
    periodEnd: next.periodEnd,
    dueDate: first.dueDate,
    activityStartDate: activityStart,
    caGoods,
    includedSalesCount,
    excludedSalesCount,
    personalSalesCount,
    personalSalesAmount,
    uncertainSalesCount,
    canceledSalesCount,
    preActivitySalesCount,
    preActivitySalesAmount,
    contributionsNormal,
    contributionsAcre,
    contributionsApplied,
    acreApplied,
    acreFullPeriod,
    rateNormal: first.rateNormal,
    rateAcre: first.rateAcre,
    status,
    firstDeclarationLabel: first.firstDeclarationLabel,
    perQuarter: summaries
  };
}
