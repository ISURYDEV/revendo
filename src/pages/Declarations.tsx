import { useEffect, useState } from 'react';
import { notify } from '../lib/notify';
import { api } from '../lib/api';
import { eur, pct, shortDate } from '../lib/format';
import FiscalWarning from '../components/FiscalWarning';
import RatesVerificationBanner from '../components/RatesVerificationBanner';
import { Modal, Field, Input, Textarea } from '../components/Modal';
import type { CombinedFirstDeclaration, DeclarationSummary, QuarterCode } from '../../shared/types';

export default function Declarations() {
  const [year, setYear] = useState(new Date().getUTCFullYear());
  const [summaries, setSummaries] = useState<DeclarationSummary[]>([]);
  const [firstDecl, setFirstDecl] = useState<CombinedFirstDeclaration | null>(null);
  const [marking, setMarking] = useState<QuarterCode | null>(null);

  const load = async () => {
    const [allSummaries, firstDeclResult] = await Promise.all([
      Promise.all(([1, 2, 3, 4] as QuarterCode[]).map((q) => api.declarations.summary(year, q, true))),
      api.declarations.firstDeclaration(year)
    ]);
    setSummaries(allSummaries);
    setFirstDecl(firstDeclResult);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [year]);

  const onExportCsv = async (q: QuarterCode) => {
    const r = await api.declarations.exportRecettes(year, q);
    if (!r.canceled) notify(`${r.rowCount} lignes exportées → ${r.path}`);
  };
  const onExportXlsx = async (q: QuarterCode) => {
    const r = await api.xlsx.recettes(year, q);
    if (!r.canceled) notify(`${r.rowCount} lignes exportées → ${r.path}`);
  };

  // P0.1 — Si la première déclaration combine plusieurs trimestres, on masque
  // les cards individuelles correspondantes pour éviter toute confusion.
  const combinedQuarters = new Set(firstDecl?.quarters ?? []);
  const visibleSummaries = summaries.filter((s) => !combinedQuarters.has(s.quarter));

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Déclaration URSSAF</h1>
        <select className="border rounded px-2 py-1" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[2024, 2025, 2026, 2027].map((y) => (<option key={y} value={y}>{y}</option>))}
        </select>
      </div>
      <FiscalWarning />
      <RatesVerificationBanner />

      {firstDecl && (
        <FirstDeclarationCard
          decl={firstDecl}
          onExportCsv={(q) => onExportCsv(q)}
          onExportXlsx={(q) => onExportXlsx(q)}
          onMarkDeclared={(q) => setMarking(q)}
          onRecapPdf={(q) => api.pdf.declarationRecap({ year, quarter: q })}
        />
      )}

      <div className="grid grid-cols-2 gap-4">
        {visibleSummaries.map((s) => (
          <div key={s.quarter} className="card p-4 space-y-2">
            <div className="flex justify-between items-start">
              <div>
                <div className="text-lg font-bold">
                  Q{s.quarter} {s.year}
                </div>
                <div className="text-xs text-slate-500">
                  Période URSSAF: <strong>{shortDate(s.periodStart)} → {shortDate(s.periodEnd)}</strong>
                </div>
                <div className="text-xs text-slate-500">
                  Échéance: <strong>{shortDate(s.dueDate)}</strong>
                </div>
                {s.firstDeclarationLabel && (<div className="text-xs text-orange-700 mt-1">{s.firstDeclarationLabel}</div>)}
              </div>
              {s.status === 'declared' && <span className="pill bg-emerald-100 text-emerald-700">Déclaré</span>}
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm mt-2">
              <div>
                <div className="text-xs text-slate-500">CA professionnel déclarable</div>
                <div className="text-2xl font-bold">{eur(s.caGoods)}</div>
                <div className="text-xs text-slate-500">{s.includedSalesCount} ventes pro</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">
                  Cotisations estimées
                  {s.acreFullPeriod ? <span className="pill bg-sky-100 text-sky-700 ml-1">ACRE</span>
                   : s.acreApplied ? <span className="pill bg-sky-100 text-sky-700 ml-1">ACRE partiel</span>
                   : <span className="pill bg-slate-100 text-slate-600 ml-1">taux normal</span>}
                </div>
                <div className="font-semibold text-lg">{eur(s.contributionsApplied)}</div>
                <div className="text-xs text-slate-500">
                  Réf. tout ACRE ({pct(s.rateAcre)}): {eur(s.contributionsAcre)} · Réf. normal ({pct(s.rateNormal)}): {eur(s.contributionsNormal)}
                </div>
              </div>
              <div className="col-span-2 border-t pt-2 mt-1">
                <div className="text-xs font-semibold text-slate-600 mb-1">Exclues du CA URSSAF</div>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <Chip label="Avant début" value={`${s.preActivitySalesCount} (${eur(s.preActivitySalesAmount)})`} color="bg-orange-100 text-orange-800" />
                  <Chip label="Personnelles" value={`${s.personalSalesCount} (${eur(s.personalSalesAmount)})`} color="bg-slate-100 text-slate-700" />
                  <Chip label="À revoir" value={String(s.uncertainSalesCount)} color="bg-amber-100 text-amber-800" />
                  <Chip label="Annulées" value={String(s.canceledSalesCount)} color="bg-red-100 text-red-700" />
                </div>
              </div>
            </div>

            <div className="flex gap-2 mt-3 flex-wrap">
              <button className="btn-secondary text-xs" onClick={() => onExportCsv(s.quarter)}>📄 Livre recettes (CSV)</button>
              <button className="btn-secondary text-xs" onClick={() => onExportXlsx(s.quarter)}>📊 Livre recettes (Excel)</button>
              <button className="btn-secondary text-xs" onClick={() => api.pdf.declarationRecap({ year, quarter: s.quarter })}>📑 Récap PDF</button>
              <button className="btn-primary text-xs" onClick={() => setMarking(s.quarter)} disabled={s.status === 'declared'}>Marquer comme déclaré</button>
            </div>
          </div>
        ))}
      </div>

      {marking != null && (
        <MarkDeclaredModal
          year={year} quarter={marking}
          summary={summaries.find((s) => s.quarter === marking)!}
          onClose={() => setMarking(null)}
          onSaved={() => { setMarking(null); load(); }}
        />
      )}
    </div>
  );
}

function FirstDeclarationCard({
  decl,
  onExportCsv,
  onExportXlsx,
  onMarkDeclared,
  onRecapPdf
}: {
  decl: CombinedFirstDeclaration;
  onExportCsv: (q: QuarterCode) => void;
  onExportXlsx: (q: QuarterCode) => void;
  onMarkDeclared: (q: QuarterCode) => void;
  onRecapPdf: (q: QuarterCode) => void;
}) {
  const qLabel = decl.quarters.map((q) => `Q${q}`).join(' + ');
  return (
    <div className="card p-4 space-y-3 border-2 border-orange-200 bg-orange-50/40" data-testid="first-declaration-card">
      <div className="flex justify-between items-start">
        <div>
          <div className="text-lg font-bold flex items-center gap-2">
            Première déclaration
            <span className="pill bg-orange-100 text-orange-800">{qLabel} {decl.year}</span>
          </div>
          <div className="text-xs text-slate-600">
            Période combinée : <strong>{shortDate(decl.periodStart)} → {shortDate(decl.periodEnd)}</strong>
          </div>
          <div className="text-xs text-slate-600">
            Échéance unique : <strong>{shortDate(decl.dueDate)}</strong>
          </div>
          {decl.firstDeclarationLabel && (
            <div className="text-xs text-orange-700 mt-1">{decl.firstDeclarationLabel}</div>
          )}
          <div className="text-xs text-orange-700 mt-1">
            Sur urssaf.fr, vous ne déclarez qu'une seule fois la somme {qLabel}. Ne déclarez pas chaque trimestre séparément.
          </div>
        </div>
        {decl.status === 'declared' && <span className="pill bg-emerald-100 text-emerald-700">Déclaré</span>}
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <div className="text-xs text-slate-500">CA professionnel déclarable (total {qLabel})</div>
          <div className="text-2xl font-bold">{eur(decl.caGoods)}</div>
          <div className="text-xs text-slate-500">{decl.includedSalesCount} ventes pro</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">
            Cotisations estimées
            {decl.acreFullPeriod ? <span className="pill bg-sky-100 text-sky-700 ml-1">ACRE</span>
             : decl.acreApplied ? <span className="pill bg-sky-100 text-sky-700 ml-1">ACRE partiel</span>
             : <span className="pill bg-slate-100 text-slate-600 ml-1">taux normal</span>}
          </div>
          <div className="font-semibold text-lg">{eur(decl.contributionsApplied)}</div>
          <div className="text-xs text-slate-500">
            Réf. ACRE ({pct(decl.rateAcre)}) : {eur(decl.contributionsAcre)} · Réf. normal ({pct(decl.rateNormal)}) : {eur(decl.contributionsNormal)}
          </div>
        </div>

        <div className="col-span-2 border-t pt-2">
          <div className="text-xs font-semibold text-slate-600 mb-1">Exclues du CA URSSAF (combiné {qLabel})</div>
          <div className="grid grid-cols-4 gap-2 text-xs">
            <Chip label="Avant début" value={`${decl.preActivitySalesCount} (${eur(decl.preActivitySalesAmount)})`} color="bg-orange-100 text-orange-800" />
            <Chip label="Personnelles" value={`${decl.personalSalesCount} (${eur(decl.personalSalesAmount)})`} color="bg-slate-100 text-slate-700" />
            <Chip label="À revoir" value={String(decl.uncertainSalesCount)} color="bg-amber-100 text-amber-800" />
            <Chip label="Annulées" value={String(decl.canceledSalesCount)} color="bg-red-100 text-red-700" />
          </div>
        </div>
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-slate-600 hover:text-slate-900">Détail par trimestre</summary>
        <div className="mt-2 space-y-1">
          {decl.perQuarter.map((q) => (
            <div key={q.quarter} className="flex justify-between border-b border-orange-100 py-1">
              <div className="text-slate-700">Q{q.quarter} {q.year} · {shortDate(q.periodStart)} → {shortDate(q.periodEnd)}</div>
              <div className="font-medium">{eur(q.caGoods)} ({q.includedSalesCount} ventes)</div>
            </div>
          ))}
        </div>
      </details>

      <div className="flex gap-2 flex-wrap pt-1">
        {decl.quarters.map((q) => (
          <div key={q} className="flex gap-1">
            <button className="btn-secondary text-xs" onClick={() => onExportCsv(q)}>📄 Q{q} CSV</button>
            <button className="btn-secondary text-xs" onClick={() => onExportXlsx(q)}>📊 Q{q} Excel</button>
            <button className="btn-secondary text-xs" onClick={() => onRecapPdf(q)}>📑 Q{q} PDF</button>
          </div>
        ))}
        <button
          className="btn-primary text-xs"
          onClick={() => onMarkDeclared(decl.quarters[decl.quarters.length - 1])}
          disabled={decl.status === 'declared'}
        >
          Marquer la première déclaration comme déclarée
        </button>
      </div>
    </div>
  );
}

function MarkDeclaredModal({ year, quarter, summary, onClose, onSaved }: { year: number; quarter: QuarterCode; summary: DeclarationSummary; onClose: () => void; onSaved: () => void }) {
  const [actualCa, setActualCa] = useState(summary.caGoods.toFixed(2));
  const [actualPaid, setActualPaid] = useState(summary.contributionsApplied.toFixed(2));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');

  const onSave = async () => {
    const caNum = Number(actualCa.replace(',', '.'));
    const paidNum = Number(actualPaid.replace(',', '.'));
    await api.declarations.markDeclared({ year, quarter, actualDeclaredCa: caNum, actualPaidContributions: paidNum, declarationDate: date, notes });
    try { await api.pdf.declarationRecap({ year, quarter, actualDeclaredCa: caNum, actualPaidContributions: paidNum, declarationDate: date }); } catch (err) { console.warn(err); }
    onSaved();
  };

  return (
    <Modal title={`Marquer Q${quarter} ${year} comme déclaré`} onClose={onClose}>
      <p className="text-xs text-slate-500 mb-3">
        Saisissez les montants <strong>réellement</strong> déclarés sur urssaf.fr (peuvent différer de l'estimation).
      </p>
      <Field label="CA réellement déclaré (€)"><Input value={actualCa} onChange={(e) => setActualCa(e.target.value)} /></Field>
      <Field label="Cotisations réellement payées (€)"><Input value={actualPaid} onChange={(e) => setActualPaid(e.target.value)} /></Field>
      <Field label="Date de déclaration"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Notes"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <div className="flex justify-end gap-2 mt-3">
        <button className="btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={onSave}>Confirmer</button>
      </div>
    </Modal>
  );
}

function Chip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className={`px-2 py-1.5 rounded ${color}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="font-semibold text-sm">{value}</div>
    </div>
  );
}
