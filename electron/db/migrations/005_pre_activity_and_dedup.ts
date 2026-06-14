import type Database from 'better-sqlite3';

/**
 * Migration 005:
 *  - Add dedup_status / dedup_conflict columns to sales (tracking re-import outcomes)
 *  - Add first_declaration_combined_quarters to settings (for Q1+Q2 combined)
 *  - Add activity_start_date if not set (no-op if already present)
 *  - Reclassify existing sales using activity_start_date:
 *      sales with declared_encashment_date < activity_start_date → classification='pre_activity'
 *
 * Non-destructive: data is preserved, only classification flags change for sales that should
 * not be counted in CA URSSAF.
 */
export const migration005 = {
  version: 5,
  name: 'pre-activity classification + dedup tracking',
  up(db: Database.Database) {
    // Schema changes
    db.exec(`
      ALTER TABLE sales ADD COLUMN dedup_status TEXT;
      ALTER TABLE sales ADD COLUMN dedup_conflict TEXT;
      CREATE INDEX IF NOT EXISTS idx_sales_dedup_status ON sales(dedup_status);
    `);

    // Reclassify existing sales using current activity_start_date if it exists
    const startRow = db
      .prepare(`SELECT value FROM settings WHERE key='activity_start_date'`)
      .get() as { value: string } | undefined;
    if (startRow?.value) {
      const start = startRow.value.slice(0, 10);
      // Mark sales before start as pre_activity (except those manually overridden)
      db.prepare(
        `UPDATE sales SET
           classification = 'pre_activity',
           urssaf_declarable = 0,
           is_declarable = 0,
           declarable_amount = 0,
           classification_reason = 'Encaissement antérieur au début d''activité officiel (' || ? || ') — hors période URSSAF',
           exclusion_reason = 'Antes del début d''activité — no contar en CA URSSAF',
           updated_at = datetime('now')
         WHERE manual_override = 0
           AND declared_encashment_date IS NOT NULL
           AND substr(declared_encashment_date, 1, 10) < ?
           AND classification = 'professional_resale'`
      ).run(start, start);
    }
  }
};
