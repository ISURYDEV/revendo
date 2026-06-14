import { useEffect, useState } from 'react';
import { notify } from '../lib/notify';
import { api } from '../lib/api';
import { pct } from '../lib/format';
import DangerZone from '../components/DangerZone';
import { Modal, Field as ModalField, Input as ModalInput } from '../components/Modal';
import type { ContributionRate } from '../../shared/types';

type PassphrasePurpose =
  | { kind: 'backup' }
  | { kind: 'export' }
  | { kind: 'test'; filePath: string };

function PassphraseDialog({
  title,
  description,
  requireConfirm,
  busy,
  onCancel,
  onSubmit
}: {
  title: string;
  description: string;
  requireConfirm: boolean;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (password.length < 12) {
      setError('Mot de passe trop court : utilisez au moins 12 caractères.');
      return;
    }
    if (requireConfirm && password !== confirmation) {
      setError('La confirmation ne correspond pas au mot de passe.');
      return;
    }
    setError(null);
    onSubmit(password);
  };

  return (
    <Modal title={title} onClose={onCancel} size="sm">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs text-slate-600 whitespace-pre-line">{description}</p>
        <ModalField label="Mot de passe (au moins 12 caractères)">
          <ModalInput
            type={show ? 'text' : 'password'}
            value={password}
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Au moins 12 caractères forts"
          />
        </ModalField>
        {requireConfirm && (
          <ModalField label="Confirmer le mot de passe">
            <ModalInput
              type={show ? 'text' : 'password'}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder="Retapez exactement le même"
            />
          </ModalField>
        )}
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
          Afficher le mot de passe
        </label>
        {error && <div className="text-xs text-red-600">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary text-sm" onClick={onCancel} disabled={busy}>Annuler</button>
          <button type="submit" className="btn-primary text-sm" disabled={busy}>
            {busy ? 'Traitement…' : 'Valider'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function Settings() {
  const [s, setS] = useState<Record<string, unknown>>({});
  const [rates, setRates] = useState<ContributionRate[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.settings.get().then(setS);
    api.rates.list().then(setRates);
  }, []);

  const update = (key: string, value: unknown) => setS({ ...s, [key]: value });

  const onSave = async () => {
    setSaving(true);
    await api.settings.set(s);
    setSaving(false);
    notify('Réglages enregistrés.');
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Réglages</h1>

      <Section title="Données entreprise">
        <Field label="Nom commercial">
          <Input value={s.commercial_name} onChange={(v) => update('commercial_name', v)} />
        </Field>
        <Field label="Nom">
          <Input value={s.last_name} onChange={(v) => update('last_name', v)} />
        </Field>
        <Field label="Prénom">
          <Input value={s.first_name} onChange={(v) => update('first_name', v)} />
        </Field>
        <Field label="SIRET">
          <Input value={s.siret} onChange={(v) => update('siret', v)} />
        </Field>
        <Field label="Adresse">
          <Input value={s.address} onChange={(v) => update('address', v)} />
        </Field>
        <Field label="Email">
          <Input value={s.email} onChange={(v) => update('email', v)} />
        </Field>
      </Section>

      <Section title="Activité et fiscalité">
        <Field label="Type d'activité">
          <select className="w-full border rounded px-2 py-1"
            value={(s.activity_type as string) ?? 'vente_marchandises_bic'}
            onChange={(e) => update('activity_type', e.target.value)}>
            <option value="vente_marchandises_bic">Vente de marchandises (BIC)</option>
            <option value="prestation_services_bic">Prestation de services (BIC)</option>
            <option value="prestation_services_bnc">Prestation de services (BNC)</option>
          </select>
        </Field>
        <Field label="Périodicité URSSAF">
          <select className="w-full border rounded px-2 py-1"
            value={(s.urssaf_periodicity as string) ?? 'trimestrial'}
            onChange={(e) => update('urssaf_periodicity', e.target.value)}>
            <option value="trimestrial">Trimestrielle</option>
            <option value="monthly">Mensuelle</option>
          </select>
        </Field>
        <Field label="Date début d'activité">
          <Input type="date" value={s.activity_start_date} onChange={(v) => update('activity_start_date', v)} />
        </Field>
        <Field label="Régime TVA">
          <select className="w-full border rounded px-2 py-1"
            value={(s.vat_regime as string) ?? 'franchise_en_base'}
            onChange={(e) => update('vat_regime', e.target.value)}>
            <option value="franchise_en_base">Franchise en base de TVA (recommandé)</option>
            <option value="reel_simplifie">Réel simplifié</option>
            <option value="reel_normal">Réel normal</option>
          </select>
        </Field>
        <Field label="ACRE activé">
          <input type="checkbox" checked={!!s.acre_enabled} onChange={(e) => update('acre_enabled', e.target.checked)} />
        </Field>
        <Field label="ACRE : date début">
          <Input type="date" value={s.acre_start_date} onChange={(v) => update('acre_start_date', v)} />
        </Field>
        <Field label="ACRE : date fin">
          <Input type="date" value={s.acre_end_date} onChange={(v) => update('acre_end_date', v)} />
        </Field>
      </Section>

      <Section title="Versement libératoire (optionnel)">
        <Field label="Activé">
          <input type="checkbox" checked={!!s.versement_liberatoire} onChange={(e) => update('versement_liberatoire', e.target.checked)} />
        </Field>
        <Field label="Taux versement libératoire">
          <Input value={s.versement_liberatoire_rate} onChange={(v) => update('versement_liberatoire_rate', v)} />
        </Field>
      </Section>

      <div>
        <button className="btn-primary" onClick={onSave} disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer les réglages'}
        </button>
      </div>

      <Section title="Taux de cotisations (modifiables)">
        <p className="text-xs text-slate-500 col-span-2 mb-2">
          Vérifiez les taux officiels sur{' '}
          <a href="https://www.autoentrepreneur.urssaf.fr/" target="_blank" rel="noreferrer" className="underline">urssaf.fr</a>{' '}
          et corrigez ici s'ils ont changé. Vente de marchandises BIC : ~12,3 % normal / ~6,2 % ACRE 1ère année.
        </p>
        <div className="col-span-2 card overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-2 py-1 text-left">Année</th>
                <th className="px-2 py-1 text-left">Activité</th>
                <th className="px-2 py-1 text-right">Taux normal</th>
                <th className="px-2 py-1 text-right">Taux ACRE</th>
                <th className="px-2 py-1 text-right">V. libératoire</th>
                <th className="px-2 py-1 text-left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-2 py-1">{r.year}</td>
                  <td className="px-2 py-1">{r.activity_type}</td>
                  <td className="px-2 py-1 text-right">{pct(r.normal_rate)}</td>
                  <td className="px-2 py-1 text-right">{pct(r.acre_rate)}</td>
                  <td className="px-2 py-1 text-right">
                    {r.versement_liberatoire_rate ? pct(r.versement_liberatoire_rate) : '—'}
                  </td>
                  <td className="px-2 py-1 text-xs text-slate-500">{r.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Données locales">
        <button className="btn-secondary col-span-2" onClick={() => api.app.openDataFolder()}>
          Ouvrir le dossier de données de l'app
        </button>
      </Section>

      <Section title="Maintenance">
        <button className="btn-secondary col-span-2"
          onClick={async () => {
            const r = await api.maint.reclassifyAll();
            notify(`${r.changed} sur ${r.processed} ventes reclassées selon les règles actuelles.`);
          }}>
          Reclasser toutes les ventes avec les règles actuelles
        </button>
      </Section>

      <BackupsSection />

      <CloudSyncSection />

      <SecurityPrivacySection />

      <PrivacyDataSection />

      <FutureSyncSection />

      <MobileFutureSection />

      <RevendoMobileSection />

      <MarketplaceImportsSection />

      <CfeSection />

      <ExportJsonSection />

      <DangerZone />
    </div>
  );
}

function BackupsSection() {
  const [list, setList] = useState<Awaited<ReturnType<typeof api.backup.list>>>([]);
  const [busy, setBusy] = useState(false);

  const refresh = () => api.backup.list().then(setList);
  useEffect(() => { refresh(); }, []);

  const onManual = async () => {
    setBusy(true);
    try { await api.backup.run('manual'); await refresh(); } finally { setBusy(false); }
  };
  const onExport = async () => {
    setBusy(true);
    try {
      const r = await api.backup.exportFull();
      if (!r.canceled && r.path) notify(`Copie exportée : ${r.path} (${((r.size ?? 0) / 1024 / 1024).toFixed(1)} MB)`);
    } finally { setBusy(false); }
  };

  return (
    <section className="card p-4">
      <h2 className="text-lg font-semibold mb-3">Backups</h2>
      <p className="text-sm text-slate-600 mb-3">
        À la fermeture de l'app, une sauvegarde quotidienne est créée automatiquement dans <code>backups/daily/</code>.
        Le 1er jour de chaque mois, un snapshot mensuel permanent est aussi créé dans <code>backups/monthly/</code>.
        Les sauvegardes quotidiennes sont conservées 30 jours par défaut.
      </p>
      <div className="flex gap-2 mb-3">
        <button className="btn-secondary text-sm" onClick={onManual} disabled={busy}>Créer une sauvegarde maintenant</button>
        <button className="btn-primary text-sm" onClick={onExport} disabled={busy}>Exporter une copie complète…</button>
      </div>
      <div className="card overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-100"><tr>
            <th className="px-2 py-1 text-left">Type</th>
            <th className="px-2 py-1 text-left">Fichier</th>
            <th className="px-2 py-1 text-right">Taille</th>
            <th className="px-2 py-1 text-left">Date</th>
          </tr></thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.path} className="border-t">
                <td className="px-2 py-1"><span className={`pill ${b.kind === 'monthly' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}`}>{b.kind}</span></td>
                <td className="px-2 py-1 truncate max-w-[280px]" title={b.path}>{b.name}</td>
                <td className="px-2 py-1 text-right">{(b.size / 1024 / 1024).toFixed(1)} MB</td>
                <td className="px-2 py-1 font-mono">{b.mtime.slice(0, 16).replace('T', ' ')}</td>
              </tr>
            ))}
            {list.length === 0 && (<tr><td colSpan={4} className="p-4 text-center text-slate-400">Aucune sauvegarde pour le moment (créée à la fermeture de l'app).</td></tr>)}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-4">
      <h2 className="text-lg font-semibold mb-3">{title}</h2>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

function Input({
  value,
  onChange,
  type = 'text'
}: {
  value: unknown;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <input
      type={type}
      className="w-full border border-slate-300 rounded px-2 py-1"
      value={(value as string) ?? ''}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function bytes(n?: number | null): string {
  const v = Number(n ?? 0);
  if (v > 1024 * 1024 * 1024) return `${(v / 1024 / 1024 / 1024).toFixed(2)} Go`;
  if (v > 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} Mo`;
  if (v > 1024) return `${(v / 1024).toFixed(0)} Ko`;
  return `${v} o`;
}

function useSecurityStatus() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.security.status>> | null>(null);
  const load = () => api.security.status().then(setStatus);
  useEffect(() => { load(); }, []);
  return { status, load };
}

function SecurityPrivacySection() {
  const { status, load } = useSecurityStatus();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<PassphrasePurpose | null>(null);
  if (!status) return null;

  const save = async (key: string, value: boolean) => {
    await api.security.saveOptions({ [key]: value });
    load();
  };

  const startEncryptedBackup = () => setDialog({ kind: 'backup' });
  const startEncryptedExport = () => setDialog({ kind: 'export' });
  const startTestEncrypted = async () => {
    try {
      const picked = await api.security.pickEncryptedFile();
      if (picked.canceled || !picked.filePath) return;
      setDialog({ kind: 'test', filePath: picked.filePath });
    } catch (err) {
      notify(`Sélection du fichier impossible : ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const closeDialog = () => { if (!busy) setDialog(null); };

  const submitPassphrase = async (password: string) => {
    if (!dialog) return;
    setBusy(true);
    try {
      if (dialog.kind === 'backup') {
        const r = await api.security.encryptedBackup(password);
        notify(`Sauvegarde chiffrée créée :\n${r.path}\n\n${bytes(r.size)}`, 'success');
      } else if (dialog.kind === 'export') {
        const r = await api.security.exportEncrypted(password, true);
        notify(`Export chiffré créé :\n${r.path}\n\n${r.rowCount} ligne(s), ${bytes(r.size)}`, 'success');
      } else if (dialog.kind === 'test') {
        const r = await api.security.testEncryptedFile(dialog.filePath, password);
        notify(`Test réussi : le fichier peut être déchiffré.\n\n${bytes(r.decryptedBytes)} vérifiés.`, 'success');
      }
      load();
      setDialog(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const prefix =
        dialog.kind === 'backup' ? 'Échec de la sauvegarde chiffrée'
        : dialog.kind === 'export' ? "Échec de l'export chiffré"
        : 'Test de déchiffrement échoué';
      notify(`${prefix} : ${message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const dialogConfig = (() => {
    if (!dialog) return null;
    if (dialog.kind === 'backup') return {
      title: 'Créer une sauvegarde chiffrée',
      description:
        'Choisissez un mot de passe fort.\n' +
        "Revendo ne le stocke jamais : si vous le perdez, la sauvegarde ne pourra pas être restaurée.\n" +
        'Notez-le dans un gestionnaire de mots de passe avant de valider.',
      requireConfirm: true
    };
    if (dialog.kind === 'export') return {
      title: 'Créer un export sensible chiffré',
      description:
        "Choisissez un mot de passe fort.\nL'export sera anonymisé et chiffré.\n" +
        'Notez le mot de passe dans un gestionnaire : sans lui le fichier est irrécupérable.',
      requireConfirm: true
    };
    return {
      title: 'Tester le déchiffrement',
      description:
        'Saisissez le mot de passe utilisé lors du chiffrement du fichier sélectionné.\n' +
        'Aucune copie déchiffrée ne sera conservée — seul le test est exécuté.',
      requireConfirm: false
    };
  })();

  return (
    <section className="card p-4">
      <h2 className="text-lg font-semibold mb-2">🔐 Sécurité & confidentialité</h2>
      <p className="text-sm text-slate-500 mb-4">
        Revendo reste local-first. Ces options limitent l’exposition des données personnelles dans l’interface,
        les exports, les sauvegardes et la vue mobile.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={status.settings.maskBuyer} onChange={(e) => save('privacy_mask_buyers_ui', e.target.checked)} />
            <span>Masquer les données acheteur dans l’interface</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={status.settings.maskContact} onChange={(e) => save('privacy_mask_contact_ui', e.target.checked)} />
            <span>Masquer les emails et adresses</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={status.settings.maskUsername} onChange={(e) => save('privacy_mask_username_ui', e.target.checked)} />
            <span>Masquer aussi les usernames</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={status.settings.anonymizedExports} onChange={(e) => save('privacy_exports_anonymized_default', e.target.checked)} />
            <span>Générer les exports en mode anonymisé par défaut</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={status.settings.mobileRedaction} onChange={(e) => save('mobile_snapshot_redaction_enabled', e.target.checked)} />
            <span>Protéger les snapshots mobiles par anonymisation</span>
          </label>
        </div>
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={status.settings.backupEncryptionEnabled} onChange={(e) => save('security_backup_encryption_enabled', e.target.checked)} />
            <span>Activer le chiffrement des sauvegardes</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={status.settings.exportEncryptionEnabled} onChange={(e) => save('security_export_encryption_enabled', e.target.checked)} />
            <span>Activer le chiffrement des exports sensibles</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={status.settings.snapshotEncryptionEnabled} onChange={(e) => save('security_snapshot_encryption_enabled', e.target.checked)} />
            <span>Activer le chiffrement des snapshots mobiles sensibles</span>
          </label>
          <div className="flex gap-2 flex-wrap pt-2">
            <button className="btn-primary text-sm" disabled={busy} onClick={startEncryptedBackup}>Créer une sauvegarde sécurisée maintenant</button>
            <button className="btn-secondary text-sm" disabled={busy} onClick={startEncryptedExport}>Créer un export chiffré anonymisé</button>
            <button className="btn-secondary text-sm" disabled={busy} onClick={startTestEncrypted}>Tester un fichier chiffré</button>
          </div>
        </div>
      </div>
      <div className="alert-info text-xs mt-4">
        État : {status.settings.backupEncryptionEnabled ? 'sauvegardes chiffrées activables' : 'sauvegardes classiques par défaut'} ·
        {status.settings.mobileRedaction ? ' snapshot mobile anonymisé par défaut' : ' snapshot mobile complet autorisé'}.
        La base SQLite locale n’est pas chiffrée automatiquement pour éviter de casser les données existantes.
      </div>
      {dialog && dialogConfig && (
        <PassphraseDialog
          title={dialogConfig.title}
          description={dialogConfig.description}
          requireConfirm={dialogConfig.requireConfirm}
          busy={busy}
          onCancel={closeDialog}
          onSubmit={submitPassphrase}
        />
      )}
    </section>
  );
}

function PrivacyDataSection() {
  const { status, load } = useSecurityStatus();
  const [busy, setBusy] = useState(false);
  if (!status) return null;

  const backup = async () => {
    setBusy(true);
    try {
      const r = await api.backup.run('manual');
      notify(`Sauvegarde créée :\n${r.path}`, 'success');
      load();
    } catch (err) {
      notify(`Échec de la sauvegarde : ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally { setBusy(false); }
  };

  const anonExport = async () => {
    try {
      const r = await api.security.exportAnon();
      if (!r.canceled) notify(`Export anonymisé créé :\n${r.path}\n\n${r.rowCount} ligne(s).`, 'success');
      load();
    } catch (err) {
      notify(`Échec de l'export anonymisé : ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const check = async () => {
    try {
      const r = await api.security.checkBackups();
      notify(`${r.ok}/${r.checked} sauvegarde(s) vérifiée(s). Erreurs : ${r.errors}.`, r.errors === 0 ? 'success' : 'warning');
      load();
    } catch (err) {
      notify(`Vérification impossible : ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const clean = async () => {
    try {
      const r = await api.security.cleanTemp();
      notify(`${r.deleted} fichier(s) temporaire(s) supprimé(s).`, 'success');
    } catch (err) {
      notify(`Nettoyage impossible : ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  return (
    <section className="card p-4">
      <h2 className="text-lg font-semibold mb-2">🗂️ Confidentialité & données</h2>
      <div className="alert-info text-xs mb-3">{status.notice}</div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <InfoLine label="Base locale" value={status.paths.dbPath} />
        <InfoLine label="Documents" value={status.paths.documentsDir} />
        <InfoLine label="Sauvegardes" value={status.paths.backupsDir} />
        <InfoLine label="Exports" value={status.paths.exportsDir} />
        <InfoLine label="Taille base" value={bytes(status.sizes.databaseBytes)} />
        <InfoLine label="Taille documents" value={bytes(status.sizes.documentsBytes)} />
        <InfoLine label="Taille backups" value={bytes(status.sizes.backupsBytes)} />
        <InfoLine label="Dernier backup" value={status.latestBackup ?? 'Aucun'} />
      </div>
      <div className="flex gap-2 flex-wrap mt-4">
        <button className="btn-secondary text-sm" onClick={() => api.app.openDataFolder()}>Ouvrir le dossier des données</button>
        <button className="btn-secondary text-sm" onClick={() => api.app.openDocsFolder()}>Ouvrir le dossier des documents</button>
        <button className="btn-secondary text-sm" onClick={() => api.security.openBackups()}>Ouvrir le dossier des sauvegardes</button>
        <button className="btn-secondary text-sm" onClick={() => api.security.openExports()}>Ouvrir le dossier des exports</button>
        <button className="btn-primary text-sm" disabled={busy} onClick={backup}>Créer une sauvegarde maintenant</button>
        <button className="btn-secondary text-sm" onClick={anonExport}>Exporter mes données anonymisées</button>
        <button className="btn-secondary text-sm" onClick={check}>Vérifier l’intégrité des sauvegardes</button>
        <button className="btn-secondary text-sm" onClick={clean}>Nettoyer les fichiers temporaires</button>
        <button className="btn-secondary text-sm" onClick={() => window.location.hash = '#/documents'}>Voir les documents non associés</button>
      </div>
    </section>
  );
}

function FutureSyncSection() {
  const { status } = useSecurityStatus();
  if (!status) return null;
  return (
    <section className="card p-4">
      <h2 className="text-lg font-semibold mb-2">🔄 Synchronisation future</h2>
      <p className="text-sm text-slate-500 mb-3">
        Synchronisation non configurée. Revendo fonctionne actuellement en local. La base est préparée
        pour une synchronisation future, sans serveur ni login pour l’instant.
      </p>
      <div className="grid grid-cols-4 gap-3 text-sm">
        <div className="card p-3"><div className="text-xs text-slate-500">Changements locaux</div><strong>{status.sync.pendingChanges}</strong></div>
        <div className="card p-3"><div className="text-xs text-slate-500">Dernière modification</div><strong>{status.sync.lastModifiedAt ? new Date(status.sync.lastModifiedAt).toLocaleString('fr-FR') : '—'}</strong></div>
        <div className="card p-3"><div className="text-xs text-slate-500">Conflits</div><strong>{status.sync.conflicts}</strong></div>
        <div className="card p-3"><div className="text-xs text-slate-500">Mode</div><strong>Local uniquement</strong></div>
      </div>
      <button className="btn-secondary text-sm mt-3 opacity-60 cursor-not-allowed" disabled>Configurer la synchronisation — à venir</button>
    </section>
  );
}

function MobileFutureSection() {
  const { status, load } = useSecurityStatus();
  const [busy, setBusy] = useState(false);
  const [askPwd, setAskPwd] = useState(false);
  if (!status) return null;

  const runSnapshot = async (encrypted: boolean, password?: string) => {
    setBusy(true);
    try {
      const r = await api.security.mobileSnapshot({ anonymized: true, encrypted, password });
      notify(`Snapshot mobile créé :\n${r.path}\n\n${bytes(r.size)} · ${r.rowCount} ligne(s).`, 'success');
      load();
      setAskPwd(false);
    } catch (err) {
      notify(`Échec du snapshot mobile : ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally { setBusy(false); }
  };

  return (
    <section className="card p-4">
      <h2 className="text-lg font-semibold mb-2">📱 Mobile / export mobile</h2>
      <p className="text-sm text-slate-500 mb-3">
        Ce n’est pas encore une app mobile native. Revendo prépare des snapshots lecture seule avec des DTOs propres,
        anonymisés par défaut, pour une future app mobile.
      </p>
      <div className="flex gap-2 flex-wrap">
        <button className="btn-primary text-sm" disabled={busy} onClick={() => runSnapshot(false)}>Générer snapshot mobile anonymisé</button>
        <button className="btn-secondary text-sm" disabled={busy} onClick={() => setAskPwd(true)}>Générer snapshot mobile chiffré</button>
        <button className="btn-secondary text-sm" onClick={() => api.security.openSnapshots()}>Ouvrir le dossier des snapshots</button>
      </div>
      <div className="text-xs text-slate-500 mt-3">
        Données incluses : dashboard, ventes résumées, stock résumé, dépenses résumées, URSSAF résumé,
        Centre de révision résumé et métadonnées documents. Les emails/adresses ne sont pas inclus par défaut.
      </div>
      {askPwd && (
        <PassphraseDialog
          title="Snapshot mobile chiffré"
          description={'Choisissez un mot de passe fort.\nIl sera nécessaire pour ouvrir le snapshot sur votre téléphone.'}
          requireConfirm={true}
          busy={busy}
          onCancel={() => { if (!busy) setAskPwd(false); }}
          onSubmit={(pwd) => runSnapshot(true, pwd)}
        />
      )}
    </section>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-2">
      <div className="text-slate-500">{label}</div>
      <div className="font-mono truncate" title={value}>{value}</div>
    </div>
  );
}

function CloudSyncSection() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.cloud.status>> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.cloud.status().then(setStatus);
  useEffect(() => { load(); }, []);

  if (!status) return null;

  const onPickFolder = async () => {
    const r = await api.cloud.pickFolder();
    if (r.canceled || !r.path) return;
    const provider = inferProviderFromPath(r.path);
    await api.cloud.saveConfig({ enabled: true, folder: r.path, provider });
    load();
  };

  const onUseDetected = async (path: string, provider: string) => {
    const targetSubdir = `${path}\\Revendo Backups`;
    await api.cloud.saveConfig({ enabled: true, folder: path, provider: provider as 'google_drive' | 'onedrive' | 'dropbox' | 'icloud' | 'other' });
    void targetSubdir;
    load();
  };

  const onToggle = async (enabled: boolean) => {
    if (!status.folder && enabled) {
      notify('Configurez d\'abord un dossier de sauvegarde.');
      return;
    }
    await api.cloud.saveConfig({ enabled, folder: status.folder ?? '', provider: (status.providerHint ?? 'other') });
    load();
  };

  const onSyncNow = async () => {
    setBusy(true);
    try {
      const r = await api.cloud.syncNow();
      if (r.ok) {
        notify(`Sauvegarde envoyée dans le dossier cloud :\n${r.copiedTo}\n\n${((r.size ?? 0) / 1024 / 1024).toFixed(1)} MB.\nGoogle Drive / OneDrive le synchronisera automatiquement vers le cloud.`);
      } else {
        notify(`Erreur : ${r.reason}`);
      }
      load();
    } finally { setBusy(false); }
  };

  const onUpdateKeep = async (n: number) => {
    await api.cloud.saveConfig({ enabled: status.enabled, folder: status.folder ?? '', provider: (status.providerHint ?? 'other'), keepVersions: n });
    load();
  };

  const providerLabel = (p: string | null) =>
    p === 'google_drive' ? 'Google Drive' :
    p === 'onedrive' ? 'OneDrive' :
    p === 'dropbox' ? 'Dropbox' :
    p === 'icloud' ? 'iCloud Drive' : 'Autre';

  const providerIcon = (p: string | null) =>
    p === 'google_drive' ? '🟢' :
    p === 'onedrive' ? '🔵' :
    p === 'dropbox' ? '🔷' :
    p === 'icloud' ? '☁️' : '📁';

  return (
    <section className="card p-4">
      <h2 className="text-lg font-semibold mb-2">☁️ Synchronisation cloud (Google Drive / OneDrive / Dropbox)</h2>
      <p className="text-sm text-slate-600 mb-3">
        Revendo écrit une copie de chaque sauvegarde dans un dossier de votre PC. Si ce dossier est à l'intérieur
        de votre <strong>Google Drive Desktop</strong> (ou OneDrive / Dropbox), le client officiel envoie automatiquement
        la copie sur le cloud. Aucune authentification, aucune clé API.
      </p>

      {!status.detectedFolders.find((f) => f.provider === 'google_drive') && (
        <div className="alert-info text-xs mb-3">
          💡 Pour utiliser Google Drive : installez l'app officielle{' '}
          <a href="https://www.google.com/drive/download/" target="_blank" rel="noreferrer" className="underline">
            Google Drive pour Windows
          </a> (5 min, gratuit). Elle crée un dossier <code>Google Drive</code> sur votre PC qui se synchronise tout seul.
        </div>
      )}

      {/* Detected folders */}
      {status.detectedFolders.length > 0 && !status.folder && (
        <div className="space-y-2 mb-3">
          <div className="text-xs font-semibold text-slate-700">Dossiers cloud détectés sur votre PC :</div>
          {status.detectedFolders.map((f) => (
            <button
              key={f.path}
              className="w-full text-left p-2 bg-slate-50 hover:bg-slate-100 rounded border border-slate-200 flex items-center gap-2"
              onClick={() => onUseDetected(f.path, f.provider)}
            >
              <span className="text-2xl">{providerIcon(f.provider)}</span>
              <div className="flex-1">
                <div className="font-medium text-sm">{f.label}</div>
                <div className="text-xs text-slate-500 truncate">{f.path}</div>
              </div>
              <span className="btn-primary text-xs">Utiliser ce dossier</span>
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <div className="text-xs font-semibold text-slate-700 mb-1">État</div>
          <div className="card p-3 bg-slate-50">
            {status.folder ? (
              <>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-xl">{providerIcon(status.providerHint)}</span>
                  <strong>{providerLabel(status.providerHint)}</strong>
                  {status.enabled
                    ? <span className="pill bg-emerald-100 text-emerald-700">Actif</span>
                    : <span className="pill bg-slate-100 text-slate-600">Désactivé</span>
                  }
                </div>
                <div className="text-xs text-slate-500 mt-1 truncate" title={status.folder}>{status.folder}</div>
                {!status.folderExists && <div className="text-xs text-red-700 mt-1">⚠️ Dossier introuvable — vérifiez que Drive est lancé</div>}
                <div className="text-xs text-slate-500 mt-2">
                  Dernière sync : {status.lastRun ? new Date(status.lastRun).toLocaleString('fr-FR') : 'jamais'}
                  {status.lastStatus === 'ok' && <span className="text-emerald-700 ml-1">✓</span>}
                  {status.lastStatus === 'error' && <span className="text-red-700 ml-1">✗</span>}
                  {status.lastStatus === 'skipped' && <span className="text-slate-500 ml-1">(déjà à jour)</span>}
                </div>
                {status.lastError && <div className="text-xs text-red-700 mt-1">{status.lastError}</div>}
              </>
            ) : (
              <div className="text-sm text-slate-500">Aucun dossier configuré.</div>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold text-slate-700 mb-1">Configuration</div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={status.enabled} disabled={!status.folder} onChange={(e) => onToggle(e.target.checked)} />
              Activer la synchronisation automatique
            </label>
            <div className="flex items-center gap-2 text-sm">
              <span>Garder</span>
              <input
                type="number"
                min="7"
                max="365"
                className="border rounded px-2 py-0.5 w-16 text-sm"
                value={status.keepVersions}
                onChange={(e) => onUpdateKeep(Number(e.target.value) || 60)}
              />
              <span>versions quotidiennes</span>
            </div>
            <div className="text-xs text-slate-500">Les snapshots mensuels sont conservés indéfiniment.</div>
          </div>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <button className="btn-secondary text-sm" onClick={onPickFolder}>
          {status.folder ? '📁 Changer de dossier' : '📁 Choisir un dossier…'}
        </button>
        <button className="btn-primary text-sm" onClick={onSyncNow} disabled={busy || !status.enabled || !status.folder}>
          {busy ? 'Synchronisation…' : '☁️ Sauvegarder maintenant'}
        </button>
        {status.folder && (
          <button className="btn-secondary text-sm" onClick={() => api.cloud.openFolder()}>
            🗂️ Ouvrir le dossier cloud
          </button>
        )}
      </div>

      {/* Mobile + Documents options */}
      {status.folder && (
        <div className="mt-4 border-t border-slate-200 pt-4">
          <div className="text-sm font-semibold mb-2">📱 Vue mobile + documents</div>
          <div className="space-y-2">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={status.includeMobile}
                onChange={async (e) => { await api.cloud.saveOptions({ includeMobile: e.target.checked }); load(); }}
              />
              <div>
                <div className="font-medium">Générer la vue mobile (HTML lecture seule)</div>
                <div className="text-xs text-slate-500">
                  Un fichier <code>revendo_mobile.html</code> avec toutes les données est créé dans
                  <code> Revendo Backups/mobile/</code>. Ouvrez-le depuis l'app Google Drive sur Android.
                  Dernière génération : {status.mobileLastGen ? new Date(status.mobileLastGen).toLocaleString('fr-FR') : 'jamais'}
                </div>
              </div>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={status.includeDocuments}
                onChange={async (e) => { await api.cloud.saveOptions({ includeDocuments: e.target.checked }); load(); }}
              />
              <div>
                <div className="font-medium">Inclure les documents (PDF/images)</div>
                <div className="text-xs text-slate-500">
                  Copie la dossier <code>documents/</code> entier vers
                  <code> Revendo Backups/documents/</code> pour télécharger les justificatifs depuis le mobile.
                  Dernière sync : {status.documentsLastSync ? new Date(status.documentsLastSync).toLocaleString('fr-FR') : 'jamais'}
                  {status.documentsFilesSynced > 0 && ` · ${status.documentsFilesSynced} fichier(s)`}
                </div>
              </div>
            </label>
          </div>

          <div className="flex gap-2 mt-3 flex-wrap">
            <button
              className="btn-secondary text-xs"
              disabled={!status.enabled || !status.includeMobile}
              onClick={async () => {
                const r = await api.cloud.syncMobile();
                if (r.ok) notify(`Vue mobile générée (${((r.size ?? 0) / 1024).toFixed(0)} KB, ${r.rowCount} lignes).\nAccessible dans Google Drive ▸ Revendo Backups ▸ mobile.`);
                else notify(`Erreur : ${r.reason}`);
                load();
              }}
            >📱 Régénérer la vue mobile</button>
            <button
              className="btn-secondary text-xs"
              disabled={!status.enabled || !status.includeDocuments}
              onClick={async () => {
                const r = await api.cloud.syncDocs();
                if (r.ok) notify(`${r.copied} fichier(s) copié(s) sur ${r.total} total.`);
                else notify(`Erreur : ${r.reason}`);
                load();
              }}
            >📁 Synchroniser les documents</button>
          </div>
        </div>
      )}

      <details className="mt-3 text-xs text-slate-500">
        <summary className="cursor-pointer">Comment ouvrir la vue mobile sur Android ?</summary>
        <ol className="list-decimal list-inside mt-2 space-y-1">
          <li>Installez l'app <strong>Google Drive</strong> depuis le Play Store (si ce n'est pas déjà fait).</li>
          <li>Ouvrez l'app, connectez-vous avec le même compte Google que sur votre PC.</li>
          <li>Naviguez dans <strong>Mon Drive ▸ Revendo Backups ▸ mobile</strong>.</li>
          <li>Touchez <code>revendo_mobile.html</code> → "Ouvrir avec…" → choisissez <strong>Chrome</strong> (ou un autre navigateur).</li>
          <li>Vous voyez tous vos données en lecture seule : ventes, achats, dépenses, déclarations URSSAF.</li>
          <li>Pour télécharger un PDF : revenez dans Drive, naviguez dans <strong>documents/</strong>, touchez le fichier.</li>
        </ol>
        <p className="mt-2">⚠️ Modifications faites sur PC se voient sur le téléphone <strong>après la prochaine sync</strong> (au fermeture de l'app PC ou via "Sauvegarder maintenant").</p>
      </details>
    </section>
  );
}

function MarketplaceImportsSection() {
  const [marketplaces, setMarketplaces] = useState<Awaited<ReturnType<typeof api.marketplaces.list>>>([]);
  const [channels, setChannels] = useState<Awaited<ReturnType<typeof api.channels.list>>>([]);
  const [suppliers, setSuppliers] = useState<Awaited<ReturnType<typeof api.suppliers.list>>>([]);
  const [templates, setTemplates] = useState<Awaited<ReturnType<typeof api.csvTemplates.list>>>([]);
  const [templateName, setTemplateName] = useState('');
  const [templateEntity, setTemplateEntity] = useState<'sales' | 'purchases' | 'expenses' | 'stock'>('sales');
  const [templatePlatform, setTemplatePlatform] = useState<number | ''>('');
  const [templateJson, setTemplateJson] = useState('{\n  "date": "Date",\n  "article_name": "Article",\n  "amount_received": "Montant"\n}');

  const load = async () => {
    const [m, c, s, t] = await Promise.all([
      api.marketplaces.list(),
      api.channels.list(),
      api.suppliers.list(),
      api.csvTemplates.list()
    ]);
    setMarketplaces(m);
    setChannels(c);
    setSuppliers(s);
    setTemplates(t);
  };
  useEffect(() => { load(); }, []);

  const toggleMarketplace = async (id: number, isActive: number) => {
    await api.marketplaces.update(id, { is_active: isActive ? 0 : 1 });
    load();
  };

  const createTemplate = async () => {
    if (!templateName.trim()) return notify('Nom du modèle obligatoire.');
    let mapping: Record<string, string>;
    try {
      mapping = JSON.parse(templateJson) as Record<string, string>;
    } catch {
      return notify('Mapping JSON invalide. Exemple: {"date":"Date","amount_received":"Montant"}');
    }
    await api.csvTemplates.create({
      name: templateName.trim(),
      entity_type: templateEntity,
      platform_id: templatePlatform === '' ? null : Number(templatePlatform),
      adapter_id: `generic_${templateEntity}_csv`,
      mapping,
      currency: 'EUR'
    });
    setTemplateName('');
    load();
  };

  return (
    <section className="card p-4">
      <h2 className="text-lg font-semibold mb-2">🌍 Plateformes & imports</h2>
      <p className="text-sm text-slate-500 mb-4">
        Base multi-marketplace de Revendo : plateformes, canaux, fournisseurs et modèles CSV réutilisables.
        Vinteer reste un adaptateur d’import, Vinted reste la plateforme de vente.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <h3 className="font-semibold">Plateformes</h3>
          <div className="card overflow-auto max-h-72">
            <table className="w-full text-xs">
              <thead><tr><th className="text-left p-2">Nom</th><th className="text-left p-2">Type</th><th className="text-left p-2">Devise</th><th className="p-2"></th></tr></thead>
              <tbody>
                {marketplaces.map((m) => (
                  <tr key={m.id} className="border-t border-slate-700/20">
                    <td className="p-2 font-medium">{m.name}</td>
                    <td className="p-2">{m.type}</td>
                    <td className="p-2">{m.default_currency}</td>
                    <td className="p-2 text-right">
                      <button className="btn-secondary text-xs" onClick={() => toggleMarketplace(m.id, m.is_active)}>
                        {m.is_active ? 'Désactiver' : 'Activer'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="font-semibold">Canaux</h3>
          <div className="card overflow-auto max-h-72">
            <table className="w-full text-xs">
              <thead><tr><th className="text-left p-2">Nom</th><th className="text-left p-2">Plateforme</th><th className="text-left p-2">Type</th></tr></thead>
              <tbody>
                {channels.map((c) => (
                  <tr key={c.id} className="border-t border-slate-700/20">
                    <td className="p-2 font-medium">{c.name}</td>
                    <td className="p-2">{c.marketplace_name ?? '—'}</td>
                    <td className="p-2">{c.channel_type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="font-semibold">Fournisseurs détectés</h3>
          <div className="card overflow-auto max-h-64">
            <table className="w-full text-xs">
              <thead><tr><th className="text-left p-2">Nom</th><th className="text-left p-2">Plateforme</th><th className="text-left p-2">Type</th></tr></thead>
              <tbody>
                {suppliers.slice(0, 80).map((s) => (
                  <tr key={s.id} className="border-t border-slate-700/20">
                    <td className="p-2 font-medium">{s.name}</td>
                    <td className="p-2">{s.platform_name ?? '—'}</td>
                    <td className="p-2">{s.supplier_type}</td>
                  </tr>
                ))}
                {suppliers.length === 0 && <tr><td className="p-4 text-center text-slate-400" colSpan={3}>Aucun fournisseur détecté.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="font-semibold">Modèles CSV</h3>
          <div className="grid grid-cols-2 gap-2">
            <input className="w-full border rounded px-2 py-1 text-sm" placeholder="Nom du modèle" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
            <select className="w-full border rounded px-2 py-1 text-sm" value={templateEntity} onChange={(e) => setTemplateEntity(e.target.value as typeof templateEntity)}>
              <option value="sales">Ventes</option>
              <option value="purchases">Achats</option>
              <option value="expenses">Dépenses</option>
              <option value="stock">Stock</option>
            </select>
            <select className="w-full border rounded px-2 py-1 text-sm col-span-2" value={templatePlatform} onChange={(e) => setTemplatePlatform(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Plateforme non précisée</option>
              {marketplaces.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <textarea className="w-full border rounded px-2 py-1 col-span-2 font-mono text-xs min-h-28" value={templateJson} onChange={(e) => setTemplateJson(e.target.value)} />
            <button className="btn-primary text-sm col-span-2" onClick={createTemplate}>Créer le modèle</button>
          </div>
          <div className="card overflow-auto max-h-48 mt-2">
            <table className="w-full text-xs">
              <thead><tr><th className="text-left p-2">Nom</th><th className="text-left p-2">Type</th><th className="p-2"></th></tr></thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className="border-t border-slate-700/20">
                    <td className="p-2 font-medium">{t.name}</td>
                    <td className="p-2">{t.entity_type}</td>
                    <td className="p-2 text-right"><button className="text-xs text-red-400 hover:underline" onClick={async () => { await api.csvTemplates.delete(t.id); load(); }}>Supprimer</button></td>
                  </tr>
                ))}
                {templates.length === 0 && <tr><td className="p-4 text-center text-slate-400" colSpan={3}>Aucun modèle CSV.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function inferProviderFromPath(p: string): 'google_drive' | 'onedrive' | 'dropbox' | 'icloud' | 'other' {
  const lower = p.toLowerCase();
  if (lower.includes('google') || lower.includes('my drive') || lower.includes('mon drive')) return 'google_drive';
  if (lower.includes('onedrive')) return 'onedrive';
  if (lower.includes('dropbox')) return 'dropbox';
  if (lower.includes('icloud')) return 'icloud';
  return 'other';
}

function CfeSection() {
  const [list, setList] = useState<Awaited<ReturnType<typeof api.cfe.list>>>([]);
  const [year, setYear] = useState(new Date().getUTCFullYear());
  const [amount, setAmount] = useState('');
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10));
  const [exonerated, setExonerated] = useState(false);
  const [notes, setNotes] = useState('');

  const load = () => api.cfe.list().then(setList);
  useEffect(() => { load(); }, []);

  const onSave = async () => {
    await api.cfe.upsert({
      year,
      amount_paid: amount ? Number(amount.replace(',', '.')) : undefined,
      paid_date: exonerated ? undefined : paidDate,
      exonerated,
      notes: notes || undefined
    });
    setAmount(''); setNotes(''); setExonerated(false);
    load();
  };

  const onDel = async (id: number) => {
    if (!confirm('Supprimer cette ligne CFE ?')) return;
    await api.cfe.delete(id);
    load();
  };

  return (
    <section className="card p-4">
      <h2 className="text-lg font-semibold mb-3">CFE (Cotisation Foncière des Entreprises)</h2>
      <p className="text-sm text-slate-600 mb-3">
        Suivi annuel des paiements CFE (échéance 15 décembre). Les nouveaux micro-entrepreneurs sont
        souvent exonérés la 1ère année.
      </p>

      <div className="grid grid-cols-5 gap-2 mb-3">
        <input type="number" className="border rounded px-2 py-1 text-sm" value={year} onChange={(e) => setYear(Number(e.target.value))} />
        <input type="text" className="border rounded px-2 py-1 text-sm" placeholder="Montant payé €" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={exonerated} />
        <input type="date" className="border rounded px-2 py-1 text-sm" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} disabled={exonerated} />
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={exonerated} onChange={(e) => setExonerated(e.target.checked)} />
          Exonéré
        </label>
        <button className="btn-primary text-sm" onClick={onSave}>Enregistrer</button>
      </div>
      <input type="text" className="w-full border rounded px-2 py-1 text-sm mb-3" placeholder="Notes (optionnel)" value={notes} onChange={(e) => setNotes(e.target.value)} />

      <div className="card overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100"><tr>
            <th className="px-2 py-1 text-left">Année</th>
            <th className="px-2 py-1 text-right">Montant</th>
            <th className="px-2 py-1 text-left">Date paiement</th>
            <th className="px-2 py-1 text-left">Statut</th>
            <th className="px-2 py-1 text-left">Notes</th>
            <th className="px-2 py-1"></th>
          </tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="px-2 py-1 font-semibold">{c.year}</td>
                <td className="px-2 py-1 text-right">{c.amount_paid ? `${c.amount_paid.toFixed(2)} €` : '—'}</td>
                <td className="px-2 py-1">{c.paid_date ? c.paid_date.slice(8, 10) + '/' + c.paid_date.slice(5, 7) + '/' + c.paid_date.slice(0, 4) : '—'}</td>
                <td className="px-2 py-1">
                  {c.exonerated ? <span className="pill bg-emerald-100 text-emerald-700">Exonéré</span>
                   : c.amount_paid ? <span className="pill bg-sky-100 text-sky-700">Payé</span>
                   : <span className="pill bg-amber-100 text-amber-800">À payer</span>}
                </td>
                <td className="px-2 py-1 text-xs text-slate-600">{c.notes}</td>
                <td className="px-2 py-1 text-right">
                  <button className="text-xs text-red-700 hover:underline" onClick={() => onDel(c.id)}>Supprimer</button>
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-400">Aucun paiement CFE enregistré.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ExportJsonSection() {
  const [busy, setBusy] = useState(false);
  const onExport = async () => {
    setBusy(true);
    try {
      const r = await api.maint.exportJson();
      if (!r.canceled) notify(`Export réussi. ${r.rowCount} ligne(s) exportée(s) → ${r.path}`);
    } finally { setBusy(false); }
  };
  const onRotate = async () => {
    if (!confirm('Nettoyer les entrées d\'audit de plus de 12 mois ? Les sauvegardes ne sont pas affectées.')) return;
    const r = await api.maint.rotateAudit();
    notify(`${r.deleted} entrée(s) supprimées de l'audit log.`);
  };
  return (
    <section className="card p-4">
      <h2 className="text-lg font-semibold mb-3">Export & nettoyage</h2>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-sm font-medium mb-1">Export complet en JSON</div>
          <p className="text-xs text-slate-500 mb-2">Toutes vos données dans un seul fichier JSON lisible. Utile pour portabilité ou archivage humain.</p>
          <button className="btn-secondary text-sm" onClick={onExport} disabled={busy}>{busy ? 'Export…' : '📥 Exporter en JSON'}</button>
        </div>
        <div>
          <div className="text-sm font-medium mb-1">Nettoyage audit log</div>
          <p className="text-xs text-slate-500 mb-2">Supprime les entrées d'historique de plus de 12 mois. Réduit la taille de la base.</p>
          <button className="btn-secondary text-sm" onClick={onRotate}>🧹 Nettoyer maintenant</button>
        </div>
      </div>
    </section>
  );
}

function RevendoMobileSection() {
  const [busy, setBusy] = useState(false);
  const [askPwd, setAskPwd] = useState<null | { kind: 'snapshot' | 'import'; filePath?: string }>(null);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.mobile.previewActions>> | null>(null);
  const [imports, setImports] = useState<Awaited<ReturnType<typeof api.mobile.listActionImports>>>([]);

  useEffect(() => { api.mobile.listActionImports().then(setImports).catch(() => {}); }, []);

  const refreshImports = () => api.mobile.listActionImports().then(setImports).catch(() => {});

  const exportSnapshot = async (encrypted: boolean, password?: string) => {
    setBusy(true);
    try {
      const r = await api.mobile.exportJsonSnapshot({ anonymized: true, encrypted, password });
      notify(
        `Snapshot mobile JSON ${encrypted ? 'chiffré' : 'anonymisé'} créé :\n${r.path}\n\n${bytes(r.size)} · schema ${r.schemaVersion}`,
        'success'
      );
      setAskPwd(null);
    } catch (err) {
      notify(`Échec de l'export JSON : ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const pickAndPreview = async () => {
    try {
      const picked = await api.mobile.pickActionsFile();
      if (picked.canceled || !picked.filePath) return;
      try {
        const r = await api.mobile.previewActions({ filePath: picked.filePath });
        setPreview({ ...r, _filePath: picked.filePath } as never);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('chiffré') || message.includes('mot de passe')) {
          setAskPwd({ kind: 'import', filePath: picked.filePath });
        } else {
          notify(`Aperçu impossible : ${message}`, 'error');
        }
      }
    } catch (err) {
      notify(`Sélection du fichier impossible : ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const previewWithPassword = async (password: string) => {
    if (askPwd?.kind !== 'import' || !askPwd.filePath) return;
    setBusy(true);
    try {
      const r = await api.mobile.previewActions({ filePath: askPwd.filePath, password });
      setPreview({ ...r, _filePath: askPwd.filePath, _password: password } as never);
      setAskPwd(null);
    } catch (err) {
      notify(`Aperçu impossible : ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const applyAll = async () => {
    if (!preview) return;
    const previewWithCtx = preview as unknown as { _filePath?: string; _password?: string };
    const filePath = previewWithCtx._filePath;
    if (!filePath) {
      notify('Chemin de fichier introuvable. Re-sélectionnez le fichier.', 'error');
      return;
    }
    if (preview.invalidCount > 0) {
      const ok = window.confirm(
        `${preview.invalidCount} action(s) invalide(s) seront rejetée(s). Continuer avec les ${preview.validCount} valides ?`
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      const r = await api.mobile.applyActions({ filePath, password: previewWithCtx._password });
      notify(`${r.applied} action(s) appliquée(s), ${r.rejected} rejetée(s).`, r.rejected === 0 ? 'success' : 'warning');
      setPreview(null);
      refreshImports();
    } catch (err) {
      notify(`Application impossible : ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-4">
      <h2 className="text-lg font-semibold mb-2">📱 Revendo Mobile</h2>
      <p className="text-sm text-slate-500 mb-3">
        Générez un snapshot JSON pour la PWA mobile (lecture seule, anonymisé par défaut), puis importez
        les actions créées hors ligne sur le téléphone (dépenses, mouvements de stock, notes…).
        La synchronisation automatique n’est pas encore activée. Utilisez les snapshots et imports manuels.
      </p>
      <div className="flex gap-2 flex-wrap">
        <button className="btn-primary text-sm" disabled={busy} onClick={() => exportSnapshot(false)}>
          Générer snapshot mobile JSON anonymisé
        </button>
        <button className="btn-secondary text-sm" disabled={busy} onClick={() => setAskPwd({ kind: 'snapshot' })}>
          Générer snapshot mobile chiffré
        </button>
        <button className="btn-secondary text-sm" disabled={busy} onClick={pickAndPreview}>
          Importer actions mobile (aperçu)
        </button>
        <button className="btn-secondary text-sm" onClick={() => api.security.openSnapshots()}>
          Ouvrir le dossier des snapshots
        </button>
      </div>

      {preview && (
        <div className="mt-4 border border-slate-300 rounded p-3">
          <div className="flex justify-between items-start mb-2">
            <div>
              <div className="text-sm font-semibold">Aperçu des actions mobile</div>
              <div className="text-xs text-slate-500">
                Schéma {preview.schemaVersion} · {preview.total} action(s) · {preview.validCount} valide(s) · {preview.invalidCount} invalide(s)
                {preview.alreadyImported && <> · <span className="text-amber-600">déjà importé</span></>}
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary text-xs" onClick={() => setPreview(null)}>Fermer</button>
              <button
                className="btn-primary text-xs"
                disabled={busy || preview.validCount === 0 || preview.alreadyImported}
                onClick={applyAll}
              >
                Appliquer {preview.validCount} action(s)
              </button>
            </div>
          </div>
          <ul className="text-xs space-y-1 max-h-80 overflow-y-auto">
            {preview.items.map((it) => (
              <li key={it.id} className={`p-2 rounded ${it.valid ? 'bg-green-50' : 'bg-red-50'}`}>
                <div className="font-medium">{it.summary}</div>
                <div className="text-slate-500">type: {it.type} · id: {it.id}</div>
                {it.warnings.length > 0 && <div className="text-amber-700">⚠️ {it.warnings.join(' · ')}</div>}
                {it.errors.length > 0 && <div className="text-red-700">❌ {it.errors.join(' · ')}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {imports.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-semibold text-slate-600 mb-1">Imports récents</div>
          <ul className="text-xs space-y-1">
            {imports.slice(0, 8).map((imp) => (
              <li key={imp.id} className="flex justify-between border-b border-slate-100 py-1">
                <span>{imp.file_name} <span className="text-slate-400">· {imp.imported_at}</span></span>
                <span>{imp.applied}/{imp.total} appliquées{imp.rejected > 0 && <span className="text-red-600"> · {imp.rejected} rejetées</span>}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {askPwd?.kind === 'snapshot' && (
        <PassphraseDialog
          title="Snapshot mobile JSON chiffré"
          description={'Choisissez un mot de passe fort.\nIl sera nécessaire pour ouvrir le snapshot sur le téléphone.'}
          requireConfirm={true}
          busy={busy}
          onCancel={() => { if (!busy) setAskPwd(null); }}
          onSubmit={(pwd) => exportSnapshot(true, pwd)}
        />
      )}
      {askPwd?.kind === 'import' && (
        <PassphraseDialog
          title="Fichier d'actions chiffré"
          description={'Saisissez le mot de passe utilisé pour chiffrer ce fichier.'}
          requireConfirm={false}
          busy={busy}
          onCancel={() => { if (!busy) setAskPwd(null); }}
          onSubmit={previewWithPassword}
        />
      )}
    </section>
  );
}
