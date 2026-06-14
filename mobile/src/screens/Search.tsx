import { useMemo, useState } from 'react';
import { useSnapshot } from '../components/SnapshotContext';
import { searchSnapshot, type SearchHit } from '../services/search';
import { eur, shortDate } from '../services/formatter';
import { Empty } from '../components/Empty';

const SOURCE_LABEL: Record<SearchHit['source'], string> = {
  sale: 'Vente',
  stock: 'Stock',
  expense: 'Dépense',
  purchase: 'Achat',
  document: 'Document'
};

export default function SearchScreen() {
  const { snapshot } = useSnapshot();
  const [query, setQuery] = useState('');
  const hits = useMemo(() => searchSnapshot(snapshot, query), [snapshot, query]);

  if (!snapshot) return <Empty title="Aucun snapshot." />;

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">Recherche</h1>
      <input
        className="input"
        type="search"
        placeholder="Nom, SKU, acheteur, fournisseur, n° de pièce…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <div className="text-xs text-slate-500">{hits.length} résultat(s)</div>
      <ul className="space-y-2">
        {hits.map((h, i) => (
          <li key={`${h.source}-${i}`} className="card">
            <div className="text-[10px] uppercase text-slate-500">{SOURCE_LABEL[h.source]}</div>
            <div className="font-medium truncate">{h.title}</div>
            <div className="flex justify-between items-baseline mt-1 text-xs text-slate-500">
              <span className="truncate">{h.subtitle || '—'}</span>
              <span className="text-right">
                {h.amount != null && <span className="font-semibold text-slate-700">{eur(h.amount)}</span>}
                {h.date && <span className="ml-2">{shortDate(h.date)}</span>}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {hits.length === 0 && query && <Empty title="Aucun résultat." />}
    </div>
  );
}
