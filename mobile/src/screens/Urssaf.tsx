import { useState } from 'react';
import { useSnapshot } from '../components/SnapshotContext';
import { Empty } from '../components/Empty';
import { eur, shortDate } from '../services/formatter';

interface DeclarationLite {
  year?: number;
  quarter?: number;
  caGoods?: number;
  includedSalesCount?: number;
  personalSalesCount?: number;
  personalSalesAmount?: number;
  preActivitySalesCount?: number;
  canceledSalesCount?: number;
  uncertainSalesCount?: number;
  dueDate?: string;
  periodStart?: string;
  periodEnd?: string;
  contributionsApplied?: number;
  acreApplied?: boolean;
  isFirstDeclaration?: boolean;
  firstDeclarationLabel?: string | null;
  status?: 'draft' | 'declared';
}

export default function UrssafScreen() {
  const { snapshot } = useSnapshot();
  const [selected, setSelected] = useState<number>(0);

  if (!snapshot) return <Empty title="Aucun snapshot." hint="Importez un snapshot depuis Réglages." />;
  const declarations = ((snapshot.declarations ?? []) as DeclarationLite[]).filter((d) => d.year != null);
  if (declarations.length === 0) {
    return <Empty title="Aucune déclaration disponible." hint="Le snapshot ne contient pas de trimestre rempli." />;
  }
  const d = declarations[Math.min(selected, declarations.length - 1)];

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">URSSAF — consultation</h1>
      <div className="text-xs text-slate-500">
        Lecture seule. La déclaration finale se fait sur le PC + urssaf.fr.
      </div>

      <select className="input" value={selected} onChange={(e) => setSelected(Number(e.target.value))}>
        {declarations.map((dx, i) => (
          <option key={`${dx.year}-Q${dx.quarter}`} value={i}>
            Q{dx.quarter} {dx.year} {dx.status === 'declared' ? '· déclaré' : '· brouillon'}
          </option>
        ))}
      </select>

      {d.isFirstDeclaration && d.firstDeclarationLabel && (
        <div className="card bg-brand-50 text-brand-700 text-xs">{d.firstDeclarationLabel}</div>
      )}

      <div className="card">
        <div className="text-xs text-slate-500">CA déclarable</div>
        <div className="text-3xl font-bold">{eur(d.caGoods ?? 0)}</div>
        <div className="text-xs text-slate-500 mt-1">
          Période : {shortDate(d.periodStart)} → {shortDate(d.periodEnd)}<br/>
          Échéance : {shortDate(d.dueDate)}
        </div>
      </div>

      <div className="card grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-[10px] uppercase text-slate-500">Ventes incluses</div>
          <div className="text-xl font-semibold">{d.includedSalesCount ?? 0}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-slate-500">Ventes exclues</div>
          <div className="text-xl font-semibold">
            {(d.personalSalesCount ?? 0) + (d.preActivitySalesCount ?? 0) + (d.canceledSalesCount ?? 0) + (d.uncertainSalesCount ?? 0)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-slate-500">Personnelles hors activité</div>
          <div className="text-sm font-medium">{d.personalSalesCount ?? 0} · {eur(d.personalSalesAmount ?? 0)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-slate-500">Annulées / remboursées</div>
          <div className="text-sm font-medium">{d.canceledSalesCount ?? 0}</div>
        </div>
      </div>

      <div className="card">
        <div className="text-xs text-slate-500">Cotisations estimées</div>
        <div className="text-xl font-semibold">{eur(d.contributionsApplied ?? 0)}</div>
        {d.acreApplied && <div className="text-[11px] text-green-700 mt-1">ACRE appliqué (taux réduit).</div>}
      </div>

      <div className="card bg-amber-50 border-amber-300 text-amber-800 text-xs">
        ⚠️ Les dépenses, boosts et coûts d'achat <strong>NE réduisent PAS</strong> le CA URSSAF.
        Ils ne servent qu'à calculer la rentabilité interne.
      </div>
    </div>
  );
}
