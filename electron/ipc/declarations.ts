import { ipcMain, dialog, shell, app } from 'electron';
import path from 'node:path';
import { getDb } from '../db/connection';
import { IPC } from '../../shared/ipc';
import { buildQuarterlySummary, upsertDeclarationDraft } from '../services/declarations/summary';
import { exportLivreRecettes } from '../services/declarations/exportRecettes';
import { allQuartersFor } from '../services/declarations/quarters';
import { buildFirstDeclarationSummary } from '../services/declarations/firstDeclaration';
import { getRatesVerificationStatus, markRatesVerified } from '../services/seuils/ratesVerification';
import type { QuarterCode } from '../../shared/types';

/**
 * P1.5 — Handlers IPC du domaine « Déclarations URSSAF » + taux.
 * Comportement et canaux IPC INCHANGÉS.
 */
export function registerDeclarationsIpc(): void {
  ipcMain.handle(IPC.DECLARATIONS_LIST_PERIODS, (_e, year: number) => allQuartersFor(year));

  ipcMain.handle(IPC.DECLARATIONS_SUMMARY, (_e, payload: { year: number; quarter: QuarterCode; persistDraft?: boolean }) => {
    const db = getDb();
    const s = buildQuarterlySummary(db, payload.year, payload.quarter);
    if (payload.persistDraft) upsertDeclarationDraft(db, s);
    return s;
  });

  ipcMain.handle(IPC.DECLARATIONS_FIRST_DECLARATION, (_e, payload: { year: number }) => {
    return buildFirstDeclarationSummary(getDb(), payload.year);
  });

  ipcMain.handle(IPC.DECLARATIONS_EXPORT_RECETTES, async (_e, payload: { year: number; quarter: QuarterCode }) => {
    const db = getDb();
    const res = await dialog.showSaveDialog({
      title: 'Exporter le livre des recettes',
      defaultPath: path.join(app.getPath('documents'), `livre_recettes_${payload.year}_Q${payload.quarter}.csv`)
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    const out = exportLivreRecettes(db, payload.year, payload.quarter, path.dirname(res.filePath));
    const fs = await import('node:fs');
    if (out.path !== res.filePath) fs.renameSync(out.path, res.filePath);
    shell.showItemInFolder(res.filePath);
    return { canceled: false, path: res.filePath, rowCount: out.rowCount };
  });

  ipcMain.handle(
    IPC.DECLARATIONS_MARK_DECLARED,
    (_e, payload: {
      year: number;
      quarter: QuarterCode;
      actualDeclaredCa: number;
      actualPaidContributions?: number;
      declarationDate: string;
      notes?: string;
    }) => {
      const db = getDb();
      const s = buildQuarterlySummary(db, payload.year, payload.quarter);
      const declId = upsertDeclarationDraft(db, s).id;
      db.prepare(
        `UPDATE declarations SET status='declared', actual_declared_ca=?, actual_paid_contributions=?,
                                 declaration_date=?, notes=?, updated_at=datetime('now') WHERE id=?`
      ).run(payload.actualDeclaredCa, payload.actualPaidContributions ?? null, payload.declarationDate, payload.notes ?? null, declId);
      return { ok: true, id: declId };
    }
  );

  // Rates (URSSAF/ACRE).
  ipcMain.handle(IPC.RATES_LIST, () => getDb().prepare('SELECT * FROM contribution_rates ORDER BY year DESC, activity_type').all());
  ipcMain.handle(IPC.RATES_UPSERT, (_e, payload: { year: number; activity_type: string; normal_rate: number; acre_rate: number; versement_liberatoire_rate?: number; notes?: string }) => {
    getDb().prepare(
      `INSERT INTO contribution_rates (year, activity_type, normal_rate, acre_rate, versement_liberatoire_rate, notes)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(year, activity_type) DO UPDATE SET
         normal_rate=excluded.normal_rate, acre_rate=excluded.acre_rate,
         versement_liberatoire_rate=excluded.versement_liberatoire_rate, notes=excluded.notes`
    ).run(payload.year, payload.activity_type, payload.normal_rate, payload.acre_rate, payload.versement_liberatoire_rate ?? null, payload.notes ?? null);
    return { ok: true };
  });

  // P0.3 — Vérification annuelle des taux URSSAF/ACRE.
  ipcMain.handle(IPC.RATES_VERIFICATION_STATUS, () => getRatesVerificationStatus(getDb()));
  ipcMain.handle(IPC.RATES_MARK_VERIFIED, () => markRatesVerified(getDb()));
}
