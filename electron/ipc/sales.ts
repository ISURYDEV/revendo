import { ipcMain } from 'electron';
import { getDb } from '../db/connection';
import { IPC } from '../../shared/ipc';
import { reclassifySale, insertManualSale } from '../services/sales/repository';
import { ensureSoldMovementForSale, syncSaleStockAfterStatusChange } from '../services/sales/stockSync';
import { ensureStockForSalesWithSku, createStockFromSaleAction } from '../services/sales/stockAssociation';
import { deleteWithAudit, updateWithAudit, recordCreate } from '../services/audit/guarded';
import type { Classification, QuarterCode } from '../../shared/types';

/**
 * P1.5 — Handlers IPC du domaine « Ventes » (sales).
 * Comportement et canaux IPC INCHANGÉS.
 */
export function registerSalesIpc(): void {
  ipcMain.handle(
    IPC.SALES_LIST,
    (_e, payload: {
      year?: number;
      quarter?: QuarterCode;
      status?: string;
      classification?: Classification | 'all';
      declarable?: 'all' | 'declarable' | 'non_declarable';
      search?: string;
      limit?: number;
      offset?: number;
    } = {}) => {
      const db = getDb();
      const where: string[] = ['deleted_at IS NULL'];
      const params: unknown[] = [];
      if (payload.year && payload.quarter) {
        where.push('declared_period = ?');
        params.push(`${payload.year}-Q${payload.quarter}`);
      }
      if (payload.status) {
        where.push('status = ?');
        params.push(payload.status);
      }
      if (payload.classification && payload.classification !== 'all') {
        where.push('classification = ?');
        params.push(payload.classification);
      }
      if (payload.declarable === 'declarable') where.push('urssaf_declarable=1');
      if (payload.declarable === 'non_declarable') where.push('urssaf_declarable=0');
      if (payload.search) {
        where.push('(article_name LIKE ? OR buyer_username LIKE ? OR sku LIKE ? OR external_id LIKE ?)');
        const like = `%${payload.search}%`;
        params.push(like, like, like, like);
      }
      const limit = payload.limit ?? 500;
      const offset = payload.offset ?? 0;
      const sql = `SELECT * FROM sales ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                   ORDER BY COALESCE(declared_encashment_date, sale_date) DESC LIMIT ? OFFSET ?`;
      return db.prepare(sql).all(...params, limit, offset);
    }
  );

  ipcMain.handle(IPC.SALES_GET, (_e, id: number) => getDb().prepare('SELECT * FROM sales WHERE id=? AND deleted_at IS NULL').get(id));

  ipcMain.handle(
    IPC.SALES_UPDATE,
    (_e, payload: { id: number; declared_encashment_date?: string; declarable_amount?: number; note?: string; article_name?: string; quantity?: number; sku?: string | null; buyer_username?: string | null; buyer_country?: string | null; sale_price_ttc?: number | null; amount_received?: number | null; shipping_cost_ttc?: number | null; status?: string; platform?: string | null }) => {
      const patch: Record<string, unknown> = {};
      for (const k of ['declared_encashment_date', 'declarable_amount', 'note', 'article_name', 'quantity', 'sku', 'buyer_username', 'buyer_country', 'sale_price_ttc', 'amount_received', 'shipping_cost_ttc', 'status', 'platform'] as const) {
        if (payload[k] !== undefined) patch[k] = payload[k];
      }
      if (patch.declared_encashment_date) {
        const iso = String(patch.declared_encashment_date);
        const y = iso.slice(0, 4);
        const m = Number(iso.slice(5, 7));
        const q = m <= 3 ? 1 : m <= 6 ? 2 : m <= 9 ? 3 : 4;
        patch.declared_period = `${y}-Q${q}`;
      }
      const db = getDb();
      const out = updateWithAudit(db, 'sale', payload.id, patch, { note: 'Modification manuelle' });
      if (patch.status !== undefined || patch.sku !== undefined || patch.declared_encashment_date !== undefined) {
        reclassifySale(db, payload.id, { manual: false });
      }
      if (patch.sku !== undefined) {
        ensureStockForSalesWithSku(db, { saleId: payload.id });
      }
      if (patch.status !== undefined) {
        ensureStockForSalesWithSku(db, { saleId: payload.id });
        syncSaleStockAfterStatusChange(db, payload.id);
      }
      return out;
    }
  );

  ipcMain.handle(IPC.SALES_DELETE, (_e, id: number) => deleteWithAudit(getDb(), 'sale', id));

  ipcMain.handle(
    IPC.SALES_RECLASSIFY,
    (_e, payload: { id: number; manual?: boolean; forcedClassification?: Classification; note?: string }) => {
      // Force-personal requires note per spec
      if (payload.manual && payload.forcedClassification === 'personal_item' && !payload.note?.trim()) {
        throw new Error('Une note est obligatoire pour marquer une vente professionnelle comme personnelle.');
      }
      return reclassifySale(getDb(), payload.id, {
        manual: payload.manual,
        forcedClassification: payload.forcedClassification,
        note: payload.note
      });
    }
  );

  ipcMain.handle(IPC.SALES_TOGGLE_DECLARABLE, (_e, payload: { id: number; declarable: boolean; reason?: string }) => {
    return reclassifySale(getDb(), payload.id, {
      manual: true,
      forcedClassification: payload.declarable ? 'professional_resale' : 'personal_item',
      note: payload.reason ?? 'Toggle manual'
    });
  });

  ipcMain.handle(IPC.SALES_CREATE_MANUAL, (_e, payload: Parameters<typeof insertManualSale>[1]) => {
    const db = getDb();
    const r = insertManualSale(db, payload);
    ensureStockForSalesWithSku(db, { saleId: r.id });
    syncSaleStockAfterStatusChange(db, r.id);
    recordCreate(db, 'sale', r.id, 'Vente manuelle');
    return r;
  });

  ipcMain.handle(IPC.SALES_LINK_STOCK, (_e, payload: { sale_id: number; stock_item_id: number }) => {
    const db = getDb();
    db.prepare(
      `UPDATE sales SET linked_stock_item_id=?, stock_association_status='associated', updated_at=datetime('now') WHERE id=?`
    ).run(payload.stock_item_id, payload.sale_id);
    reclassifySale(db, payload.sale_id, { manual: false });
    ensureSoldMovementForSale(db, payload.sale_id, 'Association vente-stock');
    return { ok: true };
  });

  // P0.2 — Action explicite : créer un stock à partir d'une vente avec SKU.
  ipcMain.handle(IPC.SALES_CREATE_STOCK_FROM_SALE, (_e, payload: { sale_id: number }) => {
    return createStockFromSaleAction(getDb(), payload.sale_id);
  });

  ipcMain.handle(IPC.SALES_AUDIT, (_e, saleId: number) =>
    getDb().prepare(`SELECT * FROM sale_classification_audit WHERE sale_id=? ORDER BY changed_at DESC`).all(saleId)
  );
}
