import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { eur, shortDate } from '../lib/format';
import type { GlobalSearchResult } from '../../shared/types';

const TYPE_LABEL: Record<GlobalSearchResult['type'], string> = {
  sale: 'Ventes',
  stock_item: 'Stock',
  purchase: 'Achats',
  expense: 'Dépenses',
  document: 'Documents',
  declaration: 'Déclarations'
};

export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      api.search.global(query, 8)
        .then((r) => { if (!cancelled) setResults(r); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, GlobalSearchResult[]>();
    for (const r of results) {
      const label = TYPE_LABEL[r.type];
      map.set(label, [...(map.get(label) ?? []), r]);
    }
    return [...map.entries()];
  }, [results]);

  const go = (route: string) => {
    setOpen(false);
    setQuery('');
    nav(route);
  };

  return (
    <>
      <button type="button" className="global-search-trigger" onClick={() => setOpen(true)}>
        🔎 Rechercher <span>Ctrl+K</span>
      </button>
      {open && (
        <div className="global-search-overlay" onMouseDown={() => setOpen(false)}>
          <div className="global-search-panel" onMouseDown={(e) => e.stopPropagation()}>
            <div className="global-search-input-row">
              <span>🔎</span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Vente, SKU, document, fournisseur, montant..."
              />
              <button type="button" onClick={() => setOpen(false)}>Fermer</button>
            </div>

            {query.trim().length < 2 && (
              <div className="global-search-empty">
                Tapez au moins 2 caractères. Vous pouvez chercher un ID, un SKU, un acheteur, un fournisseur, un montant ou un nom de fichier.
              </div>
            )}
            {query.trim().length >= 2 && loading && <div className="global-search-empty">Recherche...</div>}
            {query.trim().length >= 2 && !loading && results.length === 0 && (
              <div className="global-search-empty">Aucun résultat trouvé.</div>
            )}
            {!loading && grouped.map(([group, items]) => (
              <section key={group} className="global-search-group">
                <h3>{group}</h3>
                {items.map((r) => (
                  <button key={`${r.type}-${r.id}`} type="button" className="global-search-result" onClick={() => go(r.route)}>
                    <div>
                      <strong>{r.title}</strong>
                      <small>{r.subtitle}</small>
                    </div>
                    <div className="global-search-meta">
                      {r.amount != null && <span>{eur(r.amount)}</span>}
                      {r.date && <span>{shortDate(r.date)}</span>}
                      {r.badge && <em>{r.badge}</em>}
                    </div>
                  </button>
                ))}
              </section>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
