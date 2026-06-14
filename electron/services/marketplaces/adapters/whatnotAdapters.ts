import { parseFrenchDate, parseFrenchNumber } from '../../csv/parser';
import { DEFAULT_WHATNOT_MAPPING, resolveHeader } from '../../importers/whatnotPurchases';
import { buildDedupKey } from '../dedup';
import { findMarketplaceBySlug } from '../repository';
import type { MarketplaceAdapter, AdapterInput } from './types';
import { hasHeaders, minMaxDate } from './types';
import type { NormalizedPurchase } from '../../../../shared/types';

function platformId(input: AdapterInput): number | null {
  return findMarketplaceBySlug(input.db, 'whatnot')?.id ?? null;
}

export const WhatNotPurchasesAdapter: MarketplaceAdapter = {
  id: 'whatnot_purchases',
  name: 'WhatNot — achats',
  platformSlug: 'whatnot',
  importType: 'whatnot_purchases',
  supportedFileTypes: ['csv'],
  detect: (input) => hasHeaders(input.headers, ['order id', 'buyer', 'seller', 'product name', 'sold price']),
  preview(input) {
    const resolvedTotal = resolveHeader(input.headers, DEFAULT_WHATNOT_MAPPING.total_ttc);
    const resolvedDate = resolveHeader(input.headers, DEFAULT_WHATNOT_MAPPING.payment_date);
    let total = 0;
    let sawAmount = false;
    const dates: Array<string | null> = [];
    for (const row of input.rows) {
      const amount = parseFrenchNumber(resolvedTotal ? row[resolvedTotal] : null);
      if (amount != null) {
        total += amount;
        sawAmount = true;
      }
      if (resolvedDate) dates.push(parseFrenchDate(row[resolvedDate]));
    }
    const range = minMaxDate(dates);
    return {
      totalAmount: sawAmount ? total : null,
      dateMin: range.min,
      dateMax: range.max,
      warnings: [],
      requiredFields: this.getRequiredFields()
    };
  },
  normalize(input) {
    const mapping = DEFAULT_WHATNOT_MAPPING;
    const resolved: Record<string, string | null> = {};
    for (const key of Object.keys(mapping) as Array<keyof typeof mapping>) {
      resolved[key] = resolveHeader(input.headers, mapping[key]);
    }
    const get = (row: Record<string, string>, key: keyof typeof mapping): string | null => {
      const h = resolved[key];
      return h ? row[h] ?? null : null;
    };
    const pid = platformId(input);
    return input.rows.map((row): NormalizedPurchase => {
      const externalId = (get(row, 'external_id') ?? '').trim() || null;
      const date = parseFrenchDate(get(row, 'payment_date'));
      const total = parseFrenchNumber(get(row, 'total_ttc'));
      const dedup = buildDedupKey('purchase', pid ?? 'whatnot', externalId, {
        date,
        amount: total,
        articleName: get(row, 'articles'),
        party: get(row, 'seller'),
        platform: 'whatnot'
      });
      return {
        source_adapter_id: 'whatnot_purchases',
        platform_id: pid,
        channel_id: null,
        external_id: externalId,
        external_reference: externalId,
        dedup_key: dedup.key,
        dedup_confidence: dedup.confidence,
        raw_row: row,
        purchase_date: date,
        status: get(row, 'status'),
        supplier_name: get(row, 'seller'),
        platform: 'WhatNot',
        article_name: get(row, 'articles'),
        quantity: parseInt(get(row, 'quantity') ?? '1', 10) || 1,
        sku: null,
        total_ttc: total,
        items_amount: parseFrenchNumber(get(row, 'items_price')),
        shipping_amount: parseFrenchNumber(get(row, 'shipping_fee')),
        protection_fee: null,
        tax_amount: parseFrenchNumber(get(row, 'taxes')),
        original_currency: get(row, 'original_currency') ?? 'EUR',
        exchange_rate: null,
        notes: get(row, 'notes')
      };
    });
  },
  validate: (rows) => rows.flatMap((row, idx) => row.external_id ? [] : [{ row: idx + 2, reason: 'Order ID manquant' }]),
  getDefaultMapping: () => DEFAULT_WHATNOT_MAPPING as unknown as Record<string, string>,
  getRequiredFields: () => ['order id', 'seller', 'product name', 'total']
};
