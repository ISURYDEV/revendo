import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migration001Initial } from '../electron/db/migrations/001_initial';
import { migration002 } from '../electron/db/migrations/002_classification_and_links';
import { migration003 } from '../electron/db/migrations/003_audit_log';
import { migration004 } from '../electron/db/migrations/004_diary_and_reconciliation';
import { migration005 } from '../electron/db/migrations/005_pre_activity_and_dedup';
import { resetData } from '../electron/services/maintenance/reset';

function db() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);`);
  migration001Initial.up(d);
  migration002.up(d);
  migration003.up(d);
  migration004.up(d);
  migration005.up(d);
  return d;
}

function seed(d: Database.Database) {
  d.prepare(`INSERT INTO settings (key, value) VALUES ('siret', '10217823300015'),
                                                      ('activity_start_date', '2026-03-09')`).run();
  d.prepare(`INSERT INTO sales (source, external_id, status, classification, urssaf_declarable, declarable_amount, amount_received)
             VALUES ('vinteer', 'A', 'completed', 'professional_resale', 1, 50, 50)`).run();
  d.prepare(`INSERT INTO imports (source, file_name, file_hash, import_type) VALUES ('vinteer', 'x.csv', 'h', 'vinteer_sales')`).run();
  d.prepare(`INSERT INTO expenses (date, category, amount_ttc) VALUES ('2026-03-15', 'emballages', 25)`).run();
  d.prepare(`INSERT INTO diary_entries (entry_date, note) VALUES ('2026-03-15', 'test')`).run();
}

describe('resetData', () => {
  let d: Database.Database;
  beforeEach(() => { d = db(); seed(d); });

  it('activity mode wipes activity tables but keeps company settings', () => {
    const r = resetData(d, 'activity');
    expect((d.prepare('SELECT COUNT(*) AS n FROM sales').get() as { n: number }).n).toBe(0);
    expect((d.prepare('SELECT COUNT(*) AS n FROM imports').get() as { n: number }).n).toBe(0);
    expect((d.prepare('SELECT COUNT(*) AS n FROM expenses').get() as { n: number }).n).toBe(0);
    expect((d.prepare('SELECT COUNT(*) AS n FROM diary_entries').get() as { n: number }).n).toBe(0);
    // Settings: company info kept
    const siret = (d.prepare(`SELECT value FROM settings WHERE key='siret'`).get() as { value: string } | undefined)?.value;
    expect(siret).toBe('10217823300015');
    const start = (d.prepare(`SELECT value FROM settings WHERE key='activity_start_date'`).get() as { value: string } | undefined)?.value;
    expect(start).toBe('2026-03-09');
    // Contribution rates kept
    expect((d.prepare('SELECT COUNT(*) AS n FROM contribution_rates').get() as { n: number }).n).toBeGreaterThan(0);
    // reset_performed_at logged
    const reset = (d.prepare(`SELECT value FROM settings WHERE key='reset_performed_at'`).get() as { value: string } | undefined)?.value;
    expect(reset).toBeTruthy();
    expect(r.mode).toBe('activity');
  });

  it('everything mode wipes settings and contribution_rates too', () => {
    resetData(d, 'everything');
    const siret = (d.prepare(`SELECT value FROM settings WHERE key='siret'`).get() as { value: string } | undefined)?.value;
    expect(siret).toBeUndefined();
    expect((d.prepare('SELECT COUNT(*) AS n FROM contribution_rates').get() as { n: number }).n).toBe(0);
    // reset_performed_at still logged (gets re-inserted)
    const reset = (d.prepare(`SELECT value FROM settings WHERE key='reset_performed_at'`).get() as { value: string } | undefined)?.value;
    expect(reset).toBeTruthy();
  });
});
