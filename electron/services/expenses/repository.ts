import type Database from 'better-sqlite3';
import type { Expense, ExpenseCategory } from '../../../shared/types';

export function listExpenses(
  db: Database.Database,
  filters: {
    year?: number;
    quarter?: 1 | 2 | 3 | 4;
    month?: number; // 1-12
    category?: string;
    supplier?: string;
    withDoc?: 'all' | 'with' | 'without';
    limit?: number;
    offset?: number;
  } = {}
): Expense[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.year && filters.quarter) {
    const { start, end } = quarterBounds(filters.year, filters.quarter);
    where.push('date >= ? AND date <= ?');
    params.push(start, end);
  } else if (filters.year && filters.month) {
    const m = String(filters.month).padStart(2, '0');
    where.push('date >= ? AND date <= ?');
    params.push(`${filters.year}-${m}-01`, `${filters.year}-${m}-31`);
  } else if (filters.year) {
    where.push('date >= ? AND date <= ?');
    params.push(`${filters.year}-01-01`, `${filters.year}-12-31`);
  }
  if (filters.category) {
    where.push('category=?');
    params.push(filters.category);
  }
  if (filters.supplier) {
    where.push('supplier LIKE ?');
    params.push(`%${filters.supplier}%`);
  }
  if (filters.withDoc === 'with') {
    where.push(`EXISTS (SELECT 1 FROM document_links dl WHERE dl.entity_type='expense' AND dl.entity_id=expenses.id)`);
  } else if (filters.withDoc === 'without') {
    where.push(`NOT EXISTS (SELECT 1 FROM document_links dl WHERE dl.entity_type='expense' AND dl.entity_id=expenses.id)`);
  }
  const sql = `SELECT * FROM expenses ${
    where.length ? 'WHERE deleted_at IS NULL AND ' + where.join(' AND ') : 'WHERE deleted_at IS NULL'
  } ORDER BY date DESC LIMIT ? OFFSET ?`;
  params.push(filters.limit ?? 500, filters.offset ?? 0);
  return db.prepare(sql).all(...params) as Expense[];
}

function quarterBounds(year: number, q: 1 | 2 | 3 | 4): { start: string; end: string } {
  switch (q) {
    case 1: return { start: `${year}-01-01`, end: `${year}-03-31` };
    case 2: return { start: `${year}-04-01`, end: `${year}-06-30` };
    case 3: return { start: `${year}-07-01`, end: `${year}-09-30` };
    case 4: return { start: `${year}-10-01`, end: `${year}-12-31` };
  }
}

export function createExpense(
  db: Database.Database,
  payload: {
    date: string;
    category: ExpenseCategory | string;
    supplier?: string | null;
    platform?: string | null;
    description?: string | null;
    amount_ttc: number;
    amount_ht?: number | null;
    vat_amount?: number | null;
    vat_deductible?: number;
    payment_method?: string | null;
    linked_sale_id?: number | null;
    linked_purchase_id?: number | null;
    linked_stock_item_id?: number | null;
    linked_boost_id?: number | null;
    notes?: string | null;
  }
): { id: number } {
  // Safety: in franchise en base, force vat_deductible=0 by default.
  const vatRegime =
    (db.prepare(`SELECT value FROM settings WHERE key='vat_regime'`).get() as
      | { value: string }
      | undefined)?.value ?? 'franchise_en_base';
  const vatDeductible =
    vatRegime === 'franchise_en_base' ? 0 : payload.vat_deductible ?? 0;

  const info = db
    .prepare(
      `INSERT INTO expenses (
         source, date, category, supplier, platform, description,
         amount_ttc, amount_ht, vat_amount, vat_deductible, payment_method,
         linked_sale_id, linked_purchase_id, linked_stock_item_id, linked_boost_id, notes
       ) VALUES ('manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      payload.date,
      payload.category,
      payload.supplier ?? null,
      payload.platform ?? null,
      payload.description ?? null,
      payload.amount_ttc,
      payload.amount_ht ?? null,
      payload.vat_amount ?? null,
      vatDeductible,
      payload.payment_method ?? null,
      payload.linked_sale_id ?? null,
      payload.linked_purchase_id ?? null,
      payload.linked_stock_item_id ?? null,
      payload.linked_boost_id ?? null,
      payload.notes ?? null
    );
  return { id: Number(info.lastInsertRowid) };
}

export function updateExpense(
  db: Database.Database,
  id: number,
  patch: Partial<{
    date: string;
    category: string;
    supplier: string | null;
    platform: string | null;
    description: string | null;
    amount_ttc: number;
    vat_deductible: number;
    payment_method: string | null;
    notes: string | null;
  }>
): { ok: true } {
  const fields: string[] = [];
  const params: unknown[] = [];
  for (const k of Object.keys(patch) as (keyof typeof patch)[]) {
    fields.push(`${k}=?`);
    params.push(patch[k]);
  }
  if (fields.length === 0) return { ok: true };
  fields.push(`updated_at=datetime('now')`);
  params.push(id);
  db.prepare(`UPDATE expenses SET ${fields.join(', ')} WHERE id=?`).run(...params);
  return { ok: true };
}

export function deleteExpense(db: Database.Database, id: number): { ok: true } {
  db.prepare('DELETE FROM expenses WHERE id=?').run(id);
  return { ok: true };
}

export function getExpensesOverview(db: Database.Database, year: number) {
  const monthly = db
    .prepare(
      `SELECT substr(date, 1, 7) AS month, COALESCE(SUM(amount_ttc), 0) AS total
       FROM expenses
       WHERE deleted_at IS NULL
         AND date >= ? AND date <= ?
       GROUP BY month ORDER BY month`
    )
    .all(`${year}-01-01`, `${year}-12-31`) as { month: string; total: number }[];

  const quarterly = [1, 2, 3, 4].map((q) => {
    const { start, end } = quarterBounds(year, q as 1 | 2 | 3 | 4);
    const r = db
      .prepare(`SELECT COALESCE(SUM(amount_ttc), 0) AS total FROM expenses WHERE deleted_at IS NULL AND date >= ? AND date <= ?`)
      .get(start, end) as { total: number };
    return { quarter: q, total: r.total };
  });

  const byCategory = db
    .prepare(
      `SELECT category, COALESCE(SUM(amount_ttc), 0) AS total
       FROM expenses
       WHERE deleted_at IS NULL
         AND date >= ? AND date <= ?
       GROUP BY category ORDER BY total DESC`
    )
    .all(`${year}-01-01`, `${year}-12-31`) as { category: string; total: number }[];

  const alerts = db
    .prepare(
      `SELECT
         SUM(CASE WHEN category IS NULL OR category='' OR category='autre' THEN 1 ELSE 0 END) AS no_category,
         SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM document_links dl WHERE dl.entity_type='expense' AND dl.entity_id=expenses.id) THEN 1 ELSE 0 END) AS no_justif,
         SUM(CASE WHEN vat_deductible > 0
                       AND (SELECT value FROM settings WHERE key='vat_regime')='franchise_en_base'
                  THEN 1 ELSE 0 END) AS vat_inconsistent
       FROM expenses
       WHERE deleted_at IS NULL
         AND date >= ? AND date <= ?`
    )
    .get(`${year}-01-01`, `${year}-12-31`) as Record<string, number>;

  return { year, monthly, quarterly, byCategory, alerts };
}
