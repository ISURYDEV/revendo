import type Database from 'better-sqlite3';

/**
 * Migration 015 — Audit table for mobile action imports.
 *
 * Each time the user imports a JSON bundle of actions from the mobile PWA,
 * a row is written here with:
 *  - which file was imported (path + sha-256 hash to detect re-imports)
 *  - how many actions were validated / applied / rejected
 *  - the structured errors per action (JSON)
 *
 * No automatic sync, no cloud. Purely a local log used by the UI to show
 * past imports and prevent accidental re-application.
 */
export const migration015 = {
  version: 15,
  name: 'mobile action imports audit',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mobile_action_imports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        imported_at TEXT NOT NULL DEFAULT (datetime('now')),
        file_name TEXT NOT NULL,
        file_hash TEXT NOT NULL,
        bundle_schema_version TEXT NOT NULL,
        bundle_generated_at TEXT,
        bundle_device TEXT,
        total INTEGER NOT NULL DEFAULT 0,
        applied INTEGER NOT NULL DEFAULT 0,
        rejected INTEGER NOT NULL DEFAULT 0,
        errors_json TEXT,
        UNIQUE (file_hash)
      );

      CREATE INDEX IF NOT EXISTS idx_mobile_action_imports_at
        ON mobile_action_imports(imported_at);
    `);
  }
};
