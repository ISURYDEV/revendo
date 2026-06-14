import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { eur } from '../lib/format';

export default function SeuilsBar() {
  const [s, setS] = useState<Awaited<ReturnType<typeof api.seuils.status>> | null>(null);
  useEffect(() => { api.seuils.status().then(setS); }, []);
  if (!s) return null;

  const pct = Math.min(Math.max(s.marchandisesPct, 0), 1) * 100;
  const pctText = (s.marchandisesPct * 100).toFixed(1);
  const tone =
    s.level === 'over' ? 'over'
    : s.level === 'danger' ? 'danger'
    : s.level === 'warning' ? 'warning'
    : 'safe';
  const levelLabel =
    s.level === 'over' ? 'Seuil dépassé'
    : s.level === 'danger' ? 'Zone rouge'
    : s.level === 'warning' ? 'À surveiller'
    : 'Marge confortable';

  return (
    <div className={`seuil-card seuil-card-${tone}`}>
      <div className="seuil-head">
        <div className="min-w-0">
          <div className="seuil-kicker">Seuil micro-entreprise {s.year}</div>
          <div className="seuil-title">
            <span>CA cumulé</span>
            <strong>{eur(s.caUrssaf)}</strong>
          </div>
          <div className="seuil-subtitle">
            Objectif réglementaire vente de marchandises : {eur(s.seuilMarchandises)}
          </div>
        </div>
        <div className="seuil-badge">
          <span>{pctText} %</span>
          <small>{levelLabel}</small>
        </div>
      </div>
      <div className="seuil-track" aria-label={`CA cumulé ${pctText} % du seuil`}>
        <div className={`seuil-fill seuil-fill-${tone}`} style={{ width: `${pct}%` }} />
        <span className="seuil-marker seuil-marker-warning" title="75 %" />
        <span className="seuil-marker seuil-marker-danger" title="90 %" />
      </div>
      <div className="seuil-meta">
        <span>{s.message}</span>
        <span>Franchise TVA : {(s.tvaPct * 100).toFixed(1)} % / {eur(s.seuilTvaFranchise)}</span>
      </div>
    </div>
  );
}
