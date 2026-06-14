import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import type Database from 'better-sqlite3';
import { app } from 'electron';
import { getBackupsDir, getDataDir, getDocumentsDir } from '../../db/connection';
import { syncBackupToCloud, syncDocumentsToCloud, syncMobileSnapshotToCloud } from './cloudSync';

export interface BackupResult {
  path: string;
  size: number;
  createdAt: string;
}

/**
 * Snapshot the SQLite file (via VACUUM INTO for a consistent copy even if
 * WAL is active) + zip with documents folder. Returns the zip path.
 *
 * `kind` = 'daily' | 'monthly' | 'manual'.
 */
export async function createBackup(
  db: Database.Database,
  options: { kind?: 'daily' | 'monthly' | 'manual'; destPath?: string; includeDocs?: boolean } = {}
): Promise<BackupResult> {
  const kind = options.kind ?? 'manual';
  const includeDocs = options.includeDocs ?? true;
  const today = new Date().toISOString().slice(0, 10);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  const backupsDir = getBackupsDir();
  const dailyDir = path.join(backupsDir, 'daily');
  const monthlyDir = path.join(backupsDir, 'monthly');
  fs.mkdirSync(dailyDir, { recursive: true });
  fs.mkdirSync(monthlyDir, { recursive: true });

  const fileName = `revendo_${today}_${kind}.zip`;
  let destination: string;
  if (options.destPath) {
    destination = options.destPath;
  } else if (kind === 'monthly') {
    destination = path.join(monthlyDir, `revendo_${today.slice(0, 7)}.zip`);
  } else {
    destination = path.join(dailyDir, fileName);
  }

  // Step 1: VACUUM INTO a temporary file for a consistent snapshot
  const tmpSqlite = path.join(getDataDir(), `_backup_${ts}.sqlite`);
  // VACUUM INTO requires the target file not to exist
  if (fs.existsSync(tmpSqlite)) fs.unlinkSync(tmpSqlite);
  db.exec(`VACUUM INTO '${tmpSqlite.replace(/'/g, "''")}';`);

  // Step 2: zip it together with documents folder
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(destination);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve());
    archive.on('error', reject);
    archive.pipe(output);

    archive.file(tmpSqlite, { name: 'data/revendo.sqlite' });
    archive.append(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          appVersion: app.getVersion(),
          kind,
          includeDocs
        },
        null,
        2
      ),
      { name: 'manifest.json' }
    );
    if (includeDocs) {
      const docsDir = getDocumentsDir();
      if (fs.existsSync(docsDir)) {
        archive.directory(docsDir, 'documents');
      }
    }
    archive.finalize();
  });

  // Step 3: cleanup tmp
  if (fs.existsSync(tmpSqlite)) fs.unlinkSync(tmpSqlite);

  const stat = fs.statSync(destination);
  return { path: destination, size: stat.size, createdAt: new Date().toISOString() };
}

/**
 * Retention policy:
 *  - daily/  → keep the last N daily zips (default 30)
 *  - monthly/ → keep all (one per month)
 *  - if a backup of "today" already exists in daily/, replace it
 *  - on the 1st of the month, also write to monthly/
 */
export async function runScheduledBackup(db: Database.Database, keepDailyDays = 30): Promise<BackupResult[]> {
  const results: BackupResult[] = [];
  const today = new Date();
  const isFirstOfMonth = today.getUTCDate() === 1;

  // Daily backup (overwrite today's)
  const daily = await createBackup(db, { kind: 'daily' });
  results.push(daily);
  // Mirror to cloud sync folder if configured (Google Drive / OneDrive / Dropbox / iCloud)
  try { syncBackupToCloud(db, daily.path, { kind: 'daily' }); } catch { /* best-effort */ }
  // Also mirror documents + regenerate mobile snapshot (so the phone sees fresh data)
  try { syncDocumentsToCloud(db); } catch { /* best-effort */ }
  try { syncMobileSnapshotToCloud(db); } catch { /* best-effort */ }

  // Monthly snapshot on the 1st
  if (isFirstOfMonth) {
    const monthly = await createBackup(db, { kind: 'monthly' });
    results.push(monthly);
    try { syncBackupToCloud(db, monthly.path, { kind: 'monthly' }); } catch { /* best-effort */ }
  }

  // Retention: prune old daily backups
  const dailyDir = path.join(getBackupsDir(), 'daily');
  if (fs.existsSync(dailyDir)) {
    const files = fs
      .readdirSync(dailyDir)
      .filter((f) => f.endsWith('.zip'))
      .map((f) => ({ f, path: path.join(dailyDir, f), mtime: fs.statSync(path.join(dailyDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const file of files.slice(keepDailyDays)) {
      try { fs.unlinkSync(file.path); } catch { /* ignore */ }
    }
  }

  return results;
}

export function listBackups(): { kind: string; path: string; name: string; size: number; mtime: string }[] {
  const out: { kind: string; path: string; name: string; size: number; mtime: string }[] = [];
  for (const kind of ['daily', 'monthly'] as const) {
    const dir = path.join(getBackupsDir(), kind);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.zip')) continue;
      const fp = path.join(dir, f);
      const stat = fs.statSync(fp);
      out.push({ kind, path: fp, name: f, size: stat.size, mtime: new Date(stat.mtimeMs).toISOString() });
    }
  }
  out.sort((a, b) => b.mtime.localeCompare(a.mtime));
  return out;
}
