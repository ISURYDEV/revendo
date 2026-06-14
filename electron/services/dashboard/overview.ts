import type Database from 'better-sqlite3';

export type DashboardRange = 'this_month' | 'last_month' | 'all_time';

export interface DashboardFigures {
  range: DashboardRange;
  caTotal: number;            // Sum of declarable_amount for professional sales in range
  profitNet: number;          // amount_received - linked stock cost - expenses (rough)
  salesCompleted: number;
  packagesInTransit: number;
  cancellations: number;
  lastCheckedSales: string | null;
  lastCheckedPurchases: string | null;
  lastCheckedExpenses: string | null;
  daysSinceSales: number | null;
  daysSincePurchases: number | null;
  daysSinceExpenses: number | null;
}

function rangeBounds(range: DashboardRange): { start: string; end: string } {
  const now = new Date();
  if (range === 'all_time') {
    return { start: '1970-01-01T00:00:00.000Z', end: '2999-12-31T23:59:59.999Z' };
  }
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (range === 'this_month') {
    const start = new Date(Date.UTC(y, m, 1)).toISOString();
    const end = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999)).toISOString();
    return { start, end };
  }
  // last_month
  const start = new Date(Date.UTC(y, m - 1, 1)).toISOString();
  const end = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)).toISOString();
  return { start, end };
}

export function buildDashboardFigures(db: Database.Database, range: DashboardRange): DashboardFigures {
  const { start, end } = rangeBounds(range);

  // CA URSSAF (fiscal — uniquement déclarable, exclut annulées/remboursées)
  const ca = (db.prepare(
    `SELECT COALESCE(SUM(declarable_amount), 0) AS ca
     FROM sales WHERE urssaf_declarable=1 AND classification != 'pre_activity'
       AND deleted_at IS NULL
       AND declared_encashment_date >= ? AND declared_encashment_date <= ?`
  ).get(start, end) as { ca: number }).ca;

  // Argent réellement reçu pour TOUTES les ventes encaissées (pro + personnel + pre_activity).
  // L'argent entre dans le bénéfice net, MÊME si exclu du CA URSSAF.
  // EXCLU: annulées, remboursées, en expédition, à revoir.
  const caKept = (db.prepare(
    `SELECT COALESCE(SUM(amount_received), 0) AS total
     FROM sales
     WHERE classification IN ('professional_resale', 'personal_item', 'pre_activity')
       AND deleted_at IS NULL
       AND status IN ('completed','colis_perdu')
       AND COALESCE(amount_received, 0) > 0
       AND COALESCE(declared_encashment_date, sale_date) >= ?
       AND COALESCE(declared_encashment_date, sale_date) <= ?`
  ).get(start, end) as { total: number }).total;

  // COGS: coût des articles vendus pour toutes les ventes encaissées contribuant au bénéfice
  const cogsRow = db.prepare(
    `SELECT COALESCE(SUM(si.unit_cost_ttc), 0) AS cogs
     FROM sales s LEFT JOIN stock_items si ON si.id = s.linked_stock_item_id AND si.deleted_at IS NULL
     WHERE s.classification IN ('professional_resale', 'personal_item', 'pre_activity')
       AND s.deleted_at IS NULL
       AND s.status IN ('completed','colis_perdu')
       AND s.linked_stock_item_id IS NOT NULL
       AND COALESCE(s.declared_encashment_date, s.sale_date) >= ?
       AND COALESCE(s.declared_encashment_date, s.sale_date) <= ?`
  ).get(start, end) as { cogs: number };

  const cogsFallback = db.prepare(
    `SELECT COALESCE(SUM(COALESCE(purchase_cost_total, 0)), 0) AS cogs
     FROM sales
     WHERE classification IN ('professional_resale', 'personal_item', 'pre_activity')
       AND deleted_at IS NULL
       AND status IN ('completed','colis_perdu')
       AND linked_stock_item_id IS NULL
       AND COALESCE(declared_encashment_date, sale_date) >= ?
       AND COALESCE(declared_encashment_date, sale_date) <= ?`
  ).get(start, end) as { cogs: number };

  // Dépenses : exclut category='boost_marketing' pour ne pas double-compter
  // (la table boosts contient déjà les boosts; les CSV de boosts créent les deux).
  const expensesRow = db.prepare(
    `SELECT COALESCE(SUM(amount_ttc), 0) AS total
     FROM expenses
     WHERE deleted_at IS NULL
       AND date >= ? AND date <= ?
       AND category != 'boost_marketing'`
  ).get(start.slice(0, 10), end.slice(0, 10)) as { total: number };

  // Boosts depuis la table boosts (source unique pour cet usage)
  const boostsRow = db.prepare(
    `SELECT COALESCE(SUM(amount_ttc), 0) AS total
     FROM boosts WHERE deleted_at IS NULL AND start_date >= ? AND start_date <= ?`
  ).get(start, end) as { total: number };

  // Bénéfice net = argent réellement reçu - COGS - boosts - autres dépenses (sans boost_marketing)
  const profitNet = caKept - cogsRow.cogs - cogsFallback.cogs - boostsRow.total - expensesRow.total;

  // Package status
  const salesCompleted = (db.prepare(
    `SELECT COUNT(*) AS n FROM sales WHERE status IN ('completed','colis_perdu')
       AND deleted_at IS NULL
       AND COALESCE(sale_date, finalization_date) >= ? AND COALESCE(sale_date, finalization_date) <= ?`
  ).get(start, end) as { n: number }).n;

  const packagesInTransit = (db.prepare(
    `SELECT COUNT(*) AS n FROM sales WHERE status IN ('shipped', 'processing')
       AND deleted_at IS NULL
       AND COALESCE(sale_date, finalization_date) >= ? AND COALESCE(sale_date, finalization_date) <= ?`
  ).get(start, end) as { n: number }).n;

  const cancellations = (db.prepare(
    `SELECT COUNT(*) AS n FROM sales WHERE status IN ('canceled', 'refunded')
       AND deleted_at IS NULL
       AND COALESCE(sale_date, finalization_date) >= ? AND COALESCE(sale_date, finalization_date) <= ?`
  ).get(start, end) as { n: number }).n;

  // Weekly check timestamps
  const get = (key: string) => (db.prepare(`SELECT value FROM settings WHERE key=?`).get(key) as { value: string } | undefined)?.value ?? null;
  const lastSales = get('last_check_sales');
  const lastPurchases = get('last_check_purchases');
  const lastExpenses = get('last_check_expenses');

  const days = (iso: string | null): number | null => {
    if (!iso) return null;
    return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
  };

  return {
    range, caTotal: ca, profitNet,
    salesCompleted, packagesInTransit, cancellations,
    lastCheckedSales: lastSales, lastCheckedPurchases: lastPurchases, lastCheckedExpenses: lastExpenses,
    daysSinceSales: days(lastSales), daysSincePurchases: days(lastPurchases), daysSinceExpenses: days(lastExpenses)
  };
}

export function markWeeklyCheck(db: Database.Database, kinds: { sales?: boolean; purchases?: boolean; expenses?: boolean }): { ok: true } {
  const now = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  );
  if (kinds.sales) upsert.run('last_check_sales', now);
  if (kinds.purchases) upsert.run('last_check_purchases', now);
  if (kinds.expenses) upsert.run('last_check_expenses', now);
  return { ok: true };
}
