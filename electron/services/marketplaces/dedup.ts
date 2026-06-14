import type Database from 'better-sqlite3';
import type { DedupConfidence, ImportEntityType } from '../../../shared/types';

export interface DedupFallbackFields {
  date?: string | null;
  amount?: number | null;
  articleName?: string | null;
  party?: string | null;
  sku?: string | null;
  tracking?: string | null;
  platform?: string | number | null;
}

export interface DedupKeyResult {
  key: string;
  confidence: DedupConfidence;
  strategy: 'external_id' | 'tracking' | 'fallback_strong' | 'fallback_weak';
}

export function normalizeDedupToken(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[€$£]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9._@#:/ -]/g, '')
    .replace(/\s/g, '-');
}

function moneyToken(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return '';
  return Math.round(amount * 100).toString();
}

export function buildDedupKey(
  entityType: ImportEntityType,
  platformId: number | string | null | undefined,
  externalId: string | null | undefined,
  fallbackFields: DedupFallbackFields = {}
): DedupKeyResult {
  const platform = normalizeDedupToken(platformId ?? fallbackFields.platform ?? 'unknown') || 'unknown';
  const external = normalizeDedupToken(externalId);
  if (external) {
    return {
      key: `${entityType}|${platform}|id|${external}`,
      confidence: 'high',
      strategy: 'external_id'
    };
  }

  const tracking = normalizeDedupToken(fallbackFields.tracking);
  if (tracking) {
    return {
      key: `${entityType}|${platform}|tracking|${tracking}`,
      confidence: 'medium',
      strategy: 'tracking'
    };
  }

  const parts = [
    fallbackFields.date ? String(fallbackFields.date).slice(0, 10) : '',
    moneyToken(fallbackFields.amount),
    normalizeDedupToken(fallbackFields.articleName),
    normalizeDedupToken(fallbackFields.party),
    normalizeDedupToken(fallbackFields.sku)
  ].filter(Boolean);

  const strong = parts.length >= 4;
  return {
    key: `${entityType}|${platform}|fallback|${parts.join('|') || 'missing'}`,
    confidence: strong ? 'medium' : 'low',
    strategy: strong ? 'fallback_strong' : 'fallback_weak'
  };
}

export function findExistingDedup(
  db: Database.Database,
  table: 'sales' | 'purchases' | 'expenses' | 'stock_items' | 'boosts' | 'documents',
  key: string
): { id: number } | undefined {
  return db.prepare(`SELECT id FROM ${table} WHERE dedup_key=? LIMIT 1`).get(key) as { id: number } | undefined;
}

export function tableForEntity(entityType: ImportEntityType): 'sales' | 'purchases' | 'expenses' | 'stock_items' | 'boosts' | 'documents' {
  switch (entityType) {
    case 'sale': return 'sales';
    case 'purchase': return 'purchases';
    case 'expense': return 'expenses';
    case 'stock_item': return 'stock_items';
    case 'boost': return 'boosts';
    case 'document': return 'documents';
  }
}
