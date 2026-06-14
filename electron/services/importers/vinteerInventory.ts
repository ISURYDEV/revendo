import type Database from 'better-sqlite3';
import { parseFrenchNumber } from '../csv/parser';
import type { ImportResult } from '../../../shared/types';

/**
 * Import Vinteer inventory.
 *
 * IMPORTANT: SKU is NOT a unique identifier (lots may share SKU).
 * We create one stock_item per CSV row, with an internal_code generated as ITEM-YYYY-NNNNNN.
 * For lots (Type de stock = "Lot (SKU partagé)") we record quantity = "En stock (restants)".
 * The user will later split lots into individual units via the UI wizard.
 */
export function importVinteerInventory(
  db: Database.Database,
  rows: Record<string, string>[],
  importId: number
): ImportResult {
  const result: ImportResult = {
    importId,
    type: 'vinteer_inventory',
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

  const year = new Date().getUTCFullYear();
  const seqName = `stock_items_${year}`;
  db.prepare(`INSERT OR IGNORE INTO _sequences (name, value) VALUES (?, 0)`).run(seqName);

  const nextCode = db.prepare(`
    UPDATE _sequences SET value = value + 1 WHERE name = ?
    RETURNING value
  `);

  const insert = db.prepare(`
    INSERT INTO stock_items (
      internal_code, sku, name, source, supplier, platform,
      status, quantity, unit_cost_ttc, total_cost_ttc, estimated_sale_price,
      brand, size, color, notes
    ) VALUES (
      @internal_code, @sku, @name, @source, @supplier, @platform,
      @status, @quantity, @unit_cost_ttc, @total_cost_ttc, @estimated_sale_price,
      @brand, @size, @color, @notes
    )
  `);

  const insertMovement = db.prepare(`
    INSERT INTO stock_movements (stock_item_id, movement_type, quantity, unit_cost_ttc, total_cost_ttc, reason)
    VALUES (?, 'IN_MANUAL', ?, ?, ?, 'Import inventaire Vinteer')
  `);

  // Dedup: skip rows whose (sku, name) already exist as a stock_item created by an inventory import.
  const findExisting = db.prepare(
    `SELECT id FROM stock_items WHERE source='vinteer_inventory' AND sku=? AND name=?`
  );

  const tx = db.transaction((items: Record<string, string>[]) => {
    items.forEach((row, idx) => {
      try {
        const sku = (row['SKU'] ?? '').trim() || null;
        const name = row['Nom']?.trim() ?? '';
        if (!name) {
          result.errors.push({ row: idx + 2, reason: 'Nom manquant' });
          return;
        }
        const existing = findExisting.get(sku, name) as { id: number } | undefined;
        if (existing) {
          result.skipped += 1;
          return;
        }

        const seq = nextCode.get(seqName) as { value: number };
        const internalCode = `ITEM-${year}-${String(seq.value).padStart(6, '0')}`;

        const quantity = parseInt(row['En stock (restants)'] ?? '0', 10) || 0;
        const unitCost = parseFrenchNumber(row['COGS unitaire (€)']);
        const totalCost = parseFrenchNumber(row['COGS total (€)']);

        const info = insert.run({
          internal_code: internalCode,
          sku,
          name,
          source: 'vinteer_inventory',
          supplier: row['Fournisseur'] ?? null,
          platform: row['Fournisseur'] ?? null,
          status: quantity > 0 ? 'in_stock' : 'archived',
          quantity,
          unit_cost_ttc: unitCost,
          total_cost_ttc: totalCost ?? (unitCost != null ? unitCost * quantity : null),
          estimated_sale_price: parseFrenchNumber(row['Prix estimé (€)']),
          brand: null,
          size: null,
          color: null,
          notes: `Type: ${row['Type de stock'] ?? '?'} — import ${importId}`
        });

        if (quantity > 0) {
          insertMovement.run(
            info.lastInsertRowid,
            quantity,
            unitCost ?? null,
            totalCost ?? (unitCost != null ? unitCost * quantity : null)
          );
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
