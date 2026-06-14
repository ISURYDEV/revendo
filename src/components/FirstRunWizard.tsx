import { useState } from 'react';
import { api } from '../lib/api';
import { Modal, Field, Input, Select } from './Modal';

/**
 * First-run wizard.
 * Asks: company name, SIRET, start date, ACRE dates, TVA regime and URSSAF periodicity.
 * Computes first échéance (with Q1+Q2 combined if start date is Jan-March of current year).
 */
export default function FirstRunWizard({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [commercialName, setCommercialName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [siret, setSiret] = useState('');
  const [address, setAddress] = useState('');
  const [activityStart, setActivityStart] = useState(new Date().toISOString().slice(0, 10));
  const [acreEnabled, setAcreEnabled] = useState(true);
  const [acreStart, setAcreStart] = useState('');
  const [acreEnd, setAcreEnd] = useState('');
  const [vatRegime, setVatRegime] = useState('franchise_en_base');
  const [periodicity, setPeriodicity] = useState<'trimestrial' | 'monthly'>('trimestrial');
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirm, setPassphraseConfirm] = useState('');
  const [passphraseTested, setPassphraseTested] = useState(false);
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const [testingPassphrase, setTestingPassphrase] = useState(false);

  // Compute suggested first échéance
  const computedDue = computeFirstDueDate(activityStart);

  const onFinish = async () => {
    await api.settings.set({
      commercial_name: commercialName,
      first_name: firstName,
      last_name: lastName,
      siret,
      address,
      activity_start_date: activityStart,
      activity_type: 'vente_marchandises_bic',
      acre_enabled: acreEnabled,
      acre_start_date: acreStart || activityStart,
      acre_end_date: acreEnd || addYearsIso(acreStart || activityStart, 3),
      vat_regime: vatRegime,
      urssaf_periodicity: periodicity,
      first_declaration_due_date: computedDue
    });
    onClose();
  };

  const strength = passphraseStrength(passphrase);
  const canTestPassphrase = passphrase.length >= 12 && passphrase === passphraseConfirm;

  const onTestPassphrase = async () => {
    setPassphraseError(null);
    setPassphraseTested(false);
    if (!canTestPassphrase) {
      setPassphraseError('La passphrase doit contenir au moins 12 caractères et être confirmée.');
      return;
    }
    setTestingPassphrase(true);
    try {
      await api.security.testPassphrase(passphrase);
      await api.settings.set({
        security_passphrase_verified: true,
        security_passphrase_set_at: new Date().toISOString()
      });
      setPassphraseTested(true);
    } catch (err) {
      setPassphraseError(err instanceof Error ? err.message : 'Le test de déchiffrement a échoué.');
    } finally {
      setTestingPassphrase(false);
    }
  };

  return (
    <Modal title={`Bienvenue — Configuration initiale (étape ${step}/4)`} onClose={onClose} size="lg">
      {step === 1 && (
        <>
          <p className="text-sm text-slate-600 mb-3">
            Avant de commencer, configurez les informations de votre entreprise. Elles servent à générer les factures et les déclarations.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nom commercial">
              <Input value={commercialName} onChange={(e) => setCommercialName(e.target.value)} />
            </Field>
            <Field label="SIRET">
              <Input value={siret} onChange={(e) => setSiret(e.target.value)} />
            </Field>
            <Field label="Nom">
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </Field>
            <Field label="Prénom">
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </Field>
          </div>
          <Field label="Adresse">
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-secondary" onClick={onClose}>Plus tard</button>
            <button className="btn-primary" onClick={() => setStep(2)}>Suivant</button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <p className="text-sm text-slate-600 mb-3">
            L'ACRE (Aide à la création d'entreprise) réduit les cotisations URSSAF pendant la première année.
          </p>
          <Field label="Date de début d'activité">
            <Input type="date" value={activityStart} onChange={(e) => setActivityStart(e.target.value)} />
          </Field>
          <Field label="ACRE activé ?">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={acreEnabled} onChange={(e) => setAcreEnabled(e.target.checked)} />
              Oui, je bénéficie de l'ACRE
            </label>
          </Field>
          {acreEnabled && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date début ACRE" hint={`Par défaut = début d'activité (${activityStart})`}>
                <Input type="date" value={acreStart} onChange={(e) => setAcreStart(e.target.value)} />
              </Field>
              <Field label="Date fin ACRE" hint="Habituellement +3 ans (= 12 trimestres à taux réduit)">
                <Input type="date" value={acreEnd} onChange={(e) => setAcreEnd(e.target.value)} />
              </Field>
            </div>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-secondary" onClick={() => setStep(1)}>Retour</button>
            <button className="btn-primary" onClick={() => setStep(3)}>Suivant</button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <p className="text-sm text-slate-600 mb-3">
            Régime fiscal et périodicité URSSAF.
          </p>
          <Field label="Régime TVA">
            <Select value={vatRegime} onChange={(e) => setVatRegime(e.target.value)}>
              <option value="franchise_en_base">Franchise en base de TVA (recommandé pour micro)</option>
              <option value="reel_simplifie">Réel simplifié</option>
              <option value="reel_normal">Réel normal</option>
            </Select>
          </Field>
          <Field label="Périodicité URSSAF">
            <Select value={periodicity} onChange={(e) => setPeriodicity(e.target.value as 'trimestrial' | 'monthly')}>
              <option value="trimestrial">Trimestrielle</option>
              <option value="monthly">Mensuelle</option>
            </Select>
          </Field>
          <div className="alert-info text-sm mt-3">
            <strong>Première échéance estimée :</strong> {formatDateFr(computedDue)}
            <div className="text-xs mt-1">
              {firstDueExplanation(activityStart, computedDue)}
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-secondary" onClick={() => setStep(2)}>Retour</button>
            <button className="btn-primary" onClick={() => setStep(4)}>Suivant</button>
          </div>
        </>
      )}

      {step === 4 && (
        <>
          <p className="text-sm text-slate-600 mb-3">
            Définissez une passphrase pour valider les sauvegardes chiffrées. Elle n'est jamais enregistrée par Revendo.
          </p>
          <div className="alert-info text-sm mb-3">
            Si vous perdez cette passphrase, vos backups chiffrés sont irrécupérables. Notez-la dans un gestionnaire de mots de passe.
          </div>
          <Field label="Passphrase de sécurité" hint="Minimum 12 caractères">
            <Input type="password" value={passphrase} onChange={(e) => { setPassphrase(e.target.value); setPassphraseTested(false); }} />
          </Field>
          <Field label="Confirmer la passphrase">
            <Input type="password" value={passphraseConfirm} onChange={(e) => { setPassphraseConfirm(e.target.value); setPassphraseTested(false); }} />
          </Field>
          <div className="text-sm mb-3">
            Robustesse : <strong className={strength === 'fort' ? 'text-emerald-600' : strength === 'moyen' ? 'text-amber-600' : 'text-red-600'}>{strength}</strong>
          </div>
          {passphraseError && <div className="alert-danger text-sm mb-3">{passphraseError}</div>}
          {passphraseTested && <div className="alert-success text-sm mb-3">Test de chiffrement/déchiffrement réussi.</div>}
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-secondary" onClick={() => setStep(3)}>Retour</button>
            <button className="btn-secondary" onClick={onTestPassphrase} disabled={!canTestPassphrase || testingPassphrase}>
              {testingPassphrase ? 'Test en cours...' : 'Tester un déchiffrement'}
            </button>
            <button className="btn-primary" onClick={onFinish} disabled={!passphraseTested}>Enregistrer et commencer</button>
          </div>
        </>
      )}
    </Modal>
  );
}

function passphraseStrength(value: string): 'faible' | 'moyen' | 'fort' {
  let score = value.length >= 12 ? 1 : 0;
  if (/[a-z]/.test(value)) score += 1;
  if (/[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  if (score >= 5) return 'fort';
  if (score >= 3) return 'moyen';
  return 'faible';
}

function computeFirstDueDate(startIso: string): string {
  // Per URSSAF: start month + 3 months grace before first declaration.
  // Standard: the first échéance is the one AT LEAST 90 days after start.
  // Simplified: if start is Q1, first declaration combines Q1+Q2 → due 31/07.
  if (!startIso) return '';
  const start = new Date(startIso);
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth() + 1;
  if (m <= 3) return `${y}-07-31`;     // Q1+Q2 → 31/07
  if (m <= 6) return `${y}-10-31`;     // Q3 → 31/10
  if (m <= 9) return `${y + 1}-01-31`; // Q4 → 31/01 N+1
  return `${y + 1}-04-30`;             // next Q1 → 30/04
}

function firstDueExplanation(startIso: string, dueIso: string): string {
  if (!startIso) return '';
  const month = Number(startIso.slice(5, 7));
  const due = formatDateFr(dueIso);
  if (month <= 3) return `Début en Q1 : la première échéance combine Q1 + Q2, échéance ${due}.`;
  if (month <= 6) return `Début en Q2 : la première échéance est Q3, échéance ${due}.`;
  if (month <= 9) return `Début en Q3 : la première échéance est Q4, échéance ${due}.`;
  return `Début en Q4 : la première échéance est Q1 N+1, échéance ${due}.`;
}

function addYearsIso(iso: string, years: number): string {
  const d = new Date(iso);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

function formatDateFr(iso: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
