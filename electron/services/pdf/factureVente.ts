import type Database from 'better-sqlite3';
import path from 'node:path';
import { htmlToPdf, PDF_CSS } from './htmlToPdf';
import { getDocumentsDir } from '../../db/connection';
import { addDocument, linkDocument } from '../documents/storage';
import type { Sale } from '../../../shared/types';

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

interface CompanyInfo {
  commercial_name?: string;
  first_name?: string;
  last_name?: string;
  siret?: string;
  address?: string;
  email?: string;
  phone?: string;
  vat_regime?: string;
}

function loadCompany(db: Database.Database): CompanyInfo {
  const rows = db.prepare(`SELECT key, value FROM settings`).all() as { key: string; value: string }[];
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/**
 * Generate a "Facture de vente" PDF for a sale.
 * If sale.urssaf_declarable=0 (personal item), generate a "Note de cession entre particuliers"
 * style document instead — with explicit mention that it's NOT a professional sale.
 */
export async function generateFactureVente(
  db: Database.Database,
  saleId: number
): Promise<{ path: string; documentId: number }> {
  const sale = db.prepare(`SELECT * FROM sales WHERE id=?`).get(saleId) as Sale | undefined;
  if (!sale) throw new Error(`Vente #${saleId} introuvable`);
  const company = loadCompany(db);

  const isPro = sale.urssaf_declarable === 1;
  const isFranchise = (company.vat_regime ?? 'franchise_en_base') === 'franchise_en_base';

  const factureNum = sale.external_id ?? `M-${saleId}`;
  const dateFact = (sale.declared_encashment_date ?? sale.sale_date ?? new Date().toISOString()).slice(0, 10);

  const totalTtc = sale.amount_received ?? sale.sale_price_ttc ?? 0;
  const totalHt = sale.sale_price_ht ?? totalTtc;
  const tva = (sale.vat_amount ?? 0) || (isFranchise ? 0 : Math.max(0, totalTtc - totalHt));

  const docType = isPro ? 'Facture' : 'Note de cession entre particuliers';
  const docTitle = isPro ? `Facture n° ${esc(factureNum)}` : `Note de cession n° ${esc(factureNum)}`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${docTitle}</title>
    <style>${PDF_CSS}</style></head><body>
    <div class="row">
      <div>
        <h1>${docTitle}</h1>
        <div class="muted">${docType} • ${esc(dateFr(dateFact))}</div>
      </div>
      <div class="muted right">
        <strong>${esc(company.commercial_name || `${company.first_name ?? ''} ${company.last_name ?? ''}`)}</strong><br>
        ${esc(company.address ?? '')}<br>
        ${company.siret ? `SIRET: ${esc(company.siret)}<br>` : ''}
        ${company.email ? `${esc(company.email)}<br>` : ''}
        ${company.phone ? `${esc(company.phone)}` : ''}
      </div>
    </div>

    <div class="box">
      <strong>Acheteur:</strong>
      ${sale.buyer_username ? esc(sale.buyer_username) : '<em>(anonyme — vente plateforme)</em>'}
      ${sale.buyer_country ? ` — ${esc(sale.buyer_country)}` : ''}
      ${sale.platform ? `<div class="muted">via ${esc(sale.platform)}</div>` : ''}
    </div>

    <h2>Article</h2>
    <table>
      <thead><tr>
        <th>Description</th><th>SKU</th><th class="right">Qté</th>
        ${isFranchise ? '' : '<th class="right">HT</th><th class="right">TVA</th>'}
        <th class="right">${isFranchise ? 'Total' : 'TTC'}</th>
      </tr></thead>
      <tbody>
        <tr>
          <td>${esc(sale.article_name ?? '')}</td>
          <td>${esc(sale.sku ?? '—')}</td>
          <td class="right">${esc(sale.quantity ?? 1)}</td>
          ${isFranchise ? '' : `<td class="right">${eur(totalHt)}</td><td class="right">${eur(tva)}</td>`}
          <td class="right">${eur(totalTtc)}</td>
        </tr>
        <tr class="total">
          <td colspan="${isFranchise ? '3' : '5'}" class="right">Total</td>
          <td class="right">${eur(totalTtc)}</td>
        </tr>
      </tbody>
    </table>

    ${isPro && isFranchise ? `<div class="mention">
      <strong>TVA non applicable</strong>, art. 293 B du CGI.<br>
      Régime de la micro-entreprise — franchise en base de TVA.
    </div>` : ''}
    ${!isPro ? `<div class="mention">
      <strong>Vente d'un bien personnel</strong> — hors activité professionnelle.<br>
      Cette transaction ne fait pas partie du chiffre d'affaires de la micro-entreprise et n'est pas soumise à TVA ni à cotisations URSSAF au titre de l'activité.
    </div>` : ''}

    ${sale.shipping_cost_ttc ? `<p class="muted">Frais de port: ${eur(sale.shipping_cost_ttc)} (inclus dans le total ou pris en charge par la plateforme).</p>` : ''}
    ${sale.tracking_number ? `<p class="muted">Suivi: ${esc(sale.carrier ?? '')} ${esc(sale.tracking_number)}</p>` : ''}
    ${sale.note ? `<p class="muted">Note: ${esc(sale.note)}</p>` : ''}

    <div class="footer">
      Document généré par Revendo le ${dateFr(new Date().toISOString())}.
      ${isPro ? '' : 'Vente entre particuliers (non commerciale).'}
    </div>
  </body></html>`;

  // Save to documents/{year}/sales/
  const year = dateFact.slice(0, 4);
  const safeNum = String(factureNum).replace(/[^a-zA-Z0-9._-]/g, '_');
  const tmpPath = path.join(getDocumentsDir(), year, 'sales', `facture_${safeNum}.pdf`);
  await htmlToPdf(html, tmpPath);

  // Register document + link to sale
  const doc = addDocument(db, {
    sourcePath: tmpPath,
    document_type: isPro ? 'facture_vente' : 'autre',
    date: dateFact,
    amount: totalTtc,
    supplier_or_customer: sale.buyer_username ?? null,
    external_reference: String(factureNum),
    notes: isPro ? 'Facture générée par Revendo' : 'Note de cession entre particuliers'
  });
  if (!doc.deduplicated) {
    linkDocument(db, { document_id: doc.id, entity_type: 'sale', entity_id: saleId });
  }
  return { path: doc.document.file_path, documentId: doc.id };
}
