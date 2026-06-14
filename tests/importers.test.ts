import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migration001Initial } from '../electron/db/migrations/001_initial';
import { migration002 } from '../electron/db/migrations/002_classification_and_links';
import { migration005 } from '../electron/db/migrations/005_pre_activity_and_dedup';
import { importVinteerSales } from '../electron/services/importers/vinteerSales';
import { importVinteerBoosts } from '../electron/services/importers/vinteerBoosts';
import { importVinteerInventory } from '../electron/services/importers/vinteerInventory';
import {
  importWhatNotPurchases,
  resolveHeader
} from '../electron/services/importers/whatnotPurchases';

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);`);
  migration001Initial.up(db);
  migration002.up(db);
  migration005.up(db);
  db.prepare(
    `INSERT INTO imports (source, file_name, file_hash, import_type) VALUES ('test', 'x.csv', 'h', 'vinteer_sales')`
  ).run();
  return db;
}

describe('importVinteerSales', () => {
  // P0.2 — Une vente importée avec SKU mais SANS achat/stock associé reste
  // uncertain_to_review (non déclarable). Le canceled reste exclu comme avant.
  it('SKU seul → uncertain_to_review ; canceled → exclu', () => {
    const db = freshDb();
    const r = importVinteerSales(
      db,
      [
        {
          'ID Transaction': '111',
          Statut: 'completed',
          'Date de finalisation': '2026-03-15 10:00:00',
          'Montant encaissé': '18,00',
          Articles: 'Test',
          SKU: 'SKU-111'
        },
        {
          'ID Transaction': '222',
          Statut: 'canceled',
          'Date de finalisation': '2026-03-15 10:00:00',
          'Montant encaissé': '12,00',
          Articles: 'Cancel'
        }
      ],
      1
    );
    expect(r.created).toBe(2);
    const a = db.prepare(`SELECT * FROM sales WHERE external_id='111'`).get() as Record<string, unknown>;
    const b = db.prepare(`SELECT * FROM sales WHERE external_id='222'`).get() as Record<string, unknown>;
    expect(a.classification).toBe('uncertain_to_review');
    expect(a.is_declarable).toBe(0);
    expect(a.declarable_amount).toBe(0);
    expect(String(a.exclusion_reason)).toMatch(/SKU détecté sans stock/);
    expect(b.classification).toBe('excluded');
    expect(b.is_declarable).toBe(0);
    expect(b.declarable_amount).toBe(0);
    expect(b.exclusion_reason).toMatch(/canceled/);
  });

  it('dedups on (vinteer, ID Transaction)', () => {
    const db = freshDb();
    const row = {
      'ID Transaction': '111',
      Statut: 'completed',
      'Date de finalisation': '2026-03-15 10:00:00',
      'Montant encaissé': '18,00',
      Articles: 'Test'
    };
    importVinteerSales(db, [row], 1);
    const r = importVinteerSales(db, [row], 1);
    expect(r.created).toBe(0);
    expect(r.updated).toBe(0);
    expect(r.duplicatesIdentical).toBe(1);
  });

  it('does not overwrite a manual colis_perdu indemnisation on reimport', () => {
    const db = freshDb();
    const row = {
      'ID Transaction': 'LOST-1',
      Statut: 'completed',
      'Date de finalisation': '2026-05-01 10:00:00',
      'Montant encaissé': '18,00',
      Articles: 'Sac perdu',
      SKU: 'LA-ITABAGNOIR-5'
    };
    importVinteerSales(db, [row], 1);
    db.prepare(
      `UPDATE sales
       SET status='colis_perdu', classification='professional_resale', urssaf_declarable=1,
           is_declarable=1, declarable_amount=18, manual_override=1
       WHERE external_id='LOST-1'`
    ).run();

    const r = importVinteerSales(db, [{ ...row, Statut: 'canceled' }], 1);
    const sale = db.prepare(`SELECT status, urssaf_declarable, declarable_amount FROM sales WHERE external_id='LOST-1'`).get() as Record<string, unknown>;
    expect(r.created).toBe(0);
    expect(sale.status).toBe('colis_perdu');
    expect(sale.urssaf_declarable).toBe(1);
    expect(sale.declarable_amount).toBe(18);
  });
});

describe('importVinteerBoosts', () => {
  it('imports boost rows', () => {
    const db = freshDb();
    const r = importVinteerBoosts(
      db,
      [
        {
          ID: 'b1',
          'Date de début': '2026-03-15 10:00:00',
          'Type de boost': 'listing',
          'Montant HT': '10,22',
          'Taux TVA (%)': '20',
          'Montant TVA': '2,04',
          'Montant TTC': '12,26',
          'Prix brut TTC': '13,62',
          'Réduction': '1,36',
          'Durée (jours)': '7',
          'Articles boostés': '6'
        }
      ],
      1
    );
    expect(r.created).toBe(1);
    const b = db.prepare(`SELECT * FROM boosts WHERE external_id='b1'`).get() as Record<string, unknown>;
    expect(b.amount_ttc).toBe(12.26);
    expect(b.duration_days).toBe(7);
  });
});

describe('importVinteerInventory', () => {
  it('creates stock_item + movement for lots and generates internal_code', () => {
    const db = freshDb();
    const r = importVinteerInventory(
      db,
      [
        {
          SKU: 'SULLICO-20',
          Nom: 'Lot haut Cameïau',
          Fournisseur: 'WhatNot',
          'En stock (restants)': '9',
          'Type de stock': 'Lot (SKU partagé)',
          'COGS unitaire (€)': '1,6',
          'COGS total (€)': '14.40',
          'Prix estimé (€)': ''
        }
      ],
      1
    );
    expect(r.created).toBe(1);
    const item = db.prepare(`SELECT * FROM stock_items WHERE sku='SULLICO-20'`).get() as Record<string, unknown>;
    expect(item.internal_code).toMatch(/^ITEM-\d{4}-\d{6}$/);
    expect(item.quantity).toBe(9);
    expect(item.unit_cost_ttc).toBe(1.6);
    const mv = db
      .prepare(`SELECT * FROM stock_movements WHERE stock_item_id=?`)
      .get(item.id) as Record<string, unknown>;
    expect(mv.movement_type).toBe('IN_MANUAL');
    expect(mv.quantity).toBe(9);
  });
});

describe('whatnot resolveHeader', () => {
  it('matches first existing candidate', () => {
    const headers = ['order id', 'order numeric id', 'product name'];
    expect(resolveHeader(headers, ['order numeric id', 'order id'])).toBe('order numeric id');
    expect(resolveHeader(headers, ['missing'])).toBeNull();
  });
});

describe('importWhatNotPurchases', () => {
  it('imports a row with flexible mapping', () => {
    const db = freshDb();
    const headers = [
      'order id',
      'order numeric id',
      'buyer',
      'seller',
      'product name',
      'processed date',
      'order currency',
      'sold price',
      'quantity',
      'subtotal',
      'shipping price',
      'taxes',
      'total'
    ];
    const r = importWhatNotPurchases(
      db,
      headers,
      [
        {
          'order id': '36iq',
          'order numeric id': '1052588021',
          buyer: 'isury_buy',
          seller: 'destockattack',
          'product name': 'Vu à l’écran #78',
          'processed date': '2026-05-21 17:29 (UTC)',
          'order currency': 'EUR',
          'sold price': '€22.00',
          quantity: '1',
          subtotal: '€22.00',
          'shipping price': '€0.40',
          taxes: '€0.07',
          total: '€22.40'
        }
      ],
      1
    );
    expect(r.created).toBe(1);
    const p = db
      .prepare(`SELECT * FROM purchases WHERE source='whatnot' AND external_id='1052588021'`)
      .get() as Record<string, unknown>;
    expect(p.platform).toBe('WhatNot');
    expect(p.total_ttc).toBe(22.4);
    expect(p.shipping_fee).toBeCloseTo(0.4);
    expect(p.deductible_vat).toBe(0); // franchise en base default
  });
});
