import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { eur, longDate, shortDate } from '../lib/format';
import FiscalWarning from '../components/FiscalWarning';
import SeuilsBar from '../components/SeuilsBar';
import RemindersBanner from '../components/RemindersBanner';
import FirstRunWizard from '../components/FirstRunWizard';
import CloudSyncBadge from '../components/CloudSyncBadge';
import RatesVerificationBanner from '../components/RatesVerificationBanner';
import { useLocalStorage } from '../lib/useLocalStorage';
import { Skeleton } from '../components/Skeleton';

type Range = 'this_month' | 'last_month' | 'all_time';
const RANGE_LABEL: Record<Range, string> = {
  this_month: 'Ce mois-ci',
  last_month: 'Mois dernier',
  all_time: 'Depuis toujours'
};

type Figures = Awaited<ReturnType<typeof api.dashboardFull.figures>>;

export default function Dashboard() {
  const [range, setRange] = useLocalStorage<Range>('dashboard.range', 'this_month');
  const [data, setData] = useState<Figures | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [stale, setStale] = useState<Awaited<ReturnType<typeof api.analytics.staleStock>>>([]);
  const [prediction, setPrediction] = useState<Awaited<ReturnType<typeof api.analytics.prediction>>>(null);
  const nav = useNavigate();

  const load = () => api.dashboardFull.figures(range).then(setData);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [range]);
  useEffect(() => {
    api.wizard.needed().then(({ needed }) => { if (needed) setShowWizard(true); });
    api.analytics.staleStock(90).then(setStale);
    api.analytics.prediction().then(setPrediction);
  }, []);

  if (!data) return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-2 gap-4"><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
      <Skeleton className="h-24" />
      <Skeleton className="h-40" />
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Tableau de bord</h1>
        <div className="flex gap-1 bg-white border border-slate-300 rounded p-1">
          {(['this_month', 'last_month', 'all_time'] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1 text-sm rounded ${range === r ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      <RatesVerificationBanner />
      <RemindersBanner />
      <CloudSyncBadge />

      {/* BIG figures */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card p-6 bg-gradient-to-br from-emerald-50 to-white border-emerald-200">
          <div className="text-xs uppercase tracking-wide text-emerald-700 font-semibold">Chiffre d'affaires</div>
          <div className="text-4xl font-bold text-emerald-700 mt-2">{eur(data.caTotal)}</div>
          <div className="text-xs text-slate-500 mt-1">{RANGE_LABEL[range]} · uniquement ventes professionnelles déclarables</div>
        </div>
        <div className={`card p-6 bg-gradient-to-br ${data.profitNet >= 0 ? 'from-sky-50' : 'from-red-50'} to-white border-slate-200`}>
          <div className="text-xs uppercase tracking-wide text-slate-700 font-semibold">Bénéfice net estimé</div>
          <div className={`text-4xl font-bold mt-2 ${data.profitNet >= 0 ? 'text-sky-700' : 'text-red-700'}`}>{eur(data.profitNet)}</div>
          <div className="text-xs text-slate-500 mt-1">CA − coût stock vendu − dépenses (estimation interne)</div>
        </div>
      </div>

      <SeuilsBar />
      <FiscalWarning />

      {/* Packages info */}
      <section className="card p-4">
        <h2 className="text-lg font-semibold mb-3">Informations colis</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-3 bg-emerald-50 rounded">
            <div className="text-3xl font-bold text-emerald-700">{data.salesCompleted}</div>
            <div className="text-xs text-emerald-700 mt-1">Ventes encaissées</div>
          </div>
          <div className="text-center p-3 bg-amber-50 rounded">
            <div className="text-3xl font-bold text-amber-700">{data.packagesInTransit}</div>
            <div className="text-xs text-amber-700 mt-1">Colis en cours d'expédition</div>
          </div>
          <div className="text-center p-3 bg-red-50 rounded">
            <div className="text-3xl font-bold text-red-700">{data.cancellations}</div>
            <div className="text-xs text-red-700 mt-1">Annulations / remboursements</div>
          </div>
        </div>
      </section>

      {/* Quarter prediction */}
      {prediction && (
        <section className="card p-4">
          <h2 className="text-lg font-semibold mb-2">Projection trimestre en cours</h2>
          <div className="grid grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-xs text-slate-500">CA encaissé jusqu'ici</div>
              <div className="text-xl font-bold text-emerald-700">{eur(prediction.caSoFar)}</div>
              <div className="text-xs text-slate-500">Jour {prediction.daysElapsed} / {prediction.daysTotal}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Projection fin trimestre</div>
              <div className="text-xl font-bold text-sky-700">{eur(prediction.caProjectedEndOfQuarter)}</div>
              <div className="text-xs text-slate-500">À ce rythme, {prediction.daysRemaining} jours restants</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Cotisations estimées</div>
              <div className="text-xl font-bold text-amber-700">{eur(prediction.cotisationsProjected)}</div>
              <div className="text-xs text-slate-500">À provisionner</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Confiance projection</div>
              <div className={`text-xl font-bold ${prediction.confidenceLabel === 'high' ? 'text-emerald-700' : prediction.confidenceLabel === 'medium' ? 'text-amber-700' : 'text-red-700'}`}>
                {prediction.confidenceLabel === 'high' ? 'Élevée' : prediction.confidenceLabel === 'medium' ? 'Moyenne' : 'Faible'}
              </div>
              <div className="text-xs text-slate-500">Plus de jours = plus précis</div>
            </div>
          </div>
        </section>
      )}

      {/* Stale stock alert */}
      {stale.length > 0 && (
        <section className="card p-4 border-amber-300 bg-amber-50/30">
          <h2 className="text-lg font-semibold mb-2 text-amber-800">📦 Stock dormant (sans mouvement depuis 90 jours)</h2>
          <p className="text-xs text-slate-600 mb-2">{stale.length} article(s) à revoir : baisser le prix, déstocker, donner ou archiver.</p>
          <div className="space-y-1 max-h-64 overflow-auto">
            {stale.slice(0, 10).map((s) => (
              <div key={s.id} className="flex justify-between items-center text-sm bg-white rounded p-2 border border-slate-200">
                <div className="flex-1 truncate"><span className="font-mono text-xs text-slate-500">{s.internal_code}</span> · {s.name}</div>
                <div className="text-xs text-slate-500">{s.days_since_update}j · {eur(s.unit_cost_ttc)}</div>
              </div>
            ))}
          </div>
          {stale.length > 10 && <div className="text-xs text-slate-500 mt-1">+ {stale.length - 10} autres…</div>}
        </section>
      )}

      {/* Weekly verification */}
      <WeeklyCheck data={data} onChange={load} onGoTo={(route) => nav(route)} />

      {showWizard && <FirstRunWizard onClose={() => setShowWizard(false)} />}
    </div>
  );
}

function WeeklyCheck({ data, onChange, onGoTo }: { data: Figures; onChange: () => void; onGoTo: (r: string) => void }) {
  const [sales, setSales] = useState(false);
  const [purchases, setPurchases] = useState(false);
  const [expenses, setExpenses] = useState(false);

  const isStale = (d: number | null) => d == null || d >= 7;
  const ageText = (d: number | null, last: string | null): string => {
    if (d == null) return 'Jamais vérifié';
    if (d === 0) return 'Aujourd\'hui';
    return `Il y a ${d} jour(s) — ${longDate(last)}`;
  };

  const onConfirm = async () => {
    if (!sales && !purchases && !expenses) return;
    await api.dashboardFull.markCheck({ sales, purchases, expenses });
    setSales(false); setPurchases(false); setExpenses(false);
    onChange();
  };

  const sections: Array<{ key: 'sales' | 'purchases' | 'expenses'; label: string; route: string; checked: boolean; set: (b: boolean) => void; age: number | null; last: string | null }> = [
    { key: 'sales', label: 'Ventes', route: '/imports', checked: sales, set: setSales, age: data.daysSinceSales, last: data.lastCheckedSales },
    { key: 'purchases', label: 'Justificatifs d\'achats', route: '/imports', checked: purchases, set: setPurchases, age: data.daysSincePurchases, last: data.lastCheckedPurchases },
    { key: 'expenses', label: 'Dépenses', route: '/imports', checked: expenses, set: setExpenses, age: data.daysSinceExpenses, last: data.lastCheckedExpenses }
  ];

  return (
    <section className="card p-4">
      <h2 className="text-lg font-semibold mb-1">Vérification hebdomadaire</h2>
      <p className="text-xs text-slate-500 mb-3">
        Cochez la case quand vous avez importé / mis à jour les données. Si plus de 7 jours passent sans
        mise à jour, vous verrez un rappel coloré.
      </p>
      <div className="space-y-2">
        {sections.map((s) => (
          <div key={s.key} className={`flex items-center gap-3 p-3 rounded border ${isStale(s.age) ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
            <input
              type="checkbox"
              checked={s.checked}
              onChange={(e) => s.set(e.target.checked)}
              className="w-4 h-4"
            />
            <div className="flex-1">
              <div className="font-medium">{s.label}</div>
              <div className={`text-xs ${isStale(s.age) ? 'text-amber-700' : 'text-slate-500'}`}>
                {ageText(s.age, s.last)}
              </div>
            </div>
            <button className="text-xs text-brand-600 hover:underline" onClick={() => onGoTo(s.route)}>
              Aller importer →
            </button>
          </div>
        ))}
      </div>
      <div className="flex justify-end mt-3">
        <button
          className="btn-primary disabled:opacity-50"
          onClick={onConfirm}
          disabled={!sales && !purchases && !expenses}
        >
          Tout est à jour, réinitialiser le compteur
        </button>
      </div>
    </section>
  );
}
