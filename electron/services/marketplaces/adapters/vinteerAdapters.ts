import { parseFrenchDate, parseFrenchNumber } from '../../csv/parser';
import { buildDedupKey } from '../dedup';
import { findMarketplaceBySlug } from '../repository';
import type { MarketplaceAdapter, AdapterInput, AdapterPreview, NormalizedEntity } from './types';
import { hasHeaders, minMaxDate } from './types';
import type { NormalizedBoost, NormalizedPurchase, NormalizedSale, NormalizedStockItem, SaleStatus } from '../../../../shared/types';

const STATUS_MAP: Record<string, SaleStatus> = {
  completed: 'completed',
  colis_perdu: 'colis_perdu',
  'colis perdu': 'colis_perdu',
  'colis perdu indemnisé': 'colis_perdu',
  'colis perdu indemnise': 'colis_perdu',
  shipped: 'shipped',
  processing: 'processing',
  canceled: 'canceled',
  cancelled: 'canceled',
  annulé: 'canceled',
  annule: 'canceled',
  refunded: 'refunded',
  remboursé: 'refunded',
  rembourse: 'refunded'
};

function normalizeStatus(raw: string | null | undefined): SaleStatus {
  if (!raw) return 'other';
  return STATUS_MAP[raw.toLowerCase().trim()] ?? 'other';
}

function platformId(input: AdapterInput, slug: string): number | null {
  return findMarketplaceBySlug(input.db, slug)?.id ?? null;
}

function previewCommon(
  rows: Record<string, string>[],
  amountHeader: string | null,
  dateHeader: string | null,
  requiredFields: string[]
): AdapterPreview {
  const dates: Array<string | null> = [];
  let total = 0;
  let sawAmount = false;
  for (const row of rows) {
    if (amountHeader) {
      const amount = parseFrenchNumber(row[amountHeader]);
      if (amount != null) {
        total += amount;
        sawAmount = true;
      }
    }
    if (dateHeader) dates.push(parseFrenchDate(row[dateHeader]) ?? row[dateHeader] ?? null);
  }
  const range = minMaxDate(dates);
  return { totalAmount: sawAmount ? total : null, dateMin: range.min, dateMax: range.max, warnings: [], requiredFields };
}

export const VinteerSalesAdapter: MarketplaceAdapter = {
  id: 'vinteer_sales',
  name: 'Vinteer — ventes Vinted',
  platformSlug: 'vinted',
  importType: 'vinteer_sales',
  supportedFileTypes: ['csv'],
  detect: (input) => hasHeaders(input.headers, ['ID Transaction', 'Date de vente', 'Montant encaissé', 'Statut', 'Articles']),
  preview: (input) => previewCommon(input.rows, 'Montant encaissé', 'Date de finalisation', VinteerSalesAdapter.getRequiredFields()),
  normalize(input) {
    const pid = platformId(input, 'vinted');
    return input.rows.map((row): NormalizedSale => {
      const encashment = parseFrenchDate(row['Date de finalisation']);
      const amount = parseFrenchNumber(row['Montant encaissé']);
      const externalId = (row['ID Transaction'] ?? '').trim() || null;
      const dedup = buildDedupKey('sale', pid ?? 'vinted', externalId, {
        date: encashment,
        amount,
        articleName: row['Articles'],
        party: row['Username acheteur'],
        sku: row['SKU'],
        tracking: row['Numéro de suivi'],
        platform: 'vinted'
      });
      return {
        source_adapter_id: 'vinteer_sales',
        platform_id: pid,
        channel_id: null,
        external_id: externalId,
        external_reference: externalId,
        dedup_key: dedup.key,
        dedup_confidence: dedup.confidence,
        raw_row: row,
        platform: row['Canal de vente'] || 'Vinted',
        sale_date: parseFrenchDate(row['Date de vente']),
        finalization_date: parseFrenchDate(row['Date de finalisation']),
        encashment_date: encashment,
        status: normalizeStatus(row['Statut']),
        article_name: row['Articles'] || null,
        quantity: parseInt(row['Nombre d\'articles'] ?? '1', 10) || 1,
        sku: row['SKU'] || null,
        brand: row['Marques (par article)'] || null,
        size: row['Tailles (par article)'] || null,
        color: row['Couleurs (par article)'] || null,
        buyer_username: row['Username acheteur'] || null,
        buyer_country: row['Pays acheteur'] || null,
        sale_price_ttc: parseFrenchNumber(row['Prix de vente TTC']),
        amount_received: amount,
        refunded_amount: parseFrenchNumber(row['Montant remboursé']),
        fees: parseFrenchNumber(row['Frais Vinted']),
        shipping_amount: parseFrenchNumber(row['Frais de port TTC']),
        tracking_number: row['Numéro de suivi'] || null,
        notes: row['Note'] || null
      };
    });
  },
  validate(rows) {
    return rows.flatMap((row, idx) => row.external_id ? [] : [{ row: idx + 2, reason: 'ID transaction manquant' }]);
  },
  getDefaultMapping: () => ({}),
  getRequiredFields: () => ['ID Transaction', 'Date de finalisation', 'Montant encaissé', 'Statut', 'Articles']
};

export const VinteerPurchasesAdapter: MarketplaceAdapter = {
  id: 'vinteer_purchases',
  name: 'Vinteer — achats Vinted',
  platformSlug: 'vinted',
  importType: 'vinteer_purchases',
  supportedFileTypes: ['csv'],
  detect: (input) => hasHeaders(input.headers, ['ID Transaction', 'Date de paiement', 'Montant total TTC', 'Vendeur']),
  preview: (input) => previewCommon(input.rows, 'Montant total TTC', 'Date de paiement', VinteerPurchasesAdapter.getRequiredFields()),
  normalize(input) {
    const pid = platformId(input, 'vinted');
    return input.rows.map((row): NormalizedPurchase => {
      const externalId = (row['ID Transaction'] ?? '').trim() || null;
      const purchaseDate = parseFrenchDate(row['Date de paiement']);
      const total = parseFrenchNumber(row['Montant total TTC']);
      const dedup = buildDedupKey('purchase', pid ?? 'vinted', externalId, {
        date: purchaseDate,
        amount: total,
        articleName: row['Articles'],
        party: row['Vendeur'],
        sku: row['SKU'],
        tracking: row['Numéro de suivi'],
        platform: 'vinted'
      });
      return {
        source_adapter_id: 'vinteer_purchases',
        platform_id: pid,
        channel_id: null,
        external_id: externalId,
        external_reference: externalId,
        dedup_key: dedup.key,
        dedup_confidence: dedup.confidence,
        raw_row: row,
        purchase_date: purchaseDate,
        status: row['Statut'] || null,
        supplier_name: row['Vendeur'] || null,
        platform: 'Vinted',
        article_name: row['Articles'] || null,
        quantity: parseInt(row['Nombre d\'articles'] ?? '1', 10) || 1,
        sku: row['SKU'] || null,
        total_ttc: total,
        items_amount: parseFrenchNumber(row['Prix des articles']),
        shipping_amount: parseFrenchNumber(row['Frais de port']),
        protection_fee: parseFrenchNumber(row['Frais de protection']),
        tax_amount: parseFrenchNumber(row['TVA déductible']),
        original_currency: row['Devise d\'origine'] || 'EUR',
        exchange_rate: parseFrenchNumber(row['Taux de change']),
        notes: null
      };
    });
  },
  validate: (rows) => rows.flatMap((row, idx) => row.external_id ? [] : [{ row: idx + 2, reason: 'ID transaction manquant' }]),
  getDefaultMapping: () => ({}),
  getRequiredFields: () => ['ID Transaction', 'Date de paiement', 'Montant total TTC', 'Vendeur']
};

export const VinteerInventoryAdapter: MarketplaceAdapter = {
  id: 'vinteer_inventory',
  name: 'Vinteer — inventaire',
  platformSlug: 'vinted',
  importType: 'vinteer_inventory',
  supportedFileTypes: ['csv'],
  detect: (input) => hasHeaders(input.headers, ['SKU', 'Nom', 'En stock (restants)', 'COGS unitaire (€)']),
  preview: (input) => previewCommon(input.rows, 'Prix estimé (€)', null, VinteerInventoryAdapter.getRequiredFields()),
  normalize(input) {
    const pid = platformId(input, 'vinted');
    return input.rows.map((row): NormalizedStockItem => {
      const name = row['Nom'] || null;
      const sku = row['SKU'] || null;
      const quantity = parseInt(row['En stock (restants)'] ?? '0', 10) || 0;
      const dedup = buildDedupKey('stock_item', pid ?? 'vinted', null, {
        articleName: name,
        sku,
        amount: parseFrenchNumber(row['COGS total (€)']),
        party: row['Fournisseur'],
        platform: 'vinted'
      });
      return {
        source_adapter_id: 'vinteer_inventory',
        platform_id: pid,
        channel_id: null,
        external_id: null,
        external_reference: sku,
        dedup_key: dedup.key,
        dedup_confidence: dedup.confidence,
        raw_row: row,
        name,
        quantity,
        sku,
        brand: null,
        size: null,
        color: null,
        unit_cost_ttc: parseFrenchNumber(row['COGS unitaire (€)']),
        estimated_sale_price: parseFrenchNumber(row['Prix estimé (€)']),
        source: 'vinteer_inventory',
        location: null,
        notes: row['Type de stock'] ? `Type: ${row['Type de stock']}` : null
      };
    });
  },
  validate: (rows) => rows.flatMap((row, idx) => (row as NormalizedStockItem).name ? [] : [{ row: idx + 2, reason: 'Nom manquant' }]),
  getDefaultMapping: () => ({}),
  getRequiredFields: () => ['SKU', 'Nom', 'En stock (restants)', 'COGS unitaire (€)']
};

export const VinteerBoostsAdapter: MarketplaceAdapter = {
  id: 'vinteer_boosts',
  name: 'Vinteer — boosts Vinted',
  platformSlug: 'vinted',
  importType: 'vinteer_boosts',
  supportedFileTypes: ['csv'],
  detect: (input) => hasHeaders(input.headers, ['Date de début', 'Type de boost', 'Montant TTC', 'Montant HT']),
  preview: (input) => previewCommon(input.rows, 'Montant TTC', 'Date de début', VinteerBoostsAdapter.getRequiredFields()),
  normalize(input) {
    const pid = platformId(input, 'vinted');
    return input.rows.map((row): NormalizedBoost => {
      const externalId = (row['ID'] ?? '').trim() || null;
      const start = parseFrenchDate(row['Date de début']);
      const amount = parseFrenchNumber(row['Montant TTC']);
      const dedup = buildDedupKey('boost', pid ?? 'vinted', externalId, {
        date: start,
        amount,
        articleName: row['Type de boost'],
        platform: 'vinted'
      });
      return {
        source_adapter_id: 'vinteer_boosts',
        platform_id: pid,
        channel_id: null,
        external_id: externalId,
        external_reference: externalId,
        dedup_key: dedup.key,
        dedup_confidence: dedup.confidence,
        raw_row: row,
        start_date: start,
        boost_type: row['Type de boost'] || null,
        scope: row['Portée'] || null,
        duration_days: parseInt(row['Durée (jours)'] ?? '', 10) || null,
        boosted_articles_count: parseInt(row['Articles boostés'] ?? '', 10) || null,
        amount_ttc: amount,
        tax_amount: parseFrenchNumber(row['Montant TVA']),
        notes: null
      };
    });
  },
  validate: (rows: NormalizedEntity[]) => rows.flatMap((row, idx) => row.external_id ? [] : [{ row: idx + 2, reason: 'ID manquant' }]),
  getDefaultMapping: () => ({}),
  getRequiredFields: () => ['ID', 'Date de début', 'Type de boost', 'Montant TTC']
};
