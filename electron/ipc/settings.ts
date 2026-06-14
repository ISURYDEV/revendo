import { ipcMain } from 'electron';
import { getDb } from '../db/connection';
import { IPC } from '../../shared/ipc';
import { reclassifyAllSales } from '../services/sales/repository';

/**
 * P1.5 — Handlers IPC du domaine « Réglages » (settings).
 * Tirés intégralement de l'ancien `electron/ipc/index.ts` sans changement de
 * comportement ni de canal IPC.
 */
export function registerSettingsIpc(): void {
  ipcMain.handle(IPC.SETTINGS_GET, () => {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const out: Record<string, unknown> = {};
    for (const r of rows) {
      if (r.value === 'true' || r.value === 'false') out[r.key] = r.value === 'true';
      else if (/^-?\d+(\.\d+)?$/.test(r.value)) out[r.key] = Number(r.value);
      else out[r.key] = r.value;
    }
    return out;
  });

  ipcMain.handle(IPC.SETTINGS_SET, (_e, payload: Record<string, unknown>) => {
    const db = getDb();
    const stmt = db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    );
    const prevStart = (db.prepare(`SELECT value FROM settings WHERE key='activity_start_date'`).get() as { value: string } | undefined)?.value ?? null;
    const tx = db.transaction((entries: [string, unknown][]) => {
      for (const [k, v] of entries) stmt.run(k, v == null ? null : String(v));
    });
    tx(Object.entries(payload));
    // If activity_start_date changed, reclassify all sales automatically.
    const newStart = (db.prepare(`SELECT value FROM settings WHERE key='activity_start_date'`).get() as { value: string } | undefined)?.value ?? null;
    if (newStart && newStart !== prevStart) {
      reclassifyAllSales(db, {});
    }
    return { ok: true };
  });
}
