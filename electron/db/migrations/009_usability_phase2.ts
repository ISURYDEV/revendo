import type Database from 'better-sqlite3';

export const migration009 = {
  version: 9,
  name: 'phase 2 review center saved filters and bulk actions',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS saved_filters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        name TEXT NOT NULL,
        filter_state_json TEXT NOT NULL,
        is_favorite INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_saved_filters_entity ON saved_filters(entity_type, is_favorite, updated_at);

      CREATE TABLE IF NOT EXISTS review_ignored_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        review_key TEXT NOT NULL UNIQUE,
        module TEXT NOT NULL,
        entity_type TEXT,
        entity_id INTEGER,
        status TEXT NOT NULL DEFAULT 'ignored',
        note TEXT NOT NULL,
        ignored_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_review_ignored_module ON review_ignored_items(module, entity_type, entity_id);

      CREATE TABLE IF NOT EXISTS bulk_action_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        action TEXT NOT NULL,
        entity_ids_json TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_bulk_action_log_entity ON bulk_action_log(entity_type, created_at);
    `);
  }
};
