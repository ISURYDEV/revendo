import type Database from 'better-sqlite3';
import { recordAudit, snapshotRow, type AuditEntity } from './repository';
import { recordSyncChange } from '../sync/foundation';

const TABLE_FOR: Record<AuditEntity, string> = {
  sale: 'sales',
  expense: 'expenses',
  boost: 'boosts',
  purchase: 'purchases',
  document: 'documents',
  stock_item: 'stock_items'
};

/**
 * Generic delete with audit. Captures the row snapshot BEFORE deletion
 * so revertAuditEntry can re-insert it.
 *
 * Refuses to delete if entity has foreign-key dependencies that would dangle:
 *  - stock_item linked to a sale  → user must unlink first
 *  - purchase that created stock_items → confirm via `cascadeStock`
 */
export function deleteWithAudit(
  db: Database.Database,
  entity: AuditEntity,
  id: number,
  options: { note?: string; cascadeStock?: boolean; unlinkSales?: boolean } = {}
): { ok: true } {
  const table = TABLE_FOR[entity];
  if (!table) throw new Error(`Entité non prise en charge : ${entity}`);

  const snapshot = snapshotRow(db, entity, id);
  if (!snapshot) throw new Error(`${entity} #${id} introuvable.`);

  if (entity === 'stock_item') {
    const linked = db
      .prepare(`SELECT COUNT(*) AS n FROM sales WHERE linked_stock_item_id=?`)
      .get(id) as { n: number };
    if (linked.n > 0 && !options.unlinkSales) {
      throw new Error(
        `Suppression impossible : l'article de stock est associé à ${linked.n} vente(s). Désassociez d'abord la vente.`
      );
    }
  }
  if (entity === 'purchase' && !options.cascadeStock) {
    const stockFromPurchase = db
      .prepare(`SELECT COUNT(*) AS n FROM stock_items WHERE purchase_id=?`)
      .get(id) as { n: number };
    if (stockFromPurchase.n > 0) {
      throw new Error(
        `Suppression impossible : cet achat a créé ${stockFromPurchase.n} article(s) de stock. ` +
          `Supprimez d'abord le stock associé, ou utilisez l'option "suppression en cascade".`
      );
    }
  }

  const tx = db.transaction(() => {
    if (entity === 'stock_item') {
      if (options.unlinkSales) {
        const linkedSales = db
          .prepare(`SELECT id FROM sales WHERE linked_stock_item_id=?`)
          .all(id) as Array<{ id: number }>;
        for (const sale of linkedSales) {
          const saleBefore = snapshotRow(db, 'sale', sale.id);
          try {
            db.prepare(
              `UPDATE sales
               SET linked_stock_item_id=NULL,
                   stock_association_status='missing',
                   classification_reason=trim(COALESCE(classification_reason, '') ||
                     CASE WHEN classification_reason IS NULL OR classification_reason='' THEN '' ELSE ' | ' END ||
                     'Stock désassocié lors de la suppression de l’article de stock'),
                   updated_at=datetime('now')
               WHERE id=?`
            ).run(sale.id);
          } catch {
            db.prepare(
              `UPDATE sales
               SET linked_stock_item_id=NULL,
                   classification_reason=trim(COALESCE(classification_reason, '') ||
                     CASE WHEN classification_reason IS NULL OR classification_reason='' THEN '' ELSE ' | ' END ||
                     'Stock désassocié lors de la suppression de l’article de stock'),
                   updated_at=datetime('now')
               WHERE id=?`
            ).run(sale.id);
          }
          const saleAfter = snapshotRow(db, 'sale', sale.id);
          recordAudit(db, {
            entity_type: 'sale',
            entity_id: sale.id,
            operation: 'UPDATE',
            prev_value: saleBefore,
            new_value: saleAfter,
            note: `Désassociation automatique avant suppression du stock #${id}`
          });
          recordSyncChange(db, 'sale', sale.id, 'update', 'local_app', `Désassociation automatique avant suppression du stock #${id}`);
        }
      }
      db.prepare(`DELETE FROM stock_movements WHERE stock_item_id=?`).run(id);
    }
    if (entity === 'document') {
      db.prepare(`DELETE FROM document_links WHERE document_id=?`).run(id);
    }
    db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
    recordAudit(db, {
      entity_type: entity,
      entity_id: id,
      operation: 'DELETE',
      prev_value: snapshot,
      new_value: null,
      note: options.note ?? null
    });
    recordSyncChange(db, entity, id, 'delete', 'local_app', options.note ?? null);
  });
  tx();
  return { ok: true };
}

/**
 * Generic UPDATE with audit. Snapshots before + after.
 * `patch` is a flat object of column→value for the entity's table.
 */
export function updateWithAudit(
  db: Database.Database,
  entity: AuditEntity,
  id: number,
  patch: Record<string, unknown>,
  options: { note?: string } = {}
): { ok: true } {
  const table = TABLE_FOR[entity];
  if (!table) throw new Error(`Entité non prise en charge : ${entity}`);

  const before = snapshotRow(db, entity, id);
  if (!before) throw new Error(`${entity} #${id} introuvable.`);

  const cols = Object.keys(patch);
  if (cols.includes('deleted_at') || cols.includes('deleted_reason')) {
    throw new Error('Soft-delete doit passer par softDeleteEntity.');
  }
  if (cols.length === 0) return { ok: true };
  const sets = cols.map((c) => `${c}=?`).concat(`updated_at=datetime('now')`).join(', ');
  const params = cols.map((c) => patch[c]);
  // Some tables don't have updated_at — drop it gracefully
  try {
    db.prepare(`UPDATE ${table} SET ${sets} WHERE id=?`).run(...params, id);
  } catch (err) {
    const setsNoUpdatedAt = cols.map((c) => `${c}=?`).join(', ');
    db.prepare(`UPDATE ${table} SET ${setsNoUpdatedAt} WHERE id=?`).run(...params, id);
    void err;
  }

  const after = snapshotRow(db, entity, id);
  recordAudit(db, {
    entity_type: entity,
    entity_id: id,
    operation: 'UPDATE',
    prev_value: before,
    new_value: after,
    note: options.note ?? null
  });
  recordSyncChange(db, entity, id, 'update', 'local_app', options.note ?? null);
  return { ok: true };
}

/** Log a CREATE manually (the entity creation itself happens elsewhere). */
export function recordCreate(
  db: Database.Database,
  entity: AuditEntity,
  id: number,
  note?: string
): void {
  const snapshot = snapshotRow(db, entity, id);
  if (!snapshot) return;
  recordAudit(db, {
    entity_type: entity,
    entity_id: id,
    operation: 'CREATE',
    prev_value: null,
    new_value: snapshot,
    note: note ?? null
  });
  recordSyncChange(db, entity, id, 'create', 'local_app', note ?? null);
}
