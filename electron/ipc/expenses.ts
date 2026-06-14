import { ipcMain } from 'electron';
import { getDb } from '../db/connection';
import { IPC } from '../../shared/ipc';
import { listExpenses, createExpense, getExpensesOverview } from '../services/expenses/repository';
import { deleteWithAudit, updateWithAudit, recordCreate } from '../services/audit/guarded';

/**
 * P1.5 — Handlers IPC du domaine « Dépenses ».
 * Comportement et canaux IPC INCHANGÉS.
 */
export function registerExpensesIpc(): void {
  ipcMain.handle(IPC.EXPENSES_LIST, (_e, filters?: Parameters<typeof listExpenses>[1]) => listExpenses(getDb(), filters));
  ipcMain.handle(IPC.EXPENSES_CREATE, (_e, payload: Parameters<typeof createExpense>[1]) => {
    const db = getDb();
    const r = createExpense(db, payload);
    recordCreate(db, 'expense', r.id, 'Dépense manuelle');
    return r;
  });
  ipcMain.handle(IPC.EXPENSES_UPDATE, (_e, payload: { id: number; patch: Record<string, unknown> }) => updateWithAudit(getDb(), 'expense', payload.id, payload.patch));
  ipcMain.handle(IPC.EXPENSES_DELETE, (_e, id: number) => deleteWithAudit(getDb(), 'expense', id));
  ipcMain.handle(IPC.EXPENSES_OVERVIEW, (_e, year: number) => getExpensesOverview(getDb(), year));
}
