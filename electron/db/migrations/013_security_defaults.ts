import type Database from 'better-sqlite3';

function seedDefault(db: Database.Database, key: string, value: string): void {
  db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`).run(key, value);
}

export const migration013 = {
  version: 13,
  name: 'security encryption defaults',
  up(db: Database.Database) {
    seedDefault(db, 'security_backup_encryption_enabled', 'true');
    seedDefault(db, 'security_export_encryption_enabled', 'true');
    seedDefault(db, 'security_snapshot_encryption_enabled', 'true');
  }
};
