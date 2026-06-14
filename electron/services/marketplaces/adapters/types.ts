import type Database from 'better-sqlite3';
import type {
  CsvMappingTemplate,
  GenericCsvMapping,
  ImportType,
  NormalizedBoost,
  NormalizedExpense,
  NormalizedPurchase,
  NormalizedSale,
  NormalizedStockItem
} from '../../../../shared/types';

export type NormalizedEntity =
  | NormalizedSale
  | NormalizedPurchase
  | NormalizedExpense
  | NormalizedStockItem
  | NormalizedBoost;

export interface AdapterInput {
  db: Database.Database;
  headers: string[];
  rows: Record<string, string>[];
  filePath?: string;
}

export interface AdapterPreview {
  totalAmount: number | null;
  dateMin: string | null;
  dateMax: string | null;
  warnings: string[];
  requiredFields: string[];
}

export interface MarketplaceAdapter {
  id: string;
  name: string;
  platformSlug: string;
  importType: ImportType;
  supportedFileTypes: string[];
  detect(input: AdapterInput): boolean;
  preview(input: AdapterInput, mapping?: GenericCsvMapping | CsvMappingTemplate | null): AdapterPreview;
  normalize(input: AdapterInput, mapping?: GenericCsvMapping | CsvMappingTemplate | null): NormalizedEntity[];
  validate(rows: NormalizedEntity[]): { row: number; reason: string }[];
  getDefaultMapping(): Record<string, string>;
  getRequiredFields(): string[];
}

export function hasHeaders(headers: string[], required: string[]): boolean {
  const lower = headers.map((h) => h.toLowerCase().trim());
  return required.every((r) => lower.some((h) => h === r.toLowerCase() || h.includes(r.toLowerCase().slice(0, 12))));
}

export function headerValue(row: Record<string, string>, header: string | null | undefined): string | null {
  if (!header) return null;
  return row[header] ?? null;
}

export function minMaxDate(values: Array<string | null>): { min: string | null; max: string | null } {
  const clean = values.filter(Boolean) as string[];
  if (clean.length === 0) return { min: null, max: null };
  return { min: clean.sort()[0], max: clean.sort()[clean.length - 1] };
}
