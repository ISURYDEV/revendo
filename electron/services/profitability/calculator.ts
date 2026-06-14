import type Database from 'better-sqlite3';
import { ensureSoftDeleteColumns } from '../../db/softDelete';
import type { ProfitabilitySummary, QuarterCode } from '../../../shared/types';

interface PeriodBounds {
  start: string;
  end: string;
  label: string;
}

function bounds(year: number, quarter?: QuarterCode | 'all'): PeriodBounds {
  if (!quarter || quarter === 'all') {
    return {
      start: `${year}-01-01T00:00:00.000Z`,
      end: `${year}-12-31T23:59:59.999Z`,
      label: String(year)
    };
  }
  const ranges = {
    1: [`${year}-01-01`, `${year}-03-31`],
    2: [`${year}-04-01`, `${year}-06-30`],
    3: [`${year}-07-01`, `${year}-09-30`],
    4: [`${year}-10-01`, `${year}-12-31`]
  } as const;
  const [s, e] = ranges[quarter];
  return { start: `${s}T00:00:00.000Z`, end: `${e}T23:59:59.999Z`, label: `${year}-Q${quarter}` };
}

/**
 * Build a profitability summary for a period.
 *
 * GUARDRAIL (memory/feedback_fiscal_guardrails.md):
 *  - caUrssaf = SUM(declarable_amount) WHERE urssaf_declarable=1 (NO expense subtraction).
 *  - Profitability is internal estimation only — explicitly different from CA URSSAF.
 *  - personalSalesAmount is shown for info only, never mixed into the professional figures.
 */
export function buildProfitabilitySummary(
  db: Database.Database,
  year: number,
  quarter?: QuarterCode | 'all'
): ProfitabilitySummary {
  ensureSoftDeleteColumns(db, ['sales', 'stock_items', 'boosts', 'expenses']);
  const p = bounds(year, quarter);

  // Pro CA — encashed in period (URSSAF fiscal CA, exclut tout ce qui n'est pas déclarable)
  const caRow = db
    .prepare(
      `SELECT COALESCE(SUM(declarable_amount), 0) AS ca
       FROM sales
       WHERE urssaf_declarable=1
         AND deleted_at IS NULL
         AND declared_encashment_date >= ? AND declared_encashment_date <= ?`
    )
    .get(p.start, p.end) as { ca: number };

  // Pro sales gross (regardless of encash date) — by sale_date in period
  const caGrossRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount_received), 0) AS gross
       FROM sales
       WHERE classification='professional_resale'
         AND deleted_at IS NULL
         AND sale_date >= ? AND sale_date <= ?`
    )
    .get(p.start, p.end) as { gross: number };

  // Argent réellement reçu pour TOUTES les ventes encaissées (complétées + colis perdus indemnisés).
  // L'argent est dans la poche → entre dans le bénéfice net.
  // EXCLU: ventes annulées, remboursées, en expédition, à revoir (hors encaissement).
  const moneyKeptRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount_received), 0) AS total
       FROM sales
       WHERE classification IN ('professional_resale', 'personal_item', 'pre_activity')
         AND deleted_at IS NULL
         AND status IN ('completed','colis_perdu')
         AND COALESCE(amount_received, 0) > 0
         AND COALESCE(declared_encashment_date, sale_date) >= ?
         AND COALESCE(declared_encashment_date, sale_date) <= ?`
    )
    .get(p.start, p.end) as { total: number };

  // Personal sales (hors activité, info only)
  const personalRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount_received), 0) AS total
       FROM sales
       WHERE classification='personal_item'
         AND deleted_at IS NULL
         AND sale_date >= ? AND sale_date <= ?`
    )
    .get(p.start, p.end) as { total: number };

  // P1.4 — COGS sur ventes liées à un stock avec FALLBACK :
  //   1) si stock_items.unit_cost_ttc > 0 → unit_cost_ttc × quantity (cas normal)
  //   2) sinon si sales.purchase_cost_total > 0 → on utilise le coût Vinteer brut
  //   3) sinon → 0 ET la vente est comptée comme "coût manquant"
  // Le CA URSSAF n'est jamais impacté ; seule la rentabilité interne change.
  const cogsLinked = db
    .prepare(
      `SELECT COALESCE(SUM(
         CASE
           WHEN COALESCE(si.unit_cost_ttc, 0) > 0
             THEN si.unit_cost_ttc * COALESCE(s.quantity, 1)
           WHEN COALESCE(s.purchase_cost_total, 0) > 0
             THEN s.purchase_cost_total
           ELSE 0
         END
       ), 0) AS cogs
       FROM sales s
       JOIN stock_items si ON si.id = s.linked_stock_item_id AND si.deleted_at IS NULL
       WHERE s.classification IN ('professional_resale', 'personal_item', 'pre_activity')
         AND s.deleted_at IS NULL
         AND s.status IN ('completed','colis_perdu')
         AND s.sale_date >= ? AND s.sale_date <= ?`
    )
    .get(p.start, p.end) as { cogs: number };

  // Comptage des ventes liées à un stock SANS coût utilisable (ni unit_cost
  // ni purchase_cost_total). Permet d'afficher un avertissement « Coût manquant ».
  const missingCostRow = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM sales s
       JOIN stock_items si ON si.id = s.linked_stock_item_id AND si.deleted_at IS NULL
       WHERE s.classification IN ('professional_resale', 'personal_item', 'pre_activity')
         AND s.deleted_at IS NULL
         AND s.status IN ('completed','colis_perdu')
         AND s.sale_date >= ? AND s.sale_date <= ?
         AND COALESCE(si.unit_cost_ttc, 0) <= 0
         AND COALESCE(s.purchase_cost_total, 0) <= 0`
    )
    .get(p.start, p.end) as { n: number };

  // COGS estimé via purchase_cost_total quand AUCUN stock n'est lié.
  const cogsUnlinked = db
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(purchase_cost_total, 0)), 0) AS cogs
       FROM sales
       WHERE classification IN ('professional_resale', 'personal_item', 'pre_activity')
         AND deleted_at IS NULL
         AND status IN ('completed','colis_perdu')
         AND linked_stock_item_id IS NULL
         AND sale_date >= ? AND sale_date <= ?`
    )
    .get(p.start, p.end) as { cogs: number };

  // Boosts in the period (TTC, franchise en base default)
  const boostsRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount_ttc), 0) AS total,
              SUM(CASE WHEN allocation_targets IS NULL OR allocation_targets='[]' OR allocation_targets='' THEN amount_ttc ELSE 0 END) AS unlinked
       FROM boosts
       WHERE deleted_at IS NULL
         AND start_date >= ? AND start_date <= ?`
    )
    .get(p.start, p.end) as { total: number; unlinked: number };

  // "Autres dépenses" : EXCLUT category='boost_marketing' pour éviter le double comptage
  // (les boosts CSV créent des lignes dans `boosts` ET dans `expenses` avec cette catégorie).
  // La ligne "Boosts marketing" est calculée séparément depuis la table `boosts`.
  const expensesRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount_ttc), 0) AS total,
              SUM(CASE WHEN linked_sale_id IS NULL AND linked_purchase_id IS NULL
                            AND linked_stock_item_id IS NULL AND linked_boost_id IS NULL
                       THEN amount_ttc ELSE 0 END) AS unlinked
       FROM expenses
       WHERE deleted_at IS NULL
         AND date >= ? AND date <= ?
         AND category != 'boost_marketing'`
    )
    .get(p.start.slice(0, 10), p.end.slice(0, 10)) as { total: number; unlinked: number };

  // Par catégorie: on garde TOUTES les catégories pour le tableau visuel (info), mais
  // l'affichage côté UI doit comprendre que boost_marketing n'est PAS dans expensesTotal.
  const expensesByCategory = db
    .prepare(
      `SELECT category, COALESCE(SUM(amount_ttc), 0) AS total
       FROM expenses
       WHERE deleted_at IS NULL
         AND date >= ? AND date <= ?
       GROUP BY category ORDER BY total DESC`
    )
    .all(p.start.slice(0, 10), p.end.slice(0, 10)) as { category: string; total: number }[];

  // P1.4 — Top/Loss products avec le même fallback de COGS.
  const cogsExpr = `(CASE
       WHEN COALESCE(si.unit_cost_ttc, 0) > 0
         THEN si.unit_cost_ttc * COALESCE(s.quantity, 1)
       WHEN COALESCE(s.purchase_cost_total, 0) > 0
         THEN s.purchase_cost_total
       ELSE 0
     END)`;
  const topProducts = db
    .prepare(
      `SELECT
         s.article_name AS name,
         COALESCE(SUM(s.amount_received), 0) AS ca,
         COALESCE(SUM(${cogsExpr}), 0) AS cogs,
         COALESCE(SUM(s.amount_received) - SUM(${cogsExpr}), 0) AS margin
       FROM sales s
       LEFT JOIN stock_items si ON si.id = s.linked_stock_item_id AND si.deleted_at IS NULL
       WHERE s.classification='professional_resale'
         AND s.deleted_at IS NULL
         AND s.sale_date >= ? AND s.sale_date <= ?
       GROUP BY s.article_name
       ORDER BY margin DESC
       LIMIT 10`
    )
    .all(p.start, p.end) as { name: string; ca: number; cogs: number; margin: number }[];

  const lossProducts = db
    .prepare(
      `SELECT
         s.article_name AS name,
         COALESCE(SUM(s.amount_received), 0) AS ca,
         COALESCE(SUM(${cogsExpr}), 0) AS cogs,
         COALESCE(SUM(s.amount_received) - SUM(${cogsExpr}), 0) AS margin
       FROM sales s
       LEFT JOIN stock_items si ON si.id = s.linked_stock_item_id AND si.deleted_at IS NULL
       WHERE s.classification='professional_resale'
         AND s.deleted_at IS NULL
         AND s.sale_date >= ? AND s.sale_date <= ?
       GROUP BY s.article_name
       HAVING margin < 0
       ORDER BY margin ASC
       LIMIT 10`
    )
    .all(p.start, p.end) as { name: string; ca: number; cogs: number; margin: number }[];

  const byPlatform = db
    .prepare(
      `SELECT COALESCE(platform, 'inconnu') AS platform,
              COALESCE(SUM(amount_received), 0) AS ca,
              COUNT(*) AS sales
       FROM sales
       WHERE classification='professional_resale'
         AND deleted_at IS NULL
         AND sale_date >= ? AND sale_date <= ?
       GROUP BY platform
       ORDER BY ca DESC`
    )
    .all(p.start, p.end) as { platform: string; ca: number; sales: number }[];

  const caUrssafFiscal = caRow.ca;
  const caKept = moneyKeptRow.total;
  const cogsTotal = cogsLinked.cogs + cogsUnlinked.cogs;
  // Use ACTUAL money received (caKept) for profit calc, not CA URSSAF.
  // This includes lost packages where Vinted reimbursed the seller via insurance.
  const margeBrute = caKept - cogsTotal;
  const margeReelleEstimee = caKept - cogsTotal - boostsRow.total - expensesRow.total;

  return {
    periodLabel: p.label,
    caUrssaf: caUrssafFiscal,
    caProfessionalAllSales: caGrossRow.gross,
    caKeptActual: caKept,
    personalSalesAmount: personalRow.total,
    cogs: cogsLinked.cogs,
    cogsUnlinked: cogsUnlinked.cogs,
    missingCostSalesCount: missingCostRow.n ?? 0,
    boostsTotal: boostsRow.total,
    expensesTotal: expensesRow.total,
    expensesByCategory,
    margeBrute,
    margeReelleEstimee,
    topProducts,
    lossProducts,
    byPlatform,
    boostsUnlinked: boostsRow.unlinked ?? 0,
    expensesUnlinked: expensesRow.unlinked ?? 0
  };
}
