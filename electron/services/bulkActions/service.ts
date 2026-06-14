import type Database from 'better-sqlite3';
import type { Classification, DocumentType, ExpenseCategory, StockItemStatus, StockMovementType } from '../../../shared/types';
import { reclassifySale } from '../sales/repository';
import { moveOut } from '../stock/repository';
import { buildReviewCenter, markReviewItem } from '../review/reviewCenter';

export interface BulkResult {
  updated: number;
  skipped: number;
  errors: { id: number; reason: string }[];
}

function requireIds(ids: number[]): void {
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('Sélection vide.');
}

function logBulkAction(db: Database.Database, entityType: string, action: string, ids: number[], note?: string | null): void {
  db.prepare(
    `INSERT INTO bulk_action_log (entity_type, action, entity_ids_json, note)
     VALUES (?, ?, ?, ?)`
  ).run(entityType, action, JSON.stringify(ids), note ?? null);
}

export function markEntitiesVerified(
  db: Database.Database,
  entityType: 'sale' | 'stock_item' | 'purchase' | 'expense' | 'document',
  ids: number[],
  note: string
): BulkResult {
  requireIds(ids);
  if (!note.trim()) throw new Error('Une note est obligatoire.');
  const review = buildReviewCenter(db, { includeIgnored: true });
  let updated = 0;
  const idSet = new Set(ids.map(Number));
  for (const item of review.items) {
    if (item.entity_type === entityType && item.entity_id != null && idSet.has(item.entity_id)) {
      markReviewItem(db, {
        key: item.key,
        module: item.module,
        entity_type: item.entity_type,
        entity_id: item.entity_id,
        status: 'verified',
        note
      });
      updated += 1;
    }
  }
  logBulkAction(db, entityType, 'mark_verified', ids, note);
  return { updated, skipped: ids.length - Math.min(ids.length, updated), errors: [] };
}

export function bulkClassifySales(
  db: Database.Database,
  ids: number[],
  classification: Classification,
  note: string
): BulkResult {
  requireIds(ids);
  if (!note.trim()) throw new Error('Une note est obligatoire pour une action fiscale de masse.');
  const result: BulkResult = { updated: 0, skipped: 0, errors: [] };
  const tx = db.transaction(() => {
    for (const id of ids) {
      try {
        reclassifySale(db, id, { manual: true, forcedClassification: classification, note });
        result.updated += 1;
      } catch (err) {
        result.errors.push({ id, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    logBulkAction(db, 'sale', `classify:${classification}`, ids, note);
  });
  tx();
  result.skipped = result.errors.length;
  return result;
}

export function bulkUpdateStockLocation(
  db: Database.Database,
  ids: number[],
  location: string,
  note?: string
): BulkResult {
  requireIds(ids);
  if (!location.trim()) throw new Error('Emplacement obligatoire.');
  const stmt = db.prepare(`UPDATE stock_items SET location=?, updated_at=datetime('now') WHERE id=?`);
  const result: BulkResult = { updated: 0, skipped: 0, errors: [] };
  const tx = db.transaction(() => {
    for (const id of ids) {
      const info = stmt.run(location.trim(), id);
      if (info.changes > 0) result.updated += 1;
      else result.skipped += 1;
    }
    logBulkAction(db, 'stock_item', 'update_location', ids, note ?? location.trim());
  });
  tx();
  return result;
}

export function bulkUpdateStockStatus(
  db: Database.Database,
  ids: number[],
  status: StockItemStatus,
  note?: string
): BulkResult {
  requireIds(ids);
  const stmt = db.prepare(`UPDATE stock_items SET status=?, updated_at=datetime('now') WHERE id=?`);
  const result: BulkResult = { updated: 0, skipped: 0, errors: [] };
  const tx = db.transaction(() => {
    for (const id of ids) {
      const info = stmt.run(status, id);
      if (info.changes > 0) result.updated += 1;
      else result.skipped += 1;
    }
    logBulkAction(db, 'stock_item', `update_status:${status}`, ids, note ?? null);
  });
  tx();
  return result;
}

export function bulkStockMoveOut(
  db: Database.Database,
  ids: number[],
  movementType: Extract<StockMovementType, 'OUT_DONATED' | 'OUT_GIFTED' | 'OUT_LOST' | 'OUT_DISCARDED'>,
  quantity: number,
  note: string
): BulkResult {
  requireIds(ids);
  if (!note.trim()) throw new Error('Une note est obligatoire.');
  if (quantity <= 0) throw new Error('La quantité doit être supérieure à 0.');

  const result: BulkResult = { updated: 0, skipped: 0, errors: [] };
  const tx = db.transaction(() => {
    for (const id of ids) {
      try {
        moveOut(db, {
          stock_item_id: id,
          movement_type: movementType,
          quantity,
          reason: note,
          notes: note
        });
        result.updated += 1;
      } catch (err) {
        result.errors.push({ id, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    if (result.errors.length > 0) {
      throw new Error(`Action annulée : ${result.errors[0].reason}`);
    }
    logBulkAction(db, 'stock_item', `move:${movementType}`, ids, note);
  });
  tx();
  return result;
}

export function bulkUpdateExpenseCategory(
  db: Database.Database,
  ids: number[],
  category: ExpenseCategory | string,
  note?: string
): BulkResult {
  requireIds(ids);
  if (!String(category).trim()) throw new Error('Catégorie obligatoire.');
  const stmt = db.prepare(`UPDATE expenses SET category=?, updated_at=datetime('now') WHERE id=?`);
  const result: BulkResult = { updated: 0, skipped: 0, errors: [] };
  const tx = db.transaction(() => {
    for (const id of ids) {
      const info = stmt.run(category, id);
      if (info.changes > 0) result.updated += 1;
      else result.skipped += 1;
    }
    logBulkAction(db, 'expense', `category:${category}`, ids, note ?? null);
  });
  tx();
  return result;
}

export function bulkUpdateDocumentType(
  db: Database.Database,
  ids: number[],
  documentType: DocumentType | string,
  note?: string
): BulkResult {
  requireIds(ids);
  if (!String(documentType).trim()) throw new Error('Type de document obligatoire.');
  const stmt = db.prepare(`UPDATE documents SET document_type=?, updated_at=datetime('now') WHERE id=?`);
  const result: BulkResult = { updated: 0, skipped: 0, errors: [] };
  const tx = db.transaction(() => {
    for (const id of ids) {
      const info = stmt.run(documentType, id);
      if (info.changes > 0) result.updated += 1;
      else result.skipped += 1;
    }
    logBulkAction(db, 'document', `type:${documentType}`, ids, note ?? null);
  });
  tx();
  return result;
}
