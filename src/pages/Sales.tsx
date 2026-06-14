import { useEffect, useState } from 'react';
import { notify } from '../lib/notify';
import { api } from '../lib/api';
import { eur, shortDate, todayIso } from '../lib/format';
import SaleForm from '../components/forms/SaleForm';
import AuditHistoryModal from '../components/AuditHistoryModal';
import { Modal, Field, Input } from '../components/Modal';
import { useToast, useConfirm } from '../components/Toast';
import { useLocalStorage } from '../lib/useLocalStorage';
import Pagination, { paginate, type PaginationState } from '../components/Pagination';
import EmptyState from '../components/EmptyState';
import SortControls from '../components/SortControls';
import SavedFiltersBar from '../components/SavedFiltersBar';
import { sortRows, type SortDirection, type SortValueType } from '../lib/sort';
import type { Sale, Classification } from '../../shared/types';

const CLASS_LABELS: Record<Classification, { label: string; className: string }> = {
  professional_resale: { label: 'Pro / revente', className: 'sale-type sale-type-pro' },
  personal_item: { label: 'Personnel / hors activité', className: 'sale-type sale-type-personal' },
  uncertain_to_review: { label: 'À revoir', className: 'sale-type sale-type-review' },
  excluded: { label: 'Exclue', className: 'sale-type sale-type-excluded' },
  pre_activity: { label: 'Avant début d\'activité', className: 'sale-type sale-type-pre-activity' }
};

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  completed: { label: 'Complétée', className: 'sale-status sale-status-completed' },
  colis_perdu: { label: 'Colis perdu indemnisé', className: 'sale-status sale-status-lost' },
  shipped: { label: 'En expédition', className: 'sale-status sale-status-shipped' },
  processing: { label: 'En cours', className: 'sale-status sale-status-processing' },
  pending: { label: 'En attente', className: 'sale-status sale-status-processing' },
  canceled: { label: 'Annulée', className: 'sale-status sale-status-canceled' },
  refunded: { label: 'Remboursée', className: 'sale-status sale-status-refunded' }
};

type StatusFilter = 'all' | 'completed' | 'colis_perdu' | 'shipped' | 'processing' | 'canceled' | 'refunded';
type ClassFilter = Classification | 'all';
type SalesSort = 'encashment_date' | 'sale_date' | 'article' | 'platform' | 'buyer' | 'sku' | 'status' | 'classification' | 'ca' | 'profit';

const SALES_SORT_OPTIONS: { value: SalesSort; label: string }[] = [
  { value: 'encashment_date', label: 'Date d’encaissement' },
  { value: 'sale_date', label: 'Date de vente' },
  { value: 'article', label: 'Article' },
  { value: 'platform', label: 'Plateforme' },
  { value: 'buyer', label: 'Acheteur' },
  { value: 'sku', label: 'SKU' },
  { value: 'status', label: 'Statut' },
  { value: 'classification', label: 'Type' },
  { value: 'ca', label: 'CA' },
  { value: 'profit', label: 'Bénéfice' }
];

const isRevenueStatus = (status?: string | null) => status === 'completed' || status === 'colis_perdu';

const saleProfit = (r: Sale) =>
  isRevenueStatus(r.status) &&
  (r.classification === 'professional_resale' || r.classification === 'personal_item' || r.classification === 'pre_activity')
    ? (r.amount_received ?? 0) - (r.purchase_cost_total ?? 0) - (r.vinted_fees ?? 0)
    : null;

function saleSortValue(row: Sale, sortBy: SalesSort) {
  switch (sortBy) {
    case 'encashment_date': return row.declared_encashment_date ?? row.finalization_date ?? row.sale_date;
    case 'sale_date': return row.sale_date;
    case 'article': return row.article_name;
    case 'platform': return row.platform;
    case 'buyer': return row.buyer_username;
    case 'sku': return row.sku;
    case 'status': return row.status;
    case 'classification': return row.classification;
    case 'ca': return row.classification === 'professional_resale' && isRevenueStatus(row.status) ? (row.declarable_amount ?? row.amount_received) : null;
    case 'profit': return saleProfit(row);
  }
}

const SALES_SORT_TYPES: Record<SalesSort, SortValueType> = {
  encashment_date: 'date',
  sale_date: 'date',
  article: 'string',
  platform: 'string',
  buyer: 'string',
  sku: 'string',
  status: 'string',
  classification: 'string',
  ca: 'number',
  profit: 'number'
};

export default function Sales() {
  const [rows, setRows] = useState<Sale[]>([]);
  const [search, setSearch] = useLocalStorage('sales.search', '');
  const [classFilter, setClassFilter] = useLocalStorage<ClassFilter>('sales.classFilter', 'all');
  const [statusFilter, setStatusFilter] = useLocalStorage<StatusFilter>('sales.statusFilter', 'all');
  const [platform, setPlatform] = useLocalStorage('sales.platform', '');
  const [dateFrom, setDateFrom] = useLocalStorage('sales.dateFrom', '');
  const [dateTo, setDateTo] = useLocalStorage('sales.dateTo', '');
  const [sortBy, setSortBy] = useLocalStorage<SalesSort>('sales.sortBy', 'encashment_date');
  const [sortDirection, setSortDirection] = useLocalStorage<SortDirection>('sales.sortDirection', 'desc');
  const [pag, setPag] = useLocalStorage<PaginationState>('sales.pag', { page: 0, pageSize: 50 });
  const [selected, setSelected] = useState<Sale | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [auditing, setAuditing] = useState<Sale | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [maskBuyer, setMaskBuyer] = useState(false);
  const toast = useToast();
  const confirmDialog = useConfirm();

  const load = () => {
    api.sales.list({
      search: search || undefined,
      classification: classFilter,
      status: statusFilter === 'all' ? undefined : statusFilter
    }).then((all) => {
      // Client-side platform + date filtering for flexibility
      let filtered = all;
      if (platform) filtered = filtered.filter((r) => (r.platform ?? '').toLowerCase().includes(platform.toLowerCase()));
      if (dateFrom) {
        const fromIso = new Date(dateFrom).toISOString();
        filtered = filtered.filter((r) => (r.declared_encashment_date ?? r.sale_date ?? '') >= fromIso);
      }
      if (dateTo) {
        const toIso = new Date(dateTo + 'T23:59:59.999Z').toISOString();
        filtered = filtered.filter((r) => (r.declared_encashment_date ?? r.sale_date ?? '') <= toIso);
      }
      setRows(filtered);
      setSelectedIds([]);
    });
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [classFilter, statusFilter, platform, dateFrom, dateTo]);
  useEffect(() => {
    api.security.status().then((status) => {
      setMaskBuyer(status.settings.maskBuyer || status.settings.maskUsername || status.settings.maskContact);
    }).catch(() => setMaskBuyer(false));
  }, []);

  const onDelete = async (sale: Sale) => {
    const ok = await confirmDialog({
      title: `Supprimer la vente #${sale.id} ?`,
      message: `${sale.article_name ?? ''}\n\nL'action sera enregistrée dans l'historique et pourra être annulée.`,
      danger: true
    });
    if (!ok) return;
    try {
      await api.sales.delete(sale.id);
      toast.success('Vente supprimée');
      load();
    } catch (err) {
      toast.error('Erreur', err instanceof Error ? err.message : String(err));
    }
  };

  const sortedRows = sortRows(rows, (row) => saleSortValue(row, sortBy), sortDirection, SALES_SORT_TYPES[sortBy]);
  const pagedRows = paginate(sortedRows, pag);
  const filterState = { search, classFilter, statusFilter, platform, dateFrom, dateTo, sortBy, sortDirection };
  const applySavedFilter = (state: Record<string, unknown>) => {
    setSearch(String(state.search ?? ''));
    setClassFilter((state.classFilter as ClassFilter) ?? 'all');
    setStatusFilter((state.statusFilter as StatusFilter) ?? 'all');
    setPlatform(String(state.platform ?? ''));
    setDateFrom(String(state.dateFrom ?? ''));
    setDateTo(String(state.dateTo ?? ''));
    setSortBy((state.sortBy as SalesSort) ?? 'encashment_date');
    setSortDirection((state.sortDirection as SortDirection) ?? 'desc');
  };
  const toggleSelected = (id: number) => setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const allPagedSelected = pagedRows.length > 0 && pagedRows.every((r) => selectedIds.includes(r.id));

  const bulkClassify = async (classification: Classification) => {
    const note = window.prompt('Note obligatoire pour ce changement fiscal de masse');
    if (!note?.trim()) return;
    await api.bulk.classifySales({ ids: selectedIds, classification, note });
    toast.success('Ventes mises à jour');
    load();
  };
  const bulkVerified = async () => {
    const note = window.prompt('Note de vérification');
    if (!note?.trim()) return;
    await api.bulk.markVerified({ entityType: 'sale', ids: selectedIds, note });
    toast.success('Ventes marquées comme vérifiées');
    load();
  };

  // RÈGLES:
  //   CA URSSAF      = UNIQUEMENT 'professional_resale' + statut encaissé (complétée / colis perdu indemnisé)
  //   Bénéfice net   = TOUTES ventes encaissées (pro + personnel + pre_activity)
  //                    car l'argent est entré dans la poche, même si exclu du CA
  //   EXCLU: annulées, remboursées, en expédition, à revoir (sans encaissement)
  const isInCA = (r: Sale) => r.classification === 'professional_resale' && isRevenueStatus(r.status);
  const isInProfit = (r: Sale) =>
    isRevenueStatus(r.status) &&
    (r.classification === 'professional_resale' || r.classification === 'personal_item' || r.classification === 'pre_activity');

  const totalCa = rows.filter(isInCA).reduce((s, r) => s + (r.declarable_amount ?? r.amount_received ?? 0), 0);
  const totalCogs = rows.filter(isInProfit).reduce((s, r) => s + (r.purchase_cost_total ?? 0), 0);
  const totalNet = rows.filter(isInProfit).reduce((s, r) => {
    const amt = r.amount_received ?? 0;
    return s + (amt - (r.purchase_cost_total ?? 0) - (r.vinted_fees ?? 0));
  }, 0);

  // Lifetime totals (all sales)
  const [lifetime, setLifetime] = useState<{ ca: number; net: number; count: number } | null>(null);
  useEffect(() => {
    api.sales.list({ classification: 'all' }).then((all) => {
      const inCA = all.filter((r) => r.classification === 'professional_resale' && isRevenueStatus(r.status));
      const inProfit = all.filter((r) =>
        isRevenueStatus(r.status) &&
        (r.classification === 'professional_resale' || r.classification === 'personal_item' || r.classification === 'pre_activity')
      );
      const ca = inCA.reduce((s, r) => s + (r.declarable_amount ?? r.amount_received ?? 0), 0);
      const net = inProfit.reduce((s, r) => s + ((r.amount_received ?? 0) - (r.purchase_cost_total ?? 0) - (r.vinted_fees ?? 0)), 0);
      setLifetime({ ca, net, count: all.length });
    });
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">🛍️ Ventes</h1>
        <button className="btn-primary" onClick={() => setAddOpen(true)}>+ Ajouter une vente manuelle</button>
      </div>

      {/* Lifetime totals */}
      {lifetime && (
        <div className="grid grid-cols-3 gap-3">
          <div className="card p-4 bg-emerald-50 border-emerald-200">
            <div className="text-xs uppercase text-emerald-700 font-semibold">CA URSSAF depuis toujours</div>
            <div className="text-2xl font-bold text-emerald-700 mt-1">{eur(lifetime.ca)}</div>
            <div className="text-xs text-slate-500 mt-0.5">Ventes pro encaissées</div>
          </div>
          <div className="card p-4 bg-sky-50 border-sky-200">
            <div className="text-xs uppercase text-sky-700 font-semibold">Bénéfice net estimé</div>
            <div className="text-2xl font-bold text-sky-700 mt-1">{eur(lifetime.net)}</div>
            <div className="text-xs text-slate-500 mt-0.5">Ventes encaissées − coûts</div>
          </div>
          <div className="card p-4 bg-slate-50 border-slate-200">
            <div className="text-xs uppercase text-slate-700 font-semibold">Nombre total de ventes</div>
            <div className="text-2xl font-bold text-slate-700 mt-1">{lifetime.count}</div>
          </div>
        </div>
      )}

      <div className="alert-info text-xs space-y-1">
        <div>📊 <strong>CA URSSAF</strong> : seulement ventes <strong>pro encaissées</strong> (complétées ou colis perdu indemnisé).</div>
        <div>💰 <strong>Bénéfice net</strong> : toutes les ventes <strong>encaissées</strong> — pro <strong>+ personnel</strong> <strong>+ avant début d'activité</strong> (l'argent est dans votre poche, même si exclu du CA URSSAF).</div>
        <div>❌ Les ventes <strong>annulées, remboursées ou en expédition</strong> sans indemnisation ne génèrent rien.</div>
      </div>

      {/* Filtered totals */}
      <div className="card p-3 bg-slate-100 text-sm flex justify-around">
        <div><span className="text-slate-500">CA filtré:</span> <strong>{eur(totalCa)}</strong></div>
        <div><span className="text-slate-500">Coût stock filtré:</span> <strong>{eur(totalCogs)}</strong></div>
        <div><span className="text-slate-500">Bénéfice net filtré:</span> <strong className={totalNet >= 0 ? 'text-emerald-700' : 'text-red-700'}>{eur(totalNet)}</strong></div>
        <div><span className="text-slate-500">Lignes:</span> <strong>{rows.length}</strong></div>
      </div>

      <div className="card p-3 flex flex-wrap gap-2 items-center">
        <input className="border rounded px-2 py-1 text-sm" placeholder="Recherche (article, acheteur, SKU, ID)…"
          value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        <button className="btn-secondary text-xs" onClick={load}>Filtrer</button>
        <select className="border rounded px-2 py-1 text-sm" value={classFilter} onChange={(e) => setClassFilter(e.target.value as ClassFilter)}>
          <option value="all">Tout type</option>
          <option value="professional_resale">Pro / revente</option>
          <option value="personal_item">Personnel</option>
          <option value="pre_activity">Avant début activité</option>
          <option value="uncertain_to_review">À revoir</option>
          <option value="excluded">Exclues</option>
        </select>
        <select className="border rounded px-2 py-1 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
          <option value="all">Tout statut</option>
          <option value="completed">Complétée</option>
          <option value="colis_perdu">Colis perdu indemnisé</option>
          <option value="shipped">En expédition</option>
          <option value="processing">En cours</option>
          <option value="canceled">Annulée</option>
          <option value="refunded">Remboursée</option>
        </select>
        <input className="border rounded px-2 py-1 text-sm" placeholder="Plateforme (Vinted, Vestiaire, Brocante…)"
          value={platform} onChange={(e) => setPlatform(e.target.value)} />
        <div className="flex items-center gap-1 text-sm">
          <span className="text-slate-500">Du</span>
          <input type="date" className="border rounded px-2 py-1 text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} max={todayIso()} />
          <span className="text-slate-500">au</span>
          <input type="date" className="border rounded px-2 py-1 text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} max={todayIso()} />
        </div>
        <SortControls
          value={sortBy}
          direction={sortDirection}
          options={SALES_SORT_OPTIONS}
          onValueChange={setSortBy}
          onDirectionChange={setSortDirection}
        />
      </div>

      <SavedFiltersBar entityType="sales" currentState={filterState} onApply={applySavedFilter} />

      {selectedIds.length > 0 && (
        <div className="card p-3 flex flex-wrap gap-2 items-center">
          <strong>{selectedIds.length} vente(s) sélectionnée(s)</strong>
          <button className="btn-secondary text-xs" onClick={bulkVerified}>Marquer vérifié</button>
          <button className="btn-secondary text-xs" onClick={() => bulkClassify('professional_resale')}>Classer Pro / revente</button>
          <button className="btn-secondary text-xs" onClick={() => bulkClassify('personal_item')}>Classer Personnel</button>
          <button className="btn-secondary text-xs" onClick={() => bulkClassify('uncertain_to_review')}>Classer À vérifier</button>
          <button className="btn-secondary text-xs" onClick={() => setSelectedIds([])}>Annuler sélection</button>
        </div>
      )}

      <div className="card overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 sticky top-0"><tr>
            <th className="px-2 py-2">
              <input
                type="checkbox"
                checked={allPagedSelected}
                onChange={() => setSelectedIds(allPagedSelected ? selectedIds.filter((id) => !pagedRows.some((r) => r.id === id)) : [...new Set([...selectedIds, ...pagedRows.map((r) => r.id)])])}
              />
            </th>
            <th className="px-2 py-2 text-left">Date enc.</th>
            <th className="px-2 py-2 text-left">Article</th>
            <th className="px-2 py-2 text-left">Plateforme</th>
            <th className="px-2 py-2 text-left">Acheteur</th>
            <th className="px-2 py-2 text-left">SKU</th>
            <th className="px-2 py-2 text-left">Stock</th>
            <th className="px-2 py-2 text-left">Statut</th>
            <th className="px-2 py-2 text-left">Type</th>
            <th className="px-2 py-2 text-right">CA</th>
            <th className="px-2 py-2 text-right">Bénéfice</th>
            <th className="px-2 py-2"></th>
          </tr></thead>
          <tbody>
            {pagedRows.map((r) => {
              const cls = r.classification ?? 'excluded';
              // CA: uniquement professional_resale avec encaissement.
              // Bénéfice: TOUTES ventes encaissées (pro + personnel + pre_activity), l'argent est dans la poche.
              const rowInCA = cls === 'professional_resale' && isRevenueStatus(r.status);
              const rowInProfit = isRevenueStatus(r.status) &&
                (cls === 'professional_resale' || cls === 'personal_item' || cls === 'pre_activity');
              const benefice = rowInProfit
                ? (r.amount_received ?? 0) - (r.purchase_cost_total ?? 0) - (r.vinted_fees ?? 0)
                : 0;
              return (
                <tr key={r.id} className="border-t hover:bg-slate-50">
                  <td className="px-2 py-1.5"><input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => toggleSelected(r.id)} /></td>
                  <td className="px-2 py-1.5">{shortDate(r.declared_encashment_date)}</td>
                  <td className="px-2 py-1.5 truncate max-w-[220px]">{r.article_name}</td>
                  <td className="px-2 py-1.5">{r.platform ?? '—'}</td>
                  <td className="px-2 py-1.5">{maskBuyer ? 'Acheteur masqué' : r.buyer_username}</td>
                  <td className="px-2 py-1.5 text-xs">{r.sku ?? '—'}</td>
                  <td className="px-2 py-1.5 text-xs">
                    {r.linked_stock_item_id
                      ? <span className="pill">Stock associé</span>
                      : r.sku
                        ? <span className="pill">À associer</span>
                        : '—'}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={STATUS_LABELS[r.status]?.className ?? 'sale-status sale-status-processing'}>
                      {STATUS_LABELS[r.status]?.label ?? r.status}
                    </span>
                  </td>
                  <td className="px-2 py-1.5"><span className={CLASS_LABELS[cls].className}>{CLASS_LABELS[cls].label}</span></td>
                  <td className="px-2 py-1.5 text-right font-semibold">{rowInCA ? eur(r.declarable_amount ?? r.amount_received) : '—'}</td>
                  <td className={`px-2 py-1.5 text-right ${benefice > 0 ? 'text-emerald-700' : benefice < 0 ? 'text-red-700' : 'text-slate-400'}`}>{rowInProfit ? eur(benefice) : '—'}</td>
                  <td className="px-2 py-1.5 text-right">
                    <div className="flex gap-2 justify-end">
                      <button className="text-xs text-brand-600 hover:underline" onClick={() => setSelected(r)}>Éditer</button>
                      <button className="text-xs text-emerald-700 hover:underline" onClick={() => api.pdf.facture(r.id)}>Facture</button>
                      <button className="text-xs text-slate-600 hover:underline" onClick={() => setAuditing(r)}>Historique</button>
                      <button className="text-xs text-red-700 hover:underline" onClick={() => onDelete(r)}>Supprimer</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {pagedRows.length === 0 && (
              <tr><td colSpan={12}>
                <EmptyState
                  icon="🛍️"
                  title={rows.length === 0 ? 'Aucune vente' : 'Aucun résultat avec ces filtres'}
                  description={rows.length === 0 ? 'Importez un CSV Vinted ou ajoutez une vente manuellement.' : 'Modifiez les filtres ou réinitialisez-les.'}
                  actions={rows.length === 0 ? [
                    { label: '+ Ajouter une vente manuelle', onClick: () => setAddOpen(true), primary: true },
                    { label: 'Aller à Importer', onClick: () => window.location.hash = '#/imports' }
                  ] : undefined}
                />
              </td></tr>
            )}
          </tbody>
        </table>
        {rows.length > 0 && (
          <div className="p-3 border-t bg-slate-50 flex justify-end">
            <Pagination total={rows.length} page={pag.page} pageSize={pag.pageSize} onChange={setPag} />
          </div>
        )}
      </div>

      {selected && <EditSaleModal sale={selected} onClose={() => setSelected(null)} onSaved={load} />}
      {addOpen && <SaleForm onClose={() => setAddOpen(false)} onSaved={load} />}
      {auditing && <AuditHistoryModal entityType="sale" entityId={auditing.id} title={`Historique — Vente #${auditing.id}`} onClose={() => setAuditing(null)} onReverted={load} />}
    </div>
  );
}

function EditSaleModal({ sale, onClose, onSaved }: { sale: Sale; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(sale.declared_encashment_date?.slice(0, 10) ?? '');
  const [amount, setAmount] = useState(sale.declarable_amount?.toString() ?? '');
  const [note, setNote] = useState(sale.note ?? '');
  const [forceCls, setForceCls] = useState<Classification | ''>('');
  const [overrideNote, setOverrideNote] = useState('');
  const [creating, setCreating] = useState(false);

  // P0.2 — Vente avec SKU sans stock associé : actions explicites disponibles.
  const needsStockDecision =
    !!sale.sku &&
    sale.sku.trim() !== '' &&
    !sale.linked_stock_item_id &&
    (sale.classification === 'uncertain_to_review' ||
      sale.stock_association_status === 'needs_review_no_stock');

  const onSave = async () => {
    await api.sales.update({
      id: sale.id,
      declared_encashment_date: date ? new Date(date).toISOString() : undefined,
      declarable_amount: amount ? Number(amount.replace(',', '.')) : undefined,
      note
    });
    if (forceCls) {
      if (forceCls === 'personal_item' && !overrideNote.trim()) {
        return notify('Une note est obligatoire pour reclasser en personnel.');
      }
      await api.sales.reclassify({ id: sale.id, manual: true, forcedClassification: forceCls, note: overrideNote || 'Reclassement manuel' });
    }
    onSaved(); onClose();
  };

  const onCreateStock = async () => {
    if (creating) return;
    setCreating(true);
    try {
      await api.sales.createStockFromSale(sale.id);
      notify('Stock créé à partir de la vente et association confirmée.');
      onSaved(); onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const onMarkPersonal = async () => {
    const text = overrideNote.trim() || window.prompt('Note obligatoire pour marquer comme bien personnel hors activité :') || '';
    if (!text.trim()) return notify('Note obligatoire pour marquer comme bien personnel.');
    await api.sales.reclassify({ id: sale.id, manual: true, forcedClassification: 'personal_item', note: text });
    notify('Vente marquée comme bien personnel hors activité.');
    onSaved(); onClose();
  };

  return (
    <Modal title={`Éditer vente #${sale.id}`} onClose={onClose}>
      <div className="text-sm text-slate-600 mb-3 truncate">{sale.article_name}</div>

      {needsStockDecision && (
        <div className="card p-3 mb-3 bg-amber-50 border-amber-200" data-testid="sku-no-stock-actions">
          <div className="font-semibold text-amber-900 text-sm">
            SKU détecté sans stock associé
          </div>
          <div className="text-xs text-amber-800 mt-1 mb-2">
            Cette vente n'est PAS déclarable tant que vous n'avez pas confirmé son origine.
            Choisissez une action explicite :
          </div>
          <div className="flex gap-2 flex-wrap">
            <button className="btn-primary text-xs" onClick={onCreateStock} disabled={creating}>
              Créer un stock à partir de cette vente
            </button>
            <button className="btn-secondary text-xs" onClick={onMarkPersonal}>
              Marquer comme bien personnel / hors activité
            </button>
          </div>
        </div>
      )}

      <Field label="Date d'encaissement"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Montant déclarable (€)"><Input value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <Field label="Reclasser (optionnel)">
        <select className="w-full border rounded px-2 py-1" value={forceCls} onChange={(e) => setForceCls(e.target.value as Classification | '')}>
          <option value="">Pas de changement</option>
          <option value="professional_resale">→ Pro / revente</option>
          <option value="personal_item">→ Personnel / hors activité (note requise)</option>
          <option value="uncertain_to_review">→ À revoir</option>
        </select>
      </Field>
      {forceCls === 'personal_item' && (
        <Field label="Note obligatoire"><Input value={overrideNote} onChange={(e) => setOverrideNote(e.target.value)} /></Field>
      )}
      <div className="flex justify-end gap-2 mt-3">
        <button className="btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={onSave}>Enregistrer</button>
      </div>
    </Modal>
  );
}
