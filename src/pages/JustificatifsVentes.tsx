import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { eur, shortDate, todayIso } from '../lib/format';
import DocumentForm from '../components/forms/DocumentForm';
import GenericEditForm from '../components/forms/GenericEditForm';
import AuditHistoryModal from '../components/AuditHistoryModal';
import SortControls from '../components/SortControls';
import { useLocalStorage } from '../lib/useLocalStorage';
import { sortRows, type SortDirection, type SortValueType } from '../lib/sort';
import type { Document } from '../../shared/types';

const PLATFORM_LABELS: Record<string, string> = {
  vinted: 'Vinted', whatnot: 'WhatNot', manual: 'Manuel', other: 'Autre', aliexpress: 'AliExpress'
};

type SalesDocsSort = 'date' | 'amount' | 'platform' | 'file' | 'customer' | 'reference';

const SALES_DOCS_SORT_OPTIONS: { value: SalesDocsSort; label: string }[] = [
  { value: 'date', label: 'Date' },
  { value: 'amount', label: 'Montant' },
  { value: 'platform', label: 'Plateforme' },
  { value: 'file', label: 'Fichier' },
  { value: 'customer', label: 'Acheteur' },
  { value: 'reference', label: 'Référence' }
];

const SALES_DOCS_SORT_TYPES: Record<SalesDocsSort, SortValueType> = {
  date: 'date',
  amount: 'number',
  platform: 'string',
  file: 'string',
  customer: 'string',
  reference: 'string'
};

export default function JustificatifsVentes() {
  const [rows, setRows] = useState<Document[]>([]);
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useLocalStorage<SalesDocsSort>('salesDocs.sortBy', 'date');
  const [sortDirection, setSortDirection] = useLocalStorage<SortDirection>('salesDocs.sortDirection', 'desc');
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Document | null>(null);
  const [auditing, setAuditing] = useState<Document | null>(null);

  const load = () => {
    api.docs.list({ type: 'facture_vente', search: search || undefined }).then((all) => {
      let filtered = all;
      if (platform) filtered = filtered.filter((d) => (d.source ?? '').toLowerCase().includes(platform.toLowerCase()));
      if (dateFrom) filtered = filtered.filter((d) => (d.date ?? d.created_at).slice(0, 10) >= dateFrom);
      if (dateTo) filtered = filtered.filter((d) => (d.date ?? d.created_at).slice(0, 10) <= dateTo);
      setRows(filtered);
    });
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [platform, dateFrom, dateTo]);

  const total = rows.reduce((s, d) => s + (d.amount ?? 0), 0);
  const sortedRows = sortRows(rows, (d) => {
    switch (sortBy) {
      case 'date': return d.date ?? d.created_at;
      case 'amount': return d.amount;
      case 'platform': return d.source;
      case 'file': return d.original_file_name;
      case 'customer': return d.supplier_or_customer;
      case 'reference': return d.external_reference;
    }
  }, sortDirection, SALES_DOCS_SORT_TYPES[sortBy]);

  const onDelete = async (d: Document) => {
    if (!confirm(`Supprimer le justificatif "${d.original_file_name}" ?\n\nLe fichier physique sera conservé sur disque. Pour le supprimer aussi, utilisez la page Documents.`)) return;
    await api.docs.delete(d.id, false);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Justificatifs de ventes</h1>
        <button className="btn-primary" onClick={() => setAddOpen(true)}>+ Ajouter manuellement</button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="card p-3"><div className="text-xs uppercase text-slate-500">Total justificatifs</div><div className="text-2xl font-bold text-slate-700">{rows.length}</div></div>
        <div className="card p-3"><div className="text-xs uppercase text-slate-500">Montant total</div><div className="text-2xl font-bold text-emerald-700">{eur(total)}</div></div>
      </div>

      <div className="alert-info text-sm">
        Justificatifs PDF/image associés aux ventes. Vous pouvez importer des PDF Vinted depuis "Importer des données"
        catégorie "Ventes Vinted (PDF)", ou ajouter manuellement ici.
      </div>

      <div className="card p-3 flex flex-wrap gap-2 items-center">
        <input className="border rounded px-2 py-1 text-sm" placeholder="Recherche (nom, fournisseur, ref)…"
          value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        <button className="btn-secondary text-xs" onClick={load}>Filtrer</button>
        <select className="border rounded px-2 py-1 text-sm" value={platform} onChange={(e) => setPlatform(e.target.value)}>
          <option value="">Toute plateforme</option>
          {Object.entries(PLATFORM_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
        </select>
        <div className="flex items-center gap-1 text-sm">
          <span className="text-slate-500">Du</span>
          <input type="date" className="border rounded px-2 py-1 text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} max={todayIso()} />
          <span className="text-slate-500">au</span>
          <input type="date" className="border rounded px-2 py-1 text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} max={todayIso()} />
        </div>
        <SortControls
          value={sortBy}
          direction={sortDirection}
          options={SALES_DOCS_SORT_OPTIONS}
          onValueChange={setSortBy}
          onDirectionChange={setSortDirection}
        />
      </div>

      <div className="card overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100"><tr>
            <th className="px-2 py-2 text-left">Date</th>
            <th className="px-2 py-2 text-left">Plateforme</th>
            <th className="px-2 py-2 text-left">Fichier</th>
            <th className="px-2 py-2 text-left">Acheteur</th>
            <th className="px-2 py-2 text-right">Montant</th>
            <th className="px-2 py-2"></th>
          </tr></thead>
          <tbody>
            {sortedRows.map((d) => (
              <tr key={d.id} className="border-t hover:bg-slate-50">
                <td className="px-2 py-1.5">{shortDate(d.date ?? d.created_at)}</td>
                <td className="px-2 py-1.5"><span className="pill bg-slate-100 text-slate-700">{PLATFORM_LABELS[d.source ?? 'other'] ?? d.source ?? '—'}</span></td>
                <td className="px-2 py-1.5 truncate max-w-[280px]" title={d.file_path}>{d.original_file_name}</td>
                <td className="px-2 py-1.5">{d.supplier_or_customer ?? '—'}</td>
                <td className="px-2 py-1.5 text-right">{eur(d.amount)}</td>
                <td className="px-2 py-1.5 text-right">
                  <div className="flex gap-2 justify-end">
                    <button className="text-xs text-brand-600 hover:underline" onClick={() => api.docs.open(d.id)}>Télécharger</button>
                    <button className="text-xs text-brand-600 hover:underline" onClick={() => setEditing(d)}>Éditer</button>
                    <button className="text-xs text-slate-600 hover:underline" onClick={() => setAuditing(d)}>Historique</button>
                    <button className="text-xs text-red-700 hover:underline" onClick={() => onDelete(d)}>Supprimer</button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (<tr><td colSpan={6} className="p-6 text-center text-slate-400">Aucun justificatif de vente. Importez des PDF Vinted ou ajoutez manuellement.</td></tr>)}
          </tbody>
        </table>
      </div>

      {addOpen && <DocumentForm onClose={() => setAddOpen(false)} onSaved={load} />}
      {editing && (
        <GenericEditForm
          title={`Éditer justificatif #${editing.id}`}
          initial={editing as unknown as Record<string, unknown>}
          fields={[
            { key: 'date', label: 'Date', type: 'date' },
            { key: 'amount', label: 'Montant (€)', type: 'number' },
            { key: 'supplier_or_customer', label: 'Acheteur' },
            { key: 'external_reference', label: 'Référence' },
            { key: 'notes', label: 'Notes', type: 'textarea' }
          ]}
          onClose={() => setEditing(null)}
          onSave={async (patch) => { await api.docs.update(editing.id, patch); load(); }}
        />
      )}
      {auditing && <AuditHistoryModal entityType="document" entityId={auditing.id} title={`Historique — Justificatif #${auditing.id}`} onClose={() => setAuditing(null)} onReverted={load} />}
    </div>
  );
}
