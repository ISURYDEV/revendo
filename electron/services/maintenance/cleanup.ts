import type Database from 'better-sqlite3';
import { purgeTrash } from '../documents/trash';

/**
 * Rotate audit log: delete entries older than `monthsToKeep`.
 * Runs at app startup if last run was >24h ago. Vacuums periodically.
 */
export function rotateAuditLog(db: Database.Database): { deleted: number } {
  const monthsRow = db.prepare(`SELECT value FROM settings WHERE key='audit_log_retention_months'`).get() as { value: string } | undefined;
  const months = monthsRow ? Math.max(1, Number(monthsRow.value) || 12) : 12;
  const cutoff = new Date(Date.now() - months * 30 * 24 * 60 * 60 * 1000).toISOString();
  const info = db.prepare(`DELETE FROM audit_log WHERE changed_at < ?`).run(cutoff);
  return { deleted: info.changes };
}

/** Called at startup. Idempotent. */
export function maybeRunMaintenance(db: Database.Database): void {
  const lastRow = db.prepare(`SELECT value FROM settings WHERE key='last_maintenance_run'`).get() as { value: string } | undefined;
  const last = lastRow?.value ? new Date(lastRow.value).getTime() : 0;
  const elapsedHours = (Date.now() - last) / (60 * 60 * 1000);
  if (elapsedHours < 24) return;

  rotateAuditLog(db);
  purgeTrash(db, 30);

  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('last_maintenance_run', ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).run(new Date().toISOString());
}
