import type Database from 'better-sqlite3';
import { parseFrenchDate, parseFrenchNumber } from '../csv/parser';
import type { ImportResult } from '../../../shared/types';

export function importVinteerPurchases(
  db: Database.Database,
  rows: Record<string, string>[],
  importId: number
): ImportResult {
  const result: ImportResult = {
    importId,
    type: 'vinteer_purchases',
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
    INSERT INTO purchases (
      source, external_id, import_id,
      payment_date, status, created_date, updated_date,
      seller, buyer_account, platform,
      articles, quantity, price_per_item_raw, sku, brand, size, color,
      total_ttc, refunded_amount, effective_amount, items_price, shipping_fee, protection_fee,
      estimated_sale_price, vat_regime, base_ht, deductible_vat, vat_source,
      carrier, tracking_number,
      original_currency, original_amount, exchange_rate, notes
    ) VALUES (
      @source, @external_id, @import_id,
      @payment_date, @status, @created_date, @updated_date,
      @seller, @buyer_account, @platform,
      @articles, @quantity, @price_per_item_raw, @sku, @brand, @size, @color,
      @total_ttc, @refunded_amount, @effective_amount, @items_price, @shipping_fee, @protection_fee,
      @estimated_sale_price, @vat_regime, @base_ht, @deductible_vat, @vat_source,
      @carrier, @tracking_number,
      @original_currency, @original_amount, @exchange_rate, @notes
    )
  `);

  const update = db.prepare(`
    UPDATE purchases SET
      status=@status,
      payment_date=@payment_date,
      updated_date=@updated_date,
      total_ttc=@total_ttc,
      refunded_amount=@refunded_amount,
      effective_amount=@effective_amount,
      tracking_number=@tracking_number,
      carrier=@carrier,
      updated_at=datetime('now')
    WHERE source='vinteer' AND external_id=@external_id
  `);

  const findExisting = db.prepare(
    `SELECT id FROM purchases WHERE source='vinteer' AND external_id=?`
  );

  const tx = db.transaction((items: Record<string, string>[]) => {
    items.forEach((row, idx) => {
      try {
        const externalId = (row['ID Transaction'] ?? '').trim();
        if (!externalId) {
          result.errors.push({ row: idx + 2, reason: 'ID Transaction manquant' });
          return;
        }

        const payload = {
          source: 'vinteer',
          external_id: externalId,
          import_id: importId,
          payment_date: parseFrenchDate(row['Date de paiement']),
          status: row['Statut'] ?? null,
          created_date: parseFrenchDate(row['Date de création']),
          updated_date: parseFrenchDate(row['Date de mise à jour']),
          seller: row['Vendeur'] ?? null,
          buyer_account: row['Compte acheteur'] ?? null,
          platform: 'Vinted',
          articles: row['Articles'] ?? null,
          quantity: parseInt(row['Nombre d\'articles'] ?? '1', 10) || 1,
          price_per_item_raw: row['Prix par article'] || null,
          sku: row['SKU'] || null,
          brand: row['Marques (par article)'] ?? null,
          size: row['Tailles (par article)'] ?? null,
          color: row['Couleurs (par article)'] ?? null,
          total_ttc: parseFrenchNumber(row['Montant total TTC']),
          refunded_amount: parseFrenchNumber(row['Montant remboursé']),
          effective_amount: parseFrenchNumber(row['Montant effectif']),
          items_price: parseFrenchNumber(row['Prix des articles']),
          shipping_fee: parseFrenchNumber(row['Frais de port']),
          protection_fee: parseFrenchNumber(row['Frais de protection']),
          estimated_sale_price: parseFrenchNumber(row['Prix de vente estimé']),
          vat_regime: row['Régime TVA'] ?? null,
          base_ht: parseFrenchNumber(row['Base HT']),
          deductible_vat: parseFrenchNumber(row['TVA déductible']) ?? 0,
          vat_source: row['Source du régime'] ?? null,
          carrier: row['Transporteur'] ?? null,
          tracking_number: row['Numéro de suivi'] ?? null,
          original_currency: row['Devise d\'origine'] || null,
          original_amount: parseFrenchNumber(row['Montant original']),
          exchange_rate: parseFrenchNumber(row['Taux de change']),
          notes: null
        };

        const existing = findExisting.get(externalId) as { id: number } | undefined;
        if (existing) {
          update.run(payload);
          result.updated += 1;
        } else {
          insert.run(payload);
          result.created += 1;
        }
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
