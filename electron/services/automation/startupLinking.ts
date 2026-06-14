import type Database from 'better-sqlite3';
import { ensureStockForSalesWithSku } from '../sales/stockAssociation';
import { generateJustificatifAchat } from '../pdf/justificatifAchat';
import { linkDocument } from '../documents/storage';
import { matchSalesInvoiceBySku } from '../documents/salesInvoiceMatcher';
import { matchBoostInvoiceToExpense } from '../documents/boostInvoiceMatcher';
import { markWhatNotPurchasesJustified } from '../documents/whatnotCsvJustificatif';

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

interface DocRow {
  id: number;
  source: string | null;
  original_file_name: string | null;
  date: string | null;
  amount: number | null;
  external_reference: string | null;
  created_at: string;
}

export interface AutomaticLinkingResult {
  stockCreated: number;
  stockLinked: number;
  stockAmbiguous: number;
  stockNeedsReview: number;
  saleInvoicesMatched: number;
  boostInvoicesMatched: number;
  boostInvoicesAmbiguous: number;
  aliExpressPurchasesCreated: number;
  whatNotJustificatifsGenerated: number;
  whatNotCsvLinks: number;
  errors: string[];
}

export function ensurePurchaseFromPurchaseDocument(
  db: Database.Database,
  documentId: number,
  platform: string
): { purchaseId: number; created: boolean } {
  const existing = db.prepare(
    `SELECT p.id
     FROM purchases p
     JOIN document_links dl ON dl.entity_type='purchase' AND dl.entity_id=p.id
     WHERE dl.document_id=?`
  ).get(documentId) as { id: number } | undefined;
  if (existing) return { purchaseId: existing.id, created: false };

  const doc = db.prepare(`SELECT * FROM documents WHERE id=?`).get(documentId) as DocRow | undefined;
  if (!doc) throw new Error('Document introuvable');

  const source = platform.toLowerCase().includes('ali') ? 'pdf_aliexpress' : `pdf_${platform.toLowerCase().replace(/\W+/g, '_')}`;
  const date = (doc.date ?? doc.created_at ?? new Date().toISOString()).slice(0, 10);
  const amount = doc.amount ?? 0;
  const columns = [
    'source', 'external_id', 'payment_date', 'status', 'seller', 'platform', 'articles',
    'quantity', 'items_price', 'shipping_fee', 'protection_fee', 'total_ttc',
    'base_ht', 'deductible_vat', 'vat_regime', 'vat_source', 'notes'
  ];
  const values: unknown[] = [
    source,
    `document:${documentId}`,
    date,
    'completed',
    platform,
    platform,
    doc.original_file_name ?? `Facture ${platform}`,
    1,
    amount,
    0,
    0,
    amount,
    amount,
    0,
    'franchise_en_base',
    'Facture PDF importée',
    `Achat créé automatiquement depuis facture ${platform} #${documentId}. Justificatif présent.`
  ];
  if (hasColumn(db, 'purchases', 'justificatif_status')) {
    columns.push('justificatif_status');
    values.push('present');
  }

  const placeholders = columns.map(() => '?').join(', ');
  const info = db.prepare(`INSERT INTO purchases (${columns.join(', ')}) VALUES (${placeholders})`).run(...values);
  const purchaseId = Number(info.lastInsertRowid);
  linkDocument(db, { document_id: documentId, entity_type: 'purchase', entity_id: purchaseId });
  db.prepare(`UPDATE documents SET match_status='matched', match_confidence='high', source=COALESCE(source, ?) WHERE id=?`).run(platform, documentId);
  return { purchaseId, created: true };
}

export async function runAutomaticLinking(db: Database.Database): Promise<AutomaticLinkingResult> {
  const result: AutomaticLinkingResult = {
    stockCreated: 0,
    stockLinked: 0,
    stockAmbiguous: 0,
    stockNeedsReview: 0,
    saleInvoicesMatched: 0,
    boostInvoicesMatched: 0,
    boostInvoicesAmbiguous: 0,
    aliExpressPurchasesCreated: 0,
    whatNotJustificatifsGenerated: 0,
    whatNotCsvLinks: 0,
    errors: []
  };

  try {
    // P0.2 : on N'AUTOCRÉE PAS de stock au démarrage. On lie ce qui peut l'être
    // et on marque le reste pour vérification dans le Centre de révision.
    const stock = ensureStockForSalesWithSku(db, {});
    result.stockCreated = stock.created;
    result.stockLinked = stock.linked;
    result.stockAmbiguous = stock.ambiguous;
    result.stockNeedsReview = stock.needsReview;
  } catch (err) {
    result.errors.push(`Stock par SKU: ${err instanceof Error ? err.message : String(err)}`);
  }

  const whatNotCsvDocs = db.prepare(
    `SELECT id, external_reference FROM documents
     WHERE document_type='whatnot_purchase_csv' AND external_reference LIKE 'import:%'`
  ).all() as { id: number; external_reference: string }[];
  for (const doc of whatNotCsvDocs) {
    const importId = Number(doc.external_reference.replace('import:', ''));
    if (!Number.isFinite(importId)) continue;
    try {
      result.whatNotCsvLinks += markWhatNotPurchasesJustified(db, { importId, documentId: doc.id }).linkedPurchases;
    } catch (err) {
      result.errors.push(`CSV WhatNot #${doc.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const whatNotPurchases = db.prepare(
    `SELECT p.id
     FROM purchases p
     WHERE lower(COALESCE(p.platform, p.source, '')) LIKE '%whatnot%'
       AND COALESCE(p.justificatif_status, '') != 'present'
       AND NOT EXISTS (SELECT 1 FROM document_links dl WHERE dl.entity_type='purchase' AND dl.entity_id=p.id)
     LIMIT 100`
  ).all() as { id: number }[];
  for (const purchase of whatNotPurchases) {
    try {
      await generateJustificatifAchat(db, purchase.id);
      db.prepare(`UPDATE purchases SET justificatif_status='present' WHERE id=?`).run(purchase.id);
      result.whatNotJustificatifsGenerated += 1;
    } catch (err) {
      result.errors.push(`Justificatif WhatNot achat #${purchase.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const saleDocs = db.prepare(
    `SELECT id FROM documents d
     WHERE d.document_type='facture_vente'
       AND NOT EXISTS (SELECT 1 FROM document_links dl WHERE dl.document_id=d.id AND dl.entity_type='sale')
     LIMIT 200`
  ).all() as { id: number }[];
  for (const doc of saleDocs) {
    try {
      const matched = await matchSalesInvoiceBySku(db, doc.id);
      if (matched.status === 'matched') result.saleInvoicesMatched += matched.linkedSales.length;
    } catch (err) {
      result.errors.push(`Facture vente #${doc.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const boostDocs = db.prepare(
    `SELECT id FROM documents d
     WHERE d.document_type='facture_boost'
       AND NOT EXISTS (SELECT 1 FROM document_links dl WHERE dl.document_id=d.id AND dl.entity_type='expense')
     LIMIT 200`
  ).all() as { id: number }[];
  for (const doc of boostDocs) {
    try {
      const matched = matchBoostInvoiceToExpense(db, doc.id);
      if (matched.status === 'matched') result.boostInvoicesMatched += 1;
      if (matched.status === 'ambiguous') result.boostInvoicesAmbiguous += 1;
    } catch (err) {
      result.errors.push(`Facture boost #${doc.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const aliDocs = db.prepare(
    `SELECT id FROM documents d
     WHERE d.document_type='facture_achat'
       AND lower(COALESCE(d.source, d.original_file_name, '')) LIKE '%ali%'
       AND NOT EXISTS (SELECT 1 FROM document_links dl WHERE dl.document_id=d.id AND dl.entity_type='purchase')
     LIMIT 200`
  ).all() as { id: number }[];
  for (const doc of aliDocs) {
    try {
      const p = ensurePurchaseFromPurchaseDocument(db, doc.id, 'AliExpress');
      if (p.created) result.aliExpressPurchasesCreated += 1;
    } catch (err) {
      result.errors.push(`Facture AliExpress #${doc.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}
