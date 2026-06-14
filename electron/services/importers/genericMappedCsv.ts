import type Database from 'better-sqlite3';
import { classifySale, declaredPeriod } from '../sales/classification';
import { getActivityStartDate } from '../sales/repository';
import { createStockManual } from '../stock/repository';
import { createGenericCsvAdapter } from '../marketplaces/adapters/genericCsvAdapter';
import { findExistingDedup } from '../marketplaces/dedup';
import { recordCsvMappingTemplateUsage, upsertSupplier } from '../marketplaces/repository';
import type {
  GenericCsvMapping,
  ImportResult,
  NormalizedExpense,
  NormalizedPurchase,
  NormalizedSale,
  NormalizedStockItem,
  StockOrigin
} from '../../../shared/types';

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

function updateIfColumnsExist(db: Database.Database, table: string, id: number, patch: Record<string, unknown>): void {
  const entries = Object.entries(patch).filter(([k]) => hasColumn(db, table, k));
  if (!entries.length) return;
  db.prepare(`UPDATE ${table} SET ${entries.map(([k]) => `${k}=?`).join(', ')} WHERE id=?`)
    .run(...entries.map(([, v]) => v), id);
}

function resultFor(type: ImportResult['type'], importId: number): ImportResult {
  return {
    importId,
    type,
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
}

export function importGenericMappedCsv(
  db: Database.Database,
  rows: Record<string, string>[],
  importId: number,
  mapping: GenericCsvMapping
): ImportResult {
  const adapter = createGenericCsvAdapter(mapping.entityType);
  const normalized = adapter.normalize({ db, headers: [], rows }, mapping);
  const validationErrors = adapter.validate(normalized);
  const result = resultFor(adapter.importType, importId);
  result.errors.push(...validationErrors);
  if (validationErrors.length) {
    result.skipped += validationErrors.length;
  }
  const invalidRows = new Set(validationErrors.map((e) => e.row));

  const tx = db.transaction(() => {
    normalized.forEach((item, idx) => {
      if (invalidRows.has(idx + 2)) return;
      try {
        if (item.dedup_confidence !== 'low') {
          const table =
            mapping.entityType === 'sales' ? 'sales' :
            mapping.entityType === 'purchases' ? 'purchases' :
            mapping.entityType === 'expenses' ? 'expenses' :
            'stock_items';
          if (findExistingDedup(db, table, item.dedup_key)) {
            result.duplicatesIdentical += 1;
            return;
          }
        }

        if (mapping.entityType === 'sales') {
          const sale = item as NormalizedSale;
          const activityStart = getActivityStartDate(db);
          const cls = classifySale({
            status: sale.status,
            sku: sale.sku,
            linkedPurchaseId: null,
            linkedStockItemId: null,
            activityStartDate: activityStart,
            encashmentDate: sale.encashment_date
          });
          const amount = sale.amount_received ?? 0;
          const info = db.prepare(`
            INSERT INTO sales (
              source, external_id, import_id, sale_date, finalization_date, declared_encashment_date, status,
              platform, article_name, quantity, sku, brand, size, color,
              buyer_username, buyer_country, sale_price_ttc, amount_received, refunded_amount,
              vinted_fees, shipping_cost_ttc, tracking_number, note,
              is_declarable, declarable_amount, exclusion_reason,
              classification, urssaf_declarable, classification_reason, declared_period,
              platform_id, channel_id, canonical_platform, source_adapter_id, dedup_key, dedup_confidence, external_reference, raw_source
            ) VALUES (
              'generic_csv', @external_id, @import_id, @sale_date, @finalization_date, @declared_encashment_date, @status,
              @platform, @article_name, @quantity, @sku, @brand, @size, @color,
              @buyer_username, @buyer_country, @sale_price_ttc, @amount_received, @refunded_amount,
              @fees, @shipping_amount, @tracking_number, @notes,
              @is_declarable, @declarable_amount, @exclusion_reason,
              @classification, @urssaf_declarable, @classification_reason, @declared_period,
              @platform_id, @channel_id, @canonical_platform, @source_adapter_id, @dedup_key, @dedup_confidence, @external_reference, 'generic_csv'
            )
          `).run({
            external_id: sale.external_id,
            import_id: importId,
            sale_date: sale.sale_date,
            finalization_date: sale.finalization_date,
            declared_encashment_date: sale.encashment_date,
            status: sale.status,
            platform: sale.platform ?? 'CSV générique',
            article_name: sale.article_name,
            quantity: sale.quantity,
            sku: sale.sku,
            brand: sale.brand,
            size: sale.size,
            color: sale.color,
            buyer_username: sale.buyer_username,
            buyer_country: sale.buyer_country,
            sale_price_ttc: sale.sale_price_ttc,
            amount_received: amount,
            refunded_amount: sale.refunded_amount,
            fees: sale.fees,
            shipping_amount: sale.shipping_amount,
            tracking_number: sale.tracking_number,
            notes: sale.notes,
            is_declarable: cls.urssaf_declarable,
            declarable_amount: cls.urssaf_declarable ? amount : 0,
            exclusion_reason: cls.urssaf_declarable ? null : cls.classification_reason,
            classification: cls.classification,
            urssaf_declarable: cls.urssaf_declarable,
            classification_reason: cls.classification_reason,
            declared_period: declaredPeriod(sale.encashment_date),
            platform_id: sale.platform_id,
            channel_id: sale.channel_id,
            canonical_platform: sale.platform_id ? String(sale.platform_id) : sale.platform,
            source_adapter_id: sale.source_adapter_id,
            dedup_key: sale.dedup_key,
            dedup_confidence: sale.dedup_confidence,
            external_reference: sale.external_reference
          });
          result.created += 1;
          if (cls.urssaf_declarable) result.caAdded += amount;
          void info;
        } else if (mapping.entityType === 'purchases') {
          const purchase = item as NormalizedPurchase;
          const supplierId = purchase.supplier_name
            ? upsertSupplier(db, { name: purchase.supplier_name, platform_id: purchase.platform_id, supplier_type: 'marketplace_seller' }).id
            : null;
          db.prepare(`
            INSERT INTO purchases (
              source, external_id, import_id, payment_date, status, seller, platform,
              articles, quantity, sku, total_ttc, items_price, shipping_fee, protection_fee,
              base_ht, deductible_vat, vat_regime, vat_source, original_currency, exchange_rate, notes,
              platform_id, channel_id, supplier_id, canonical_platform, source_adapter_id, dedup_key, dedup_confidence, external_reference, raw_source
            ) VALUES (
              'generic_csv', @external_id, @import_id, @payment_date, @status, @seller, @platform,
              @articles, @quantity, @sku, @total_ttc, @items_price, @shipping_fee, @protection_fee,
              @base_ht, 0, 'franchise_en_base', 'Import CSV générique', @original_currency, @exchange_rate, @notes,
              @platform_id, @channel_id, @supplier_id, @canonical_platform, @source_adapter_id, @dedup_key, @dedup_confidence, @external_reference, 'generic_csv'
            )
          `).run({
            external_id: purchase.external_id,
            import_id: importId,
            payment_date: purchase.purchase_date,
            status: purchase.status,
            seller: purchase.supplier_name,
            platform: purchase.platform ?? 'CSV générique',
            articles: purchase.article_name,
            quantity: purchase.quantity,
            sku: purchase.sku,
            total_ttc: purchase.total_ttc,
            items_price: purchase.items_amount,
            shipping_fee: purchase.shipping_amount,
            protection_fee: purchase.protection_fee,
            base_ht: purchase.items_amount ?? purchase.total_ttc,
            original_currency: purchase.original_currency ?? 'EUR',
            exchange_rate: purchase.exchange_rate,
            notes: purchase.notes,
            platform_id: purchase.platform_id,
            channel_id: purchase.channel_id,
            supplier_id: supplierId,
            canonical_platform: purchase.platform_id ? String(purchase.platform_id) : purchase.platform,
            source_adapter_id: purchase.source_adapter_id,
            dedup_key: purchase.dedup_key,
            dedup_confidence: purchase.dedup_confidence,
            external_reference: purchase.external_reference
          });
          result.created += 1;
        } else if (mapping.entityType === 'expenses') {
          const expense = item as NormalizedExpense;
          const supplierId = expense.supplier_name
            ? upsertSupplier(db, { name: expense.supplier_name, platform_id: expense.platform_id, supplier_type: 'shop' }).id
            : null;
          db.prepare(`
            INSERT INTO expenses (
              source, date, category, supplier, platform, description, amount_ttc, vat_amount, vat_deductible,
              payment_method, notes, platform_id, channel_id, supplier_id, canonical_platform, source_adapter_id,
              dedup_key, dedup_confidence, external_reference, raw_source
            ) VALUES (
              'generic_csv', @date, @category, @supplier, @platform, @description, @amount_ttc, @vat_amount, 0,
              @payment_method, @notes, @platform_id, @channel_id, @supplier_id, @canonical_platform, @source_adapter_id,
              @dedup_key, @dedup_confidence, @external_reference, 'generic_csv'
            )
          `).run({
            date: expense.expense_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
            category: expense.category ?? 'autre',
            supplier: expense.supplier_name,
            platform: expense.platform,
            description: expense.description,
            amount_ttc: expense.amount_ttc ?? 0,
            vat_amount: expense.tax_amount,
            payment_method: expense.payment_method,
            notes: expense.notes,
            platform_id: expense.platform_id,
            channel_id: expense.channel_id,
            supplier_id: supplierId,
            canonical_platform: expense.platform_id ? String(expense.platform_id) : expense.platform,
            source_adapter_id: expense.source_adapter_id,
            dedup_key: expense.dedup_key,
            dedup_confidence: expense.dedup_confidence,
            external_reference: expense.external_reference
          });
          result.created += 1;
        } else {
          const stock = item as NormalizedStockItem;
          const origin: StockOrigin = stock.source?.toLowerCase().includes('whatnot')
            ? 'compra_whatnot'
            : stock.source?.toLowerCase().includes('vinted')
              ? 'compra_vinted'
              : 'autre';
          const created = createStockManual(db, {
            name: stock.name ?? 'Article sans nom',
            quantity: stock.quantity,
            origin,
            unit_cost_ttc: stock.unit_cost_ttc,
            total_cost_ttc: stock.unit_cost_ttc != null ? stock.unit_cost_ttc * stock.quantity : null,
            brand: stock.brand,
            size: stock.size,
            color: stock.color,
            sku: stock.sku,
            estimated_sale_price: stock.estimated_sale_price,
            location: stock.location,
            notes: stock.notes
          });
          updateIfColumnsExist(db, 'stock_items', created.id, {
            platform_id: stock.platform_id,
            channel_id: stock.channel_id,
            canonical_platform: stock.platform_id ? String(stock.platform_id) : stock.source,
            source_adapter_id: stock.source_adapter_id,
            dedup_key: stock.dedup_key,
            dedup_confidence: stock.dedup_confidence,
            external_reference: stock.external_reference,
            raw_source: 'generic_csv'
          });
          result.created += 1;
        }
      } catch (err) {
        result.errors.push({ row: idx + 2, reason: err instanceof Error ? err.message : String(err) });
      }
    });
  });

  tx();
  if (mapping.templateId) {
    recordCsvMappingTemplateUsage(db, {
      template_id: mapping.templateId,
      import_id: importId,
      rows_imported: result.created,
      rows_skipped: result.skipped + result.duplicatesIdentical,
      rows_error: result.errors.length
    });
  }
  return result;
}
