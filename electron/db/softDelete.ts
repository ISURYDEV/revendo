import type Database from 'better-sqlite3';

export function ensureSoftDeleteColumns(db: Database.Database, tables: string[]): void {
  for (const table of tables) {
    const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
    if (!exists) continue;
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'deleted_at')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN deleted_at TEXT`);
    }
    if (!cols.some((c) => c.name === 'deleted_reason')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN deleted_reason TEXT`);
    }
  }
}
