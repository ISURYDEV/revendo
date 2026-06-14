import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { longDate } from '../lib/format';
import EmptyState from '../components/EmptyState';
import SavedFiltersBar from '../components/SavedFiltersBar';
import { useToast } from '../components/Toast';
import type { ReviewCenterResult, ReviewItem, ReviewModule, ReviewSeverity } from '../../shared/types';

const SEVERITY_LABEL: Record<ReviewSeverity, { label: string; className: string; icon: string }> = {
  critical: { label: 'Critique', className: 'review-severity-critical', icon: '🚨' },
  important: { label: 'Important', className: 'review-severity-important', icon: '⚠️' },
  review: { label: 'À vérifier', className: 'review-severity-review', icon: '🔎' },
  info: { label: 'Info', className: 'review-severity-info', icon: 'ℹ️' }
};

const MODULE_LABEL: Record<ReviewModule, { label: string; icon: string }> = {
  sales: { label: 'Ventes', icon: '🛍️' },
  stock: { label: 'Stock', icon: '📦' },
  purchases: { label: 'Achats', icon: '📄' },
  expenses: { label: 'Dépenses', icon: '💸' },
  documents: { label: 'Documents', icon: '🗂️' },
  urssaf: { label: 'URSSAF', icon: '🇫🇷' }
};

type DialogTarget =
  | { kind: 'single'; item: ReviewItem; action: 'verified' | 'ignored' }
  | { kind: 'bulk'; keys: string[]; action: 'verified' | 'ignored' };

export default function ReviewCenter() {
  const [severity, setSeverity] = useState<ReviewSeverity | 'all'>('all');
  const [module, setModule] = useState<ReviewModule | 'all'>('all');
  const [data, setData] = useState<ReviewCenterResult | null>(null);
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const [note, setNote] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const toast = useToast();

  const load = () => api.review.summary({ severity, module }).then((res) => {
    setData(res);
    // Au rechargement, on nettoie la sélection des clés qui ne sont plus visibles.
    setSelected((prev) => {
      const visibleKeys = new Set(res.items.map((i) => i.key));
      const next = new Set<string>();
      prev.forEach((k) => { if (visibleKeys.has(k)) next.add(k); });
      return next;
    });
  });
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [severity, module]);

  const filters = useMemo(() => ({ severity, module }), [severity, module]);
  const items = data?.items ?? [];

  const applySavedFilter = (state: Record<string, unknown>) => {
    setSeverity((state.severity as ReviewSeverity | 'all') ?? 'all');
    setModule((state.module as ReviewModule | 'all') ?? 'all');
  };

  const toggleOne = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const allSelected = items.length > 0 && items.every((i) => selected.has(i.key));
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((i) => i.key)));
    }
  };

  const openBulkDialog = (action: 'verified' | 'ignored') => {
    if (selected.size === 0) return;
    setNote('');
    setDialog({ kind: 'bulk', keys: Array.from(selected), action });
  };

  const openSingleDialog = (item: ReviewItem, action: 'verified' | 'ignored') => {
    setNote('');
    setDialog({ kind: 'single', item, action });
  };

  const confirmDialog = async () => {
    if (!dialog) return;
    if (!note.trim()) {
      toast.warning('Note obligatoire', 'Ajoutez une courte raison pour garder une trace.');
      return;
    }
    setBusy(true);
    try {
      if (dialog.kind === 'single') {
        await api.review.mark({
          key: dialog.item.key,
          module: dialog.item.module,
          entity_type: dialog.item.entity_type,
          entity_id: dialog.item.entity_id,
          status: dialog.action,
          note
        });
        toast.success(dialog.action === 'verified' ? 'Élément vérifié' : 'Élément masqué');
      } else {
        const pickedItems = items.filter((i) => dialog.keys.includes(i.key));
        if (pickedItems.length === 0) {
          toast.warning('Aucun élément sélectionné', 'La sélection est vide.');
          return;
        }
        const r = await api.review.markBulk({
          items: pickedItems.map((i) => ({
            key: i.key,
            module: i.module,
            entity_type: i.entity_type,
            entity_id: i.entity_id
          })),
          status: dialog.action,
          note
        });
        toast.success(
          dialog.action === 'verified' ? 'Éléments vérifiés' : 'Éléments masqués',
          `${r.processed} élément(s) traité(s).`
        );
        setSelected(new Set());
      }
      setDialog(null);
      setNote('');
      load();
    } catch (err) {
      toast.error('Action impossible', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const openDocument = async (documentId: number) => {
    try {
      await api.docs.open(documentId);
    } catch (err) {
      toast.error('Ouverture impossible', err instanceof Error ? err.message : String(err));
    }
  };

  // Les entrées « info » ne sont pas masquables individuellement ;
  // en sélection multiple, on les ignore silencieusement pour Masquer.
  const selectableMaskCount = items.filter((i) => selected.has(i.key) && i.severity !== 'info').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">🧭 Centre de révision</h1>
          <p className="text-sm text-slate-500 mt-1">La boîte de réception des éléments à vérifier avant qu'ils deviennent un problème.</p>
        </div>
        <button className="btn-secondary" onClick={load}>↻ Actualiser</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="card p-4">
          <div className="text-xs uppercase text-slate-500 font-semibold">Total à traiter</div>
          <div className="text-3xl font-bold mt-1">{data?.total ?? '—'}</div>
        </div>
        {(['critical', 'important', 'review'] as ReviewSeverity[]).map((s) => (
          <button key={s} type="button" className={`card p-4 text-left ${SEVERITY_LABEL[s].className}`} onClick={() => setSeverity(s)}>
            <div className="text-xs uppercase text-slate-500 font-semibold">{SEVERITY_LABEL[s].icon} {SEVERITY_LABEL[s].label}</div>
            <div className="text-3xl font-bold mt-1">{data?.bySeverity[s] ?? 0}</div>
          </button>
        ))}
      </div>

      <div className="card p-3 flex flex-wrap gap-2 items-center">
        <select value={severity} onChange={(e) => setSeverity(e.target.value as ReviewSeverity | 'all')}>
          <option value="all">Toutes gravités</option>
          {Object.entries(SEVERITY_LABEL).map(([key, v]) => <option key={key} value={key}>{v.label}</option>)}
        </select>
        <select value={module} onChange={(e) => setModule(e.target.value as ReviewModule | 'all')}>
          <option value="all">Tous modules</option>
          {Object.entries(MODULE_LABEL).map(([key, v]) => <option key={key} value={key}>{v.label}</option>)}
        </select>
        <button className="btn-secondary text-xs" onClick={() => { setSeverity('all'); setModule('all'); }}>Tout voir</button>
      </div>

      <SavedFiltersBar entityType="review" currentState={filters} onApply={applySavedFilter} />

      {/* Barre d'actions de masse + sélection */}
      {items.length > 0 && (
        <div className="card p-3 flex flex-wrap items-center gap-3 sticky top-0 z-10 bg-white/95 backdrop-blur">
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => { if (el) el.indeterminate = someSelected; }}
              onChange={toggleAll}
              aria-label="Tout sélectionner"
            />
            <span>
              {selected.size > 0
                ? `${selected.size} sélectionné(s)`
                : `Tout sélectionner (${items.length})`}
            </span>
          </label>
          {selected.size > 0 && (
            <>
              <button
                className="btn-primary text-xs"
                disabled={busy}
                onClick={() => openBulkDialog('verified')}
              >
                ✓ Marquer {selected.size} comme vérifié(s)
              </button>
              <button
                className="btn-secondary text-xs"
                disabled={busy || selectableMaskCount === 0}
                title={selectableMaskCount < selected.size ? `${selected.size - selectableMaskCount} entrée(s) « Info » ne peuvent pas être masquées` : undefined}
                onClick={() => openBulkDialog('ignored')}
              >
                🙈 Masquer {selectableMaskCount} alerte(s)
              </button>
              <button
                className="btn-secondary text-xs ml-auto"
                onClick={() => setSelected(new Set())}
              >
                Désélectionner
              </button>
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {items.map((item) => {
          const checked = selected.has(item.key);
          return (
            <article key={item.key} className={`card p-4 review-item ${checked ? 'ring-2 ring-brand-500' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-3 items-start flex-1">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked}
                    onChange={() => toggleOne(item.key)}
                    aria-label={`Sélectionner ${item.title}`}
                  />
                  <div>
                    <div className="flex flex-wrap gap-2 items-center">
                      <span className={`review-severity ${SEVERITY_LABEL[item.severity].className}`}>
                        {SEVERITY_LABEL[item.severity].icon} {SEVERITY_LABEL[item.severity].label}
                      </span>
                      <span className="pill">{MODULE_LABEL[item.module].icon} {MODULE_LABEL[item.module].label}</span>
                    </div>
                    <h2 className="text-base font-semibold mt-3">{item.title}</h2>
                    <p className="text-sm text-slate-500 mt-1">{item.description}</p>
                    {item.document_id && (
                      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-600 space-y-1">
                        <div><strong>Document:</strong> {item.document_file_name ?? `#${item.document_id}`}</div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          <span>Type: {item.document_type || 'Non défini'}</span>
                          <span>Date: {item.document_date ? longDate(item.document_date) : '—'}</span>
                          <span>Montant: {item.document_amount != null ? `${item.document_amount.toFixed(2)} €` : '—'}</span>
                          <span>Statut: {item.association_status ?? 'À vérifier'}</span>
                          {item.associated_entity && <span>Lié à: {item.associated_entity}</span>}
                        </div>
                      </div>
                    )}
                    <p className="text-xs text-slate-500 mt-2">Créé / mis à jour : {longDate(item.created_at)}</p>
                  </div>
                </div>
                <div className="flex flex-col gap-2 min-w-[120px]">
                  {item.document_id && (
                    <button className="btn-secondary text-xs" onClick={() => openDocument(item.document_id!)}>
                      Ouvrir le document
                    </button>
                  )}
                  <button className="btn-primary text-xs" onClick={() => nav(item.route)}>
                    {item.action === 'correct' ? 'Corriger' : item.action === 'associate' ? 'Associer' : 'Ouvrir'}
                  </button>
                  <button className="btn-secondary text-xs" onClick={() => openSingleDialog(item, 'verified')}>Marquer vérifié</button>
                  {item.severity !== 'info' && (
                    <button className="btn-secondary text-xs" onClick={() => openSingleDialog(item, 'ignored')}>Masquer</button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {items.length === 0 && (
        <EmptyState
          icon="✅"
          title="Tout est à jour"
          description="Aucun élément ne correspond aux filtres actuels. Revendo ne modifie rien automatiquement dans ce centre."
        />
      )}

      {dialog && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onMouseDown={() => setDialog(null)}>
          <div className="card p-5 w-[520px] max-w-[95vw]" onMouseDown={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold">
              {dialog.kind === 'bulk'
                ? (dialog.action === 'verified'
                    ? `Marquer ${dialog.keys.length} élément(s) comme vérifié(s)`
                    : `Masquer ${dialog.keys.filter((k) => items.find((i) => i.key === k && i.severity !== 'info')).length} alerte(s)`)
                : (dialog.action === 'verified' ? 'Marquer comme vérifié' : 'Masquer cette alerte')}
            </h2>
            {dialog.kind === 'single' && (
              <p className="text-sm text-slate-500 mt-1">{dialog.item.title}</p>
            )}
            {dialog.kind === 'bulk' && (
              <p className="text-sm text-slate-500 mt-1">
                La même note s'appliquera à toutes les entrées sélectionnées.
              </p>
            )}
            <textarea
              className="w-full mt-4"
              rows={4}
              value={note}
              autoFocus
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note obligatoire..."
            />
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn-secondary" onClick={() => setDialog(null)} disabled={busy}>Annuler</button>
              <button className="btn-primary" onClick={confirmDialog} disabled={busy}>
                {busy ? 'Traitement…' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
