import crypto from 'node:crypto';
import type Database from 'better-sqlite3';

export type SyncOperation = 'create' | 'update' | 'delete' | 'restore';
export type SyncSource = 'local_app' | 'import' | 'bulk_action' | 'migration';

export function payloadHash(payload: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(payload ?? null)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(',')}}`;
}

function currentRow(db: Database.Database, table: string, id: number): Record<string, unknown> | null {
  try {
    return (db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as Record<string, unknown> | undefined) ?? null;
  } catch {
    return null;
  }
}

const TABLE_BY_ENTITY: Record<string, string> = {
  sale: 'sales',
  purchase: 'purchases',
  expense: 'expenses',
  boost: 'boosts',
  document: 'documents',
  stock_item: 'stock_items',
  stock_movement: 'stock_movements',
  declaration: 'declarations',
  import: 'imports',
  marketplace: 'marketplaces',
  channel: 'channels',
  supplier: 'suppliers',
  csv_mapping_template: 'csv_mapping_templates'
};

export function recordSyncChange(
  db: Database.Database,
  entityType: string,
  entityId: number,
  operation: SyncOperation,
  source: SyncSource = 'local_app',
  notes?: string | null
): { ok: true; hash: string } {
  const hasSyncTables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='sync_changes'`).get();
  if (!hasSyncTables) return { ok: true, hash: '' };
  const table = TABLE_BY_ENTITY[entityType];
  const row = table ? currentRow(db, table, entityId) : null;
  const hash = payloadHash(row ?? { entityType, entityId, operation, deleted: true });
  db.prepare(`
    INSERT INTO sync_changes (entity_type, entity_id, operation, payload_hash, source, sync_status, notes)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(entityType, entityId, operation, hash, source, notes ?? null);

  const previous = db.prepare(`SELECT version FROM sync_state WHERE entity_type=? AND entity_id=?`)
    .get(entityType, entityId) as { version: number } | undefined;
  const nextVersion = (previous?.version ?? 0) + 1;
  db.prepare(`
    INSERT INTO sync_state (
      entity_type, entity_id, local_id, sync_status, version, last_modified_at, deleted_at, payload_hash, updated_at
    )
    VALUES (?, ?, ?, 'pending', ?, datetime('now'), ?, ?, datetime('now'))
    ON CONFLICT(entity_type, entity_id) DO UPDATE SET
      sync_status='pending',
      version=excluded.version,
      last_modified_at=datetime('now'),
      deleted_at=excluded.deleted_at,
      payload_hash=excluded.payload_hash,
      updated_at=datetime('now')
  `).run(entityType, entityId, String(entityId), nextVersion, operation === 'delete' ? new Date().toISOString() : null, hash);

  return { ok: true, hash };
}

export function softDeleteEntity(
  db: Database.Database,
  entityType: string,
  entityId: number,
  reason: string,
  source: SyncSource = 'local_app'
): { ok: true } {
  const table = TABLE_BY_ENTITY[entityType];
  if (!table) throw new Error(`Entité non prise en charge pour soft delete : ${entityType}`);
  db.prepare(`
    UPDATE ${table}
    SET deleted_at=datetime('now'), deleted_reason=?, sync_status='pending', sync_version=COALESCE(sync_version, 1) + 1
    WHERE id=?
  `).run(reason, entityId);
  recordSyncChange(db, entityType, entityId, 'delete', source, reason);
  return { ok: true };
}

export function restoreEntity(
  db: Database.Database,
  entityType: string,
  entityId: number,
  source: SyncSource = 'local_app'
): { ok: true } {
  const table = TABLE_BY_ENTITY[entityType];
  if (!table) throw new Error(`Entité non prise en charge pour restore : ${entityType}`);
  db.prepare(`
    UPDATE ${table}
    SET deleted_at=NULL, deleted_reason=NULL, restored_at=datetime('now'), sync_status='pending', sync_version=COALESCE(sync_version, 1) + 1
    WHERE id=?
  `).run(entityId);
  recordSyncChange(db, entityType, entityId, 'restore', source, 'Restauration locale');
  return { ok: true };
}

export function getSyncOverview(db: Database.Database): {
  configured: false;
  localOnly: true;
  pendingChanges: number;
  lastModifiedAt: string | null;
  conflicts: number;
} {
  const pending = db.prepare(`SELECT COUNT(*) AS n FROM sync_changes WHERE sync_status='pending'`).get() as { n: number };
  const last = db.prepare(`SELECT MAX(changed_at) AS t FROM sync_changes`).get() as { t: string | null };
  const conflicts = db.prepare(`SELECT COUNT(*) AS n FROM sync_state WHERE conflict_status IS NOT NULL AND conflict_status != 'none'`).get() as { n: number };
  return {
    configured: false,
    localOnly: true,
    pendingChanges: pending.n,
    lastModifiedAt: last.t ?? null,
    conflicts: conflicts.n
  };
}
