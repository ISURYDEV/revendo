import { describe, it, expect } from 'vitest';
import {
  mobileActionSchema,
  mobileActionsBundleSchema,
  newLocalActionId,
  MOBILE_ACTIONS_SCHEMA_VERSION
} from '../shared/mobile';

function baseAction() {
  return {
    id: newLocalActionId(),
    schema_version: MOBILE_ACTIONS_SCHEMA_VERSION,
    source: 'mobile' as const,
    status: 'pending' as const,
    created_at: '2026-05-28T10:00:00.000Z',
    device: 'mobile_test'
  };
}

describe('mobile actions zod schemas', () => {
  it('accepte un add_expense valide', () => {
    const a = mobileActionSchema.parse({
      ...baseAction(),
      type: 'add_expense',
      payload: { date: '2026-05-28', category: 'emballages', amount_ttc: 12.5, payment_method: 'carte' }
    });
    expect(a.type).toBe('add_expense');
  });

  it('rejette un add_expense avec montant négatif', () => {
    const r = mobileActionSchema.safeParse({
      ...baseAction(),
      type: 'add_expense',
      payload: { date: '2026-05-28', category: 'emballages', amount_ttc: -5 }
    });
    expect(r.success).toBe(false);
  });

  it('accepte un add_stock_item valide', () => {
    const a = mobileActionSchema.parse({
      ...baseAction(),
      type: 'add_stock_item',
      payload: { name: 'Pull en laine', quantity: 2, origin: 'compra_vinted', unit_cost_ttc: 8 }
    });
    expect(a.type).toBe('add_stock_item');
  });

  it('rejette un add_stock_item sans nom', () => {
    const r = mobileActionSchema.safeParse({
      ...baseAction(),
      type: 'add_stock_item',
      payload: { name: '', quantity: 1 }
    });
    expect(r.success).toBe(false);
  });

  it('accepte un add_stock_movement valide', () => {
    const a = mobileActionSchema.parse({
      ...baseAction(),
      type: 'add_stock_movement',
      payload: { stock_item_id: 12, movement_type: 'OUT_SOLD', quantity: 1 }
    });
    expect(a.type).toBe('add_stock_movement');
  });

  it('rejette un mouvement avec quantité 0', () => {
    const r = mobileActionSchema.safeParse({
      ...baseAction(),
      type: 'add_stock_movement',
      payload: { stock_item_id: 12, movement_type: 'OUT_SOLD', quantity: 0 }
    });
    expect(r.success).toBe(false);
  });

  it('accepte un mark_review_done valide', () => {
    const a = mobileActionSchema.parse({
      ...baseAction(),
      type: 'mark_review_done',
      payload: { review_key: 'sales:sale_classification_review:sale:42', module: 'sales', note: 'Vérifié sur le mobile' }
    });
    expect(a.type).toBe('mark_review_done');
  });

  it('rejette mark_review_done sans note', () => {
    const r = mobileActionSchema.safeParse({
      ...baseAction(),
      type: 'mark_review_done',
      payload: { review_key: 'k', module: 'sales', note: '' }
    });
    expect(r.success).toBe(false);
  });

  it('accepte un add_note standalone', () => {
    const a = mobileActionSchema.parse({
      ...baseAction(),
      type: 'add_note',
      payload: { entity_type: 'standalone', note: 'Penser à compter la caisse-A-3 demain.' }
    });
    expect(a.type).toBe('add_note');
  });

  it('rejette un type inconnu', () => {
    const r = mobileActionSchema.safeParse({ ...baseAction(), type: 'add_unknown' as never, payload: {} });
    expect(r.success).toBe(false);
  });

  it('valide un bundle complet', () => {
    const bundle = mobileActionsBundleSchema.parse({
      schema_version: MOBILE_ACTIONS_SCHEMA_VERSION,
      generated_at: '2026-05-28T10:00:00.000Z',
      device: 'mobile_test',
      actions: [
        {
          ...baseAction(),
          type: 'add_expense',
          payload: { date: '2026-05-28', category: 'emballages', amount_ttc: 5 }
        }
      ]
    });
    expect(bundle.actions.length).toBe(1);
  });
});
