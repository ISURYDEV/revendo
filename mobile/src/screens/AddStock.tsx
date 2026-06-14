import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { queueAction } from '../storage/actions';
import { notify } from '../components/Toast';

const ORIGINS = [
  { value: 'autre', label: 'Autre' },
  { value: 'compra_vinted', label: 'Achat Vinted' },
  { value: 'compra_whatnot', label: 'Achat WhatNot' },
  { value: 'brocante', label: 'Brocante / vide-grenier' },
  { value: 'regalo_recibido', label: 'Cadeau reçu' },
  { value: 'donacion_recibida', label: 'Don reçu' },
  { value: 'stock_inicial', label: 'Stock initial' }
] as const;

export default function AddStock() {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [origin, setOrigin] = useState<(typeof ORIGINS)[number]['value']>('autre');
  const [unitCost, setUnitCost] = useState('');
  const [location, setLocation] = useState('');
  const [sku, setSku] = useState('');
  const [brand, setBrand] = useState('');
  const [notes, setNotes] = useState('');
  const [photoTaken, setPhotoTaken] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = parseInt(quantity, 10);
    if (!Number.isFinite(q) || q <= 0) { notify('Quantité invalide.', 'error'); return; }
    const cost = unitCost ? parseFloat(unitCost.replace(',', '.')) : null;
    if (cost != null && !Number.isFinite(cost)) { notify('Coût invalide.', 'error'); return; }
    if (!name.trim()) { notify('Le nom est obligatoire.', 'error'); return; }
    setBusy(true);
    try {
      await queueAction({
        type: 'add_stock_item',
        payload: {
          name: name.trim(),
          quantity: q,
          origin,
          unit_cost_ttc: cost,
          location: location || null,
          sku: sku || null,
          brand: brand || null,
          notes: notes || null,
          has_photo: photoTaken
        }
      });
      notify('Stock enregistré hors ligne.', 'success');
      nav('/');
    } catch (err) {
      notify(`Échec : ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <h1 className="text-xl font-bold">Ajouter du stock</h1>
      <div><label className="label">Nom de l'article</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div><label className="label">Quantité</label>
        <input className="input" type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
      </div>
      <div><label className="label">Origine</label>
        <select className="input" value={origin} onChange={(e) => setOrigin(e.target.value as (typeof ORIGINS)[number]['value'])}>
          {ORIGINS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div><label className="label">Coût unitaire TTC (€)</label>
        <input className="input" inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0,00 (optionnel mais recommandé)" />
      </div>
      <div><label className="label">Emplacement (caisse/armoire)</label>
        <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Ex: caisse-A-3" />
      </div>
      <div><label className="label">SKU</label>
        <input className="input" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Optionnel" />
      </div>
      <div><label className="label">Marque</label>
        <input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} />
      </div>
      <div>
        <label className="label">Photo (optionnel)</label>
        <input className="input" type="file" accept="image/*" capture="environment"
               onChange={(e) => setPhotoTaken(!!e.target.files?.length)} />
        {photoTaken && (
          <div className="text-[11px] text-amber-700 mt-1">
            ⚠️ La photo n'est pas synchronisée. Conservez-la sur ce téléphone et associez-la sur le PC.
          </div>
        )}
      </div>
      <div><label className="label">Note</label>
        <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex gap-2 pt-2">
        <button type="button" className="btn-secondary flex-1" onClick={() => nav(-1)}>Annuler</button>
        <button type="submit" className="btn-primary flex-1" disabled={busy}>
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </form>
  );
}
