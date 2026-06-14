import type Database from 'better-sqlite3';
import type { Boost } from '../../../shared/types';

export interface AllocationTarget {
  entity: 'product' | 'sale' | 'campaign' | 'general';
  id?: number;
  label?: string;
}

export function listBoosts(
  db: Database.Database,
  filters: {
    year?: number;
    quarter?: 1 | 2 | 3 | 4;
    type?: string;
    assignment?: 'all' | 'assigned' | 'unassigned';
    limit?: number;
    offset?: number;
  } = {}
): Boost[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.year && filters.quarter) {
    const m = ((filters.quarter - 1) * 3 + 1).toString().padStart(2, '0');
    const endM = (filters.quarter * 3).toString().padStart(2, '0');
    where.push('start_date >= ? AND start_date <= ?');
    params.push(`${filters.year}-${m}-01T00:00:00.000Z`, `${filters.year}-${endM}-31T23:59:59.999Z`);
  } else if (filters.year) {
    where.push('start_date >= ? AND start_date <= ?');
    params.push(`${filters.year}-01-01T00:00:00.000Z`, `${filters.year}-12-31T23:59:59.999Z`);
  }
  if (filters.type) {
    where.push('boost_type=?');
    params.push(filters.type);
  }
  if (filters.assignment === 'assigned') {
    where.push("(allocation_targets IS NOT NULL AND allocation_targets != '[]')");
  } else if (filters.assignment === 'unassigned') {
    where.push("(allocation_targets IS NULL OR allocation_targets = '[]' OR allocation_targets = '')");
  }
  const sql = `SELECT * FROM boosts ${
    where.length ? 'WHERE deleted_at IS NULL AND ' + where.join(' AND ') : 'WHERE deleted_at IS NULL'
  } ORDER BY start_date DESC LIMIT ? OFFSET ?`;
  params.push(filters.limit ?? 500, filters.offset ?? 0);
  return db.prepare(sql).all(...params) as Boost[];
}

export function createManualBoost(
  db: Database.Database,
  payload: {
    start_date: string;
    boost_type: string;
    scope?: string | null;
    duration_days?: number | null;
    boosted_articles_count?: number | null;
    amount_ttc: number;
    vat_rate?: number | null;
    vat_amount?: number | null;
    amount_ht?: number | null;
    discount?: number | null;
    notes?: string | null;
    allocation_targets?: AllocationTarget[];
    linked_campaign?: string | null;
  }
): { id: number } {
  const info = db
    .prepare(
      `INSERT INTO boosts (
         source, external_id, start_date, boost_type, scope, duration_days,
         boosted_articles_count, amount_ht, vat_rate, vat_amount, amount_ttc,
         gross_price_ttc, discount, allocation_method, allocation_targets, linked_campaign, notes
       ) VALUES ('manual', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      payload.start_date,
      payload.boost_type,
      payload.scope ?? null,
      payload.duration_days ?? null,
      payload.boosted_articles_count ?? null,
      payload.amount_ht ?? null,
      payload.vat_rate ?? null,
      payload.vat_amount ?? null,
      payload.amount_ttc,
      payload.amount_ttc,
      payload.discount ?? null,
      payload.allocation_targets && payload.allocation_targets.length > 0 ? 'manual' : 'general',
      JSON.stringify(payload.allocation_targets ?? []),
      payload.linked_campaign ?? null,
      payload.notes ?? null
    );
  return { id: Number(info.lastInsertRowid) };
}

export function assignBoost(
  db: Database.Database,
  payload: { id: number; allocation_targets: AllocationTarget[]; linked_campaign?: string | null }
): { ok: true } {
  db.prepare(
    `UPDATE boosts SET
       allocation_method=?, allocation_targets=?, linked_campaign=?, updated_at=datetime('now')
     WHERE id=?`
  ).run(
    payload.allocation_targets.length > 0 ? 'manual' : 'general',
    JSON.stringify(payload.allocation_targets),
    payload.linked_campaign ?? null,
    payload.id
  );
  return { ok: true };
}

export function deleteBoost(db: Database.Database, id: number): { ok: true } {
  db.prepare('DELETE FROM boosts WHERE id=?').run(id);
  return { ok: true };
}

export function updateBoost(
  db: Database.Database,
  id: number,
  patch: Partial<{ amount_ttc: number; boost_type: string; notes: string | null; start_date: string }>
): { ok: true } {
  const fields: string[] = [];
  const params: unknown[] = [];
  for (const k of Object.keys(patch) as (keyof typeof patch)[]) {
    fields.push(`${k}=?`);
    params.push(patch[k]);
  }
  if (fields.length === 0) return { ok: true };
  fields.push(`updated_at=datetime('now')`);
  params.push(id);
  db.prepare(`UPDATE boosts SET ${fields.join(', ')} WHERE id=?`).run(...params);
  return { ok: true };
}
