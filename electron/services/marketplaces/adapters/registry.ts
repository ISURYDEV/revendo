import type { ImportType } from '../../../../shared/types';
import type { AdapterInput, MarketplaceAdapter } from './types';
import {
  VinteerBoostsAdapter,
  VinteerInventoryAdapter,
  VinteerPurchasesAdapter,
  VinteerSalesAdapter
} from './vinteerAdapters';
import { WhatNotPurchasesAdapter } from './whatnotAdapters';
import {
  GenericExpensesCsvAdapter,
  GenericPurchasesCsvAdapter,
  GenericSalesCsvAdapter,
  GenericStockCsvAdapter
} from './genericCsvAdapter';

export const MARKETPLACE_ADAPTERS: MarketplaceAdapter[] = [
  VinteerSalesAdapter,
  VinteerPurchasesAdapter,
  VinteerInventoryAdapter,
  VinteerBoostsAdapter,
  WhatNotPurchasesAdapter,
  GenericSalesCsvAdapter,
  GenericPurchasesCsvAdapter,
  GenericExpensesCsvAdapter,
  GenericStockCsvAdapter
];

export function detectAdapter(input: AdapterInput): MarketplaceAdapter | null {
  return MARKETPLACE_ADAPTERS.find((adapter) => adapter.detect(input)) ?? null;
}

export function adapterForImportType(type: ImportType | 'unknown'): MarketplaceAdapter | null {
  if (type === 'unknown' || type === 'pdf_invoice') return null;
  return MARKETPLACE_ADAPTERS.find((adapter) => adapter.importType === type) ?? null;
}

export function listAdapterMetadata(): Array<Pick<MarketplaceAdapter, 'id' | 'name' | 'platformSlug' | 'importType' | 'supportedFileTypes'>> {
  return MARKETPLACE_ADAPTERS.map(({ id, name, platformSlug, importType, supportedFileTypes }) => ({
    id,
    name,
    platformSlug,
    importType,
    supportedFileTypes
  }));
}
