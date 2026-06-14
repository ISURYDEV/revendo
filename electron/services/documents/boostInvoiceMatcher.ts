import type Database from 'better-sqlite3';
import { linkDocument } from './storage';

interface DocumentRow {
  id: number;
  date: string | null;
  amount: number | null;
  supplier_or_customer: string | null;
  source: string | null;
}

interface ExpenseCandidate {
  id: number;
  date: string | null;
  amount_ttc: number;
  category: string | null;
  supplier: string | null;
  platform: string | null;
}

function clearCandidates(db: Database.Database, documentId: number, matchType: string): void {
  db.prepare(`DELETE FROM document_match_candidates WHERE document_id=? AND match_type=?`).run(documentId, matchType);
}

function insertCandidate(db: Database.Database, documentId: number, expense: ExpenseCandidate, score: number, confidence: string): void {
  db.prepare(
    `INSERT INTO document_match_candidates (document_id, entity_type, entity_id, match_type, confidence, score, reasons_json)
     VALUES (?, 'expense', ?, 'boost_invoice', ?, ?, ?)
     ON CONFLICT(document_id, entity_type, entity_id, match_type)
     DO UPDATE SET confidence=excluded.confidence, score=excluded.score, reasons_json=excluded.reasons_json, status='candidate'`
  ).run(documentId, expense.id, confidence, score, JSON.stringify({
    amount: expense.amount_ttc,
    date: expense.date,
    category: expense.category,
    reason: 'Facture de boost rapprochée par montant/date'
  }));
}

export function matchBoostInvoiceToExpense(
  db: Database.Database,
  documentId: number
): { status: 'matched' | 'ambiguous' | 'unmatched'; linkedExpenseId?: number; candidates: number } {
  const doc = db.prepare(`SELECT id, date, amount, supplier_or_customer, source FROM documents WHERE id=?`).get(documentId) as DocumentRow | undefined;
  if (!doc) throw new Error('Document introuvable');

  clearCandidates(db, documentId, 'boost_invoice');
  if (doc.amount == null || !Number.isFinite(doc.amount)) {
    db.prepare(`UPDATE documents SET match_status='unmatched', match_confidence='low' WHERE id=?`).run(documentId);
    return { status: 'unmatched', candidates: 0 };
  }

  const rows = db.prepare(
    `SELECT id, date, amount_ttc, category, supplier, platform
     FROM expenses
     WHERE ABS(COALESCE(amount_ttc,0) - ?) < 0.05
       AND (
         lower(COALESCE(category,'')) LIKE '%boost%'
         OR lower(COALESCE(description,'')) LIKE '%boost%'
         OR lower(COALESCE(source,'')) LIKE '%boost%'
         OR lower(COALESCE(supplier,'')) LIKE '%vinted%'
         OR lower(COALESCE(platform,'')) LIKE '%vinted%'
       )
       AND NOT EXISTS (
         SELECT 1 FROM document_links dl
         WHERE dl.entity_type='expense' AND dl.entity_id=expenses.id
       )`
  ).all(doc.amount) as ExpenseCandidate[];

  const scored = rows.map((expense) => {
    let score = 70;
    if (doc.date && expense.date) {
      const delta = db.prepare(`SELECT julianday(?) - julianday(?) AS d`).get(doc.date.slice(0, 10), expense.date.slice(0, 10)) as { d: number | null };
      const diff = Math.abs(delta.d ?? Number.NaN);
      if (Number.isFinite(diff) && diff <= 7) score += 25;
    }
    if ((doc.source ?? '').toLowerCase().includes((expense.platform ?? '').toLowerCase()) && expense.platform) score += 5;
    return { expense, score };
  }).filter((r) => r.score >= 70);

  if (scored.length === 1 && scored[0].score >= 90) {
    linkDocument(db, { document_id: documentId, entity_type: 'expense', entity_id: scored[0].expense.id });
    db.prepare(`UPDATE documents SET match_status='matched', match_confidence='high' WHERE id=?`).run(documentId);
    return { status: 'matched', linkedExpenseId: scored[0].expense.id, candidates: 1 };
  }

  if (scored.length > 0) {
    for (const c of scored) insertCandidate(db, documentId, c.expense, c.score, c.score >= 90 ? 'high' : 'medium');
    db.prepare(`UPDATE documents SET match_status='ambiguous', match_confidence='medium' WHERE id=?`).run(documentId);
    return { status: 'ambiguous', candidates: scored.length };
  }

  db.prepare(`UPDATE documents SET match_status='unmatched', match_confidence='low' WHERE id=?`).run(documentId);
  return { status: 'unmatched', candidates: 0 };
}
