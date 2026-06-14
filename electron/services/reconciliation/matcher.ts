import type Database from 'better-sqlite3';

export interface ParsedLine {
  date: string | null;
  amount: number | null;
  label: string;
  raw: string;
}

export interface ReconciliationItem extends ParsedLine {
  match: { type: 'sale' | 'expense'; id: number; matchScore: number } | null;
  candidates: { type: 'sale' | 'expense'; id: number; date: string | null; amount: number; label: string }[];
}

/**
 * Parse a free-form pasted statement (Vinted / PayPal / etc.) into structured lines.
 * Heuristic: looks for a date and a euro amount in each non-empty line.
 */
export function parsePastedStatement(text: string): ParsedLine[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const out: ParsedLine[] = [];
  for (const raw of lines) {
    let date: string | null = null;
    let m = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) date = `${m[1]}-${m[2]}-${m[3]}`;
    else if ((m = raw.match(/(\d{2})\/(\d{2})\/(\d{4})/))) date = `${m[3]}-${m[2]}-${m[1]}`;
    else if ((m = raw.match(/(\d{2})\.(\d{2})\.(\d{4})/))) date = `${m[3]}-${m[2]}-${m[1]}`;

    let amount: number | null = null;
    const amtMatch = raw.match(/-?\d{1,3}(?:[ .]\d{3})*[.,]\d{2}/g);
    if (amtMatch && amtMatch.length > 0) {
      // Take the LAST number on the line (banks usually put amount at the end)
      const a = amtMatch[amtMatch.length - 1].replace(/[ .](?=\d{3}\b)/g, '').replace(',', '.');
      const n = Number(a);
      if (Number.isFinite(n)) amount = n;
    }
    out.push({ date, amount, label: raw.slice(0, 120), raw });
  }
  return out;
}

/**
 * Try to match each parsed line with a sale or expense in DB.
 *  - exact date AND amount match → matchScore 1.0
 *  - amount match within ±3 days → matchScore 0.7
 *  - amount match only → matchScore 0.4
 */
export function reconcile(db: Database.Database, lines: ParsedLine[]): ReconciliationItem[] {
  const out: ReconciliationItem[] = [];
  const saleStmt = db.prepare(
    `SELECT id, declared_encashment_date AS date, amount_received AS amount, article_name AS label
     FROM sales
     WHERE urssaf_declarable=1 AND ABS(amount_received - ?) < 0.01`
  );
  const expenseStmt = db.prepare(
    `SELECT id, date, amount_ttc AS amount, COALESCE(description, supplier, category) AS label
     FROM expenses WHERE ABS(amount_ttc - ?) < 0.01`
  );

  for (const line of lines) {
    if (line.amount == null) {
      out.push({ ...line, match: null, candidates: [] });
      continue;
    }
    const absAmt = Math.abs(line.amount);
    const saleCandidates = saleStmt.all(absAmt) as { id: number; date: string | null; amount: number; label: string }[];
    const expenseCandidates = line.amount < 0 ? (expenseStmt.all(absAmt) as { id: number; date: string | null; amount: number; label: string }[]) : [];
    const candidates = [
      ...saleCandidates.map((c) => ({ type: 'sale' as const, ...c })),
      ...expenseCandidates.map((c) => ({ type: 'expense' as const, ...c }))
    ];

    let best: ReconciliationItem['match'] = null;
    for (const c of candidates) {
      const dateDelta = c.date && line.date ? Math.abs(daysBetween(c.date.slice(0, 10), line.date)) : Number.POSITIVE_INFINITY;
      const score = dateDelta === 0 ? 1.0 : dateDelta <= 3 ? 0.7 : 0.4;
      if (!best || score > best.matchScore) best = { type: c.type, id: c.id, matchScore: score };
    }
    out.push({ ...line, match: best, candidates });
  }
  return out;
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / (24 * 60 * 60 * 1000));
}
