import type Database from 'better-sqlite3';
import path from 'node:path';
import { parseCsvFile, hashFile } from '../csv/parser';
import { detectImportType } from '../csv/detectType';
import { importVinteerSales } from './vinteerSales';
import { importVinteerPurchases } from './vinteerPurchases';
import { importVinteerBoosts } from './vinteerBoosts';
import { importVinteerInventory } from './vinteerInventory';
import { importWhatNotPurchases, type WhatNotMapping } from './whatnotPurchases';
import { importStockCsv } from './stockManualCsv';
import { importExpensesCsv, type ManualExpensesImportResult } from './expensesManualCsv';
import { importGenericMappedCsv } from './genericMappedCsv';
import { adapterForImportType, detectAdapter } from '../marketplaces/adapters/registry';
import { findExistingDedup, tableForEntity } from '../marketplaces/dedup';
import { ensureStockForSalesWithSku } from '../sales/stockAssociation';
import { restoreStockForCanceledSale } from '../sales/stockSync';
import { attachWhatNotCsvJustificatif } from '../documents/whatnotCsvJustificatif';
import type { GenericCsvMapping, ImportEntityType, ImportPreview, ImportResult, ImportType } from '../../../shared/types';

function entityForImportType(type: ImportType | 'unknown'): ImportEntityType | null {
  if (type === 'vinteer_sales' || type === 'generic_sales') return 'sale';
  if (type === 'vinteer_purchases' || type === 'whatnot_purchases' || type === 'generic_purchases') return 'purchase';
  if (type === 'generic_expenses') return 'expense';
  if (type === 'generic_stock' || type === 'vinteer_inventory') return 'stock_item';
  if (type === 'vinteer_boosts') return 'boost';
  return null;
}

function marketplaceId(db: Database.Database, slug: string): number | null {
  return (db.prepare(`SELECT id FROM marketplaces WHERE slug=?`).get(slug) as { id: number } | undefined)?.id ?? null;
}

function enrichKnownImportRows(db: Database.Database, type: ImportType, importId: number): void {
  const vintedId = marketplaceId(db, 'vinted');
  const whatnotId = marketplaceId(db, 'whatnot');
  if (type === 'vinteer_sales') {
    db.prepare(`
      UPDATE sales SET
        platform_id=COALESCE(platform_id, ?),
        canonical_platform=COALESCE(canonical_platform, 'vinted'),
        source_adapter_id=COALESCE(source_adapter_id, 'vinteer_sales'),
        raw_source=COALESCE(raw_source, source),
        external_reference=COALESCE(external_reference, external_id),
        dedup_confidence=COALESCE(dedup_confidence, CASE WHEN external_id IS NOT NULL AND external_id != '' THEN 'high' ELSE 'low' END),
        dedup_key=COALESCE(dedup_key, CASE WHEN external_id IS NOT NULL AND external_id != '' THEN 'sale|' || ? || '|id|' || lower(trim(external_id)) ELSE 'sale|fallback|legacy|' || id END)
      WHERE import_id=?
    `).run(vintedId, vintedId ?? 'vinted', importId);
  } else if (type === 'vinteer_purchases') {
    db.prepare(`
      UPDATE purchases SET
        platform_id=COALESCE(platform_id, ?),
        canonical_platform=COALESCE(canonical_platform, 'vinted'),
        source_adapter_id=COALESCE(source_adapter_id, 'vinteer_purchases'),
        raw_source=COALESCE(raw_source, source),
        external_reference=COALESCE(external_reference, external_id),
        dedup_confidence=COALESCE(dedup_confidence, CASE WHEN external_id IS NOT NULL AND external_id != '' THEN 'high' ELSE 'low' END),
        dedup_key=COALESCE(dedup_key, CASE WHEN external_id IS NOT NULL AND external_id != '' THEN 'purchase|' || ? || '|id|' || lower(trim(external_id)) ELSE 'purchase|fallback|legacy|' || id END)
      WHERE import_id=?
    `).run(vintedId, vintedId ?? 'vinted', importId);
  } else if (type === 'whatnot_purchases') {
    db.prepare(`
      UPDATE purchases SET
        platform_id=COALESCE(platform_id, ?),
        canonical_platform=COALESCE(canonical_platform, 'whatnot'),
        source_adapter_id=COALESCE(source_adapter_id, 'whatnot_purchases'),
        raw_source=COALESCE(raw_source, source),
        external_reference=COALESCE(external_reference, external_id),
        dedup_confidence=COALESCE(dedup_confidence, CASE WHEN external_id IS NOT NULL AND external_id != '' THEN 'high' ELSE 'low' END),
        dedup_key=COALESCE(dedup_key, CASE WHEN external_id IS NOT NULL AND external_id != '' THEN 'purchase|' || ? || '|id|' || lower(trim(external_id)) ELSE 'purchase|fallback|legacy|' || id END)
      WHERE import_id=?
    `).run(whatnotId, whatnotId ?? 'whatnot', importId);
  } else if (type === 'vinteer_boosts') {
    db.prepare(`
      UPDATE boosts SET
        platform_id=COALESCE(platform_id, ?),
        canonical_platform=COALESCE(canonical_platform, 'vinted'),
        source_adapter_id=COALESCE(source_adapter_id, 'vinteer_boosts'),
        raw_source=COALESCE(raw_source, source),
        external_reference=COALESCE(external_reference, external_id),
        dedup_confidence=COALESCE(dedup_confidence, CASE WHEN external_id IS NOT NULL AND external_id != '' THEN 'high' ELSE 'low' END),
        dedup_key=COALESCE(dedup_key, CASE WHEN external_id IS NOT NULL AND external_id != '' THEN 'boost|' || ? || '|id|' || lower(trim(external_id)) ELSE 'boost|fallback|legacy|' || id END)
      WHERE import_id=?
    `).run(vintedId, vintedId ?? 'vinted', importId);
  } else if (type === 'vinteer_inventory') {
    db.prepare(`
      UPDATE stock_items SET
        platform_id=COALESCE(platform_id, ?),
        canonical_platform=COALESCE(canonical_platform, 'vinted'),
        source_adapter_id=COALESCE(source_adapter_id, 'vinteer_inventory'),
        raw_source=COALESCE(raw_source, source),
        external_reference=COALESCE(external_reference, internal_code),
        dedup_confidence=COALESCE(dedup_confidence, 'medium'),
        dedup_key=COALESCE(dedup_key, 'stock_item|' || ? || '|code|' || lower(trim(internal_code)))
      WHERE source='vinteer_inventory' AND notes LIKE ?
    `).run(vintedId, vintedId ?? 'vinted', `%import ${importId}%`);
  }
}

/**
 * Build a preview of an import without writing to DB.
 * - Detects type by header signature
 * - Counts already-existing external_ids (= duplicates)
 * - Computes amount/date ranges
 */
export function buildImportPreview(
  db: Database.Database,
  filePath: string,
  forcedType?: ImportType,
  csvMapping?: GenericCsvMapping
): ImportPreview {
  const fileName = path.basename(filePath);
  const fileHash = hashFile(filePath);
  const parsed = parseCsvFile(filePath);
  const adapterInput = { db, headers: parsed.headers, rows: parsed.rows, filePath };
  const detectedAdapter = detectAdapter(adapterInput);
  const detected = forcedType ?? detectedAdapter?.importType ?? detectImportType(parsed.headers);
  const adapter = adapterForImportType(detected);

  const warnings: string[] = [];
  if (detected === 'unknown') {
    warnings.push(
      'Type de fichier non reconnu. Choisis un format manuellement ou ajoute un mapping.'
    );
  }

  // Duplicate detection for known Vinteer types
  let duplicates = 0;
  let possibleDuplicates = 0;
  let totalAmount: number | null = null;
  let dateMin: string | null = null;
  let dateMax: string | null = null;
  const confidence = { high: 0, medium: 0, low: 0 };
  let sourceAdapterId: string | null = null;
  let sourceAdapterName: string | null = null;
  let platformId: number | null = null;
  let requiredFields: string[] = [];
  const genericNeedsMapping = detected.startsWith('generic_') && !csvMapping;

  if (adapter && !genericNeedsMapping) {
    const prev = adapter.preview(adapterInput, csvMapping ?? null);
    totalAmount = prev.totalAmount;
    dateMin = prev.dateMin;
    dateMax = prev.dateMax;
    warnings.push(...prev.warnings);
    requiredFields = prev.requiredFields;
    sourceAdapterId = adapter.id;
    sourceAdapterName = adapter.name;
    const normalized = adapter.normalize(adapterInput, csvMapping ?? null);
    platformId = normalized.find((row) => row.platform_id != null)?.platform_id ?? null;
    const entity = entityForImportType(detected);
    if (entity) {
      const table = tableForEntity(entity);
      for (const row of normalized) {
        confidence[row.dedup_confidence] += 1;
        const exists = findExistingDedup(db, table, row.dedup_key);
        if (!exists) continue;
        if (row.dedup_confidence === 'low') possibleDuplicates += 1;
        else duplicates += 1;
      }
    }
  } else if (genericNeedsMapping) {
    warnings.push('Mapping requis : associez les colonnes du CSV aux champs Revendo avant import.');
    requiredFields = adapter?.getRequiredFields() ?? [];
  }

  // Already-imported check by file hash
  const sameHash = db
    .prepare('SELECT id, imported_at FROM imports WHERE file_hash=?')
    .get(fileHash) as { id: number; imported_at: string } | undefined;
  if (sameHash) {
    warnings.push(
      `⚠️ Ce fichier a déjà été importé (le ${sameHash.imported_at}, import #${sameHash.id}). ` +
        `Nouvel import → seules les lignes nouvelles seront ajoutées.`
    );
  }

  return {
    type: detected,
    sourceAdapterId,
    sourceAdapterName,
    platformId,
    platformName: null,
    channelId: csvMapping?.channelId ?? null,
    channelName: null,
    fileName,
    fileHash,
    separator: parsed.separator,
    encoding: parsed.encoding,
    totalRows: parsed.rows.length,
    sampleRows: parsed.rows.slice(0, 10),
    detectedHeaders: parsed.headers,
    newRows: Math.max(0, parsed.rows.length - duplicates),
    duplicates,
    errorRows: 0,
    totalAmount,
    dateMin,
    dateMax,
    dedupSummary: {
      exactDuplicates: duplicates,
      possibleDuplicates,
      newRows: Math.max(0, parsed.rows.length - duplicates),
      confidence
    },
    requiredFields,
    mappingRequired: genericNeedsMapping,
    warnings
  };
}

export interface RunImportArgs {
  filePath: string;
  forcedType?: ImportType;
  whatNotMapping?: Partial<WhatNotMapping>;
  csvMapping?: GenericCsvMapping;
}

/**
 * Run an import: detects type if not forced, logs to `imports`, dispatches to the right importer.
 *
 * P1.1 — Atomicité : l'INSERT du log d'import, l'importer lui-même, la mise à jour
 * des compteurs (rows_created / rows_updated / rows_skipped / rows_error) et
 * `enrichKnownImportRows` sont englobés dans UNE SEULE transaction.
 * Si l'un de ces pas échoue, RIEN n'est persisté : pas d'orphelins, pas de
 * compteurs incohérents, pas d'entrée d'import vide.
 *
 * Les opérations « best-effort » qui touchent le système de fichiers ou
 * qui ne sont pas critiques pour la cohérence des compteurs (ensureStockForSalesWithSku,
 * attachWhatNotCsvJustificatif) sont exécutées APRÈS commit, avec leur propre
 * gestion d'erreurs. Elles ne peuvent pas corrompre les données déjà importées.
 */
export function runImport(db: Database.Database, args: RunImportArgs): ImportResult {
  const { filePath, forcedType, whatNotMapping, csvMapping } = args;
  const fileName = path.basename(filePath);
  const fileHash = hashFile(filePath);
  const parsed = parseCsvFile(filePath);
  const detected = forcedType ?? detectImportType(parsed.headers);

  if (detected === 'unknown') {
    throw new Error('Type de fichier non reconnu. Précisez le type manuellement.');
  }

  let importId = 0;
  let result: ImportResult = {
    importId: 0,
    type: detected,
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

  // Transaction atomique : INSERT log + importer + UPDATE counters + enrich.
  // Si quoi que ce soit jette, better-sqlite3 fait un ROLLBACK complet,
  // y compris l'INSERT initial dans `imports`.
  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO imports (source, file_name, file_hash, rows_total, import_type, notes, source_adapter_id, platform_id, channel_id, adapter_label)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        detected,
        fileName,
        fileHash,
        parsed.rows.length,
        detected,
        null,
        adapterForImportType(detected)?.id ?? detected,
        csvMapping?.platformId ?? null,
        csvMapping?.channelId ?? null,
        adapterForImportType(detected)?.name ?? detected
      );
    importId = Number(info.lastInsertRowid);

    switch (detected) {
      case 'vinteer_sales':
        result = importVinteerSales(db, parsed.rows, importId);
        break;
      case 'vinteer_purchases':
        result = importVinteerPurchases(db, parsed.rows, importId);
        break;
      case 'vinteer_boosts':
        result = importVinteerBoosts(db, parsed.rows, importId);
        break;
      case 'vinteer_inventory':
        result = importVinteerInventory(db, parsed.rows, importId);
        break;
      case 'whatnot_purchases':
        result = importWhatNotPurchases(db, parsed.headers, parsed.rows, importId, whatNotMapping);
        break;
      case 'generic_stock':
        result = csvMapping
          ? importGenericMappedCsv(db, parsed.rows, importId, { ...csvMapping, entityType: 'stock' })
          : importStockCsv(db, filePath, importId);
        break;
      case 'generic_expenses':
        result = csvMapping
          ? importGenericMappedCsv(db, parsed.rows, importId, { ...csvMapping, entityType: 'expenses' })
          : importExpensesCsv(db, filePath, importId);
        break;
      case 'generic_sales':
        if (!csvMapping) throw new Error('Mapping CSV requis pour importer des ventes génériques.');
        result = importGenericMappedCsv(db, parsed.rows, importId, { ...csvMapping, entityType: 'sales' });
        break;
      case 'generic_purchases':
        if (!csvMapping) throw new Error('Mapping CSV requis pour importer des achats génériques.');
        result = importGenericMappedCsv(db, parsed.rows, importId, { ...csvMapping, entityType: 'purchases' });
        break;
      default:
        throw new Error(`Importer non implémenté: ${detected}`);
    }

    db.prepare(
      `UPDATE imports SET rows_created=?, rows_updated=?, rows_skipped=?, rows_error=? WHERE id=?`
    ).run(result.created, result.updated, result.skipped, result.errors.length, importId);

    enrichKnownImportRows(db, detected, importId);
  });

  tx();

  // Post-commit best-effort (filesystem + best-effort linking). Ne doit pas
  // remettre en cause les données déjà importées. Les erreurs sont enregistrées
  // dans le résultat mais n'annulent pas l'import.
  if (detected === 'vinteer_sales' || detected === 'generic_sales') {
    try {
      ensureStockForSalesWithSku(db, { importId });
    } catch (err) {
      result.errors.push({
        row: 0,
        reason: `Association stock automatique partielle : ${err instanceof Error ? err.message : String(err)}`
      });
    }
  }
  if (detected === 'whatnot_purchases') {
    try {
      attachWhatNotCsvJustificatif(db, { importId, csvPath: filePath, fileName });
    } catch (err) {
      result.errors.push({
        row: 0,
        reason: `Justificatif CSV WhatNot non attaché : ${err instanceof Error ? err.message : String(err)}`
      });
    }
  }

  return result;
}

/** Revert an import: deletes only rows that were CREATED by this import. */
export function revertImport(db: Database.Database, importId: number): { deleted: number } {
  const tx = db.transaction(() => {
    let deleted = 0;
    const sales = db.prepare(`SELECT id FROM sales WHERE import_id=? AND deleted_at IS NULL`).all(importId) as Array<{ id: number }>;
    for (const sale of sales) {
      restoreStockForCanceledSale(db, sale.id, 'Annulation import — réversion automatique');
    }
    for (const table of ['sales', 'purchases', 'boosts'] as const) {
      // Only delete rows created by this import (we never delete user-edited data lightly).
      const info = db.prepare(`DELETE FROM ${table} WHERE import_id=?`).run(importId);
      deleted += info.changes;
    }
    // Stock items + movements created by an inventory import
    const items = db
      .prepare(`SELECT id FROM stock_items WHERE source='vinteer_inventory' AND notes LIKE ?`)
      .all(`%import ${importId}%`) as { id: number }[];
    for (const it of items) {
      db.prepare('DELETE FROM stock_movements WHERE stock_item_id=?').run(it.id);
      db.prepare('DELETE FROM stock_items WHERE id=?').run(it.id);
      deleted += 1;
    }
    db.prepare('DELETE FROM imports WHERE id=?').run(importId);
    return deleted;
  });
  return { deleted: tx() };
}
