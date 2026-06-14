import { ipcMain } from 'electron';
import { getDb } from '../db/connection';
import { IPC } from '../../shared/ipc';
import { buildQuarterlySummary } from '../services/declarations/summary';
import { nextDueDate } from '../services/declarations/quarters';
import { getStockOverview } from '../services/stock/repository';
import { buildDashboardFigures, markWeeklyCheck, type DashboardRange } from '../services/dashboard/overview';
import type { QuarterCode } from '../../shared/types';

/**
 * P1.5 — Handlers IPC du domaine « Tableau de bord ».
 * Comportement et canaux IPC INCHANGÉS.
 */
export function registerDashboardIpc(): void {
  ipcMain.handle(IPC.DASHBOARD_OVERVIEW, () => {
    const db = getDb();
    const year = new Date().getUTCFullYear();
    const quarters = ([1, 2, 3, 4] as QuarterCode[]).map((q) => buildQuarterlySummary(db, year, q));

    const sales = db
      .prepare(
        `SELECT
           SUM(CASE WHEN urssaf_declarable=1 THEN 1 ELSE 0 END) AS pro,
           SUM(CASE WHEN classification='personal_item' THEN 1 ELSE 0 END) AS personal,
           SUM(CASE WHEN classification='uncertain_to_review' THEN 1 ELSE 0 END) AS uncertain,
           SUM(CASE WHEN classification='excluded' THEN 1 ELSE 0 END) AS excluded,
           COUNT(*) AS total
         FROM sales
         WHERE deleted_at IS NULL`
      ).get() as Record<string, number>;

    const stock = getStockOverview(db).counts;

    const now = new Date();
    const monthStart = `${now.toISOString().slice(0, 7)}-01`;
    const expensesMonth = (db.prepare(`SELECT COALESCE(SUM(amount_ttc), 0) AS total FROM expenses WHERE deleted_at IS NULL AND date >= ?`).get(monthStart) as { total: number }).total;
    const boostsMonth = (db.prepare(`SELECT COALESCE(SUM(amount_ttc), 0) AS total FROM boosts WHERE deleted_at IS NULL AND start_date >= ?`).get(`${monthStart}T00:00:00.000Z`) as { total: number }).total;

    return { year, quarters, sales, stock, expensesMonth, boostsMonth, nextDue: nextDueDate() };
  });

  ipcMain.handle(IPC.DASHBOARD_FIGURES, (_e, range: DashboardRange) => buildDashboardFigures(getDb(), range));
  ipcMain.handle(IPC.DASHBOARD_MARK_CHECK, (_e, kinds: { sales?: boolean; purchases?: boolean; expenses?: boolean }) => markWeeklyCheck(getDb(), kinds));
}
