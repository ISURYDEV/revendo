import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migration001Initial } from '../electron/db/migrations/001_initial';
import { migration002 } from '../electron/db/migrations/002_classification_and_links';
import { migration005 } from '../electron/db/migrations/005_pre_activity_and_dedup';
import { migration009 } from '../electron/db/migrations/009_usability_phase2';
import { migration010 } from '../electron/db/migrations/010_marketplace_scaling';
import { detectAdapter } from '../electron/services/marketplaces/adapters/registry';
import { VinteerPurchasesAdapter, VinteerSalesAdapter } from '../electron/services/marketplaces/adapters/vinteerAdapters';
import { WhatNotPurchasesAdapter } from '../electron/services/marketplaces/adapters/whatnotAdapters';
import { GenericExpensesCsvAdapter, GenericSalesCsvAdapter } from '../electron/services/marketplaces/adapters/genericCsvAdapter';
import { buildDedupKey } from '../electron/services/marketplaces/dedup';
import {
  createCsvMappingTemplate,
  deleteCsvMappingTemplate,
  listCsvMappingTemplates,
  updateCsvMappingTemplate
} from '../electron/services/marketplaces/repository';
import { buildImportPreview, runImport } from '../electron/services/importers';

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);`);
  migration001Initial.up(db);
  migration002.up(db);
  migration005.up(db);
  migration009.up(db);
  migration010.up(db);
  return db;
}

function writeTempCsv(name: string, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revendo-phase4-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

describe('Phase 4 — adapter registry', () => {
  it('detects Vinteer sales, purchases, inventory, boosts and WhatNot purchases', () => {
    const db = freshDb();
    const cases = [
      { headers: ['ID Transaction', 'Date de vente', 'Montant encaissé', 'Statut', 'Articles'], expected: 'vinteer_sales' },
      { headers: ['ID Transaction', 'Date de paiement', 'Montant total TTC', 'Vendeur'], expected: 'vinteer_purchases' },
      { headers: ['SKU', 'Nom', 'En stock (restants)', 'COGS unitaire (€)'], expected: 'vinteer_inventory' },
      { headers: ['Date de début', 'Type de boost', 'Montant TTC', 'Montant HT'], expected: 'vinteer_boosts' },
      { headers: ['order id', 'buyer', 'seller', 'product name', 'sold price'], expected: 'whatnot_purchases' }
    ];
    for (const c of cases) {
      expect(detectAdapter({ db, headers: c.headers, rows: [] })?.id).toBe(c.expected);
    }
    expect(detectAdapter({ db, headers: ['Date', 'Montant', 'Article'], rows: [] })).toBeNull();
  });
});

describe('Phase 4 — normalized entities', () => {
  it('normalizes Vinteer sale and purchase rows', () => {
    const db = freshDb();
    const sale = VinteerSalesAdapter.normalize({
      db,
      headers: [],
      rows: [{
        'ID Transaction': '18369803140',
        'Date de vente': '24/05/2026',
        'Date de finalisation': '24/05/2026',
        Statut: 'completed',
        Articles: 'Sac noir',
        SKU: 'SAC-1',
        'Montant encaissé': '18,50',
        'Username acheteur': 'client1'
      }]
    })[0];
    expect(sale.external_id).toBe('18369803140');
    expect(sale.amount_received).toBe(18.5);
    expect(sale.dedup_key).toContain('|id|18369803140');
    expect(sale.dedup_confidence).toBe('high');

    const purchase = VinteerPurchasesAdapter.normalize({
      db,
      headers: [],
      rows: [{
        'ID Transaction': 'P-1',
        'Date de paiement': '25/05/2026',
        Vendeur: 'vendeur1',
        Articles: 'Lot test',
        'Nombre d\'articles': '2',
        'Montant total TTC': '12,40'
      }]
    })[0];
    expect(purchase.supplier_name).toBe('vendeur1');
    expect(purchase.total_ttc).toBe(12.4);
  });

  it('normalizes WhatNot purchase and generic mapped rows', () => {
    const db = freshDb();
    const whatnot = WhatNotPurchasesAdapter.normalize({
      db,
      headers: ['order numeric id', 'seller', 'product name', 'processed date', 'total'],
      rows: [{
        'order numeric id': '1052588021',
        seller: 'destockattack',
        'product name': 'Vu à l’écran #78',
        'processed date': '2026-05-21 17:29 (UTC)',
        total: '€22.40'
      }]
    })[0];
    expect(whatnot.external_id).toBe('1052588021');
    expect(whatnot.total_ttc).toBe(22.4);

    const genericSale = GenericSalesCsvAdapter.normalize({
      db,
      headers: ['Date', 'Statut', 'Article', 'Quantité', 'Montant', 'Plateforme'],
      rows: [{ Date: '26/05/2026', Statut: 'completed', Article: 'Jean', Quantité: '1', Montant: '15,00', Plateforme: 'LeBonCoin' }]
    }, {
      entityType: 'sales',
      mapping: { date: 'Date', status: 'Statut', article_name: 'Article', quantity: 'Quantité', amount_received: 'Montant', platform: 'Plateforme' }
    })[0];
    expect(genericSale.article_name).toBe('Jean');
    expect(genericSale.amount_received).toBe(15);

    const genericExpense = GenericExpensesCsvAdapter.normalize({
      db,
      headers: ['Date', 'Catégorie', 'Fournisseur', 'Description', 'Montant'],
      rows: [{ Date: '26/05/2026', Catégorie: 'emballages', Fournisseur: 'La Poste', Description: 'Cartons', Montant: '7,20' }]
    }, {
      entityType: 'expenses',
      mapping: { date: 'Date', category: 'Catégorie', supplier: 'Fournisseur', description: 'Description', amount_ttc: 'Montant' }
    })[0];
    expect(genericExpense.supplier_name).toBe('La Poste');
    expect(genericExpense.amount_ttc).toBe(7.2);
  });
});

describe('Phase 4 — universal dedup', () => {
  it('builds stable keys and does not collide across platforms', () => {
    const a = buildDedupKey('sale', 'vinted', '123', {});
    const b = buildDedupKey('sale', 'whatnot', '123', {});
    expect(a.key).not.toBe(b.key);
    expect(a.confidence).toBe('high');
  });

  it('marks fallback dedup as low or medium', () => {
    expect(buildDedupKey('sale', 'brocante', null, { articleName: 'Sac' }).confidence).toBe('low');
    expect(buildDedupKey('sale', 'brocante', null, {
      date: '2026-05-26',
      amount: 20,
      articleName: 'Sac',
      party: 'Client'
    }).confidence).toBe('medium');
  });
});

describe('Phase 4 — CSV mapping templates and generic import', () => {
  it('creates, updates, applies and deletes a mapping template', () => {
    const db = freshDb();
    const created = createCsvMappingTemplate(db, {
      name: 'LeBonCoin ventes',
      entity_type: 'sales',
      mapping: { date: 'Date', status: 'Statut', article_name: 'Article', quantity: 'Quantité', amount_received: 'Montant', platform: 'Plateforme' }
    });
    expect(listCsvMappingTemplates(db, 'sales')).toHaveLength(1);
    updateCsvMappingTemplate(db, created.id, { name: 'LBC ventes' });
    expect(listCsvMappingTemplates(db, 'sales')[0].name).toBe('LBC ventes');
    deleteCsvMappingTemplate(db, created.id);
    expect(listCsvMappingTemplates(db, 'sales')).toHaveLength(0);
  });

  it('imports generic sales with mapping and reports exact duplicates on reimport', () => {
    const db = freshDb();
    const file = writeTempCsv(
      'generic-sales.csv',
      'Date;Statut;Article;Quantité;Montant;Plateforme;ID\n26/05/2026;completed;Jean;1;15,00;LeBonCoin;LBC-1\n'
    );
    const mapping = {
      entityType: 'sales' as const,
      mapping: { date: 'Date', status: 'Statut', article_name: 'Article', quantity: 'Quantité', amount_received: 'Montant', platform: 'Plateforme', external_id: 'ID' }
    };
    const preview = buildImportPreview(db, file, 'generic_sales', mapping);
    expect(preview.mappingRequired).toBe(false);
    expect(preview.newRows).toBe(1);

    const first = runImport(db, { filePath: file, forcedType: 'generic_sales', csvMapping: mapping });
    expect(first.created).toBe(1);
    const secondPreview = buildImportPreview(db, file, 'generic_sales', mapping);
    expect(secondPreview.dedupSummary?.exactDuplicates).toBe(1);
    const second = runImport(db, { filePath: file, forcedType: 'generic_sales', csvMapping: mapping });
    expect(second.duplicatesIdentical).toBe(1);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM sales`).get() as { n: number }).n).toBe(1);
  });
});

describe('Phase 4 — migration compatibility', () => {
  it('backfills marketplace and dedup fields without changing URSSAF flags', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);`);
    migration001Initial.up(db);
    migration002.up(db);
    db.prepare(`
      INSERT INTO sales (source, external_id, status, platform, article_name, sku, amount_received, is_declarable, classification, urssaf_declarable)
      VALUES ('vinteer', 'SALE-1', 'completed', 'Vinted', 'Sac', 'SKU-1', 20, 1, 'professional_resale', 1)
    `).run();
    migration010.up(db);
    const sale = db.prepare(`SELECT platform_id, dedup_key, urssaf_declarable FROM sales WHERE external_id='SALE-1'`).get() as { platform_id: number | null; dedup_key: string | null; urssaf_declarable: number };
    expect(sale.platform_id).toBeTruthy();
    expect(sale.dedup_key).toContain('sale|');
    expect(sale.urssaf_declarable).toBe(1);
  });
});
