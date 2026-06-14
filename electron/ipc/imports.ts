import { ipcMain, dialog } from 'electron';
import { getDb } from '../db/connection';
import { IPC } from '../../shared/ipc';
import { buildImportPreview, runImport, revertImport } from '../services/importers';
import type { GenericCsvMapping, ImportType } from '../../shared/types';

/**
 * P1.5 — Handlers IPC du domaine « Imports » (CSV uniquement).
 * Les handlers IMPORTS_PDF_*_PICK (PDF) restent dans index.ts car ils
 * embarquent une UI dialog complexe spécifique.
 * Comportement et canaux IPC INCHANGÉS.
 */
export function registerImportsIpc(): void {
  ipcMain.handle(IPC.IMPORTS_PICK_FILE, async () => {
    const res = await dialog.showOpenDialog({
      title: 'Sélectionner un fichier à importer',
      properties: ['openFile'],
      filters: [
        { name: 'CSV / PDF', extensions: ['csv', 'pdf'] },
        { name: 'Tous les fichiers', extensions: ['*'] }
      ]
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  ipcMain.handle(IPC.IMPORTS_PREVIEW, (_e, payload: { filePath: string; forcedType?: ImportType; csvMapping?: GenericCsvMapping }) => {
    return buildImportPreview(getDb(), payload.filePath, payload.forcedType, payload.csvMapping);
  });

  ipcMain.handle(IPC.IMPORTS_RUN, (_e, payload: { filePath: string; forcedType?: ImportType; csvMapping?: GenericCsvMapping }) => {
    return runImport(getDb(), payload);
  });

  ipcMain.handle(IPC.IMPORTS_LIST, () => getDb().prepare('SELECT * FROM imports ORDER BY imported_at DESC LIMIT 100').all());
  ipcMain.handle(IPC.IMPORTS_REVERT, (_e, importId: number) => revertImport(getDb(), importId));
}
