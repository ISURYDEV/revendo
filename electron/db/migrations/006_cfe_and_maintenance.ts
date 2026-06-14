import type Database from 'better-sqlite3';

/**
 * Migration 006:
 *  - Add cfe_payments table (annual CFE tracking)
 *  - Add maintenance settings for audit log rotation
 */
export const migration006 = {
  version: 6,
  name: 'CFE tracking + audit rotation settings',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE cfe_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year INTEGER NOT NULL UNIQUE,
        amount_paid REAL,
        paid_date TEXT,
        exonerated INTEGER NOT NULL DEFAULT 0,
        document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO settings (key, value) VALUES
        ('audit_log_retention_months', '12'),
        ('last_maintenance_run', '');
    `);
  }
};
