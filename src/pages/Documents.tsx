import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { eur, shortDate } from '../lib/format';
import DocumentForm from '../components/forms/DocumentForm';
import EmptyState from '../components/EmptyState';
import SavedFiltersBar from '../components/SavedFiltersBar';
import { useToast, useConfirm } from '../components/Toast';
import type { Document, DocumentLink, DocumentType } from '../../shared/types';

const DOC_TYPES: { value: DocumentType | 'all' | '__none' | ''; label: string }[] = [
  { value: 'all', label: 'Tous types' },
  { value: '__none', label: 'Sans type' },
  { value: 'facture_vente', label: 'Facture de vente' },
  { value: 'facture_achat', label: 'Facture d’achat' },
  { value: 'ticket_caisse', label: 'Ticket caisse' },
  { value: 'justificatif_urssaf', label: 'Justificatif URSSAF' },
  { value: 'export_vinteer', label: 'Export Vinteer' },
  { value: 'export_whatnot', label: 'Export WhatNot' },
  { value: 'whatnot_purchase_csv', label: 'CSV justificatif WhatNot' },
  { value: 'facture_boost', label: 'Facture boost' },
  { value: 'autre', label: 'Autre' }
];

export default function Documents() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [type, setType] = useState<DocumentType | 'all' | '__none' | ''>('all');
  const [search, setSearch] = useState('');
  const [orphanOnly, setOrphanOnly] = useState(true);
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [selected, setSelected] = useState<number[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [linkDoc, setLinkDoc] = useState<Document | null>(null);
  const [changeTypeDoc, setChangeTypeDoc] = useState<Document | null>(null);
  const toast = useToast();
  const confirmDialog = useConfirm();

  const load = () => {
    api.docs.list({ type: type === 'all' ? undefined : type, search: search || undefined, orphan: orphanOnly }).then((rows) => {
      setDocs(rows);
      setSelected([]);
    });
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [type, orphanOnly]);

  const filters = useMemo(() => ({ type, search, orphanOnly, view }), [type, search, orphanOnly, view]);
  const applyFilter = (state: Record<string, unknown>) => {
    setType((state.type as DocumentType | 'all' | '__none' | '') ?? 'all');
    setSearch(String(state.search ?? ''));
    setOrphanOnly(Boolean(state.orphanOnly ?? true));
    setView((state.view as 'cards' | 'table') ?? 'cards');
  };

  const ext = (d: Document) => (d.file_name ?? d.original_file_name ?? '').split('.').pop()?.toUpperCase() ?? '—';
  const toggleSelected = (id: number) => setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const bulkType = async () => {
    const next = window.prompt('Nouveau type (ex: facture_vente, facture_achat, ticket_caisse, autre)');
    if (!next) return;
    await api.bulk.documentType({ ids: selected, documentType: next, note: 'Changement de type en masse' });
    toast.success('Documents mis à jour');
    load();
  };

  const markClassed = async () => {
    const note = window.prompt('Note de classement');
    if (!note?.trim()) return;
    await api.bulk.markVerified({ entityType: 'document', ids: selected, note });
    toast.success('Documents marqués comme classés');
    load();
  };

  const deleteDoc = async (doc: Document) => {
    const ok = await confirmDialog({
      title: 'Supprimer ce document ?',
      message: 'La fiche sera supprimée de Revendo. Le fichier physique ne sera pas supprimé sauf si vous choisissez explicitement cette option ailleurs.',
      danger: true
    });
    if (!ok) return;
    await api.docs.delete(doc.id, false);
    toast.success('Document supprimé');
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-start gap-3">
        <div>
          <h1 className="text-2xl font-bold">🗂️ Documents sans association</h1>
          <p className="text-sm text-slate-500 mt-1">Retrouvez les factures, tickets et justificatifs non reliés à une vente, un achat, une dépense ou une déclaration.</p>
        </div>
        <button className="btn-primary" onClick={() => setAddOpen(true)}>+ Ajouter document</button>
      </div>

      <div className="card p-3 flex flex-wrap gap-2 items-center">
        <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} placeholder="Nom, fournisseur, référence..." />
        <button className="btn-secondary text-xs" onClick={load}>Filtrer</button>
        <select value={type} onChange={(e) => setType(e.target.value as DocumentType | 'all' | '__none' | '')}>
          {DOC_TYPES.map((t) => <option key={t.value || 'empty'} value={t.value}>{t.label}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={orphanOnly} onChange={(e) => setOrphanOnly(e.target.checked)} />
          Sans association uniquement
        </label>
        <select value={view} onChange={(e) => setView(e.target.value as typeof view)}>
          <option value="cards">Vue cartes</option>
          <option value="table">Vue tableau</option>
        </select>
      </div>

      <SavedFiltersBar entityType="documents" currentState={filters} onApply={applyFilter} />

      {selected.length > 0 && (
        <div className="card p-3 flex flex-wrap items-center gap-2">
          <strong>{selected.length} sélectionné(s)</strong>
          <button className="btn-secondary text-xs" onClick={bulkType}>Changer type</button>
          <button className="btn-secondary text-xs" onClick={markClassed}>Marquer classé</button>
          <button className="btn-secondary text-xs" onClick={() => setSelected([])}>Annuler sélection</button>
        </div>
      )}

      {view === 'cards' ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {docs.map((doc) => (
            <article className="card p-4" key={doc.id}>
              <div className="flex items-start gap-3">
                <input type="checkbox" checked={selected.includes(doc.id)} onChange={() => toggleSelected(doc.id)} />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="pill">{ext(doc)}</span>
                    <span className="pill">{doc.document_type || 'Sans type'}</span>
                    {doc.amount != null && <span className="pill">{eur(doc.amount)}</span>}
                    {doc.extracted_sku && <span className="pill">SKU détecté: {doc.extracted_sku}</span>}
                    {doc.match_status && <span className="pill">Match: {doc.match_status}</span>}
                  </div>
                  <h2 className="text-base font-semibold mt-3 truncate">{doc.original_file_name ?? doc.file_name}</h2>
                  <p className="text-sm text-slate-500 mt-1">{doc.supplier_or_customer ?? doc.external_reference ?? 'Aucune référence détectée'}</p>
                  <p className="text-xs text-slate-500 mt-2">Date : {shortDate(doc.date ?? doc.created_at)}</p>
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2 mt-4">
                <button className="btn-secondary text-xs" onClick={() => api.docs.open(doc.id)}>Ouvrir</button>
                <button className="btn-primary text-xs" onClick={() => setLinkDoc(doc)}>Associer</button>
                <button className="btn-secondary text-xs" onClick={() => setChangeTypeDoc(doc)}>Changer type</button>
                <button className="btn-danger text-xs" onClick={() => deleteDoc(doc)}>Supprimer</button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="card overflow-auto">
          <table className="w-full text-sm">
            <thead><tr>
              <th className="px-2 py-2"></th>
              <th className="px-2 py-2 text-left">Fichier</th>
              <th className="px-2 py-2 text-left">Type</th>
                  <th className="px-2 py-2 text-left">Date</th>
              <th className="px-2 py-2 text-left">SKU détecté</th>
              <th className="px-2 py-2 text-right">Montant</th>
              <th className="px-2 py-2"></th>
            </tr></thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id} className="border-t">
                  <td className="px-2 py-2"><input type="checkbox" checked={selected.includes(doc.id)} onChange={() => toggleSelected(doc.id)} /></td>
                  <td className="px-2 py-2">{doc.original_file_name ?? doc.file_name}</td>
                  <td className="px-2 py-2">{doc.document_type ?? '—'}</td>
                  <td className="px-2 py-2">{shortDate(doc.date ?? doc.created_at)}</td>
                  <td className="px-2 py-2">{doc.extracted_sku ?? '—'}</td>
                  <td className="px-2 py-2 text-right">{eur(doc.amount)}</td>
                  <td className="px-2 py-2 text-right">
                    <button className="text-xs" onClick={() => setLinkDoc(doc)}>Associer</button>
                    <button className="text-xs" onClick={() => api.docs.open(doc.id)}>Ouvrir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {docs.length === 0 && (
        <EmptyState icon="🗂️" title="Aucun document à afficher" description="Modifiez les filtres ou ajoutez un justificatif." />
      )}

      {addOpen && <DocumentForm onClose={() => setAddOpen(false)} onSaved={load} />}
      {linkDoc && <LinkDocumentModal doc={linkDoc} onClose={() => setLinkDoc(null)} onSaved={load} />}
      {changeTypeDoc && (
        <ChangeTypeModal
          doc={changeTypeDoc}
          onClose={() => setChangeTypeDoc(null)}
          onSaved={() => { setChangeTypeDoc(null); load(); }}
        />
      )}
    </div>
  );
}

function LinkDocumentModal({ doc, onClose, onSaved }: { doc: Document; onClose: () => void; onSaved: () => void }) {
  const [entityType, setEntityType] = useState<DocumentLink['entity_type']>('sale');
  const [entityId, setEntityId] = useState('');
  const toast = useToast();

  const link = async () => {
    const id = Number(entityId);
    if (!id) return toast.warning('ID obligatoire');
    await api.docs.link({ document_id: doc.id, entity_type: entityType, entity_id: id });
    toast.success('Document associé');
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onMouseDown={onClose}>
      <div className="card p-5 w-[520px] max-w-[95vw]" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">Associer document</h2>
        <p className="text-sm text-slate-500 mt-1 truncate">{doc.original_file_name ?? doc.file_name}</p>
        <div className="grid grid-cols-2 gap-3 mt-4">
          <label className="text-sm">Entité
            <select className="w-full mt-1" value={entityType} onChange={(e) => setEntityType(e.target.value as DocumentLink['entity_type'])}>
              <option value="sale">Vente</option>
              <option value="purchase">Achat</option>
              <option value="expense">Dépense</option>
              <option value="stock_item">Stock</option>
              <option value="declaration">Déclaration</option>
              <option value="boost">Boost</option>
            </select>
          </label>
          <label className="text-sm">ID
            <input className="w-full mt-1" value={entityId} onChange={(e) => setEntityId(e.target.value)} placeholder="Ex. 42" />
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" onClick={link}>Associer</button>
        </div>
      </div>
    </div>
  );
}

function ChangeTypeModal({ doc, onClose, onSaved }: { doc: Document; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<DocumentType | ''>((doc.document_type as DocumentType | null) ?? 'autre');
  const save = async () => {
    await api.docs.update(doc.id, { document_type: type || null });
    onSaved();
  };
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onMouseDown={onClose}>
      <div className="card p-5 w-[420px] max-w-[95vw]" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">Changer type</h2>
        <select className="w-full mt-4" value={type} onChange={(e) => setType(e.target.value as DocumentType | '')}>
          {DOC_TYPES.filter((d) => d.value !== 'all' && d.value !== '__none').map((t) => <option key={t.value || 'empty'} value={t.value}>{t.label}</option>)}
        </select>
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" onClick={save}>Enregistrer</button>
        </div>
      </div>
    </div>
  );
}
