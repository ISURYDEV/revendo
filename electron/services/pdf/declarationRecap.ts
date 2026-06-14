import type Database from 'better-sqlite3';
import path from 'node:path';
import { htmlToPdf, PDF_CSS } from './htmlToPdf';
import { getDocumentsDir } from '../../db/connection';
import { addDocument, linkDocument } from '../documents/storage';
import { buildQuarterlySummary } from '../declarations/summary';
import type { QuarterCode } from '../../../shared/types';

function esc(s: unknown): string {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function eur(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '0,00 €';
  return n.toFixed(2).replace('.', ',') + ' €';
}
function pct(n: number): string { return (n * 100).toFixed(1) + ' %'; }
function dateFr(iso: string | null | undefined): string {
  if (!iso) return '';
  const s = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return String(iso);
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
}

export async function generateDeclarationRecap(
  db: Database.Database,
  year: number,
  quarter: QuarterCode,
  options: { actualDeclaredCa?: number; actualPaidContributions?: number; declarationDate?: string }
): Promise<{ path: string; documentId: number }> {
  const summary = buildQuarterlySummary(db, year, quarter);

  // Included sales (using EFFECTIVE period from summary — handles pre_activity exclusion)
  const sales = db
    .prepare(
      `SELECT id, external_id, declared_encashment_date, buyer_username, buyer_country,
              article_name, sku, declarable_amount, platform
       FROM sales
       WHERE urssaf_declarable=1 AND classification != 'pre_activity'
         AND declared_encashment_date >= ? AND declared_encashment_date <= ?
       ORDER BY declared_encashment_date ASC`
    )
    .all(`${summary.periodStart}T00:00:00.000Z`, `${summary.periodEnd}T23:59:59.999Z`) as Array<Record<string, unknown>>;

  // Pre-activity sales in the raw quarter (for the separate section)
  const preActivitySales = db
    .prepare(
      `SELECT external_id, declared_encashment_date, article_name, sku, amount_received, platform
       FROM sales
       WHERE classification='pre_activity'
         AND ((sale_date >= ? AND sale_date <= ?) OR (finalization_date >= ? AND finalization_date <= ?))
       ORDER BY declared_encashment_date ASC`
    )
    .all(
      `${summary.rawPeriodStart}T00:00:00.000Z`, `${summary.periodEnd}T23:59:59.999Z`,
      `${summary.rawPeriodStart}T00:00:00.000Z`, `${summary.periodEnd}T23:59:59.999Z`
    ) as Array<Record<string, unknown>>;

  const company = db.prepare(`SELECT key, value FROM settings`).all() as { key: string; value: string }[];
  const c: Record<string, string> = {};
  for (const r of company) c[r.key] = r.value;

  const isAcre = summary.acreApplied;
  const isAcreFull = summary.acreFullPeriod;
  // Use the per-sale applied contributions (most accurate)
  const contribUsed = options.actualPaidContributions ?? summary.contributionsApplied;
  const declDate = options.declarationDate ?? new Date().toISOString().slice(0, 10);

  const periodLabel = summary.firstDeclarationLabel ?? `Q${quarter} ${year}`;
  const totalImported = summary.caGoods + summary.preActivitySalesAmount;
  const totalImportedCount = sales.length + preActivitySales.length;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Récap ${esc(periodLabel)}</title>
    <style>${PDF_CSS}</style></head><body>
    <div class="row">
      <div>
        <h1>Récapitulatif déclaration URSSAF</h1>
        <div class="muted"><strong>${esc(periodLabel)}</strong></div>
        <div class="muted">Période interne déclarable URSSAF: ${esc(dateFr(summary.periodStart))} → ${esc(dateFr(summary.periodEnd))}</div>
        <div class="muted">Échéance: <strong>${esc(dateFr(summary.dueDate))}</strong>${summary.isFirstDeclaration ? ' (première déclaration)' : ''}</div>
      </div>
      <div class="muted right">
        <strong>${esc(c.commercial_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`)}</strong><br>
        ${c.siret ? `SIRET: ${esc(c.siret)}<br>` : ''}
        ${esc(c.address ?? '')}<br>
        ${c.activity_start_date ? `Début d'activité: ${esc(dateFr(c.activity_start_date))}` : ''}
      </div>
    </div>

    <h2>Régime fiscal</h2>
    <table>
      <tr><td>Activité</td><td><strong>Vente de marchandises (BIC) — achat-revente</strong></td></tr>
      <tr><td>Régime TVA</td><td><strong>Franchise en base — TVA non applicable, art. 293 B du CGI</strong></td></tr>
      <tr><td>ACRE</td><td>${esc(c.acre_enabled === 'true' ? `Actif (${esc(dateFr(c.acre_start_date) || '?')} → ${esc(dateFr(c.acre_end_date) || '?')})` : 'Non actif')}</td></tr>
      <tr><td>Taux ACRE</td><td>${pct(summary.rateAcre)}</td></tr>
      <tr><td>Taux normal</td><td>${pct(summary.rateNormal)}</td></tr>
    </table>

    <h2>Chiffre d'affaires de la période</h2>
    <table>
      <tr><td>CA total importé (toutes ventes du trimestre)</td><td class="right">${eur(totalImported)} (${totalImportedCount} ventes)</td></tr>
      <tr><td>— dont ventes avant début d'activité (exclues)</td><td class="right" style="color:#f4d59e">${eur(summary.preActivitySalesAmount)} (${summary.preActivitySalesCount} ventes)</td></tr>
      <tr><td>— dont ventes personnelles / annulées / à reviser (exclues)</td><td class="right" style="color:#9da7ba">${eur(summary.personalSalesAmount)} (${summary.personalSalesCount + summary.canceledSalesCount + summary.uncertainSalesCount} ventes)</td></tr>
      <tr class="total"><td><strong>CA URSSAF déclarable</strong></td><td class="right"><strong>${eur(summary.caGoods)}</strong> (${summary.includedSalesCount} ventes incluses)</td></tr>
    </table>

    <h2>Cotisations estimées</h2>
    <table>
      <tr><td>Cotisations à payer (taux ACRE appliqué par vente)</td><td class="right"><strong>${eur(summary.contributionsApplied)}</strong></td></tr>
      <tr><td class="muted">Référence: si tout en taux normal (${pct(summary.rateNormal)})</td><td class="right muted">${eur(summary.contributionsNormal)}</td></tr>
      <tr><td class="muted">Référence: si tout en taux ACRE (${pct(summary.rateAcre)})</td><td class="right muted">${eur(summary.contributionsAcre)}</td></tr>
    </table>
    ${isAcreFull ? '<div class="mention" style="background:rgba(22,163,74,0.16);border-left-color:#33d69f;color:#dffbea">Toutes les ventes de la période sont à l\'intérieur de la fenêtre ACRE → taux 6,2 % appliqué intégralement.</div>' : isAcre ? '<div class="mention">Période mixte: certaines ventes en ACRE, d\'autres en taux normal. Le total ci-dessus applique le taux correct vente par vente.</div>' : '<div class="mention" style="background:rgba(245,158,11,0.14);border-left-color:#f6c96f">ACRE non applicable sur cette période — taux normal appliqué.</div>'}

    ${options.actualDeclaredCa != null ? `<h2>Déclaration réelle</h2>
    <table>
      <tr><td>CA réellement déclaré</td><td class="right"><strong>${eur(options.actualDeclaredCa)}</strong></td></tr>
      ${options.actualPaidContributions != null ? `<tr><td>Cotisations payées</td><td class="right">${eur(options.actualPaidContributions)}</td></tr>` : ''}
      <tr><td>Date de déclaration</td><td class="right">${esc(dateFr(declDate))}</td></tr>
    </table>` : ''}

    <h2>Détail des ventes incluses (${sales.length})</h2>
    <table>
      <thead><tr>
        <th>Date enc.</th><th>ID</th><th>Plateforme</th><th>Article</th><th>SKU</th><th>Acheteur</th><th class="right">Montant</th>
      </tr></thead>
      <tbody>
        ${sales.map((s) => `<tr>
          <td>${esc(dateFr(String(s.declared_encashment_date ?? '')))}</td>
          <td>${esc(s.external_id ?? '')}</td>
          <td>${esc(s.platform ?? '')}</td>
          <td>${esc(s.article_name ?? '')}</td>
          <td>${esc(s.sku ?? '')}</td>
          <td>${esc(s.buyer_username ?? '')} ${esc(s.buyer_country ?? '')}</td>
          <td class="right">${eur(Number(s.declarable_amount))}</td>
        </tr>`).join('')}
        <tr class="total"><td colspan="6" class="right"><strong>Total CA déclarable</strong></td><td class="right"><strong>${eur(summary.caGoods)}</strong></td></tr>
      </tbody>
    </table>

    ${preActivitySales.length > 0 ? `
    <h2 style="color:#f4d59e">Ventes avant début d'activité — à régulariser / ne pas déclarer automatiquement à l'URSSAF (${preActivitySales.length})</h2>
    <table>
      <thead><tr>
        <th>Date enc.</th><th>ID</th><th>Plateforme</th><th>Article</th><th>SKU</th><th class="right">Montant</th>
      </tr></thead>
      <tbody>
        ${preActivitySales.map((s) => `<tr>
          <td>${esc(dateFr(String(s.declared_encashment_date ?? '')))}</td>
          <td>${esc(s.external_id ?? '')}</td>
          <td>${esc(s.platform ?? '')}</td>
          <td>${esc(s.article_name ?? '')}</td>
          <td>${esc(s.sku ?? '')}</td>
          <td class="right">${eur(Number(s.amount_received))}</td>
        </tr>`).join('')}
        <tr class="total"><td colspan="5" class="right">Total ventes avant début d'activité</td><td class="right">${eur(summary.preActivitySalesAmount)}</td></tr>
      </tbody>
    </table>
    <div class="mention">Les ventes antérieures au ${esc(dateFr(c.activity_start_date) || '?')} sont exclues du CA URSSAF et listées séparément comme ventes avant début d'activité. Elles ne sont pas comptées dans les cotisations.</div>
    ` : ''}

    <div class="mention">
      <strong>Document interne d'aide à la déclaration.</strong> Ne remplace pas la déclaration officielle sur <em>autoentrepreneur.urssaf.fr</em>. Les ventes déjà importées précédemment sont détectées par ID plateforme et ne sont pas comptées deux fois.
    </div>

    <div class="footer">
      Signature: __________________________ &nbsp;&nbsp;&nbsp; Date: ${esc(declDate)}<br>
      Document généré par Revendo le ${dateFr(new Date().toISOString())}.
    </div>
  </body></html>`;

  const tmpPath = path.join(getDocumentsDir(), String(year), 'urssaf', `recap_Q${quarter}_${year}.pdf`);
  await htmlToPdf(html, tmpPath);

  const doc = addDocument(db, {
    sourcePath: tmpPath,
    document_type: 'justificatif_urssaf',
    date: declDate,
    amount: summary.caGoods,
    external_reference: `recap_Q${quarter}_${year}`,
    notes: `Récap déclaration URSSAF Q${quarter} ${year} généré par Revendo`
  });
  const declRow = db.prepare(`SELECT id FROM declarations WHERE year=? AND quarter=?`).get(year, quarter) as { id: number } | undefined;
  if (declRow && !doc.deduplicated) {
    linkDocument(db, { document_id: doc.id, entity_type: 'declaration', entity_id: declRow.id });
    db.prepare(`UPDATE declarations SET urssaf_receipt_document_id=? WHERE id=?`).run(doc.id, declRow.id);
  }
  return { path: doc.document.file_path, documentId: doc.id };
}
