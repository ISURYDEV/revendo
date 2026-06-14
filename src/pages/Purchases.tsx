import { useEffect, useState } from 'react';
import { notify } from '../lib/notify';
import { api } from '../lib/api';
import { eur, shortDate, todayIso } from '../lib/format';
import PurchaseForm from '../components/forms/PurchaseForm';
import GenericEditForm from '../components/forms/GenericEditForm';
import AuditHistoryModal from '../components/AuditHistoryModal';
import { useToast, useConfirm } from '../components/Toast';
import { useLocalStorage } from '../lib/useLocalStorage';
import Pagination, { paginate, type PaginationState } from '../components/Pagination';
import EmptyState from '../components/EmptyState';
import SortControls from '../components/SortControls';
import SavedFiltersBar from '../components/SavedFiltersBar';
import { sortRows, type SortDirection, type SortValueType } from '../lib/sort';
import type { Document } from '../../shared/types';

interface PurchaseRow {
  id: number;
  source: string;
  external_id: string | null;
  payment_date: string | null;
  seller: string | null;
  platform: string | null;
  articles: string | null;
  quantity: number | null;
  total_ttc: number | null;
  items_price: number | null;
  shipping_fee: number | null;
  status: string | null;
}

type PurchasesSort = 'payment_date' | 'platform' | 'seller' | 'articles' | 'quantity' | 'total_ttc' | 'without_doc';

const PURCHASE_SORT_OPTIONS: { value: PurchasesSort; label: string }[] = [
  { value: 'payment_date', label: 'Date d’achat' },
  { value: 'platform', label: 'Plateforme' },
  { value: 'seller', label: 'Vendeur' },
  { value: 'articles', label: 'Article' },
  { value: 'quantity', label: 'Quantité' },
  { value: 'total_ttc', label: 'Montant TTC' },
  { value: 'without_doc', label: 'Sans justificatif d’abord' }
];

const PURCHASE_SORT_TYPES: Record<PurchasesSort, SortValueType> = {
  payment_date: 'date',
  platform: 'string',
  seller: 'string',
  articles: 'string',
  quantity: 'number',
  total_ttc: 'number',
  without_doc: 'number'
};

export default function Purchases() {
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [docsByPurchase, setDocsByPurchase] = useState<Record<number, Document[]>>({});
  const [search, setSearch] = useLocalStorage('purchases.search', '');
  const [platform, setPlatform] = useLocalStorage('purchases.platform', '');
  const [dateFrom, setDateFrom] = useLocalStorage('purchases.dateFrom', '');
  const [dateTo, setDateTo] = useLocalStorage('purchases.dateTo', '');
  const [sortBy, setSortBy] = useLocalStorage<PurchasesSort>('purchases.sortBy', 'payment_date');
  const [sortDirection, setSortDirection] = useLocalStorage<SortDirection>('purchases.sortDirection', 'desc');
  const [pag, setPag] = useLocalStorage<PaginationState>('purchases.pag', { page: 0, pageSize: 50 });
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<PurchaseRow | null>(null);
  const [auditing, setAuditing] = useState<PurchaseRow | null>(null);
  const [busyBulk, setBusyBulk] = useState(false);
  const toast = useToast();
  const confirmDialog = useConfirm();

  const load = async () => {
    const all = (await api.purchases.list()) as unknown as PurchaseRow[];
    let filtered = all;
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((r) =>
        (r.seller ?? '').toLowerCase().includes(q) ||
        (r.articles ?? '').toLowerCase().includes(q) ||
        (r.external_id ?? '').toLowerCase().includes(q)
      );
    }
    if (platform) filtered = filtered.filter((r) => (r.platform ?? r.source ?? '').toLowerCase().includes(platform.toLowerCase()));
    if (dateFrom) filtered = filtered.filter((r) => (r.payment_date ?? '') >= dateFrom);
    if (dateTo) filtered = filtered.filter((r) => (r.payment_date ?? '') <= dateTo + 'T23:59:59.999Z');
    setRows(filtered);

    // Bulk fetch: ONE IPC call instead of N
    const bulk = await api.docsBulk.linksFor('purchase', filtered.map((p) => p.id));
    setDocsByPurchase(bulk as unknown as Record<number, Document[]>);
  };

  const sortedRows = sortRows(rows, (row) => {
    if (sortBy === 'without_doc') return (docsByPurchase[row.id]?.length ?? 0) === 0 ? 0 : 1;
    return row[sortBy];
  }, sortBy === 'without_doc' ? 'asc' : sortDirection, PURCHASE_SORT_TYPES[sortBy]);
  const pagedRows = paginate(sortedRows, pag);
  const filterState = { search, platform, dateFrom, dateTo, sortBy, sortDirection };
  const applySavedFilter = (state: Record<string, unknown>) => {
    setSearch(String(state.search ?? ''));
    setPlatform(String(state.platform ?? ''));
    setDateFrom(String(state.dateFrom ?? ''));
    setDateTo(String(state.dateTo ?? ''));
    setSortBy((state.sortBy as PurchasesSort) ?? 'payment_date');
    setSortDirection((state.sortDirection as SortDirection) ?? 'desc');
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [platform, dateFrom, dateTo]);

  const total = rows.reduce((s, r) => s + (r.total_ttc ?? 0), 0);
  const withoutDocCount = rows.filter((r) => (docsByPurchase[r.id]?.length ?? 0) === 0).length;

  const onDelete = async (row: PurchaseRow) => {
    const ok = await confirmDialog({
      title: `Supprimer l'achat #${row.id} ?`,
      message: `${row.articles ?? ''}\n\nEnregistré dans l'historique — vous pourrez revenir en arrière.`,
      danger: true
    });
    if (!ok) return;
    try { await api.purchases.delete(row.id); toast.success('Achat supprimé'); load(); }
    catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('stock')) {
        const cascade = await confirmDialog({ title: 'Stock associé détecté', message: `${msg}\n\nSupprimer en cascade le stock associé ?`, danger: true });
        if (cascade) {
          try { await api.purchases.delete(row.id, true); toast.success('Achat + stock supprimés'); load(); }
          catch (e) { toast.error('Erreur', e instanceof Error ? e.message : String(e)); }
        }
      } else { toast.error('Erreur', msg); }
    }
  };

  const onAttach = async (row: PurchaseRow) => {
    const paths = await api.docs.pickFiles();
    if (!paths || paths.length === 0) return;
    const results = await api.docs.addFromPaths(paths, 'facture_achat');
    for (const r of results) {
      if (r.ok && r.id) await api.docs.link({ document_id: r.id, entity_type: 'purchase', entity_id: row.id });
    }
    load();
  };

  const onBulk = async () => {
    if (!confirm('Générer un PDF justificatif pour TOUS les achats sans document. Peut prendre plusieurs minutes.')) return;
    setBusyBulk(true);
    try {
      const r = await api.pdf.justificatifsBulk();
      notify(`${r.generated} justificatif(s) générés.${r.errors.length > 0 ? ` ${r.errors.length} erreurs.` : ''}`);
      load();
    } finally { setBusyBulk(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Justificatifs d'achats</h1>
        <button className="btn-primary" onClick={() => setAddOpen(true)}>+ Ajouter un achat manuel</button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="card p-3"><div className="text-xs uppercase text-slate-500">Nombre d'achats</div><div className="text-2xl font-bold text-slate-700">{rows.length}</div></div>
        <div className="card p-3"><div className="text-xs uppercase text-slate-500">Total des achats</div><div className="text-2xl font-bold text-amber-700">{eur(total)}</div></div>
        <div className="card p-3"><div className="text-xs uppercase text-slate-500">Sans justificatif PDF</div><div className="text-2xl font-bold text-red-700">{withoutDocCount}</div></div>
      </div>

      <div className="alert-info text-sm">
        Vos achats avec leurs justificatifs. En cas de contrôle fiscal, chaque ligne doit pouvoir montrer la
        provenance du stock. Vinted/WhatNot/AliExpress n'émettent pas toujours une facture; l'app reconstitue
        un justificatif PDF officiel à partir des données de la plateforme.
      </div>

      {withoutDocCount > 0 && (
        <div className="alert-warn text-sm flex justify-between items-center">
          <span><strong>{withoutDocCount}</strong> achat(s) sans justificatif.</span>
          <button className="btn-primary text-xs" onClick={onBulk} disabled={busyBulk}>
            {busyBulk ? 'Génération…' : `Générer PDF pour les ${withoutDocCount}`}
          </button>
        </div>
      )}

      <div className="card p-3 flex flex-wrap gap-2 items-center">
        <input className="border rounded px-2 py-1 text-sm" placeholder="Recherche (vendeur, articles, ID)…"
          value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        <button className="btn-secondary text-xs" onClick={load}>Filtrer</button>
        <input className="border rounded px-2 py-1 text-sm" placeholder="Plateforme (Vinted/WhatNot/AliExpress…)"
          value={platform} onChange={(e) => setPlatform(e.target.value)} />
        <div className="flex items-center gap-1 text-sm">
          <span className="text-slate-500">Du</span>
          <input type="date" className="border rounded px-2 py-1 text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} max={todayIso()} />
          <span className="text-slate-500">au</span>
          <input type="date" className="border rounded px-2 py-1 text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} max={todayIso()} />
        </div>
        <SortControls
          value={sortBy}
          direction={sortBy === 'without_doc' ? 'asc' : sortDirection}
          options={PURCHASE_SORT_OPTIONS}
          onValueChange={setSortBy}
          onDirectionChange={setSortDirection}
        />
      </div>

      <SavedFiltersBar entityType="purchases" currentState={filterState} onApply={applySavedFilter} />

      <div className="card overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100"><tr>
            <th className="px-2 py-2 text-left">Date</th>
            <th className="px-2 py-2 text-left">Plateforme</th>
            <th className="px-2 py-2 text-left">Vendeur</th>
            <th className="px-2 py-2 text-left">Articles</th>
            <th className="px-2 py-2 text-right">Qté</th>
            <th className="px-2 py-2 text-right">Total TTC</th>
            <th className="px-2 py-2 text-left">Justificatif</th>
            <th className="px-2 py-2"></th>
          </tr></thead>
          <tbody>
            {pagedRows.map((r) => {
              const docs = docsByPurchase[r.id] ?? [];
              return (
                <tr key={r.id} className="border-t hover:bg-slate-50">
                  <td className="px-2 py-1.5">{shortDate(r.payment_date)}</td>
                  <td className="px-2 py-1.5">{r.platform ?? '—'}<div className="text-xs text-slate-400">{r.source}</div></td>
                  <td className="px-2 py-1.5">{r.seller ?? '—'}</td>
                  <td className="px-2 py-1.5 truncate max-w-[260px]" title={r.articles ?? ''}>{r.articles}</td>
                  <td className="px-2 py-1.5 text-right">{r.quantity}</td>
                  <td className="px-2 py-1.5 text-right font-semibold">{eur(r.total_ttc)}</td>
                  <td className="px-2 py-1.5">
                    {docs.length === 0 ? (
                      <span className="pill bg-amber-100 text-amber-800">Sans justificatif</span>
                    ) : (
                      <div className="flex gap-1 flex-wrap">
                        {docs.map((d) => (
                          <button key={d.id} className="pill bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                            title={d.original_file_name} onClick={() => api.docs.open(d.id)}>📎 PDF</button>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <div className="flex gap-1 justify-end flex-wrap">
                      {docs.length === 0 && (
                        <button className="text-xs text-emerald-700 hover:underline" onClick={() => api.pdf.justificatifAchat(r.id)}>📄 Générer</button>
                      )}
                      <button className="text-xs text-sky-700 hover:underline" onClick={() => onAttach(r)}>📎 Joindre</button>
                      <button className="text-xs text-brand-600 hover:underline" onClick={() => setEditing(r)}>Éditer</button>
                      <button className="text-xs text-slate-600 hover:underline" onClick={() => setAuditing(r)}>Historique</button>
                      <button className="text-xs text-red-700 hover:underline" onClick={() => onDelete(r)}>Supprimer</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {pagedRows.length === 0 && (
              <tr><td colSpan={8}>
                <EmptyState
                  icon="🧾"
                  title={rows.length === 0 ? 'Aucun justificatif d\'achat' : 'Aucun résultat avec ces filtres'}
                  description={rows.length === 0 ? 'Importez les CSV Vinted/WhatNot ou ajoutez un achat manuellement.' : 'Modifiez les filtres pour voir plus de résultats.'}
                  actions={rows.length === 0 ? [
                    { label: '+ Ajouter un achat manuel', onClick: () => setAddOpen(true), primary: true },
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

      {addOpen && <PurchaseForm onClose={() => setAddOpen(false)} onSaved={load} />}
      {editing && (
        <GenericEditForm
          title={`Éditer achat #${editing.id}`}
          initial={editing as unknown as Record<string, unknown>}
          fields={[
            { key: 'payment_date', label: 'Date de paiement', type: 'date' },
            { key: 'seller', label: 'Vendeur' },
            { key: 'platform', label: 'Plateforme' },
            { key: 'articles', label: 'Articles', type: 'textarea' },
            { key: 'quantity', label: 'Quantité', type: 'number' },
            { key: 'items_price', label: 'Prix articles (€)', type: 'number' },
            { key: 'shipping_fee', label: 'Frais de port (€)', type: 'number' },
            { key: 'total_ttc', label: 'Total TTC (€)', type: 'number' },
            { key: 'notes', label: 'Notes', type: 'textarea' }
          ]}
          onClose={() => setEditing(null)}
          onSave={async (patch) => { await api.purchases.update(editing.id, patch); load(); }}
        />
      )}
      {auditing && <AuditHistoryModal entityType="purchase" entityId={auditing.id} title={`Historique — Achat #${auditing.id}`} onClose={() => setAuditing(null)} onReverted={load} />}
    </div>
  );
}
