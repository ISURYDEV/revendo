import type Database from 'better-sqlite3';
import { parseCsvFile, parseFrenchDate, parseFrenchNumber } from '../csv/parser';

export interface BankImportResult {
  importId: number;
  created: number;
  duplicates: number;
  errors: { row: number; reason: string }[];
}

interface MappingHints {
  date?: string[];
  label?: string[];
  amount_credit?: string[];
  amount_debit?: string[];
  amount?: string[];
  balance?: string[];
}

const DEFAULTS: Required<MappingHints> = {
  date: ['Date opération', 'Date opé.', 'Date', 'Date de transaction', 'transaction date'],
  label: ['Libellé', 'Libelle', 'Description', 'Label', 'Designation'],
  amount_credit: ['Crédit', 'Credit'],
  amount_debit: ['Débit', 'Debit'],
  amount: ['Montant', 'Amount'],
  balance: ['Solde', 'Balance']
};

function resolveHeader(headers: string[], candidates: string[]): string | null {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const c of candidates) {
    const idx = lower.indexOf(c.toLowerCase().trim());
    if (idx >= 0) return headers[idx];
  }
  return null;
}

/**
 * Generic bank CSV importer. Auto-detects column mapping using known french bank headers
 * (Crédit Mutuel, BNP, Boursorama, Société Générale, etc.).
 * - Single "Montant" column: stored as-is (signed).
 * - Separate Credit/Debit columns: credit positive, debit negative.
 */
export function importBankCsv(
  db: Database.Database,
  filePath: string,
  bankName: string = 'Inconnu'
): BankImportResult {
  const parsed = parseCsvFile(filePath);
  const result: BankImportResult = { importId: 0, created: 0, duplicates: 0, errors: [] };

  const dateCol = resolveHeader(parsed.headers, DEFAULTS.date);
  const labelCol = resolveHeader(parsed.headers, DEFAULTS.label);
  const creditCol = resolveHeader(parsed.headers, DEFAULTS.amount_credit);
  const debitCol = resolveHeader(parsed.headers, DEFAULTS.amount_debit);
  const amountCol = resolveHeader(parsed.headers, DEFAULTS.amount);
  const balanceCol = resolveHeader(parsed.headers, DEFAULTS.balance);

  if (!dateCol || !labelCol || (!amountCol && !creditCol && !debitCol)) {
    throw new Error(
      'Impossible de détecter les colonnes obligatoires (date / libellé / montant). ' +
        'En-têtes trouvés : ' + parsed.headers.join(', ')
    );
  }

  const info = db
    .prepare(
      `INSERT INTO imports (source, file_name, file_hash, rows_total, import_type)
       VALUES ('bank', ?, ?, ?, 'bank_csv')`
    )
    .run(filePath.split(/[\\/]/).pop() ?? 'bank.csv', String(Date.now()), parsed.rows.length);
  result.importId = Number(info.lastInsertRowid);

  const insert = db.prepare(
    `INSERT INTO bank_transactions
       (import_id, bank_name, transaction_date, label, amount, balance_after)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const findDup = db.prepare(
    `SELECT id FROM bank_transactions
     WHERE bank_name=? AND transaction_date=? AND amount=? AND label=?`
  );

  const tx = db.transaction(() => {
    parsed.rows.forEach((row, idx) => {
      try {
        const date = parseFrenchDate(row[dateCol!])?.slice(0, 10);
        if (!date) {
          result.errors.push({ row: idx + 2, reason: 'Date invalide' });
          return;
        }
        const label = String(row[labelCol!] ?? '').trim();
        let amount = 0;
        if (amountCol) {
          amount = parseFrenchNumber(row[amountCol]) ?? 0;
        } else {
          const credit = creditCol ? parseFrenchNumber(row[creditCol]) ?? 0 : 0;
          const debit = debitCol ? parseFrenchNumber(row[debitCol]) ?? 0 : 0;
          amount = credit - debit;
        }
        const balance = balanceCol ? parseFrenchNumber(row[balanceCol]) : null;

        if (findDup.get(bankName, date, amount, label)) {
          result.duplicates += 1;
          return;
        }
        insert.run(result.importId, bankName, date, label, amount, balance ?? null);
        result.created += 1;
      } catch (err) {
        result.errors.push({ row: idx + 2, reason: err instanceof Error ? err.message : String(err) });
      }
    });
  });
  tx();

  db.prepare(`UPDATE imports SET rows_created=?, rows_skipped=?, rows_error=? WHERE id=?`).run(
    result.created,
    result.duplicates,
    result.errors.length,
    result.importId
  );
  return result;
}
