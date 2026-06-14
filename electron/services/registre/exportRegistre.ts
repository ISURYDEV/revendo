import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const HEADERS = [
  'Date',
  'Type',
  'Fournisseur',
  'Plateforme',
  'N° pièce / référence',
  'Description',
  'Quantité',
  'Prix articles (€)',
  'Frais de port (€)',
  'Frais de protection (€)',
  'Total TTC (€)',
  'TVA déductible (€)',
  'Stock créé',
  'Document associé',
  'Notes'
];

function fr(n: number | null | undefined): string {
  if (n == null) return '';
  return n.toFixed(2).replace('.', ',');
}

function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  if (s.includes(';') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Export Registre des achats CSV combining purchases, expenses and boosts in the period.
 * Separated by Type column. Includes per-section subtotals + grand total + fiscal warning.
 */
export function exportRegistreAchats(
  db: Database.Database,
  year: number,
  destinationFile: string,
  filters: { quarter?: 1 | 2 | 3 | 4; categories?: string[] } = {}
): { path: string; rowCount: number } {
  let startDate: string, endDate: string;
  if (filters.quarter) {
    const ranges = {
      1: [`${year}-01-01`, `${year}-03-31`],
      2: [`${year}-04-01`, `${year}-06-30`],
      3: [`${year}-07-01`, `${year}-09-30`],
      4: [`${year}-10-01`, `${year}-12-31`]
    } as const;
    [startDate, endDate] = ranges[filters.quarter];
  } else {
    startDate = `${year}-01-01`;
    endDate = `${year}-12-31`;
  }

  const purchases = db
    .prepare(
      `SELECT p.*, (SELECT GROUP_CONCAT(si.internal_code, ', ') FROM stock_items si WHERE si.purchase_id=p.id AND si.deleted_at IS NULL) AS stock_created,
              (SELECT GROUP_CONCAT(d.original_file_name, ', ') FROM documents d
               JOIN document_links dl ON dl.document_id=d.id
               WHERE dl.entity_type='purchase' AND dl.entity_id=p.id AND d.deleted_at IS NULL) AS docs
       FROM purchases p
       WHERE p.deleted_at IS NULL
         AND p.payment_date >= ? AND p.payment_date <= ?
       ORDER BY p.payment_date`
    )
    .all(`${startDate}T00:00:00.000Z`, `${endDate}T23:59:59.999Z`) as Array<Record<string, unknown>>;

  const expenses = db
    .prepare(
      `SELECT e.*, (SELECT GROUP_CONCAT(d.original_file_name, ', ') FROM documents d
                    JOIN document_links dl ON dl.document_id=d.id
                    WHERE dl.entity_type='expense' AND dl.entity_id=e.id AND d.deleted_at IS NULL) AS docs
       FROM expenses e
       WHERE e.deleted_at IS NULL
         AND e.date >= ? AND e.date <= ?
       ORDER BY e.date`
    )
    .all(startDate, endDate) as Array<Record<string, unknown>>;

  const boosts = db
    .prepare(
      `SELECT b.*, (SELECT GROUP_CONCAT(d.original_file_name, ', ') FROM documents d
                    JOIN document_links dl ON dl.document_id=d.id
                    WHERE dl.entity_type='boost' AND dl.entity_id=b.id AND d.deleted_at IS NULL) AS docs
       FROM boosts b
       WHERE b.deleted_at IS NULL
         AND b.start_date >= ? AND b.start_date <= ?
       ORDER BY b.start_date`
    )
    .all(`${startDate}T00:00:00.000Z`, `${endDate}T23:59:59.999Z`) as Array<Record<string, unknown>>;

  const lines: string[] = [];
  lines.push(HEADERS.map(csvEscape).join(';'));

  // Achats de stock
  lines.push(csvEscape('--- ACHATS DE STOCK ---'));
  let purchasesTotal = 0;
  for (const r of purchases) {
    const total = Number(r.total_ttc ?? 0);
    purchasesTotal += total;
    lines.push(
      [
        String(r.payment_date ?? '').slice(0, 10),
        'Achat stock',
        r.seller ?? '',
        r.platform ?? '',
        r.external_id ?? '',
        r.articles ?? '',
        r.quantity ?? '',
        fr(Number(r.items_price ?? 0)),
        fr(Number(r.shipping_fee ?? 0)),
        fr(Number(r.protection_fee ?? 0)),
        fr(total),
        fr(Number(r.deductible_vat ?? 0)),
        r.stock_created ?? '',
        r.docs ?? '',
        ''
      ].map(csvEscape).join(';')
    );
  }
  lines.push(['', '', '', '', '', '', '', '', '', 'Sous-total achats', fr(purchasesTotal), '', '', '', ''].map(csvEscape).join(';'));
  lines.push('');

  // Boosts
  lines.push(csvEscape('--- BOOSTS / MARKETING ---'));
  let boostsTotal = 0;
  for (const r of boosts) {
    const total = Number(r.amount_ttc ?? 0);
    boostsTotal += total;
    lines.push(
      [
        String(r.start_date ?? '').slice(0, 10),
        `Boost ${r.boost_type ?? ''}`,
        'Vinted / Vinteer',
        'Vinted',
        r.external_id ?? '',
        `Boost ${r.boost_type ?? ''} ${r.scope ?? ''} ${r.boosted_articles_count ? `(${r.boosted_articles_count} articles)` : ''}`.trim(),
        r.boosted_articles_count ?? '',
        '',
        '',
        '',
        fr(total),
        fr(Number(r.vat_amount ?? 0)),
        '',
        r.docs ?? '',
        r.notes ?? ''
      ].map(csvEscape).join(';')
    );
  }
  lines.push(['', '', '', '', '', '', '', '', '', 'Sous-total boosts', fr(boostsTotal), '', '', '', ''].map(csvEscape).join(';'));
  lines.push('');

  // Dépenses opérationnelles
  lines.push(csvEscape('--- DÉPENSES OPÉRATIONNELLES ---'));
  let expensesTotal = 0;
  for (const r of expenses) {
    if (filters.categories && filters.categories.length > 0 && !filters.categories.includes(String(r.category))) continue;
    const total = Number(r.amount_ttc ?? 0);
    expensesTotal += total;
    lines.push(
      [
        String(r.date ?? '').slice(0, 10),
        String(r.category ?? 'autre'),
        r.supplier ?? '',
        r.platform ?? '',
        '',
        r.description ?? '',
        '',
        '',
        '',
        '',
        fr(total),
        fr(Number(r.vat_deductible ?? 0)),
        '',
        r.docs ?? '',
        r.notes ?? ''
      ].map(csvEscape).join(';')
    );
  }
  lines.push(['', '', '', '', '', '', '', '', '', 'Sous-total dépenses', fr(expensesTotal), '', '', '', ''].map(csvEscape).join(';'));
  lines.push('');

  lines.push(['', '', '', '', '', '', '', '', '', 'TOTAL GÉNÉRAL', fr(purchasesTotal + boostsTotal + expensesTotal), '', '', '', ''].map(csvEscape).join(';'));
  lines.push('');
  lines.push(
    csvEscape(
      `Période: ${startDate} → ${endDate}. ` +
        `Régime: franchise en base de TVA (mention: "TVA non applicable, art. 293 B du CGI"). ` +
        `Estimation générée par Revendo. Ces montants NE sont PAS déduits du CA URSSAF.`
      )
  );

  fs.mkdirSync(path.dirname(destinationFile), { recursive: true });
  fs.writeFileSync(destinationFile, '﻿' + lines.join('\n'), 'utf-8');
  return { path: destinationFile, rowCount: purchases.length + expenses.length + boosts.length };
}
