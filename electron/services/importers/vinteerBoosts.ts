import type Database from 'better-sqlite3';
import { parseFrenchDate, parseFrenchNumber } from '../csv/parser';
import type { ImportResult } from '../../../shared/types';

export function importVinteerBoosts(
  db: Database.Database,
  rows: Record<string, string>[],
  importId: number
): ImportResult {
  const result: ImportResult = {
    importId,
    type: 'vinteer_boosts',
    created: 0,
    updated: 0,
    duplicatesIdentical: 0,
    conflicts: 0,
    skipped: 0,
    preActivityCount: 0,
    canceledRefundedCount: 0,
    caAdded: 0,
    errors: []
  };

  const insert = db.prepare(`
    INSERT INTO boosts (
      source, external_id, import_id,
      start_date, boost_type, scope, duration_days, boosted_articles_count,
      amount_ht, vat_rate, vat_amount, amount_ttc, gross_price_ttc, discount,
      allocation_method, notes
    ) VALUES (
      @source, @external_id, @import_id,
      @start_date, @boost_type, @scope, @duration_days, @boosted_articles_count,
      @amount_ht, @vat_rate, @vat_amount, @amount_ttc, @gross_price_ttc, @discount,
      @allocation_method, @notes
    )
  `);

  const findExisting = db.prepare(`SELECT id FROM boosts WHERE source='vinteer' AND external_id=?`);

  const tx = db.transaction((items: Record<string, string>[]) => {
    items.forEach((row, idx) => {
      try {
        const externalId = (row['ID'] ?? '').trim();
        if (!externalId) {
          result.errors.push({ row: idx + 2, reason: 'ID manquant' });
          return;
        }
        const existing = findExisting.get(externalId) as { id: number } | undefined;
        if (existing) {
          result.skipped += 1;
          return;
        }
        const startDate = parseFrenchDate(row['Date de début']);
        const amountTtc = parseFrenchNumber(row['Montant TTC']);
        const boostType = row['Type de boost'] ?? null;
        const articlesCount = parseInt(row['Articles boostés'] ?? '', 10) || null;
        insert.run({
          source: 'vinteer',
          external_id: externalId,
          import_id: importId,
          start_date: startDate,
          boost_type: boostType,
          scope: row['Portée'] || null,
          duration_days: parseInt(row['Durée (jours)'] ?? '', 10) || null,
          boosted_articles_count: articlesCount,
          amount_ht: parseFrenchNumber(row['Montant HT']),
          vat_rate: parseFrenchNumber(row['Taux TVA (%)']),
          vat_amount: parseFrenchNumber(row['Montant TVA']),
          amount_ttc: amountTtc,
          gross_price_ttc: parseFrenchNumber(row['Prix brut TTC']),
          discount: parseFrenchNumber(row['Réduction']),
          allocation_method: 'general',
          notes: null
        });
        // Also create a parallel expense row so the user sees it in Dépenses.
        if (amountTtc != null && startDate) {
          const expExists = db.prepare(
            `SELECT id FROM expenses WHERE source='vinteer_boost' AND notes LIKE ?`
          ).get(`%boost:${externalId}%`) as { id: number } | undefined;
          if (!expExists) {
            db.prepare(
              `INSERT INTO expenses (source, date, category, supplier, platform, description, amount_ttc,
                                     vat_deductible, payment_method, notes)
               VALUES ('vinteer_boost', ?, 'boost_marketing', 'Vinted', 'Vinted', ?, ?, 0, 'Vinted Wallet', ?)`
            ).run(
              startDate.slice(0, 10),
              `Boost ${boostType ?? ''} ${articlesCount ? `(${articlesCount} articles)` : ''}`.trim(),
              amountTtc,
              `boost:${externalId}`
            );
          }
        }
        result.created += 1;
      } catch (err) {
        result.errors.push({
          row: idx + 2,
          reason: err instanceof Error ? err.message : String(err)
        });
      }
    });
  });

  tx(rows);
  return result;
}
