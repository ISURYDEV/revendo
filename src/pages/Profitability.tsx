import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { eur, shortDate } from '../lib/format';
import { useLocalStorage } from '../lib/useLocalStorage';
import type { ProfitabilitySummary, QuarterCode } from '../../shared/types';

export default function Profitability() {
  const [year, setYear] = useLocalStorage('profit.year', new Date().getUTCFullYear());
  const [quarter, setQuarter] = useLocalStorage<QuarterCode | 'all'>('profit.quarter', 'all');
  const [s, setS] = useState<ProfitabilitySummary | null>(null);
  const [trends, setTrends] = useState<Awaited<ReturnType<typeof api.analytics.trends>>>([]);
  const [topBuyers, setTopBuyers] = useState<Awaited<ReturnType<typeof api.analytics.topBuyers>>>([]);

  useEffect(() => { api.profit.summary(year, quarter).then(setS); }, [year, quarter]);
  useEffect(() => {
    api.analytics.trends(12).then(setTrends);
    api.analytics.topBuyers(10).then(setTopBuyers);
  }, []);
  if (!s) return <div className="text-slate-500">Chargement…</div>;

  // Compute composition for waterfall chart
  const maxVal = Math.max(s.caKeptActual, s.cogs + s.cogsUnlinked, s.boostsTotal, s.expensesTotal, Math.abs(s.margeReelleEstimee));

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Rentabilité — {s.periodLabel}</h1>
        <div className="flex gap-2">
          <select className="border rounded px-2 py-1 text-sm" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[2024, 2025, 2026, 2027].map((y) => (<option key={y} value={y}>{y}</option>))}
          </select>
          <select className="border rounded px-2 py-1 text-sm" value={quarter} onChange={(e) => setQuarter(e.target.value as QuarterCode | 'all')}>
            <option value="all">Année entière</option>
            <option value="1">T1 (Jan-Mar)</option>
            <option value="2">T2 (Avr-Juin)</option>
            <option value="3">T3 (Jui-Sep)</option>
            <option value="4">T4 (Oct-Déc)</option>
          </select>
        </div>
      </div>

      <div className="alert-warn text-sm">
        <strong>Important :</strong> Le <strong>CA URSSAF</strong> ne déduit PAS les dépenses. La <strong>rentabilité réelle</strong>
        est une estimation interne distincte du CA fiscal. Les <strong>ventes personnelles</strong> hors activité sont
        affichées séparément.
      </div>

      {/* Top 3 BIG figures */}
      <div className="grid grid-cols-3 gap-4">
        <Section title="CA URSSAF déclarable" color="text-emerald-700">
          <Big>{eur(s.caUrssaf)}</Big>
          <div className="text-xs text-slate-500 mt-1">Ventes pro encaissées</div>
        </Section>
        <Section title="Argent réellement reçu" color="text-sky-700">
          <Big>{eur(s.caKeptActual)}</Big>
          <div className="text-xs text-slate-500 mt-1">Pro + personnel + avant début d'activité (encaissées)</div>
        </Section>
        <Section title="Marge réelle estimée" color={s.margeReelleEstimee >= 0 ? 'text-emerald-700' : 'text-red-700'}>
          <Big>{eur(s.margeReelleEstimee)}</Big>
          <div className="text-xs text-slate-500 mt-1">Argent reçu − COGS − boosts − autres dépenses</div>
        </Section>
      </div>

      <div className="alert-info text-xs space-y-1">
        <div>📊 <strong>CA URSSAF</strong> = seulement ventes <strong>pro encaissées</strong> (complétées ou colis perdu indemnisé).</div>
        <div>💰 <strong>Bénéfice / marge</strong> = toutes ventes <strong>encaissées</strong> (pro + personnel + avant début d'activité) car l'argent est dans la poche.</div>
        <div>❌ <strong>Annulées, remboursées, en expédition</strong> sans indemnisation = aucun CA, aucun bénéfice.</div>
      </div>

      {/* Waterfall chart (CA → COGS → Boosts → Expenses → Marge) */}
      <section className="card p-4">
        <h2 className="text-lg font-semibold mb-3">Décomposition du résultat</h2>
        <div className="space-y-2">
          <Bar label="Argent reçu (pro + perso + pre-activité, encaissées)" value={s.caKeptActual} max={maxVal} color="bg-emerald-500" sign="+" />
          <Bar label="Coût stock vendu (lié)" value={s.cogs} max={maxVal} color="bg-red-400" sign="−" />
          <Bar label="Coût stock estimé (sans lien)" value={s.cogsUnlinked} max={maxVal} color="bg-red-300" sign="−" />
          <Bar label="Boosts marketing" value={s.boostsTotal} max={maxVal} color="bg-fuchsia-500" sign="−" />
          <Bar label="Autres dépenses (hors boosts)" value={s.expensesTotal} max={maxVal} color="bg-red-400" sign="−" />
          <div className="border-t pt-2 mt-2">
            <Bar label="MARGE RÉELLE ESTIMÉE" value={Math.abs(s.margeReelleEstimee)} max={maxVal}
              color={s.margeReelleEstimee >= 0 ? 'bg-emerald-600' : 'bg-red-600'}
              sign={s.margeReelleEstimee >= 0 ? '=' : '='}
              bold valueStr={eur(s.margeReelleEstimee)} />
          </div>
        </div>
        <div className="text-xs text-slate-500 mt-3 italic">
          Note : les boosts Vinted sont comptés une seule fois sur la ligne "Boosts marketing", pas dans "Autres dépenses".
        </div>
      </section>

      <section className="card p-4">
        <h2 className="text-lg font-semibold mb-2">Détail</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Row label="CA URSSAF (uniquement pro encaissées)" value={eur(s.caUrssaf)} />
          <Row label="Argent réellement reçu (pro + perso + pre-activité)" value={eur(s.caKeptActual)} />
          <Row label="Ventes pro brutes" value={eur(s.caProfessionalAllSales)} />
          <Row label="Ventes personnelles encaissées" value={eur(s.personalSalesAmount)} />
          <Row label="Coût stock vendu (lié)" value={eur(s.cogs)} negative />
          <Row label="Coût stock estimé sans lien" value={eur(s.cogsUnlinked)} negative />
          <Row label="Boosts marketing" value={eur(s.boostsTotal)} negative />
          <Row label="Autres dépenses (hors boosts)" value={eur(s.expensesTotal)} negative />
          <Row label="Marge brute (CA − COGS)" value={eur(s.margeBrute)} highlight />
          <Row label="Marge réelle estimée" value={eur(s.margeReelleEstimee)} highlight />
        </div>
      </section>

      <div className="grid grid-cols-2 gap-4">
        <section className="card p-4">
          <h2 className="text-lg font-semibold mb-2">Top produits</h2>
          <ProductTable items={s.topProducts} />
        </section>
        <section className="card p-4">
          <h2 className="text-lg font-semibold mb-2">Produits en perte</h2>
          {s.lossProducts.length === 0 ? (
            <div className="text-sm text-slate-500">Aucun produit en perte sur cette période. 🎉</div>
          ) : (<ProductTable items={s.lossProducts} />)}
        </section>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <section className="card p-4">
          <h2 className="text-lg font-semibold mb-2">Par plateforme</h2>
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr><th className="px-2 py-1 text-left">Plateforme</th><th className="px-2 py-1 text-right">Ventes</th><th className="px-2 py-1 text-right">CA</th></tr></thead>
            <tbody>{s.byPlatform.map((p) => (
              <tr key={p.platform} className="border-t"><td className="px-2 py-1">{p.platform}</td><td className="px-2 py-1 text-right">{p.sales}</td><td className="px-2 py-1 text-right">{eur(p.ca)}</td></tr>
            ))}</tbody>
          </table>
        </section>
        <section className="card p-4">
          <h2 className="text-lg font-semibold mb-2">Dépenses par catégorie</h2>
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr><th className="px-2 py-1 text-left">Catégorie</th><th className="px-2 py-1 text-right">Total</th></tr></thead>
            <tbody>{s.expensesByCategory.map((c) => (
              <tr key={c.category} className="border-t"><td className="px-2 py-1">{c.category}</td><td className="px-2 py-1 text-right">{eur(c.total)}</td></tr>
            ))}</tbody>
          </table>
        </section>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="card p-3 text-sm">
          <span className="text-slate-500">Boosts non assignés :</span> <span className="font-semibold text-amber-700">{eur(s.boostsUnlinked)}</span>
        </div>
        <div className="card p-3 text-sm">
          <span className="text-slate-500">Dépenses non assignées :</span> <span className="font-semibold text-amber-700">{eur(s.expensesUnlinked)}</span>
        </div>
      </div>

      {/* Trend chart over last 12 months */}
      {trends.length > 0 && (
        <section className="card p-4">
          <h2 className="text-lg font-semibold mb-3">Évolution sur les 12 derniers mois</h2>
          <TrendChart trends={trends} />
        </section>
      )}

      {/* Top buyers */}
      {topBuyers.length > 0 && (
        <section className="card p-4">
          <h2 className="text-lg font-semibold mb-2">Top acheteurs</h2>
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr>
              <th className="px-2 py-1 text-left">Acheteur</th>
              <th className="px-2 py-1 text-left">Pays</th>
              <th className="px-2 py-1 text-right">Ventes</th>
              <th className="px-2 py-1 text-right">Total</th>
              <th className="px-2 py-1 text-left">Dernier achat</th>
            </tr></thead>
            <tbody>{topBuyers.map((b, i) => (
              <tr key={i} className="border-t">
                <td className="px-2 py-1 font-semibold">{b.buyer_username}</td>
                <td className="px-2 py-1">{b.buyer_country ?? '—'}</td>
                <td className="px-2 py-1 text-right">{b.sales_count}</td>
                <td className="px-2 py-1 text-right font-semibold text-emerald-700">{eur(b.total_amount)}</td>
                <td className="px-2 py-1 text-xs">{shortDate(b.last_purchase)}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function TrendChart({ trends }: { trends: Array<{ month: string; caUrssaf: number; amountReceived: number; salesCount: number; expenses: number }> }) {
  const maxCA = Math.max(1, ...trends.map((t) => t.amountReceived));
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-slate-500 mb-2">
        <span>Argent reçu (vert) / Dépenses (rouge)</span>
        <span>Max axe : {eur(maxCA)}</span>
      </div>
      {trends.map((t) => {
        const caW = (t.amountReceived / maxCA) * 100;
        const expW = (t.expenses / maxCA) * 100;
        return (
          <div key={t.month} className="flex items-center gap-2 text-xs">
            <div className="w-16 font-mono text-slate-500">{t.month}</div>
            <div className="flex-1 relative h-8 bg-slate-50 rounded overflow-hidden">
              <div className="absolute top-0 left-0 h-1/2 bg-emerald-500" style={{ width: `${Math.min(caW, 100)}%` }} />
              <div className="absolute bottom-0 left-0 h-1/2 bg-red-400" style={{ width: `${Math.min(expW, 100)}%` }} />
              <div className="absolute inset-0 flex items-center px-2 gap-2 text-[10px] font-semibold">
                <span className="text-emerald-800">{eur(t.amountReceived)}</span>
                <span className="text-red-700">−{eur(t.expenses)}</span>
                <span className="text-slate-500 ml-auto">{t.salesCount} ventes</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{title}</div>
      <div className={`mt-1 ${color}`}>{children}</div>
    </div>
  );
}
function Big({ children }: { children: React.ReactNode }) { return <div className="text-2xl font-bold">{children}</div>; }
function Row({ label, value, negative, highlight }: { label: string; value: string; negative?: boolean; highlight?: boolean }) {
  return (
    <div className={`flex justify-between ${highlight ? 'font-semibold border-t pt-2 mt-1' : ''}`}>
      <span>{label}</span>
      <span className={negative ? 'text-red-700' : ''}>{negative ? `- ${value}` : value}</span>
    </div>
  );
}
function ProductTable({ items }: { items: Array<{ name: string; ca: number; cogs: number; margin: number }> }) {
  if (items.length === 0) return <div className="text-sm text-slate-500">Pas de données.</div>;
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50"><tr>
        <th className="px-2 py-1 text-left">Produit</th>
        <th className="px-2 py-1 text-right">CA</th>
        <th className="px-2 py-1 text-right">COGS</th>
        <th className="px-2 py-1 text-right">Marge</th>
      </tr></thead>
      <tbody>{items.map((p, i) => (
        <tr key={i} className="border-t">
          <td className="px-2 py-1 truncate max-w-[260px]">{p.name}</td>
          <td className="px-2 py-1 text-right">{eur(p.ca)}</td>
          <td className="px-2 py-1 text-right">{eur(p.cogs)}</td>
          <td className={`px-2 py-1 text-right font-semibold ${p.margin >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{eur(p.margin)}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function Bar({ label, value, max, color, sign, bold = false, valueStr }: { label: string; value: number; max: number; color: string; sign: '+' | '−' | '='; bold?: boolean; valueStr?: string }) {
  const pctWidth = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <div className={`w-48 text-xs ${bold ? 'font-bold' : ''}`}>{label}</div>
      <div className="flex-1 h-6 bg-slate-100 rounded overflow-hidden relative">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(pctWidth, 100)}%` }} />
        <div className="absolute inset-0 flex items-center px-2 text-xs font-semibold text-slate-800">
          <span className="mr-1 text-slate-500">{sign}</span>{valueStr ?? eur(value)}
        </div>
      </div>
    </div>
  );
}
