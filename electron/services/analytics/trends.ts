import type Database from 'better-sqlite3';

export interface MonthlyTrend {
  month: string; // YYYY-MM
  caUrssaf: number;
  amountReceived: number;
  salesCount: number;
  expenses: number;
}

/** Build last N months of CA + bénéfice + expenses for the trend chart. */
export function buildMonthlyTrends(db: Database.Database, monthsBack: number = 12): MonthlyTrend[] {
  const trends: MonthlyTrend[] = [];
  const now = new Date();
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const monthStart = new Date(Date.UTC(y, m, 1)).toISOString();
    const monthEnd = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999)).toISOString();
    const monthKey = `${y}-${String(m + 1).padStart(2, '0')}`;

    const ca = (db.prepare(
      `SELECT COALESCE(SUM(declarable_amount), 0) AS v FROM sales
       WHERE urssaf_declarable=1 AND classification != 'pre_activity'
         AND deleted_at IS NULL
         AND declared_encashment_date >= ? AND declared_encashment_date <= ?`
    ).get(monthStart, monthEnd) as { v: number }).v;

    const received = (db.prepare(
      `SELECT COALESCE(SUM(amount_received), 0) AS v FROM sales
       WHERE classification IN ('professional_resale','personal_item','pre_activity')
         AND deleted_at IS NULL
         AND status IN ('completed','colis_perdu')
         AND COALESCE(declared_encashment_date, sale_date) >= ?
         AND COALESCE(declared_encashment_date, sale_date) <= ?`
    ).get(monthStart, monthEnd) as { v: number }).v;

    const count = (db.prepare(
      `SELECT COUNT(*) AS v FROM sales
       WHERE status IN ('completed','colis_perdu')
         AND deleted_at IS NULL
         AND COALESCE(declared_encashment_date, sale_date) >= ?
         AND COALESCE(declared_encashment_date, sale_date) <= ?`
    ).get(monthStart, monthEnd) as { v: number }).v;

    const exp = (db.prepare(
      `SELECT COALESCE(SUM(amount_ttc), 0) AS v FROM expenses
       WHERE deleted_at IS NULL
         AND date >= ? AND date <= ?`
    ).get(monthStart.slice(0, 10), monthEnd.slice(0, 10)) as { v: number }).v;

    trends.push({ month: monthKey, caUrssaf: ca, amountReceived: received, salesCount: count, expenses: exp });
  }
  return trends;
}
