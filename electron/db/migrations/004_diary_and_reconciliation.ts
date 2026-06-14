import type Database from 'better-sqlite3';

/**
 * Migration 004:
 *  - Diary: free-form per-day notes ("hoy fui a brocante, compré X")
 *  - Bank transactions: imported from bank CSV for reconciliation
 *  - Reconciliation matches: links between bank rows and sales/expenses
 *  - Seuils defaults in settings
 *  - reminders_state to remember dismissed reminders
 */
export const migration004 = {
  version: 4,
  name: 'diary reconciliation reminders seuils',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE diary_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_date TEXT NOT NULL,
        note TEXT NOT NULL,
        tags TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_diary_date ON diary_entries(entry_date DESC);

      CREATE TABLE bank_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        import_id INTEGER REFERENCES imports(id) ON DELETE SET NULL,
        bank_name TEXT,
        external_ref TEXT,
        transaction_date TEXT NOT NULL,
        value_date TEXT,
        label TEXT,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'EUR',
        balance_after REAL,
        notes TEXT,
        matched_entity_type TEXT,
        matched_entity_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_bank_date ON bank_transactions(transaction_date DESC);
      CREATE INDEX idx_bank_amount ON bank_transactions(amount);

      CREATE TABLE reminders_state (
        reminder_key TEXT PRIMARY KEY,
        dismissed_until TEXT,
        last_shown TEXT
      );

      INSERT INTO settings (key, value) VALUES
        ('seuil_marchandises', '85000'),
        ('seuil_tva_franchise', '91900'),
        ('seuil_marchandises_warning_at', '0.75'),
        ('seuil_marchandises_danger_at', '0.9'),
        ('backup_enabled', 'true'),
        ('backup_keep_daily_days', '30'),
        ('cfe_reminder_date', '12-01');
    `);
  }
};
