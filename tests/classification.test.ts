import { describe, it, expect } from 'vitest';
import { classifySale, declaredPeriod } from '../electron/services/sales/classification';

describe('classifySale — pre_activity', () => {
  it('encashment before activity_start_date → pre_activity (NOT declarable), wins over SKU', () => {
    const r = classifySale({
      status: 'completed',
      sku: 'SULLICO-1',
      activityStartDate: '2026-03-09',
      encashmentDate: '2026-03-05T10:00:00.000Z'
    });
    expect(r.classification).toBe('pre_activity');
    expect(r.urssaf_declarable).toBe(0);
    expect(r.classification_reason).toMatch(/antérieur au début/i);
  });
  it('encashment on activity_start_date is included (not pre_activity)', () => {
    const r = classifySale({
      status: 'completed',
      sku: 'SULLICO-1',
      linkedStockItemId: 42,
      activityStartDate: '2026-03-09',
      encashmentDate: '2026-03-09T10:00:00.000Z'
    });
    expect(r.classification).toBe('professional_resale');
    expect(r.urssaf_declarable).toBe(1);
  });
  it('pre_activity beats manual_override', () => {
    const r = classifySale({
      status: 'completed',
      sku: null,
      activityStartDate: '2026-03-09',
      encashmentDate: '2026-03-05T10:00:00.000Z',
      manualOverride: true,
      forcedClassification: 'professional_resale'
    });
    expect(r.classification).toBe('pre_activity');
    expect(r.urssaf_declarable).toBe(0);
  });
  it('no activity_start_date set + link → professional', () => {
    const r = classifySale({
      status: 'completed',
      sku: 'X',
      linkedStockItemId: 1,
      encashmentDate: '2026-01-01T10:00:00.000Z'
    });
    expect(r.classification).toBe('professional_resale');
  });
});

describe('classifySale', () => {
  // P0.2 — Une vente avec SEUL un SKU et SANS lien achat/stock confirmé ne devient
  // plus automatiquement professionnelle. Elle est marquée uncertain_to_review et
  // n'est PAS déclarable tant que l'utilisateur n'a pas explicitement validé.
  it('completed + SKU sans lien → uncertain_to_review (non déclarable par défaut)', () => {
    const r = classifySale({ status: 'completed', sku: 'SULLICO-1' });
    expect(r.classification).toBe('uncertain_to_review');
    expect(r.urssaf_declarable).toBe(0);
    expect(r.classification_reason).toMatch(/SKU détecté sans stock associé/i);
  });

  it('colis_perdu + SKU sans lien → uncertain_to_review', () => {
    const r = classifySale({ status: 'colis_perdu', sku: 'LA-ITABAGNOIR-5' });
    expect(r.classification).toBe('uncertain_to_review');
    expect(r.urssaf_declarable).toBe(0);
  });

  it('completed + SKU + lien stock → professional_resale, declarable', () => {
    const r = classifySale({ status: 'completed', sku: 'SULLICO-1', linkedStockItemId: 7 });
    expect(r.classification).toBe('professional_resale');
    expect(r.urssaf_declarable).toBe(1);
  });

  it('colis_perdu + SKU + lien achat → professional_resale, declarable', () => {
    const r = classifySale({ status: 'colis_perdu', sku: 'LA-ITABAGNOIR-5', linkedPurchaseId: 3 });
    expect(r.classification).toBe('professional_resale');
    expect(r.urssaf_declarable).toBe(1);
  });

  it('completed + linked_stock_item → professional_resale, declarable', () => {
    const r = classifySale({ status: 'completed', sku: null, linkedStockItemId: 42 });
    expect(r.classification).toBe('professional_resale');
    expect(r.urssaf_declarable).toBe(1);
  });

  it('completed + linked_purchase → professional_resale, declarable', () => {
    const r = classifySale({ status: 'completed', sku: null, linkedPurchaseId: 7 });
    expect(r.classification).toBe('professional_resale');
    expect(r.urssaf_declarable).toBe(1);
  });

  it('completed + no SKU + no link → personal_item, NOT declarable', () => {
    const r = classifySale({ status: 'completed', sku: null });
    expect(r.classification).toBe('personal_item');
    expect(r.urssaf_declarable).toBe(0);
    expect(r.classification_reason).toMatch(/hors activité/i);
    expect(r.classification_reason).toBe('Sans SKU ni achat associé : traité comme bien personnel hors activité');
  });

  it('completed + empty SKU + no link → personal_item', () => {
    const r = classifySale({ status: 'completed', sku: '   ' });
    expect(r.classification).toBe('personal_item');
    expect(r.urssaf_declarable).toBe(0);
  });

  it('canceled with positive amount → excluded, NOT declarable', () => {
    const r = classifySale({ status: 'canceled', sku: 'SULLICO-3' });
    expect(r.classification).toBe('excluded');
    expect(r.urssaf_declarable).toBe(0);
    expect(r.classification_reason).toMatch(/canceled/i);
  });

  it('refunded → excluded', () => {
    const r = classifySale({ status: 'refunded', sku: 'SULLICO-3' });
    expect(r.classification).toBe('excluded');
    expect(r.urssaf_declarable).toBe(0);
    expect(r.classification_reason).toContain('Vente non finalisée');
  });

  it('manual override personal → professional_resale → declarable', () => {
    const r = classifySale({
      status: 'completed',
      sku: null,
      manualOverride: true,
      forcedClassification: 'professional_resale',
      overrideNote: 'Es del stock que compré en brocante'
    });
    expect(r.classification).toBe('professional_resale');
    expect(r.urssaf_declarable).toBe(1);
    expect(r.classification_reason).toMatch(/Correction manuelle/i);
  });

  it('manual override professional → personal → NOT declarable', () => {
    const r = classifySale({
      status: 'completed',
      sku: 'X-1',
      manualOverride: true,
      forcedClassification: 'personal_item',
      overrideNote: 'Era un artículo de mi armario aunque tenía SKU'
    });
    expect(r.classification).toBe('personal_item');
    expect(r.urssaf_declarable).toBe(0);
  });
});

describe('declaredPeriod', () => {
  it.each([
    ['2026-01-15T10:00:00.000Z', '2026-Q1'],
    ['2026-03-31T23:59:59.999Z', '2026-Q1'],
    ['2026-04-01T00:00:00.000Z', '2026-Q2'],
    ['2026-09-30T00:00:00.000Z', '2026-Q3'],
    ['2026-10-01T00:00:00.000Z', '2026-Q4'],
    ['2026-12-31T00:00:00.000Z', '2026-Q4']
  ])('%s → %s', (iso, expected) => {
    expect(declaredPeriod(iso)).toBe(expected);
  });
  it('null → null', () => {
    expect(declaredPeriod(null)).toBeNull();
  });
});
