import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { redactRowsForExport } from '../security/privacy';

const TABLES = [
  'settings', 'contribution_rates',
  'sales', 'purchases', 'boosts', 'expenses',
  'stock_items', 'stock_movements',
  'documents', 'document_links',
  'declarations', 'imports', 'sale_classification_audit',
  'audit_log', 'bank_transactions', 'diary_entries', 'cfe_payments'
] as const;

/**
 * Export entire database as a single JSON file. Useful for portability,
 * human-readable backups, and inspection.
 */
export function exportFullJson(
  db: Database.Database,
  outputPath: string,
  options: { anonymized?: boolean } = {}
): { path: string; rowCount: number; anonymized: boolean } {
  const out: Record<string, unknown[]> = {};
  let total = 0;
  for (const table of TABLES) {
    try {
      const rows = db.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;
      out[table] = options.anonymized
        ? redactRowsForExport(table, rows, { maskBuyer: true, maskContact: true, maskUsername: true })
        : rows;
      total += rows.length;
    } catch {
      out[table] = [];
    }
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify({
    exportedAt: new Date().toISOString(),
    appVersion: 'revendo 0.1',
    anonymized: !!options.anonymized,
    tables: out
  }, null, 2), 'utf-8');
  return { path: outputPath, rowCount: total, anonymized: !!options.anonymized };
}
