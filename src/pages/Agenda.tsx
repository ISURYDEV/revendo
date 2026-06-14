import { useEffect, useState } from 'react';
import { notify } from '../lib/notify';
import { api } from '../lib/api';
import { shortDate, todayIso } from '../lib/format';
import { Modal, Field, Input, Textarea } from '../components/Modal';

interface AgendaEntry {
  id: number;
  entry_date: string;
  note: string;
  tags: string | null;
  created_at: string;
  updated_at: string;
}

const SUGGESTED_TAGS = [
  { v: 'colis', l: '📦 Colis attendu' },
  { v: 'brocante', l: '🛒 Brocante / vide-grenier' },
  { v: 'achat', l: '🛍️ Achat à faire' },
  { v: 'rdv', l: '📅 Rendez-vous' },
  { v: 'declaration', l: '🇫🇷 Déclaration URSSAF' },
  { v: 'expedition', l: '📮 Expédition' }
];

export default function Agenda() {
  const [year, setYear] = useState(new Date().getUTCFullYear());
  const [month, setMonth] = useState(new Date().getUTCMonth() + 1);
  const [entries, setEntries] = useState<AgendaEntry[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<AgendaEntry | null>(null);
  const [creating, setCreating] = useState<{ date: string } | null>(null);

  const load = () => api.diary.list({ year, month, search: search || undefined }).then(setEntries);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [year, month]);

  const onExportIcs = async () => {
    const r = await api.agenda.exportIcs();
    if (!r.canceled) notify(`${r.count} événement(s) exporté(s).\nImportez ce fichier .ics dans Google Calendar / Apple Calendar.`);
  };

  const onDelete = async (id: number) => {
    if (!confirm('Supprimer cette note ?')) return;
    await api.diary.delete(id); load();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Agenda</h1>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={onExportIcs}>📤 Exporter (.ics) → Google Calendar</button>
          <button className="btn-primary" onClick={() => setCreating({ date: todayIso() })}>+ Nouvelle note</button>
        </div>
      </div>

      <div className="alert-info text-sm">
        Notez tout ce qui concerne votre activité : colis attendus, dates de brocante, choses à acheter, RDV, échéances.
        Exportable au format <strong>.ics</strong> pour importer dans Google Calendar.
      </div>

      <div className="card p-3 flex flex-wrap gap-2 items-center">
        <input className="border rounded px-2 py-1 text-sm" placeholder="Recherche…"
          value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        <button className="btn-secondary text-xs" onClick={load}>Filtrer</button>
        <select className="border rounded px-2 py-1 text-sm" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'].map((m, i) => (
            <option key={i} value={i + 1}>{m}</option>
          ))}
        </select>
        <select className="border rounded px-2 py-1 text-sm" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[2024, 2025, 2026, 2027].map((y) => (<option key={y} value={y}>{y}</option>))}
        </select>
        <span className="text-xs text-slate-500 ml-auto">{entries.length} note(s)</span>
      </div>

      <CalendarGrid
        year={year}
        month={month}
        entries={entries}
        onDayClick={(date) => setCreating({ date })}
        onEntryClick={(e) => setEditing(e)}
      />

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Liste détaillée</h2>
        {entries.length === 0 ? (
          <div className="card p-6 text-center text-slate-400">Aucune note pour ce mois.</div>
        ) : entries.map((e) => (
          <div key={e.id} className="card p-3 hover:bg-slate-50">
            <div className="flex justify-between items-start">
              <div className="font-mono text-xs text-slate-500">{shortDate(e.entry_date)}</div>
              <div className="flex gap-2">
                <button className="text-xs text-brand-600 hover:underline" onClick={() => setEditing(e)}>Éditer</button>
                <button className="text-xs text-red-700 hover:underline" onClick={() => onDelete(e.id)}>Supprimer</button>
              </div>
            </div>
            <div className="text-sm mt-1 whitespace-pre-wrap">{e.note}</div>
            {e.tags && <div className="text-xs text-slate-500 mt-1">🏷 {e.tags}</div>}
          </div>
        ))}
      </div>

      {creating && <EntryForm defaultDate={creating.date} onClose={() => setCreating(null)} onSaved={load} />}
      {editing && <EntryForm initial={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}

function CalendarGrid({ year, month, entries, onDayClick, onEntryClick }: {
  year: number; month: number; entries: AgendaEntry[];
  onDayClick: (date: string) => void;
  onEntryClick: (e: AgendaEntry) => void;
}) {
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // French week: Monday first (getUTCDay returns 0=Sunday; we shift)
  const startWeekDay = (firstDay.getUTCDay() + 6) % 7;
  const cells: Array<{ day: number | null; iso: string | null }> = [];
  for (let i = 0; i < startWeekDay; i++) cells.push({ day: null, iso: null });
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ day: d, iso });
  }
  while (cells.length % 7 !== 0) cells.push({ day: null, iso: null });

  const byDay: Record<string, AgendaEntry[]> = {};
  for (const e of entries) {
    const d = e.entry_date.slice(0, 10);
    (byDay[d] ??= []).push(e);
  }
  const today = todayIso();

  return (
    <div className="card p-3">
      <div className="grid grid-cols-7 gap-1 text-xs font-semibold text-slate-500 mb-1">
        {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((d) => (
          <div key={d} className="text-center py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c.iso) return <div key={i} className="aspect-square" />;
          const dayEntries = byDay[c.iso] ?? [];
          const isToday = c.iso === today;
          return (
            <div
              key={i}
              className={`aspect-square border rounded p-1 text-xs cursor-pointer hover:bg-slate-50 overflow-hidden ${
                isToday ? 'border-brand-500 bg-brand-50' : 'border-slate-200'
              }`}
              onClick={() => onDayClick(c.iso!)}
            >
              <div className={`font-semibold ${isToday ? 'text-brand-700' : 'text-slate-700'}`}>{c.day}</div>
              <div className="space-y-0.5 mt-0.5">
                {dayEntries.slice(0, 2).map((e) => (
                  <div
                    key={e.id}
                    onClick={(ev) => { ev.stopPropagation(); onEntryClick(e); }}
                    className="bg-brand-100 text-brand-800 rounded px-1 truncate hover:bg-brand-200"
                    title={e.note}
                  >
                    {e.note.slice(0, 20)}
                  </div>
                ))}
                {dayEntries.length > 2 && <div className="text-slate-400">+{dayEntries.length - 2}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EntryForm({ initial, defaultDate, onClose, onSaved }: { initial?: AgendaEntry; defaultDate?: string; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(initial?.entry_date.slice(0, 10) ?? defaultDate ?? todayIso());
  const [note, setNote] = useState(initial?.note ?? '');
  const [tags, setTags] = useState(initial?.tags ?? '');

  const onSave = async () => {
    if (!note.trim()) return notify('La note ne peut pas être vide.');
    if (initial) await api.diary.update(initial.id, { entry_date: date, note, tags });
    else await api.diary.create({ entry_date: date, note, tags });
    onSaved(); onClose();
  };

  return (
    <Modal title={initial ? `Éditer note du ${shortDate(date)}` : `Nouvelle note du ${shortDate(date)}`} onClose={onClose}>
      <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Note">
        <Textarea rows={5} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Ex: Colis Vinted ID 18583 arrive demain · Brocante à Lyon Bellecour · Acheter du scotch" />
      </Field>
      <Field label="Étiquettes (séparées par virgules)">
        <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="colis, brocante, achat…" />
        <div className="flex gap-1 flex-wrap mt-1">
          {SUGGESTED_TAGS.map((t) => (
            <button key={t.v} type="button" className="text-xs px-2 py-0.5 bg-slate-100 hover:bg-slate-200 rounded"
              onClick={() => setTags((cur) => cur ? `${cur}, ${t.v}` : t.v)}>{t.l}</button>
          ))}
        </div>
      </Field>
      <div className="flex justify-end gap-2 mt-3">
        <button className="btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={onSave}>Enregistrer</button>
      </div>
    </Modal>
  );
}
