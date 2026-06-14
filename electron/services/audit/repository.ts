import type Database from 'better-sqlite3';

export type AuditEntity =
  | 'sale'
  | 'expense'
  | 'boost'
  | 'purchase'
  | 'document'
  | 'stock_item';

export type AuditOperation = 'CREATE' | 'UPDATE' | 'DELETE' | 'REVERT';

/** Map entity type → DB table. Single source of truth for revert SQL. */
const TABLE_FOR: Record<AuditEntity, string> = {
  sale: 'sales',
  expense: 'expenses',
  boost: 'boosts',
  purchase: 'purchases',
  document: 'documents',
  stock_item: 'stock_items'
};

export interface AuditRow {
  id: number;
  changed_at: string;
  entity_type: AuditEntity;
  entity_id: number;
  operation: AuditOperation;
  prev_value: string | null;
  new_value: string | null;
  reverted_from: number | null;
  note: string | null;
}

export function recordAudit(
  db: Database.Database,
  payload: {
    entity_type: AuditEntity;
    entity_id: number;
    operation: AuditOperation;
    prev_value?: Record<string, unknown> | null;
    new_value?: Record<string, unknown> | null;
    reverted_from?: number | null;
    note?: string | null;
  }
): void {
  db.prepare(
    `INSERT INTO audit_log (entity_type, entity_id, operation, prev_value, new_value, reverted_from, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    payload.entity_type,
    payload.entity_id,
    payload.operation,
    payload.prev_value ? JSON.stringify(payload.prev_value) : null,
    payload.new_value ? JSON.stringify(payload.new_value) : null,
    payload.reverted_from ?? null,
    payload.note ?? null
  );
}

/** Fetch the current row of an entity (used to record prev_value before a change). */
export function snapshotRow(
  db: Database.Database,
  entity: AuditEntity,
  id: number
): Record<string, unknown> | null {
  const table = TABLE_FOR[entity];
  const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return row ?? null;
}

export function listAuditFor(
  db: Database.Database,
  entity: AuditEntity,
  entityId: number
): AuditRow[] {
  return db
    .prepare(
      `SELECT * FROM audit_log WHERE entity_type=? AND entity_id=? ORDER BY changed_at DESC`
    )
    .all(entity, entityId) as AuditRow[];
}

export function listRecentAudit(db: Database.Database, limit = 200): AuditRow[] {
  return db
    .prepare(`SELECT * FROM audit_log ORDER BY changed_at DESC LIMIT ?`)
    .all(limit) as AuditRow[];
}

/**
 * Revert a single audit entry.
 *
 * Semantics:
 *   - DELETE → re-insert row using prev_value (preserves original id).
 *   - UPDATE → re-write the row with prev_value column values.
 *   - CREATE → delete the row.
 *   - REVERT → revert the revert (= re-apply the original change).
 *
 * Logs the revert itself as a new audit entry of operation='REVERT', so reverts are themselves reversible.
 */
export function revertAuditEntry(db: Database.Database, auditId: number): { ok: true } {
  const entry = db
    .prepare(`SELECT * FROM audit_log WHERE id=?`)
    .get(auditId) as AuditRow | undefined;
  if (!entry) throw new Error(`Entrée d'audit #${auditId} introuvable.`);

  const table = TABLE_FOR[entry.entity_type];
  if (!table) throw new Error(`Entity type non supporté: ${entry.entity_type}`);

  const prev = entry.prev_value ? (JSON.parse(entry.prev_value) as Record<string, unknown>) : null;
  const next = entry.new_value ? (JSON.parse(entry.new_value) as Record<string, unknown>) : null;

  const tx = db.transaction(() => {
    let restored: Record<string, unknown> | null = null;
    let originalAfter: Record<string, unknown> | null = null;

    if (entry.operation === 'DELETE') {
      if (!prev) throw new Error('Imposible revertir un DELETE sin snapshot previo.');
      // Re-insert preserving id
      const cols = Object.keys(prev);
      const placeholders = cols.map(() => '?').join(', ');
      db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`).run(
        ...cols.map((c) => coerce(prev[c]))
      );
      restored = prev;
    } else if (entry.operation === 'UPDATE') {
      if (!prev) throw new Error('Imposible revertir un UPDATE sin snapshot previo.');
      const cols = Object.keys(prev).filter((k) => k !== 'id');
      const sets = cols.map((c) => `${c}=?`).join(', ');
      db.prepare(`UPDATE ${table} SET ${sets} WHERE id=?`).run(
        ...cols.map((c) => coerce(prev[c])),
        entry.entity_id
      );
      originalAfter = next;
      restored = prev;
    } else if (entry.operation === 'CREATE') {
      // To revert a CREATE → delete the row
      originalAfter = next;
      db.prepare(`DELETE FROM ${table} WHERE id=?`).run(entry.entity_id);
    } else if (entry.operation === 'REVERT') {
      // Re-apply the inverse: just re-run the previous logic
      // Simple approach: treat as UPDATE using the new_value of the original entry
      if (!next) throw new Error('Imposible volver a revertir sin new_value.');
      const cols = Object.keys(next).filter((k) => k !== 'id');
      const sets = cols.map((c) => `${c}=?`).join(', ');
      db.prepare(`UPDATE ${table} SET ${sets} WHERE id=?`).run(
        ...cols.map((c) => coerce(next[c])),
        entry.entity_id
      );
      restored = next;
    }

    recordAudit(db, {
      entity_type: entry.entity_type,
      entity_id: entry.entity_id,
      operation: 'REVERT',
      prev_value: originalAfter ?? null,
      new_value: restored ?? null,
      reverted_from: entry.id,
      note: `Revert de auditoría #${entry.id} (${entry.operation})`
    });
  });
  tx();
  return { ok: true };
}

function coerce(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}
