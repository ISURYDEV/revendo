import type Database from 'better-sqlite3';
import ExcelJS from 'exceljs';
import { buildQuarterlySummary } from '../declarations/summary';
import type { QuarterCode } from '../../../shared/types';

function formatDateFr(iso: string | null | undefined): string {
  if (!iso) return '';
  const s = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return String(iso);
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
}

export async function exportLivreRecettesXlsx(
  db: Database.Database,
  year: number,
  quarter: QuarterCode,
  outputPath: string
): Promise<{ path: string; rowCount: number }> {
  const summary = buildQuarterlySummary(db, year, quarter);
  const rows = db
    .prepare(
      `SELECT declared_encashment_date, external_id, buyer_username, platform,
              article_name, declarable_amount, status, note
       FROM sales
       WHERE urssaf_declarable=1 AND classification='professional_resale'
         AND declared_encashment_date >= ? AND declared_encashment_date <= ?
       ORDER BY declared_encashment_date ASC`
    )
    .all(`${summary.periodStart}T00:00:00.000Z`, `${summary.periodEnd}T23:59:59.999Z`) as Array<{
      declared_encashment_date: string;
      external_id: string | null;
      buyer_username: string | null;
      platform: string | null;
      article_name: string | null;
      declarable_amount: number;
      status: string;
      note: string | null;
    }>;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Revendo';
  wb.created = new Date();

  const ws = wb.addWorksheet(`Livre recettes Q${quarter} ${year}`, {
    pageSetup: { paperSize: 9, orientation: 'landscape' }
  });

  // Title block
  ws.mergeCells('A1:I1');
  ws.getCell('A1').value = `Revendo — Livre des recettes — Q${quarter} ${year}`;
  ws.getCell('A1').font = { size: 14, bold: true };
  ws.mergeCells('A2:I2');
  ws.getCell('A2').value = `Période effective : ${formatDateFr(summary.periodStart)} → ${formatDateFr(summary.periodEnd)} • Échéance : ${formatDateFr(summary.dueDate)}`;
  ws.getCell('A2').font = { italic: true, color: { argb: 'FF64748B' } };
  ws.mergeCells('A3:I3');
  ws.getCell('A3').value = `CA professionnel déclarable : ${summary.caGoods.toFixed(2).replace('.', ',')} € • Ventes incluses : ${summary.includedSalesCount} • Exclues : ${summary.excludedSalesCount} • Personnelles : ${summary.personalSalesCount} • Avant début activité : ${summary.preActivitySalesCount} • À vérifier : ${summary.uncertainSalesCount}`;
  ws.getCell('A3').font = { italic: true, color: { argb: 'FF64748B' } };
  ws.addRow([]);

  // Headers
  const headerRow = ws.addRow([
    'Date encaissement',
    'Numéro pièce / ID',
    'Client',
    'Plateforme',
    'Description',
    'Montant encaissé (€)',
    'Mode paiement',
    'Statut',
    'Notes'
  ]);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    cell.border = { bottom: { style: 'thin' } };
  });

  let total = 0;
  for (const r of rows) {
    const row = ws.addRow([
      formatDateFr(r.declared_encashment_date),
      r.external_id ?? '',
      r.buyer_username ?? '',
      r.platform ?? '',
      (r.article_name ?? '').slice(0, 200),
      r.declarable_amount,
      'Virement plateforme',
      r.status,
      r.note ?? ''
    ]);
    row.getCell(6).numFmt = '#,##0.00 €';
    total += r.declarable_amount;
  }

  ws.addRow([]);
  const totalRow = ws.addRow(['', '', '', '', 'TOTAL', total, '', '', '']);
  totalRow.getCell(5).font = { bold: true };
  totalRow.getCell(6).font = { bold: true };
  totalRow.getCell(6).numFmt = '#,##0.00 €';
  totalRow.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };

  ws.addRow([]);
  const footer = ws.addRow([
    `Document généré par Revendo le ${formatDateFr(new Date().toISOString())}. À vérifier sur autoentrepreneur.urssaf.fr avant déclaration officielle.`
  ]);
  ws.mergeCells(footer.number, 1, footer.number, 9);
  footer.getCell(1).font = { italic: true, color: { argb: 'FF94A3B8' }, size: 9 };

  // Column widths
  ws.columns = [
    { width: 18 }, { width: 16 }, { width: 18 }, { width: 14 },
    { width: 40 }, { width: 16 }, { width: 18 }, { width: 12 }, { width: 28 }
  ];

  await wb.xlsx.writeFile(outputPath);
  return { path: outputPath, rowCount: rows.length };
}
