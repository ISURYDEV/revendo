import { beforeEach, describe, expect, it } from 'vitest';
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
import { runImport, revertImport } from '../electron/services/importers';

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

function writeCsv(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revendo-import-tx-'));
  const filePath = path.join(dir, 'sales.csv');
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

const VINTEER_HEADER =
  'ID Transaction;Statut;Date de finalisation;Montant encaissé;Articles;SKU';

describe('P1.1 — runImport est atomique', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => { db = freshDb(); });

  it("import correct met à jour les compteurs et persiste les ventes", () => {
    const csv = `${VINTEER_HEADER}\n111;completed;2026-03-15 10:00:00;18,00;Article A;SKU-1\n112;completed;2026-03-20 10:00:00;25,00;Article B;SKU-2\n`;
    const filePath = writeCsv(csv);
    const r = runImport(db, { filePath, forcedType: 'vinteer_sales' });
    expect(r.created).toBe(2);
    const imp = db.prepare(`SELECT rows_created, rows_skipped, rows_error, rows_total FROM imports`).get() as Record<string, number>;
    expect(imp.rows_created).toBe(2);
    expect(imp.rows_total).toBe(2);
    expect(imp.rows_error).toBe(0);
    const sales = db.prepare(`SELECT COUNT(*) AS n FROM sales`).get() as { n: number };
    expect(sales.n).toBe(2);
  });

  it("aucune ligne créée si la transaction échoue (atomicité)", () => {
    const csv = `${VINTEER_HEADER}\n777;completed;2026-03-15 10:00:00;18,00;Article;SKU-T\n`;
    const filePath = writeCsv(csv);

    // Sabotage : on bloque l'INSERT dans la table `sales` (mais permet l'INSERT
    // dans `imports`) en remplaçant la table sales par une vue lecture seule
    // qui produira une erreur à la prochaine INSERT.
    db.exec(`CREATE TABLE _sales_backup AS SELECT * FROM sales WHERE 0=1`);
    db.exec(`DROP TABLE sales`);
    db.exec(`CREATE VIEW sales AS SELECT * FROM _sales_backup`);

    expect(() => runImport(db, { filePath, forcedType: 'vinteer_sales' })).toThrow();

    // Restaurer la table pour pouvoir interroger imports.
    db.exec(`DROP VIEW sales`);
    db.exec(`CREATE TABLE sales AS SELECT * FROM _sales_backup`);

    // L'INSERT dans `imports` a été rollback en même temps que tout le reste.
    const importCount = (db.prepare(`SELECT COUNT(*) AS n FROM imports`).get() as { n: number }).n;
    expect(importCount).toBe(0);
  });

  it("counters cohérents avec dedup : 1ère création, réimport ne crée rien", () => {
    const csv = `${VINTEER_HEADER}\n555;completed;2026-04-10 10:00:00;30,00;Article;SKU-D\n`;
    const filePath = writeCsv(csv);
    const r1 = runImport(db, { filePath, forcedType: 'vinteer_sales' });
    expect(r1.created).toBe(1);
    const r2 = runImport(db, { filePath, forcedType: 'vinteer_sales' });
    expect(r2.created).toBe(0);
    const imports = db.prepare(`SELECT id, rows_created FROM imports ORDER BY id ASC`).all() as Array<{ id: number; rows_created: number }>;
    expect(imports.length).toBe(2);
    expect(imports[0].rows_created).toBe(1);
    expect(imports[1].rows_created).toBe(0);
  });

  it("revertImport restaure correctement et supprime l'entrée import", () => {
    const csv = `${VINTEER_HEADER}\n888;completed;2026-03-15 10:00:00;40,00;Article;SKU-R\n`;
    const filePath = writeCsv(csv);
    const r = runImport(db, { filePath, forcedType: 'vinteer_sales' });
    const importId = (db.prepare(`SELECT id FROM imports LIMIT 1`).get() as { id: number }).id;
    expect(r.created).toBe(1);
    const rev = revertImport(db, importId);
    expect(rev.deleted).toBeGreaterThanOrEqual(1);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM imports`).get() as { n: number }).n).toBe(0);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM sales`).get() as { n: number }).n).toBe(0);
  });
});
