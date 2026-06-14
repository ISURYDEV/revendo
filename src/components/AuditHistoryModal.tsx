import { useEffect, useState } from 'react';
import { notify } from '../lib/notify';
import { api } from '../lib/api';
import { Modal } from './Modal';

type EntityType = 'sale' | 'expense' | 'boost' | 'purchase' | 'document' | 'stock_item';

interface Entry {
  id: number;
  changed_at: string;
  entity_type: string;
  entity_id: number;
  operation: 'CREATE' | 'UPDATE' | 'DELETE' | 'REVERT';
  prev_value: string | null;
  new_value: string | null;
  reverted_from: number | null;
  note: string | null;
}

const OP_COLORS: Record<string, string> = {
  CREATE: 'bg-emerald-100 text-emerald-800',
  UPDATE: 'bg-sky-100 text-sky-800',
  DELETE: 'bg-red-100 text-red-800',
  REVERT: 'bg-purple-100 text-purple-800'
};

export default function AuditHistoryModal({
  entityType,
  entityId,
  title,
  onClose,
  onReverted
}: {
  entityType: EntityType;
  entityId: number;
  title?: string;
  onClose: () => void;
  onReverted?: () => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const load = () =>
    api.audit
      .listFor(entityType, entityId)
      .then((e) => setEntries(e as unknown as Entry[]));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId]);

  const onRevert = async (entry: Entry) => {
    const msg =
      entry.operation === 'DELETE'
        ? 'Restaurer cette entrée avec ses données originales ?'
        : entry.operation === 'UPDATE'
        ? 'Restaurer les valeurs précédentes de cette modification ?'
        : entry.operation === 'CREATE'
        ? 'Supprimer l’entrée créée à ce moment ?'
        : 'Annuler ce retour arrière et réappliquer le changement original ?';
    if (!confirm(msg)) return;
    try {
      await api.audit.revert(entry.id);
      load();
      onReverted?.();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Modal title={title ?? `Historique des changements — ${entityType} #${entityId}`} onClose={onClose} size="lg">
      <p className="text-xs text-slate-500 mb-3">
        Chaque changement est enregistré. Cliquez sur <strong>Restaurer</strong> pour revenir en arrière ; cette action
        sera également journalisée.
      </p>
      <div className="space-y-2">
        {entries.length === 0 && (<div className="text-sm text-slate-500">Aucun changement enregistré.</div>)}
        {entries.map((e, i) => {
          const isOpen = openIdx === i;
          return (
            <div key={e.id} className="border border-slate-200 rounded">
              <div className="flex items-center px-3 py-2 cursor-pointer hover:bg-slate-50"
                onClick={() => setOpenIdx(isOpen ? null : i)}>
                <span className={`pill ${OP_COLORS[e.operation] ?? 'bg-slate-100'} mr-2`}>{e.operation}</span>
                <span className="text-xs text-slate-500 font-mono">{e.changed_at}</span>
                <span className="text-xs text-slate-700 ml-2 truncate flex-1">{e.note ?? ''}</span>
                <button
                  className="text-xs text-purple-700 hover:underline ml-2"
                  onClick={(ev) => { ev.stopPropagation(); onRevert(e); }}
                  title="Restaurer ce changement"
                >
                  ↶ Restaurer
                </button>
              </div>
              {isOpen && (
                <div className="px-3 py-2 bg-slate-50 text-xs">
                  {e.prev_value && (<><div className="font-semibold text-slate-600 mt-1">Avant :</div><JsonView json={e.prev_value} /></>)}
                  {e.new_value && (<><div className="font-semibold text-slate-600 mt-2">Après :</div><JsonView json={e.new_value} /></>)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-end mt-4">
        <button className="btn-secondary" onClick={onClose}>Fermer</button>
      </div>
    </Modal>
  );
}

function JsonView({ json }: { json: string }) {
  let obj: Record<string, unknown> = {};
  try { obj = JSON.parse(json); } catch { return <code>{json}</code>; }
  const entries = Object.entries(obj).filter(([, v]) => v !== null && v !== '' && v !== 0);
  return (
    <table className="text-xs w-full">
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k} className="border-t border-slate-200">
            <td className="px-1 py-0.5 text-slate-500 font-mono w-1/3">{k}</td>
            <td className="px-1 py-0.5 truncate">{String(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
