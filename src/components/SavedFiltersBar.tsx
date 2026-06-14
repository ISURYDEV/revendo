import { useEffect, useState } from 'react';
import { notify } from '../lib/notify';
import { api } from '../lib/api';
import type { SavedFilter } from '../../shared/types';

export default function SavedFiltersBar({
  entityType,
  currentState,
  onApply
}: {
  entityType: string;
  currentState: Record<string, unknown>;
  onApply: (state: Record<string, unknown>) => void;
}) {
  const [filters, setFilters] = useState<SavedFilter[]>([]);

  const load = () => api.savedFilters.list(entityType).then(setFilters);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [entityType]);

  const save = async () => {
    const name = window.prompt('Nom du filtre à enregistrer');
    if (!name?.trim()) return;
    await api.savedFilters.create({ entity_type: entityType, name, filter_state: currentState });
    load();
  };

  const apply = (f: SavedFilter) => {
    try {
      onApply(JSON.parse(f.filter_state_json || '{}'));
    } catch {
      notify('Filtre invalide ou ancien format.');
    }
  };

  const rename = async (f: SavedFilter) => {
    const name = window.prompt('Nouveau nom du filtre', f.name);
    if (!name?.trim()) return;
    await api.savedFilters.update(f.id, { name });
    load();
  };

  const toggleFavorite = async (f: SavedFilter) => {
    await api.savedFilters.update(f.id, { is_favorite: !f.is_favorite });
    load();
  };

  const remove = async (f: SavedFilter) => {
    if (!window.confirm(`Supprimer le filtre "${f.name}" ?`)) return;
    await api.savedFilters.delete(f.id);
    load();
  };

  return (
    <div className="saved-filters-bar">
      <button type="button" className="btn-secondary text-xs" onClick={save}>💾 Enregistrer le filtre</button>
      {filters.length === 0 ? (
        <span className="text-xs text-slate-500">Aucun filtre enregistré pour cette vue.</span>
      ) : (
        filters.map((f) => (
          <span key={f.id} className={`saved-filter-chip ${f.is_favorite ? 'is-favorite' : ''}`}>
            <button type="button" onClick={() => apply(f)}>{f.is_favorite ? '★ ' : ''}{f.name}</button>
            <button type="button" title="Favori" onClick={() => toggleFavorite(f)}>★</button>
            <button type="button" title="Renommer" onClick={() => rename(f)}>✎</button>
            <button type="button" title="Supprimer" onClick={() => remove(f)}>×</button>
          </span>
        ))
      )}
    </div>
  );
}
