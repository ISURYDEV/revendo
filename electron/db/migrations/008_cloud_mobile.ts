import type Database from 'better-sqlite3';

export const migration008 = {
  version: 8,
  name: 'cloud mobile snapshot + documents mirror',
  up(db: Database.Database) {
    db.exec(`
      INSERT INTO settings (key, value) VALUES
        ('cloud_include_documents', 'true'),
        ('cloud_include_mobile', 'true'),
        ('cloud_documents_last_sync', ''),
        ('cloud_documents_files_synced', '0'),
        ('cloud_mobile_last_gen', '');
    `);
  }
};
