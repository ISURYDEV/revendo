import type Database from 'better-sqlite3';
import { parseCsvFile, parseFrenchDate, parseFrenchNumber } from '../csv/parser';
import { createExpense } from '../expenses/repository';
import type { ImportResult } from '../../../shared/types';

export interface ManualExpenseImportRow {
  rowIndex: number;       // CSV row (1-based, excluding header)
  expense_id: number;     // created expense id
  name: string;
  has_receipt: boolean;
  amount: number;
}

export interface ManualExpensesImportResult extends ImportResult {
  /** Rows where user marked "oui" — they need a receipt PDF/image attached after. */
  needReceipt: ManualExpenseImportRow[];
}

/**
 * Manual expenses CSV importer (template downloaded from the app).
 * Headers: Nom (req), Prix (req), Lieu (req), Date (opt), Recu oui/non (req), Categorie (opt), Notes (opt)
 *
 * For each row with Recu='oui', the row id is returned in `needReceipt` so the UI can
 * prompt the user to attach the receipt PDF/image to each expense afterwards.
 */
export function importExpensesCsv(db: Database.Database, filePath: string, importId: number): ManualExpensesImportResult {
  const parsed = parseCsvFile(filePath);
  const result: ManualExpensesImportResult = {
    importId, type: 'generic_expenses',
    created: 0, updated: 0, duplicatesIdentical: 0, conflicts: 0, skipped: 0,
    preActivityCount: 0, canceledRefundedCount: 0, caAdded: 0, errors: [],
    needReceipt: []
  };

  parsed.rows.forEach((row, idx) => {
    try {
      const name = (row['Nom'] ?? '').trim();
      const price = parseFrenchNumber(row['Prix (€)']);
      const place = (row['Lieu achat'] ?? '').trim();
      const recu = (row['Recu (oui|non)'] ?? '').toLowerCase().trim();

      if (!name) return result.errors.push({ row: idx + 2, reason: 'Nom obligatoire' });
      if (price == null) return result.errors.push({ row: idx + 2, reason: 'Prix obligatoire' });
      if (!place) return result.errors.push({ row: idx + 2, reason: 'Lieu achat obligatoire' });
      if (recu !== 'oui' && recu !== 'non') return result.errors.push({ row: idx + 2, reason: 'Reçu doit être oui ou non' });

      const date = parseFrenchDate(row['Date (DD/MM/YYYY)'])?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
      const category = (row['Categorie'] ?? 'autre').trim() || 'autre';

      const r = createExpense(db, {
        date, category, supplier: place, description: name,
        amount_ttc: price, notes: row['Notes'] || null
      });
      result.created += 1;
      if (recu === 'oui') {
        result.needReceipt.push({ rowIndex: idx + 2, expense_id: r.id, name, has_receipt: true, amount: price });
      }
    } catch (err) {
      result.errors.push({ row: idx + 2, reason: err instanceof Error ? err.message : String(err) });
    }
  });

  return result;
}
