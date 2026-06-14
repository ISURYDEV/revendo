import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Field, Input, Select, Textarea } from '../Modal';
import WizardModal from '../WizardModal';
import { eur } from '../../lib/format';
import type { ExpenseCategory } from '../../../shared/types';

const CATS: { value: ExpenseCategory; label: string }[] = [
  { value: 'boost_marketing', label: 'Boosts / marketing' },
  { value: 'sacs_expedition', label: "Sacs d'expédition" },
  { value: 'emballages', label: 'Emballages' },
  { value: 'scotch', label: 'Scotch' },
  { value: 'tinta_impresora', label: 'Encre / imprimante' },
  { value: 'papel_etiquetas', label: 'Papier / étiquettes' },
  { value: 'frais_port', label: 'Frais de port' },
  { value: 'fournitures_bureau', label: 'Fournitures bureau' },
  { value: 'materiel_photo', label: 'Matériel photo' },
  { value: 'achat_stock', label: 'Achat stock' },
  { value: 'abonnement_logiciel', label: 'Abonnement logiciel' },
  { value: 'frais_plateforme', label: 'Frais plateforme' },
  { value: 'autre', label: 'Autre' }
];

const PAYMENTS = ['Carte', 'Virement', 'Espèces', 'PayPal', 'Vinted Wallet', 'Autre'];

export default function ExpenseForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [category, setCategory] = useState<ExpenseCategory>('emballages');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [supplier, setSupplier] = useState('');
  const [platform, setPlatform] = useState('');
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [vat, setVat] = useState('');
  const [vatRecoverable, setVatRecoverable] = useState(false);
  const [payment, setPayment] = useState('Carte');
  const [linkType, setLinkType] = useState<'none' | 'sale' | 'purchase' | 'stock_item' | 'boost'>('none');
  const [linkId, setLinkId] = useState('');
  const [notes, setNotes] = useState('');
  const [vatRegime, setVatRegime] = useState<string>('franchise_en_base');

  useEffect(() => {
    api.settings.get().then((s) => setVatRegime(String(s.vat_regime ?? 'franchise_en_base')));
  }, []);

  const onSubmit = async () => {
    const num = (s: string) => Number((s || '0').replace(',', '.')) || 0;
    const payload: Parameters<typeof api.expenses.create>[0] = {
      date,
      category,
      supplier: supplier || null,
      platform: platform || null,
      description: desc || null,
      amount_ttc: num(amount),
      vat_amount: vat ? num(vat) : null,
      vat_deductible: vatRecoverable && vatRegime !== 'franchise_en_base' ? num(vat) : 0,
      payment_method: payment,
      notes: notes || null
    };
    if (linkType !== 'none' && linkId) {
      const id = Number(linkId);
      if (linkType === 'sale') payload.linked_sale_id = id;
      if (linkType === 'purchase') payload.linked_purchase_id = id;
      if (linkType === 'stock_item') payload.linked_stock_item_id = id;
      if (linkType === 'boost') payload.linked_boost_id = id;
    }
    await api.expenses.create(payload);
    onSaved();
    onClose();
  };

  return (
    <WizardModal
      title="Ajouter une dépense manuelle"
      onClose={onClose}
      onConfirm={onSubmit}
      confirmLabel="Enregistrer la dépense"
      steps={[
        {
          title: 'Catégorie',
          content: (
            <Field label="Catégorie">
              <Select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
                {CATS.map((c) => (<option key={c.value} value={c.value}>{c.label}</option>))}
              </Select>
            </Field>
          )
        },
        {
          title: 'Fournisseur et date',
          validate: () => !date ? 'La date est obligatoire.' : null,
          content: (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="Fournisseur / boutique"><Input value={supplier} onChange={(e) => setSupplier(e.target.value)} /></Field>
              <Field label="Plateforme"><Input value={platform} onChange={(e) => setPlatform(e.target.value)} /></Field>
              <Field label="Description"><Textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
            </div>
          )
        },
        {
          title: 'Montant et TVA',
          validate: () => !amount || Number(amount.replace(',', '.')) <= 0 ? 'Le montant TTC est obligatoire.' : null,
          content: (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Montant TTC (€)"><Input value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
                <Field label="TVA indiquée (€)"><Input value={vat} onChange={(e) => setVat(e.target.value)} /></Field>
                <Field label="Moyen de paiement"><Select value={payment} onChange={(e) => setPayment(e.target.value)}>{PAYMENTS.map((p) => (<option key={p}>{p}</option>))}</Select></Field>
              </div>
              <Field label="TVA récupérable ?" hint={vatRegime === 'franchise_en_base' ? "En franchise en base, la TVA n'est pas récupérable. Forcé à Non." : ''}>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={vatRecoverable && vatRegime !== 'franchise_en_base'} disabled={vatRegime === 'franchise_en_base'} onChange={(e) => setVatRecoverable(e.target.checked)} />
                  Oui, marquer TVA déductible = TVA indiquée
                </label>
              </Field>
            </>
          )
        },
        {
          title: 'Association',
          validate: () => linkType !== 'none' && !Number(linkId) ? "Indiquez l'ID associé ou choisissez Aucun." : null,
          content: (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Associé à ?"><Select value={linkType} onChange={(e) => setLinkType(e.target.value as typeof linkType)}><option value="none">Aucun (dépense générale)</option><option value="sale">Vente</option><option value="purchase">Achat</option><option value="stock_item">Article de stock</option><option value="boost">Boost</option></Select></Field>
              <Field label="ID associé"><Input value={linkId} onChange={(e) => setLinkId(e.target.value)} disabled={linkType === 'none'} placeholder="Ex. : 42" /></Field>
            </div>
          )
        },
        {
          title: 'Justificatif et notes',
          content: (
            <>
              <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
              <div className="alert-info text-xs">Rappel : les dépenses NE sont PAS déduites du CA URSSAF. Elles servent uniquement à la rentabilité réelle et aux justificatifs.</div>
            </>
          )
        },
        {
          title: 'Résumé',
          content: (
            <div className="card p-4 text-sm space-y-2">
              <div className="flex justify-between"><span>Catégorie</span><strong>{CATS.find((c) => c.value === category)?.label ?? category}</strong></div>
              <div className="flex justify-between"><span>Fournisseur</span><strong>{supplier || '—'}</strong></div>
              <div className="flex justify-between"><span>Montant TTC</span><strong>{eur(Number((amount || '0').replace(',', '.')) || 0)}</strong></div>
              <div className="flex justify-between"><span>TVA récupérable</span><strong>{vatRecoverable && vatRegime !== 'franchise_en_base' ? 'Oui' : 'Non'}</strong></div>
            </div>
          )
        }
      ]}
    />
  );
}
