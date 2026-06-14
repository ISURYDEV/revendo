import { useState } from 'react';
import { api } from '../../lib/api';
import { Field, Input, Select, Textarea } from '../Modal';
import WizardModal from '../WizardModal';
import { eur } from '../../lib/format';

const PLATFORMS = ['Vinted', 'WhatNot', 'Ali Express', 'Brocante', 'Vide-grenier', 'Autre'];

export default function PurchaseForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [mode, setMode] = useState<'stock' | 'expense'>('stock');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [seller, setSeller] = useState('');
  const [platform, setPlatform] = useState('Vinted');
  const [articles, setArticles] = useState('');
  const [qty, setQty] = useState(1);
  const [itemsPrice, setItemsPrice] = useState('');
  const [shipping, setShipping] = useState('');
  const [protection, setProtection] = useState('');
  const [total, setTotal] = useState('');
  // Default OFF: purchases live in `purchases` as justificativos. Stock tracking is optional.
  const [createStock, setCreateStock] = useState(false);
  const [notes, setNotes] = useState('');

  const num = (s: string) => Number((s || '0').replace(',', '.')) || 0;
  const computedTotal = total ? num(total) : num(itemsPrice) + num(shipping) + num(protection);

  const onSubmit = async () => {
    if (mode === 'expense') {
      await api.expenses.create({
        date,
        category: 'achat_stock',
        supplier: seller,
        platform,
        description: articles,
        amount_ttc: computedTotal,
        notes: notes || null
      });
    } else {
      const r = await api.purchases.createManual({
        payment_date: date,
        seller,
        platform,
        articles,
        quantity: qty,
        items_price: num(itemsPrice) || undefined,
        shipping_fee: num(shipping) || undefined,
        protection_fee: num(protection) || undefined,
        total_ttc: computedTotal,
        notes: notes || undefined
      });
      if (createStock) {
        await api.stock.createManual({
          name: articles,
          quantity: qty,
          origin: platform.toLowerCase().includes('vinted') ? 'compra_vinted' : platform.toLowerCase().includes('whatnot') ? 'compra_whatnot' : 'brocante',
          total_cost_ttc: computedTotal,
          unit_cost_ttc: qty > 0 ? computedTotal / qty : computedTotal,
          notes: `Achat #${r.id}`
        });
      }
    }
    onSaved();
    onClose();
  };

  return (
    <WizardModal
      title="Ajouter un achat manuel"
      onClose={onClose}
      onConfirm={onSubmit}
      confirmLabel="Enregistrer"
      steps={[
        {
          title: 'Type',
          description: "L'achat sera enregistré comme justificatif. Le suivi stock physique reste optionnel.",
          content: (
            <Field label="De quoi s'agit-il ?">
              <div className="wizard-choice-grid">
                <button type="button" className={`wizard-choice ${mode === 'stock' ? 'is-selected' : ''}`} onClick={() => setMode('stock')}>📦 Achat de stock</button>
                <button type="button" className={`wizard-choice ${mode === 'expense' ? 'is-selected' : ''}`} onClick={() => setMode('expense')}>💸 Dépense opérationnelle</button>
              </div>
            </Field>
          )
        },
        {
          title: 'Fournisseur',
          validate: () => !date ? 'La date est obligatoire.' : !seller.trim() ? 'Le vendeur/fournisseur est obligatoire.' : null,
          content: (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="Vendeur / fournisseur"><Input value={seller} onChange={(e) => setSeller(e.target.value)} /></Field>
              <Field label="Plateforme"><Select value={platform} onChange={(e) => setPlatform(e.target.value)}>{PLATFORMS.map((p) => (<option key={p}>{p}</option>))}</Select></Field>
              <Field label="Quantité d'articles"><Input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value) || 1)} /></Field>
            </div>
          )
        },
        {
          title: 'Articles',
          validate: () => !articles.trim() ? 'La description est obligatoire.' : null,
          content: <Field label="Description / articles"><Textarea rows={4} value={articles} onChange={(e) => setArticles(e.target.value)} /></Field>
        },
        {
          title: 'Montants',
          validate: () => computedTotal <= 0 ? 'Le total TTC doit être supérieur à 0.' : null,
          content: (
            <div className="grid grid-cols-4 gap-3">
              <Field label="Prix des articles (€)"><Input value={itemsPrice} onChange={(e) => setItemsPrice(e.target.value)} /></Field>
              <Field label="Frais de port (€)"><Input value={shipping} onChange={(e) => setShipping(e.target.value)} /></Field>
              <Field label="Frais de protection (€)"><Input value={protection} onChange={(e) => setProtection(e.target.value)} /></Field>
              <Field label="Total TTC (€)" hint="Vide = somme automatique"><Input value={total} onChange={(e) => setTotal(e.target.value)} placeholder={computedTotal.toFixed(2)} /></Field>
            </div>
          )
        },
        {
          title: 'Stock et notes',
          content: (
            <>
              {mode === 'stock' && (
                <Field label="" hint="Cochez seulement si vous voulez aussi suivre le stock physique dans l'app.">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={createStock} onChange={(e) => setCreateStock(e.target.checked)} />
                    Créer aussi {qty} article(s) de stock avec un coût unitaire de {(computedTotal / Math.max(qty, 1)).toFixed(2)} €
                  </label>
                </Field>
              )}
              <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            </>
          )
        },
        {
          title: 'Résumé',
          content: (
            <div className="card p-4 text-sm space-y-2">
              <div className="flex justify-between"><span>Mode</span><strong>{mode === 'stock' ? 'Achat de stock' : 'Dépense'}</strong></div>
              <div className="flex justify-between"><span>Fournisseur</span><strong>{seller || '—'}</strong></div>
              <div className="flex justify-between"><span>Total TTC</span><strong>{eur(computedTotal)}</strong></div>
              <div className="flex justify-between"><span>Créer stock</span><strong>{createStock ? 'Oui' : 'Non'}</strong></div>
            </div>
          )
        }
      ]}
    />
  );
}
