/**
 * Données FICTIVES pour le mode démonstration web.
 * Aucune correspondance avec une activité réelle. Voir demoBackend.ts.
 */
const YEAR = new Date().getFullYear();
const d = (m: number, day: number) => `${YEAR}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const ts = (m: number, day: number) => `${d(m, day)}T10:00:00.000Z`;

// --- Stock fictif ---
const saleDefaults = {
  source: 'demo', external_id: null, import_id: null, finalization_date: null,
  declared_encashment_date: null, sale_account: null, is_pro_account: 1,
  brand: null, size: null, color: null, buyer_name: null, buyer_email: null,
  buyer_address: null, buyer_country: 'FR', sale_price_ht: null, vat_amount: null,
  vinted_fees: null, purchase_cost_total: null, ancillary_costs: null,
  refunded_amount: null, vat_rate: null, carrier: null, tracking_number: null,
  note: null, is_declarable: 1, declarable_amount: null, exclusion_reason: null,
  classification_reason: 'Vente professionnelle (article acheté pour revente).',
  manual_override: 0, override_note: null, linked_purchase_id: null,
  declared_period: null, created_at: ts(1, 5), updated_at: ts(1, 6)
};

function mkSale(p: Record<string, unknown>) {
  return { ...saleDefaults, ...p };
}

const sales = [
  mkSale({ id: 1, article_name: 'Sneakers Exemple A', platform: 'Vinted', sale_date: d(1, 12), status: 'completed', quantity: 1, sku: 'SNK-A-01', sale_price_ttc: 59.0, amount_received: 52.4, shipping_cost_ttc: 4.9, buyer_username: 'acheteur_demo_1', classification: 'professional_resale', urssaf_declarable: 1, linked_stock_item_id: 1 }),
  mkSale({ id: 2, article_name: 'Veste en jean Exemple B', platform: 'Vinted', sale_date: d(2, 3), status: 'completed', quantity: 1, sku: 'VST-B-02', sale_price_ttc: 34.0, amount_received: 30.1, shipping_cost_ttc: 4.9, buyer_username: 'acheteur_demo_2', classification: 'professional_resale', urssaf_declarable: 1, linked_stock_item_id: 2 }),
  mkSale({ id: 3, article_name: 'Sac à main Exemple C', platform: 'LeBonCoin', sale_date: d(2, 18), status: 'completed', quantity: 1, sku: 'SAC-C-03', sale_price_ttc: 75.0, amount_received: 75.0, shipping_cost_ttc: 0, buyer_username: 'acheteur_demo_3', classification: 'professional_resale', urssaf_declarable: 1, linked_stock_item_id: 3 }),
  mkSale({ id: 4, article_name: 'Montre Exemple D', platform: 'WhatNot', sale_date: d(3, 2), status: 'completed', quantity: 1, sku: 'MNT-D-04', sale_price_ttc: 120.0, amount_received: 108.5, shipping_cost_ttc: 6.5, buyer_username: 'acheteur_demo_4', classification: 'professional_resale', urssaf_declarable: 1 }),
  mkSale({ id: 5, article_name: 'Casquette Exemple E', platform: 'Vinted', sale_date: d(3, 20), status: 'completed', quantity: 2, sku: 'CAP-E-05', sale_price_ttc: 18.0, amount_received: 15.2, shipping_cost_ttc: 2.5, buyer_username: 'acheteur_demo_5', classification: 'professional_resale', urssaf_declarable: 1 }),
  mkSale({ id: 6, article_name: 'Pull personnel Exemple F', platform: 'Vinted', sale_date: d(3, 25), status: 'completed', quantity: 1, sku: null, sale_price_ttc: 12.0, amount_received: 10.0, shipping_cost_ttc: 2.0, buyer_username: 'acheteur_demo_6', classification: 'personal_item', urssaf_declarable: 0, classification_reason: 'Bien personnel hors activité (aucun achat/stock associé).' })
];

const stockDefaults = {
  product_id: null, source: 'demo', purchase_id: null, supplier: null,
  brand: null, size: null, color: null, purchase_date: null, received_date: null,
  notes: null, created_at: ts(1, 2), updated_at: ts(1, 3)
};

function mkStock(p: Record<string, unknown>) {
  return { ...stockDefaults, ...p };
}

const stock = [
  mkStock({ id: 1, internal_code: 'STK-0001', sku: 'SNK-A-01', name: 'Sneakers Exemple A', platform: 'Vinted', status: 'sold_completed', quantity: 0, unit_cost_ttc: 22.0, total_cost_ttc: 22.0, estimated_sale_price: 60.0, location: 'Bac 1' }),
  mkStock({ id: 2, internal_code: 'STK-0002', sku: 'VST-B-02', name: 'Veste en jean Exemple B', platform: 'Vinted', status: 'sold_completed', quantity: 0, unit_cost_ttc: 12.0, total_cost_ttc: 12.0, estimated_sale_price: 35.0, location: 'Bac 1' }),
  mkStock({ id: 3, internal_code: 'STK-0003', sku: 'SAC-C-03', name: 'Sac à main Exemple C', platform: 'LeBonCoin', status: 'sold_completed', quantity: 0, unit_cost_ttc: 30.0, total_cost_ttc: 30.0, estimated_sale_price: 80.0, location: 'Bac 2' }),
  mkStock({ id: 4, internal_code: 'STK-0004', sku: 'MNT-D-06', name: 'Montre Exemple G', platform: 'WhatNot', status: 'listed', quantity: 1, unit_cost_ttc: 45.0, total_cost_ttc: 45.0, estimated_sale_price: 130.0, location: 'Bac 2' }),
  mkStock({ id: 5, internal_code: 'STK-0005', sku: 'CAP-E-07', name: 'Casquette Exemple H', platform: 'Vinted', status: 'in_stock', quantity: 4, unit_cost_ttc: 5.0, total_cost_ttc: 20.0, estimated_sale_price: 14.0, location: 'Bac 3' }),
  mkStock({ id: 6, internal_code: 'STK-0006', sku: 'MNT-D-08', name: 'Manteau Exemple I', platform: 'Vinted', status: 'reserved', quantity: 1, unit_cost_ttc: 28.0, total_cost_ttc: 28.0, estimated_sale_price: 75.0, location: 'Bac 3' })
];

const expenseDefaults = {
  source: 'demo', amount_ht: null, vat_amount: null, vat_deductible: 0,
  payment_method: 'carte', linked_product_id: null, linked_sale_id: null,
  linked_purchase_id: null, linked_boost_id: null, linked_stock_item_id: null,
  notes: null, created_at: ts(1, 2), updated_at: ts(1, 2)
};

function mkExpense(p: Record<string, unknown>) {
  return { ...expenseDefaults, ...p };
}

const expenses = [
  mkExpense({ id: 1, date: d(1, 8), category: 'emballages', supplier: 'Fournisseur Démo', platform: null, description: 'Pochettes et cartons', amount_ttc: 18.9 }),
  mkExpense({ id: 2, date: d(2, 2), category: 'frais_port', supplier: 'Transporteur Démo', platform: null, description: 'Affranchissements', amount_ttc: 24.5 }),
  mkExpense({ id: 3, date: d(2, 15), category: 'boost_marketing', supplier: 'Vinted', platform: 'Vinted', description: 'Mise en avant articles', amount_ttc: 12.0 }),
  mkExpense({ id: 4, date: d(3, 1), category: 'sacs_expedition', supplier: 'Fournisseur Démo', platform: null, description: 'Sacs d’expédition', amount_ttc: 9.9 }),
  mkExpense({ id: 5, date: d(3, 12), category: 'abonnement_logiciel', supplier: 'Outil Démo', platform: null, description: 'Abonnement mensuel', amount_ttc: 8.0 })
];

const QUARTER_BOUNDS: Record<number, { start: [number, number]; end: [number, number]; due: [number, number] }> = {
  1: { start: [1, 1], end: [3, 31], due: [4, 30] },
  2: { start: [4, 1], end: [6, 30], due: [7, 31] },
  3: { start: [7, 1], end: [9, 30], due: [10, 31] },
  4: { start: [10, 1], end: [12, 31], due: [1, 31] }
};

function mkQuarter(q: 1 | 2 | 3 | 4, ca: number) {
  const b = QUARTER_BOUNDS[q];
  const contrib = Math.round(ca * 0.062 * 100) / 100;
  return {
    year: YEAR, quarter: q, periodStart: d(b.start[0], b.start[1]), periodEnd: d(b.end[0], b.end[1]),
    dueDate: d(b.due[0], b.due[1]), rawPeriodStart: d(b.start[0], b.start[1]), rawDueDate: d(b.due[0], b.due[1]),
    caGoods: ca, includedSalesCount: ca > 0 ? 5 : 0, excludedSalesCount: 0,
    personalSalesCount: ca > 0 ? 1 : 0, personalSalesAmount: ca > 0 ? 12.0 : 0,
    uncertainSalesCount: 0, canceledSalesCount: 0, preActivitySalesCount: 0, preActivitySalesAmount: 0,
    contributionsNormal: Math.round(ca * 0.123 * 100) / 100, contributionsAcre: contrib, contributionsApplied: contrib,
    acreApplied: ca > 0, acreFullPeriod: ca > 0, rateNormal: 0.123, rateAcre: 0.062,
    activityStartDate: d(1, 1), isFirstDeclaration: q === 1, isInsideFirstDeclaration: false,
    firstDeclarationLabel: null, status: 'draft'
  };
}

const declarationSummary = mkQuarter(1, 308.0);
const declarationPeriods = [mkQuarter(1, 308.0), mkQuarter(2, 0), mkQuarter(3, 0), mkQuarter(4, 0)];

export const demoData = {
  settings: {
    company_name: 'Revendo Démo', commercial_name: 'Boutique Démo',
    activity_type: 'vente_marchandises_bic', urssaf_periodicity: 'trimestrial',
    activity_start_date: d(1, 1), acre_enabled: true, vat_regime: 'franchise_en_base',
    default_currency: 'EUR', versement_liberatoire: false
  },
  seuils: {
    year: YEAR, caUrssaf: 18450, seuilMarchandises: 188700, seuilTvaFranchise: 85000,
    marchandisesPct: 9.8, tvaPct: 21.7, warningAt: 80, dangerAt: 95,
    level: 'ok', message: 'Sous les seuils — marge confortable.'
  },
  reminders: [
    { key: 'demo-mode', level: 'info', title: 'Mode démonstration', body: 'Toutes les données affichées sont fictives et ne correspondent à aucune activité réelle.' }
  ],
  rates: [
    { id: 1, year: YEAR, activity_type: 'vente_marchandises_bic', normal_rate: 0.123, acre_rate: 0.062, versement_liberatoire_rate: 0.01, notes: 'Démo', created_at: ts(1, 1), updated_at: ts(1, 1) }
  ],
  dashboardOverview: {
    year: YEAR,
    quarters: [declarationSummary],
    sales: { pro: 5, personal: 1, uncertain: 0, excluded: 0, total: 6 },
    stock: { in_stock: 4, listed: 1, reserved: 1, sold_completed: 3 },
    expensesMonth: 17.9, boostsMonth: 12.0, nextDue: null
  },
  dashboardFigures: {
    range: 'all_time', caTotal: 318.0, profitNet: 169.6,
    salesCompleted: 6, packagesInTransit: 1, cancellations: 0,
    lastCheckedSales: null, lastCheckedPurchases: null, lastCheckedExpenses: null,
    daysSinceSales: null, daysSincePurchases: null, daysSinceExpenses: null
  },
  stock,
  stockOverview: {
    counts: { in_stock: 4, listed: 1, reserved: 1, sold_completed: 3 },
    totals: { in_stock: 40.0, listed: 45.0, reserved: 28.0 }
  },
  sales,
  expenses,
  expensesOverview: {
    year: YEAR,
    monthly: [
      { month: d(1, 1).slice(0, 7), total: 18.9 },
      { month: d(2, 1).slice(0, 7), total: 36.5 },
      { month: d(3, 1).slice(0, 7), total: 17.9 }
    ],
    quarterly: [{ quarter: 1, total: 73.3 }, { quarter: 2, total: 0 }, { quarter: 3, total: 0 }, { quarter: 4, total: 0 }],
    byCategory: [
      { category: 'frais_port', total: 24.5 },
      { category: 'emballages', total: 18.9 },
      { category: 'boost_marketing', total: 12.0 },
      { category: 'sacs_expedition', total: 9.9 },
      { category: 'abonnement_logiciel', total: 8.0 }
    ],
    alerts: {}
  },
  profit: {
    periodLabel: `Année ${YEAR}`, caUrssaf: 296.0, caProfessionalAllSales: 306.0,
    caKeptActual: 311.6, personalSalesAmount: 12.0, cogs: 89.0, cogsUnlinked: 18.0,
    missingCostSalesCount: 1, boostsTotal: 12.0, expensesTotal: 61.3,
    expensesByCategory: [
      { category: 'frais_port', total: 24.5 },
      { category: 'emballages', total: 18.9 },
      { category: 'sacs_expedition', total: 9.9 },
      { category: 'abonnement_logiciel', total: 8.0 }
    ],
    margeBrute: 222.6, margeReelleEstimee: 149.3,
    topProducts: [
      { name: 'Montre Exemple D', ca: 108.5, cogs: 45.0, margin: 63.5 },
      { name: 'Sac à main Exemple C', ca: 75.0, cogs: 30.0, margin: 45.0 },
      { name: 'Sneakers Exemple A', ca: 52.4, cogs: 22.0, margin: 30.4 }
    ],
    lossProducts: [],
    byPlatform: [
      { platform: 'Vinted', ca: 92.8, sales: 4 },
      { platform: 'WhatNot', ca: 108.5, sales: 1 },
      { platform: 'LeBonCoin', ca: 75.0, sales: 1 }
    ],
    boostsUnlinked: 0, expensesUnlinked: 0
  },
  trends: [
    { month: d(1, 1).slice(0, 7), caUrssaf: 93.0, amountReceived: 82.5, salesCount: 1, expenses: 18.9 },
    { month: d(2, 1).slice(0, 7), caUrssaf: 109.0, amountReceived: 105.1, salesCount: 2, expenses: 36.5 },
    { month: d(3, 1).slice(0, 7), caUrssaf: 106.0, amountReceived: 123.7, salesCount: 3, expenses: 17.9 }
  ],
  prediction: null,
  marketplaces: [
    { id: 1, slug: 'vinted', name: 'Vinted', type: 'marketplace', website: 'https://www.vinted.fr', is_active: 1, default_currency: 'EUR', notes: null, created_at: ts(1, 1), updated_at: ts(1, 1) },
    { id: 2, slug: 'whatnot', name: 'WhatNot', type: 'marketplace', website: 'https://www.whatnot.com', is_active: 1, default_currency: 'EUR', notes: null, created_at: ts(1, 1), updated_at: ts(1, 1) },
    { id: 3, slug: 'leboncoin', name: 'LeBonCoin', type: 'marketplace', website: 'https://www.leboncoin.fr', is_active: 1, default_currency: 'EUR', notes: null, created_at: ts(1, 1), updated_at: ts(1, 1) }
  ],
  securityStatus: {
    appVersion: '0.1.0-demo', localOnly: true, serverSync: false,
    notice: 'Démo web — données fictives, aucune écriture disque.',
    paths: { dataDir: '(démo)', dbPath: '(démo)', documentsDir: '(démo)', backupsDir: '(démo)', exportsDir: '(démo)', snapshotsDir: '(démo)', tempDir: '(démo)' },
    sizes: { databaseBytes: 0, documentsBytes: 0, backupsBytes: 0, exportsBytes: 0 },
    latestBackup: null,
    settings: {
      backupEncryptionEnabled: false, exportEncryptionEnabled: false, snapshotEncryptionEnabled: false,
      mobileSnapshotProtected: false, maskBuyer: true, maskContact: true, maskUsername: false,
      anonymizedExports: true, mobileRedaction: true
    },
    sync: { configured: false, localOnly: true, pendingChanges: 0, lastModifiedAt: null, conflicts: 0 }
  },
  cloudStatus: {
    enabled: false, folder: null, providerHint: null, keepVersions: 5,
    lastRun: null, lastStatus: null, lastError: null, folderExists: false,
    detectedFolders: [], includeDocuments: false, includeMobile: false,
    documentsLastSync: null, documentsFilesSynced: 0, mobileLastGen: null
  },
  declarationPeriods,
  declarationSummary,
  quarterSummary: (q: number) => declarationPeriods.find((p) => p.quarter === q) ?? declarationSummary
};
