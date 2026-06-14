import { useState } from 'react';
import { api } from '../../lib/api';
import { Field, Input, Select, Textarea } from '../Modal';
import WizardModal from '../WizardModal';
import { eur } from '../../lib/format';

const PLATFORMS = ['Vinted', 'WhatNot', 'Compte Pro Vinted', 'Vestiaire Collective', 'Vide-grenier', 'Brocante', 'LeBonCoin', 'Instagram', 'Direct', 'Autre'];

type Classification = 'professional_resale' | 'personal_item' | 'uncertain_to_review';
type SaleFormStatus = 'completed' | 'colis_perdu' | 'pending' | 'canceled' | 'refunded';

const isRevenueStatus = (status: SaleFormStatus) => status === 'completed' || status === 'colis_perdu';

export default function SaleForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [classification, setClassification] = useState<Classification>('professional_resale');
  const [platform, setPlatform] = useState('Vinted');
  const [saleDate, setSaleDate] = useState(new Date().toISOString().slice(0, 10));
  const [encashDate, setEncashDate] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<SaleFormStatus>('completed');
  const [name, setName] = useState('');
  const [qty, setQty] = useState(1);
  const [sku, setSku] = useState('');
  const [price, setPrice] = useState('');
  const [buyer, setBuyer] = useState('');
  const [country, setCountry] = useState('FR');
  const [shipping, setShipping] = useState('');
  const [note, setNote] = useState('');
  const [overrideNote, setOverrideNote] = useState('');

  const amount = Number((price || '0').replace(',', '.')) || 0;
  const isManualForcedPersonal = classification === 'personal_item' && isRevenueStatus(status) && sku.trim() !== '';
  const willBeDeclarable =
    isRevenueStatus(status) &&
    classification === 'professional_resale';

  const onSubmit = async () => {
    const forced = classification === 'uncertain_to_review' ? undefined : classification;
    await api.sales.createManual({
      platform,
      sale_date: new Date(saleDate).toISOString(),
      finalization_date: encashDate ? new Date(encashDate).toISOString() : null,
      declared_encashment_date: encashDate ? new Date(encashDate).toISOString() : null,
      status,
      article_name: name,
      quantity: qty,
      sku: sku.trim() || null,
      sale_price_ttc: amount,
      amount_received: amount,
      buyer_username: buyer || null,
      buyer_country: country || null,
      shipping_cost_ttc: shipping ? Number(shipping.replace(',', '.')) : null,
      note: note || null,
      forcedClassification: forced,
      overrideNote: overrideNote || undefined
    });
    onSaved();
    onClose();
  };

  return (
    <WizardModal
      title="Ajouter une vente manuelle"
      onClose={onClose}
      onConfirm={onSubmit}
      confirmLabel="Enregistrer la vente"
      steps={[
        {
          title: 'Type de vente',
          description: "Détermine si la vente entre ou non dans le CA déclarable URSSAF.",
          content: (
            <Field label="Type de vente" hint="Si 'Je ne suis pas sûr', la vente sera marquée À revoir et non déclarable par sécurité.">
              <div className="wizard-choice-grid">
                {([
                  ['professional_resale', '💼 Pro / revente'],
                  ['personal_item', '🏠 Personnel / hors activité'],
                  ['uncertain_to_review', '🔎 Je ne suis pas sûr']
                ] as const).map(([v, l]) => (
                  <button key={v} type="button" className={`wizard-choice ${classification === v ? 'is-selected' : ''}`} onClick={() => setClassification(v)}>
                    {l}
                  </button>
                ))}
              </div>
            </Field>
          )
        },
        {
          title: 'Plateforme et dates',
          validate: () => !saleDate ? 'La date de vente est obligatoire.' : null,
          content: (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Plateforme"><Select value={platform} onChange={(e) => setPlatform(e.target.value)}>{PLATFORMS.map((p) => (<option key={p}>{p}</option>))}</Select></Field>
              <Field label="Statut"><Select value={status} onChange={(e) => setStatus(e.target.value as SaleFormStatus)}><option value="completed">Complétée (encaissée)</option><option value="colis_perdu">Colis perdu indemnisé</option><option value="pending">En attente</option><option value="canceled">Annulée</option><option value="refunded">Remboursée</option></Select></Field>
              <Field label="Date de vente"><Input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} /></Field>
              <Field label="Date d'encaissement"><Input type="date" value={encashDate} onChange={(e) => setEncashDate(e.target.value)} /></Field>
            </div>
          )
        },
        {
          title: 'Article',
          validate: () => !name.trim() ? "Le nom de l'article est obligatoire." : qty <= 0 ? 'La quantité doit être supérieure à 0.' : null,
          content: (
            <>
              <Field label="Nom de l'article"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Quantité"><Input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value) || 1)} /></Field>
                <Field label="SKU (optionnel)"><Input value={sku} onChange={(e) => setSku(e.target.value)} /></Field>
              </div>
            </>
          )
        },
        {
          title: 'Montants',
          validate: () => amount <= 0 && isRevenueStatus(status) ? 'Le montant encaissé doit être supérieur à 0 pour une vente encaissée.' : null,
          content: (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Montant encaissé (€)"><Input value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
              <Field label="Frais de port (€)"><Input value={shipping} onChange={(e) => setShipping(e.target.value)} /></Field>
              <Field label="Pays (FR, BE, ES…)"><Input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} /></Field>
            </div>
          )
        },
        {
          title: 'Documents et notes',
          validate: () => isManualForcedPersonal && !overrideNote.trim() ? 'Une note est obligatoire pour marquer en personnel une vente avec SKU.' : null,
          content: (
            <>
              <Field label="Acheteur / username"><Input value={buyer} onChange={(e) => setBuyer(e.target.value)} /></Field>
              <Field label="Notes"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              {isManualForcedPersonal && (
                <Field label="Note obligatoire (override manuel en personnel avec SKU)">
                  <Textarea rows={2} value={overrideNote} onChange={(e) => setOverrideNote(e.target.value)} placeholder="Ex : c'était un article de mon armoire malgré le SKU temporaire" />
                </Field>
              )}
            </>
          )
        },
        {
          title: 'Résumé',
          content: (
            <div className="card p-4 text-sm space-y-2">
              <div className="flex justify-between"><span>Article</span><strong>{name || '—'}</strong></div>
              <div className="flex justify-between"><span>Montant encaissé</span><strong>{eur(amount)}</strong></div>
              <div className="flex justify-between"><span>Déclarable URSSAF</span><strong className={willBeDeclarable ? 'text-emerald-700' : 'text-slate-500'}>{willBeDeclarable ? 'Oui' : 'Non'}</strong></div>
              <div className="flex justify-between"><span>Trimestre concerné</span><strong>{periodForDate(encashDate)}</strong></div>
            </div>
          )
        }
      ]}
    />
  );
}

function periodForDate(dateStr: string): string {
  if (!dateStr) return '—';
  const y = dateStr.slice(0, 4);
  const m = Number(dateStr.slice(5, 7));
  const q = m <= 3 ? 1 : m <= 6 ? 2 : m <= 9 ? 3 : 4;
  return `T${q} ${y}`;
}
