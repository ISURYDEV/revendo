import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migration001Initial } from '../electron/db/migrations/001_initial';
import { migration002 } from '../electron/db/migrations/002_classification_and_links';
import { migration005 } from '../electron/db/migrations/005_pre_activity_and_dedup';
import { migration009 } from '../electron/db/migrations/009_usability_phase2';
import { migration010 } from '../electron/db/migrations/010_marketplace_scaling';
import { migration011 } from '../electron/db/migrations/011_document_stock_automation';
import { migration012 } from '../electron/db/migrations/012_security_sync_mobile_future';
import { buildReviewCenter, markReviewItemsBulk } from '../electron/services/review/reviewCenter';

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

function insertSale(db: Database.Database, ext: string, classification: string) {
  return Number(db.prepare(
    `INSERT INTO sales (source, external_id, status, classification, urssaf_declarable, article_name, amount_received)
     VALUES ('manual', ?, 'completed', ?, 0, ?, 10)`
  ).run(ext, classification, `Vente ${ext}`).lastInsertRowid);
}

describe('Centre de révision — actions de masse', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => { db = freshDb(); });

  it('masque plusieurs entrées en une seule transaction', () => {
    const a = insertSale(db, 'A', 'uncertain_to_review');
    const b = insertSale(db, 'B', 'uncertain_to_review');
    const c = insertSale(db, 'C', 'uncertain_to_review');

    const before = buildReviewCenter(db);
    const reviewItems = before.items.filter((i) => i.issue === 'sale_classification_review');
    expect(reviewItems.length).toBeGreaterThanOrEqual(3);

    const r = markReviewItemsBulk(db, {
      items: [
        { key: reviewItems[0].key, module: 'sales', entity_type: 'sale', entity_id: a },
        { key: reviewItems[1].key, module: 'sales', entity_type: 'sale', entity_id: b },
        { key: reviewItems[2].key, module: 'sales', entity_type: 'sale', entity_id: c }
      ],
      status: 'ignored',
      note: 'Lot masqué pour test'
    });
    expect(r.ok).toBe(true);
    expect(r.processed).toBe(3);

    const after = buildReviewCenter(db);
    const stillVisible = after.items.filter((i) =>
      [reviewItems[0].key, reviewItems[1].key, reviewItems[2].key].includes(i.key)
    );
    expect(stillVisible.length).toBe(0);
  });

  it('marque plusieurs entrées comme vérifiées', () => {
    const a = insertSale(db, 'V1', 'uncertain_to_review');
    const b = insertSale(db, 'V2', 'uncertain_to_review');

    const before = buildReviewCenter(db);
    const reviewItems = before.items.filter((i) => i.issue === 'sale_classification_review').slice(0, 2);

    markReviewItemsBulk(db, {
      items: reviewItems.map((i) => ({
        key: i.key,
        module: i.module,
        entity_type: i.entity_type,
        entity_id: i.entity_id
      })),
      status: 'verified',
      note: 'Lot vérifié'
    });

    const statuses = db.prepare(
      `SELECT status FROM review_ignored_items WHERE review_key IN (?, ?)`
    ).all(reviewItems[0].key, reviewItems[1].key) as Array<{ status: string }>;
    expect(statuses).toHaveLength(2);
    expect(statuses.every((s) => s.status === 'verified')).toBe(true);
    void a; void b;
  });

  it('refuse une note vide (garde-fou d\'audit)', () => {
    expect(() =>
      markReviewItemsBulk(db, {
        items: [{ key: 'fake:key', module: 'sales' }],
        status: 'ignored',
        note: '   '
      })
    ).toThrow(/note est obligatoire/i);
  });

  it('refuse une liste vide', () => {
    expect(() =>
      markReviewItemsBulk(db, { items: [], status: 'ignored', note: 'test' })
    ).toThrow(/Aucun élément sélectionné/i);
  });

  it('met à jour le status d\'une clé déjà masquée (upsert)', () => {
    const a = insertSale(db, 'U1', 'uncertain_to_review');
    const before = buildReviewCenter(db);
    const item = before.items.find((i) => i.issue === 'sale_classification_review')!;

    // Premier passage : ignoré
    markReviewItemsBulk(db, {
      items: [{ key: item.key, module: 'sales', entity_type: 'sale', entity_id: a }],
      status: 'ignored',
      note: 'Première fois'
    });
    // Deuxième passage : vérifié — doit écraser
    markReviewItemsBulk(db, {
      items: [{ key: item.key, module: 'sales', entity_type: 'sale', entity_id: a }],
      status: 'verified',
      note: 'Changement d\'avis'
    });

    const row = db.prepare(
      `SELECT status, note FROM review_ignored_items WHERE review_key=?`
    ).get(item.key) as { status: string; note: string };
    expect(row.status).toBe('verified');
    expect(row.note).toBe("Changement d'avis");
  });
});
