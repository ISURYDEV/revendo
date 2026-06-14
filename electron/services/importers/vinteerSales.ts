import type Database from 'better-sqlite3';
import { parseFrenchDate, parseFrenchNumber } from '../csv/parser';
import { classifySale, declaredPeriod } from '../sales/classification';
import { getActivityStartDate } from '../sales/repository';
import { autoLinkVinteerSales } from '../sales/autoLinkStock';
import { syncSaleStockAfterStatusChange } from '../sales/stockSync';
import type { ImportResult, SaleStatus } from '../../../shared/types';

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
  const s = raw.toLowerCase().trim();
  return STATUS_MAP[s] ?? 'other';
}

/**
 * Import Vinteer sales CSV rows.
 *
 * Business rules applied here:
 *  - dedup on (source='vinteer', external_id=ID Transaction)
 *  - status completed/colis_perdu → is_declarable=1 when professional; canceled/refunded → is_declarable=0 with exclusion_reason
 *  - declarable_amount defaults to Montant encaissé (= amount_received)
 *  - declared_encashment_date defaults to Date de finalisation
 *  - never delete; on duplicate external_id, update only mutable fields (status, amounts, dates)
 */
export function importVinteerSales(
  db: Database.Database,
  rows: Record<string, string>[],
  importId: number
): ImportResult {
  const result: ImportResult = {
    importId,
    type: 'vinteer_sales',
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
  const activityStart = getActivityStartDate(db);

  const insert = db.prepare(`
    INSERT INTO sales (
      source, external_id, import_id,
      sale_date, finalization_date, declared_encashment_date, status,
      sale_account, platform, is_pro_account,
      article_name, quantity, sku, brand, size, color,
      buyer_name, buyer_email, buyer_username, buyer_address, buyer_country,
      sale_price_ttc, sale_price_ht, vat_amount, vinted_fees,
      purchase_cost_total, purchase_cost_base_margin, ancillary_costs, net_profit_source,
      refunded_amount, shipping_cost_ttc, individual_prices_raw, vat_credit, amount_received,
      vat_rate, multi_vat, vat_detail,
      carrier, tracking_number, note,
      is_declarable, declarable_amount, exclusion_reason,
      classification, urssaf_declarable, classification_reason, declared_period
    ) VALUES (
      @source, @external_id, @import_id,
      @sale_date, @finalization_date, @declared_encashment_date, @status,
      @sale_account, @platform, @is_pro_account,
      @article_name, @quantity, @sku, @brand, @size, @color,
      @buyer_name, @buyer_email, @buyer_username, @buyer_address, @buyer_country,
      @sale_price_ttc, @sale_price_ht, @vat_amount, @vinted_fees,
      @purchase_cost_total, @purchase_cost_base_margin, @ancillary_costs, @net_profit_source,
      @refunded_amount, @shipping_cost_ttc, @individual_prices_raw, @vat_credit, @amount_received,
      @vat_rate, @multi_vat, @vat_detail,
      @carrier, @tracking_number, @note,
      @is_declarable, @declarable_amount, @exclusion_reason,
      @classification, @urssaf_declarable, @classification_reason, @declared_period
    )
  `);

  const update = db.prepare(`
    UPDATE sales SET
      status=CASE WHEN status='colis_perdu' THEN status ELSE @status END,
      sale_date=@sale_date,
      finalization_date=@finalization_date,
      declared_encashment_date=COALESCE(declared_encashment_date, @declared_encashment_date),
      amount_received=CASE WHEN manual_override=1 THEN amount_received ELSE @amount_received END,
      refunded_amount=CASE WHEN manual_override=1 THEN refunded_amount ELSE @refunded_amount END,
      vinted_fees=CASE WHEN manual_override=1 THEN vinted_fees ELSE @vinted_fees END,
      shipping_cost_ttc=CASE WHEN manual_override=1 THEN shipping_cost_ttc ELSE @shipping_cost_ttc END,
      sale_price_ttc=CASE WHEN manual_override=1 THEN sale_price_ttc ELSE @sale_price_ttc END,
      sale_price_ht=CASE WHEN manual_override=1 THEN sale_price_ht ELSE @sale_price_ht END,
      vat_amount=CASE WHEN manual_override=1 THEN vat_amount ELSE @vat_amount END,
      tracking_number=@tracking_number,
      carrier=@carrier,
      note=COALESCE(note, @note),
      classification     = CASE WHEN manual_override=1 THEN classification     ELSE @classification END,
      urssaf_declarable  = CASE WHEN manual_override=1 THEN urssaf_declarable  ELSE @urssaf_declarable END,
      classification_reason = CASE WHEN manual_override=1 THEN classification_reason ELSE @classification_reason END,
      is_declarable      = CASE WHEN manual_override=1 THEN is_declarable      ELSE @is_declarable END,
      declarable_amount  = CASE WHEN manual_override=1 THEN declarable_amount  ELSE @declarable_amount END,
      exclusion_reason   = CASE WHEN manual_override=1 THEN exclusion_reason   ELSE @exclusion_reason END,
      declared_period    = COALESCE(declared_period, @declared_period),
      updated_at=datetime('now')
    WHERE source='vinteer' AND external_id=@external_id
  `);

  const findExisting = db.prepare(
    `SELECT id, status, amount_received, declared_encashment_date, sku, classification, dedup_status
     FROM sales WHERE source='vinteer' AND external_id=?`
  );
  const markDedupStatus = db.prepare(
    `UPDATE sales SET dedup_status=?, dedup_conflict=? WHERE id=?`
  );

  const tx = db.transaction((items: Record<string, string>[]) => {
    items.forEach((row, idx) => {
      try {
        const externalId = (row['ID Transaction'] ?? '').trim();
        if (!externalId) {
          result.errors.push({ row: idx + 2, reason: 'ID Transaction manquant' });
          return;
        }

        const status = normalizeStatus(row['Statut']);
        const amountReceived = parseFrenchNumber(row['Montant encaissé']) ?? 0;
        const sku = row['SKU'] || null;
        const declaredDate = parseFrenchDate(row['Date de finalisation']);

        // Apply classification including activity_start_date check (→ pre_activity).
        const cls = classifySale({
          status,
          sku,
          linkedPurchaseId: null,
          linkedStockItemId: null,
          activityStartDate: activityStart,
          encashmentDate: declaredDate
        });
        const isDeclarable = cls.urssaf_declarable;
        const declarableAmount = isDeclarable ? amountReceived : 0;
        const exclusionReason = isDeclarable === 0 ? cls.classification_reason : null;
        if (cls.classification === 'pre_activity') result.preActivityCount += 1;
        if (status === 'canceled' || status === 'refunded') result.canceledRefundedCount += 1;

        const payload = {
          source: 'vinteer',
          external_id: externalId,
          import_id: importId,
          sale_date: parseFrenchDate(row['Date de vente']),
          finalization_date: parseFrenchDate(row['Date de finalisation']),
          declared_encashment_date: declaredDate,
          status,
          sale_account: row['Compte de vente'] ?? null,
          platform: row['Canal de vente'] ?? null,
          is_pro_account: (row['Compte Pro'] ?? '').toLowerCase() === 'oui' ? 1 : 0,
          article_name: row['Articles'] ?? null,
          quantity: parseInt(row['Nombre d\'articles'] ?? '1', 10) || 1,
          sku,
          brand: row['Marques (par article)'] ?? null,
          size: row['Tailles (par article)'] ?? null,
          color: row['Couleurs (par article)'] ?? null,
          buyer_name: row['Nom acheteur'] ?? null,
          buyer_email: row['Email acheteur'] ?? null,
          buyer_username: row['Username acheteur'] ?? null,
          buyer_address: row['Adresse acheteur'] ?? null,
          buyer_country: row['Pays acheteur'] ?? null,
          sale_price_ttc: parseFrenchNumber(row['Prix de vente TTC']),
          sale_price_ht: parseFrenchNumber(row['Prix de vente HT']),
          vat_amount: parseFrenchNumber(row['TVA vente']),
          vinted_fees: parseFrenchNumber(row['Frais Vinted']),
          purchase_cost_total: parseFrenchNumber(row['Coût total d\'achat']),
          purchase_cost_base_margin: parseFrenchNumber(row['Coût d\'achat article (base marge)']),
          ancillary_costs: parseFrenchNumber(row['Frais annexes (port + protection)']),
          net_profit_source: parseFrenchNumber(row['Bénéfice net']),
          refunded_amount: parseFrenchNumber(row['Montant remboursé']),
          shipping_cost_ttc: parseFrenchNumber(row['Frais de port TTC']),
          individual_prices_raw: row['Prix individuels'] || null,
          vat_credit: parseFrenchNumber(row['Crédit TVA']),
          amount_received: amountReceived,
          vat_rate: parseFrenchNumber(row['Taux TVA vente (%)']),
          multi_vat: (row['TVA multi-taux'] ?? '').toLowerCase() === 'oui' ? 1 : 0,
          vat_detail: row['Détail TVA par ligne'] || null,
          carrier: row['Transporteur'] || null,
          tracking_number: row['Numéro de suivi'] || null,
          note: row['Note'] || null,
          is_declarable: isDeclarable,
          declarable_amount: declarableAmount,
          exclusion_reason: exclusionReason,
          classification: cls.classification,
          urssaf_declarable: cls.urssaf_declarable,
          classification_reason: cls.classification_reason,
          declared_period: declaredPeriod(declaredDate)
        };

        const existing = findExisting.get(externalId) as
          | { id: number; status: string; amount_received: number | null; declared_encashment_date: string | null; sku: string | null; classification: string | null; dedup_status: string | null }
          | undefined;
        if (existing) {
          // Detect identical vs conflict
          const statusEquivalent = existing.status === 'colis_perdu' && ['completed', 'canceled', 'refunded'].includes(status);
          const sameStatus = (existing.status ?? '') === status || statusEquivalent;
          const sameAmount = Math.abs((existing.amount_received ?? 0) - amountReceived) < 0.005;
          const sameDate = (existing.declared_encashment_date?.slice(0, 16) ?? '') === (declaredDate?.slice(0, 16) ?? '');
          const sameSku = (existing.sku ?? '') === (sku ?? '');
          const identical = sameStatus && sameAmount && sameDate && sameSku;

          if (identical) {
            result.duplicatesIdentical += 1;
            // Mark as doublon_ignore (silent) — no actual update needed but flag for visibility
            if (existing.dedup_status !== 'doublon_ignore') {
              markDedupStatus.run('doublon_ignore', null, existing.id);
            }
            return;
          }

          // Conflict: build diff
          const diff: Record<string, { old: unknown; new: unknown }> = {};
          if (!sameStatus) diff.status = { old: existing.status, new: status };
          if (!sameAmount) diff.amount_received = { old: existing.amount_received, new: amountReceived };
          if (!sameDate) diff.declared_encashment_date = { old: existing.declared_encashment_date, new: declaredDate };
          if (!sameSku) diff.sku = { old: existing.sku, new: sku };

          update.run(payload);
          syncSaleStockAfterStatusChange(db, existing.id);
          // Auto-resolve if new status is canceled/refunded → exclude from CA, no manual review needed
          const autoResolved = (status === 'canceled' || status === 'refunded');
          markDedupStatus.run(
            autoResolved ? null : 'conflit_a_verifier',
            JSON.stringify({ detectedAt: new Date().toISOString(), diff })
            , existing.id
          );
          if (!autoResolved) result.conflicts += 1;
          result.updated += 1;
        } else {
          insert.run(payload);
          result.created += 1;
          if (cls.urssaf_declarable === 1) result.caAdded += amountReceived;
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
  // After import: auto-link sales↔stock by SKU
  try {
    const link = autoLinkVinteerSales(db, importId);
    if (link.linked + link.ambiguous > 0) {
      // eslint-disable-next-line no-console
      console.log(`[importVinteerSales] auto-link: ${link.linked} linked, ${link.ambiguous} ambiguous, ${link.noStock} no stock`);
    }
  } catch {
    // swallow — import succeeded, auto-link is best-effort
  }
  return result;
}
