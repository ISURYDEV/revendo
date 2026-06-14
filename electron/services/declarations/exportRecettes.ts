import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { buildQuarterlySummary } from './summary';
import type { QuarterCode } from '../../../shared/types';

interface RecetteRow {
  date_encaissement: string;
  numero_piece: string;
  client: string;
  origine: string;
  description: string;
  montant_encaisse: number;
  mode_paiement: string;
  statut: string;
  document_justificatif: string;
  notes: string;
}

const HEADERS = [
  'Date encaissement',
  'Numéro pièce / ID',
  'Client',
  'Origine / plateforme',
  'Description',
  'Montant encaissé (€)',
  'Mode paiement',
  'Statut',
  'Document justificatif',
  'Notes'
];

function formatDateFr(iso: string | null | undefined): string {
  if (!iso) return '';
  const s = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return String(iso);
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
}

/**
 * Generate the "Livre des recettes" for a quarter as CSV.
 * Only includes is_declarable=1 sales (as required by URSSAF book of receipts).
 */
export function exportLivreRecettes(
  db: Database.Database,
  year: number,
  quarter: QuarterCode,
  destinationDir: string
): { path: string; rowCount: number } {
  const summary = buildQuarterlySummary(db, year, quarter);
  const startIso = `${summary.periodStart}T00:00:00.000Z`;
  const endIso = `${summary.periodEnd}T23:59:59.999Z`;

  const rows = db
    .prepare(
      `SELECT declared_encashment_date, external_id, buyer_username, platform,
              article_name, declarable_amount, status, note
       FROM sales
       WHERE urssaf_declarable=1
         AND classification='professional_resale'
         AND deleted_at IS NULL
         AND declared_encashment_date IS NOT NULL
         AND declared_encashment_date >= ?
         AND declared_encashment_date <= ?
       ORDER BY declared_encashment_date ASC`
    )
    .all(startIso, endIso) as {
    declared_encashment_date: string;
    external_id: string | null;
    buyer_username: string | null;
    platform: string | null;
    article_name: string | null;
    declarable_amount: number;
    status: string;
    note: string | null;
  }[];

  const recettes: RecetteRow[] = rows.map((r) => ({
    date_encaissement: formatDateFr(r.declared_encashment_date),
    numero_piece: r.external_id ?? '',
    client: r.buyer_username ?? '',
    origine: r.platform ?? '',
    description: (r.article_name ?? '').replace(/\s+/g, ' ').slice(0, 200),
    montant_encaisse: r.declarable_amount,
    mode_paiement: 'Virement plateforme',
    statut: r.status,
    document_justificatif: '',
    notes: r.note ?? ''
  }));

  const csvLines: string[] = [];
  csvLines.push(['Revendo — Livre des recettes', `Q${quarter} ${year}`].map(csvEscape).join(';'));
  csvLines.push(['Période effective', formatDateFr(summary.periodStart), formatDateFr(summary.periodEnd), 'Échéance', formatDateFr(summary.dueDate)].map(csvEscape).join(';'));
  csvLines.push(['CA professionnel déclarable', summary.caGoods.toFixed(2).replace('.', ','), 'Ventes incluses', summary.includedSalesCount, 'Ventes exclues', summary.excludedSalesCount].map(csvEscape).join(';'));
  csvLines.push(['Ventes personnelles hors activité', summary.personalSalesCount, 'Ventes avant début activité', summary.preActivitySalesCount, 'Ventes annulées/remboursées', summary.canceledSalesCount, 'Ventes à vérifier', summary.uncertainSalesCount].map(csvEscape).join(';'));
  csvLines.push('');
  csvLines.push(HEADERS.map(csvEscape).join(';'));
  for (const row of recettes) {
    csvLines.push(
      [
        row.date_encaissement,
        row.numero_piece,
        row.client,
        row.origine,
        row.description,
        row.montant_encaisse.toFixed(2).replace('.', ','),
        row.mode_paiement,
        row.statut,
        row.document_justificatif,
        row.notes
      ]
        .map(csvEscape)
        .join(';')
    );
  }

  // Footer with total + fiscal warning
  const total = recettes.reduce((s, r) => s + r.montant_encaisse, 0);
  csvLines.push('');
  csvLines.push(['', '', '', '', 'TOTAL', total.toFixed(2).replace('.', ','), '', '', '', ''].map(csvEscape).join(';'));
  csvLines.push('');
  csvLines.push(
    csvEscape(
      `Estimation générée par Revendo. À vérifier sur urssaf.fr avant déclaration. ` +
        `Période effective : ${formatDateFr(summary.periodStart)} → ${formatDateFr(summary.periodEnd)}. Échéance : ${formatDateFr(summary.dueDate)}.`
    )
  );

  if (!fs.existsSync(destinationDir)) fs.mkdirSync(destinationDir, { recursive: true });
  const fileName = `livre_recettes_${year}_Q${quarter}.csv`;
  const outPath = path.join(destinationDir, fileName);
  // Prepend UTF-8 BOM so Excel opens it correctly
  fs.writeFileSync(outPath, '﻿' + csvLines.join('\n'), 'utf-8');
  return { path: outPath, rowCount: recettes.length };
}

function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  if (s.includes(';') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
