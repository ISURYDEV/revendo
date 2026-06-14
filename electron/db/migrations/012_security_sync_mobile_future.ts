import type Database from 'better-sqlite3';

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

function addColumn(db: Database.Database, table: string, definition: string): void {
  const column = definition.trim().split(/\s+/)[0];
  if (!hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

function seedSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`).run(key, value);
}

const SYNC_TABLES = [
  { table: 'sales', entity: 'sale', modified: 'updated_at' },
  { table: 'purchases', entity: 'purchase', modified: 'updated_at' },
  { table: 'boosts', entity: 'boost', modified: 'updated_at' },
  { table: 'expenses', entity: 'expense', modified: 'updated_at' },
  { table: 'stock_items', entity: 'stock_item', modified: 'updated_at' },
  { table: 'stock_movements', entity: 'stock_movement', modified: 'created_at' },
  { table: 'documents', entity: 'document', modified: 'updated_at' },
  { table: 'declarations', entity: 'declaration', modified: 'updated_at' },
  { table: 'imports', entity: 'import', modified: 'imported_at' },
  { table: 'marketplaces', entity: 'marketplace', modified: 'updated_at' },
  { table: 'channels', entity: 'channel', modified: 'updated_at' },
  { table: 'suppliers', entity: 'supplier', modified: 'updated_at' },
  { table: 'csv_mapping_templates', entity: 'csv_mapping_template', modified: 'updated_at' }
] as const;

export const migration012 = {
  version: 12,
  name: 'security privacy and future sync foundation',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS security_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS privacy_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS encrypted_exports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        file_type TEXT NOT NULL,
        encrypted_at TEXT NOT NULL DEFAULT (datetime('now')),
        size INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS backup_integrity_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        checked_at TEXT NOT NULL DEFAULT (datetime('now')),
        backup_path TEXT NOT NULL,
        ok INTEGER NOT NULL DEFAULT 0,
        size INTEGER,
        message TEXT
      );

      CREATE TABLE IF NOT EXISTS sync_state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        local_id TEXT,
        remote_id TEXT,
        sync_status TEXT NOT NULL DEFAULT 'local_only',
        version INTEGER NOT NULL DEFAULT 1,
        last_modified_at TEXT,
        deleted_at TEXT,
        conflict_status TEXT NOT NULL DEFAULT 'none',
        payload_hash TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(entity_type, entity_id)
      );

      CREATE TABLE IF NOT EXISTS sync_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        operation TEXT NOT NULL,
        changed_at TEXT NOT NULL DEFAULT (datetime('now')),
        payload_hash TEXT,
        source TEXT NOT NULL DEFAULT 'local_app',
        sync_status TEXT NOT NULL DEFAULT 'pending',
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS mobile_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        app_version TEXT,
        redaction_mode TEXT NOT NULL DEFAULT 'anonymized',
        encrypted INTEGER NOT NULL DEFAULT 0,
        data_scope TEXT,
        size INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS data_locations (
        key TEXT PRIMARY KEY,
        path TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS security_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        details_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_sync_state_entity ON sync_state(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_sync_state_status ON sync_state(sync_status);
      CREATE INDEX IF NOT EXISTS idx_sync_state_modified ON sync_state(last_modified_at);
      CREATE INDEX IF NOT EXISTS idx_sync_state_deleted ON sync_state(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_sync_changes_entity ON sync_changes(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_sync_changes_status ON sync_changes(sync_status, changed_at);
      CREATE INDEX IF NOT EXISTS idx_mobile_snapshots_generated ON mobile_snapshots(generated_at);
      CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type, created_at);
    `);

    for (const { table } of SYNC_TABLES) {
      addColumn(db, table, `sync_status TEXT NOT NULL DEFAULT 'local_only'`);
      addColumn(db, table, `sync_version INTEGER NOT NULL DEFAULT 1`);
      addColumn(db, table, `last_modified_at TEXT`);
      addColumn(db, table, `deleted_at TEXT`);
      addColumn(db, table, `deleted_reason TEXT`);
      addColumn(db, table, `restored_at TEXT`);
      addColumn(db, table, `payload_hash TEXT`);
    }

    addColumn(db, 'documents', `is_sensitive INTEGER NOT NULL DEFAULT 1`);
    addColumn(db, 'sales', `redacted_at TEXT`);

    for (const { table, entity, modified } of SYNC_TABLES) {
      db.prepare(`
        UPDATE ${table}
        SET last_modified_at = COALESCE(last_modified_at, ${modified}, datetime('now'))
        WHERE last_modified_at IS NULL
      `).run();
      db.prepare(`
        INSERT OR IGNORE INTO sync_state (
          entity_type, entity_id, local_id, sync_status, version, last_modified_at, payload_hash
        )
        SELECT ?, id, CAST(id AS TEXT), COALESCE(sync_status, 'local_only'), COALESCE(sync_version, 1), last_modified_at, payload_hash
        FROM ${table}
      `).run(entity);
    }

    seedSetting(db, 'privacy_mask_buyers_ui', 'false');
    seedSetting(db, 'privacy_mask_contact_ui', 'false');
    seedSetting(db, 'privacy_mask_username_ui', 'false');
    seedSetting(db, 'privacy_exports_anonymized_default', 'true');
    seedSetting(db, 'mobile_snapshot_redaction_enabled', 'true');
    seedSetting(db, 'mobile_snapshot_protected', 'true');
    seedSetting(db, 'security_backup_encryption_enabled', 'false');
    seedSetting(db, 'security_export_encryption_enabled', 'false');
    seedSetting(db, 'security_snapshot_encryption_enabled', 'false');
  }
};
