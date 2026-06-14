import type Database from 'better-sqlite3';
import { buildQuarterlySummary } from '../declarations/summary';
import { nextDueDate } from '../declarations/quarters';
import type { QuarterCode, ReviewCenterResult, ReviewItem, ReviewModule, ReviewSeverity } from '../../../shared/types';

type RawIssue = Omit<ReviewItem, 'key'> & { issue: string };

const MODULE_LABEL: Record<ReviewModule, string> = {
  sales: 'Ventes',
  stock: 'Stock',
  purchases: 'Achats',
  expenses: 'Dépenses',
  documents: 'Documents',
  urssaf: 'URSSAF'
};

const emptyCount = <T extends string>(keys: T[]): Record<T, number> =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<T, number>;

function reviewKey(i: RawIssue): string {
  return [
    i.module,
    i.issue,
    i.entity_type ?? 'none',
    i.entity_id ?? 'none'
  ].join(':');
}

function mapRows<T extends Record<string, unknown>>(
  rows: T[],
  mapper: (r: T) => RawIssue
): RawIssue[] {
  return rows.map(mapper);
}

export function buildReviewCenter(
  db: Database.Database,
  filters: { severity?: ReviewSeverity | 'all'; module?: ReviewModule | 'all'; includeIgnored?: boolean } = {}
): ReviewCenterResult {
  const issues: RawIssue[] = [];
  const now = new Date().toISOString();

  // A. Ventes à vérifier
  issues.push(...mapRows(
    db.prepare(
      `SELECT id, article_name, classification, status, amount_received, declarable_amount, buyer_username, updated_at
       FROM sales
       WHERE deleted_at IS NULL
         AND (classification IS NULL OR classification='uncertain_to_review')`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: 'sale_classification_review',
      module: 'sales',
      severity: 'important',
      title: 'Vente à classifier',
      description: `${String(r.article_name ?? 'Vente #' + r.id)} — classification manquante ou à vérifier.`,
      entity_type: 'sale',
      entity_id: Number(r.id),
      route: `/sales?open=${r.id}`,
      action: 'correct',
      created_at: String(r.updated_at ?? now)
    })
  ));

  issues.push(...mapRows(
    db.prepare(
      `SELECT id, article_name, updated_at FROM sales
       WHERE deleted_at IS NULL
         AND status IN ('completed','colis_perdu')
         AND (declared_encashment_date IS NULL OR declared_encashment_date='')`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: 'sale_missing_encashment',
      module: 'sales',
      severity: 'critical',
      title: "Date d'encaissement manquante",
      description: `${String(r.article_name ?? 'Vente #' + r.id)} — nécessaire pour le trimestre URSSAF.`,
      entity_type: 'sale',
      entity_id: Number(r.id),
      route: `/sales?open=${r.id}`,
      action: 'correct',
      created_at: String(r.updated_at ?? now)
    })
  ));

  issues.push(...mapRows(
    db.prepare(
      `SELECT id, article_name, updated_at FROM sales
       WHERE deleted_at IS NULL
         AND status IN ('completed','colis_perdu')
         AND (COALESCE(amount_received, 0) <= 0 OR (urssaf_declarable=1 AND COALESCE(declarable_amount, 0) <= 0))`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: 'sale_missing_amount',
      module: 'sales',
      severity: 'critical',
      title: 'Montant de vente à vérifier',
      description: `${String(r.article_name ?? 'Vente #' + r.id)} — montant encaissé ou déclarable vide/zéro.`,
      entity_type: 'sale',
      entity_id: Number(r.id),
      route: `/sales?open=${r.id}`,
      action: 'correct',
      created_at: String(r.updated_at ?? now)
    })
  ));

  issues.push(...mapRows(
    db.prepare(
      `SELECT id, article_name, sku, updated_at FROM sales
       WHERE deleted_at IS NULL
         AND status IN ('completed','colis_perdu')
         AND classification='professional_resale'
         AND linked_stock_item_id IS NULL`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: 'sale_professional_without_stock',
      module: 'sales',
      severity: r.sku ? 'important' : 'review',
      title: r.sku ? 'Vente avec SKU sans stock associé' : 'Vente professionnelle sans stock associé',
      description: `${String(r.article_name ?? 'Vente #' + r.id)}${r.sku ? ` — SKU ${r.sku}` : ''}.`,
      entity_type: 'sale',
      entity_id: Number(r.id),
      route: `/sales?open=${r.id}`,
      action: 'associate',
      created_at: String(r.updated_at ?? now)
    })
  ));

  issues.push(...mapRows(
    db.prepare(
      `SELECT id, article_name, sku, updated_at FROM sales
       WHERE deleted_at IS NULL
         AND stock_association_status='ambiguous'`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: 'sale_sku_multiple_stock_matches',
      module: 'sales',
      severity: 'important',
      title: 'Plusieurs stocks possibles pour ce SKU',
      description: `${String(r.article_name ?? 'Vente #' + r.id)} — SKU ${String(r.sku ?? '')}. Choisissez le bon stock.`,
      entity_type: 'sale',
      entity_id: Number(r.id),
      route: `/sales?open=${r.id}`,
      action: 'associate',
      created_at: String(r.updated_at ?? now)
    })
  ));

  // P0.2 : ventes avec SKU mais sans stock associé — l'utilisateur doit
  // explicitement décider (créer un stock, associer un stock existant,
  // ou marquer comme bien personnel hors activité).
  issues.push(...mapRows(
    db.prepare(
      `SELECT id, article_name, sku, amount_received, updated_at FROM sales
       WHERE deleted_at IS NULL
         AND stock_association_status='needs_review_no_stock'
         AND linked_stock_item_id IS NULL
         AND classification='uncertain_to_review'`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: 'sale_sku_no_stock_needs_decision',
      module: 'sales',
      severity: 'important',
      title: 'SKU détecté sans stock associé',
      description:
        `${String(r.article_name ?? 'Vente #' + r.id)} — SKU ${String(r.sku ?? '')}. ` +
        `Créez un stock, associez un stock existant, ou marquez comme bien personnel hors activité.`,
      entity_type: 'sale',
      entity_id: Number(r.id),
      route: `/sales?open=${r.id}`,
      action: 'review',
      created_at: String(r.updated_at ?? now)
    })
  ));

  issues.push(...mapRows(
    db.prepare(
      `SELECT s.id, s.article_name, s.sku, s.updated_at
       FROM sales s
       WHERE s.deleted_at IS NULL
         AND s.status IN ('completed','colis_perdu')
         AND s.sku IS NOT NULL AND trim(s.sku) != ''
         AND s.linked_stock_item_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM stock_movements m
           WHERE m.linked_sale_id=s.id AND m.movement_type='OUT_SOLD' AND m.deleted_at IS NULL
         )`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: 'sale_completed_sku_missing_out_sold',
      module: 'sales',
      severity: 'critical',
      title: 'Vente completed avec SKU sans mouvement OUT_SOLD',
      description: `${String(r.article_name ?? 'Vente #' + r.id)} — le stock associé n'a pas été sorti.`,
      entity_type: 'sale',
      entity_id: Number(r.id),
      route: `/sales?open=${r.id}`,
      action: 'correct',
      created_at: String(r.updated_at ?? now)
    })
  ));

  issues.push(...mapRows(
    db.prepare(
      `SELECT id, article_name, classification, override_note, updated_at FROM sales WHERE deleted_at IS NULL AND manual_override=1`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: 'sale_manual_override',
      module: 'sales',
      severity: 'info',
      title: 'Vente avec correction manuelle',
      description: `${String(r.article_name ?? 'Vente #' + r.id)} — ${String(r.override_note ?? 'à relire')}.`,
      entity_type: 'sale',
      entity_id: Number(r.id),
      route: `/sales?open=${r.id}`,
      action: 'open',
      created_at: String(r.updated_at ?? now)
    })
  ));

  issues.push(...mapRows(
    db.prepare(
      `SELECT id, article_name, amount_received, updated_at FROM sales
       WHERE deleted_at IS NULL
         AND status IN ('completed','colis_perdu')
         AND classification='personal_item'
         AND COALESCE(amount_received, 0) >= 200`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: 'sale_personal_high_amount',
      module: 'sales',
      severity: 'review',
      title: 'Vente personnelle au montant élevé',
      description: `${String(r.article_name ?? 'Vente #' + r.id)} — ${Number(r.amount_received ?? 0).toFixed(2)} €.`,
      entity_type: 'sale',
      entity_id: Number(r.id),
      route: `/sales?open=${r.id}`,
      action: 'review',
      created_at: String(r.updated_at ?? now)
    })
  ));

  issues.push(...mapRows(
    db.prepare(
      `SELECT id, article_name, amount_received, declarable_amount, updated_at FROM sales
       WHERE deleted_at IS NULL
         AND status IN ('canceled','refunded')
         AND (
           COALESCE(urssaf_declarable,0)=1
           OR COALESCE(is_declarable,0)=1
           OR COALESCE(declarable_amount,0) > 0
         )`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: 'sale_canceled_still_declarable',
      module: 'sales',
      severity: 'important',
      title: 'Vente annulée/remboursée encore déclarable',
      description: `${String(r.article_name ?? 'Vente #' + r.id)} — elle ne doit générer ni CA URSSAF ni bénéfice.`,
      entity_type: 'sale',
      entity_id: Number(r.id),
      route: `/sales?open=${r.id}`,
      action: 'review',
      created_at: String(r.updated_at ?? now)
    })
  ));

  // B. Stock à vérifier
  issues.push(...mapRows(
    db.prepare(
      `SELECT id, internal_code, name, quantity, status, updated_at FROM stock_items
       WHERE deleted_at IS NULL
         AND (quantity < 0 OR (quantity=0 AND status IN ('in_stock','listed','reserved','received')))`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: Number(r.quantity) < 0 ? 'stock_negative' : 'stock_active_zero',
      module: 'stock',
      severity: Number(r.quantity) < 0 ? 'critical' : 'important',
      title: Number(r.quantity) < 0 ? 'Stock négatif' : 'Stock actif avec quantité zéro',
      description: `${String(r.name ?? r.internal_code)} — quantité ${r.quantity}, statut ${r.status}.`,
      entity_type: 'stock_item',
      entity_id: Number(r.id),
      route: `/stock?open=${r.id}`,
      action: 'correct',
      created_at: String(r.updated_at ?? now)
    })
  ));

  issues.push(...mapRows(
    db.prepare(
      `SELECT id, internal_code, name, updated_at FROM stock_items
       WHERE deleted_at IS NULL
         AND quantity > 0
         AND status IN ('in_stock','listed','reserved','received')
         AND (unit_cost_ttc IS NULL OR unit_cost_ttc <= 0)`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: 'stock_missing_cost',
      module: 'stock',
      severity: 'important',
      title: 'Stock sans coût',
      description: `${String(r.name ?? r.internal_code)} — le calcul de marge sera imprécis.`,
      entity_type: 'stock_item',
      entity_id: Number(r.id),
      route: `/stock?open=${r.id}`,
      action: 'correct',
      created_at: String(r.updated_at ?? now)
    })
  ));

  issues.push(...mapRows(
    db.prepare(
      `SELECT id, internal_code, name, updated_at FROM stock_items
       WHERE deleted_at IS NULL
         AND auto_created_from_sale_id IS NOT NULL
         AND (unit_cost_ttc IS NULL OR unit_cost_ttc <= 0)`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: 'stock_auto_created_missing_cost',
      module: 'stock',
      severity: 'important',
      title: 'Stock créé automatiquement sans coût',
      description: `${String(r.name ?? r.internal_code)} — ajoutez le coût d'achat pour une marge fiable.`,
      entity_type: 'stock_item',
      entity_id: Number(r.id),
      route: `/stock?open=${r.id}`,
      action: 'correct',
      created_at: String(r.updated_at ?? now)
    })
  ));

  // P1.4 — Ventes liées à un stock sans coût exploitable (ni unit_cost_ttc
  // côté stock, ni purchase_cost_total côté vente). La marge serait sinon
  // sous-estimée silencieusement.
  issues.push(...mapRows(
    db.prepare(
      `SELECT s.id, s.article_name, s.sku, s.updated_at, si.id AS stock_id, si.name AS stock_name
       FROM sales s
       JOIN stock_items si ON si.id = s.linked_stock_item_id AND si.deleted_at IS NULL
       WHERE s.deleted_at IS NULL
         AND s.status IN ('completed','colis_perdu')
         AND COALESCE(si.unit_cost_ttc, 0) <= 0
         AND COALESCE(s.purchase_cost_total, 0) <= 0`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: 'sale_linked_stock_missing_cost',
      module: 'sales',
      severity: 'review',
      title: 'Vente liée à un stock sans coût',
      description:
        `${String(r.article_name ?? 'Vente #' + r.id)} — coût manquant : la marge est sous-estimée. ` +
        `Ajoutez le coût d'achat sur le stock #${r.stock_id}.`,
      entity_type: 'sale',
      entity_id: Number(r.id),
      route: `/stock?open=${r.stock_id}`,
      action: 'correct',
      created_at: String(r.updated_at ?? now)
    })
  ));

  issues.push(...mapRows(
    db.prepare(
      `SELECT id, internal_code, name, updated_at FROM stock_items
       WHERE deleted_at IS NULL
         AND quantity > 0
         AND status IN ('in_stock','listed','reserved','received')
         AND (location IS NULL OR location='')`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: 'stock_missing_location',
      module: 'stock',
      severity: 'review',
      title: 'Stock sans emplacement',
      description: `${String(r.name ?? r.internal_code)} — indiquez une caisse/armoire pour le retrouver vite.`,
      entity_type: 'stock_item',
      entity_id: Number(r.id),
      route: `/stock?open=${r.id}`,
      action: 'correct',
      created_at: String(r.updated_at ?? now)
    })
  ));

  issues.push(...mapRows(
    db.prepare(
      `SELECT si.id, si.internal_code, si.name, si.updated_at
       FROM stock_items si
       WHERE si.deleted_at IS NULL
         AND si.quantity > 0
         AND NOT EXISTS (SELECT 1 FROM document_links dl WHERE dl.entity_type='stock_item' AND dl.entity_id=si.id)`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: 'stock_missing_document',
      module: 'stock',
      severity: 'review',
      title: 'Stock sans justificatif associé',
      description: `${String(r.name ?? r.internal_code)} — utile en cas de contrôle ou inventaire.`,
      entity_type: 'stock_item',
      entity_id: Number(r.id),
      route: `/stock?open=${r.id}`,
      action: 'associate',
      created_at: String(r.updated_at ?? now)
    })
  ));

  issues.push(...mapRows(
    db.prepare(
      `SELECT si.id, si.internal_code, si.name, si.updated_at
       FROM stock_items si
       WHERE si.deleted_at IS NULL
         AND si.auto_created_from_sale_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM document_links dl WHERE dl.entity_type='stock_item' AND dl.entity_id=si.id)`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: 'stock_auto_created_missing_purchase_doc',
      module: 'stock',
      severity: 'review',
      title: "Stock créé automatiquement sans justificatif d'achat",
      description: `${String(r.name ?? r.internal_code)} — associez le justificatif d'achat si vous l'avez.`,
      entity_type: 'stock_item',
      entity_id: Number(r.id),
      route: `/stock?open=${r.id}`,
      action: 'associate',
      created_at: String(r.updated_at ?? now)
    })
  ));

  issues.push(...mapRows(
    db.prepare(
      `SELECT id, internal_code, name, status, updated_at FROM stock_items
       WHERE deleted_at IS NULL
         AND status IN ('sold_pending','reserved')
         AND updated_at < datetime('now','-30 days')`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: `stock_${r.status}_old`,
      module: 'stock',
      severity: 'important',
      title: r.status === 'sold_pending' ? 'Stock vendu en attente ancien' : 'Stock réservé ancien',
      description: `${String(r.name ?? r.internal_code)} — statut ${r.status} depuis plus de 30 jours.`,
      entity_type: 'stock_item',
      entity_id: Number(r.id),
      route: `/stock?open=${r.id}`,
      action: 'review',
      created_at: String(r.updated_at ?? now)
    })
  ));

  issues.push(...mapRows(
    db.prepare(
      `SELECT MIN(id) AS id, sku, COUNT(*) AS n, MAX(updated_at) AS updated_at
       FROM stock_items
       WHERE deleted_at IS NULL
         AND sku IS NOT NULL AND sku != '' AND quantity > 0
       GROUP BY sku HAVING COUNT(*) > 1`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: 'stock_duplicate_sku',
      module: 'stock',
      severity: 'review',
      title: 'SKU dupliqué à vérifier',
      description: `SKU ${String(r.sku)} apparaît sur ${Number(r.n)} lignes actives.`,
      entity_type: 'stock_item',
      entity_id: Number(r.id),
      route: `/stock?sku=${encodeURIComponent(String(r.sku))}`,
      action: 'review',
      created_at: String(r.updated_at ?? now)
    })
  ));

  // C. Achats à vérifier
  issues.push(...mapRows(
    db.prepare(
      `SELECT p.id, p.articles, p.seller, p.total_ttc, p.payment_date, p.status
       FROM purchases p
       WHERE p.deleted_at IS NULL
         AND COALESCE(p.justificatif_status, '') != 'present'
         AND NOT EXISTS (SELECT 1 FROM document_links dl WHERE dl.entity_type='purchase' AND dl.entity_id=p.id)`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: 'purchase_missing_document',
      module: 'purchases',
      severity: 'important',
      title: 'Achat sans justificatif',
      description: `${String(r.articles ?? 'Achat #' + r.id)} — ajoutez ou générez un PDF.`,
      entity_type: 'purchase',
      entity_id: Number(r.id),
      route: `/purchases?open=${r.id}`,
      action: 'associate',
      created_at: String(r.payment_date ?? now)
    })
  ));

  issues.push(...mapRows(
    db.prepare(
      `SELECT p.id, p.articles, p.quantity, p.payment_date, p.status, p.total_ttc
       FROM purchases p
       WHERE p.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM stock_items si WHERE si.purchase_id=p.id AND si.deleted_at IS NULL)`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: 'purchase_without_stock',
      module: 'purchases',
      severity: Number(r.quantity ?? 1) > 1 ? 'important' : 'review',
      title: Number(r.quantity ?? 1) > 1 ? 'Lot achat non divisé en stock' : 'Achat sans stock associé',
      description: `${String(r.articles ?? 'Achat #' + r.id)} — quantité ${r.quantity ?? 1}.`,
      entity_type: 'purchase',
      entity_id: Number(r.id),
      route: `/purchases?open=${r.id}`,
      action: 'correct',
      created_at: String(r.payment_date ?? now)
    })
  ));

  issues.push(...mapRows(
    db.prepare(
      `SELECT id, articles, total_ttc, payment_date FROM purchases WHERE deleted_at IS NULL AND COALESCE(total_ttc,0) <= 0`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: 'purchase_zero_amount',
      module: 'purchases',
      severity: 'important',
      title: 'Achat avec montant zéro',
      description: `${String(r.articles ?? 'Achat #' + r.id)} — total TTC à compléter.`,
      entity_type: 'purchase',
      entity_id: Number(r.id),
      route: `/purchases?open=${r.id}`,
      action: 'correct',
      created_at: String(r.payment_date ?? now)
    })
  ));

  // D. Dépenses à vérifier
  const vatRegime = (db.prepare(`SELECT value FROM settings WHERE key='vat_regime'`).get() as { value: string } | undefined)?.value ?? 'franchise_en_base';

  issues.push(...mapRows(
    db.prepare(
      `SELECT id, description, supplier, category, amount_ttc, date FROM expenses
       WHERE deleted_at IS NULL
         AND (category IS NULL OR category='' OR category='autre')`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: 'expense_missing_category',
      module: 'expenses',
      severity: 'review',
      title: 'Dépense sans catégorie précise',
      description: `${String(r.description ?? r.supplier ?? 'Dépense #' + r.id)} — catégorie à préciser.`,
      entity_type: 'expense',
      entity_id: Number(r.id),
      route: `/expenses?open=${r.id}`,
      action: 'correct',
      created_at: String(r.date ?? now)
    })
  ));

  issues.push(...mapRows(
    db.prepare(
      `SELECT e.id, e.description, e.supplier, e.amount_ttc, e.date
       FROM expenses e
       WHERE e.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM document_links dl WHERE dl.entity_type='expense' AND dl.entity_id=e.id)`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: 'expense_missing_document',
      module: 'expenses',
      severity: 'important',
      title: 'Dépense sans justificatif',
      description: `${String(r.description ?? r.supplier ?? 'Dépense #' + r.id)} — reçu/facture manquant.`,
      entity_type: 'expense',
      entity_id: Number(r.id),
      route: `/expenses?open=${r.id}`,
      action: 'associate',
      created_at: String(r.date ?? now)
    })
  ));

  if (vatRegime === 'franchise_en_base') {
    issues.push(...mapRows(
      db.prepare(
        `SELECT id, description, supplier, vat_deductible, date FROM expenses WHERE deleted_at IS NULL AND COALESCE(vat_deductible,0) > 0`
      ).all() as Record<string, unknown>[],
      (r) => ({
        issue: 'expense_vat_recoverable_franchise',
        module: 'expenses',
        severity: 'critical',
        title: 'TVA récupérable incohérente',
        description: `${String(r.description ?? r.supplier ?? 'Dépense #' + r.id)} — régime franchise en base.`,
        entity_type: 'expense',
        entity_id: Number(r.id),
        route: `/expenses?open=${r.id}`,
        action: 'correct',
        created_at: String(r.date ?? now)
      })
    ));
  }

  issues.push(...mapRows(
    db.prepare(
      `SELECT id, description, supplier, amount_ttc, date, category FROM expenses
       WHERE deleted_at IS NULL
         AND (COALESCE(amount_ttc,0) <= 0 OR date IS NULL OR date='' OR category='achat_stock')`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: !r.date ? 'expense_missing_date' : Number(r.amount_ttc ?? 0) <= 0 ? 'expense_zero_amount' : 'expense_stock_as_operating',
      module: 'expenses',
      severity: Number(r.amount_ttc ?? 0) <= 0 ? 'important' : 'review',
      title: !r.date ? 'Dépense sans date' : Number(r.amount_ttc ?? 0) <= 0 ? 'Dépense avec montant zéro/négatif' : 'Achat stock enregistré comme dépense',
      description: `${String(r.description ?? r.supplier ?? 'Dépense #' + r.id)}.`,
      entity_type: 'expense',
      entity_id: Number(r.id),
      route: `/expenses?open=${r.id}`,
      action: 'correct',
      created_at: String(r.date ?? now)
    })
  ));

  // E. Documents à associer
  issues.push(...mapRows(
    db.prepare(
      `SELECT d.id, d.original_file_name, d.document_type, d.date, d.amount, d.created_at,
              (
                SELECT dl.entity_type || ' #' || dl.entity_id
                FROM document_links dl
                WHERE dl.document_id=d.id
                ORDER BY dl.created_at DESC LIMIT 1
              ) AS linked_entity
       FROM documents d
       WHERE d.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM document_links dl WHERE dl.document_id=d.id)`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: 'document_unlinked',
      module: 'documents',
      severity: 'important',
      title: 'Document sans association',
      description: `${String(r.original_file_name ?? 'Document #' + r.id)} — à relier à une vente, achat, dépense, stock ou déclaration.`,
      entity_type: 'document',
      entity_id: Number(r.id),
      route: `/documents?open=${r.id}&orphan=1`,
      action: 'associate',
      created_at: String(r.created_at ?? now),
      document_id: Number(r.id),
      document_type: String(r.document_type ?? ''),
      document_file_name: String(r.original_file_name ?? ''),
      document_date: r.date ? String(r.date) : null,
      document_amount: r.amount == null ? null : Number(r.amount),
      association_status: 'Sans association',
      associated_entity: r.linked_entity ? String(r.linked_entity) : null
    })
  ));

  issues.push(...mapRows(
    db.prepare(
      `SELECT id, original_file_name, document_type, date, amount, created_at FROM documents
       WHERE deleted_at IS NULL
         AND (document_type IS NULL OR document_type='')`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: 'document_missing_type',
      module: 'documents',
      severity: 'review',
      title: 'Document sans type',
      description: `${String(r.original_file_name ?? 'Document #' + r.id)} — type à définir.`,
      entity_type: 'document',
      entity_id: Number(r.id),
      route: `/documents?open=${r.id}`,
      action: 'correct',
      created_at: String(r.created_at ?? now),
      document_id: Number(r.id),
      document_type: String(r.document_type ?? ''),
      document_file_name: String(r.original_file_name ?? ''),
      document_date: r.date ? String(r.date) : null,
      document_amount: r.amount == null ? null : Number(r.amount),
      association_status: 'Type manquant'
    })
  ));

  issues.push(...mapRows(
    db.prepare(
      `SELECT d.id, d.original_file_name, d.document_type, d.date, d.amount, d.created_at
       FROM documents d
       WHERE d.deleted_at IS NULL
         AND d.document_type='justificatif_urssaf'
         AND NOT EXISTS (SELECT 1 FROM document_links dl WHERE dl.document_id=d.id AND dl.entity_type='declaration')`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: 'document_urssaf_unlinked',
      module: 'documents',
      severity: 'important',
      title: 'Justificatif URSSAF non lié',
      description: `${String(r.original_file_name ?? 'Document #' + r.id)} — reliez-le à la déclaration correspondante.`,
      entity_type: 'document',
      entity_id: Number(r.id),
      route: `/documents?open=${r.id}`,
      action: 'associate',
      created_at: String(r.created_at ?? now),
      document_id: Number(r.id),
      document_type: String(r.document_type ?? ''),
      document_file_name: String(r.original_file_name ?? ''),
      document_date: r.date ? String(r.date) : null,
      document_amount: r.amount == null ? null : Number(r.amount),
      association_status: 'Justificatif URSSAF non lié'
    })
  ));

  issues.push(...mapRows(
    db.prepare(
      `SELECT d.id, d.original_file_name, d.document_type, d.date, d.amount, d.match_status, d.created_at,
              COUNT(c.id) AS candidate_count
       FROM documents d
       JOIN document_match_candidates c ON c.document_id=d.id AND c.status='candidate'
       WHERE d.deleted_at IS NULL
         AND d.match_status='ambiguous'
       GROUP BY d.id`
    ).all() as Record<string, unknown>[],
    (r) => ({
      issue: 'document_match_ambiguous',
      module: 'documents',
      severity: 'important',
      title: 'Document avec association possible à vérifier',
      description: `${String(r.original_file_name ?? 'Document #' + r.id)} — ${Number(r.candidate_count ?? 0)} candidat(s) possible(s).`,
      entity_type: 'document',
      entity_id: Number(r.id),
      route: `/documents?open=${r.id}`,
      action: 'associate',
      created_at: String(r.created_at ?? now),
      document_id: Number(r.id),
      document_type: String(r.document_type ?? ''),
      document_file_name: String(r.original_file_name ?? ''),
      document_date: r.date ? String(r.date) : null,
      document_amount: r.amount == null ? null : Number(r.amount),
      association_status: 'Association ambiguë'
    })
  ));

  // F. Déclarations URSSAF à vérifier
  const today = new Date();
  const year = today.getUTCFullYear();
  const quarter = (Math.floor(today.getUTCMonth() / 3) + 1) as QuarterCode;
  const summary = buildQuarterlySummary(db, year, quarter);
  if (summary.status === 'draft') {
    issues.push({
      issue: 'urssaf_current_draft',
      module: 'urssaf',
      severity: 'info',
      title: 'Déclaration du trimestre en brouillon',
      description: `Q${quarter} ${year} — CA estimé ${summary.caGoods.toFixed(2)} €, échéance ${summary.dueDate}.`,
      entity_type: 'declaration',
      entity_id: null,
      route: '/declarations',
      action: 'open',
      created_at: now
    });
  }
  if (summary.uncertainSalesCount > 0) {
    issues.push({
      issue: 'urssaf_sales_to_review',
      module: 'urssaf',
      severity: 'critical',
      title: 'Ventes à vérifier dans la déclaration',
      description: `${summary.uncertainSalesCount} vente(s) à vérifier dans Q${quarter} ${year}.`,
      entity_type: 'declaration',
      entity_id: null,
      route: '/declarations',
      action: 'review',
      created_at: now
    });
  }
  const due = nextDueDate(today);
  if (due) {
    issues.push({
      issue: 'urssaf_next_due',
      module: 'urssaf',
      severity: 'info',
      title: 'Prochaine échéance URSSAF',
      description: `Q${due.quarter} ${due.year} — échéance ${due.dueDate}.`,
      entity_type: 'declaration',
      entity_id: null,
      route: '/declarations',
      action: 'open',
      created_at: now
    });
  }

  const ignored = filters.includeIgnored
    ? new Set<string>()
    : new Set((db.prepare(`SELECT review_key FROM review_ignored_items`).all() as { review_key: string }[]).map((r) => r.review_key));

  let items = issues
    .map((i) => ({ ...i, key: reviewKey(i) }))
    .filter((i) => !ignored.has(i.key));

  if (filters.severity && filters.severity !== 'all') items = items.filter((i) => i.severity === filters.severity);
  if (filters.module && filters.module !== 'all') items = items.filter((i) => i.module === filters.module);

  const bySeverity = emptyCount<ReviewSeverity>(['critical', 'important', 'review', 'info']);
  const byModule = emptyCount<ReviewModule>(['sales', 'stock', 'purchases', 'expenses', 'documents', 'urssaf']);
  for (const i of items) {
    bySeverity[i.severity] += 1;
    byModule[i.module] += 1;
  }

  items.sort((a, b) => {
    const sev = { critical: 0, important: 1, review: 2, info: 3 };
    return sev[a.severity] - sev[b.severity] || MODULE_LABEL[a.module].localeCompare(MODULE_LABEL[b.module]);
  });

  return { total: items.length, bySeverity, byModule, items };
}

export function markReviewItem(
  db: Database.Database,
  payload: { key: string; module: ReviewModule; entity_type?: string | null; entity_id?: number | null; status?: 'verified' | 'ignored'; note: string }
): { ok: true } {
  if (!payload.note?.trim()) {
    throw new Error('Une note est obligatoire pour masquer ou marquer comme vérifié.');
  }
  db.prepare(
    `INSERT INTO review_ignored_items (review_key, module, entity_type, entity_id, status, note)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(review_key) DO UPDATE SET
       status=excluded.status,
       note=excluded.note,
       ignored_at=datetime('now')`
  ).run(
    payload.key,
    payload.module,
    payload.entity_type ?? null,
    payload.entity_id ?? null,
    payload.status ?? 'ignored',
    payload.note
  );
  return { ok: true };
}

/**
 * Action de masse : marque plusieurs entrées du Centre de révision en une
 * seule transaction. La même note s'applique à toutes les entrées.
 *
 * Tableau `items` : chaque entrée doit fournir au moins `key` et `module`.
 * Les autres champs (`entity_type`, `entity_id`) sont optionnels.
 */
export function markReviewItemsBulk(
  db: Database.Database,
  payload: {
    items: Array<{ key: string; module: ReviewModule; entity_type?: string | null; entity_id?: number | null }>;
    status: 'verified' | 'ignored';
    note: string;
  }
): { ok: true; processed: number } {
  if (!payload.note?.trim()) {
    throw new Error('Une note est obligatoire pour masquer ou marquer comme vérifié.');
  }
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw new Error('Aucun élément sélectionné.');
  }
  const stmt = db.prepare(
    `INSERT INTO review_ignored_items (review_key, module, entity_type, entity_id, status, note)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(review_key) DO UPDATE SET
       status=excluded.status,
       note=excluded.note,
       ignored_at=datetime('now')`
  );
  const tx = db.transaction(() => {
    for (const item of payload.items) {
      if (!item.key) continue;
      stmt.run(
        item.key,
        item.module,
        item.entity_type ?? null,
        item.entity_id ?? null,
        payload.status,
        payload.note
      );
    }
  });
  tx();
  return { ok: true, processed: payload.items.length };
}
