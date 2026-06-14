import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

/**
 * Compact cloud sync status badge for the dashboard.
 * Shows nothing if disabled. Shows warning if folder missing or last sync was an error.
 */
export default function CloudSyncBadge() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.cloud.status>> | null>(null);
  const nav = useNavigate();

  useEffect(() => { api.cloud.status().then(setStatus); }, []);
  if (!status) return null;

  // Not configured — gentle nudge
  if (!status.folder) {
    return (
      <div className="alert-info text-xs flex items-center justify-between">
        <span>☁️ Aucune sauvegarde cloud configurée. Vos backups vivent uniquement sur ce PC.</span>
        <button className="text-brand-600 hover:underline" onClick={() => nav('/settings')}>Configurer →</button>
      </div>
    );
  }

  if (!status.enabled) {
    return (
      <div className="text-xs text-slate-500 flex items-center justify-between">
        <span>☁️ Cloud sync configuré mais désactivé.</span>
        <button className="text-brand-600 hover:underline" onClick={() => nav('/settings')}>Activer →</button>
      </div>
    );
  }

  // Enabled but folder vanished
  if (!status.folderExists) {
    return (
      <div className="alert-warn text-xs flex items-center justify-between">
        <span>⚠️ Dossier cloud introuvable. Google Drive est-il lancé ?</span>
        <button className="text-brand-600 hover:underline" onClick={() => nav('/settings')}>Vérifier →</button>
      </div>
    );
  }

  if (status.lastStatus === 'error') {
    return (
      <div className="alert-warn text-xs flex items-center justify-between">
        <span>⚠️ Dernière sync cloud en erreur : {status.lastError}</span>
        <button className="text-brand-600 hover:underline" onClick={() => nav('/settings')}>Voir →</button>
      </div>
    );
  }

  // OK state
  if (status.lastRun) {
    const days = Math.floor((Date.now() - new Date(status.lastRun).getTime()) / (24 * 60 * 60 * 1000));
    return (
      <div className="text-xs text-emerald-700 flex items-center gap-2">
        <span>☁️ Cloud sync actif — dernière sauvegarde {days === 0 ? 'aujourd\'hui' : `il y a ${days} jour(s)`}</span>
      </div>
    );
  }

  return (
    <div className="text-xs text-slate-500">☁️ Cloud sync actif — pas encore de backup</div>
  );
}
