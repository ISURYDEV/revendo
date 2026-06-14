import type Database from 'better-sqlite3';
import { migration001Initial } from './001_initial';
import { migration002 } from './002_classification_and_links';
import { migration003 } from './003_audit_log';
import { migration004 } from './004_diary_and_reconciliation';
import { migration005 } from './005_pre_activity_and_dedup';
import { migration006 } from './006_cfe_and_maintenance';
import { migration007 } from './007_cloud_sync';
import { migration008 } from './008_cloud_mobile';
import { migration009 } from './009_usability_phase2';
import { migration010 } from './010_marketplace_scaling';
import { migration011 } from './011_document_stock_automation';
import { migration012 } from './012_security_sync_mobile_future';
import { migration013 } from './013_security_defaults';
import { migration014 } from './014_performance_indexes';
import { migration015 } from './015_mobile_action_imports';

interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

const MIGRATIONS: Migration[] = [
  migration001Initial,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009,
  migration010,
  migration011,
  migration012,
  migration013,
  migration014,
  migration015
];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const appliedRows = db.prepare('SELECT version FROM _migrations').all() as { version: number }[];
  const applied = new Set(appliedRows.map((r) => r.version));

  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    const tx = db.transaction(() => {
      m.up(db);
      db.prepare('INSERT INTO _migrations (version, name) VALUES (?, ?)').run(m.version, m.name);
    });
    tx();
    // eslint-disable-next-line no-console
    console.log(`[migrations] applied ${m.version} ${m.name}`);
  }
}
