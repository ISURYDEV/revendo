import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { generateMobileHtml } from './snapshotGenerator';
import { encryptFile } from '../security/crypto';
import {
  MOBILE_ACTIONS_SCHEMA_VERSION,
  MOBILE_SNAPSHOT_SCHEMA_VERSION
} from '../../../shared/mobile/schemaVersion';

/**
 * Export the mobile snapshot data as a clean JSON file (no HTML wrapper).
 *
 * Strategy:
 *  - Reuse the existing `generateMobileHtml` so that all the SQL aggregation,
 *    redaction and embedding logic stays in one place. This avoids drift
 *    between the HTML viewer and the JSON consumed by the mobile PWA.
 *  - Read the generated HTML, extract the `const DATA = {...};` block and
 *    re-serialize as pure JSON, with a few `v3` additions (action support flag,
 *    review_items placeholder).
 *  - Optionally encrypt the JSON using the same envelope as backups.
 */
export interface ExportSnapshotJsonOptions {
  anonymized?: boolean;
  encrypted?: boolean;
  password?: string;
}

export interface ExportSnapshotJsonResult {
  path: string;
  size: number;
  encrypted: boolean;
  anonymized: boolean;
  schemaVersion: string;
  rowCount: number;
}

/** Extract the `DATA = { ... };` JSON island from a generated HTML snapshot. */
export function extractSnapshotDataFromHtml(html: string): Record<string, unknown> {
  const marker = 'const DATA = ';
  const idx = html.indexOf(marker);
  if (idx < 0) throw new Error('Snapshot HTML invalide : bloc DATA introuvable.');
  let depth = 0;
  let start = -1;
  for (let i = idx + marker.length; i < html.length; i++) {
    const ch = html[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const jsonText = html.slice(start, i + 1);
        return JSON.parse(jsonText) as Record<string, unknown>;
      }
    }
  }
  throw new Error('Snapshot HTML invalide : bloc DATA mal formé.');
}

function upgradeToV3(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  out.schema_version = MOBILE_SNAPSHOT_SCHEMA_VERSION;
  out.supports_action_schema = MOBILE_ACTIONS_SCHEMA_VERSION;
  if (!Array.isArray(out.review_items)) out.review_items = [];
  if (!Array.isArray(out.reminders)) out.reminders = [];
  return out;
}

export function exportMobileSnapshotJson(
  db: Database.Database,
  outputPath: string,
  options: ExportSnapshotJsonOptions = {}
): ExportSnapshotJsonResult {
  const anonymized = options.anonymized !== false;
  if (options.encrypted && !options.password) {
    throw new Error('Mot de passe requis pour chiffrer le snapshot JSON.');
  }

  // Generate the HTML to a temp path so we can extract DATA without re-running
  // all the SQL aggregations.
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const tmpHtml = path.join(os.tmpdir(), `_revendo_mobile_json_${ts}.html`);
  let raw: Record<string, unknown>;
  try {
    generateMobileHtml(db, tmpHtml, { anonymized });
    const html = fs.readFileSync(tmpHtml, 'utf-8');
    raw = extractSnapshotDataFromHtml(html);
  } finally {
    try { if (fs.existsSync(tmpHtml)) fs.unlinkSync(tmpHtml); } catch { /* ignore */ }
  }

  const payload = upgradeToV3(raw);
  payload.encrypted = !!options.encrypted;
  payload.redaction_mode = anonymized ? 'anonymized' : 'full';

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const jsonText = JSON.stringify(payload);

  let finalPath = outputPath;
  let finalSize = 0;
  if (options.encrypted && options.password) {
    const plainPath = outputPath.endsWith('.revendo.enc') ? outputPath.replace('.revendo.enc', '') : outputPath;
    const encPath = plainPath.endsWith('.json') ? `${plainPath}.revendo.enc` : `${plainPath}.json.revendo.enc`;
    // Write plain text temporarily, encrypt, then delete plain
    const tmpPlain = path.join(os.tmpdir(), `_revendo_mobile_plain_${ts}.json`);
    try {
      fs.writeFileSync(tmpPlain, jsonText, 'utf-8');
      const out = encryptFile(tmpPlain, encPath, options.password, {
        type: 'mobile_snapshot_json',
        anonymized,
        schemaVersion: MOBILE_SNAPSHOT_SCHEMA_VERSION
      });
      finalPath = out.path;
      finalSize = out.size;
    } finally {
      try { if (fs.existsSync(tmpPlain)) fs.unlinkSync(tmpPlain); } catch { /* ignore */ }
    }
  } else {
    fs.writeFileSync(outputPath, jsonText, 'utf-8');
    finalSize = fs.statSync(outputPath).size;
  }

  const sales = Array.isArray(payload.sales) ? payload.sales.length : 0;
  const purchases = Array.isArray(payload.purchases) ? payload.purchases.length : 0;
  const expenses = Array.isArray(payload.expenses) ? payload.expenses.length : 0;

  return {
    path: finalPath,
    size: finalSize,
    encrypted: !!options.encrypted,
    anonymized,
    schemaVersion: String(payload.schema_version ?? MOBILE_SNAPSHOT_SCHEMA_VERSION),
    rowCount: sales + purchases + expenses
  };
}
