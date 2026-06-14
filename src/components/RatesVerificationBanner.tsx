import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { notify } from '../lib/notify';
import type { RatesVerificationStatus } from '../../shared/types';

/**
 * P0.3 — Bandeau orange invitant l'utilisateur à vérifier manuellement les taux
 * URSSAF/ACRE pour l'année en cours avant toute déclaration.
 *
 * Aucun taux n'est modifié automatiquement, aucun appel réseau n'est effectué.
 */
export default function RatesVerificationBanner() {
  const [status, setStatus] = useState<RatesVerificationStatus | null>(null);

  const load = () => api.rates.verificationStatus().then(setStatus).catch(() => undefined);
  useEffect(() => { load(); }, []);

  if (!status || !status.needsVerification) return null;

  const reasonText =
    status.reason === 'rates_missing'
      ? `Aucun taux URSSAF/ACRE n'est défini pour ${status.currentYear}.`
      : status.reason === 'never_verified'
      ? "Vous n'avez jamais confirmé avoir vérifié les taux."
      : status.reason === 'year_changed'
      ? `Dernière vérification en ${status.lastVerifiedYear}. Pensez à les revoir pour ${status.currentYear}.`
      : '';

  const onMarkVerified = async () => {
    await api.rates.markVerified();
    notify('Taux URSSAF/ACRE marqués comme vérifiés pour cette année.');
    load();
  };

  return (
    <div className="card p-3 bg-orange-50 border-orange-200" data-testid="rates-verification-banner">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[260px]">
          <div className="font-semibold text-orange-900">
            Vérifiez vos taux URSSAF/ACRE pour l'année en cours avant de déclarer.
          </div>
          <div className="text-xs text-orange-800 mt-1">
            {reasonText} Consultez{' '}
            <a className="underline" href="https://www.autoentrepreneur.urssaf.fr/" target="_blank" rel="noreferrer">
              autoentrepreneur.urssaf.fr
            </a>{' '}
            puis confirmez ici. Les taux ne sont jamais modifiés automatiquement.
          </div>
        </div>
        <button className="btn-primary text-xs whitespace-nowrap" onClick={onMarkVerified}>
          Marquer les taux comme vérifiés
        </button>
      </div>
    </div>
  );
}
