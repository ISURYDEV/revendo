import { useState } from 'react';
import { notify } from '../../lib/notify';
import { api } from '../../lib/api';
import { Field, Input, Select, Textarea } from '../Modal';
import WizardModal from '../WizardModal';
import type { StockItem, StockItemStatus, StockMovementType, StockOrigin } from '../../../shared/types';

const ORIGINS: { value: StockOrigin; label: string }[] = [
  { value: 'compra_vinted', label: 'Achat Vinted' },
  { value: 'compra_whatnot', label: 'Achat WhatNot' },
  { value: 'brocante', label: 'Brocante' },
  { value: 'stock_inicial', label: 'Stock initial' },
  { value: 'regalo_recibido', label: 'Cadeau reçu' },
  { value: 'donacion_recibida', label: 'Don reçu' },
  { value: 'personal', label: 'Personnel (hors revente)' },
  { value: 'autre', label: 'Autre' }
];

const STATUSES: StockItemStatus[] = ['in_stock', 'listed', 'reserved', 'draft', 'archived'];

export function AddStockForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [isLot, setIsLot] = useState(false);
  const [qty, setQty] = useState(1);
  const [origin, setOrigin] = useState<StockOrigin>('compra_vinted');
  const [totalCost, setTotalCost] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [brand, setBrand] = useState('');
  const [size, setSize] = useState('');
  const [color, setColor] = useState('');
  const [sku, setSku] = useState('');
  const [estPrice, setEstPrice] = useState('');
  const [status, setStatus] = useState<StockItemStatus>('in_stock');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');

  const num = (s: string) => (s ? Number(s.replace(',', '.')) : null);

  const onSubmit = async () => {
    await api.stock.createManual({
      name,
      quantity: qty,
      origin,
      total_cost_ttc: num(totalCost),
      unit_cost_ttc: num(unitCost),
      brand: brand || null,
      size: size || null,
      color: color || null,
      sku: sku || null,
      estimated_sale_price: num(estPrice),
      status,
      location: location || null,
      notes: notes || (isLot ? 'Lot' : null)
    });
    onSaved();
    onClose();
  };

  return (
    <WizardModal
      title="Ajouter du stock manuellement"
      onClose={onClose}
      onConfirm={onSubmit}
      confirmLabel="Enregistrer le stock"
      steps={[
        {
          title: 'Article',
          validate: () => !name.trim() ? 'Le nom est obligatoire.' : qty <= 0 ? 'La quantité doit être supérieure à 0.' : null,
          content: (
            <>
              <Field label="Nom de l'article"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Type"><Select value={isLot ? 'lot' : 'single'} onChange={(e) => setIsLot(e.target.value === 'lot')}><option value="single">Unité individuelle</option><option value="lot">Lot</option></Select></Field>
                <Field label="Quantité"><Input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value) || 1)} /></Field>
              </div>
            </>
          )
        },
        {
          title: 'Origine et coût',
          content: (
            <>
              <Field label="Origine"><Select value={origin} onChange={(e) => setOrigin(e.target.value as StockOrigin)}>{ORIGINS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}</Select></Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Coût total (€)"><Input value={totalCost} onChange={(e) => setTotalCost(e.target.value)} /></Field>
                <Field label="Coût unitaire (€)"><Input value={unitCost} onChange={(e) => setUnitCost(e.target.value)} /></Field>
                <Field label="Prix de vente estimé (€)"><Input value={estPrice} onChange={(e) => setEstPrice(e.target.value)} /></Field>
              </div>
            </>
          )
        },
        {
          title: 'Détails',
          content: (
            <div className="grid grid-cols-4 gap-3">
              <Field label="Marque"><Input value={brand} onChange={(e) => setBrand(e.target.value)} /></Field>
              <Field label="Taille"><Input value={size} onChange={(e) => setSize(e.target.value)} /></Field>
              <Field label="Couleur"><Input value={color} onChange={(e) => setColor(e.target.value)} /></Field>
              <Field label="SKU (optionnel)"><Input value={sku} onChange={(e) => setSku(e.target.value)} /></Field>
            </div>
          )
        },
        {
          title: 'Emplacement',
          content: (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Statut initial"><Select value={status} onChange={(e) => setStatus(e.target.value as StockItemStatus)}>{STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}</Select></Field>
              <Field label="Emplacement physique"><Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Caisse A, armoire..." /></Field>
            </div>
          )
        },
        {
          title: 'Résumé',
          content: (
            <>
              <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
              <div className="card p-4 text-sm space-y-2">
                <div className="flex justify-between"><span>Article</span><strong>{name || '—'}</strong></div>
                <div className="flex justify-between"><span>Quantité</span><strong>{qty}</strong></div>
                <div className="flex justify-between"><span>Emplacement</span><strong>{location || '—'}</strong></div>
              </div>
            </>
          )
        }
      ]}
    />
  );
}

const REASONS: { value: StockMovementType; label: string }[] = [
  { value: 'OUT_SOLD', label: 'Vendu' },
  { value: 'OUT_DONATED', label: 'Donné' },
  { value: 'OUT_GIFTED', label: 'Offert' },
  { value: 'OUT_PERSONAL_USE', label: 'Usage personnel' },
  { value: 'OUT_LOST', label: 'Perdu' },
  { value: 'OUT_DISCARDED', label: 'Jeté' },
  { value: 'IN_RETURN', label: 'Retourné (réintégré)' },
  { value: 'ADJUSTMENT_MINUS', label: 'Ajustement inventaire (-)' },
  { value: 'ADJUSTMENT_PLUS', label: 'Ajustement inventaire (+)' }
];

export function RemoveStockForm({
  item,
  onClose,
  onSaved
}: {
  item: StockItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [movement, setMovement] = useState<StockMovementType>('OUT_SOLD');
  const [qty, setQty] = useState(1);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');

  const isAdjust = movement === 'ADJUSTMENT_PLUS' || movement === 'IN_RETURN';

  const onSubmit = async () => {
    if (isAdjust) {
      // Treat as IN movement: increment quantity via update (no moveOut)
      await api.stock.update(item.id, { quantity: item.quantity + qty });
      onSaved();
      onClose();
      return;
    }
    if (qty > item.quantity) {
      return notify(`Quantité insuffisante. Stock actuel : ${item.quantity}`);
    }
    await api.stock.moveOut({
      stock_item_id: item.id,
      movement_type: movement,
      quantity: qty,
      reason: REASONS.find((r) => r.value === movement)?.label,
      notes,
      movement_date: new Date(date).toISOString()
    });
    onSaved();
    onClose();
  };

  return (
    <WizardModal
      title={`Mouvement de stock — ${item.name ?? item.internal_code}`}
      onClose={onClose}
      onConfirm={onSubmit}
      steps={[
        {
          title: 'Motif',
          content: (
            <>
              <Field label="Stock actuel"><div className="text-sm"><span className="font-semibold">{item.quantity}</span> unité(s) · <span className="font-mono text-xs">{item.internal_code}</span></div></Field>
              <Field label="Motif"><Select value={movement} onChange={(e) => setMovement(e.target.value as StockMovementType)}>{REASONS.map((r) => (<option key={r.value} value={r.value}>{r.label}</option>))}</Select></Field>
            </>
          )
        },
        {
          title: 'Quantité et date',
          validate: () => qty <= 0 ? 'La quantité doit être supérieure à 0.' : (!isAdjust && qty > item.quantity) ? `Quantité insuffisante. Stock actuel : ${item.quantity}` : null,
          content: (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantité"><Input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value) || 1)} /></Field>
              <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            </div>
          )
        },
        {
          title: 'Confirmation',
          content: (
            <>
              <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
              <div className="card p-4 text-sm">
                {isAdjust ? `Le stock sera augmenté de ${qty} unité(s).` : `${qty} unité(s) seront sorties du stock.`}
              </div>
            </>
          )
        }
      ]}
    />
  );
}
