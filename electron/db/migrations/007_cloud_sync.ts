import type Database from 'better-sqlite3';

export const migration007 = {
  version: 7,
  name: 'cloud sync settings',
  up(db: Database.Database) {
    db.exec(`
      INSERT INTO settings (key, value) VALUES
        ('cloud_sync_enabled', 'false'),
        ('cloud_sync_folder', ''),
        ('cloud_sync_provider_hint', ''),
        ('cloud_sync_keep_versions', '60'),
        ('cloud_sync_last_run', ''),
        ('cloud_sync_last_status', ''),
        ('cloud_sync_last_error', '');
    `);
  }
};
