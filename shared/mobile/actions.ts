import { z } from 'zod';
import { MOBILE_ACTIONS_SCHEMA_VERSION } from './schemaVersion';

/**
 * Mobile actions = offline edits captured by the mobile PWA, exported as JSON,
 * then imported into the desktop app for validation + audit.
 *
 * Each action is small, type-safe and fully validated by zod.
 */

const dateIso = z.string().min(1).max(40);
const amount = z.number().finite().nonnegative();
const optionalStr = z.string().max(500).optional().nullable();

export const addExpenseSchema = z.object({
  type: z.literal('add_expense'),
  payload: z.object({
    date: dateIso,
    category: z.string().min(1).max(80),
    supplier: optionalStr,
    description: optionalStr,
    amount_ttc: amount,
    payment_method: optionalStr,
    notes: optionalStr,
    has_photo: z.boolean().optional().default(false)
  })
});

export const addStockItemSchema = z.object({
  type: z.literal('add_stock_item'),
  payload: z.object({
    name: z.string().min(1).max(200),
    quantity: z.number().int().positive(),
    origin: z.enum([
      'stock_inicial', 'compra_vinted', 'compra_whatnot', 'brocante',
      'regalo_recibido', 'donacion_recibida', 'autre'
    ]).optional().default('autre'),
    unit_cost_ttc: z.number().nonnegative().optional().nullable(),
    location: optionalStr,
    sku: optionalStr,
    brand: optionalStr,
    notes: optionalStr,
    has_photo: z.boolean().optional().default(false)
  })
});

export const addStockMovementSchema = z.object({
  type: z.literal('add_stock_movement'),
  payload: z.object({
    stock_item_id: z.number().int().positive(),
    movement_type: z.enum([
      'OUT_SOLD', 'OUT_DONATED', 'OUT_GIFTED', 'OUT_PERSONAL_USE',
      'OUT_LOST', 'OUT_DISCARDED', 'OUT_ADJUSTMENT'
    ]),
    quantity: z.number().int().positive(),
    reason: optionalStr,
    notes: optionalStr,
    movement_date: dateIso.optional().nullable()
  })
});

export const markReviewDoneSchema = z.object({
  type: z.literal('mark_review_done'),
  payload: z.object({
    review_key: z.string().min(1).max(200),
    module: z.enum(['sales', 'stock', 'purchases', 'expenses', 'documents', 'urssaf']),
    entity_type: optionalStr,
    entity_id: z.number().int().positive().optional().nullable(),
    status: z.enum(['verified', 'ignored']).default('verified'),
    note: z.string().min(1).max(500)
  })
});

export const addNoteSchema = z.object({
  type: z.literal('add_note'),
  payload: z.object({
    entity_type: z.enum(['sale', 'stock_item', 'purchase', 'expense', 'document', 'standalone']),
    entity_id: z.number().int().positive().optional().nullable(),
    note: z.string().min(1).max(2000),
    date: dateIso.optional().nullable()
  })
});

export const mobileActionPayloadSchema = z.discriminatedUnion('type', [
  addExpenseSchema,
  addStockItemSchema,
  addStockMovementSchema,
  markReviewDoneSchema,
  addNoteSchema
]);

const actionMetadataFields = {
  id: z.string().min(1).max(80),
  schema_version: z.literal(MOBILE_ACTIONS_SCHEMA_VERSION),
  source: z.literal('mobile'),
  status: z.enum(['pending', 'exported', 'imported', 'error']).default('pending'),
  created_at: dateIso,
  device: z.string().max(120).optional().nullable()
} as const;

/**
 * Each action variant is the payload schema EXTENDED with the metadata fields.
 * We avoid `.and(discriminatedUnion)` which has known issues with zod 3 strictness.
 */
export const mobileActionSchema = z.discriminatedUnion('type', [
  addExpenseSchema.extend(actionMetadataFields),
  addStockItemSchema.extend(actionMetadataFields),
  addStockMovementSchema.extend(actionMetadataFields),
  markReviewDoneSchema.extend(actionMetadataFields),
  addNoteSchema.extend(actionMetadataFields)
]);

export const mobileActionsBundleSchema = z.object({
  schema_version: z.literal(MOBILE_ACTIONS_SCHEMA_VERSION),
  generated_at: dateIso,
  app_version: z.string().max(40).optional().nullable(),
  device: z.string().max(120).optional().nullable(),
  actions: z.array(mobileActionSchema).max(2000)
});

export type AddExpenseAction = z.infer<typeof addExpenseSchema>;
export type AddStockItemAction = z.infer<typeof addStockItemSchema>;
export type AddStockMovementAction = z.infer<typeof addStockMovementSchema>;
export type MarkReviewDoneAction = z.infer<typeof markReviewDoneSchema>;
export type AddNoteAction = z.infer<typeof addNoteSchema>;
export type MobileActionPayload = z.infer<typeof mobileActionPayloadSchema>;
export type MobileAction = z.infer<typeof mobileActionSchema>;
export type MobileActionsBundle = z.infer<typeof mobileActionsBundleSchema>;

export type MobileActionType = MobileActionPayload['type'];

export function newLocalActionId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
