import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { eur, shortDate, todayIso } from '../lib/format';
import ExpenseForm from '../components/forms/ExpenseForm';
import GenericEditForm from '../components/forms/GenericEditForm';
import AuditHistoryModal from '../components/AuditHistoryModal';
import { useToast, useConfirm } from '../components/Toast';
import { useLocalStorage } from '../lib/useLocalStorage';
import Pagination, { paginate, type PaginationState } from '../components/Pagination';
import EmptyState from '../components/EmptyState';
import SortControls from '../components/SortControls';
import SavedFiltersBar from '../components/SavedFiltersBar';
import { sortRows, type SortDirection, type SortValueType } from '../lib/sort';
import type { Expense, Document } from '../../shared/types';

const CATEGORY_LABELS: Record<string, string> = {
  boost_marketing: 'Boost Vinted', sacs_expedition: 'Sacs d\'expédition',
  emballages: 'Emballages', scotch: 'Scotch',
  tinta_impresora: 'Encre / imprimante', papel_etiquetas: 'Papier / étiquettes',
  frais_port: 'Frais de port', fournitures_bureau: 'Fournitures bureau',
  materiel_photo: 'Matériel photo', achat_stock: 'Achat stock',
  abonnement_logiciel: 'Abonnement logiciel', frais_plateforme: 'Frais plateforme',
  autre: 'Autre'
};

type ExpensesSort = 'date' | 'amount_ttc' | 'category' | 'supplier' | 'description' | 'without_doc';

const EXPENSE_SORT_OPTIONS: { value: ExpensesSort; label: string }[] = [
  { value: 'date', label: 'Date' },
  { value: 'amount_ttc', label: 'Montant TTC' },
  { value: 'category', label: 'Catégorie' },
  { value: 'supplier', label: 'Fournisseur' },
  { value: 'description', label: 'Description' },
  { value: 'without_doc', label: 'Sans reçu d’abord' }
];

const EXPENSE_SORT_TYPES: Record<ExpensesSort, SortValueType> = {
  date: 'date',
  amount_ttc: 'number',
  category: 'string',
  supplier: 'string',
  description: 'string',
  without_doc: 'number'
};

export default function Expenses() {
  const [year, setYear] = useLocalStorage('expenses.year', new Date().getUTCFullYear());
  const [rows, setRows] = useState<Expense[]>([]);
  const [docsByExpense, setDocsByExpense] = useState<Record<number, Document[]>>({});
  const [search, setSearch] = useLocalStorage('expenses.search', '');
  const [category, setCategory] = useLocalStorage('expenses.category', '');
  const [dateFrom, setDateFrom] = useLocalStorage('expenses.dateFrom', '');
  const [dateTo, setDateTo] = useLocalStorage('expenses.dateTo', '');
  const [withDoc, setWithDoc] = useLocalStorage<'all' | 'with' | 'without'>('expenses.withDoc', 'all');
  const [sortBy, setSortBy] = useLocalStorage<ExpensesSort>('expenses.sortBy', 'date');
  const [sortDirection, setSortDirection] = useLocalStorage<SortDirection>('expenses.sortDirection', 'desc');
  const [pag, setPag] = useLocalStorage<PaginationState>('expenses.pag', { page: 0, pageSize: 50 });
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [auditing, setAuditing] = useState<Expense | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const toast = useToast();
  const confirmDialog = useConfirm();

  const load = async () => {
    const all = await api.expenses.list({ year, category: category || undefined, withDoc });
    let filtered = all;
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((r) =>
        (r.description ?? '').toLowerCase().includes(q) ||
        (r.supplier ?? '').toLowerCase().includes(q)
      );
    }
    if (dateFrom) filtered = filtered.filter((r) => r.date >= dateFrom);
    if (dateTo) filtered = filtered.filter((r) => r.date <= dateTo);
    setRows(filtered);
    setSelectedIds([]);

    const bulk = await api.docsBulk.linksFor('expense', filtered.map((e) => e.id));
    setDocsByExpense(bulk as unknown as Record<number, Document[]>);
  };

  const sortedRows = sortRows(rows, (row) => {
    if (sortBy === 'without_doc') return (docsByExpense[row.id]?.length ?? 0) === 0 ? 0 : 1;
    return row[sortBy];
  }, sortBy === 'without_doc' ? 'asc' : sortDirection, EXPENSE_SORT_TYPES[sortBy]);
  const pagedRows = paginate(sortedRows, pag);
  const filterState = { year, search, category, dateFrom, dateTo, withDoc, sortBy, sortDirection };
  const applySavedFilter = (state: Record<string, unknown>) => {
    setYear(Number(state.year ?? new Date().getUTCFullYear()));
    setSearch(String(state.search ?? ''));
    setCategory(String(state.category ?? ''));
    setDateFrom(String(state.dateFrom ?? ''));
    setDateTo(String(state.dateTo ?? ''));
    setWithDoc((state.withDoc as 'all' | 'with' | 'without') ?? 'all');
    setSortBy((state.sortBy as ExpensesSort) ?? 'date');
    setSortDirection((state.sortDirection as SortDirection) ?? 'desc');
  };
  const toggleSelected = (id: number) => setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const allPagedSelected = pagedRows.length > 0 && pagedRows.every((r) => selectedIds.includes(r.id));
  const bulkCategory = async () => {
    const next = window.prompt('Nouvelle catégorie (ex: emballages, frais_port, autre)');
    if (!next?.trim()) return;
    await api.bulk.expenseCategory({ ids: selectedIds, category: next, note: 'Changement de catégorie en masse' });
    toast.success('Catégories mises à jour');
    load();
  };
  const bulkVerified = async () => {
    const note = window.prompt('Note de vérification');
    if (!note?.trim()) return;
    await api.bulk.markVerified({ entityType: 'expense', ids: selectedIds, note });
    toast.success('Dépenses marquées comme vérifiées');
    load();
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [year, category, withDoc, dateFrom, dateTo]);

  const onDelete = async (id: number) => {
    if (!await confirmDialog({ title: 'Supprimer cette dépense ?', message: 'Cette action est enregistrée dans l\'historique.', danger: true })) return;
    try { await api.expenses.delete(id); toast.success('Dépense supprimée'); load(); }
    catch (err) { toast.error('Erreur', err instanceof Error ? err.message : String(err)); }
  };
  const onAttach = async (id: number) => {
    const r = await api.expenseReceipt.attach(id);
    if (!r.canceled) load();
  };

  const total = rows.reduce((s, r) => s + r.amount_ttc, 0);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Dépenses</h1>
        <button className="btn-primary" onClick={() => setAddOpen(true)}>+ Ajouter une dépense</button>
      </div>

      <div className="alert-warn text-sm">
        Les dépenses <strong>ne</strong> réduisent <strong>pas</strong> le CA URSSAF (régime micro-entreprise).
        Elles servent uniquement à la rentabilité réelle et à la traçabilité.
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="card p-3"><div className="text-xs uppercase text-slate-500">Nombre de dépenses</div><div className="text-2xl font-bold text-slate-700">{rows.length}</div></div>
        <div className="card p-3"><div className="text-xs uppercase text-slate-500">Total filtré</div><div className="text-2xl font-bold text-red-700">{eur(total)}</div></div>
      </div>

      <div className="card p-3 flex flex-wrap gap-2 items-center">
        <input className="border rounded px-2 py-1 text-sm" placeholder="Recherche (description, fournisseur)…"
          value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        <button className="btn-secondary text-xs" onClick={load}>Filtrer</button>
        <select className="border rounded px-2 py-1 text-sm" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[2024, 2025, 2026, 2027].map((y) => (<option key={y} value={y}>{y}</option>))}
        </select>
        <select className="border rounded px-2 py-1 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Toutes catégories</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
        </select>
        <select className="border rounded px-2 py-1 text-sm" value={withDoc} onChange={(e) => setWithDoc(e.target.value as typeof withDoc)}>
          <option value="all">Tous</option>
          <option value="with">Avec reçu</option>
          <option value="without">Sans reçu</option>
        </select>
        <div className="flex items-center gap-1 text-sm">
          <span className="text-slate-500">Du</span>
          <input type="date" className="border rounded px-2 py-1 text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} max={todayIso()} />
          <span className="text-slate-500">au</span>
          <input type="date" className="border rounded px-2 py-1 text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} max={todayIso()} />
        </div>
        <SortControls
          value={sortBy}
          direction={sortBy === 'without_doc' ? 'asc' : sortDirection}
          options={EXPENSE_SORT_OPTIONS}
          onValueChange={setSortBy}
          onDirectionChange={setSortDirection}
        />
      </div>

      <SavedFiltersBar entityType="expenses" currentState={filterState} onApply={applySavedFilter} />

      {selectedIds.length > 0 && (
        <div className="card p-3 flex flex-wrap gap-2 items-center">
          <strong>{selectedIds.length} dépense(s) sélectionnée(s)</strong>
          <button className="btn-secondary text-xs" onClick={bulkCategory}>Changer catégorie</button>
          <button className="btn-secondary text-xs" onClick={bulkVerified}>Marquer vérifié</button>
          <button className="btn-secondary text-xs" onClick={() => setSelectedIds([])}>Annuler sélection</button>
        </div>
      )}

      <div className="card overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100"><tr>
            <th className="px-2 py-2"><input type="checkbox" checked={allPagedSelected} onChange={() => setSelectedIds(allPagedSelected ? selectedIds.filter((id) => !pagedRows.some((r) => r.id === id)) : [...new Set([...selectedIds, ...pagedRows.map((r) => r.id)])])} /></th>
            <th className="px-2 py-2 text-left">Date</th>
            <th className="px-2 py-2 text-left">Catégorie</th>
            <th className="px-2 py-2 text-left">Fournisseur</th>
            <th className="px-2 py-2 text-left">Description</th>
            <th className="px-2 py-2 text-right">TTC</th>
            <th className="px-2 py-2 text-left">Reçu</th>
            <th className="px-2 py-2"></th>
          </tr></thead>
          <tbody>
            {pagedRows.map((r) => {
              const docs = docsByExpense[r.id] ?? [];
              return (
                <tr key={r.id} className="border-t hover:bg-slate-50">
                  <td className="px-2 py-1.5"><input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => toggleSelected(r.id)} /></td>
                  <td className="px-2 py-1.5">{shortDate(r.date)}</td>
                  <td className="px-2 py-1.5"><span className="pill bg-slate-100 text-slate-700">{CATEGORY_LABELS[r.category] ?? r.category}</span></td>
                  <td className="px-2 py-1.5">{r.supplier ?? '—'}</td>
                  <td className="px-2 py-1.5 truncate max-w-[280px]">{r.description}</td>
                  <td className="px-2 py-1.5 text-right font-semibold">{eur(r.amount_ttc)}</td>
                  <td className="px-2 py-1.5">
                    {docs.length === 0 ? (
                      <span className="pill bg-amber-100 text-amber-800">Pas de reçu</span>
                    ) : (
                      docs.map((d) => (
                        <button key={d.id} className="pill bg-emerald-100 text-emerald-700 hover:bg-emerald-200 mr-1"
                          onClick={() => api.docs.open(d.id)}>📎 Voir</button>
                      ))
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <div className="flex gap-2 justify-end">
                      {docs.length === 0 && <button className="text-xs text-sky-700 hover:underline" onClick={() => onAttach(r.id)}>📎 Joindre</button>}
                      <button className="text-xs text-brand-600 hover:underline" onClick={() => setEditing(r)}>Éditer</button>
                      <button className="text-xs text-slate-600 hover:underline" onClick={() => setAuditing(r)}>Historique</button>
                      <button className="text-xs text-red-700 hover:underline" onClick={() => onDelete(r.id)}>Supprimer</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {pagedRows.length === 0 && (
              <tr><td colSpan={8}>
                <EmptyState
                  icon="💸"
                  title={rows.length === 0 ? 'Aucune dépense' : 'Aucun résultat avec ces filtres'}
                  description={rows.length === 0 ? 'Importez le CSV de boosts Vinted ou ajoutez une dépense manuellement.' : 'Modifiez les filtres.'}
                  actions={rows.length === 0 ? [{ label: '+ Ajouter une dépense', onClick: () => setAddOpen(true), primary: true }] : undefined}
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

      {addOpen && <ExpenseForm onClose={() => setAddOpen(false)} onSaved={load} />}
      {editing && (
        <GenericEditForm
          title={`Éditer dépense #${editing.id}`}
          initial={editing as unknown as Record<string, unknown>}
          fields={[
            { key: 'date', label: 'Date', type: 'date' },
            { key: 'category', label: 'Catégorie' },
            { key: 'supplier', label: 'Fournisseur' },
            { key: 'description', label: 'Description', type: 'textarea' },
            { key: 'amount_ttc', label: 'Montant TTC (€)', type: 'number' },
            { key: 'notes', label: 'Notes', type: 'textarea' }
          ]}
          onClose={() => setEditing(null)}
          onSave={async (patch) => { await api.expenses.update(editing.id, patch); load(); }}
        />
      )}
      {auditing && <AuditHistoryModal entityType="expense" entityId={auditing.id} title={`Historique — Dépense #${auditing.id}`} onClose={() => setAuditing(null)} onReverted={load} />}
    </div>
  );
}
