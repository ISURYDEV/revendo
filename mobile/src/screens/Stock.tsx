import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSnapshot } from '../components/SnapshotContext';
import { Empty } from '../components/Empty';
import { eur } from '../services/formatter';
import { queueAction } from '../storage/actions';
import { notify } from '../components/Toast';
import type { MobileActionPayload } from '@shared/mobile';

interface StockRow extends Record<string, unknown> {
  id: number;
  internal_code: string;
  name: string;
  sku?: string | null;
  status: string;
  quantity: number;
  unit_cost_ttc?: number | null;
  location?: string | null;
  brand?: string | null;
}

const MOVEMENT_LABELS: Record<string, string> = {
  OUT_SOLD: '🟢 Vendu',
  OUT_DONATED: '🤝 Donné',
  OUT_GIFTED: '🎁 Offert',
  OUT_PERSONAL_USE: '🏠 Usage personnel',
  OUT_LOST: '❓ Perdu',
  OUT_DISCARDED: '🗑️ Jeté',
  OUT_ADJUSTMENT: '⚖️ Ajustement'
};

export default function StockScreen() {
  const { snapshot } = useSnapshot();
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const stock = (snapshot?.stock ?? []) as StockRow[];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return stock.slice(0, 100);
    return stock.filter((s) => {
      return [s.name, s.sku, s.location, s.internal_code, s.brand]
        .filter((v) => v != null)
        .some((v) => String(v).toLowerCase().includes(q));
    }).slice(0, 100);
  }, [stock, query]);

  if (!snapshot) return <Empty title="Aucun snapshot." />;

  const item = openId != null ? stock.find((s) => s.id === openId) : null;

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-baseline">
        <h1 className="text-xl font-bold">Stock</h1>
        <Link to="/add-stock" className="text-xs text-brand-600">➕ Ajouter</Link>
      </div>
      <input
        className="input"
        type="search"
        placeholder="Rechercher par nom, SKU, emplacement…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="text-xs text-slate-500">{filtered.length} article(s)</div>
      <ul className="space-y-2">
        {filtered.map((s) => (
          <li key={s.id} className="card" onClick={() => setOpenId(s.id === openId ? null : s.id)}>
            <div className="flex justify-between items-start">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{s.name || s.internal_code}</div>
                <div className="text-[11px] text-slate-500 truncate">
                  {s.sku && <>SKU {s.sku} · </>}
                  {s.location || 'sans emplacement'} · {s.status}
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold">{s.quantity}</div>
                {s.unit_cost_ttc != null && <div className="text-[10px] text-slate-500">{eur(s.unit_cost_ttc)}/u</div>}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {filtered.length === 0 && <Empty title="Aucun article trouvé." />}

      {item && (
        <MovementSheet
          item={item}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

function MovementSheet({ item, onClose }: { item: StockRow; onClose: () => void }) {
  const [movementType, setMovementType] = useState<string>('OUT_SOLD');
  const [quantity, setQuantity] = useState<string>('1');
  const [reason, setReason] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const qty = parseInt(quantity, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      notify('Quantité invalide.', 'error');
      return;
    }
    if (qty > item.quantity) {
      notify(`Quantité max disponible : ${item.quantity}.`, 'error');
      return;
    }
    setBusy(true);
    try {
      const payload: MobileActionPayload = {
        type: 'add_stock_movement',
        payload: {
          stock_item_id: item.id,
          movement_type: movementType as MobileActionPayload extends { type: 'add_stock_movement' } ? MobileActionPayload['payload']['movement_type'] : never,
          quantity: qty,
          reason: reason || null
        }
      } as MobileActionPayload;
      await queueAction(payload);
      notify(`Mouvement ${MOVEMENT_LABELS[movementType] ?? movementType} mis en file d'attente.`, 'success');
      onClose();
    } catch (err) {
      notify(`Échec : ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end z-40" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 w-full rounded-t-2xl p-4 space-y-3 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="font-bold text-lg">{item.name}</div>
        <div className="text-xs text-slate-500">Stock disponible : {item.quantity}</div>
        <label className="label">Type de mouvement</label>
        <select className="input" value={movementType} onChange={(e) => setMovementType(e.target.value)}>
          {Object.entries(MOVEMENT_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <label className="label">Quantité</label>
        <input className="input" type="number" min={1} max={item.quantity} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        <label className="label">Note / raison</label>
        <input className="input" placeholder="Optionnel" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex gap-2 pt-2">
          <button className="btn-secondary flex-1" disabled={busy} onClick={onClose}>Annuler</button>
          <button className="btn-primary flex-1" disabled={busy} onClick={submit}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
        <div className="text-[10px] text-slate-500 pt-1">
          L'action sera appliquée au PC lors du prochain import. Stock négatif refusé.
        </div>
      </div>
    </div>
  );
}
