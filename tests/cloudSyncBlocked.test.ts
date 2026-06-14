import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runMigrations } from '../electron/db/migrations';
import { syncBackupToCloud } from '../electron/services/backup/cloudSync';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

describe('cloud sync sécurisé', () => {
  it('bloque la copie cloud quand le chiffrement est désactivé', () => {
    const db = freshDb();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revendo-cloud-'));
    const zip = path.join(dir, 'backup.zip');
    fs.writeFileSync(zip, 'backup');
    db.prepare(`INSERT INTO settings (key, value) VALUES ('cloud_sync_enabled', 'true') ON CONFLICT(key) DO UPDATE SET value='true'`).run();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('cloud_sync_folder', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(dir);
    db.prepare(`UPDATE settings SET value='false' WHERE key='security_backup_encryption_enabled'`).run();

    const blocked = syncBackupToCloud(db, zip);
    expect(blocked.ok).toBe(false);
    expect(blocked.ok ? '' : blocked.reason).toContain('chiffrement');
    const status = db.prepare(`SELECT value FROM settings WHERE key='cloud_sync_last_status'`).get() as { value: string };
    expect(status.value).toBe('blocked_no_encryption');

    db.prepare(`UPDATE settings SET value='true' WHERE key='security_backup_encryption_enabled'`).run();
    const copied = syncBackupToCloud(db, zip, { kind: 'manual' });
    expect(copied.ok).toBe(true);
  });
});
