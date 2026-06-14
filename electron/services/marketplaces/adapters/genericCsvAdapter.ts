import { parseFrenchDate, parseFrenchNumber } from '../../csv/parser';
import { buildDedupKey } from '../dedup';
import type { MarketplaceAdapter, AdapterInput } from './types';
import { minMaxDate } from './types';
import type {
  CsvMappingTemplate,
  GenericCsvMapping,
  ImportType,
  NormalizedExpense,
  NormalizedPurchase,
  NormalizedSale,
  NormalizedStockItem,
  SaleStatus
} from '../../../../shared/types';

type EntityType = 'sales' | 'purchases' | 'expenses' | 'stock';

const REQUIRED: Record<EntityType, string[]> = {
  sales: ['date', 'status', 'article_name', 'quantity', 'amount_received', 'platform'],
  purchases: ['date', 'supplier', 'article_name', 'quantity', 'total_ttc'],
  expenses: ['date', 'category', 'supplier', 'description', 'amount_ttc'],
  stock: ['name', 'quantity']
};

const IMPORT_TYPE: Record<EntityType, ImportType> = {
  sales: 'generic_sales',
  purchases: 'generic_purchases',
  expenses: 'generic_expenses',
  stock: 'generic_stock'
};

function mappingFrom(input?: GenericCsvMapping | CsvMappingTemplate | null): Record<string, string> {
  if (!input) return {};
  if ('mapping' in input) return input.mapping ?? {};
  try {
    return JSON.parse(input.mapping_json || '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function platformFrom(input?: GenericCsvMapping | CsvMappingTemplate | null): number | null {
  if (!input) return null;
  if ('mapping_json' in input) return input.platform_id ?? null;
  return input.platformId ?? null;
}

function get(row: Record<string, string>, mapping: Record<string, string>, field: string): string | null {
  const header = mapping[field];
  return header ? row[header] ?? null : null;
}

function status(raw: string | null): SaleStatus {
  const s = (raw ?? '').toLowerCase().trim();
  if (['completed', 'complété', 'complete', 'termine', 'terminé', 'payé', 'paye'].includes(s)) return 'completed';
  if (['colis_perdu', 'colis perdu', 'colis perdu indemnisé', 'colis perdu indemnise', 'lost package', 'package lost'].includes(s)) return 'colis_perdu';
  if (['canceled', 'cancelled', 'annulé', 'annule'].includes(s)) return 'canceled';
  if (['refunded', 'remboursé', 'rembourse'].includes(s)) return 'refunded';
  if (['shipped', 'expédié', 'expedie', 'en expedition'].includes(s)) return 'shipped';
  if (['processing', 'pending', 'en cours'].includes(s)) return 'processing';
  return 'other';
}

function previewFor(rows: Record<string, string>[], mapping: Record<string, string>, amountField: string, dateField: string, requiredFields: string[]) {
  const dates: Array<string | null> = [];
  let total = 0;
  let saw = false;
  for (const row of rows) {
    const amount = parseFrenchNumber(get(row, mapping, amountField));
    if (amount != null) {
      total += amount;
      saw = true;
    }
    dates.push(parseFrenchDate(get(row, mapping, dateField)));
  }
  const range = minMaxDate(dates);
  return { totalAmount: saw ? total : null, dateMin: range.min, dateMax: range.max, warnings: [], requiredFields };
}

export function createGenericCsvAdapter(entityType: EntityType): MarketplaceAdapter {
  return {
    id: `generic_${entityType}_csv`,
    name: `CSV générique — ${entityType}`,
    platformSlug: 'autre',
    importType: IMPORT_TYPE[entityType],
    supportedFileTypes: ['csv'],
    detect: () => false,
    preview(input, mappingInput) {
      const mapping = mappingFrom(mappingInput);
      const amountField =
        entityType === 'sales' ? 'amount_received' :
        entityType === 'purchases' ? 'total_ttc' :
        entityType === 'expenses' ? 'amount_ttc' :
        'cost';
      const dateField = entityType === 'sales' || entityType === 'purchases' || entityType === 'expenses' ? 'date' : 'purchase_date';
      return previewFor(input.rows, mapping, amountField, dateField, REQUIRED[entityType]);
    },
    normalize(input, mappingInput) {
      const mapping = mappingFrom(mappingInput);
      const pid = platformFrom(mappingInput);
      if (entityType === 'sales') {
        return input.rows.map((row): NormalizedSale => {
          const externalId = get(row, mapping, 'external_id')?.trim() || null;
          const date = parseFrenchDate(get(row, mapping, 'date'));
          const amount = parseFrenchNumber(get(row, mapping, 'amount_received'));
          const dedup = buildDedupKey('sale', pid ?? get(row, mapping, 'platform') ?? 'generic', externalId, {
            date,
            amount,
            articleName: get(row, mapping, 'article_name'),
            party: get(row, mapping, 'buyer_username'),
            sku: get(row, mapping, 'sku'),
            tracking: get(row, mapping, 'tracking'),
            platform: get(row, mapping, 'platform')
          });
          return {
            source_adapter_id: 'generic_sales_csv',
            platform_id: pid,
            channel_id: mappingInput && 'channelId' in mappingInput ? mappingInput.channelId ?? null : null,
            external_id: externalId,
            external_reference: externalId,
            dedup_key: dedup.key,
            dedup_confidence: dedup.confidence,
            raw_row: row,
            platform: get(row, mapping, 'platform'),
            sale_date: date,
            finalization_date: date,
            encashment_date: date,
            status: status(get(row, mapping, 'status')),
            article_name: get(row, mapping, 'article_name'),
            quantity: parseInt(get(row, mapping, 'quantity') ?? '1', 10) || 1,
            sku: get(row, mapping, 'sku'),
            brand: get(row, mapping, 'brand'),
            size: get(row, mapping, 'size'),
            color: get(row, mapping, 'color'),
            buyer_username: get(row, mapping, 'buyer_username'),
            buyer_country: get(row, mapping, 'buyer_country'),
            sale_price_ttc: parseFrenchNumber(get(row, mapping, 'sale_price_ttc')) ?? amount,
            amount_received: amount,
            refunded_amount: parseFrenchNumber(get(row, mapping, 'refunded_amount')),
            fees: parseFrenchNumber(get(row, mapping, 'fees')),
            shipping_amount: parseFrenchNumber(get(row, mapping, 'shipping')),
            tracking_number: get(row, mapping, 'tracking'),
            notes: get(row, mapping, 'notes')
          };
        });
      }
      if (entityType === 'purchases') {
        return input.rows.map((row): NormalizedPurchase => {
          const externalId = get(row, mapping, 'external_id')?.trim() || null;
          const date = parseFrenchDate(get(row, mapping, 'date'));
          const total = parseFrenchNumber(get(row, mapping, 'total_ttc'));
          const dedup = buildDedupKey('purchase', pid ?? get(row, mapping, 'platform') ?? 'generic', externalId, {
            date,
            amount: total,
            articleName: get(row, mapping, 'article_name'),
            party: get(row, mapping, 'supplier'),
            sku: get(row, mapping, 'sku'),
            platform: get(row, mapping, 'platform')
          });
          return {
            source_adapter_id: 'generic_purchases_csv',
            platform_id: pid,
            channel_id: mappingInput && 'channelId' in mappingInput ? mappingInput.channelId ?? null : null,
            external_id: externalId,
            external_reference: externalId,
            dedup_key: dedup.key,
            dedup_confidence: dedup.confidence,
            raw_row: row,
            purchase_date: date,
            status: get(row, mapping, 'status'),
            supplier_name: get(row, mapping, 'supplier'),
            platform: get(row, mapping, 'platform'),
            article_name: get(row, mapping, 'article_name'),
            quantity: parseInt(get(row, mapping, 'quantity') ?? '1', 10) || 1,
            sku: get(row, mapping, 'sku'),
            total_ttc: total,
            items_amount: parseFrenchNumber(get(row, mapping, 'items_amount')),
            shipping_amount: parseFrenchNumber(get(row, mapping, 'shipping')),
            protection_fee: parseFrenchNumber(get(row, mapping, 'protection_fee')),
            tax_amount: parseFrenchNumber(get(row, mapping, 'tax')),
            original_currency: get(row, mapping, 'currency') ?? 'EUR',
            exchange_rate: parseFrenchNumber(get(row, mapping, 'exchange_rate')),
            notes: get(row, mapping, 'notes')
          };
        });
      }
      if (entityType === 'expenses') {
        return input.rows.map((row): NormalizedExpense => {
          const date = parseFrenchDate(get(row, mapping, 'date'));
          const amount = parseFrenchNumber(get(row, mapping, 'amount_ttc'));
          const externalId = get(row, mapping, 'external_id')?.trim() || null;
          const dedup = buildDedupKey('expense', pid ?? get(row, mapping, 'platform') ?? 'generic', externalId, {
            date,
            amount,
            articleName: get(row, mapping, 'description'),
            party: get(row, mapping, 'supplier'),
            platform: get(row, mapping, 'platform')
          });
          return {
            source_adapter_id: 'generic_expenses_csv',
            platform_id: pid,
            channel_id: mappingInput && 'channelId' in mappingInput ? mappingInput.channelId ?? null : null,
            external_id: externalId,
            external_reference: externalId,
            dedup_key: dedup.key,
            dedup_confidence: dedup.confidence,
            raw_row: row,
            expense_date: date,
            category: get(row, mapping, 'category'),
            supplier_name: get(row, mapping, 'supplier'),
            platform: get(row, mapping, 'platform'),
            description: get(row, mapping, 'description'),
            amount_ttc: amount,
            tax_amount: parseFrenchNumber(get(row, mapping, 'tax')),
            payment_method: get(row, mapping, 'payment_method'),
            notes: get(row, mapping, 'notes')
          };
        });
      }
      return input.rows.map((row): NormalizedStockItem => {
        const name = get(row, mapping, 'name');
        const qty = parseInt(get(row, mapping, 'quantity') ?? '1', 10) || 1;
        const dedup = buildDedupKey('stock_item', pid ?? get(row, mapping, 'source') ?? 'generic', null, {
          articleName: name,
          sku: get(row, mapping, 'sku'),
          amount: parseFrenchNumber(get(row, mapping, 'cost')),
          platform: get(row, mapping, 'source')
        });
        return {
          source_adapter_id: 'generic_stock_csv',
          platform_id: pid,
          channel_id: mappingInput && 'channelId' in mappingInput ? mappingInput.channelId ?? null : null,
          external_id: null,
          external_reference: get(row, mapping, 'sku'),
          dedup_key: dedup.key,
          dedup_confidence: dedup.confidence,
          raw_row: row,
          name,
          quantity: qty,
          sku: get(row, mapping, 'sku'),
          brand: get(row, mapping, 'brand'),
          size: get(row, mapping, 'size'),
          color: get(row, mapping, 'color'),
          unit_cost_ttc: parseFrenchNumber(get(row, mapping, 'cost')),
          estimated_sale_price: parseFrenchNumber(get(row, mapping, 'estimated_price')),
          source: get(row, mapping, 'source'),
          location: get(row, mapping, 'location'),
          notes: get(row, mapping, 'notes')
        };
      });
    },
    validate(rows) {
      const required = REQUIRED[entityType];
      return rows.flatMap((row, idx) => {
        const missing = required.filter((f) => {
          const r = row as unknown as Record<string, unknown>;
          if (f === 'date') return !(r.sale_date || r.purchase_date || r.expense_date);
          if (f === 'amount_received') return r.amount_received == null;
          if (f === 'total_ttc') return r.total_ttc == null;
          if (f === 'amount_ttc') return r.amount_ttc == null;
          if (f === 'article_name') return !r.article_name;
          if (f === 'supplier') return !(r.supplier_name || r.supplier);
          if (f === 'platform') return r.platform_id == null && !r.platform;
          if (f === 'name') return !r.name;
          return r[f] == null || r[f] === '';
        });
        return missing.length ? [{ row: idx + 2, reason: `Champs obligatoires manquants: ${missing.join(', ')}` }] : [];
      });
    },
    getDefaultMapping: () => ({}),
    getRequiredFields: () => REQUIRED[entityType]
  };
}

export const GenericSalesCsvAdapter = createGenericCsvAdapter('sales');
export const GenericPurchasesCsvAdapter = createGenericCsvAdapter('purchases');
export const GenericExpensesCsvAdapter = createGenericCsvAdapter('expenses');
export const GenericStockCsvAdapter = createGenericCsvAdapter('stock');
