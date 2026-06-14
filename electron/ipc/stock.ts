import { ipcMain } from 'electron';
import { getDb } from '../db/connection';
import { IPC } from '../../shared/ipc';
import {
  listStock,
  getStockOverview,
  createStockManual,
  moveOut,
  reserveOrList,
  bulkUpdateLocation,
  listMovements,
  findBySku,
  splitPurchaseLot
} from '../services/stock/repository';
import { deleteWithAudit, updateWithAudit, recordCreate } from '../services/audit/guarded';
import type { StockItemStatus, StockMovementType, StockOrigin } from '../../shared/types';

/**
 * P1.5 — Handlers IPC du domaine « Stock ».
 * Comportement et canaux IPC INCHANGÉS.
 */
export function registerStockIpc(): void {
  ipcMain.handle(IPC.STOCK_LIST, (_e, payload?: { status?: StockItemStatus | 'all'; search?: string; location?: string; origin?: StockOrigin | 'all' }) => listStock(getDb(), payload ?? {}));
  ipcMain.handle(IPC.STOCK_OVERVIEW, () => getStockOverview(getDb()));
  ipcMain.handle(IPC.STOCK_GET, (_e, id: number) => getDb().prepare(`SELECT * FROM stock_items WHERE id=? AND deleted_at IS NULL`).get(id));
  ipcMain.handle(IPC.STOCK_CREATE_MANUAL, (_e, payload: Parameters<typeof createStockManual>[1]) => {
    const db = getDb();
    const r = createStockManual(db, payload);
    recordCreate(db, 'stock_item', r.id, 'Stock manual');
    return r;
  });
  ipcMain.handle(IPC.STOCK_UPDATE, (_e, payload: { id: number; patch: Record<string, unknown> }) => updateWithAudit(getDb(), 'stock_item', payload.id, payload.patch));
  ipcMain.handle(IPC.STOCK_MOVE_OUT, (_e, payload: { stock_item_id: number; movement_type: StockMovementType; quantity: number; reason?: string; notes?: string; movement_date?: string; linked_sale_id?: number }) => moveOut(getDb(), payload));
  ipcMain.handle(IPC.STOCK_MOVEMENTS, (_e, stockItemId: number) => listMovements(getDb(), stockItemId));
  ipcMain.handle(IPC.STOCK_RESERVE, (_e, payload: { stock_item_id: number; action: 'RESERVE' | 'UNRESERVE' | 'LIST' | 'UNLIST' | 'ARCHIVE' }) => reserveOrList(getDb(), payload));
  ipcMain.handle(IPC.STOCK_BULK_LOCATION, (_e, payload: { ids: number[]; location: string }) => bulkUpdateLocation(getDb(), payload.ids, payload.location));
  ipcMain.handle(IPC.STOCK_FIND_BY_SKU, (_e, sku: string) => findBySku(getDb(), sku));
  ipcMain.handle(IPC.STOCK_SPLIT_LOT, (_e, payload: Parameters<typeof splitPurchaseLot>[1]) => splitPurchaseLot(getDb(), payload));
  ipcMain.handle(IPC.STOCK_DELETE, (_e, payload: number | { id: number; unlinkSales?: boolean }) => {
    const id = typeof payload === 'number' ? payload : payload.id;
    const unlinkSales = typeof payload === 'number' ? false : payload.unlinkSales === true;
    return deleteWithAudit(getDb(), 'stock_item', id, { unlinkSales });
  });
}
