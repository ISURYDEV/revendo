import { useEffect, useState } from 'react';
import { useSnapshot } from '../components/SnapshotContext';
import { Empty } from '../components/Empty';
import { queueAction, listActions } from '../storage/actions';
import { notify } from '../components/Toast';
import type { MobileAction } from '@shared/mobile';

interface ReviewItem {
  key: string;
  module: 'sales' | 'stock' | 'purchases' | 'expenses' | 'documents' | 'urssaf';
  severity: 'critical' | 'important' | 'review' | 'info';
  title: string;
  description?: string;
  entity_type?: string | null;
  entity_id?: number | null;
}

export default function Review() {
  const { snapshot } = useSnapshot();
  const [doneKeys, setDoneKeys] = useState<Set<string>>(new Set());
  const items = ((snapshot?.review_items ?? []) as unknown as ReviewItem[]).filter((i) => i && i.key);

  useEffect(() => {
    listActions().then((rows: MobileAction[]) => {
      const keys = new Set<string>();
      for (const r of rows) {
        if (r.type === 'mark_review_done') keys.add(r.payload.review_key);
      }
      setDoneKeys(keys);
    });
  }, []);

  if (!snapshot) return <Empty title="Aucun snapshot." />;
  if (items.length === 0) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-bold">Centre de révision</h1>
        <Empty
          title="Pas d'éléments à vérifier dans ce snapshot."
          hint="Re-générez un snapshot depuis le PC si vous attendez des éléments récents."
        />
      </div>
    );
  }

  const markDone = async (it: ReviewItem) => {
    const note = window.prompt('Note de vérification (obligatoire)');
    if (!note?.trim()) return;
    try {
      await queueAction({
        type: 'mark_review_done',
        payload: {
          review_key: it.key,
          module: it.module,
          entity_type: it.entity_type ?? null,
          entity_id: it.entity_id ?? null,
          status: 'verified',
          note: note.trim()
        }
      });
      setDoneKeys((prev) => new Set([...prev, it.key]));
      notify('Marqué comme vérifié (hors ligne).', 'success');
    } catch (err) {
      notify(`Échec : ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">Centre de révision</h1>
      <ul className="space-y-2">
        {items.map((it) => {
          const done = doneKeys.has(it.key);
          return (
            <li key={it.key} className={`card ${done ? 'opacity-50' : ''}`}>
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase text-slate-500">{it.module} · {it.severity}</div>
                  <div className="font-medium">{it.title}</div>
                  {it.description && <div className="text-xs text-slate-500 mt-1">{it.description}</div>}
                </div>
                {!done ? (
                  <button className="btn-secondary text-xs shrink-0" onClick={() => markDone(it)}>Vérifié</button>
                ) : (
                  <span className="text-[10px] text-green-700">✅ marqué</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
