import { IPC } from '../../shared/ipc';
import type {
  ImportPreview,
  ImportResult,
  ImportType,
  GenericCsvMapping,
  Marketplace,
  Channel,
  Supplier,
  CsvMappingTemplate,
  Sale,
  DeclarationPeriod,
  DeclarationSummary,
  CombinedFirstDeclaration,
  QuarterCode,
  ContributionRate,
  RatesVerificationStatus,
  Classification,
  StockItem,
  StockItemStatus,
  StockMovement,
  StockMovementType,
  StockOrigin,
  Expense,
  ExpenseCategory,
  Boost,
  Document,
  DocumentLink,
  DocumentType,
  ProfitabilitySummary,
  ReviewCenterResult,
  ReviewModule,
  ReviewSeverity,
  SavedFilter,
  GlobalSearchResult
} from '../../shared/types';

declare global {
  interface Window {
    revendo: {
      invoke: <T = unknown>(channel: string, payload?: unknown) => Promise<T>;
      on?: (channel: string, callback: (payload: unknown) => void) => () => void;
      channels: typeof IPC;
    };
  }
}

const ipc = <T = unknown>(ch: string, payload?: unknown): Promise<T> => window.revendo.invoke<T>(ch, payload);

export const api = {
  settings: {
    get: () => ipc<Record<string, unknown>>(IPC.SETTINGS_GET),
    set: (payload: Record<string, unknown>) => ipc<{ ok: true }>(IPC.SETTINGS_SET, payload)
  },
  imports: {
    pickFile: () => ipc<string | null>(IPC.IMPORTS_PICK_FILE),
    preview: (filePath: string, forcedType?: ImportType, csvMapping?: GenericCsvMapping) => ipc<ImportPreview>(IPC.IMPORTS_PREVIEW, { filePath, forcedType, csvMapping }),
    run: (filePath: string, forcedType?: ImportType, csvMapping?: GenericCsvMapping) => ipc<ImportResult>(IPC.IMPORTS_RUN, { filePath, forcedType, csvMapping }),
    list: () => ipc<Array<{ id: number; source: string; file_name: string; imported_at: string; rows_total: number; rows_created: number; rows_updated: number; rows_skipped: number; rows_error: number; import_type: string }>>(IPC.IMPORTS_LIST),
    revert: (importId: number) => ipc<{ deleted: number }>(IPC.IMPORTS_REVERT, importId)
  },
  sales: {
    list: (params: { year?: number; quarter?: QuarterCode; status?: string; classification?: Classification | 'all'; declarable?: 'all' | 'declarable' | 'non_declarable'; search?: string; limit?: number; offset?: number } = {}) => ipc<Sale[]>(IPC.SALES_LIST, params),
    get: (id: number) => ipc<Sale | undefined>(IPC.SALES_GET, id),
    update: (payload: { id: number; declared_encashment_date?: string; declarable_amount?: number; note?: string; article_name?: string; quantity?: number; sku?: string | null; buyer_username?: string | null; buyer_country?: string | null; sale_price_ttc?: number | null; amount_received?: number | null; shipping_cost_ttc?: number | null; status?: string; platform?: string | null }) => ipc<{ ok: true }>(IPC.SALES_UPDATE, payload),
    delete: (id: number) => ipc<{ ok: true }>(IPC.SALES_DELETE, id),
    toggleDeclarable: (payload: { id: number; declarable: boolean; reason?: string }) => ipc(IPC.SALES_TOGGLE_DECLARABLE, payload),
    reclassify: (payload: { id: number; manual?: boolean; forcedClassification?: Classification; note?: string }) => ipc<{ changed: boolean; classification: Classification; urssaf_declarable: 0 | 1 }>(IPC.SALES_RECLASSIFY, payload),
    createManual: (payload: Parameters<typeof reclassifyInsert>[0]) => ipc<{ id: number }>(IPC.SALES_CREATE_MANUAL, payload),
    linkStock: (payload: { sale_id: number; stock_item_id: number }) => ipc<{ ok: true }>(IPC.SALES_LINK_STOCK, payload),
    createStockFromSale: (sale_id: number) => ipc<{ ok: true; stock_item_id: number; classification: Classification; urssaf_declarable: 0 | 1 }>(IPC.SALES_CREATE_STOCK_FROM_SALE, { sale_id }),
    audit: (saleId: number) => ipc<Array<{ id: number; sale_id: number; changed_at: string; prev_classification: string | null; new_classification: string; new_urssaf_declarable: number; new_reason: string | null; manual: number; note: string | null }>>(IPC.SALES_AUDIT, saleId)
  },
  declarations: {
    listPeriods: (year: number) => ipc<DeclarationPeriod[]>(IPC.DECLARATIONS_LIST_PERIODS, year),
    summary: (year: number, quarter: QuarterCode, persistDraft = false) => ipc<DeclarationSummary>(IPC.DECLARATIONS_SUMMARY, { year, quarter, persistDraft }),
    firstDeclaration: (year: number) => ipc<CombinedFirstDeclaration | null>(IPC.DECLARATIONS_FIRST_DECLARATION, { year }),
    exportRecettes: (year: number, quarter: QuarterCode) => ipc<{ canceled: boolean; path?: string; rowCount?: number }>(IPC.DECLARATIONS_EXPORT_RECETTES, { year, quarter }),
    markDeclared: (payload: { year: number; quarter: QuarterCode; actualDeclaredCa: number; actualPaidContributions?: number; declarationDate: string; notes?: string }) => ipc<{ ok: true; id: number }>(IPC.DECLARATIONS_MARK_DECLARED, payload)
  },
  rates: {
    list: () => ipc<ContributionRate[]>(IPC.RATES_LIST),
    upsert: (payload: { year: number; activity_type: string; normal_rate: number; acre_rate: number; versement_liberatoire_rate?: number; notes?: string }) => ipc<{ ok: true }>(IPC.RATES_UPSERT, payload),
    verificationStatus: () => ipc<RatesVerificationStatus>(IPC.RATES_VERIFICATION_STATUS),
    markVerified: () => ipc<{ ok: true; year: number; verifiedAt: string }>(IPC.RATES_MARK_VERIFIED)
  },
  dashboard: {
    overview: () => ipc<{
      year: number;
      quarters: DeclarationSummary[];
      sales: { pro: number; personal: number; uncertain: number; excluded: number; total: number };
      stock: Record<string, number>;
      expensesMonth: number;
      boostsMonth: number;
      nextDue: DeclarationPeriod | null;
    }>(IPC.DASHBOARD_OVERVIEW)
  },
  stock: {
    list: (filters?: { status?: StockItemStatus | 'all'; search?: string; location?: string; origin?: StockOrigin | 'all' }) => ipc<StockItem[]>(IPC.STOCK_LIST, filters),
    overview: () => ipc<{ counts: Record<string, number>; totals: Record<string, number> }>(IPC.STOCK_OVERVIEW),
    get: (id: number) => ipc<StockItem | undefined>(IPC.STOCK_GET, id),
    createManual: (payload: { name: string; quantity: number; origin: StockOrigin; total_cost_ttc?: number | null; unit_cost_ttc?: number | null; brand?: string | null; size?: string | null; color?: string | null; sku?: string | null; estimated_sale_price?: number | null; status?: StockItemStatus; location?: string | null; notes?: string | null }) => ipc<{ id: number; internal_code: string }>(IPC.STOCK_CREATE_MANUAL, payload),
    update: (id: number, patch: Record<string, unknown>) => ipc<{ ok: true }>(IPC.STOCK_UPDATE, { id, patch }),
    moveOut: (payload: { stock_item_id: number; movement_type: StockMovementType; quantity: number; reason?: string; notes?: string; movement_date?: string; linked_sale_id?: number }) => ipc<{ ok: true; new_status: StockItemStatus; new_quantity: number }>(IPC.STOCK_MOVE_OUT, payload),
    movements: (stockItemId: number) => ipc<StockMovement[]>(IPC.STOCK_MOVEMENTS, stockItemId),
    reserve: (payload: { stock_item_id: number; action: 'RESERVE' | 'UNRESERVE' | 'LIST' | 'UNLIST' | 'ARCHIVE' }) => ipc<{ ok: true }>(IPC.STOCK_RESERVE, payload),
    bulkLocation: (ids: number[], location: string) => ipc<{ updated: number }>(IPC.STOCK_BULK_LOCATION, { ids, location }),
    findBySku: (sku: string) => ipc<StockItem[]>(IPC.STOCK_FIND_BY_SKU, sku),
    splitLot: (payload: { purchase_id: number; items: Array<{ name: string; quantity: number; brand?: string | null; size?: string | null; color?: string | null; sku?: string | null; cost_share?: number; estimated_sale_price?: number | null }>; cost_method: 'equal' | 'proportional' | 'manual'; include_shipping?: boolean }) => ipc<{ created: number }>(IPC.STOCK_SPLIT_LOT, payload),
    delete: (id: number, options?: { unlinkSales?: boolean }) => ipc<{ ok: true; deleted?: number }>(IPC.STOCK_DELETE, options ? { id, ...options } : id)
  },
  purchases: {
    list: () => ipc<Array<Record<string, unknown>>>(IPC.PURCHASES_LIST),
    createManual: (payload: { payment_date: string; seller: string; platform?: string; articles: string; quantity?: number; items_price?: number; shipping_fee?: number; protection_fee?: number; total_ttc: number; notes?: string }) => ipc<{ id: number }>(IPC.PURCHASES_CREATE_MANUAL, payload),
    update: (id: number, patch: Record<string, unknown>) => ipc<{ ok: true }>(IPC.PURCHASES_UPDATE, { id, patch }),
    delete: (id: number, cascadeStock = false) => ipc<{ ok: true }>(IPC.PURCHASES_DELETE, { id, cascadeStock })
  },
  expenses: {
    list: (filters?: { year?: number; quarter?: 1 | 2 | 3 | 4; month?: number; category?: string; supplier?: string; withDoc?: 'all' | 'with' | 'without' }) => ipc<Expense[]>(IPC.EXPENSES_LIST, filters),
    create: (payload: { date: string; category: ExpenseCategory | string; supplier?: string | null; platform?: string | null; description?: string | null; amount_ttc: number; amount_ht?: number | null; vat_amount?: number | null; vat_deductible?: number; payment_method?: string | null; linked_sale_id?: number | null; linked_purchase_id?: number | null; linked_stock_item_id?: number | null; linked_boost_id?: number | null; notes?: string | null }) => ipc<{ id: number }>(IPC.EXPENSES_CREATE, payload),
    update: (id: number, patch: Record<string, unknown>) => ipc<{ ok: true }>(IPC.EXPENSES_UPDATE, { id, patch }),
    delete: (id: number) => ipc<{ ok: true }>(IPC.EXPENSES_DELETE, id),
    overview: (year: number) => ipc<{ year: number; monthly: Array<{ month: string; total: number }>; quarterly: Array<{ quarter: number; total: number }>; byCategory: Array<{ category: string; total: number }>; alerts: Record<string, number> }>(IPC.EXPENSES_OVERVIEW, year)
  },
  boosts: {
    list: (filters?: { year?: number; quarter?: 1 | 2 | 3 | 4; type?: string; assignment?: 'all' | 'assigned' | 'unassigned' }) => ipc<Boost[]>(IPC.BOOSTS_LIST, filters),
    create: (payload: { start_date: string; boost_type: string; scope?: string | null; duration_days?: number | null; boosted_articles_count?: number | null; amount_ttc: number; vat_rate?: number | null; vat_amount?: number | null; amount_ht?: number | null; discount?: number | null; notes?: string | null; allocation_targets?: Array<{ entity: string; id?: number; label?: string }>; linked_campaign?: string | null }) => ipc<{ id: number }>(IPC.BOOSTS_CREATE, payload),
    update: (id: number, patch: Record<string, unknown>) => ipc<{ ok: true }>(IPC.BOOSTS_UPDATE, { id, patch }),
    delete: (id: number) => ipc<{ ok: true }>(IPC.BOOSTS_DELETE, id),
    assign: (payload: { id: number; allocation_targets: Array<{ entity: string; id?: number; label?: string }>; linked_campaign?: string | null }) => ipc<{ ok: true }>(IPC.BOOSTS_ASSIGN, payload)
  },
  docs: {
    pickFiles: () => ipc<string[]>(IPC.DOCS_PICK_FILES),
    addFromPaths: (paths: string[], document_type?: DocumentType) => ipc<Array<{ ok: boolean; id?: number; deduplicated?: boolean; document?: Document; error?: string; sourcePath?: string }>>(IPC.DOCS_ADD_FROM_PATHS, { paths, document_type }),
    list: (filters?: { type?: string; search?: string; orphan?: boolean }) => ipc<Document[]>(IPC.DOCS_LIST, filters),
    open: (id: number) => ipc<{ ok: true }>(IPC.DOCS_OPEN, id),
    link: (payload: { document_id: number; entity_type: DocumentLink['entity_type']; entity_id: number }) => ipc<{ ok: true }>(IPC.DOCS_LINK, payload),
    unlink: (linkId: number) => ipc<{ ok: true }>(IPC.DOCS_UNLINK, linkId),
    linksFor: (entity_type: DocumentLink['entity_type'], entity_id: number) => ipc<Array<Document & { link_id: number }>>(IPC.DOCS_LINKS_FOR, { entity_type, entity_id }),
    update: (id: number, patch: Record<string, unknown>) => ipc<{ ok: true }>(IPC.DOCS_UPDATE, { id, patch }),
    delete: (id: number, deleteFile = false) => ipc<{ ok: true }>(IPC.DOCS_DELETE, { id, deleteFile })
  },
  registre: {
    export: (payload: { year: number; quarter?: 1 | 2 | 3 | 4 }) => ipc<{ canceled: boolean; path?: string; rowCount?: number }>(IPC.REGISTRE_EXPORT, payload)
  },
  profit: {
    summary: (year: number, quarter?: QuarterCode | 'all') => ipc<ProfitabilitySummary>(IPC.PROFIT_SUMMARY, { year, quarter })
  },
  backup: {
    run: (kind?: 'daily' | 'monthly' | 'manual') => ipc<{ path: string; size: number; createdAt: string }>(IPC.BACKUP_RUN, { kind }),
    list: () => ipc<Array<{ kind: string; path: string; name: string; size: number; mtime: string }>>(IPC.BACKUP_LIST),
    exportFull: () => ipc<{ canceled: boolean; path?: string; size?: number }>(IPC.BACKUP_EXPORT)
  },
  security: {
    status: () => ipc<{
      appVersion: string;
      localOnly: boolean;
      serverSync: boolean;
      notice: string;
      paths: { dataDir: string; dbPath: string; documentsDir: string; backupsDir: string; exportsDir: string; snapshotsDir: string; tempDir: string };
      sizes: { databaseBytes: number; documentsBytes: number; backupsBytes: number; exportsBytes: number };
      latestBackup: string | null;
      settings: {
        backupEncryptionEnabled: boolean;
        exportEncryptionEnabled: boolean;
        snapshotEncryptionEnabled: boolean;
        mobileSnapshotProtected: boolean;
        maskBuyer: boolean;
        maskContact: boolean;
        maskUsername: boolean;
        anonymizedExports: boolean;
        mobileRedaction: boolean;
      };
      sync: { configured: false; localOnly: true; pendingChanges: number; lastModifiedAt: string | null; conflicts: number };
    }>(IPC.SECURITY_STATUS),
    saveOptions: (payload: Record<string, boolean>) => ipc<{ ok: true }>(IPC.SECURITY_SAVE_OPTIONS, payload),
    encryptedBackup: (password: string) => ipc<{ path: string; size: number; createdAt: string; encrypted: true }>(IPC.SECURITY_BACKUP_ENCRYPTED, { password }),
    exportAnon: () => ipc<{ canceled: boolean; path?: string; rowCount?: number; anonymized?: boolean }>(IPC.SECURITY_EXPORT_ANON),
    exportEncrypted: (password: string, anonymized = true) => ipc<{ path: string; size: number; rowCount: number; encrypted: true; anonymized: boolean }>(IPC.SECURITY_EXPORT_ENCRYPTED, { password, anonymized }),
    pickEncryptedFile: () => ipc<{ canceled: boolean; filePath?: string }>(IPC.SECURITY_PICK_ENCRYPTED_FILE),
    testEncryptedFile: (filePath: string, password: string) => ipc<{ ok: true; path: string; decryptedBytes: number }>(IPC.SECURITY_TEST_ENCRYPTED_FILE, { filePath, password }),
    testPassphrase: (password: string) => ipc<{ ok: true }>(IPC.SECURITY_TEST_PASSPHRASE, { password }),
    mobileSnapshot: (payload: { anonymized?: boolean; encrypted?: boolean; password?: string }) => ipc<{ path: string; size: number; rowCount: number; encrypted: boolean; anonymized: boolean }>(IPC.SECURITY_MOBILE_SNAPSHOT, payload),
    checkBackups: () => ipc<{ checked: number; ok: number; errors: number; rows: Array<{ path: string; ok: boolean; message: string }> }>(IPC.SECURITY_CHECK_BACKUPS),
    cleanTemp: () => ipc<{ deleted: number }>(IPC.SECURITY_CLEAN_TEMP),
    openBackups: () => ipc<{ ok: true }>(IPC.SECURITY_OPEN_BACKUPS),
    openExports: () => ipc<{ ok: true }>(IPC.SECURITY_OPEN_EXPORTS),
    openSnapshots: () => ipc<{ ok: true }>(IPC.SECURITY_OPEN_SNAPSHOTS)
  },
  sync: {
    overview: () => ipc<{ configured: false; localOnly: true; pendingChanges: number; lastModifiedAt: string | null; conflicts: number }>(IPC.SYNC_OVERVIEW)
  },
  mobile: {
    exportJsonSnapshot: (payload: { anonymized?: boolean; encrypted?: boolean; password?: string } = {}) =>
      ipc<{ path: string; size: number; encrypted: boolean; anonymized: boolean; schemaVersion: string; rowCount: number }>(IPC.MOBILE_EXPORT_JSON_SNAPSHOT, payload),
    pickActionsFile: () => ipc<{ canceled: boolean; filePath?: string }>(IPC.MOBILE_PICK_ACTIONS_FILE),
    previewActions: (payload: { filePath: string; password?: string }) => ipc<{
      schemaVersion: string;
      generatedAt: string | null;
      device: string | null;
      total: number;
      validCount: number;
      invalidCount: number;
      fileHash: string;
      alreadyImported: boolean;
      items: Array<{
        id: string;
        type: 'add_expense' | 'add_stock_item' | 'add_stock_movement' | 'mark_review_done' | 'add_note';
        summary: string;
        payload: Record<string, unknown>;
        valid: boolean;
        warnings: string[];
        errors: string[];
      }>;
    }>(IPC.MOBILE_PREVIEW_ACTIONS, payload),
    applyActions: (payload: { filePath: string; password?: string }) => ipc<{
      total: number;
      applied: number;
      rejected: number;
      importId: number;
      items: Array<{ id: string; type: string; status: 'applied' | 'rejected'; error?: string; insertedId?: number }>;
    }>(IPC.MOBILE_APPLY_ACTIONS, payload),
    listActionImports: () => ipc<Array<{ id: number; imported_at: string; file_name: string; bundle_schema_version: string; bundle_device: string | null; total: number; applied: number; rejected: number }>>(IPC.MOBILE_LIST_ACTION_IMPORTS)
  },
  cloud: {
    status: () => ipc<{
      enabled: boolean;
      folder: string | null;
      providerHint: 'google_drive' | 'onedrive' | 'dropbox' | 'icloud' | 'other' | null;
      keepVersions: number;
      lastRun: string | null;
      lastStatus: 'ok' | 'error' | 'skipped' | null;
      lastError: string | null;
      folderExists: boolean;
      detectedFolders: Array<{ provider: string; label: string; path: string; exists: boolean }>;
      includeDocuments: boolean;
      includeMobile: boolean;
      documentsLastSync: string | null;
      documentsFilesSynced: number;
      mobileLastGen: string | null;
    }>(IPC.CLOUD_STATUS),
    saveOptions: (payload: { includeDocuments?: boolean; includeMobile?: boolean }) => ipc<{ ok: true }>(IPC.CLOUD_SAVE_OPTIONS, payload),
    syncDocs: () => ipc<{ ok: boolean; copied?: number; total?: number; reason?: string }>(IPC.CLOUD_SYNC_DOCS),
    syncMobile: () => ipc<{ ok: boolean; path?: string; size?: number; rowCount?: number; reason?: string }>(IPC.CLOUD_SYNC_MOBILE),
    pickFolder: () => ipc<{ canceled: boolean; path?: string; detected?: Array<{ provider: string; label: string; path: string; exists: boolean }> }>(IPC.CLOUD_PICK_FOLDER),
    saveConfig: (payload: { enabled: boolean; folder: string; provider: 'google_drive' | 'onedrive' | 'dropbox' | 'icloud' | 'other'; keepVersions?: number }) => ipc<{ ok: true }>(IPC.CLOUD_SAVE_CONFIG, payload),
    syncNow: () => ipc<{ ok: boolean; copiedTo?: string; size?: number; reason?: string; backupPath?: string }>(IPC.CLOUD_SYNC_NOW),
    openFolder: () => ipc<{ ok: boolean; reason?: string }>(IPC.CLOUD_OPEN_FOLDER)
  },
  seuils: {
    status: (year?: number) => ipc<{ year: number; caUrssaf: number; seuilMarchandises: number; seuilTvaFranchise: number; marchandisesPct: number; tvaPct: number; warningAt: number; dangerAt: number; level: 'ok' | 'warning' | 'danger' | 'over'; message: string }>(IPC.SEUILS_STATUS, year)
  },
  reminders: {
    list: () => ipc<Array<{ key: string; level: 'info' | 'warning' | 'danger'; title: string; body: string; cta?: { label: string; route: string } }>>(IPC.REMINDERS_LIST),
    dismiss: (key: string, days = 1) => ipc<{ ok: true }>(IPC.REMINDERS_DISMISS, { key, days })
  },
  pdf: {
    facture: (saleId: number) => ipc<{ path: string; documentId: number }>(IPC.PDF_FACTURE, saleId),
    declarationRecap: (payload: { year: number; quarter: QuarterCode; actualDeclaredCa?: number; actualPaidContributions?: number; declarationDate?: string }) => ipc<{ path: string; documentId: number }>(IPC.PDF_DECLARATION_RECAP, payload),
    justificatifAchat: (purchaseId: number) => ipc<{ path: string; documentId: number }>(IPC.PDF_JUSTIFICATIF_ACHAT, purchaseId),
    justificatifsBulk: () => ipc<{ generated: number; skipped: number; errors: Array<{ purchaseId: number; reason: string }> }>(IPC.PDF_JUSTIFICATIFS_BULK)
  },
  xlsx: {
    recettes: (year: number, quarter: QuarterCode) => ipc<{ canceled: boolean; path?: string; rowCount?: number }>(IPC.XLSX_RECETTES, { year, quarter })
  },
  ocr: {
    pdf: (filePath: string) => ipc<{ text: string; date: string | null; amount: number | null; candidates: { amounts: number[]; dates: string[] } }>(IPC.OCR_PDF, filePath)
  },
  bank: {
    pickFile: () => ipc<string | null>(IPC.BANK_IMPORT_PICK),
    run: (filePath: string, bankName?: string) => ipc<{ importId: number; created: number; duplicates: number; errors: Array<{ row: number; reason: string }> }>(IPC.BANK_IMPORT_RUN, { filePath, bankName }),
    list: () => ipc<Array<{ id: number; transaction_date: string; label: string; amount: number; bank_name: string }>>(IPC.BANK_TX_LIST)
  },
  recon: {
    parse: (text: string) => ipc<Array<{ date: string | null; amount: number | null; label: string; raw: string }>>(IPC.RECON_PARSE, text),
    match: (lines: Array<{ date: string | null; amount: number | null; label: string; raw: string }>) =>
      ipc<Array<{ date: string | null; amount: number | null; label: string; raw: string; match: { type: 'sale' | 'expense'; id: number; matchScore: number } | null; candidates: Array<{ type: 'sale' | 'expense'; id: number; date: string | null; amount: number; label: string }> }>>(IPC.RECON_MATCH, lines)
  },
  diary: {
    list: (filters?: { year?: number; month?: number; search?: string }) => ipc<Array<{ id: number; entry_date: string; note: string; tags: string | null; created_at: string; updated_at: string }>>(IPC.DIARY_LIST, filters),
    create: (payload: { entry_date: string; note: string; tags?: string }) => ipc<{ id: number }>(IPC.DIARY_CREATE, payload),
    update: (id: number, patch: { entry_date?: string; note?: string; tags?: string }) => ipc<{ ok: true }>(IPC.DIARY_UPDATE, { id, patch }),
    delete: (id: number) => ipc<{ ok: true }>(IPC.DIARY_DELETE, id)
  },
  wizard: {
    needed: () => ipc<{ needed: boolean }>(IPC.WIZARD_NEEDED)
  },
  maint: {
    reclassifyAll: (force = false) => ipc<{ processed: number; changed: number }>(IPC.MAINT_RECLASSIFY_ALL, { force }),
    reset: (mode: 'activity' | 'everything', confirmation: string) => ipc<{ mode: 'activity' | 'everything'; resetAt: string; deleted: Record<string, number> }>(IPC.MAINT_RESET, { mode, confirmation }),
    exportJson: () => ipc<{ canceled: boolean; path?: string; rowCount?: number }>(IPC.MAINT_EXPORT_JSON),
    rotateAudit: () => ipc<{ deleted: number }>(IPC.MAINT_ROTATE_AUDIT)
  },
  analytics: {
    trends: (monthsBack = 12) => ipc<Array<{ month: string; caUrssaf: number; amountReceived: number; salesCount: number; expenses: number }>>(IPC.ANALYTICS_TRENDS, monthsBack),
    topBuyers: (limit = 15) => ipc<Array<{ buyer_username: string; buyer_country: string | null; sales_count: number; total_amount: number; last_purchase: string | null }>>(IPC.ANALYTICS_TOP_BUYERS, limit),
    staleStock: (days = 90) => ipc<Array<{ id: number; internal_code: string; name: string | null; status: string; quantity: number; unit_cost_ttc: number | null; estimated_sale_price: number | null; updated_at: string; days_since_update: number }>>(IPC.ANALYTICS_STALE_STOCK, days),
    prediction: () => ipc<null | { year: number; quarter: 1 | 2 | 3 | 4; periodStart: string; periodEnd: string; caSoFar: number; daysElapsed: number; daysRemaining: number; daysTotal: number; caProjectedEndOfQuarter: number; cotisationsProjected: number; confidenceLabel: 'low' | 'medium' | 'high' }>(IPC.ANALYTICS_PREDICTION)
  },
  review: {
    summary: (filters?: { severity?: ReviewSeverity | 'all'; module?: ReviewModule | 'all'; includeIgnored?: boolean }) =>
      ipc<ReviewCenterResult>(IPC.REVIEW_SUMMARY, filters),
    mark: (payload: { key: string; module: ReviewModule; entity_type?: string | null; entity_id?: number | null; status?: 'verified' | 'ignored'; note: string }) =>
      ipc<{ ok: true }>(IPC.REVIEW_MARK, payload),
    markBulk: (payload: {
      items: Array<{ key: string; module: ReviewModule; entity_type?: string | null; entity_id?: number | null }>;
      status: 'verified' | 'ignored';
      note: string;
    }) => ipc<{ ok: true; processed: number }>(IPC.REVIEW_MARK_BULK, payload)
  },
  savedFilters: {
    list: (entityType?: string) => ipc<SavedFilter[]>(IPC.SAVED_FILTERS_LIST, entityType),
    create: (payload: { entity_type: string; name: string; filter_state: unknown; is_favorite?: boolean }) =>
      ipc<{ id: number }>(IPC.SAVED_FILTERS_CREATE, payload),
    update: (id: number, patch: { name?: string; filter_state?: unknown; is_favorite?: boolean }) =>
      ipc<{ ok: true }>(IPC.SAVED_FILTERS_UPDATE, { id, patch }),
    delete: (id: number) => ipc<{ ok: true }>(IPC.SAVED_FILTERS_DELETE, id)
  },
  search: {
    global: (query: string, limit = 8) => ipc<GlobalSearchResult[]>(IPC.GLOBAL_SEARCH, { query, limit })
  },
  marketplaces: {
    list: () => ipc<Marketplace[]>(IPC.MARKETPLACES_LIST),
    update: (id: number, patch: Partial<Pick<Marketplace, 'name' | 'type' | 'website' | 'is_active' | 'default_currency' | 'notes'>>) =>
      ipc<{ ok: true }>(IPC.MARKETPLACES_UPDATE, { id, patch })
  },
  channels: {
    list: () => ipc<Channel[]>(IPC.CHANNELS_LIST),
    upsert: (payload: { id?: number; marketplace_id?: number | null; slug: string; name: string; channel_type?: string; is_active?: number; notes?: string | null }) =>
      ipc<{ id: number }>(IPC.CHANNELS_UPSERT, payload)
  },
  suppliers: {
    list: () => ipc<Supplier[]>(IPC.SUPPLIERS_LIST),
    upsert: (payload: { id?: number; name: string; platform_id?: number | null; supplier_type?: string; website?: string | null; contact?: string | null; notes?: string | null }) =>
      ipc<{ id: number }>(IPC.SUPPLIERS_UPSERT, payload)
  },
  csvTemplates: {
    list: (entityType?: string) => ipc<CsvMappingTemplate[]>(IPC.CSV_TEMPLATES_LIST, entityType),
    create: (payload: { name: string; entity_type: 'sales' | 'purchases' | 'expenses' | 'stock'; platform_id?: number | null; adapter_id?: string | null; mapping: Record<string, string>; date_format?: string | null; decimal_separator?: string | null; delimiter?: string | null; currency?: string | null }) =>
      ipc<{ id: number }>(IPC.CSV_TEMPLATES_CREATE, payload),
    update: (id: number, patch: { name?: string; entity_type?: 'sales' | 'purchases' | 'expenses' | 'stock'; platform_id?: number | null; adapter_id?: string | null; mapping?: Record<string, string>; date_format?: string | null; decimal_separator?: string | null; delimiter?: string | null; currency?: string }) =>
      ipc<{ ok: true }>(IPC.CSV_TEMPLATES_UPDATE, { id, patch }),
    delete: (id: number) => ipc<{ ok: true }>(IPC.CSV_TEMPLATES_DELETE, id)
  },
  bulk: {
    markVerified: (payload: { entityType: 'sale' | 'stock_item' | 'purchase' | 'expense' | 'document'; ids: number[]; note: string }) =>
      ipc<{ updated: number; skipped: number; errors: Array<{ id: number; reason: string }> }>(IPC.BULK_MARK_VERIFIED, payload),
    classifySales: (payload: { ids: number[]; classification: Classification; note: string }) =>
      ipc<{ updated: number; skipped: number; errors: Array<{ id: number; reason: string }> }>(IPC.BULK_SALES_CLASSIFY, payload),
    stockLocation: (payload: { ids: number[]; location: string; note?: string }) =>
      ipc<{ updated: number; skipped: number; errors: Array<{ id: number; reason: string }> }>(IPC.BULK_STOCK_LOCATION, payload),
    stockStatus: (payload: { ids: number[]; status: StockItemStatus; note?: string }) =>
      ipc<{ updated: number; skipped: number; errors: Array<{ id: number; reason: string }> }>(IPC.BULK_STOCK_STATUS, payload),
    stockMoveOut: (payload: { ids: number[]; movementType: Extract<StockMovementType, 'OUT_DONATED' | 'OUT_GIFTED' | 'OUT_LOST' | 'OUT_DISCARDED'>; quantity: number; note: string }) =>
      ipc<{ updated: number; skipped: number; errors: Array<{ id: number; reason: string }> }>(IPC.BULK_STOCK_MOVE_OUT, payload),
    expenseCategory: (payload: { ids: number[]; category: string; note?: string }) =>
      ipc<{ updated: number; skipped: number; errors: Array<{ id: number; reason: string }> }>(IPC.BULK_EXPENSE_CATEGORY, payload),
    documentType: (payload: { ids: number[]; documentType: string; note?: string }) =>
      ipc<{ updated: number; skipped: number; errors: Array<{ id: number; reason: string }> }>(IPC.BULK_DOCUMENT_TYPE, payload)
  },
  cfe: {
    list: () => ipc<Array<{ id: number; year: number; amount_paid: number | null; paid_date: string | null; exonerated: number; notes: string | null }>>(IPC.CFE_LIST),
    upsert: (payload: { year: number; amount_paid?: number; paid_date?: string; exonerated?: boolean; notes?: string }) => ipc<{ id: number }>(IPC.CFE_UPSERT, payload),
    delete: (id: number) => ipc<{ ok: true }>(IPC.CFE_DELETE, id)
  },
  docsBulk: {
    linksFor: (entity_type: DocumentLink['entity_type'], entity_ids: number[]) => ipc<Record<number, Array<Document & { link_id: number }>>>(IPC.DOCS_LINKS_BULK, { entity_type, entity_ids })
  },
  templates: {
    stockCsv: () => ipc<{ canceled: boolean; path?: string }>(IPC.TEMPLATE_STOCK_CSV),
    expensesCsv: () => ipc<{ canceled: boolean; path?: string }>(IPC.TEMPLATE_EXPENSES_CSV)
  },
  dashboardFull: {
    figures: (range: 'this_month' | 'last_month' | 'all_time') => ipc<{
      range: 'this_month' | 'last_month' | 'all_time';
      caTotal: number; profitNet: number;
      salesCompleted: number; packagesInTransit: number; cancellations: number;
      lastCheckedSales: string | null; lastCheckedPurchases: string | null; lastCheckedExpenses: string | null;
      daysSinceSales: number | null; daysSincePurchases: number | null; daysSinceExpenses: number | null;
    }>(IPC.DASHBOARD_FIGURES, range),
    markCheck: (kinds: { sales?: boolean; purchases?: boolean; expenses?: boolean }) => ipc<{ ok: true }>(IPC.DASHBOARD_MARK_CHECK, kinds)
  },
  agenda: {
    exportIcs: () => ipc<{ canceled: boolean; path?: string; count?: number }>(IPC.AGENDA_EXPORT_ICS)
  },
  importsPdf: {
    sales: (platform: 'vinted' | 'whatnot' | 'other') => ipc<{ canceled: boolean; results: Array<{ ok: boolean; id?: number; deduplicated?: boolean; error?: string }> }>(IPC.IMPORTS_PDF_SALES_PICK, { platform }),
    purchases: (platform: 'aliexpress' | 'vinted' | 'whatnot' | 'other') => ipc<{ canceled: boolean; results: Array<{ ok: boolean; id?: number; deduplicated?: boolean; error?: string }> }>(IPC.IMPORTS_PDF_PURCHASES_PICK, { platform }),
    boosts: (platform: 'vinted' | 'other' = 'vinted') => ipc<{ canceled: boolean; results: Array<{ ok: boolean; id?: number; deduplicated?: boolean; matchStatus?: string; error?: string }> }>(IPC.IMPORTS_PDF_BOOSTS_PICK, { platform })
  },
  expenseReceipt: {
    attach: (expenseId: number) => ipc<{ canceled: boolean; documentId?: number }>(IPC.EXPENSE_ATTACH_RECEIPT, expenseId)
  },
  audit: {
    listFor: (entity_type: 'sale' | 'expense' | 'boost' | 'purchase' | 'document' | 'stock_item', entity_id: number) =>
      ipc<Array<{ id: number; changed_at: string; entity_type: string; entity_id: number; operation: 'CREATE' | 'UPDATE' | 'DELETE' | 'REVERT'; prev_value: string | null; new_value: string | null; reverted_from: number | null; note: string | null }>>(IPC.AUDIT_LIST_FOR, { entity_type, entity_id }),
    recent: (limit?: number) =>
      ipc<Array<{ id: number; changed_at: string; entity_type: string; entity_id: number; operation: string; prev_value: string | null; new_value: string | null; reverted_from: number | null; note: string | null }>>(IPC.AUDIT_RECENT, limit),
    revert: (auditId: number) => ipc<{ ok: true }>(IPC.AUDIT_REVERT, auditId)
  },
  app: {
    openDataFolder: () => ipc<{ ok: true }>(IPC.APP_OPEN_DATA_FOLDER),
    openDocsFolder: () => ipc<{ ok: true }>(IPC.APP_OPEN_DOCS_FOLDER),
    version: () => ipc<string>(IPC.APP_VERSION)
  }
};

// Local typing helper for createManual sale payload
type ManualSalePayload = {
  platform: string;
  sale_date?: string | null;
  finalization_date?: string | null;
  declared_encashment_date?: string | null;
  status: string;
  article_name: string;
  quantity?: number;
  sku?: string | null;
  sale_price_ttc?: number | null;
  amount_received?: number | null;
  buyer_username?: string | null;
  buyer_country?: string | null;
  shipping_cost_ttc?: number | null;
  note?: string | null;
  linked_stock_item_id?: number | null;
  forcedClassification?: Classification;
  overrideNote?: string;
};
function reclassifyInsert(_p: ManualSalePayload): void { /* type-helper only */ }
