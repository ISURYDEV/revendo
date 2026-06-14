import type Database from 'better-sqlite3';
import path from 'node:path';
import { htmlToPdf, PDF_CSS } from './htmlToPdf';
import { getDocumentsDir } from '../../db/connection';
import { addDocument, linkDocument } from '../documents/storage';

function esc(s: unknown): string {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function eur(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '0,00 €';
  return n.toFixed(2).replace('.', ',') + ' €';
}
function dateFr(iso: string | null | undefined): string {
  if (!iso) return '';
  const s = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return String(iso);
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
}

interface PurchaseRow {
  id: number;
  source: string;
  external_id: string | null;
  payment_date: string | null;
  status: string | null;
  seller: string | null;
  platform: string | null;
  articles: string | null;
  quantity: number | null;
  items_price: number | null;
  shipping_fee: number | null;
  protection_fee: number | null;
  total_ttc: number | null;
  refunded_amount: number | null;
  carrier: string | null;
  tracking_number: string | null;
  notes: string | null;
  original_currency: string | null;
  original_amount: number | null;
}

/**
 * Generate a "Justificatif d'achat" PDF from a purchase row.
 *
 * Used for tax inspection ("d'où vient votre stock?"). Includes everything the auditor
 * could ask: source platform, seller, date, items, amounts, tracking, original currency
 * if non-EUR. Mention that it's reconstructed from platform data (not a vendor-issued
 * invoice), explicitly labeled as a justificatif interne.
 */
export async function generateJustificatifAchat(
  db: Database.Database,
  purchaseId: number
): Promise<{ path: string; documentId: number }> {
  const p = db.prepare(`SELECT * FROM purchases WHERE id=?`).get(purchaseId) as PurchaseRow | undefined;
  if (!p) throw new Error(`Achat #${purchaseId} introuvable`);

  const company = db.prepare(`SELECT key, value FROM settings`).all() as { key: string; value: string }[];
  const c: Record<string, string> = {};
  for (const r of company) c[r.key] = r.value;

  const ref = p.external_id ?? `M-${p.id}`;
  const date = (p.payment_date ?? new Date().toISOString()).slice(0, 10);
  const platform = p.platform ?? p.source ?? 'Inconnu';

  const isVinted = (platform.toLowerCase().includes('vinted') || p.source === 'vinteer');
  const isWhatNot = platform.toLowerCase().includes('whatnot');
  const sourceLabel = isVinted ? 'Vinted (achat entre particuliers via plateforme)' :
                       isWhatNot ? 'WhatNot (achat via live shopping)' :
                       platform;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Justificatif achat ${esc(ref)}</title>
    <style>${PDF_CSS}</style></head><body>
    <div class="row">
      <div>
        <h1>Justificatif d'achat</h1>
        <div class="muted">Référence: <strong>${esc(ref)}</strong> • Source: ${esc(sourceLabel)}</div>
        <div class="muted">Date d'achat: <strong>${esc(dateFr(date))}</strong></div>
      </div>
      <div class="muted right">
        <strong>Acheteur (vous)</strong><br>
        ${esc(c.commercial_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`)}<br>
        ${c.siret ? `SIRET: ${esc(c.siret)}<br>` : ''}
        ${esc(c.address ?? '')}<br>
        ${c.email ? esc(c.email) : ''}
      </div>
    </div>

    <h2>Vendeur</h2>
    <div class="box">
      <strong>${esc(p.seller ?? '(anonyme — vendeur particulier sur ' + platform + ')')}</strong><br>
      ${p.platform ? `Plateforme: ${esc(p.platform)}` : ''}
      ${isVinted ? '<div class="muted">Vinted ne fournit pas l\'identité légale du vendeur particulier. L\'identifiant ci-dessus est le pseudo public de la plateforme.</div>' : ''}
    </div>

    <h2>Article(s) acheté(s)</h2>
    <table>
      <thead><tr>
        <th>Description</th>
        <th class="right">Qté</th>
        <th class="right">Prix article(s)</th>
        <th class="right">Port</th>
        <th class="right">Protection</th>
        <th class="right">Total TTC</th>
      </tr></thead>
      <tbody>
        <tr>
          <td>${esc(p.articles ?? '—')}</td>
          <td class="right">${esc(p.quantity ?? 1)}</td>
          <td class="right">${eur(p.items_price)}</td>
          <td class="right">${eur(p.shipping_fee)}</td>
          <td class="right">${eur(p.protection_fee)}</td>
          <td class="right">${eur(p.total_ttc)}</td>
        </tr>
        <tr class="total">
          <td colspan="5" class="right"><strong>Total payé</strong></td>
          <td class="right"><strong>${eur(p.total_ttc)}</strong></td>
        </tr>
        ${(p.refunded_amount ?? 0) > 0 ? `<tr>
          <td colspan="5" class="right muted">Remboursement reçu</td>
          <td class="right" style="color:#33d69f">-${eur(p.refunded_amount)}</td>
        </tr>` : ''}
      </tbody>
    </table>

    ${p.original_currency && p.original_currency !== 'EUR' && p.original_amount ? `<p class="muted">
      Montant original: ${eur(p.original_amount)} en ${esc(p.original_currency)}. Converti en EUR pour la comptabilité.
    </p>` : ''}

    ${p.tracking_number ? `<h2>Livraison</h2>
    <div class="box">
      Transporteur: ${esc(p.carrier ?? '—')}<br>
      N° de suivi: <strong>${esc(p.tracking_number)}</strong>
    </div>` : ''}

    <div class="mention">
      <strong>Régime fiscal de l'acheteur:</strong> Micro-entreprise — Franchise en base de TVA<br>
      Mention: <em>"TVA non applicable, art. 293 B du CGI"</em>. Aucune TVA récupérable sur cet achat.
    </div>

    <div class="mention" style="background:rgba(245,158,11,0.14);border-left-color:#f6c96f">
      <strong>Document interne reconstitué depuis les données de la plateforme ${esc(platform)}.</strong>
      Ce justificatif n'est pas une facture émise par le vendeur. Il consigne les informations
      nécessaires en cas de contrôle fiscal pour démontrer la provenance du stock acheté en vue
      de la revente dans le cadre de l'activité de micro-entrepreneur achat-revente (BIC).
      ${isVinted ? 'Sur Vinted, les vendeurs particuliers ne fournissent pas de facture: ce document tient lieu de justificatif de la transaction.' : ''}
    </div>

    ${p.notes ? `<p class="muted"><strong>Notes:</strong> ${esc(p.notes)}</p>` : ''}

    <div class="footer">
      Document généré par Revendo le ${dateFr(new Date().toISOString())}.
      Référence interne achat #${p.id} • Statut : ${esc(p.status ?? 'inconnu')}.
    </div>
  </body></html>`;

  const year = date.slice(0, 4);
  const safeRef = String(ref).replace(/[^a-zA-Z0-9._-]/g, '_');
  const tmpPath = path.join(getDocumentsDir(), year, 'purchases', `justificatif_${safeRef}.pdf`);
  await htmlToPdf(html, tmpPath);

  const doc = addDocument(db, {
    sourcePath: tmpPath,
    document_type: 'facture_achat',
    date,
    amount: p.total_ttc ?? null,
    supplier_or_customer: p.seller ?? p.platform ?? null,
    external_reference: String(ref),
    notes: `Justificatif d'achat reconstitué depuis ${platform}`
  });
  if (!doc.deduplicated) {
    linkDocument(db, { document_id: doc.id, entity_type: 'purchase', entity_id: purchaseId });
  }
  return { path: doc.document.file_path, documentId: doc.id };
}

/**
 * Bulk: generate justificativos for all purchases that have no document linked.
 * Returns counts.
 */
export async function generateAllJustificativosWithoutDoc(
  db: Database.Database
): Promise<{ generated: number; skipped: number; errors: { purchaseId: number; reason: string }[] }> {
  const rows = db
    .prepare(
      `SELECT p.id FROM purchases p
       WHERE NOT EXISTS (
         SELECT 1 FROM document_links dl
         WHERE dl.entity_type='purchase' AND dl.entity_id=p.id
       )
       ORDER BY p.payment_date DESC`
    )
    .all() as { id: number }[];

  const result = { generated: 0, skipped: 0, errors: [] as { purchaseId: number; reason: string }[] };
  for (const r of rows) {
    try {
      await generateJustificatifAchat(db, r.id);
      result.generated += 1;
    } catch (err) {
      result.errors.push({ purchaseId: r.id, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}
