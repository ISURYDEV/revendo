import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migration001Initial } from '../electron/db/migrations/001_initial';
import { migration002 } from '../electron/db/migrations/002_classification_and_links';
import { migration005 } from '../electron/db/migrations/005_pre_activity_and_dedup';
import { migration009 } from '../electron/db/migrations/009_usability_phase2';
import { migration010 } from '../electron/db/migrations/010_marketplace_scaling';
import { migration011 } from '../electron/db/migrations/011_document_stock_automation';
import { migration012 } from '../electron/db/migrations/012_security_sync_mobile_future';
import { exportMobileSnapshotJson, extractSnapshotDataFromHtml } from '../electron/services/mobile/snapshotJsonExporter';
import {
  COMPATIBLE_SNAPSHOT_VERSIONS,
  MOBILE_SNAPSHOT_SCHEMA_VERSION,
  detectSnapshotVersion,
  mobileSnapshotSchema
} from '../shared/mobile';
import { decryptFile } from '../electron/services/security/crypto';

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);`);
  migration001Initial.up(db);
  migration002.up(db);
  migration005.up(db);
  migration009.up(db);
  migration010.up(db);
  migration011.up(db);
  migration012.up(db);
  return db;
}

function insertSale(db: Database.Database, patch: Record<string, unknown>) {
  const base = {
    source: 'vinteer',
    external_id: `S-${Math.random().toString(36).slice(2, 8)}`,
    status: 'completed',
    classification: 'professional_resale',
    urssaf_declarable: 1,
    declarable_amount: 18,
    amount_received: 18,
    sale_date: '2026-03-15T10:00:00.000Z',
    declared_encashment_date: '2026-03-15T10:00:00.000Z',
    buyer_email: 'mock@example.com',
    buyer_address: '12 rue secrète, Paris',
    buyer_username: 'cool_buyer',
    article_name: 'Pull en laine',
    sku: null,
    ...patch
  };
  const cols = Object.keys(base).join(', ');
  const placeholders = Object.keys(base).map(() => '?').join(', ');
  db.prepare(`INSERT INTO sales (${cols}) VALUES (${placeholders})`).run(...Object.values(base));
}

describe('exportMobileSnapshotJson', () => {
  let db: Database.Database;
  let tmpDir: string;
  beforeEach(() => {
    db = freshDb();
    insertSale(db, { external_id: 'S1' });
    insertSale(db, { external_id: 'S2', amount_received: 25, declarable_amount: 25 });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revendo-mobile-snap-'));
  });

  it('génère un JSON avec schema_version revendo-mobile-v3', () => {
    const out = path.join(tmpDir, 'snap.json');
    const r = exportMobileSnapshotJson(db, out, { anonymized: true });
    expect(r.path).toBe(out);
    expect(r.schemaVersion).toBe(MOBILE_SNAPSHOT_SCHEMA_VERSION);
    const raw = JSON.parse(fs.readFileSync(out, 'utf-8'));
    expect(detectSnapshotVersion(raw)).toBe(MOBILE_SNAPSHOT_SCHEMA_VERSION);
    expect(COMPATIBLE_SNAPSHOT_VERSIONS.includes(raw.schema_version)).toBe(true);
  });

  it('contient le dashboard (totals) et le résumé stock', () => {
    const out = path.join(tmpDir, 'snap.json');
    exportMobileSnapshotJson(db, out, { anonymized: true });
    const raw = JSON.parse(fs.readFileSync(out, 'utf-8'));
    expect(raw.totals).toBeDefined();
    expect(typeof raw.totals.ca_urssaf_total).toBe('number');
    expect(Array.isArray(raw.stock)).toBe(true);
    expect(Array.isArray(raw.sales)).toBe(true);
    expect(Array.isArray(raw.declarations)).toBe(true);
  });

  it('en mode anonymisé, ne contient pas email ni adresse acheteur', () => {
    const out = path.join(tmpDir, 'snap.json');
    exportMobileSnapshotJson(db, out, { anonymized: true });
    const text = fs.readFileSync(out, 'utf-8');
    expect(text).not.toContain('mock@example.com');
    expect(text).not.toContain('12 rue secrète');
  });

  it('valide via zod le snapshot généré', () => {
    const out = path.join(tmpDir, 'snap.json');
    exportMobileSnapshotJson(db, out, { anonymized: true });
    const raw = JSON.parse(fs.readFileSync(out, 'utf-8'));
    const parsed = mobileSnapshotSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
  });

  it('snapshot chiffré peut être déchiffré avec la bonne passphrase', () => {
    const out = path.join(tmpDir, 'snap_enc');
    const password = 'TestPass-12chars!';
    const r = exportMobileSnapshotJson(db, out, { anonymized: true, encrypted: true, password });
    expect(r.encrypted).toBe(true);
    expect(fs.existsSync(r.path)).toBe(true);
    const tmpDec = path.join(tmpDir, 'dec.json');
    decryptFile(r.path, tmpDec, password);
    const dec = JSON.parse(fs.readFileSync(tmpDec, 'utf-8'));
    expect(dec.schema_version).toBe(MOBILE_SNAPSHOT_SCHEMA_VERSION);
  });

  it('rejette un schéma incompatible', () => {
    const fakeHtml = `<html><script>const DATA = {"schema_version":"revendo-mobile-v1","totals":{}};</script></html>`;
    const data = extractSnapshotDataFromHtml(fakeHtml);
    expect(data.schema_version).toBe('revendo-mobile-v1');
    const parsed = mobileSnapshotSchema.safeParse(data);
    expect(parsed.success).toBe(false);
  });
});
