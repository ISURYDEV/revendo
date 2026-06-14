/**
 * Sales classification engine.
 *
 * Rule order:
 *  1. Encashment date < activity_start_date → pre_activity (NOT declarable).
 *  2. Status non encaissé → excluded.
 *  3. Manual override → use forced classification.
 *  4. Status encaissé (completed / colis_perdu indemnisé) AND (SKU OR linked_*) → professional_resale, declarable.
 *  5. Status encaissé AND no SKU + no link → personal_item, not declarable.
 *
 * PURE function — no DB access.
 */

export type Classification =
  | 'professional_resale'
  | 'personal_item'
  | 'uncertain_to_review'
  | 'excluded'
  | 'pre_activity';

export interface ClassificationInput {
  status: string;
  sku?: string | null;
  linkedPurchaseId?: number | null;
  linkedStockItemId?: number | null;
  manualOverride?: boolean;
  forcedClassification?: Classification;
  overrideNote?: string;
  /** ISO date (YYYY-MM-DD or full ISO). When present, encashments before it are pre_activity. */
  activityStartDate?: string | null;
  /** ISO date (YYYY-MM-DD or full ISO) — the encashment date of this sale, used vs activityStartDate. */
  encashmentDate?: string | null;
}

export interface ClassificationResult {
  classification: Classification;
  urssaf_declarable: 0 | 1;
  classification_reason: string;
}

function ymd(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return iso.slice(0, 10);
}

export function classifySale(input: ClassificationInput): ClassificationResult {
  // PRIORITY: pre_activity always wins — independent of manual override.
  const start = ymd(input.activityStartDate);
  const enc = ymd(input.encashmentDate);
  if (start && enc && enc < start) {
    return {
      classification: 'pre_activity',
      urssaf_declarable: 0,
      classification_reason: `Encaissement (${enc}) antérieur au début d'activité officiel (${start}) — hors période URSSAF`
    };
  }

  const status = (input.status ?? '').toLowerCase().trim();
  const isRevenueStatus = status === 'completed' || status === 'colis_perdu';
  if (!isRevenueStatus) {
    return {
      classification: 'excluded',
      urssaf_declarable: 0,
      classification_reason: `Vente non finalisée / annulée / remboursée (statut : ${status || 'inconnu'}) — exclue du CA URSSAF`
    };
  }

  if (input.manualOverride && input.forcedClassification) {
    return {
      classification: input.forcedClassification,
      urssaf_declarable: input.forcedClassification === 'professional_resale' ? 1 : 0,
      classification_reason:
        `Correction manuelle : ${input.forcedClassification}` +
        (input.overrideNote ? ` — ${input.overrideNote}` : '')
    };
  }

  const hasSku = !!(input.sku && input.sku.trim() !== '');
  const hasLink = !!(input.linkedPurchaseId || input.linkedStockItemId);

  // Une vente avec achat/stock associé est une revente professionnelle confirmée.
  if (hasLink) {
    return {
      classification: 'professional_resale',
      urssaf_declarable: 1,
      classification_reason: 'Avec achat/stock associé : revente professionnelle'
    };
  }

  // Une vente avec SKU mais SANS stock/achat associé NE devient PAS automatiquement
  // professionnelle : on l'envoie au Centre de révision pour confirmation explicite.
  // Tant que l'utilisateur ne confirme pas (créer un stock ou marquer hors activité),
  // elle n'est pas déclarable au CA URSSAF — évite d'inclure une vente personnelle
  // simplement parce qu'un SKU a été saisi par erreur.
  if (hasSku) {
    return {
      classification: 'uncertain_to_review',
      urssaf_declarable: 0,
      classification_reason:
        "SKU détecté sans stock associé : vérification requise (non déclarable par défaut)"
    };
  }

  return {
    classification: 'personal_item',
    urssaf_declarable: 0,
    classification_reason: 'Sans SKU ni achat associé : traité comme bien personnel hors activité'
  };
}

/** Compute declared_period (YYYY-QN) from an ISO date. */
export function declaredPeriod(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const y = iso.slice(0, 4);
  const m = Number(iso.slice(5, 7));
  const q = m <= 3 ? 1 : m <= 6 ? 2 : m <= 9 ? 3 : 4;
  return `${y}-Q${q}`;
}
