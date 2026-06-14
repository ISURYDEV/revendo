import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type Database from 'better-sqlite3';
import { app } from 'electron';
import { getBackupsDir, getDataDir, getDocumentsDir, getExportsDir, getMobileSnapshotsDir } from '../../db/connection';
import { createBackup, listBackups } from '../backup/backup';
import { decryptFile, encryptFile, looksEncryptedFile } from './crypto';
import { exportFullJson } from '../maintenance/exportJson';
import { getPrivacyOptions } from './privacy';
import { generateMobileHtml } from '../mobile/snapshotGenerator';
import { getSyncOverview } from '../sync/foundation';

function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare(`SELECT value FROM settings WHERE key=?`).get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, value);
}

function folderSize(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const walk = (p: string) => {
    for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
      const fp = path.join(p, entry.name);
      if (entry.isDirectory()) walk(fp);
      else {
        try { total += fs.statSync(fp).size; } catch { /* ignore */ }
      }
    }
  };
  walk(dir);
  return total;
}

function dbPath(): string {
  return path.join(getDataDir(), 'revendo.sqlite');
}

function safeAppVersion(): string {
  try {
    return typeof app?.getVersion === 'function' ? app.getVersion() : (process.env.npm_package_version ?? '0.1.0');
  } catch {
    return process.env.npm_package_version ?? '0.1.0';
  }
}

function latestBackup(): string | null {
  return listBackups()[0]?.path ?? null;
}

export function getSecurityPrivacyStatus(db: Database.Database) {
  const dataDir = getDataDir();
  const documentsDir = getDocumentsDir();
  const backupsDir = getBackupsDir();
  const exportsDir = getExportsDir();
  const snapshotsDir = getMobileSnapshotsDir();
  const privacy = getPrivacyOptions(db);
  return {
    appVersion: safeAppVersion(),
    localOnly: true,
    serverSync: false,
    notice: 'Aucune donnée n’est envoyée vers un serveur Revendo.',
    paths: {
      dataDir,
      dbPath: dbPath(),
      documentsDir,
      backupsDir,
      exportsDir,
      snapshotsDir,
      tempDir: os.tmpdir()
    },
    sizes: {
      databaseBytes: fs.existsSync(dbPath()) ? fs.statSync(dbPath()).size : 0,
      documentsBytes: folderSize(documentsDir),
      backupsBytes: folderSize(backupsDir),
      exportsBytes: folderSize(exportsDir)
    },
    latestBackup: latestBackup(),
    settings: {
      backupEncryptionEnabled: getSetting(db, 'security_backup_encryption_enabled') === 'true',
      exportEncryptionEnabled: getSetting(db, 'security_export_encryption_enabled') === 'true',
      snapshotEncryptionEnabled: getSetting(db, 'security_snapshot_encryption_enabled') === 'true',
      mobileSnapshotProtected: getSetting(db, 'mobile_snapshot_protected') !== 'false',
      ...privacy
    },
    sync: getSyncOverview(db)
  };
}

function recordSecurityEvent(db: Database.Database, eventType: string, details: Record<string, unknown>): void {
  try {
    db.prepare(`INSERT INTO security_events (event_type, details_json) VALUES (?, ?)`)
      .run(eventType, JSON.stringify(details));
  } catch {
    // Security events are helpful but must never block backup/export.
  }
}

export async function createEncryptedBackup(
  db: Database.Database,
  password: string
): Promise<{ path: string; size: number; createdAt: string; encrypted: true }> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const secureDir = path.join(getBackupsDir(), 'secure');
  fs.mkdirSync(secureDir, { recursive: true });
  const tmpZip = path.join(secureDir, `_revendo_secure_${ts}.zip`);
  const encPath = path.join(secureDir, `revendo_${ts}.zip.revendo.enc`);
  const plain = await createBackup(db, { kind: 'manual', destPath: tmpZip, includeDocs: true });
  const encrypted = encryptFile(plain.path, encPath, password, { type: 'backup', app: 'Revendo' });
  try { fs.unlinkSync(tmpZip); } catch { /* ignore */ }
  db.prepare(`INSERT INTO encrypted_exports (file_path, file_type, size, metadata_json) VALUES (?, 'backup', ?, ?)`)
    .run(encrypted.path, encrypted.size, JSON.stringify({ source: 'backup', createdAt: plain.createdAt }));
  setSetting(db, 'security_last_secure_backup', new Date().toISOString());
  recordSecurityEvent(db, 'encrypted_backup_created', { path: encrypted.path, size: encrypted.size });
  return { ...encrypted, createdAt: new Date().toISOString(), encrypted: true };
}

export function createJsonExport(
  db: Database.Database,
  outputPath: string,
  options: { anonymized?: boolean } = {}
) {
  const out = exportFullJson(db, outputPath, { anonymized: !!options.anonymized });
  setSetting(db, options.anonymized ? 'security_last_anonymized_export' : 'security_last_plain_export', new Date().toISOString());
  recordSecurityEvent(db, options.anonymized ? 'anonymized_export_created' : 'plain_export_created', { path: out.path, rowCount: out.rowCount });
  return out;
}

export function createEncryptedJsonExport(
  db: Database.Database,
  password: string,
  outputPath?: string,
  options: { anonymized?: boolean } = {}
): { path: string; size: number; rowCount: number; encrypted: true; anonymized: boolean } {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = getExportsDir();
  const tmp = path.join(dir, `_revendo_export_${ts}.json`);
  const target = outputPath ?? path.join(dir, `revendo_export_${ts}.json.revendo.enc`);
  const json = exportFullJson(db, tmp, { anonymized: !!options.anonymized });
  const encrypted = encryptFile(tmp, target, password, { type: 'json_export', anonymized: !!options.anonymized, app: 'Revendo' });
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  db.prepare(`INSERT INTO encrypted_exports (file_path, file_type, size, metadata_json) VALUES (?, 'json_export', ?, ?)`)
    .run(encrypted.path, encrypted.size, JSON.stringify({ anonymized: !!options.anonymized, rowCount: json.rowCount }));
  setSetting(db, 'security_last_encrypted_export', new Date().toISOString());
  recordSecurityEvent(db, 'encrypted_export_created', { path: encrypted.path, size: encrypted.size, anonymized: !!options.anonymized });
  return { ...encrypted, rowCount: json.rowCount, encrypted: true, anonymized: !!options.anonymized };
}

export function createMobileSnapshot(
  db: Database.Database,
  options: { anonymized?: boolean; encrypted?: boolean; password?: string } = {}
): { path: string; size: number; rowCount: number; encrypted: boolean; anonymized: boolean } {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = getMobileSnapshotsDir();
  const htmlPath = path.join(dir, `revendo_mobile_${ts}.html`);
  const anonymized = options.anonymized !== false;
  const generated = generateMobileHtml(db, htmlPath, { anonymized });
  let finalPath = generated.path;
  let finalSize = generated.size;
  let encrypted = false;
  if (options.encrypted) {
    if (!options.password) throw new Error('Mot de passe requis pour chiffrer le snapshot mobile.');
    const encPath = `${htmlPath}.revendo.enc`;
    const enc = encryptFile(htmlPath, encPath, options.password, { type: 'mobile_snapshot', anonymized, app: 'Revendo' });
    try { fs.unlinkSync(htmlPath); } catch { /* ignore */ }
    finalPath = enc.path;
    finalSize = enc.size;
    encrypted = true;
  }
  db.prepare(`
    INSERT INTO mobile_snapshots (file_path, schema_version, generated_at, app_version, redaction_mode, encrypted, data_scope, size)
    VALUES (?, 'revendo-mobile-v2', datetime('now'), ?, ?, ?, ?, ?)
  `).run(finalPath, safeAppVersion(), anonymized ? 'anonymized' : 'full', encrypted ? 1 : 0, 'dashboard,sales,stock,expenses,urssaf,review,documents_metadata', finalSize);
  setSetting(db, 'security_last_mobile_snapshot', new Date().toISOString());
  recordSecurityEvent(db, encrypted ? 'encrypted_mobile_snapshot_created' : 'mobile_snapshot_created', { path: finalPath, size: finalSize, anonymized });
  return { path: finalPath, size: finalSize, rowCount: generated.rowCount, encrypted, anonymized };
}

export function checkBackupIntegrity(db: Database.Database): { checked: number; ok: number; errors: number; rows: Array<{ path: string; ok: boolean; message: string }> } {
  const rows: Array<{ path: string; ok: boolean; message: string }> = [];
  const candidates = listBackups().map((b) => b.path);
  const secureDir = path.join(getBackupsDir(), 'secure');
  if (fs.existsSync(secureDir)) {
    for (const f of fs.readdirSync(secureDir)) {
      if (f.endsWith('.revendo.enc')) candidates.push(path.join(secureDir, f));
    }
  }
  for (const p of candidates) {
    let ok = false;
    let message = '';
    try {
      const stat = fs.statSync(p);
      ok = stat.size > 0 && (p.endsWith('.zip') || looksEncryptedFile(p));
      message = ok ? 'Fichier lisible' : 'Format ou taille inattendu';
      db.prepare(`INSERT INTO backup_integrity_checks (backup_path, ok, size, message) VALUES (?, ?, ?, ?)`)
        .run(p, ok ? 1 : 0, stat.size, message);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
      db.prepare(`INSERT INTO backup_integrity_checks (backup_path, ok, size, message) VALUES (?, 0, NULL, ?)`)
        .run(p, message);
    }
    rows.push({ path: p, ok, message });
  }
  return { checked: rows.length, ok: rows.filter((r) => r.ok).length, errors: rows.filter((r) => !r.ok).length, rows };
}

export function testEncryptedFile(
  db: Database.Database,
  filePath: string,
  password: string
): { ok: true; path: string; decryptedBytes: number } {
  if (!fs.existsSync(filePath)) throw new Error('Fichier chiffré introuvable.');
  if (!looksEncryptedFile(filePath)) throw new Error('Ce fichier ne ressemble pas à un fichier chiffré Revendo.');
  const tmpOut = path.join(os.tmpdir(), `revendo_decrypt_test_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  try {
    const out = decryptFile(filePath, tmpOut, password);
    recordSecurityEvent(db, 'encrypted_file_test_ok', { path: filePath, decryptedBytes: out.size });
    return { ok: true, path: filePath, decryptedBytes: out.size };
  } catch (err) {
    recordSecurityEvent(db, 'encrypted_file_test_failed', { path: filePath, reason: err instanceof Error ? err.message : String(err) });
    throw new Error('Déchiffrement impossible : mot de passe incorrect ou fichier endommagé.');
  } finally {
    try { if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut); } catch { /* ignore */ }
  }
}

export function cleanTemporaryFiles(): { deleted: number } {
  let deleted = 0;
  const candidates = [getDataDir(), getExportsDir(), getMobileSnapshotsDir()];
  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith('_revendo') && !f.startsWith('_backup_')) continue;
      try {
        fs.unlinkSync(path.join(dir, f));
        deleted += 1;
      } catch { /* ignore */ }
    }
  }
  return { deleted };
}
