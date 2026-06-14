import type { DeclarationPeriod, QuarterCode } from '../../../shared/types';

/**
 * Standard URSSAF quarterly periods for vente de marchandises (BIC).
 *
 * Q1: 01/01 → 31/03   échéance 30/04
 * Q2: 01/04 → 30/06   échéance 31/07
 * Q3: 01/07 → 30/09   échéance 31/10
 * Q4: 01/10 → 31/12   échéance 31/01 (N+1)
 */
export function quarterPeriod(year: number, quarter: QuarterCode): DeclarationPeriod {
  switch (quarter) {
    case 1: return { year, quarter: 1, periodStart: `${year}-01-01`, periodEnd: `${year}-03-31`, dueDate: `${year}-04-30` };
    case 2: return { year, quarter: 2, periodStart: `${year}-04-01`, periodEnd: `${year}-06-30`, dueDate: `${year}-07-31` };
    case 3: return { year, quarter: 3, periodStart: `${year}-07-01`, periodEnd: `${year}-09-30`, dueDate: `${year}-10-31` };
    case 4: return { year, quarter: 4, periodStart: `${year}-10-01`, periodEnd: `${year}-12-31`, dueDate: `${year + 1}-01-31` };
  }
}

export function allQuartersFor(year: number): DeclarationPeriod[] {
  return [1, 2, 3, 4].map((q) => quarterPeriod(year, q as QuarterCode));
}

export function quarterForDate(iso: string): QuarterCode {
  const m = Number(iso.slice(5, 7));
  if (m <= 3) return 1;
  if (m <= 6) return 2;
  if (m <= 9) return 3;
  return 4;
}

export function nextDueDate(today: Date = new Date()): DeclarationPeriod | null {
  const todayIso = today.toISOString().slice(0, 10);
  const candidates = [...allQuartersFor(today.getUTCFullYear()), ...allQuartersFor(today.getUTCFullYear() + 1)];
  for (const c of candidates) if (c.dueDate >= todayIso) return c;
  return null;
}

function frDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/**
 * Compute the effective period + due date for a quarter, taking into account
 * the first declaration of a micro-entreprise.
 *
 * Rule (URSSAF official, simplified):
 *  - Activity start month → identifies the start quarter (Qs).
 *  - The FIRST declaration covers Qs PLUS the next quarter (Qs+1), due on the
 *    standard due date of (Qs+1). Excepted edge cases (start in Q4 → first
 *    declaration is Q4 alone due 31/01 N+1).
 *
 * For the user's case: start 09/03/2026 → Qs=Q1 → first declaration combines
 *    Q1 + Q2, due 31/07/2026.
 *
 * Implementation:
 *  - For year == activity_start_year:
 *      Q1 with start in Q1 → label "Q1 N — activité commencée le X", periodStart=activity_start, dueDate=31/07
 *      Q2 with start in Q1 → label "Q2 N — inclus dans la première déclaration", periodStart=01/04, dueDate=31/07
 *      Qs alone (start in Q2/Q3/Q4): use start as period start, due as standard
 *  - For year > activity_start_year: standard quarterly.
 */
export interface EffectivePeriod extends DeclarationPeriod {
  rawPeriodStart: string;
  rawDueDate: string;
  isFirstDeclaration: boolean;
  isInsideFirstDeclaration: boolean; // true for Q2 when start is in Q1
  firstDeclarationLabel: string | null;
  activityStartDate: string | null;
}

export function effectivePeriod(
  year: number,
  quarter: QuarterCode,
  activityStartDate: string | null
): EffectivePeriod {
  const raw = quarterPeriod(year, quarter);
  const base: EffectivePeriod = {
    ...raw,
    rawPeriodStart: raw.periodStart,
    rawDueDate: raw.dueDate,
    isFirstDeclaration: false,
    isInsideFirstDeclaration: false,
    firstDeclarationLabel: null,
    activityStartDate
  };

  if (!activityStartDate) return base;
  const start = activityStartDate.slice(0, 10);
  const startYear = Number(start.slice(0, 4));
  const startMonth = Number(start.slice(5, 7));
  const startQuarter: QuarterCode = startMonth <= 3 ? 1 : startMonth <= 6 ? 2 : startMonth <= 9 ? 3 : 4;

  if (year !== startYear) return base;
  if (quarter < startQuarter) {
    // Quarter is before activity start → effectively empty (label informational)
    return { ...base, firstDeclarationLabel: `Avant début d'activité (commencée le ${frDate(start)})` };
  }

  // For year == startYear:
  // - If start in Q1/Q2/Q3 and this is Qs → first declaration with combined Qs+Qs+1.
  // - If start in Q4 → first declaration is Q4 alone, due 31/01 N+1 (no combine).
  if (quarter === startQuarter) {
    if (startQuarter <= 3) {
      const next = quarterPeriod(year, (startQuarter + 1) as QuarterCode);
      return {
        ...base,
        periodStart: start,
        dueDate: next.dueDate,
        isFirstDeclaration: true,
        firstDeclarationLabel: `Q${quarter} ${year} — activité commencée le ${frDate(start)} • Première déclaration combine Q${quarter}+Q${startQuarter + 1}, échéance ${frDate(next.dueDate)}`
      };
    }
    // Q4: alone
    return {
      ...base,
      periodStart: start,
      isFirstDeclaration: true,
      firstDeclarationLabel: `Q${quarter} ${year} — activité commencée le ${frDate(start)}`
    };
  }

  if (quarter === startQuarter + 1 && startQuarter <= 3) {
    // Inside the combined first declaration
    const startPeriod = quarterPeriod(year, startQuarter);
    return {
      ...base,
      dueDate: raw.dueDate, // déjà la même
      isInsideFirstDeclaration: true,
      firstDeclarationLabel: `Q${quarter} ${year} — inclus dans la première déclaration (avec Q${startQuarter}), échéance ${frDate(raw.dueDate)}`
    };
  }

  return base;
}
