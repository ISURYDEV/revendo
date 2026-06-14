import { ipcMain, dialog } from 'electron';
import { getDb } from '../db/connection';
import { IPC } from '../../shared/ipc';
import {
  addDocument,
  linkDocument,
  unlinkDocument,
  listDocuments,
  linksFor,
  linksForBulk
} from '../services/documents/storage';
import { moveDocumentToTrash } from '../services/documents/trash';
import { deleteWithAudit, updateWithAudit } from '../services/audit/guarded';
import type { DocumentLink, DocumentType } from '../../shared/types';

/**
 * P1.5 — Handlers IPC du domaine « Documents ».
 * Comportement et canaux IPC INCHANGÉS — extraction mécanique de l'ancien
 * `electron/ipc/index.ts`.
 */
export function registerDocumentsIpc(): void {
  ipcMain.handle(IPC.DOCS_PICK_FILES, async () => {
    const res = await dialog.showOpenDialog({
      title: 'Sélectionner des documents',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'PDF / Image / CSV', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'csv', 'xlsx', 'txt'] },
        { name: 'Tous les fichiers', extensions: ['*'] }
      ]
    });
    return res.canceled ? [] : res.filePaths;
  });

  ipcMain.handle(IPC.DOCS_ADD_FROM_PATHS, (_e, payload: { paths: string[]; document_type?: DocumentType }) => {
    const db = getDb();
    return payload.paths.map((p) => {
      try {
        return { ok: true, ...addDocument(db, { sourcePath: p, document_type: payload.document_type ?? null }) };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err), sourcePath: p };
      }
    });
  });

  ipcMain.handle(IPC.DOCS_LIST, (_e, filters?: Parameters<typeof listDocuments>[1]) => listDocuments(getDb(), filters));
  ipcMain.handle(IPC.DOCS_OPEN, async (_e, docId: number) => {
    const db = getDb();
    const { openDocumentFile } = await import('../services/documents/storage');
    return openDocumentFile(db, docId);
  });
  ipcMain.handle(IPC.DOCS_LINK, (_e, payload: Parameters<typeof linkDocument>[1]) => linkDocument(getDb(), payload));
  ipcMain.handle(IPC.DOCS_UNLINK, (_e, linkId: number) => unlinkDocument(getDb(), linkId));
  ipcMain.handle(IPC.DOCS_LINKS_FOR, (_e, payload: { entity_type: DocumentLink['entity_type']; entity_id: number }) => linksFor(getDb(), payload.entity_type, payload.entity_id));
  ipcMain.handle(IPC.DOCS_UPDATE, (_e, payload: { id: number; patch: Record<string, unknown> }) => updateWithAudit(getDb(), 'document', payload.id, payload.patch));
  ipcMain.handle(IPC.DOCS_DELETE, (_e, payload: { id: number; deleteFile?: boolean }) => {
    const db = getDb();
    if (payload.deleteFile) {
      return moveDocumentToTrash(db, payload.id);
    }
    return deleteWithAudit(db, 'document', payload.id);
  });

  ipcMain.handle(IPC.DOCS_LINKS_BULK, (_e, payload: { entity_type: DocumentLink['entity_type']; entity_ids: number[] }) =>
    linksForBulk(getDb(), payload.entity_type, payload.entity_ids));
}
