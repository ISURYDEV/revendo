import { useEffect, useState } from 'react';
import { notify } from '../lib/notify';
import { api } from '../lib/api';
import { eur } from '../lib/format';
import { AddStockForm, RemoveStockForm } from '../components/forms/StockForm';
import GenericEditForm from '../components/forms/GenericEditForm';
import AuditHistoryModal from '../components/AuditHistoryModal';
import SortControls from '../components/SortControls';
import SavedFiltersBar from '../components/SavedFiltersBar';
import { useToast } from '../components/Toast';
import { sortRows, type SortDirection, type SortValueType } from '../lib/sort';
import type { StockItem, StockItemStatus, StockMovement, StockOrigin } from '../../shared/types';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon', purchased: 'Acheté', in_transit: 'En transit', received: 'Reçu',
  in_stock: 'À la maison', listed: 'Publié', reserved: 'Réservé',
  sold_pending: 'Vendu en attente', sold_completed: 'Vendu encaissé',
  returned: 'Retourné', donated: 'Donné', gifted: 'Offert',
  personal_use: 'Usage personnel', lost: 'Perdu', discarded: 'Jeté', archived: 'Archivé'
};

const ORIGIN_LABELS: Record<string, string> = {
  compra_vinted: 'Vinted', compra_whatnot: 'WhatNot', brocante: 'Brocante',
  donacion_recibida: 'Don reçu', regalo_recibido: 'Cadeau reçu', stock_inicial: 'Stock initial',
  personal: 'Personnel', autre: 'Autre', vinteer_inventory: 'Import Vinteer', split_lot: 'Lot divisé'
};

type StockSort = 'purchase_date' | 'updated_at' | 'name' | 'sku' | 'status' | 'origin' | 'location' | 'quantity' | 'unit_cost_ttc' | 'estimated_sale_price';

const STOCK_SORT_OPTIONS: { value: StockSort; label: string }[] = [
  { value: 'purchase_date', label: 'Date d’achat' },
  { value: 'updated_at', label: 'Dernière modification' },
  { value: 'name', label: 'Nom' },
  { value: 'sku', label: 'SKU' },
  { value: 'status', label: 'Statut' },
  { value: 'origin', label: 'Origine' },
  { value: 'location', label: 'Emplacement' },
  { value: 'quantity', label: 'Quantité' },
  { value: 'unit_cost_ttc', label: 'Coût unitaire' },
  { value: 'estimated_sale_price', label: 'Prix estimé' }
];

const STOCK_SORT_TYPES: Record<StockSort, SortValueType> = {
  purchase_date: 'date',
  updated_at: 'date',
  name: 'string',
  sku: 'string',
  status: 'string',
  origin: 'string',
  location: 'string',
  quantity: 'number',
  unit_cost_ttc: 'number',
  estimated_sale_price: 'number'
};

export default function Stock() {
  const [rows, setRows] = useState<StockItem[]>([]);
  const [overview, setOverview] = useState<{ counts: Record<string, number>; totals: Record<string, number> } | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StockItemStatus | 'all'>('all');
  const [origin, setOrigin] = useState<StockOrigin | 'all'>('all');
  const [location, setLocation] = useState('');
  const [sortBy, setSortBy] = useState<StockSort>('updated_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [addOpen, setAddOpen] = useState(false);
  const [moveItem, setMoveItem] = useState<StockItem | null>(null);
  const [historyItem, setHistoryItem] = useState<StockItem | null>(null);
  const [editing, setEditing] = useState<StockItem | null>(null);
  const [auditing, setAuditing] = useState<StockItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const toast = useToast();

  const load = () => {
    api.stock.list({ status, origin, location: location || undefined, search: search || undefined }).then((r) => { setRows(r); setSelectedIds([]); });
    api.stock.overview().then(setOverview);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status, origin, location]);

  const handleQuickAction = async (item: StockItem, action: 'RESERVE' | 'UNRESERVE' | 'LIST' | 'UNLIST' | 'ARCHIVE') => {
    await api.stock.reserve({ stock_item_id: item.id, action });
    load();
  };

  const handleDelete = async (item: StockItem) => {
    const confirmation = confirm(
      `Supprimer DÉFINITIVEMENT cet article de la base ?\n\n` +
      `  ${item.internal_code} — ${item.name ?? ''}\n` +
      `  Quantité actuelle : ${item.quantity}\n\n` +
      `Utilisez cette option uniquement en cas d'erreur de saisie.\n` +
      `Si vous l'avez donné, offert, perdu ou jeté pour de vrai, utilisez "Déplacer" à la place (préserve l'historique).\n\n` +
      `Cette action est IRRÉVERSIBLE.`
    );
    if (!confirmation) return;
    try {
      await api.stock.delete(item.id);
      toast.success('Article de stock supprimé');
      load();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('associé') || message.includes('Désassociez')) {
        const unlink = confirm(
          `${message}\n\n` +
          `Voulez-vous désassocier automatiquement cet article des ventes concernées, puis supprimer le stock ?\n\n` +
          `Les ventes resteront enregistrées. Seul le lien vers ce stock sera retiré, avec une trace dans l'historique.`
        );
        if (!unlink) return;
        try {
          await api.stock.delete(item.id, { unlinkSales: true });
          toast.success('Stock désassocié puis supprimé');
          load();
          return;
        } catch (unlinkErr) {
          notify(unlinkErr instanceof Error ? unlinkErr.message : String(unlinkErr));
          return;
        }
      }
      notify(message);
    }
  };

  const sortedRows = sortRows(rows, (row) => {
    if (sortBy === 'origin') return row.source ?? row.platform;
    return row[sortBy];
  }, sortDirection, STOCK_SORT_TYPES[sortBy]);
  const filterState = { search, status, origin, location, sortBy, sortDirection };
  const applySavedFilter = (state: Record<string, unknown>) => {
    setSearch(String(state.search ?? ''));
    setStatus((state.status as StockItemStatus | 'all') ?? 'all');
    setOrigin((state.origin as StockOrigin | 'all') ?? 'all');
    setLocation(String(state.location ?? ''));
    setSortBy((state.sortBy as StockSort) ?? 'updated_at');
    setSortDirection((state.sortDirection as SortDirection) ?? 'desc');
  };
  const toggleSelected = (id: number) => setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const allSelected = sortedRows.length > 0 && sortedRows.every((r) => selectedIds.includes(r.id));
  const bulkLocation = async () => {
    const next = window.prompt('Nouvel emplacement');
    if (!next?.trim()) return;
    await api.bulk.stockLocation({ ids: selectedIds, location: next, note: 'Mise à jour emplacement en masse' });
    toast.success('Emplacements mis à jour');
    load();
  };
  const bulkStatus = async () => {
    const next = window.prompt('Nouveau statut (ex: in_stock, listed, archived)');
    if (!next?.trim()) return;
    await api.bulk.stockStatus({ ids: selectedIds, status: next as StockItemStatus, note: 'Mise à jour statut en masse' });
    toast.success('Statuts mis à jour');
    load();
  };
  const bulkMove = async (movementType: 'OUT_DONATED' | 'OUT_GIFTED' | 'OUT_LOST' | 'OUT_DISCARDED') => {
    const note = window.prompt('Note obligatoire pour ce mouvement de masse');
    if (!note?.trim()) return;
    const quantity = Number(window.prompt('Quantité à sortir par ligne', '1') ?? '1');
    await api.bulk.stockMoveOut({ ids: selectedIds, movementType, quantity, note });
    toast.success('Mouvements enregistrés');
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Stock</h1>
        <button className="btn-primary" onClick={() => setAddOpen(true)}>+ Ajouter du stock</button>
      </div>

      {overview && (
        <div className="grid grid-cols-6 gap-3">
          <Indicator label="À la maison" value={overview.counts.at_home} color="text-sky-700" />
          <Indicator label="Publié" value={overview.counts.listed} color="text-amber-700" />
          <Indicator label="Réservé" value={overview.counts.reserved} color="text-purple-700" />
          <Indicator label="Coût stock" value={eur(overview.totals.cost_total)} color="text-slate-700" />
          <Indicator label="Estim. vente" value={eur(overview.totals.estimated_revenue)} color="text-emerald-700" />
          <Indicator label="Sans empl. / coût" value={`${overview.totals.no_location ?? 0} / ${overview.totals.no_cost ?? 0}`} color="text-red-700" />
        </div>
      )}

      <div className="card p-3 flex flex-wrap gap-2">
        <input className="border rounded px-2 py-1 text-sm" placeholder="Recherche (nom/SKU/marque/fournisseur)…"
          value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        <button className="btn-secondary text-xs" onClick={load}>Filtrer</button>
        <select className="border rounded px-2 py-1 text-sm" value={status} onChange={(e) => setStatus(e.target.value as StockItemStatus | 'all')}>
          <option value="all">Tous les statuts</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
        </select>
        <select className="border rounded px-2 py-1 text-sm" value={origin} onChange={(e) => setOrigin(e.target.value as StockOrigin | 'all')}>
          <option value="all">Toutes origines</option>
          {Object.entries(ORIGIN_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
        </select>
        <input className="border rounded px-2 py-1 text-sm" placeholder="Emplacement"
          value={location} onChange={(e) => setLocation(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        <SortControls
          value={sortBy}
          direction={sortDirection}
          options={STOCK_SORT_OPTIONS}
          onValueChange={setSortBy}
          onDirectionChange={setSortDirection}
        />
        <span className="text-xs text-slate-500 ml-auto self-center">{rows.length} résultats</span>
      </div>

      <SavedFiltersBar entityType="stock" currentState={filterState} onApply={applySavedFilter} />

      {selectedIds.length > 0 && (
        <div className="card p-3 flex flex-wrap gap-2 items-center">
          <strong>{selectedIds.length} article(s) sélectionné(s)</strong>
          <button className="btn-secondary text-xs" onClick={bulkLocation}>Changer emplacement</button>
          <button className="btn-secondary text-xs" onClick={bulkStatus}>Changer statut</button>
          <button className="btn-secondary text-xs" onClick={() => bulkMove('OUT_DONATED')}>Sortir donné</button>
          <button className="btn-secondary text-xs" onClick={() => bulkMove('OUT_GIFTED')}>Sortir offert</button>
          <button className="btn-secondary text-xs" onClick={() => bulkMove('OUT_LOST')}>Sortir perdu</button>
          <button className="btn-secondary text-xs" onClick={() => setSelectedIds([])}>Annuler sélection</button>
        </div>
      )}

      <div className="card overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left sticky top-0">
            <tr>
              <th className="px-2 py-2">
                <input type="checkbox" checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : sortedRows.map((r) => r.id))} />
              </th>
              <th className="px-2 py-2">Code</th>
              <th className="px-2 py-2">Nom</th>
              <th className="px-2 py-2">SKU</th>
              <th className="px-2 py-2">Statut</th>
              <th className="px-2 py-2 text-right">Qté</th>
              <th className="px-2 py-2 text-right">Coût u.</th>
              <th className="px-2 py-2 text-right">Estim.</th>
              <th className="px-2 py-2">Empl.</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r) => (
              <tr key={r.id} className="border-t hover:bg-slate-50">
                <td className="px-2 py-1.5"><input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => toggleSelected(r.id)} /></td>
                <td className="px-2 py-1.5 font-mono text-xs">{r.internal_code}</td>
                <td className="px-2 py-1.5 truncate max-w-[260px]">{r.name}</td>
                <td className="px-2 py-1.5 text-xs">{r.sku ?? '—'}</td>
                <td className="px-2 py-1.5">
                  <span className="pill bg-slate-100 text-slate-700">{STATUS_LABELS[r.status] ?? r.status}</span>
                </td>
                <td className="px-2 py-1.5 text-right font-semibold">{r.quantity}</td>
                <td className="px-2 py-1.5 text-right">{eur(r.unit_cost_ttc)}</td>
                <td className="px-2 py-1.5 text-right">{eur(r.estimated_sale_price)}</td>
                <td className="px-2 py-1.5 text-xs">{r.location ?? '—'}</td>
                <td className="px-2 py-1.5 text-right">
                  <div className="flex gap-1 justify-end">
                    {r.status === 'in_stock' && (
                      <button className="text-xs text-amber-700 hover:underline" onClick={() => handleQuickAction(r, 'LIST')}>Publier</button>
                    )}
                    {r.status === 'listed' && (
                      <button className="text-xs text-slate-700 hover:underline" onClick={() => handleQuickAction(r, 'UNLIST')}>Dépublier</button>
                    )}
                    <button className="text-xs text-brand-600 hover:underline" onClick={() => setEditing(r)}>Éditer</button>
                    <button className="text-xs text-slate-600 hover:underline" onClick={() => setHistoryItem(r)}>Mvts</button>
                    <button className="text-xs text-slate-600 hover:underline" onClick={() => setAuditing(r)}>Audit</button>
                    <button className="text-xs text-brand-600 hover:underline" onClick={() => setMoveItem(r)}>Déplacer</button>
                    <button className="text-xs text-red-700 hover:underline" onClick={() => handleDelete(r)}>Supprimer</button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={10} className="px-2 py-6 text-center text-slate-400">Aucun stock. Cliquez "+ Ajouter du stock" ou importez un CSV.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {addOpen && <AddStockForm onClose={() => setAddOpen(false)} onSaved={load} />}
      {moveItem && <RemoveStockForm item={moveItem} onClose={() => setMoveItem(null)} onSaved={load} />}
      {historyItem && <HistoryModal item={historyItem} onClose={() => setHistoryItem(null)} />}
      {editing && (
        <GenericEditForm
          title={`Modifier le stock — ${editing.internal_code}`}
          initial={editing as unknown as Record<string, unknown>}
          fields={[
            { key: 'name', label: 'Nom' },
            { key: 'sku', label: 'SKU (optionnel)' },
            { key: 'status', label: 'Statut', type: 'select', options: Object.keys(STATUS_LABELS).map((k) => ({ value: k, label: STATUS_LABELS[k] })) },
            { key: 'quantity', label: 'Quantité', type: 'number' },
            { key: 'unit_cost_ttc', label: 'Coût unitaire (€)', type: 'number' },
            { key: 'total_cost_ttc', label: 'Coût total (€)', type: 'number' },
            { key: 'estimated_sale_price', label: 'Prix de vente estimé (€)', type: 'number' },
            { key: 'brand', label: 'Marque' },
            { key: 'size', label: 'Taille' },
            { key: 'color', label: 'Couleur' },
            { key: 'location', label: 'Emplacement physique' },
            { key: 'notes', label: 'Notes', type: 'textarea' }
          ]}
          onClose={() => setEditing(null)}
          onSave={async (patch) => { await api.stock.update(editing.id, patch); load(); }}
        />
      )}
      {auditing && (
        <AuditHistoryModal entityType="stock_item" entityId={auditing.id}
          title={`Audit — Stock ${auditing.internal_code}`}
          onClose={() => setAuditing(null)} onReverted={load} />
      )}
    </div>
  );
}

function Indicator({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="card p-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-lg font-bold ${color} mt-1`}>{value ?? '—'}</div>
    </div>
  );
}

function HistoryModal({ item, onClose }: { item: StockItem; onClose: () => void }) {
  const [movs, setMovs] = useState<StockMovement[]>([]);
  useEffect(() => { api.stock.movements(item.id).then(setMovs as (m: unknown) => void); }, [item.id]);
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg w-[640px] max-w-[95vw] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b">
          <h2 className="text-lg font-bold">Historique — {item.name}</h2>
          <div className="text-xs text-slate-500 font-mono">{item.internal_code}</div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-100"><tr>
            <th className="px-2 py-1 text-left">Date</th><th className="px-2 py-1 text-left">Type</th>
            <th className="px-2 py-1 text-right">Qté</th><th className="px-2 py-1 text-left">Motif</th>
          </tr></thead>
          <tbody>
            {movs.map((m) => (
              <tr key={m.id} className="border-t">
                <td className="px-2 py-1 text-xs">{m.movement_date.slice(0, 16).replace('T', ' ')}</td>
                <td className="px-2 py-1 font-mono text-xs">{m.movement_type}</td>
                <td className="px-2 py-1 text-right">{m.quantity}</td>
                <td className="px-2 py-1">{m.reason}</td>
              </tr>
            ))}
            {movs.length === 0 && <tr><td colSpan={4} className="p-4 text-center text-slate-400">Aucun mouvement.</td></tr>}
          </tbody>
        </table>
        <div className="p-3 text-right border-t"><button className="btn-secondary" onClick={onClose}>Fermer</button></div>
      </div>
    </div>
  );
}
