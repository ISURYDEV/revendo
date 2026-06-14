import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

interface Reminder {
  key: string;
  level: 'info' | 'warning' | 'danger';
  title: string;
  body: string;
  cta?: { label: string; route: string };
}

const BG: Record<Reminder['level'], string> = {
  info: 'bg-sky-50 border-sky-400 text-sky-900',
  warning: 'bg-amber-50 border-amber-400 text-amber-900',
  danger: 'bg-red-50 border-red-500 text-red-900'
};

export default function RemindersBanner() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const nav = useNavigate();

  const load = () => api.reminders.list().then(setReminders as (r: unknown) => void);
  useEffect(() => { load(); }, []);

  if (reminders.length === 0) return null;

  return (
    <div className="space-y-2 mb-4">
      {reminders.map((r) => (
        <div key={r.key} className={`border-l-4 px-4 py-3 rounded text-sm ${BG[r.level]} flex items-start gap-3`}>
          <div className="flex-1">
            <div className="font-semibold">{r.title}</div>
            <div className="text-xs mt-0.5">{r.body}</div>
          </div>
          {r.cta && (
            <button className="text-xs underline whitespace-nowrap" onClick={() => nav(r.cta!.route)}>
              {r.cta.label} →
            </button>
          )}
          <button
            className="text-xs hover:underline whitespace-nowrap"
            onClick={async () => { await api.reminders.dismiss(r.key); load(); }}
            title="Ocultar hasta mañana"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
