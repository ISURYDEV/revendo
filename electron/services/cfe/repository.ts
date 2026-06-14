import type Database from 'better-sqlite3';

export interface CfePayment {
  id: number;
  year: number;
  amount_paid: number | null;
  paid_date: string | null;
  exonerated: number;
  document_id: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function listCfePayments(db: Database.Database): CfePayment[] {
  return db.prepare(`SELECT * FROM cfe_payments ORDER BY year DESC`).all() as CfePayment[];
}

export function upsertCfePayment(
  db: Database.Database,
  payload: { year: number; amount_paid?: number | null; paid_date?: string | null; exonerated?: boolean; notes?: string | null }
): { id: number } {
  const existing = db.prepare(`SELECT id FROM cfe_payments WHERE year=?`).get(payload.year) as { id: number } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE cfe_payments SET amount_paid=?, paid_date=?, exonerated=?, notes=?, updated_at=datetime('now')
       WHERE id=?`
    ).run(payload.amount_paid ?? null, payload.paid_date ?? null, payload.exonerated ? 1 : 0, payload.notes ?? null, existing.id);
    return existing;
  }
  const info = db.prepare(
    `INSERT INTO cfe_payments (year, amount_paid, paid_date, exonerated, notes) VALUES (?, ?, ?, ?, ?)`
  ).run(payload.year, payload.amount_paid ?? null, payload.paid_date ?? null, payload.exonerated ? 1 : 0, payload.notes ?? null);
  return { id: Number(info.lastInsertRowid) };
}

export function deleteCfePayment(db: Database.Database, id: number): { ok: true } {
  db.prepare(`DELETE FROM cfe_payments WHERE id=?`).run(id);
  return { ok: true };
}
