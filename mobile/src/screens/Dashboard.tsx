import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useSnapshot } from '../components/SnapshotContext';
import { Empty } from '../components/Empty';
import { eur, shortDate } from '../services/formatter';
import { listPending } from '../storage/actions';

interface DeclarationLite {
  year?: number;
  quarter?: number;
  caGoods?: number;
  includedSalesCount?: number;
  personalSalesCount?: number;
  dueDate?: string;
  isFirstDeclaration?: boolean;
}

export default function Dashboard() {
  const { snapshot, importedAt, loading } = useSnapshot();
  const [pending, setPending] = useState<number>(0);
  useEffect(() => { listPending().then((p) => setPending(p.length)); }, [importedAt]);

  if (loading) return <div className="text-slate-500">Chargement…</div>;
  if (!snapshot) {
    return (
      <Empty
        title="Aucun snapshot importé"
        hint="Générez un snapshot mobile depuis Revendo desktop, puis importez-le ici via Réglages → Importer un snapshot."
        ctaTo="/settings"
        ctaLabel="Importer un snapshot"
      />
    );
  }

  const totals = snapshot.totals;
  const declarations = (snapshot.declarations as DeclarationLite[]) ?? [];
  // Find the most recent quarter (or first declaration)
  const today = new Date();
  const currentYear = today.getUTCFullYear();
  const currentQuarter = Math.floor(today.getUTCMonth() / 3) + 1;
  const current = declarations.find((d) => d.year === currentYear && d.quarter === currentQuarter) ?? declarations[0];

  return (
    <div className="space-y-3">
      <header className="flex justify-between items-baseline">
        <h1 className="text-xl font-bold">Revendo Mobile</h1>
        <Link to="/settings" className="text-xs text-brand-600">⚙️ Réglages</Link>
      </header>

      <div className="text-xs text-slate-500">
        Snapshot importé le {shortDate(importedAt ?? '')} · schéma {snapshot.schema_version}
        {snapshot.redaction_mode === 'anonymized' && <> · 🛡️ anonymisé</>}
      </div>

      {pending > 0 && (
        <Link to="/settings" className="block card border-amber-400 bg-amber-50 text-amber-800 text-sm">
          ⚠️ {pending} action(s) en attente d'export vers le PC.
        </Link>
      )}

      <div className="card">
        <div className="text-xs text-slate-500">CA URSSAF — trimestre en cours</div>
        <div className="text-3xl font-bold mt-1">{eur(current?.caGoods ?? 0)}</div>
        <div className="text-xs text-slate-500 mt-1">
          {current ? `Q${current.quarter} ${current.year} · ${current.includedSalesCount ?? 0} vente(s) incluses` : '—'}
        </div>
        {current?.dueDate && (
          <div className="text-xs text-slate-500 mt-1">Échéance : {shortDate(current.dueDate)}</div>
        )}
        {current?.isFirstDeclaration && (
          <div className="text-[11px] text-amber-700 mt-1">Première déclaration (Q1+Q2 combinés).</div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Stock en maison" value={totals.stock_count} sub={eur(totals.stock_value)} />
        <Stat label="Ventes complétées" value={totals.sales_completed} />
        <Stat label="En cours d'expédition" value={totals.in_transit} />
        <Stat label="Annulations / remb." value={totals.cancellations} />
      </div>

      <div className="card">
        <div className="text-xs text-slate-500 mb-1">Ventes personnelles hors activité</div>
        <div className="text-lg font-semibold">{current?.personalSalesCount ?? 0}</div>
        <div className="text-[11px] text-slate-500 mt-1">
          Ces ventes ne sont pas déclarables URSSAF.
        </div>
      </div>

      <div className="card">
        <div className="text-xs text-slate-500 mb-1">Dépenses totales</div>
        <div className="text-lg font-semibold">{eur(totals.expenses_total)}</div>
        <div className="text-[11px] text-slate-500 mt-1">
          Les dépenses ne réduisent <strong>jamais</strong> le CA URSSAF.
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Link to="/add-expense" className="btn-primary text-center">➕ Dépense</Link>
        <Link to="/add-stock" className="btn-primary text-center">📦 Stock</Link>
        <Link to="/stock" className="btn-secondary text-center">🔍 Mouvement</Link>
        <Link to="/review" className="btn-secondary text-center">📝 À vérifier</Link>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="card">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}
