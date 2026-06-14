import type Database from 'better-sqlite3';

/**
 * Migration 003: global audit_log table.
 *
 * Captures every CREATE/UPDATE/DELETE on the entities the user can edit by hand.
 * Stores full row snapshot as JSON (prev_value + new_value) so we can:
 *   - show change history per row
 *   - revert any past change (re-INSERT a deleted row, or re-UPDATE prev values)
 *
 * Non-destructive: no schema changes to existing tables.
 */
export const migration003 = {
  version: 3,
  name: 'audit log',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        changed_at TEXT NOT NULL DEFAULT (datetime('now')),
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        operation TEXT NOT NULL,  -- CREATE | UPDATE | DELETE | REVERT
        prev_value TEXT,           -- JSON of the row BEFORE change (null for CREATE)
        new_value TEXT,            -- JSON of the row AFTER change  (null for DELETE)
        reverted_from INTEGER REFERENCES audit_log(id) ON DELETE SET NULL,
        note TEXT
      );
      CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
      CREATE INDEX idx_audit_at ON audit_log(changed_at DESC);
    `);
  }
};
