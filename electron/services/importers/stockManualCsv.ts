import type Database from 'better-sqlite3';
import { parseCsvFile, parseFrenchDate, parseFrenchNumber } from '../csv/parser';
import { createStockManual } from '../stock/repository';
import type { ImportResult, StockOrigin } from '../../../shared/types';

/**
 * Manual stock CSV importer (template downloaded from the app).
 * Headers: Nom, Quantite, Type (personnel|professionnel), Date achat, Lieu achat,
 *          Cout total, Marque, Taille, Couleur, SKU, Prix vente estime, Etat, Emplacement, Notes
 */
export function importStockCsv(db: Database.Database, filePath: string, importId: number): ImportResult {
  const parsed = parseCsvFile(filePath);
  const result: ImportResult = {
    importId, type: 'generic_stock',
    created: 0, updated: 0, duplicatesIdentical: 0, conflicts: 0, skipped: 0,
    preActivityCount: 0, canceledRefundedCount: 0, caAdded: 0, errors: []
  };

  parsed.rows.forEach((row, idx) => {
    try {
      const name = (row['Nom'] ?? '').trim();
      if (!name) {
        result.errors.push({ row: idx + 2, reason: 'Nom obligatoire' });
        return;
      }
      const qty = parseInt(row['Quantite'] ?? '1', 10) || 1;
      const type = (row['Type (personnel|professionnel)'] ?? 'professionnel').toLowerCase().trim();
      const isPersonal = type === 'personnel';
      const purchaseDate = parseFrenchDate(row['Date achat (DD/MM/YYYY)']);
      const place = (row['Lieu achat'] ?? '').trim();

      if (!isPersonal && (!purchaseDate || !place)) {
        result.errors.push({
          row: idx + 2,
          reason: 'Pour stock professionnel: date achat ET lieu achat obligatoires'
        });
        return;
      }

      const origin: StockOrigin = isPersonal ? 'personal' :
        place.toLowerCase().includes('whatnot') ? 'compra_whatnot' :
        place.toLowerCase().includes('vinted') ? 'compra_vinted' :
        place.toLowerCase().includes('brocante') ? 'brocante' : 'autre';

      const totalCost = parseFrenchNumber(row['Cout total (€)']);
      const estPrice = parseFrenchNumber(row['Prix vente estime (€)']);
      const status = (row['Etat (in_stock|listed|reserved)'] ?? 'in_stock').toLowerCase().trim() as 'in_stock' | 'listed' | 'reserved';

      createStockManual(db, {
        name, quantity: qty, origin,
        total_cost_ttc: totalCost,
        unit_cost_ttc: totalCost != null ? totalCost / qty : null,
        brand: row['Marque'] || null,
        size: row['Taille'] || null,
        color: row['Couleur'] || null,
        sku: row['SKU'] || null,
        estimated_sale_price: estPrice,
        status: ['in_stock', 'listed', 'reserved'].includes(status) ? status : 'in_stock',
        location: row['Emplacement'] || null,
        notes: [row['Notes'] || '', purchaseDate ? `Date achat: ${purchaseDate.slice(0, 10)}` : '', place ? `Lieu: ${place}` : ''].filter(Boolean).join(' · ') || null
      });
      result.created += 1;
    } catch (err) {
      result.errors.push({ row: idx + 2, reason: err instanceof Error ? err.message : String(err) });
    }
  });

  return result;
}
