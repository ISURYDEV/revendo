import { ipcMain, dialog, shell, app } from 'electron';
import path from 'node:path';
import { getDb, getDataDir, getDocumentsDir, getBackupsDir, getExportsDir, getMobileSnapshotsDir } from '../db/connection';
import { IPC } from '../../shared/ipc';
import { resetData, type ResetMode } from '../services/maintenance/reset';
import { writeStockTemplate, writeExpensesTemplate } from '../services/templates/csvTemplates';
import { exportAgendaIcs } from '../services/agenda/icalExport';
import { reclassifyAllSales } from '../services/sales/repository';
import {
  listBoosts,
  createManualBoost,
  assignBoost
} from '../services/boosts/repository';
import {
  addDocument,
  linkDocument
} from '../services/documents/storage';
import { buildProfitabilitySummary } from '../services/profitability/calculator';
import { exportRegistreAchats } from '../services/registre/exportRegistre';
import {
  listAuditFor,
  listRecentAudit,
  revertAuditEntry,
  type AuditEntity
} from '../services/audit/repository';
import { deleteWithAudit, updateWithAudit, recordCreate } from '../services/audit/guarded';
import { createBackup, listBackups } from '../services/backup/backup';
import { detectCloudFolders, getCloudStatus, syncBackupToCloud, syncDocumentsToCloud, syncMobileSnapshotToCloud, type CloudProvider } from '../services/backup/cloudSync';
import { buildSeuilStatus } from '../services/seuils/calculator';
import { buildReminders, dismissReminder } from '../services/reminders/calculator';
import { generateFactureVente } from '../services/pdf/factureVente';
import { generateDeclarationRecap } from '../services/pdf/declarationRecap';
import { generateJustificatifAchat, generateAllJustificativosWithoutDoc } from '../services/pdf/justificatifAchat';
import { exportLivreRecettesXlsx } from '../services/excel/livreRecettesXlsx';
import { extractPdfMetadata } from '../services/ocr/pdfMetadata';
import { importBankCsv } from '../services/banks/importer';
import { parsePastedStatement, reconcile } from '../services/reconciliation/matcher';
import {
  listEntries as listDiary,
  createEntry as createDiary,
  updateEntry as updateDiary,
  deleteEntry as deleteDiary
} from '../services/diary/repository';
import { rotateAuditLog } from '../services/maintenance/cleanup';
import { exportFullJson } from '../services/maintenance/exportJson';
import {
  checkBackupIntegrity,
  cleanTemporaryFiles,
  createEncryptedBackup,
  createEncryptedJsonExport,
  createJsonExport,
  createMobileSnapshot,
  getSecurityPrivacyStatus,
  testEncryptedFile
} from '../services/security/dataPrivacy';
import { decryptBuffer, encryptBuffer } from '../services/security/crypto';
import { getSyncOverview } from '../services/sync/foundation';
import { buildMonthlyTrends } from '../services/analytics/trends';
import { buildTopBuyers } from '../services/analytics/topBuyers';
import { buildStaleStock } from '../services/analytics/staleStock';
import { predictCurrentQuarter } from '../services/analytics/prediction';
import { buildReviewCenter, markReviewItem, markReviewItemsBulk } from '../services/review/reviewCenter';
import {
  createSavedFilter,
  deleteSavedFilter,
  listSavedFilters,
  updateSavedFilter
} from '../services/savedFilters/repository';
import { globalSearch } from '../services/search/globalSearch';
import {
  createCsvMappingTemplate,
  deleteCsvMappingTemplate,
  listChannels,
  listCsvMappingTemplates,
  listMarketplaces,
  listSuppliers,
  updateCsvMappingTemplate,
  updateMarketplace,
  upsertChannel,
  upsertSupplier
} from '../services/marketplaces/repository';
import {
  bulkClassifySales,
  bulkStockMoveOut,
  bulkUpdateDocumentType,
  bulkUpdateExpenseCategory,
  bulkUpdateStockLocation,
  bulkUpdateStockStatus,
  markEntitiesVerified
} from '../services/bulkActions/service';
import { listCfePayments, upsertCfePayment, deleteCfePayment } from '../services/cfe/repository';
import type {
  QuarterCode,
  Classification,
  StockItemStatus,
  StockMovementType
} from '../../shared/types';

// P1.5 — Sous-modules IPC par domaine. Ces fonctions enregistrent les handlers
// avec EXACTEMENT les mêmes canaux IPC qu'auparavant ; aucune modification de
// contrat avec le preload/renderer.
import { registerSettingsIpc } from './settings';
import { registerImportsIpc } from './imports';
import { registerSalesIpc } from './sales';
import { registerDeclarationsIpc } from './declarations';
import { registerStockIpc } from './stock';
import { registerExpensesIpc } from './expenses';
import { registerDocumentsIpc } from './documents';
import { registerDashboardIpc } from './dashboard';

export function registerIpcHandlers(): void {
  // ---------- Domaines extraits (P1.5) ----------
  registerSettingsIpc();
  registerImportsIpc();
  registerSalesIpc();
  registerDeclarationsIpc();
  registerStockIpc();
  registerExpensesIpc();
  registerDocumentsIpc();
  registerDashboardIpc();

  // ---------- Purchases ----------
  ipcMain.handle(IPC.PURCHASES_LIST, () => getDb().prepare('SELECT * FROM purchases WHERE deleted_at IS NULL ORDER BY COALESCE(payment_date, created_at) DESC LIMIT 500').all());
  ipcMain.handle(IPC.PURCHASES_CREATE_MANUAL, (_e, payload: {
    payment_date: string;
    seller: string;
    platform?: string;
    articles: string;
    quantity?: number;
    items_price?: number;
    shipping_fee?: number;
    protection_fee?: number;
    total_ttc: number;
    notes?: string;
  }) => {
    const db = getDb();
    const info = db.prepare(
      `INSERT INTO purchases (
         source, status, payment_date, seller, platform, articles,
         quantity, items_price, shipping_fee, protection_fee, total_ttc, notes
       ) VALUES ('manual', 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      payload.payment_date,
      payload.seller,
      payload.platform ?? null,
      payload.articles,
      payload.quantity ?? 1,
      payload.items_price ?? null,
      payload.shipping_fee ?? null,
      payload.protection_fee ?? null,
      payload.total_ttc,
      payload.notes ?? null
    );
    const id = Number(info.lastInsertRowid);
    recordCreate(db, 'purchase', id, 'Achat manuel');
    return { id };
  });
  ipcMain.handle(IPC.PURCHASES_UPDATE, (_e, payload: { id: number; patch: Record<string, unknown> }) => updateWithAudit(getDb(), 'purchase', payload.id, payload.patch));
  ipcMain.handle(IPC.PURCHASES_DELETE, (_e, payload: { id: number; cascadeStock?: boolean }) => deleteWithAudit(getDb(), 'purchase', payload.id, { cascadeStock: payload.cascadeStock }));

  // ---------- Boosts ----------
  ipcMain.handle(IPC.BOOSTS_LIST, (_e, filters?: Parameters<typeof listBoosts>[1]) => listBoosts(getDb(), filters));
  ipcMain.handle(IPC.BOOSTS_CREATE, (_e, payload: Parameters<typeof createManualBoost>[1]) => {
    const db = getDb();
    const r = createManualBoost(db, payload);
    recordCreate(db, 'boost', r.id, 'Boost manuel');
    return r;
  });
  ipcMain.handle(IPC.BOOSTS_UPDATE, (_e, payload: { id: number; patch: Record<string, unknown> }) => updateWithAudit(getDb(), 'boost', payload.id, payload.patch));
  ipcMain.handle(IPC.BOOSTS_DELETE, (_e, id: number) => deleteWithAudit(getDb(), 'boost', id));
  ipcMain.handle(IPC.BOOSTS_ASSIGN, (_e, payload: Parameters<typeof assignBoost>[1]) => assignBoost(getDb(), payload));

  // ---------- Registre des achats ----------
  ipcMain.handle(IPC.REGISTRE_EXPORT, async (_e, payload: { year: number; quarter?: 1 | 2 | 3 | 4 }) => {
    const db = getDb();
    const defaultName = `registre_achats_${payload.year}${payload.quarter ? `_Q${payload.quarter}` : ''}.csv`;
    const res = await dialog.showSaveDialog({
      title: 'Exporter le registre des achats',
      defaultPath: path.join(app.getPath('documents'), defaultName)
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    const out = exportRegistreAchats(db, payload.year, res.filePath, { quarter: payload.quarter });
    shell.showItemInFolder(res.filePath);
    return { canceled: false, ...out };
  });

  // ---------- Profitability ----------
  ipcMain.handle(IPC.PROFIT_SUMMARY, (_e, payload: { year: number; quarter?: QuarterCode | 'all' }) => {
    return buildProfitabilitySummary(getDb(), payload.year, payload.quarter);
  });

  // ---------- Audit log ----------
  ipcMain.handle(IPC.AUDIT_LIST_FOR, (_e, payload: { entity_type: AuditEntity; entity_id: number }) =>
    listAuditFor(getDb(), payload.entity_type, payload.entity_id)
  );
  ipcMain.handle(IPC.AUDIT_RECENT, (_e, limit?: number) => listRecentAudit(getDb(), limit ?? 200));
  ipcMain.handle(IPC.AUDIT_REVERT, (_e, auditId: number) => revertAuditEntry(getDb(), auditId));

  // ---------- Backup ----------
  ipcMain.handle(IPC.BACKUP_RUN, async (_e, payload?: { kind?: 'daily' | 'monthly' | 'manual' }) => {
    return createBackup(getDb(), { kind: payload?.kind ?? 'manual' });
  });
  ipcMain.handle(IPC.BACKUP_LIST, () => listBackups());

  // ---------- Security / privacy / future sync ----------
  ipcMain.handle(IPC.SECURITY_STATUS, () => getSecurityPrivacyStatus(getDb()));
  ipcMain.handle(IPC.SYNC_OVERVIEW, () => getSyncOverview(getDb()));
  ipcMain.handle(IPC.SECURITY_SAVE_OPTIONS, (_e, payload: Record<string, boolean>) => {
    const db = getDb();
    const allowed = [
      'privacy_mask_buyers_ui',
      'privacy_mask_contact_ui',
      'privacy_mask_username_ui',
      'privacy_exports_anonymized_default',
      'mobile_snapshot_redaction_enabled',
      'mobile_snapshot_protected',
      'security_backup_encryption_enabled',
      'security_export_encryption_enabled',
      'security_snapshot_encryption_enabled'
    ];
    const stmt = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
    const tx = db.transaction(() => {
      for (const key of allowed) {
        if (Object.prototype.hasOwnProperty.call(payload, key)) stmt.run(key, payload[key] ? 'true' : 'false');
      }
    });
    tx();
    return { ok: true };
  });
  ipcMain.handle(IPC.SECURITY_BACKUP_ENCRYPTED, async (_e, payload: { password: string }) =>
    createEncryptedBackup(getDb(), payload.password)
  );
  ipcMain.handle(IPC.SECURITY_EXPORT_ANON, async () => {
    const res = await dialog.showSaveDialog({
      title: 'Exporter mes données anonymisées',
      defaultPath: path.join(app.getPath('documents'), `revendo_export_anonymise_${new Date().toISOString().slice(0, 10)}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    const out = createJsonExport(getDb(), res.filePath, { anonymized: true });
    shell.showItemInFolder(res.filePath);
    return { canceled: false, ...out };
  });
  ipcMain.handle(IPC.SECURITY_EXPORT_ENCRYPTED, async (_e, payload: { password: string; anonymized?: boolean }) =>
    createEncryptedJsonExport(getDb(), payload.password, undefined, { anonymized: payload.anonymized ?? true })
  );
  ipcMain.handle(IPC.SECURITY_PICK_ENCRYPTED_FILE, async () => {
    const file = await dialog.showOpenDialog({
      title: 'Tester un fichier chiffré Revendo',
      properties: ['openFile'],
      filters: [
        { name: 'Fichiers chiffrés Revendo', extensions: ['enc'] },
        { name: 'Tous les fichiers', extensions: ['*'] }
      ]
    });
    if (file.canceled || file.filePaths.length === 0) return { canceled: true };
    return { canceled: false, filePath: file.filePaths[0] };
  });
  ipcMain.handle(IPC.SECURITY_TEST_ENCRYPTED_FILE, (_e, payload: { filePath: string; password: string }) =>
    testEncryptedFile(getDb(), payload.filePath, payload.password)
  );
  ipcMain.handle(IPC.SECURITY_TEST_PASSPHRASE, (_e, payload: { password: string }) => {
    const plain = Buffer.from(`revendo-passphrase-test:${Date.now()}`, 'utf-8');
    const envelope = encryptBuffer(plain, payload.password, { type: 'passphrase_test', app: 'Revendo' });
    const decrypted = decryptBuffer(envelope, payload.password);
    if (Buffer.compare(plain, decrypted) !== 0) {
      throw new Error('Test de déchiffrement échoué.');
    }
    return { ok: true };
  });
  ipcMain.handle(IPC.SECURITY_MOBILE_SNAPSHOT, (_e, payload: { anonymized?: boolean; encrypted?: boolean; password?: string } = {}) =>
    createMobileSnapshot(getDb(), payload)
  );
  ipcMain.handle(IPC.SECURITY_CHECK_BACKUPS, () => checkBackupIntegrity(getDb()));
  ipcMain.handle(IPC.SECURITY_CLEAN_TEMP, () => cleanTemporaryFiles());
  ipcMain.handle(IPC.SECURITY_OPEN_BACKUPS, () => { shell.openPath(getBackupsDir()); return { ok: true }; });
  ipcMain.handle(IPC.SECURITY_OPEN_EXPORTS, () => { shell.openPath(getExportsDir()); return { ok: true }; });
  ipcMain.handle(IPC.SECURITY_OPEN_SNAPSHOTS, () => { shell.openPath(getMobileSnapshotsDir()); return { ok: true }; });

  // ---------- Cloud sync (Google Drive / OneDrive / Dropbox folder-based) ----------
  ipcMain.handle(IPC.CLOUD_STATUS, () => getCloudStatus(getDb()));

  ipcMain.handle(IPC.CLOUD_PICK_FOLDER, async () => {
    const res = await dialog.showOpenDialog({
      title: 'Choisir le dossier de sauvegarde cloud',
      properties: ['openDirectory', 'createDirectory'],
      message: 'Sélectionnez un dossier à l\'intérieur de Google Drive / OneDrive / Dropbox.'
    });
    if (res.canceled || res.filePaths.length === 0) return { canceled: true };
    return { canceled: false, path: res.filePaths[0], detected: detectCloudFolders() };
  });

  ipcMain.handle(IPC.CLOUD_SAVE_CONFIG, (_e, payload: { enabled: boolean; folder: string; provider: CloudProvider; keepVersions?: number }) => {
    const db = getDb();
    const set = (k: string, v: string) =>
      db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(k, v);
    set('cloud_sync_enabled', payload.enabled ? 'true' : 'false');
    set('cloud_sync_folder', payload.folder ?? '');
    set('cloud_sync_provider_hint', payload.provider ?? '');
    if (payload.keepVersions) set('cloud_sync_keep_versions', String(payload.keepVersions));
    return { ok: true };
  });

  ipcMain.handle(IPC.CLOUD_SYNC_NOW, async () => {
    const db = getDb();
    const backup = await createBackup(db, { kind: 'manual' });
    const result = syncBackupToCloud(db, backup.path, { kind: 'manual' });
    if (!result.ok) return { ok: false, reason: result.reason, backupPath: backup.path };
    return { ok: true, copiedTo: result.copiedTo, size: backup.size };
  });

  ipcMain.handle(IPC.CLOUD_SAVE_OPTIONS, (_e, payload: { includeDocuments?: boolean; includeMobile?: boolean }) => {
    const db = getDb();
    const set = (k: string, v: string) =>
      db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(k, v);
    if (payload.includeDocuments !== undefined) set('cloud_include_documents', payload.includeDocuments ? 'true' : 'false');
    if (payload.includeMobile !== undefined) set('cloud_include_mobile', payload.includeMobile ? 'true' : 'false');
    return { ok: true };
  });

  ipcMain.handle(IPC.CLOUD_SYNC_DOCS, () => syncDocumentsToCloud(getDb()));
  ipcMain.handle(IPC.CLOUD_SYNC_MOBILE, () => syncMobileSnapshotToCloud(getDb()));

  ipcMain.handle(IPC.CLOUD_OPEN_FOLDER, () => {
    const db = getDb();
    const row = db.prepare(`SELECT value FROM settings WHERE key='cloud_sync_folder'`).get() as { value: string } | undefined;
    if (!row?.value) return { ok: false, reason: 'Dossier non configuré' };
    const targetDir = path.join(row.value, 'Revendo Backups');
    shell.openPath(targetDir);
    return { ok: true };
  });

  ipcMain.handle(IPC.BACKUP_EXPORT, async () => {
    const res = await dialog.showSaveDialog({
      title: 'Exporter une copie complète',
      defaultPath: path.join(app.getPath('documents'), `revendo_${new Date().toISOString().slice(0, 10)}.zip`),
      filters: [{ name: 'ZIP', extensions: ['zip'] }]
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    const out = await createBackup(getDb(), { destPath: res.filePath, includeDocs: true });
    shell.showItemInFolder(res.filePath);
    return { canceled: false, ...out };
  });

  // ---------- Seuils ----------
  ipcMain.handle(IPC.SEUILS_STATUS, (_e, year?: number) => buildSeuilStatus(getDb(), year));

  // ---------- Reminders ----------
  ipcMain.handle(IPC.REMINDERS_LIST, () => buildReminders(getDb()));
  ipcMain.handle(IPC.REMINDERS_DISMISS, (_e, payload: { key: string; days?: number }) => {
    dismissReminder(getDb(), payload.key, payload.days);
    return { ok: true };
  });

  // ---------- PDF ----------
  ipcMain.handle(IPC.PDF_FACTURE, async (_e, saleId: number) => {
    const out = await generateFactureVente(getDb(), saleId);
    shell.openPath(out.path);
    return out;
  });
  ipcMain.handle(IPC.PDF_DECLARATION_RECAP, async (_e, payload: { year: number; quarter: QuarterCode; actualDeclaredCa?: number; actualPaidContributions?: number; declarationDate?: string }) => {
    const out = await generateDeclarationRecap(getDb(), payload.year, payload.quarter, payload);
    shell.openPath(out.path);
    return out;
  });
  ipcMain.handle(IPC.PDF_JUSTIFICATIF_ACHAT, async (_e, purchaseId: number) => {
    const out = await generateJustificatifAchat(getDb(), purchaseId);
    shell.openPath(out.path);
    return out;
  });
  ipcMain.handle(IPC.PDF_JUSTIFICATIFS_BULK, async () => generateAllJustificativosWithoutDoc(getDb()));

  // ---------- XLSX ----------
  ipcMain.handle(IPC.XLSX_RECETTES, async (_e, payload: { year: number; quarter: QuarterCode }) => {
    const res = await dialog.showSaveDialog({
      title: 'Exporter le livre des recettes (Excel)',
      defaultPath: path.join(app.getPath('documents'), `livre_recettes_${payload.year}_Q${payload.quarter}.xlsx`),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    const out = await exportLivreRecettesXlsx(getDb(), payload.year, payload.quarter, res.filePath);
    shell.showItemInFolder(res.filePath);
    return { canceled: false, ...out };
  });

  // ---------- OCR ----------
  ipcMain.handle(IPC.OCR_PDF, async (_e, filePath: string) => extractPdfMetadata(filePath));

  // ---------- Bank import + reconciliation ----------
  ipcMain.handle(IPC.BANK_IMPORT_PICK, async () => {
    const res = await dialog.showOpenDialog({
      title: 'Sélectionner le CSV bancaire',
      properties: ['openFile'],
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    });
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
  });
  ipcMain.handle(IPC.BANK_IMPORT_RUN, (_e, payload: { filePath: string; bankName?: string }) => importBankCsv(getDb(), payload.filePath, payload.bankName ?? 'Inconnu'));
  ipcMain.handle(IPC.BANK_TX_LIST, () =>
    getDb().prepare(`SELECT * FROM bank_transactions ORDER BY transaction_date DESC LIMIT 500`).all()
  );
  ipcMain.handle(IPC.RECON_PARSE, (_e, text: string) => parsePastedStatement(text));
  ipcMain.handle(IPC.RECON_MATCH, (_e, lines: Parameters<typeof reconcile>[1]) => reconcile(getDb(), lines));

  // ---------- Diary ----------
  ipcMain.handle(IPC.DIARY_LIST, (_e, filters?: Parameters<typeof listDiary>[1]) => listDiary(getDb(), filters));
  ipcMain.handle(IPC.DIARY_CREATE, (_e, payload: Parameters<typeof createDiary>[1]) => createDiary(getDb(), payload));
  ipcMain.handle(IPC.DIARY_UPDATE, (_e, payload: { id: number; patch: Parameters<typeof updateDiary>[2] }) => updateDiary(getDb(), payload.id, payload.patch));
  ipcMain.handle(IPC.DIARY_DELETE, (_e, id: number) => deleteDiary(getDb(), id));

  // ---------- First-run wizard ----------
  ipcMain.handle(IPC.WIZARD_NEEDED, () => {
    const row = getDb().prepare(`SELECT value FROM settings WHERE key='activity_start_date'`).get() as { value: string } | undefined;
    return { needed: !row?.value };
  });

  // ---------- Maintenance ----------
  ipcMain.handle(IPC.MAINT_RECLASSIFY_ALL, (_e, payload?: { force?: boolean }) => reclassifyAllSales(getDb(), payload ?? {}));
  ipcMain.handle(IPC.MAINT_ROTATE_AUDIT, () => rotateAuditLog(getDb()));
  ipcMain.handle(IPC.MAINT_EXPORT_JSON, async () => {
    const res = await dialog.showSaveDialog({
      title: 'Exporter en JSON',
      defaultPath: path.join(app.getPath('documents'), `revendo_export_${new Date().toISOString().slice(0, 10)}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    const out = exportFullJson(getDb(), res.filePath);
    shell.showItemInFolder(res.filePath);
    return { canceled: false, ...out };
  });

  // ---------- Analytics ----------
  ipcMain.handle(IPC.ANALYTICS_TRENDS, (_e, monthsBack?: number) => buildMonthlyTrends(getDb(), monthsBack ?? 12));
  ipcMain.handle(IPC.ANALYTICS_TOP_BUYERS, (_e, limit?: number) => buildTopBuyers(getDb(), limit ?? 15));
  ipcMain.handle(IPC.ANALYTICS_STALE_STOCK, (_e, daysThreshold?: number) => buildStaleStock(getDb(), daysThreshold ?? 90));
  ipcMain.handle(IPC.ANALYTICS_PREDICTION, () => predictCurrentQuarter(getDb()));

  // ---------- Usability phase 2 ----------
  ipcMain.handle(IPC.REVIEW_SUMMARY, (_e, payload?: Parameters<typeof buildReviewCenter>[1]) =>
    buildReviewCenter(getDb(), payload ?? {})
  );
  ipcMain.handle(IPC.REVIEW_MARK, (_e, payload: Parameters<typeof markReviewItem>[1]) =>
    markReviewItem(getDb(), payload)
  );
  ipcMain.handle(IPC.REVIEW_MARK_BULK, (_e, payload: Parameters<typeof markReviewItemsBulk>[1]) =>
    markReviewItemsBulk(getDb(), payload)
  );

  ipcMain.handle(IPC.SAVED_FILTERS_LIST, (_e, entityType?: string) => listSavedFilters(getDb(), entityType));
  ipcMain.handle(IPC.SAVED_FILTERS_CREATE, (_e, payload: Parameters<typeof createSavedFilter>[1]) =>
    createSavedFilter(getDb(), payload)
  );
  ipcMain.handle(IPC.SAVED_FILTERS_UPDATE, (_e, payload: { id: number; patch: Parameters<typeof updateSavedFilter>[2] }) =>
    updateSavedFilter(getDb(), payload.id, payload.patch)
  );
  ipcMain.handle(IPC.SAVED_FILTERS_DELETE, (_e, id: number) => deleteSavedFilter(getDb(), id));

  ipcMain.handle(IPC.GLOBAL_SEARCH, (_e, payload: { query: string; limit?: number }) =>
    globalSearch(getDb(), payload.query, payload.limit ?? 8)
  );

  // ---------- Multi-marketplace foundation ----------
  ipcMain.handle(IPC.MARKETPLACES_LIST, () => listMarketplaces(getDb()));
  ipcMain.handle(IPC.MARKETPLACES_UPDATE, (_e, payload: { id: number; patch: Parameters<typeof updateMarketplace>[2] }) =>
    updateMarketplace(getDb(), payload.id, payload.patch)
  );
  ipcMain.handle(IPC.CHANNELS_LIST, () => listChannels(getDb()));
  ipcMain.handle(IPC.CHANNELS_UPSERT, (_e, payload: Parameters<typeof upsertChannel>[1]) =>
    upsertChannel(getDb(), payload)
  );
  ipcMain.handle(IPC.SUPPLIERS_LIST, () => listSuppliers(getDb()));
  ipcMain.handle(IPC.SUPPLIERS_UPSERT, (_e, payload: Parameters<typeof upsertSupplier>[1]) =>
    upsertSupplier(getDb(), payload)
  );
  ipcMain.handle(IPC.CSV_TEMPLATES_LIST, (_e, entityType?: string) =>
    listCsvMappingTemplates(getDb(), entityType)
  );
  ipcMain.handle(IPC.CSV_TEMPLATES_CREATE, (_e, payload: Parameters<typeof createCsvMappingTemplate>[1]) =>
    createCsvMappingTemplate(getDb(), payload)
  );
  ipcMain.handle(IPC.CSV_TEMPLATES_UPDATE, (_e, payload: { id: number; patch: Parameters<typeof updateCsvMappingTemplate>[2] }) =>
    updateCsvMappingTemplate(getDb(), payload.id, payload.patch)
  );
  ipcMain.handle(IPC.CSV_TEMPLATES_DELETE, (_e, id: number) => deleteCsvMappingTemplate(getDb(), id));

  ipcMain.handle(IPC.BULK_MARK_VERIFIED, (_e, payload: {
    entityType: 'sale' | 'stock_item' | 'purchase' | 'expense' | 'document';
    ids: number[];
    note: string;
  }) => markEntitiesVerified(getDb(), payload.entityType, payload.ids, payload.note));
  ipcMain.handle(IPC.BULK_SALES_CLASSIFY, (_e, payload: { ids: number[]; classification: Classification; note: string }) =>
    bulkClassifySales(getDb(), payload.ids, payload.classification, payload.note)
  );
  ipcMain.handle(IPC.BULK_STOCK_LOCATION, (_e, payload: { ids: number[]; location: string; note?: string }) =>
    bulkUpdateStockLocation(getDb(), payload.ids, payload.location, payload.note)
  );
  ipcMain.handle(IPC.BULK_STOCK_STATUS, (_e, payload: { ids: number[]; status: StockItemStatus; note?: string }) =>
    bulkUpdateStockStatus(getDb(), payload.ids, payload.status, payload.note)
  );
  ipcMain.handle(IPC.BULK_STOCK_MOVE_OUT, (_e, payload: { ids: number[]; movementType: Extract<StockMovementType, 'OUT_DONATED' | 'OUT_GIFTED' | 'OUT_LOST' | 'OUT_DISCARDED'>; quantity: number; note: string }) =>
    bulkStockMoveOut(getDb(), payload.ids, payload.movementType, payload.quantity, payload.note)
  );
  ipcMain.handle(IPC.BULK_EXPENSE_CATEGORY, (_e, payload: { ids: number[]; category: string; note?: string }) =>
    bulkUpdateExpenseCategory(getDb(), payload.ids, payload.category, payload.note)
  );
  ipcMain.handle(IPC.BULK_DOCUMENT_TYPE, (_e, payload: { ids: number[]; documentType: string; note?: string }) =>
    bulkUpdateDocumentType(getDb(), payload.ids, payload.documentType, payload.note)
  );

  // ---------- CFE ----------
  ipcMain.handle(IPC.CFE_LIST, () => listCfePayments(getDb()));
  ipcMain.handle(IPC.CFE_UPSERT, (_e, payload: { year: number; amount_paid?: number; paid_date?: string; exonerated?: boolean; notes?: string }) => upsertCfePayment(getDb(), payload));
  ipcMain.handle(IPC.CFE_DELETE, (_e, id: number) => deleteCfePayment(getDb(), id));

  ipcMain.handle(IPC.MAINT_RESET, (_e, payload: { mode: ResetMode; confirmation: string }) => {
    if (payload.confirmation !== 'BORRAR' && payload.confirmation !== 'SUPPRIMER') {
      throw new Error('Texte de confirmation incorrect. Écrivez exactement BORRAR ou SUPPRIMER.');
    }
    return resetData(getDb(), payload.mode);
  });

  // ---------- CSV templates ----------
  ipcMain.handle(IPC.TEMPLATE_STOCK_CSV, async () => {
    const res = await dialog.showSaveDialog({
      title: 'Télécharger le modèle CSV de stock',
      defaultPath: path.join(app.getPath('documents'), 'modele_stock.csv'),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    writeStockTemplate(res.filePath);
    shell.showItemInFolder(res.filePath);
    return { canceled: false, path: res.filePath };
  });
  ipcMain.handle(IPC.TEMPLATE_EXPENSES_CSV, async () => {
    const res = await dialog.showSaveDialog({
      title: 'Télécharger le modèle CSV de dépenses',
      defaultPath: path.join(app.getPath('documents'), 'modele_depenses.csv'),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    writeExpensesTemplate(res.filePath);
    shell.showItemInFolder(res.filePath);
    return { canceled: false, path: res.filePath };
  });

  // ---------- Agenda iCal export ----------
  ipcMain.handle(IPC.AGENDA_EXPORT_ICS, async () => {
    const res = await dialog.showSaveDialog({
      title: 'Exporter agenda (iCal)',
      defaultPath: path.join(app.getPath('documents'), `agenda_revendo_${new Date().toISOString().slice(0, 10)}.ics`),
      filters: [{ name: 'iCalendar', extensions: ['ics'] }]
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    const out = exportAgendaIcs(getDb(), res.filePath);
    shell.showItemInFolder(res.filePath);
    return { canceled: false, ...out };
  });

  // ---------- PDF imports (multi-select) ----------
  ipcMain.handle(IPC.IMPORTS_PDF_SALES_PICK, async (_e, payload: { platform: 'vinted' | 'whatnot' | 'other' }) => {
    const res = await dialog.showOpenDialog({
      title: 'Sélectionner les PDF de ventes',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF / Image', extensions: ['pdf', 'png', 'jpg', 'jpeg'] }]
    });
    if (res.canceled || res.filePaths.length === 0) return { canceled: true, results: [] };
    const db = getDb();
    const { addDocument } = await import('../services/documents/storage');
    const { extractPdfMetadata } = await import('../services/ocr/pdfMetadata');
    const { matchSalesInvoiceBySku } = await import('../services/documents/salesInvoiceMatcher');
    const results = [];
    for (const p of res.filePaths) {
      try {
        const meta = p.toLowerCase().endsWith('.pdf') ? await extractPdfMetadata(p) : undefined;
        const out = addDocument(db, {
          sourcePath: p,
          document_type: 'facture_vente',
          date: meta?.date ?? null,
          amount: meta?.amount ?? null,
          notes: `Justificatif de vente importé — plateforme: ${payload.platform}`
        });
        db.prepare(`UPDATE documents SET source=? WHERE id=?`).run(payload.platform, out.id);
        const match = await matchSalesInvoiceBySku(db, out.id, meta);
        results.push({ ok: true, ...out, matchStatus: match.status, extractedSkus: match.skus });
      } catch (err) {
        results.push({ ok: false, error: err instanceof Error ? err.message : String(err), sourcePath: p });
      }
    }
    return { canceled: false, results };
  });
  ipcMain.handle(IPC.IMPORTS_PDF_PURCHASES_PICK, async (_e, payload: { platform: 'aliexpress' | 'vinted' | 'whatnot' | 'other' }) => {
    const res = await dialog.showOpenDialog({
      title: 'Sélectionner les PDF d\'achats',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF / Image', extensions: ['pdf', 'png', 'jpg', 'jpeg'] }]
    });
    if (res.canceled || res.filePaths.length === 0) return { canceled: true, results: [] };
    const db = getDb();
    const { addDocument } = await import('../services/documents/storage');
    const { extractPdfMetadata } = await import('../services/ocr/pdfMetadata');
    const { ensurePurchaseFromPurchaseDocument } = await import('../services/automation/startupLinking');
    const results = [];
    for (const p of res.filePaths) {
      try {
        const meta = p.toLowerCase().endsWith('.pdf') ? await extractPdfMetadata(p) : undefined;
        const out = addDocument(db, {
          sourcePath: p,
          document_type: 'facture_achat',
          date: meta?.date ?? null,
          amount: meta?.amount ?? null,
          supplier_or_customer: payload.platform === 'aliexpress' ? 'AliExpress' : null,
          notes: `Justificatif d'achat importé — plateforme: ${payload.platform}`
        });
        db.prepare(
          `UPDATE documents
           SET source=?,
               extracted_metadata_json=COALESCE(extracted_metadata_json, ?)
           WHERE id=?`
        ).run(
          payload.platform,
          meta ? JSON.stringify({ date: meta.date, amount: meta.amount, candidates: meta.candidates }) : null,
          out.id
        );
        let purchaseId: number | null = null;
        if (payload.platform === 'aliexpress') {
          purchaseId = ensurePurchaseFromPurchaseDocument(db, out.id, 'AliExpress').purchaseId;
        }
        results.push({ ok: true, ...out, purchaseId });
      } catch (err) {
        results.push({ ok: false, error: err instanceof Error ? err.message : String(err), sourcePath: p });
      }
    }
    return { canceled: false, results };
  });

  ipcMain.handle(IPC.IMPORTS_PDF_BOOSTS_PICK, async (_e, payload: { platform: 'vinted' | 'other' }) => {
    const res = await dialog.showOpenDialog({
      title: 'Sélectionner les factures de boosts',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF / Image', extensions: ['pdf', 'png', 'jpg', 'jpeg'] }]
    });
    if (res.canceled || res.filePaths.length === 0) return { canceled: true, results: [] };
    const db = getDb();
    const { addDocument } = await import('../services/documents/storage');
    const { extractPdfMetadata } = await import('../services/ocr/pdfMetadata');
    const { matchBoostInvoiceToExpense } = await import('../services/documents/boostInvoiceMatcher');
    const results = [];
    for (const p of res.filePaths) {
      try {
        const meta = p.toLowerCase().endsWith('.pdf') ? await extractPdfMetadata(p) : undefined;
        const out = addDocument(db, {
          sourcePath: p,
          document_type: 'facture_boost',
          date: meta?.date ?? null,
          amount: meta?.amount ?? null,
          supplier_or_customer: payload.platform === 'vinted' ? 'Vinted' : null,
          notes: `Facture de boost importée — plateforme: ${payload.platform}`
        });
        db.prepare(
          `UPDATE documents
           SET source=?, extracted_metadata_json=COALESCE(extracted_metadata_json, ?)
           WHERE id=?`
        ).run(payload.platform, meta ? JSON.stringify({ date: meta.date, amount: meta.amount, candidates: meta.candidates }) : null, out.id);
        const match = matchBoostInvoiceToExpense(db, out.id);
        results.push({ ok: true, ...out, matchStatus: match.status });
      } catch (err) {
        results.push({ ok: false, error: err instanceof Error ? err.message : String(err), sourcePath: p });
      }
    }
    return { canceled: false, results };
  });

  // ---------- Attach receipt to expense ----------
  ipcMain.handle(IPC.EXPENSE_ATTACH_RECEIPT, async (_e, expenseId: number) => {
    const res = await dialog.showOpenDialog({
      title: 'Sélectionner le reçu (PDF ou image)',
      properties: ['openFile'],
      filters: [{ name: 'PDF / Image', extensions: ['pdf', 'png', 'jpg', 'jpeg'] }]
    });
    if (res.canceled || res.filePaths.length === 0) return { canceled: true };
    const db = getDb();
    const doc = addDocument(db, {
      sourcePath: res.filePaths[0],
      document_type: 'ticket_caisse',
      notes: `Reçu pour dépense #${expenseId}`
    });
    if (!doc.deduplicated) linkDocument(db, { document_id: doc.id, entity_type: 'expense', entity_id: expenseId });
    return { canceled: false, documentId: doc.id };
  });

  // ---------- Mobile (PWA companion) ----------
  ipcMain.handle(IPC.MOBILE_EXPORT_JSON_SNAPSHOT, async (_e, payload: { anonymized?: boolean; encrypted?: boolean; password?: string } = {}) => {
    const db = getDb();
    const { exportMobileSnapshotJson } = await import('../services/mobile/snapshotJsonExporter');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dir = getMobileSnapshotsDir();
    const outPath = path.join(dir, `revendo_mobile_${ts}.json`);
    return exportMobileSnapshotJson(db, outPath, payload);
  });

  ipcMain.handle(IPC.MOBILE_PICK_ACTIONS_FILE, async () => {
    const res = await dialog.showOpenDialog({
      title: 'Sélectionner les actions mobile à importer',
      properties: ['openFile'],
      filters: [
        { name: 'Actions Revendo Mobile', extensions: ['json', 'enc'] },
        { name: 'Tous les fichiers', extensions: ['*'] }
      ]
    });
    if (res.canceled || res.filePaths.length === 0) return { canceled: true };
    return { canceled: false, filePath: res.filePaths[0] };
  });

  ipcMain.handle(IPC.MOBILE_PREVIEW_ACTIONS, async (_e, payload: { filePath: string; password?: string }) => {
    const { previewMobileActions } = await import('../services/mobile/actionImporter');
    return previewMobileActions(getDb(), payload.filePath, payload.password);
  });

  ipcMain.handle(IPC.MOBILE_APPLY_ACTIONS, async (_e, payload: { filePath: string; password?: string }) => {
    const { applyMobileActions } = await import('../services/mobile/actionImporter');
    return applyMobileActions(getDb(), payload.filePath, payload.password);
  });

  ipcMain.handle(IPC.MOBILE_LIST_ACTION_IMPORTS, async () => {
    const { listMobileActionImports } = await import('../services/mobile/actionImporter');
    return listMobileActionImports(getDb());
  });

  // ---------- Misc ----------
  ipcMain.handle(IPC.APP_OPEN_DATA_FOLDER, () => { shell.openPath(getDataDir()); return { ok: true }; });
  ipcMain.handle(IPC.APP_OPEN_DOCS_FOLDER, () => { shell.openPath(getDocumentsDir()); return { ok: true }; });
  ipcMain.handle(IPC.APP_VERSION, () => app.getVersion());
  getDocumentsDir(); // ensure dir exists
}
