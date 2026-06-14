import { useState } from 'react';
import { notify } from '../lib/notify';
import { api } from '../lib/api';
import { Modal, Field, Input } from './Modal';

export default function DangerZone() {
  const [open, setOpen] = useState(false);

  return (
    <section className="card p-4 border-2 border-red-300 bg-red-50/30 mt-6">
      <h2 className="text-lg font-semibold text-red-700 mb-2">Zone de danger</h2>
      <p className="text-sm text-slate-700 mb-3">
        Action irréversible. Permet de nettoyer entièrement la base de l'app, par exemple si vous avez importé
        des données incorrectes ou des doublons, ou si vous voulez repartir de zéro.
      </p>
      <button className="btn-danger" onClick={() => setOpen(true)}>
        Supprimer toutes les données…
      </button>
      {open && <ResetModal onClose={() => setOpen(false)} />}
    </section>
  );
}

function ResetModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'activity' | 'everything'>('activity');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);

  const canConfirm = confirmation === 'BORRAR' || confirmation === 'SUPPRIMER';

  const onConfirm = async () => {
    if (!canConfirm) return;
    setBusy(true);
    try {
      const r = await api.maint.reset(mode, confirmation);
      const deletedTotal = Object.values(r.deleted).reduce((s, n) => s + Math.max(0, n), 0);
      notify(`Reset effectué (${mode}). ${deletedTotal} ligne(s) supprimée(s). La page va se recharger.`);
      // Force reload to clear any in-memory state
      window.location.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Supprimer toutes les données ?" onClose={onClose} size="lg">
      <div className="alert-warn mb-4">
        <strong>Cette action est irréversible.</strong> Toutes les données d'activité/imports seront supprimées :
        ventes, récaps, doublons, conflits, logs et calculs sauvegardés. La configuration de base de l'entreprise
        peut être conservée en mode recommandé.
      </div>

      <Field label="Mode">
        <div className="space-y-2">
          <label className="flex items-start gap-2 cursor-pointer p-2 rounded border border-slate-200 hover:bg-slate-50">
            <input type="radio" checked={mode === 'activity'} onChange={() => setMode('activity')} className="mt-1" />
            <div>
              <div className="font-semibold">Supprimer données d'activité/imports <span className="pill bg-emerald-100 text-emerald-700 ml-1">recommandé</span></div>
              <div className="text-xs text-slate-600 mt-0.5">
                Supprime : ventes, achats, stock, dépenses, récaps, documents, déclarations, imports, audit log, agenda.<br/>
                Conserve : nom + SIRET + adresse + ACRE + dates + régime TVA + taux + réglages app.
              </div>
            </div>
          </label>
          <label className="flex items-start gap-2 cursor-pointer p-2 rounded border border-slate-200 hover:bg-slate-50">
            <input type="radio" checked={mode === 'everything'} onChange={() => setMode('everything')} className="mt-1" />
            <div>
              <div className="font-semibold text-red-700">Tout supprimer absolument</div>
              <div className="text-xs text-slate-600 mt-0.5">
                Inclut config entreprise, ACRE, taux, réglages. La prochaine ouverture relance l'assistant de bienvenue.
              </div>
            </div>
          </label>
        </div>
      </Field>

      <Field label="Confirmation" hint="Tapez SUPPRIMER en majuscules pour activer le bouton.">
        <Input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder="SUPPRIMER" autoFocus />
      </Field>

      <div className="flex justify-end gap-2 mt-3">
        <button className="btn-secondary" onClick={onClose} disabled={busy}>Annuler</button>
        <button
          className={`btn ${canConfirm ? 'btn-danger' : 'btn-secondary opacity-50 cursor-not-allowed'}`}
          onClick={onConfirm} disabled={!canConfirm || busy}>
          {busy ? 'Suppression…' : 'Confirmer la suppression définitive'}
        </button>
      </div>

      <p className="text-xs text-slate-400 mt-3">
        Important : cette fonction n'affecte pas les données officielles sur URSSAF, impots.gouv ou Vinted.
        Elle ne supprime que les données stockées localement dans la base de l'app.
      </p>
    </Modal>
  );
}
