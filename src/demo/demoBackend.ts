/**
 * Mode démonstration web (Vercel / navigateur).
 *
 * Revendo est une application desktop Electron : en temps normal, le front
 * communique avec le backend via `window.revendo.invoke(...)` (IPC -> SQLite).
 * Sur le web, ce pont n'existe pas. Ce module installe un `window.revendo`
 * factice qui répond avec des **données fictives en mémoire**, afin de proposer
 * une démo cliquable des écrans principaux (Tableau de bord, Stock, Ventes,
 * Dépenses, Rentabilité).
 *
 * ⚠️ Aucune donnée réelle. Aucune écriture disque. Les actions d'écriture sont
 * neutralisées (retour factice). Voir README -> « Démo web ».
 */
import { IPC } from '../../shared/ipc';
import { demoData } from './demoData';

type AnyPayload = unknown;
type Handler = (payload?: AnyPayload) => unknown;

const YEAR = new Date().getFullYear();
const nowIso = new Date().toISOString();

const responders: Record<string, Handler> = {
  [IPC.APP_VERSION]: () => '0.1.0-demo',
  [IPC.WIZARD_NEEDED]: () => ({ needed: false }),
  [IPC.SETTINGS_GET]: () => demoData.settings,
  [IPC.SYNC_OVERVIEW]: () => ({ configured: false, localOnly: true, pendingChanges: 0, lastModifiedAt: null, conflicts: 0 }),

  [IPC.SEUILS_STATUS]: () => demoData.seuils,
  [IPC.REMINDERS_LIST]: () => demoData.reminders,
  [IPC.RATES_LIST]: () => demoData.rates,
  [IPC.RATES_VERIFICATION_STATUS]: () => ({
    needsVerification: false, currentYear: YEAR, lastVerifiedYear: YEAR,
    lastVerifiedAt: nowIso, ratesPresent: true, reason: 'up_to_date'
  }),

  [IPC.DASHBOARD_OVERVIEW]: () => demoData.dashboardOverview,
  [IPC.DASHBOARD_FIGURES]: () => demoData.dashboardFigures,

  [IPC.STOCK_LIST]: () => demoData.stock,
  [IPC.STOCK_OVERVIEW]: () => demoData.stockOverview,

  [IPC.SALES_LIST]: () => demoData.sales,
  [IPC.EXPENSES_LIST]: () => demoData.expenses,
  [IPC.EXPENSES_OVERVIEW]: () => demoData.expensesOverview,
  [IPC.PROFIT_SUMMARY]: () => demoData.profit,

  [IPC.ANALYTICS_TRENDS]: () => demoData.trends,
  [IPC.ANALYTICS_TOP_BUYERS]: () => [],
  [IPC.ANALYTICS_STALE_STOCK]: () => [],
  [IPC.ANALYTICS_PREDICTION]: () => demoData.prediction,

  [IPC.MARKETPLACES_LIST]: () => demoData.marketplaces,
  [IPC.SUPPLIERS_LIST]: () => [],
  [IPC.CHANNELS_LIST]: () => [],
  [IPC.SAVED_FILTERS_LIST]: () => [],
  [IPC.REVIEW_SUMMARY]: () => ({
    total: 0,
    bySeverity: { critical: 0, important: 0, review: 0, info: 0 },
    byModule: { sales: 0, stock: 0, purchases: 0, expenses: 0, documents: 0, urssaf: 0 },
    items: []
  }),
  [IPC.SECURITY_STATUS]: () => demoData.securityStatus,
  [IPC.CLOUD_STATUS]: () => demoData.cloudStatus,

  [IPC.PURCHASES_LIST]: () => [],
  [IPC.BOOSTS_LIST]: () => [],
  [IPC.DOCS_LIST]: () => [],
  [IPC.CFE_LIST]: () => [],
  [IPC.DIARY_LIST]: () => [],
  [IPC.BANK_TX_LIST]: () => [],
  [IPC.AUDIT_RECENT]: () => [],
  [IPC.IMPORTS_LIST]: () => [],
  [IPC.MOBILE_LIST_ACTION_IMPORTS]: () => [],
  [IPC.GLOBAL_SEARCH]: () => [],

  [IPC.DECLARATIONS_LIST_PERIODS]: () => demoData.declarationPeriods,
  [IPC.DECLARATIONS_SUMMARY]: (payload) => {
    const q = (payload as { quarter?: number } | undefined)?.quarter;
    return typeof q === 'number' ? demoData.quarterSummary(q) : demoData.declarationSummary;
  },
  [IPC.DECLARATIONS_FIRST_DECLARATION]: () => null
};

/** Réponse par défaut, neutre, pour tout canal non explicitement géré. */
function fallback(channel: string): unknown {
  if (channel.endsWith(':list') || channel.includes('List')) return [];
  if (channel.includes('pick') || channel.includes('Pick') || channel.includes('export') || channel.includes('Export')) {
    return { canceled: true };
  }
  if (channel.includes('overview') || channel.includes('status') || channel.includes('summary') || channel.includes('Status')) {
    return {};
  }
  // create/update/delete/mark... : succès factice neutre (aucune écriture).
  return { ok: true, demo: true };
}

export function installDemoBackend(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { revendo?: unknown };
  if (w.revendo) return; // vrai backend Electron présent : ne rien faire.

  w.revendo = {
    channels: IPC,
    on: () => () => {},
    invoke: (channel: string, payload?: AnyPayload) => {
      const handler = responders[channel];
      const value = handler ? handler(payload) : fallback(channel);
      return Promise.resolve(value);
    }
  };

  // eslint-disable-next-line no-console
  console.info('[Revendo] Mode démonstration web actif — données fictives uniquement.');
}
