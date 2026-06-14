import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { getDocumentsDir } from '../../db/connection';
import { generateMobileHtml } from '../mobile/snapshotGenerator';

export type CloudProvider = 'google_drive' | 'onedrive' | 'dropbox' | 'icloud' | 'other';

export interface DetectedFolder {
  provider: CloudProvider;
  label: string;
  path: string;
  exists: boolean;
}

/**
 * Detect well-known cloud sync folders on this machine.
 * - Google Drive Desktop creates ~/Google Drive/ (legacy) or maps G:\My Drive\ (modern).
 * - OneDrive: ~/OneDrive/
 * - Dropbox: ~/Dropbox/
 * - iCloud (Win): ~/iCloudDrive/
 */
export function detectCloudFolders(): DetectedFolder[] {
  const home = os.homedir();
  const candidates: DetectedFolder[] = [];

  // Google Drive
  const googleCandidates = [
    path.join(home, 'Google Drive'),
    path.join(home, 'GoogleDrive'),
    'G:\\My Drive',
    'G:\\Mon Drive',
    path.join(home, 'Drive Personnel')
  ];
  for (const p of googleCandidates) {
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      candidates.push({ provider: 'google_drive', label: 'Google Drive', path: p, exists: true });
      break;
    }
  }

  // OneDrive
  const oneDriveCandidates = [
    path.join(home, 'OneDrive'),
    process.env.OneDrive ?? '',
    process.env.OneDriveCommercial ?? '',
    process.env.OneDriveConsumer ?? ''
  ].filter((p) => p && p.length > 0);
  for (const p of oneDriveCandidates) {
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      candidates.push({ provider: 'onedrive', label: 'OneDrive', path: p, exists: true });
      break;
    }
  }

  // Dropbox
  for (const p of [path.join(home, 'Dropbox'), path.join(home, 'Dropbox (Personal)')]) {
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      candidates.push({ provider: 'dropbox', label: 'Dropbox', path: p, exists: true });
      break;
    }
  }

  // iCloud Drive on Windows
  for (const p of [path.join(home, 'iCloudDrive'), path.join(home, 'iCloud Drive')]) {
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      candidates.push({ provider: 'icloud', label: 'iCloud Drive', path: p, exists: true });
      break;
    }
  }

  return candidates;
}

function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare(`SELECT value FROM settings WHERE key=?`).get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).run(key, value);
}

function recordSecurityEvent(db: Database.Database, eventType: string, details: Record<string, unknown>): void {
  try {
    db.prepare(`INSERT INTO security_events (event_type, details_json) VALUES (?, ?)`)
      .run(eventType, JSON.stringify(details));
  } catch {
    // Le journal de sécurité ne doit jamais bloquer la sauvegarde.
  }
}

function blockCloudWithoutEncryption(db: Database.Database, scope: string): { ok: false; reason: string } | null {
  if (getSetting(db, 'security_backup_encryption_enabled') === 'true') return null;
  const reason = 'Cloud sync requiert le chiffrement activé (Réglages → Sécurité).';
  setSetting(db, 'cloud_sync_last_status', 'blocked_no_encryption');
  setSetting(db, 'cloud_sync_last_error', reason);
  recordSecurityEvent(db, 'cloud_sync_blocked_no_encryption', { scope });
  return { ok: false, reason };
}

/**
 * Copy a backup zip to the configured cloud sync folder.
 * Idempotent: if the file already exists with same size, skips.
 * Rotates: keeps last N daily zips in the folder (monthly snapshots survive).
 */
export function syncBackupToCloud(
  db: Database.Database,
  backupZipPath: string,
  options: { kind?: 'daily' | 'monthly' | 'manual' } = {}
): { ok: true; copiedTo: string } | { ok: false; reason: string } {
  if (!fs.existsSync(backupZipPath)) {
    return { ok: false, reason: 'Fichier backup introuvable.' };
  }
  const enabled = getSetting(db, 'cloud_sync_enabled') === 'true';
  if (!enabled) return { ok: false, reason: 'Cloud sync désactivé dans Réglages.' };
  const encryptionBlock = blockCloudWithoutEncryption(db, 'backup');
  if (encryptionBlock) return encryptionBlock;

  const baseFolder = getSetting(db, 'cloud_sync_folder');
  if (!baseFolder || !fs.existsSync(baseFolder)) {
    setSetting(db, 'cloud_sync_last_status', 'error');
    setSetting(db, 'cloud_sync_last_error', `Dossier cloud introuvable: ${baseFolder}`);
    return { ok: false, reason: 'Dossier cloud introuvable. Vérifiez que Google Drive Desktop est actif.' };
  }

  const subDir = options.kind === 'monthly' ? 'monthly' : 'daily';
  const targetDir = path.join(baseFolder, 'Revendo Backups', subDir);
  fs.mkdirSync(targetDir, { recursive: true });

  const destPath = path.join(targetDir, path.basename(backupZipPath));

  // Skip if identical (same size)
  if (fs.existsSync(destPath)) {
    const srcSize = fs.statSync(backupZipPath).size;
    const dstSize = fs.statSync(destPath).size;
    if (srcSize === dstSize) {
      setSetting(db, 'cloud_sync_last_run', new Date().toISOString());
      setSetting(db, 'cloud_sync_last_status', 'skipped');
      setSetting(db, 'cloud_sync_last_error', '');
      return { ok: true, copiedTo: destPath };
    }
  }

  try {
    fs.copyFileSync(backupZipPath, destPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setSetting(db, 'cloud_sync_last_status', 'error');
    setSetting(db, 'cloud_sync_last_error', msg);
    return { ok: false, reason: msg };
  }

  // Rotation: keep last N daily files in the cloud folder
  if (subDir === 'daily') {
    const keepRow = getSetting(db, 'cloud_sync_keep_versions');
    const keep = Math.max(7, Number(keepRow) || 60);
    try {
      const files = fs
        .readdirSync(targetDir)
        .filter((f) => f.endsWith('.zip'))
        .map((f) => ({ f, p: path.join(targetDir, f), mtime: fs.statSync(path.join(targetDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      for (const f of files.slice(keep)) {
        try { fs.unlinkSync(f.p); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  setSetting(db, 'cloud_sync_last_run', new Date().toISOString());
  setSetting(db, 'cloud_sync_last_status', 'ok');
  setSetting(db, 'cloud_sync_last_error', '');
  return { ok: true, copiedTo: destPath };
}

export interface CloudStatus {
  enabled: boolean;
  folder: string | null;
  providerHint: CloudProvider | null;
  keepVersions: number;
  lastRun: string | null;
  lastStatus: 'ok' | 'error' | 'skipped' | null;
  lastError: string | null;
  folderExists: boolean;
  detectedFolders: DetectedFolder[];
  includeDocuments: boolean;
  includeMobile: boolean;
  documentsLastSync: string | null;
  documentsFilesSynced: number;
  mobileLastGen: string | null;
}

export function getCloudStatus(db: Database.Database): CloudStatus {
  const folder = getSetting(db, 'cloud_sync_folder');
  return {
    enabled: getSetting(db, 'cloud_sync_enabled') === 'true',
    folder: folder || null,
    providerHint: (getSetting(db, 'cloud_sync_provider_hint') as CloudProvider) || null,
    keepVersions: Number(getSetting(db, 'cloud_sync_keep_versions') || '60'),
    lastRun: getSetting(db, 'cloud_sync_last_run') || null,
    lastStatus: (getSetting(db, 'cloud_sync_last_status') as CloudStatus['lastStatus']) || null,
    lastError: getSetting(db, 'cloud_sync_last_error') || null,
    folderExists: folder ? fs.existsSync(folder) : false,
    detectedFolders: detectCloudFolders(),
    includeDocuments: getSetting(db, 'cloud_include_documents') === 'true',
    includeMobile: getSetting(db, 'cloud_include_mobile') === 'true',
    documentsLastSync: getSetting(db, 'cloud_documents_last_sync') || null,
    documentsFilesSynced: Number(getSetting(db, 'cloud_documents_files_synced') || '0'),
    mobileLastGen: getSetting(db, 'cloud_mobile_last_gen') || null
  };
}

function quickHash(filePath: string): string {
  // Cheap hash: size + mtime. Avoids reading large files repeatedly.
  const s = fs.statSync(filePath);
  return crypto.createHash('md5').update(`${s.size}-${s.mtimeMs}`).digest('hex').slice(0, 16);
}

function mirrorDirectory(srcDir: string, dstDir: string, manifest: Record<string, string>): { copied: number; total: number } {
  let copied = 0;
  let total = 0;
  if (!fs.existsSync(srcDir)) return { copied: 0, total: 0 };
  fs.mkdirSync(dstDir, { recursive: true });

  const walk = (relPath: string) => {
    const src = path.join(srcDir, relPath);
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(src);
      fs.mkdirSync(path.join(dstDir, relPath), { recursive: true });
      for (const e of entries) walk(path.join(relPath, e));
      return;
    }
    total += 1;
    const dst = path.join(dstDir, relPath);
    const h = quickHash(src);
    if (manifest[relPath] === h && fs.existsSync(dst)) return; // already in sync
    fs.copyFileSync(src, dst);
    manifest[relPath] = h;
    copied += 1;
  };
  walk('');
  return { copied, total };
}

/**
 * Mirror the local documents/ folder to Drive: <cloud_folder>/Revendo Backups/documents/.
 * Uses a manifest (cached in settings) of (relative path → quick hash) to avoid recopying
 * unchanged files. Returns count of newly copied files.
 */
export function syncDocumentsToCloud(db: Database.Database): { ok: true; copied: number; total: number } | { ok: false; reason: string } {
  if (getSetting(db, 'cloud_sync_enabled') !== 'true') return { ok: false, reason: 'Cloud sync désactivé.' };
  if (getSetting(db, 'cloud_include_documents') !== 'true') return { ok: false, reason: 'Sync documents désactivé.' };
  const encryptionBlock = blockCloudWithoutEncryption(db, 'documents');
  if (encryptionBlock) return encryptionBlock;
  const baseFolder = getSetting(db, 'cloud_sync_folder');
  if (!baseFolder || !fs.existsSync(baseFolder)) return { ok: false, reason: 'Dossier cloud introuvable.' };

  const srcDocs = getDocumentsDir();
  const dstDocs = path.join(baseFolder, 'Revendo Backups', 'documents');
  fs.mkdirSync(dstDocs, { recursive: true });

  // Manifest path: a small file beside the documents to track what's already there.
  const manifestPath = path.join(dstDocs, '.sync_manifest.json');
  let manifest: Record<string, string> = {};
  if (fs.existsSync(manifestPath)) {
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); } catch { manifest = {}; }
  }
  const r = mirrorDirectory(srcDocs, dstDocs, manifest);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf-8');

  setSetting(db, 'cloud_documents_last_sync', new Date().toISOString());
  setSetting(db, 'cloud_documents_files_synced', String(r.total));
  return { ok: true, copied: r.copied, total: r.total };
}

/**
 * Generate the self-contained mobile HTML and write it to the cloud folder.
 * The HTML embeds all data and is read-only; users open it via Google Drive Android app.
 */
export function syncMobileSnapshotToCloud(db: Database.Database): { ok: true; path: string; size: number; rowCount: number } | { ok: false; reason: string } {
  if (getSetting(db, 'cloud_sync_enabled') !== 'true') return { ok: false, reason: 'Cloud sync désactivé.' };
  if (getSetting(db, 'cloud_include_mobile') !== 'true') return { ok: false, reason: 'Snapshot mobile désactivé.' };
  const encryptionBlock = blockCloudWithoutEncryption(db, 'mobile');
  if (encryptionBlock) return encryptionBlock;
  const baseFolder = getSetting(db, 'cloud_sync_folder');
  if (!baseFolder || !fs.existsSync(baseFolder)) return { ok: false, reason: 'Dossier cloud introuvable.' };

  const mobileDir = path.join(baseFolder, 'Revendo Backups', 'mobile');
  const outPath = path.join(mobileDir, 'revendo_mobile.html');
  const result = generateMobileHtml(db, outPath, { anonymized: getSetting(db, 'mobile_snapshot_redaction_enabled') !== 'false' });
  setSetting(db, 'cloud_mobile_last_gen', new Date().toISOString());
  return { ok: true, ...result };
}
