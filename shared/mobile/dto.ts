import { z } from 'zod';
import { COMPATIBLE_SNAPSHOT_VERSIONS } from './schemaVersion';

/**
 * Mobile snapshot DTO — versioned JSON consumed by the mobile PWA.
 *
 * Older HTML snapshots (`revendo-mobile-v2`) embed the same data shape under a JSON island.
 * The JSON export (`revendo-mobile-v3`) is a clean machine-readable file with the same fields
 * plus a few additions (action support flags).
 */

const moneyOptional = z.number().finite().nullable().optional();

export const mobileSnapshotCompanySchema = z.object({
  commercial_name: z.string().optional().nullable(),
  first_name: z.string().optional().nullable(),
  last_name: z.string().optional().nullable(),
  siret: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  activity_start_date: z.string().optional().nullable(),
  vat_regime: z.string().optional().nullable()
});

export const mobileSnapshotTotalsSchema = z.object({
  ca_urssaf_total: z.number().default(0),
  sales_completed: z.number().default(0),
  in_transit: z.number().default(0),
  cancellations: z.number().default(0),
  expenses_total: z.number().default(0),
  stock_count: z.number().default(0),
  stock_value: z.number().default(0)
});

export const mobileSnapshotSchema = z.object({
  schema_version: z.enum(COMPATIBLE_SNAPSHOT_VERSIONS),
  generated_at: z.string(),
  app_version: z.string().optional().nullable(),
  redaction_mode: z.enum(['anonymized', 'full']).default('anonymized'),
  encrypted: z.boolean().default(false),
  data_scope: z.string().optional().nullable(),
  company: mobileSnapshotCompanySchema,
  totals: mobileSnapshotTotalsSchema,
  sales: z.array(z.record(z.unknown())).default([]),
  purchases: z.array(z.record(z.unknown())).default([]),
  expenses: z.array(z.record(z.unknown())).default([]),
  stock: z.array(z.record(z.unknown())).default([]),
  documents: z.array(z.record(z.unknown())).default([]),
  declarations: z.array(z.record(z.unknown())).default([]),
  profitability: z.array(z.record(z.unknown())).default([]),
  agenda: z.array(z.record(z.unknown())).default([]),
  /** v3 additions */
  review_items: z.array(z.record(z.unknown())).default([]).optional(),
  reminders: z.array(z.record(z.unknown())).default([]).optional(),
  /** Tells the mobile app whether desktop accepts the matching action schema. */
  supports_action_schema: z.string().optional().nullable(),
  profitability_error: z.string().optional().nullable(),
  agenda_error: z.string().optional().nullable()
}).passthrough();

export type MobileSnapshot = z.infer<typeof mobileSnapshotSchema>;
export type MobileSnapshotCompany = z.infer<typeof mobileSnapshotCompanySchema>;
export type MobileSnapshotTotals = z.infer<typeof mobileSnapshotTotalsSchema>;

/** Convenience: read the schema version from raw JSON without full validation. */
export function detectSnapshotVersion(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = (raw as Record<string, unknown>).schema_version;
  return typeof v === 'string' ? v : null;
}
