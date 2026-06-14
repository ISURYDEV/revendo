import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { queueAction } from '../storage/actions';
import { notify } from '../components/Toast';

const CATEGORIES = [
  'emballages', 'frais_port', 'sacs_expedition', 'scotch', 'encre',
  'papier_etiquettes', 'fournitures', 'transport_essence',
  'abonnement_logiciel', 'boost_marketing', 'autre'
];

const PAYMENT_METHODS = ['carte', 'virement', 'especes', 'paypal', 'autre'];

export default function AddExpense() {
  const nav = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [category, setCategory] = useState('emballages');
  const [supplier, setSupplier] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('carte');
  const [notes, setNotes] = useState('');
  const [photoTaken, setPhotoTaken] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amount.replace(',', '.'));
    if (!Number.isFinite(amt) || amt <= 0) {
      notify('Montant invalide.', 'error');
      return;
    }
    setBusy(true);
    try {
      await queueAction({
        type: 'add_expense',
        payload: {
          date,
          category,
          supplier: supplier || null,
          description: description || null,
          amount_ttc: amt,
          payment_method: paymentMethod,
          notes: notes || null,
          has_photo: photoTaken
        }
      });
      notify('Dépense enregistrée hors ligne. Exportez les actions vers le PC.', 'success');
      nav('/');
    } catch (err) {
      notify(`Échec : ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <h1 className="text-xl font-bold">Ajouter une dépense</h1>
      <p className="text-xs text-slate-500">
        L'action est stockée localement, anonymement, sur ce téléphone. Elle ne réduit pas le CA URSSAF.
      </p>

      <div>
        <label className="label">Date</label>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </div>
      <div>
        <label className="label">Catégorie</label>
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Fournisseur</label>
        <input className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Optionnel" />
      </div>
      <div>
        <label className="label">Description</label>
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Détail" />
      </div>
      <div>
        <label className="label">Montant TTC (€)</label>
        <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required placeholder="0,00" />
      </div>
      <div>
        <label className="label">Moyen de paiement</label>
        <select className="input" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
          {PAYMENT_METHODS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Photo du justificatif (optionnel)</label>
        <input
          className="input"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => setPhotoTaken(!!e.target.files?.length)}
        />
        {photoTaken && (
          <div className="text-[11px] text-amber-700 mt-1">
            ⚠️ La photo n'est pas envoyée. Conservez-la dans votre galerie et associez-la sur le PC.
          </div>
        )}
      </div>
      <div>
        <label className="label">Note</label>
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
