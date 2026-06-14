import type Database from 'better-sqlite3';
import { ensureSoftDeleteColumns } from '../../db/softDelete';
import type { GlobalSearchResult } from '../../../shared/types';

function likeTerm(q: string): string {
  return `%${q.trim().replace(/[%_]/g, '')}%`;
}

function limitEach(limit: number): number {
  return Math.max(1, Math.min(limit, 20));
}

export function globalSearch(
  db: Database.Database,
  query: string,
  limit = 8
): GlobalSearchResult[] {
  ensureSoftDeleteColumns(db, ['sales', 'stock_items', 'purchases', 'expenses', 'documents', 'declarations']);
  const q = query.trim();
  if (q.length < 2) return [];
  const like = likeTerm(q);
  const each = limitEach(limit);
  const amount = Number(q.replace(',', '.'));
  const amountFilter = Number.isFinite(amount) ? amount : null;

  const results: GlobalSearchResult[] = [];

  const sales = db
    .prepare(
      `SELECT id, external_id, article_name, buyer_username, sku, platform, amount_received, declared_encashment_date, sale_date, status
       FROM sales
       WHERE deleted_at IS NULL
         AND (article_name LIKE ? OR buyer_username LIKE ? OR sku LIKE ? OR external_id LIKE ? OR tracking_number LIKE ? OR note LIKE ?
          OR (? IS NOT NULL AND ABS(COALESCE(amount_received,0) - ?) < 0.01)
         )
       ORDER BY updated_at DESC LIMIT ?`
    )
    .all(like, like, like, like, like, like, amountFilter, amountFilter, each) as Record<string, unknown>[];
  for (const r of sales) {
    results.push({
      type: 'sale',
      id: Number(r.id),
      title: String(r.article_name ?? `Vente #${r.id}`),
      subtitle: `${r.platform ?? 'Vente'} · ${r.buyer_username ?? 'acheteur inconnu'} · ${r.external_id ?? ''}`,
      amount: r.amount_received == null ? null : Number(r.amount_received),
      date: String(r.declared_encashment_date ?? r.sale_date ?? ''),
      badge: String(r.status ?? ''),
      route: `/sales?open=${r.id}`
    });
  }

  const stock = db
    .prepare(
      `SELECT id, internal_code, name, sku, brand, location, status, quantity, unit_cost_ttc, updated_at
       FROM stock_items
       WHERE deleted_at IS NULL
         AND (name LIKE ? OR sku LIKE ? OR brand LIKE ? OR location LIKE ? OR internal_code LIKE ? OR notes LIKE ?)
       ORDER BY updated_at DESC LIMIT ?`
    )
    .all(like, like, like, like, like, like, each) as Record<string, unknown>[];
  for (const r of stock) {
    results.push({
      type: 'stock_item',
      id: Number(r.id),
      title: String(r.name ?? r.internal_code ?? `Stock #${r.id}`),
      subtitle: `${r.internal_code ?? ''}${r.sku ? ` · SKU ${r.sku}` : ''}${r.location ? ` · ${r.location}` : ''}`,
      amount: r.unit_cost_ttc == null ? null : Number(r.unit_cost_ttc),
      date: String(r.updated_at ?? ''),
      badge: `${r.status ?? ''} · x${r.quantity ?? 0}`,
      route: `/stock?open=${r.id}`
    });
  }

  const purchases = db
    .prepare(
      `SELECT id, external_id, seller, platform, articles, total_ttc, payment_date, status
       FROM purchases
       WHERE deleted_at IS NULL
         AND (seller LIKE ? OR platform LIKE ? OR articles LIKE ? OR external_id LIKE ? OR notes LIKE ?
          OR (? IS NOT NULL AND ABS(COALESCE(total_ttc,0) - ?) < 0.01)
         )
       ORDER BY COALESCE(payment_date, created_at) DESC LIMIT ?`
    )
    .all(like, like, like, like, like, amountFilter, amountFilter, each) as Record<string, unknown>[];
  for (const r of purchases) {
    results.push({
      type: 'purchase',
      id: Number(r.id),
      title: String(r.articles ?? `Achat #${r.id}`),
      subtitle: `${r.platform ?? 'Achat'} · ${r.seller ?? 'fournisseur inconnu'} · ${r.external_id ?? ''}`,
      amount: r.total_ttc == null ? null : Number(r.total_ttc),
      date: String(r.payment_date ?? ''),
      badge: String(r.status ?? ''),
      route: `/purchases?open=${r.id}`
    });
  }

  const expenses = db
    .prepare(
      `SELECT id, description, supplier, platform, category, amount_ttc, date
       FROM expenses
       WHERE deleted_at IS NULL
         AND (description LIKE ? OR supplier LIKE ? OR platform LIKE ? OR category LIKE ? OR notes LIKE ?
          OR (? IS NOT NULL AND ABS(COALESCE(amount_ttc,0) - ?) < 0.01)
         )
       ORDER BY date DESC LIMIT ?`
    )
    .all(like, like, like, like, like, amountFilter, amountFilter, each) as Record<string, unknown>[];
  for (const r of expenses) {
    results.push({
      type: 'expense',
      id: Number(r.id),
      title: String(r.description ?? r.category ?? `Dépense #${r.id}`),
      subtitle: `${r.supplier ?? 'fournisseur inconnu'} · ${r.platform ?? ''}`,
      amount: r.amount_ttc == null ? null : Number(r.amount_ttc),
      date: String(r.date ?? ''),
      badge: String(r.category ?? ''),
      route: `/expenses?open=${r.id}`
    });
  }

  const documents = db
    .prepare(
      `SELECT id, original_file_name, file_name, document_type, supplier_or_customer, external_reference, amount, date, created_at
       FROM documents
       WHERE deleted_at IS NULL
         AND (original_file_name LIKE ? OR file_name LIKE ? OR supplier_or_customer LIKE ? OR external_reference LIKE ? OR notes LIKE ?
          OR (? IS NOT NULL AND ABS(COALESCE(amount,0) - ?) < 0.01)
         )
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(like, like, like, like, like, amountFilter, amountFilter, each) as Record<string, unknown>[];
  for (const r of documents) {
    results.push({
      type: 'document',
      id: Number(r.id),
      title: String(r.original_file_name ?? r.file_name ?? `Document #${r.id}`),
      subtitle: `${r.document_type ?? 'document'} · ${r.supplier_or_customer ?? r.external_reference ?? ''}`,
      amount: r.amount == null ? null : Number(r.amount),
      date: String(r.date ?? r.created_at ?? ''),
      badge: String(r.document_type ?? ''),
      route: `/documents?open=${r.id}`
    });
  }

  const declarations = db
    .prepare(
      `SELECT id, year, quarter, total_ca, status, declaration_date, due_date
       FROM declarations
       WHERE deleted_at IS NULL
         AND (CAST(year AS TEXT) LIKE ? OR status LIKE ? OR notes LIKE ?)
       ORDER BY year DESC, quarter DESC LIMIT ?`
    )
    .all(like, like, like, each) as Record<string, unknown>[];
  for (const r of declarations) {
    results.push({
      type: 'declaration',
      id: Number(r.id),
      title: `Déclaration URSSAF Q${r.quarter} ${r.year}`,
      subtitle: `Échéance ${r.due_date ?? '—'} · ${r.status ?? 'draft'}`,
      amount: r.total_ca == null ? null : Number(r.total_ca),
      date: String(r.declaration_date ?? r.due_date ?? ''),
      badge: String(r.status ?? ''),
      route: '/declarations'
    });
  }

  return results;
}
