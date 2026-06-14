import type Database from 'better-sqlite3';
import { parseFrenchDate, parseFrenchNumber } from '../csv/parser';
import type { ImportResult } from '../../../shared/types';

/**
 * Flexible mapping for WhatNot CSV.
 *
 * Each "target" field has multiple "candidate" header names — the importer matches the first
 * header (case-insensitive, trimmed) that appears in the CSV. The mapping can also be overridden
 * by the user from the UI (saved as a template in settings).
 */
export interface WhatNotMapping {
  external_id?: string[];
  payment_date?: string[];
  seller?: string[];
  buyer_account?: string[];
  articles?: string[];
  quantity?: string[];
  items_price?: string[];
  shipping_fee?: string[];
  taxes?: string[];
  total_ttc?: string[];
  status?: string[];
  original_currency?: string[];
  notes?: string[];
}

export const DEFAULT_WHATNOT_MAPPING: Required<WhatNotMapping> = {
  external_id: ['order numeric id', 'order id', 'order_id', 'numéro de commande'],
  payment_date: ['processed date', 'order date', 'date'],
  seller: ['seller', 'vendeur'],
  buyer_account: ['buyer', 'acheteur'],
  articles: ['product name', 'product description', 'article'],
  quantity: ['quantity', 'qty', 'quantité'],
  items_price: ['subtotal', 'sold price', 'price'],
  shipping_fee: ['shipping price', 'shipping', 'frais de port'],
  taxes: ['taxes', 'tax', 'tva'],
  total_ttc: ['total', 'total ttc'],
  status: ['order status', 'status', 'statut'],
  original_currency: ['order currency', 'currency', 'devise'],
  notes: ['note', 'notes', 'description']
};

/** Find the actual header in `headers` that matches one of the candidate names. */
export function resolveHeader(headers: string[], candidates: string[]): string | null {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const c of candidates) {
    const target = c.toLowerCase().trim();
    const idx = lower.indexOf(target);
    if (idx >= 0) return headers[idx];
  }
  return null;
}

export function importWhatNotPurchases(
  db: Database.Database,
  headers: string[],
  rows: Record<string, string>[],
  importId: number,
  mappingOverride?: Partial<WhatNotMapping>
): ImportResult {
  const result: ImportResult = {
    importId,
    type: 'whatnot_purchases',
    created: 0,
    updated: 0,
    duplicatesIdentical: 0,
    conflicts: 0,
    skipped: 0,
    preActivityCount: 0,
    canceledRefundedCount: 0,
    caAdded: 0,
    errors: []
  };

  // Resolve concrete header names from candidates + overrides
  const mapping = { ...DEFAULT_WHATNOT_MAPPING, ...mappingOverride };
  const resolved: Record<string, string | null> = {};
  for (const key of Object.keys(mapping) as (keyof WhatNotMapping)[]) {
    resolved[key] = resolveHeader(headers, mapping[key] ?? []);
  }

  if (!resolved.external_id) {
    result.errors.push({ row: 0, reason: 'Impossible de mapper "order id". Mapping manuel requis.' });
    return result;
  }

  const insert = db.prepare(`
    INSERT INTO purchases (
      source, external_id, import_id,
      payment_date, status, seller, buyer_account, platform,
      articles, quantity, total_ttc, items_price, shipping_fee,
      base_ht, deductible_vat, vat_regime, vat_source,
      original_currency, notes
    ) VALUES (
      'whatnot', @external_id, @import_id,
      @payment_date, @status, @seller, @buyer_account, 'WhatNot',
      @articles, @quantity, @total_ttc, @items_price, @shipping_fee,
      @base_ht, 0, @vat_regime, 'WhatNot import',
      @original_currency, @notes
    )
  `);

  const findExisting = db.prepare(
    `SELECT id FROM purchases WHERE source='whatnot' AND external_id=?`
  );

  const get = (row: Record<string, string>, key: keyof WhatNotMapping): string | null => {
    const header = resolved[key];
    if (!header) return null;
    return row[header] ?? null;
  };

  const tx = db.transaction((items: Record<string, string>[]) => {
    items.forEach((row, idx) => {
      try {
        const externalId = (get(row, 'external_id') ?? '').trim();
        if (!externalId) {
          result.errors.push({ row: idx + 2, reason: 'order id manquant' });
          return;
        }
        const existing = findExisting.get(externalId) as { id: number } | undefined;
        if (existing) {
          result.skipped += 1;
          return;
        }
        const totalTtc = parseFrenchNumber(get(row, 'total_ttc'));
        const itemsPrice = parseFrenchNumber(get(row, 'items_price'));
        insert.run({
          external_id: externalId,
          import_id: importId,
          payment_date: parseFrenchDate(get(row, 'payment_date')),
          status: get(row, 'status'),
          seller: get(row, 'seller'),
          buyer_account: get(row, 'buyer_account'),
          articles: get(row, 'articles'),
          quantity: parseInt(get(row, 'quantity') ?? '1', 10) || 1,
          total_ttc: totalTtc,
          items_price: itemsPrice,
          shipping_fee: parseFrenchNumber(get(row, 'shipping_fee')),
          base_ht: itemsPrice ?? totalTtc, // franchise en base par défaut
          vat_regime: 'franchise_en_base',
          original_currency: get(row, 'original_currency') ?? 'EUR',
          notes: get(row, 'notes')
        });
        result.created += 1;
      } catch (err) {
        result.errors.push({
          row: idx + 2,
          reason: err instanceof Error ? err.message : String(err)
        });
      }
    });
  });

  tx(rows);
  return result;
}
