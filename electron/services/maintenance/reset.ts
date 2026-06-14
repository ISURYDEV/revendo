import type Database from 'better-sqlite3';

/**
 * Reset data — irreversible operation.
 *
 * mode='activity'  → wipe activity data, KEEP company settings + contribution_rates.
 * mode='everything' → wipe everything except the `_migrations` table.
 *
 * Always wraps in a transaction. Returns counts of deleted rows per table.
 */
export type ResetMode = 'activity' | 'everything';

export interface ResetResult {
  mode: ResetMode;
  resetAt: string;
  deleted: Record<string, number>;
}

const ACTIVITY_TABLES = [
  'sales',
  'purchases',
  'boosts',
  'expenses',
  'stock_items',
  'stock_movements',
  'documents',
  'document_links',
  'declarations',
  'imports',
  'sale_classification_audit',
  'audit_log',
  'bank_transactions',
  'diary_entries',
  'reminders_state',
  'review_ignored_items',
  'saved_filters',
  'bulk_action_log'
] as const;

const SETTINGS_TO_KEEP_ON_ACTIVITY_RESET = new Set([
  'commercial_name', 'first_name', 'last_name', 'siret', 'address', 'email', 'phone',
  'activity_type', 'urssaf_periodicity', 'activity_start_date',
  'acre_enabled', 'acre_start_date', 'acre_end_date',
  'vat_regime', 'default_currency',
  'versement_liberatoire', 'versement_liberatoire_rate',
  'documents_folder', 'backups_folder',
  'first_declaration_year', 'first_declaration_quarters', 'first_declaration_due_date',
  'seuil_marchandises', 'seuil_tva_franchise',
  'seuil_marchandises_warning_at', 'seuil_marchandises_danger_at',
  'backup_enabled', 'backup_keep_daily_days',
  'cfe_reminder_date'
]);

export function resetData(db: Database.Database, mode: ResetMode): ResetResult {
  const result: ResetResult = { mode, resetAt: new Date().toISOString(), deleted: {} };

  const tx = db.transaction(() => {
    // Wipe foreign-key-friendly: order from leaves to roots
    for (const table of ACTIVITY_TABLES) {
      try {
        const info = db.prepare(`DELETE FROM ${table}`).run();
        result.deleted[table] = info.changes;
      } catch {
        // table might not exist if migration wasn't applied — skip
        result.deleted[table] = 0;
      }
    }

    // Reset auto-increment counters
    try {
      db.prepare(`DELETE FROM sqlite_sequence`).run();
    } catch { /* table may not exist */ }

    // Reset stock_items sequence
    try {
      db.prepare(`UPDATE _sequences SET value=0`).run();
    } catch { /* ignore */ }

    if (mode === 'everything') {
      // Wipe contribution rates AND settings (full reset)
      db.prepare(`DELETE FROM contribution_rates`).run();
      db.prepare(`DELETE FROM settings`).run();
      result.deleted.contribution_rates = -1;
      result.deleted.settings = -1;
    } else {
      // Activity-only: keep settings whitelist + contribution rates
      const allowed = Array.from(SETTINGS_TO_KEEP_ON_ACTIVITY_RESET);
      const placeholders = allowed.map(() => '?').join(', ');
      const info = db.prepare(`DELETE FROM settings WHERE key NOT IN (${placeholders})`).run(...allowed);
      result.deleted.settings_partial = info.changes;
    }

    // Always log the reset event (minimal, no personal data)
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('reset_performed_at', ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    ).run(result.resetAt);
  });

  tx();
  return result;
}
