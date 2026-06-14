import fs from 'node:fs';

const BOM = '﻿';

export const STOCK_TEMPLATE_HEADERS = [
  'Nom',
  'Quantite',
  'Type (personnel|professionnel)',
  'Date achat (DD/MM/YYYY)',
  'Lieu achat',
  'Cout total (€)',
  'Marque',
  'Taille',
  'Couleur',
  'SKU',
  'Prix vente estime (€)',
  'Etat (in_stock|listed|reserved)',
  'Emplacement',
  'Notes'
];

export const EXPENSES_TEMPLATE_HEADERS = [
  'Nom',
  'Prix (€)',
  'Lieu achat',
  'Date (DD/MM/YYYY)',
  'Recu (oui|non)',
  'Categorie',
  'Notes'
];

function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  if (s.includes(';') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function writeStockTemplate(outputPath: string): { path: string } {
  const lines: string[] = [];
  lines.push(STOCK_TEMPLATE_HEADERS.map(csvEscape).join(';'));
  // 2 lignes d'exemple
  lines.push([
    'Robe Mango bleue', '1', 'professionnel', '15/03/2026', 'Brocante Lyon',
    '5.00', 'Mango', 'M', 'Bleu', '', '15.00', 'in_stock', 'Caja A', 'Lot brocante mars'
  ].map(csvEscape).join(';'));
  lines.push([
    'Pantalon vintage', '1', 'personnel', '', '', '', 'Levi\'s', '32', 'Bleu', '', '', 'in_stock', '', ''
  ].map(csvEscape).join(';'));
  fs.writeFileSync(outputPath, BOM + lines.join('\n'), 'utf-8');
  return { path: outputPath };
}

export function writeExpensesTemplate(outputPath: string): { path: string } {
  const lines: string[] = [];
  lines.push(EXPENSES_TEMPLATE_HEADERS.map(csvEscape).join(';'));
  lines.push([
    'Sachets d\'expedition', '12.50', 'Cdiscount', '12/03/2026', 'oui', 'sacs_expedition', 'Lot 100 sachets'
  ].map(csvEscape).join(';'));
  lines.push([
    'Scotch', '3.20', 'Action', '15/03/2026', 'non', 'scotch', ''
  ].map(csvEscape).join(';'));
  fs.writeFileSync(outputPath, BOM + lines.join('\n'), 'utf-8');
  return { path: outputPath };
}
