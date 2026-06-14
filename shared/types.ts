// Shared types used by both Electron main process and React renderer.

export type ImportType =
  | 'vinteer_sales'
  | 'vinteer_purchases'
  | 'vinteer_boosts'
  | 'vinteer_inventory'
  | 'whatnot_purchases'
  | 'generic_expenses'
  | 'generic_stock'
  | 'generic_sales'
  | 'generic_purchases'
  | 'pdf_invoice';

export type SaleStatus = 'completed' | 'colis_perdu' | 'canceled' | 'refunded' | 'shipped' | 'processing' | 'other';

export type StockItemStatus =
  | 'draft'
  | 'purchased'
  | 'in_transit'
  | 'received'
  | 'in_stock'
  | 'listed'
  | 'reserved'
  | 'sold_pending'
  | 'sold_completed'
  | 'returned'
  | 'donated'
  | 'gifted'
  | 'personal_use'
  | 'lost'
  | 'discarded'
  | 'archived';

export type StockMovementType =
  | 'IN_PURCHASE'
  | 'IN_MANUAL'
  | 'IN_INITIAL_STOCK'
  | 'IN_GIFT_RECEIVED'
  | 'IN_DONATION_RECEIVED'
  | 'IN_RETURN'
  | 'OUT_SOLD'
  | 'OUT_DONATED'
  | 'OUT_GIFTED'
  | 'OUT_PERSONAL_USE'
  | 'OUT_LOST'
  | 'OUT_DISCARDED'
  | 'ADJUSTMENT_PLUS'
  | 'ADJUSTMENT_MINUS'
  | 'RESERVE'
  | 'UNRESERVE'
  | 'LIST'
  | 'UNLIST'
  | 'ARCHIVE';

export type Classification =
  | 'professional_resale'
  | 'personal_item'
  | 'uncertain_to_review'
  | 'excluded'
  | 'pre_activity';

export type DocumentType =
  | 'facture_vente'
  | 'facture_achat'
  | 'ticket_caisse'
  | 'justificatif_urssaf'
  | 'export_vinteer'
  | 'export_whatnot'
  | 'whatnot_purchase_csv'
  | 'facture_boost'
  | 'autre';

export type StockOrigin =
  | 'compra_vinted'
  | 'compra_whatnot'
  | 'brocante'
  | 'stock_inicial'
  | 'regalo_recibido'
  | 'donacion_recibida'
  | 'personal'
  | 'autre';

export type ExpenseCategory =
  | 'boost_marketing'
  | 'emballages'
  | 'sacs_expedition'
  | 'scotch'
  | 'tinta_impresora'
  | 'papel_etiquetas'
  | 'frais_port'
  | 'fournitures_bureau'
  | 'materiel_photo'
  | 'achat_stock'
  | 'abonnement_logiciel'
  | 'frais_plateforme'
  | 'autre';

export interface Sale {
  id: number;
  source: string;
  external_id: string | null;
  import_id: number | null;
  sale_date: string | null;
  finalization_date: string | null;
  declared_encashment_date: string | null;
  status: SaleStatus;
  sale_account: string | null;
  platform: string | null;
  is_pro_account: number;
  article_name: string | null;
  quantity: number | null;
  sku: string | null;
  brand: string | null;
  size: string | null;
  color: string | null;
  buyer_name: string | null;
  buyer_email: string | null;
  buyer_username: string | null;
  buyer_address: string | null;
  buyer_country: string | null;
  sale_price_ttc: number | null;
  sale_price_ht: number | null;
  vat_amount: number | null;
  vinted_fees: number | null;
  purchase_cost_total: number | null;
  ancillary_costs: number | null;
  shipping_cost_ttc: number | null;
  refunded_amount: number | null;
  amount_received: number | null;
  vat_rate: number | null;
  carrier: string | null;
  tracking_number: string | null;
  note: string | null;
  is_declarable: number; // legacy mirror of urssaf_declarable
  declarable_amount: number | null;
  exclusion_reason: string | null;
  // Classification engine fields (migration 002)
  classification: Classification | null;
  urssaf_declarable: number; // 1 / 0
  classification_reason: string | null;
  manual_override: number;
  override_note: string | null;
  linked_stock_item_id: number | null;
  linked_purchase_id: number | null;
  declared_period: string | null;
  stock_association_status?: string | null;
  platform_id?: number | null;
  channel_id?: number | null;
  canonical_platform?: string | null;
  source_adapter_id?: string | null;
  dedup_key?: string | null;
  dedup_confidence?: DedupConfidence | null;
  external_reference?: string | null;
  raw_source?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ImportRun {
  id: number;
  source: string;
  file_name: string;
  file_hash: string;
  imported_at: string;
  rows_total: number;
  rows_created: number;
  rows_updated: number;
  rows_skipped: number;
  rows_error: number;
  import_type: ImportType;
  source_adapter_id?: string | null;
  platform_id?: number | null;
  channel_id?: number | null;
  adapter_label?: string | null;
  generated_justificatif_document_id?: number | null;
  notes: string | null;
}

export interface ImportPreview {
  type: ImportType | 'unknown';
  sourceAdapterId?: string | null;
  sourceAdapterName?: string | null;
  platformId?: number | null;
  platformName?: string | null;
  channelId?: number | null;
  channelName?: string | null;
  fileName: string;
  fileHash: string;
  separator: string;
  encoding: string;
  totalRows: number;
  sampleRows: Record<string, string>[];
  detectedHeaders: string[];
  newRows: number;
  duplicates: number;
  errorRows: number;
  totalAmount: number | null;
  dateMin: string | null;
  dateMax: string | null;
  dedupSummary?: ImportDedupSummary;
  requiredFields?: string[];
  mappingRequired?: boolean;
  warnings: string[];
}

export type DedupConfidence = 'high' | 'medium' | 'low';
export type ImportEntityType = 'sale' | 'purchase' | 'expense' | 'stock_item' | 'boost' | 'document';

export interface ImportDedupSummary {
  exactDuplicates: number;
  possibleDuplicates: number;
  newRows: number;
  confidence: Record<DedupConfidence, number>;
}

export interface Marketplace {
  id: number;
  slug: string;
  name: string;
  type: 'marketplace' | 'tool' | 'physical' | 'direct' | 'social' | 'other' | string;
  website: string | null;
  is_active: number;
  default_currency: string;
  notes: string | null;
  auto_created_from_sale_id?: number | null;
  auto_created_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Channel {
  id: number;
  marketplace_id: number | null;
  marketplace_name?: string | null;
  slug: string;
  name: string;
  channel_type: 'sale' | 'purchase' | 'expense' | 'stock' | 'mixed' | string;
  is_active: number;
  notes: string | null;
  extracted_sku?: string | null;
  extracted_metadata_json?: string | null;
  match_confidence?: string | null;
  match_status?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Supplier {
  id: number;
  name: string;
  platform_id: number | null;
  platform_name?: string | null;
  supplier_type: 'marketplace_seller' | 'shop' | 'platform' | 'person' | 'other' | string;
  website: string | null;
  contact: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CsvMappingTemplate {
  id: number;
  name: string;
  entity_type: 'sales' | 'purchases' | 'expenses' | 'stock';
  platform_id: number | null;
  adapter_id: string | null;
  mapping_json: string;
  date_format: string | null;
  decimal_separator: string | null;
  delimiter: string | null;
  currency: string;
  created_at: string;
  updated_at: string;
}

export interface CsvMappingTemplateUsage {
  id: number;
  template_id: number;
  import_id: number | null;
  used_at: string;
  rows_imported: number;
  rows_skipped: number;
  rows_error: number;
}

export interface GenericCsvMapping {
  entityType: 'sales' | 'purchases' | 'expenses' | 'stock';
  platformId?: number | null;
  channelId?: number | null;
  templateId?: number | null;
  mapping: Record<string, string>;
  dateFormat?: string | null;
  decimalSeparator?: string | null;
  delimiter?: string | null;
  currency?: string | null;
}

export interface NormalizedBase {
  source_adapter_id: string;
  platform_id: number | null;
  channel_id: number | null;
  supplier_id?: number | null;
  external_id: string | null;
  external_reference: string | null;
  dedup_key: string;
  dedup_confidence: DedupConfidence;
  raw_row: Record<string, string>;
  import_id?: number | null;
  imported_at?: string | null;
}

export interface NormalizedSale extends NormalizedBase {
  platform: string | null;
  sale_date: string | null;
  finalization_date: string | null;
  encashment_date: string | null;
  status: SaleStatus;
  article_name: string | null;
  quantity: number;
  sku: string | null;
  brand: string | null;
  size: string | null;
  color: string | null;
  buyer_username: string | null;
  buyer_country: string | null;
  sale_price_ttc: number | null;
  amount_received: number | null;
  refunded_amount: number | null;
  fees: number | null;
  shipping_amount: number | null;
  tracking_number: string | null;
  notes: string | null;
}

export interface NormalizedPurchase extends NormalizedBase {
  purchase_date: string | null;
  status: string | null;
  supplier_name: string | null;
  platform: string | null;
  article_name: string | null;
  quantity: number;
  sku: string | null;
  total_ttc: number | null;
  items_amount: number | null;
  shipping_amount: number | null;
  protection_fee: number | null;
  tax_amount: number | null;
  original_currency: string | null;
  exchange_rate: number | null;
  notes: string | null;
}

export interface NormalizedExpense extends NormalizedBase {
  expense_date: string | null;
  category: string | null;
  supplier_name: string | null;
  platform: string | null;
  description: string | null;
  amount_ttc: number | null;
  tax_amount: number | null;
  payment_method: string | null;
  notes: string | null;
}

export interface NormalizedStockItem extends NormalizedBase {
  name: string | null;
  quantity: number;
  sku: string | null;
  brand: string | null;
  size: string | null;
  color: string | null;
  unit_cost_ttc: number | null;
  estimated_sale_price: number | null;
  source: string | null;
  location: string | null;
  notes: string | null;
}

export interface NormalizedBoost extends NormalizedBase {
  start_date: string | null;
  boost_type: string | null;
  scope: string | null;
  duration_days: number | null;
  boosted_articles_count: number | null;
  amount_ttc: number | null;
  tax_amount: number | null;
  notes: string | null;
}

export interface NormalizedDocumentMetadata extends NormalizedBase {
  file_name: string;
  document_type: string | null;
  date: string | null;
  amount: number | null;
  supplier_or_customer: string | null;
  notes: string | null;
}

export interface ImportResult {
  importId: number;
  type: ImportType;
  created: number;
  updated: number;
  /** Identical re-import: row already exists with the same data — silently ignored, NOT counted in CA. */
  duplicatesIdentical: number;
  /** Same external_id but with different data — sale UPDATED, conflict logged for review. */
  conflicts: number;
  /** Skipped for other reasons (e.g. canceled rows already excluded). */
  skipped: number;
  /** Sales marked as pre_activity by classification engine (because date < activity start). */
  preActivityCount: number;
  /** Sales whose new status is canceled/refunded → excluded from CA. */
  canceledRefundedCount: number;
  /** Real CA added by this import (sum of declarable_amount of NEW pro sales only). */
  caAdded: number;
  errors: { row: number; reason: string }[];
}

export type QuarterCode = 1 | 2 | 3 | 4;

export interface DeclarationPeriod {
  year: number;
  quarter: QuarterCode;
  periodStart: string; // ISO date
  periodEnd: string;
  dueDate: string;
}

export interface DeclarationSummary {
  year: number;
  quarter: QuarterCode;
  periodStart: string;            // Effective start (may be activity_start_date for first declaration)
  periodEnd: string;
  dueDate: string;                // Effective due date (may be overridden for first declaration)
  rawPeriodStart: string;         // Quarter start, always 01/01-Q etc.
  rawDueDate: string;             // Standard quarter due date, before any first-declaration override
  caGoods: number;
  includedSalesCount: number;
  excludedSalesCount: number;
  personalSalesCount: number;
  personalSalesAmount: number;
  uncertainSalesCount: number;
  canceledSalesCount: number;
  preActivitySalesCount: number;
  preActivitySalesAmount: number;
  contributionsNormal: number;    // CA × rateNormal (reference value)
  contributionsAcre: number;      // CA × rateAcre (reference value)
  contributionsApplied: number;   // Actual contributions using per-sale ACRE-window check
  acreApplied: boolean;           // True if at least one sale in period falls in ACRE window
  acreFullPeriod: boolean;        // True if the WHOLE period is inside ACRE window
  rateNormal: number;
  rateAcre: number;
  activityStartDate: string | null;
  isFirstDeclaration: boolean;
  isInsideFirstDeclaration: boolean;     // Q2 marqué quand début d'activité en Q1 (combinaison)
  firstDeclarationLabel: string | null;  // e.g. "Q1 2026 — activité commencée le 09/03/2026"
  status: 'draft' | 'declared';
}

/**
 * P0.1 — Récapitulatif unifié de la PREMIÈRE déclaration URSSAF lorsqu'elle
 * combine plusieurs trimestres (cas micro-entreprise : Qs + Qs+1 fusionnés).
 *
 * Garde-fou fiscal : caGoods = somme des declarable_amount des trimestres
 * combinés (urssaf_declarable=1, hors pre_activity, personnelles et annulées).
 * Les dépenses, boosts et COGS NE réduisent JAMAIS ce CA.
 */
export interface CombinedFirstDeclaration {
  year: number;
  quarters: QuarterCode[];                 // ex : [1, 2] lorsque l'activité commence en Q1
  periodStart: string;                      // début effectif (activity_start_date)
  periodEnd: string;                        // fin du dernier trimestre combiné
  dueDate: string;                          // échéance unique (ex. 31/07/2026)
  activityStartDate: string | null;
  caGoods: number;
  includedSalesCount: number;
  excludedSalesCount: number;
  personalSalesCount: number;
  personalSalesAmount: number;
  uncertainSalesCount: number;
  canceledSalesCount: number;
  preActivitySalesCount: number;
  preActivitySalesAmount: number;
  contributionsNormal: number;
  contributionsAcre: number;
  contributionsApplied: number;
  acreApplied: boolean;
  acreFullPeriod: boolean;
  rateNormal: number;
  rateAcre: number;
  status: 'draft' | 'declared';             // 'declared' si tous les trimestres combinés sont déclarés
  firstDeclarationLabel: string | null;
  perQuarter: DeclarationSummary[];         // détail optionnel par trimestre
}

/**
 * P0.3 — État de vérification annuelle des taux URSSAF/ACRE.
 *
 * Les taux sont éditables mais doivent être validés manuellement chaque année.
 * needsVerification = true tant que l'utilisateur n'a pas confirmé qu'il a
 * vérifié les taux pour l'année en cours sur autoentrepreneur.urssaf.fr.
 */
export interface RatesVerificationStatus {
  needsVerification: boolean;
  currentYear: number;
  lastVerifiedYear: number | null;
  lastVerifiedAt: string | null;
  ratesPresent: boolean;
  reason: 'never_verified' | 'year_changed' | 'rates_missing' | 'up_to_date';
}

export interface Settings {
  // business
  company_name?: string;
  first_name?: string;
  last_name?: string;
  commercial_name?: string;
  siret?: string;
  address?: string;
  email?: string;
  phone?: string;
  // activity
  activity_type?: string; // 'vente_marchandises_bic'
  urssaf_periodicity?: 'trimestrial' | 'monthly';
  activity_start_date?: string;
  acre_enabled?: boolean;
  acre_start_date?: string;
  acre_end_date?: string;
  vat_regime?: 'franchise_en_base' | 'reel_simplifie' | 'reel_normal';
  default_currency?: string;
  // fiscal
  versement_liberatoire?: boolean;
  versement_liberatoire_rate?: number;
  // paths
  documents_folder?: string;
  backups_folder?: string;
  // first declaration override
  first_declaration_year?: number;
  first_declaration_quarters?: QuarterCode[];
  first_declaration_due_date?: string;
}

export interface ContributionRate {
  id: number;
  year: number;
  activity_type: string;
  normal_rate: number;
  acre_rate: number;
  versement_liberatoire_rate: number | null;
  notes: string | null;
}

export interface StockItem {
  id: number;
  product_id: number | null;
  internal_code: string;
  sku: string | null;
  name: string | null;
  source: string | null;
  purchase_id: number | null;
  supplier: string | null;
  platform: string | null;
  status: StockItemStatus;
  quantity: number;
  unit_cost_ttc: number | null;
  total_cost_ttc: number | null;
  estimated_sale_price: number | null;
  brand: string | null;
  size: string | null;
  color: string | null;
  location: string | null;
  purchase_date: string | null;
  received_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface StockMovement {
  id: number;
  stock_item_id: number;
  movement_date: string;
  movement_type: StockMovementType;
  quantity: number;
  unit_cost_ttc: number | null;
  total_cost_ttc: number | null;
  reason: string | null;
  linked_sale_id: number | null;
  linked_purchase_id: number | null;
  linked_document_id: number | null;
  notes: string | null;
  created_at: string;
}

export interface Expense {
  id: number;
  source: string;
  date: string;
  category: ExpenseCategory | string;
  supplier: string | null;
  platform: string | null;
  description: string | null;
  amount_ttc: number;
  amount_ht: number | null;
  vat_amount: number | null;
  vat_deductible: number;
  payment_method: string | null;
  linked_product_id: number | null;
  linked_sale_id: number | null;
  linked_purchase_id: number | null;
  linked_boost_id: number | null;
  linked_stock_item_id: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Boost {
  id: number;
  source: string;
  external_id: string | null;
  import_id: number | null;
  start_date: string | null;
  boost_type: string | null;
  scope: string | null;
  duration_days: number | null;
  boosted_articles_count: number | null;
  amount_ht: number | null;
  vat_rate: number | null;
  vat_amount: number | null;
  amount_ttc: number | null;
  gross_price_ttc: number | null;
  discount: number | null;
  allocation_method: string | null;
  allocation_targets: string | null; // JSON array of {entity, id}
  linked_campaign: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Document {
  id: number;
  file_name: string;
  original_file_name: string;
  file_path: string;
  file_hash: string;
  mime_type: string | null;
  document_type: DocumentType | string | null;
  source: string | null;
  date: string | null;
  amount: number | null;
  supplier_or_customer: string | null;
  external_reference: string | null;
  notes: string | null;
  extracted_sku?: string | null;
  extracted_metadata_json?: string | null;
  match_confidence?: string | null;
  match_status?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentLink {
  id: number;
  document_id: number;
  entity_type: 'sale' | 'purchase' | 'expense' | 'boost' | 'stock_item' | 'declaration';
  entity_id: number;
  created_at: string;
}

export interface ProfitabilitySummary {
  periodLabel: string;
  caUrssaf: number;                  // Professional declarable (URSSAF fiscal CA)
  caProfessionalAllSales: number;    // Including non-encashed-yet (gross)
  /**
   * Argent professionnel réellement reçu = SUM(amount_received) sur toutes les ventes
   * NON-personnelles, peu importe le statut. Inclut les annulations/remboursements où
   * Vinted a payé le vendeur (paquet perdu compensé par l'assurance) — l'argent est dans
   * la poche, donc il rentre dans la rentabilité.
   */
  caKeptActual: number;
  personalSalesAmount: number;       // Hors activité (info only)
  cogs: number;                      // Cost of goods sold (linked stock cost)
  cogsUnlinked: number;              // Sales without linked stock (estimated)
  /**
   * P1.4 — Ventes liées à un stock SANS coût utilisable
   * (ni `stock_items.unit_cost_ttc` ni `sales.purchase_cost_total`).
   * La marge est sous-estimée pour ces ventes ; on les compte ici pour pouvoir
   * avertir l'utilisateur dans la rentabilité et le Centre de révision.
   */
  missingCostSalesCount: number;
  boostsTotal: number;
  expensesTotal: number;             // EXCLUT category='boost_marketing' pour ne pas double-compter
  expensesByCategory: { category: string; total: number }[];
  margeBrute: number;                // caKeptActual - COGS
  margeReelleEstimee: number;        // caKeptActual - COGS - boosts - expenses (non-boost)
  topProducts: { name: string; ca: number; cogs: number; margin: number }[];
  lossProducts: { name: string; ca: number; cogs: number; margin: number }[];
  byPlatform: { platform: string; ca: number; sales: number }[];
  boostsUnlinked: number;
  expensesUnlinked: number;
}

export type ReviewSeverity = 'critical' | 'important' | 'review' | 'info';
export type ReviewModule = 'sales' | 'stock' | 'purchases' | 'expenses' | 'documents' | 'urssaf';

export interface ReviewItem {
  key: string;
  module: ReviewModule;
  severity: ReviewSeverity;
  title: string;
  description: string;
  entity_type: 'sale' | 'stock_item' | 'purchase' | 'expense' | 'document' | 'declaration' | null;
  entity_id: number | null;
  route: string;
  action: 'open' | 'correct' | 'associate' | 'export' | 'review';
  created_at: string | null;
  document_id?: number | null;
  document_type?: string | null;
  document_file_name?: string | null;
  document_date?: string | null;
  document_amount?: number | null;
  associated_entity?: string | null;
  association_status?: string | null;
}

export interface ReviewCenterResult {
  total: number;
  bySeverity: Record<ReviewSeverity, number>;
  byModule: Record<ReviewModule, number>;
  items: ReviewItem[];
}

export interface SavedFilter {
  id: number;
  entity_type: string;
  name: string;
  filter_state_json: string;
  is_favorite: number;
  created_at: string;
  updated_at: string;
}

export interface GlobalSearchResult {
  type: 'sale' | 'stock_item' | 'purchase' | 'expense' | 'document' | 'declaration';
  id: number;
  title: string;
  subtitle: string;
  amount: number | null;
  date: string | null;
  badge: string | null;
  route: string;
}
