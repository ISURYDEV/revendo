import { useEffect, useRef, useState } from 'react';
import { useSnapshot } from '../components/SnapshotContext';
import { readSnapshotFile } from '../services/snapshotReader';
import { saveSnapshot } from '../storage/snapshot';
import { buildBundle, clearActions, listActions, listPending, markActionsExported } from '../storage/actions';
import { dbWipeAll } from '../storage/db';
import { notify } from '../components/Toast';
import { shortDate } from '../services/formatter';
import type { MobileAction } from '@shared/mobile';
import { COMPATIBLE_SNAPSHOT_VERSIONS, MOBILE_ACTIONS_SCHEMA_VERSION, MOBILE_SNAPSHOT_SCHEMA_VERSION } from '@shared/mobile';

export default function SettingsScreen() {
  const { snapshot, importedAt, reload } = useSnapshot();
  const [actions, setActions] = useState<MobileAction[]>([]);
  const [pendingPwd, setPendingPwd] = useState<{ file: File } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => listActions().then(setActions);
  useEffect(() => { refresh(); }, [importedAt]);

  const handlePickFile = () => fileRef.current?.click();

  const handleFile = async (file: File, password?: string) => {
    setBusy(true);
    try {
      const snap = await readSnapshotFile(file, password);
      await saveSnapshot(snap);
      await reload();
      notify(`Snapshot importé (${snap.schema_version}).`, 'success');
      setPendingPwd(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('chiffré') || msg.includes('mot de passe')) {
        setPendingPwd({ file });
      } else {
        notify(`Import impossible : ${msg}`, 'error');
      }
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onPickChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    await handleFile(f);
  };

  const exportActions = async () => {
    const pending = await listPending();
    if (pending.length === 0) {
      notify('Aucune action en attente.', 'info');
      return;
    }
    const bundle = buildBundle(pending);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `revendo_mobile_actions_${ts}.json`;
    // Prefer Web Share API if available
    const file = new File([blob], filename, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Actions Revendo Mobile' });
        await markActionsExported();
        refresh();
        notify(`${pending.length} action(s) partagée(s).`, 'success');
        return;
      } catch {
        // user canceled or share failed — fall through to download
      }
    }
    // Fallback: download link
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    await markActionsExported();
    refresh();
    notify(`${pending.length} action(s) exportée(s).`, 'success');
  };

  const wipeAll = async () => {
    if (!window.confirm('Effacer toutes les données locales (snapshot + actions) ? Action irréversible.')) return;
    await dbWipeAll();
    await reload();
    refresh();
    notify('Données locales effacées.', 'success');
  };

  const clearActionsOnly = async () => {
    if (!window.confirm('Effacer toutes les actions locales ? Les actions non exportées seront perdues.')) return;
    await clearActions();
    refresh();
    notify('Actions effacées.', 'success');
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Réglages</h1>

      <section className="card space-y-2">
        <div className="font-semibold">📥 Snapshot</div>
        <div className="text-xs text-slate-500">
          {snapshot
            ? `Importé le ${shortDate(importedAt ?? '')} · schéma ${snapshot.schema_version} · ${snapshot.redaction_mode}`
            : 'Aucun snapshot importé.'}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.enc,.html"
          className="hidden"
          onChange={onPickChange}
        />
        <button className="btn-primary w-full" disabled={busy} onClick={handlePickFile}>
          {busy ? 'Lecture…' : 'Importer un snapshot (JSON ou chiffré)'}
        </button>
        <div className="text-[10px] text-slate-500">
          Compatible : {COMPATIBLE_SNAPSHOT_VERSIONS.join(', ')}. Snapshots cifrés `.revendo.enc` supportés.
        </div>
      </section>

      <section className="card space-y-2">
        <div className="font-semibold">📤 Actions hors ligne</div>
        <div className="text-xs text-slate-500">
          {actions.length} action(s) au total · {actions.filter((a) => a.status === 'pending').length} en attente d'export.
        </div>
        <button className="btn-primary w-full" onClick={exportActions} disabled={busy}>
          Exporter les actions vers le PC
        </button>
        <button className="btn-secondary w-full" onClick={clearActionsOnly}>
          Effacer toutes les actions
        </button>
        <div className="text-[10px] text-slate-500">
          Schéma d'actions : {MOBILE_ACTIONS_SCHEMA_VERSION}. Le PC validera chaque action (stock négatif refusé).
        </div>
      </section>

      <section className="card space-y-2">
        <div className="font-semibold">🛡️ Sécurité & confidentialité</div>
        <div className="text-xs text-slate-500 leading-relaxed">
          Revendo Mobile fonctionne hors ligne. Les données restent sur cet appareil sauf export manuel.
          Aucun envoi à un serveur, aucun tracking, aucun analytics externe.
        </div>
        <div className="text-[10px] text-slate-500 space-y-0.5">
          <div>Snapshot par défaut : anonymisé (emails/adresses masqués).</div>
          <div>Stockage : IndexedDB local du navigateur.</div>
          <div>Photos : pas synchronisées — conservées dans la galerie du téléphone.</div>
        </div>
        <button className="btn-danger w-full" onClick={wipeAll}>
          🗑️ Effacer toutes les données locales
        </button>
      </section>

      <section className="card space-y-1 text-xs text-slate-500">
        <div className="font-semibold text-slate-700">À propos</div>
        <div>Revendo Mobile · companion PWA</div>
        <div>Schema snapshot cible : {MOBILE_SNAPSHOT_SCHEMA_VERSION}</div>
        <div>App : v0.1.0</div>
      </section>

      {pendingPwd && (
        <PasswordSheet
          onCancel={() => setPendingPwd(null)}
          onSubmit={(pwd) => handleFile(pendingPwd.file, pwd)}
        />
      )}
    </div>
  );
}

function PasswordSheet({ onCancel, onSubmit }: { onCancel: () => void; onSubmit: (pwd: string) => void }) {
  const [pwd, setPwd] = useState('');
  return (
    <div className="fixed inset-0 bg-black/40 flex items-end z-40" onClick={onCancel}>
      <div className="bg-white dark:bg-slate-900 w-full rounded-t-2xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="font-bold">Snapshot chiffré</div>
        <div className="text-xs text-slate-500">
          Saisissez le mot de passe utilisé sur le PC. Le déchiffrement est local — rien n'est envoyé.
        </div>
        <input
          className="input"
          type="password"
          autoFocus
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          placeholder="Mot de passe (12+ caractères)"
        />
        <div className="flex gap-2">
          <button className="btn-secondary flex-1" onClick={onCancel}>Annuler</button>
          <button className="btn-primary flex-1" disabled={pwd.length < 8} onClick={() => onSubmit(pwd)}>
            Déchiffrer
          </button>
        </div>
      </div>
    </div>
  );
}
