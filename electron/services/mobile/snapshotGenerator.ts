import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { buildQuarterlySummary } from '../declarations/summary';
import { buildProfitabilitySummary } from '../profitability/calculator';
import { redactCompanyRow, redactDiaryRow, redactDocumentRow, redactSaleRow } from '../security/privacy';
import {
  MOBILE_ACTIONS_SCHEMA_VERSION,
  MOBILE_SNAPSHOT_SCHEMA_VERSION
} from '../../../shared/mobile/schemaVersion';
import type { QuarterCode } from '../../../shared/types';

/**
 * Generate a self-contained HTML viewer with all data embedded as JSON.
 * Designed to be opened on Android (via Google Drive → "Open with Chrome").
 * Read-only by design — no IPC, no API, no destructive actions.
 *
 * Embeds:
 *  - Sales, purchases, expenses, stock metadata.
 *  - Document files (PDF/images) as base64 if under MAX_EMBED_BYTES per file.
 *  - URSSAF récap PDFs per quarter (if generated on PC, also embedded as base64).
 *  - Per-quarter declaration summaries including first-declaration overrides.
 */

const MAX_EMBED_BYTES = 220 * 1024; // per file. Keep Android/Drive HTML loading fast.
const MAX_TOTAL_EMBED_BYTES = 2 * 1024 * 1024; // total embedded files budget inside the mobile HTML.

export interface MobileSnapshotOptions {
  anonymized?: boolean;
  dataScope?: string;
}

function mimeOf(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.pdf' ? 'application/pdf'
       : ext === '.png' ? 'image/png'
       : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
       : ext === '.csv' ? 'text/csv'
       : ext === '.xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
       : 'application/octet-stream';
}

function fileSize(filePath: string): number | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    return stat.size;
  } catch {
    return null;
  }
}

function tryEmbedFile(filePath: string): { base64: string; mime: string; size: number } | null {
  try {
    const size = fileSize(filePath);
    if (size == null || size > MAX_EMBED_BYTES) return null;
    const buf = fs.readFileSync(filePath);
    return { base64: buf.toString('base64'), mime: mimeOf(filePath), size };
  } catch {
    return null;
  }
}

export function generateMobileHtml(
  db: Database.Database,
  outputPath: string,
  options: MobileSnapshotOptions = {}
): { path: string; size: number; rowCount: number } {
  const get = (key: string) => (db.prepare(`SELECT value FROM settings WHERE key=?`).get(key) as { value: string } | undefined)?.value ?? null;
  const anonymized = options.anonymized ?? (get('mobile_snapshot_redaction_enabled') !== 'false');

  const companyRaw = {
    commercial_name: get('commercial_name') ?? '',
    first_name: get('first_name') ?? '',
    last_name: get('last_name') ?? '',
    email: get('email') ?? '',
    siret: get('siret') ?? '',
    address: get('address') ?? '',
    activity_start_date: get('activity_start_date') ?? '',
    vat_regime: get('vat_regime') ?? 'franchise_en_base'
  };
  const company = anonymized
    ? redactCompanyRow(companyRaw, { maskBuyer: true, maskContact: true, maskUsername: true })
    : companyRaw;

  const salesRows = db.prepare(
    `SELECT id, external_id, sale_date, declared_encashment_date, status, classification, urssaf_declarable,
            platform, article_name, sku, buyer_username, buyer_country,
            amount_received, declarable_amount, purchase_cost_total, vinted_fees, declared_period, note
     FROM sales WHERE deleted_at IS NULL ORDER BY COALESCE(declared_encashment_date, sale_date) DESC`
  ).all();
  const sales = anonymized
    ? (salesRows as Array<Record<string, unknown>>).map((r) => {
        const redacted = redactSaleRow(r, { maskBuyer: true, maskContact: true, maskUsername: true });
        return { ...redacted, note: redacted.note ? 'Note masquée' : redacted.note };
      })
    : salesRows;

  const purchases = db.prepare(
    `SELECT id, source, external_id, payment_date, seller, platform, articles, quantity, total_ttc
     FROM purchases WHERE deleted_at IS NULL ORDER BY payment_date DESC`
  ).all();

  const expenses = db.prepare(
    `SELECT id, date, category, supplier, description, amount_ttc
     FROM expenses WHERE deleted_at IS NULL ORDER BY date DESC`
  ).all();

  // Stock items currently active (non-archived, non-discarded)
  const stock = db.prepare(
    `SELECT id, internal_code, sku, name, status, quantity, unit_cost_ttc, total_cost_ttc,
            estimated_sale_price, brand, size, color, location, source
     FROM stock_items
     WHERE deleted_at IS NULL
       AND status NOT IN ('discarded', 'archived')
     ORDER BY updated_at DESC`
  ).all();

  // Documents with base64 (embedded if small) + entity links
  const docRows = db.prepare(
    `SELECT d.id, d.file_name, d.original_file_name, d.file_path, d.document_type, d.source, d.date, d.amount,
            d.supplier_or_customer, d.external_reference, d.mime_type, d.notes,
            (SELECT GROUP_CONCAT(entity_type || ':' || entity_id, ',') FROM document_links WHERE document_id=d.id) AS links
     FROM documents d WHERE d.deleted_at IS NULL ORDER BY d.created_at DESC`
  ).all() as Array<Record<string, unknown>>;

  let embeddedDocumentBytes = 0;
  const documents = docRows.map((d) => {
    const filePath = String(d.file_path ?? '');
    const size = fileSize(filePath);
    const candidate = size != null && embeddedDocumentBytes + size <= MAX_TOTAL_EMBED_BYTES
      ? tryEmbedFile(filePath)
      : null;
    const embed = candidate && embeddedDocumentBytes + candidate.size <= MAX_TOTAL_EMBED_BYTES ? candidate : null;
    if (embed) embeddedDocumentBytes += embed.size;
    const doc = {
      id: d.id,
      file_name: d.file_name,
      original_file_name: d.original_file_name,
      document_type: d.document_type,
      source: d.source,
      date: d.date,
      amount: d.amount,
      supplier_or_customer: d.supplier_or_customer,
      external_reference: d.external_reference,
      notes: d.notes,
      links: d.links,
      relative_path: filePath.replace(/\\/g, '/').split('/documents/')[1] ?? null,
      embed: embed ? { base64: embed.base64, mime: embed.mime, size: embed.size } : null,
      size_unembed: embed ? null : size,
      mobile_not_embedded_reason: embed
        ? null
        : size == null
          ? 'missing'
          : size > MAX_EMBED_BYTES
            ? 'file_too_large'
            : 'mobile_snapshot_budget'
    };
    return anonymized ? redactDocumentRow(doc, { maskBuyer: true, maskContact: true, maskUsername: true }) : doc;
  });

  // Declarations: compute summary for last 2 years all quarters + embed récap PDF if exists
  const declarations: Array<Record<string, unknown>> = [];
  const currentYear = new Date().getUTCFullYear();
  const yearsToCover = new Set<number>([currentYear, currentYear - 1, currentYear + 1]);
  // also include years from activity_start_date
  if (company.activity_start_date) {
    const startYear = Number(company.activity_start_date.slice(0, 4));
    if (Number.isFinite(startYear)) {
      for (let y = startYear; y <= currentYear + 1; y++) yearsToCover.add(y);
    }
  }
  const sortedYears = Array.from(yearsToCover).sort((a, b) => b - a);

  for (const year of sortedYears) {
    for (const quarter of [1, 2, 3, 4] as QuarterCode[]) {
      const summary = buildQuarterlySummary(db, year, quarter);
      // Skip empty quarters before the activity start (no sales, no info)
      const isBeforeStart = company.activity_start_date && summary.periodEnd < company.activity_start_date.slice(0, 10);
      if (isBeforeStart && summary.includedSalesCount === 0 && summary.personalSalesCount === 0 && summary.preActivitySalesCount === 0) continue;

      // Sales included in this quarter
      const startIso = `${summary.periodStart}T00:00:00.000Z`;
      const endIso = `${summary.periodEnd}T23:59:59.999Z`;
      const includedSalesRows = db.prepare(
        `SELECT id, external_id, declared_encashment_date, article_name, sku, buyer_username, buyer_country, platform, declarable_amount
         FROM sales
         WHERE urssaf_declarable=1 AND classification='professional_resale'
           AND deleted_at IS NULL
           AND declared_encashment_date >= ? AND declared_encashment_date <= ?
         ORDER BY declared_encashment_date ASC`
      ).all(startIso, endIso) as Array<Record<string, unknown>>;
      const includedSales = anonymized
        ? includedSalesRows.map((r) => redactSaleRow(r, { maskBuyer: true, maskContact: true, maskUsername: true }))
        : includedSalesRows;

      // Récap PDF if exists (look for document with external_reference matching the convention)
      const recapDoc = db.prepare(
        `SELECT file_path FROM documents WHERE external_reference = ? AND deleted_at IS NULL`
      ).get(`recap_Q${quarter}_${year}`) as { file_path: string } | undefined;
      const recapEmbed = recapDoc ? tryEmbedFile(recapDoc.file_path) : null;

      // Actual declared (from declarations table)
      const declRow = db.prepare(
        `SELECT status, actual_declared_ca, actual_paid_contributions, declaration_date FROM declarations WHERE year=? AND quarter=? AND deleted_at IS NULL`
      ).get(year, quarter) as { status: string; actual_declared_ca: number | null; actual_paid_contributions: number | null; declaration_date: string | null } | undefined;

      declarations.push({
        ...summary,
        actual_declared_ca: declRow?.actual_declared_ca ?? null,
        actual_paid_contributions: declRow?.actual_paid_contributions ?? null,
        declaration_date: declRow?.declaration_date ?? null,
        included_sales: includedSales,
        recap_pdf: recapEmbed ? { base64: recapEmbed.base64, mime: recapEmbed.mime, size: recapEmbed.size } : null
      });
    }
  }

  const profitability: Array<Record<string, unknown>> = [];
  let profitabilityError: string | null = null;
  try {
    for (const year of sortedYears) {
      profitability.push({ year, quarter: 'all', ...buildProfitabilitySummary(db, year, 'all') });
      for (const quarter of [1, 2, 3, 4] as QuarterCode[]) {
        profitability.push({ year, quarter, ...buildProfitabilitySummary(db, year, quarter) });
      }
    }
  } catch (error) {
    profitabilityError = error instanceof Error ? error.message : String(error);
  }

  let agenda: unknown[] = [];
  let agendaError: string | null = null;
  try {
    agenda = db.prepare(
      `SELECT id, entry_date, note, tags, created_at, updated_at
       FROM diary_entries
       ORDER BY entry_date DESC, updated_at DESC
       LIMIT 500`
    ).all();
    if (anonymized) {
      agenda = (agenda as Array<Record<string, unknown>>).map((r) => redactDiaryRow(r, { maskBuyer: true, maskContact: true, maskUsername: true }));
    }
  } catch (error) {
    agendaError = error instanceof Error ? error.message : String(error);
  }

  // Top totals
  const totals = db.prepare(
    `SELECT
       (SELECT COALESCE(SUM(declarable_amount), 0) FROM sales WHERE urssaf_declarable=1 AND classification != 'pre_activity' AND deleted_at IS NULL) AS ca_urssaf_total,
       (SELECT COUNT(*) FROM sales WHERE status IN ('completed','colis_perdu') AND deleted_at IS NULL) AS sales_completed,
       (SELECT COUNT(*) FROM sales WHERE status IN ('shipped','processing') AND deleted_at IS NULL) AS in_transit,
       (SELECT COUNT(*) FROM sales WHERE status IN ('canceled','refunded') AND deleted_at IS NULL) AS cancellations,
       (SELECT COALESCE(SUM(amount_ttc), 0) FROM expenses WHERE deleted_at IS NULL) AS expenses_total,
       (SELECT COUNT(*) FROM stock_items WHERE quantity > 0 AND status IN ('in_stock','listed','reserved','received') AND deleted_at IS NULL) AS stock_count,
       (SELECT COALESCE(SUM(unit_cost_ttc * quantity), 0) FROM stock_items WHERE quantity > 0 AND status IN ('in_stock','listed','reserved','received') AND deleted_at IS NULL) AS stock_value
    `
  ).get() as Record<string, number>;

  const data = {
    schema_version: 'revendo-mobile-v2',
    generated_at: new Date().toISOString(),
    app_version: process.env.npm_package_version ?? '0.1.0',
    redaction_mode: anonymized ? 'anonymized' : 'full',
    encrypted: false,
    data_scope: options.dataScope ?? 'dashboard,sales,stock,expenses,urssaf,review,documents_metadata',
    generatedAt: new Date().toISOString(),
    company,
    totals,
    sales,
    purchases,
    expenses,
    stock,
    documents,
    declarations,
    profitability,
    agenda,
    profitability_error: profitabilityError,
    agenda_error: agendaError
  };

  const html = buildHtml(data);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html, 'utf-8');

  const stat = fs.statSync(outputPath);
  return { path: outputPath, size: stat.size, rowCount: sales.length + purchases.length + expenses.length };
}

function buildHtml(data: Record<string, unknown>): string {
  // Sanitize: escape </script> in any string value to prevent injection breaking the JSON.
  const safe = JSON.stringify(data).replace(/<\/script>/gi, '<\\/script>');

  return `<!doctype html><html lang="fr"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5">
<title>Revendo — Vue mobile</title>
<style>
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
:root {
  --midnight: #05060f;
  --white: #ffffff;
  --comet: #d8ecf8;
  --mist: #d1e4fa;
  --light: #b6d9fc;
  --azure: #c7d3ea;
  --slate: #3f4959;
  --muted: #9da7ba;
  --violet: #663af3;
  --faint: #81899b;
  --border: rgba(186, 215, 247, 0.12);
  --surface: rgba(186, 214, 247, 0.04);
  --glass: inset rgba(199, 211, 234, 0.12) 0 1px 1px 0,
    inset rgba(199, 211, 234, 0.05) 0 24px 48px 0,
    rgba(6, 6, 14, 0.7) 0 24px 32px 0;
}
html, body { margin: 0; padding: 0; }
body {
  font-family: Inter, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  background: radial-gradient(circle at 15% -8%, rgba(102,58,243,0.26), transparent 24rem),
    radial-gradient(circle at 95% 0%, rgba(182,217,252,0.12), transparent 22rem),
    linear-gradient(180deg, #070914 0%, var(--midnight) 48%, #03040a 100%);
  color: var(--comet);
  line-height: 1.45;
  padding-bottom: 78px;
}
header {
  background: rgba(5, 6, 15, 0.88);
  color: white;
  padding: 14px 16px;
  position: sticky;
  top: 0;
  z-index: 10;
  border-bottom: 1px solid var(--border);
  box-shadow: inset rgba(216,236,248,0.12) 0 1px 1px, rgba(0,0,0,0.35) 0 12px 32px;
  backdrop-filter: blur(16px);
}
header h1 { font-family: "Space Grotesk", Inter, sans-serif; font-size: 19px; margin: 0; letter-spacing: 0; }
header .sub { font-size: 11px; color: var(--faint); margin-top: 3px; }
.tabs {
  display: flex; overflow-x: auto; gap: 8px;
  background: rgba(5, 6, 15, 0.76);
  border-bottom: 1px solid var(--border);
  position: sticky; top: 54px; z-index: 9; padding: 8px 10px;
  backdrop-filter: blur(16px);
}
.tabs button {
  border: 1px solid transparent;
  padding: 9px 13px;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
  color: var(--mist);
  border-radius: 999px;
  background: transparent;
}
.tabs button.active {
  color: var(--white);
  border-color: rgba(216,236,248,0.22);
  background: rgba(186,214,247,0.09);
  box-shadow: rgba(186,207,247,0.24) 0 0 12px;
  font-weight: 600;
}
main { padding: 12px; }
section { display: none; }
section.active { display: block; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 13px; margin-bottom: 10px; box-shadow: var(--glass); backdrop-filter: blur(14px); }
.card-title { font-size: 11px; text-transform: uppercase; color: var(--faint); letter-spacing: 0; margin-bottom: 4px; }
.big { font-family: "Space Grotesk", Inter, sans-serif; font-size: 26px; font-weight: 700; color: var(--white); }
.row { display: flex; justify-content: space-between; align-items: center; padding: 9px 0; border-bottom: 1px solid rgba(186,215,247,0.1); gap: 8px; }
.row:last-child { border-bottom: none; }
.row-main { flex: 1; min-width: 0; }
.row-title { font-weight: 600; font-size: 14px; color: var(--white); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row-sub { font-size: 11px; color: var(--faint); margin-top: 2px; }
.row-amount { text-align: right; font-weight: 600; font-size: 14px; }
.pill { display: inline-block; padding: 3px 7px; border-radius: 999px; font-size: 10px; font-weight: 600; border: 1px solid var(--border); background: rgba(5,6,15,0.78); color: var(--mist); }
.pill-green, .pill-blue { color: var(--light); }
.pill-amber, .pill-orange { color: #f4d59e; }
.pill-red { color: #ff9d9d; }
.pill-slate { color: var(--mist); }
input[type="text"], input[type="search"], select { width: 100%; padding: 10px 12px; border: 1px solid var(--border);
       border-radius: 4px; font-size: 14px; background: rgba(199,211,234,0.06); color: var(--white); }
.filter-bar { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.filter-bar > * { flex: 1; min-width: 0; }
.empty { text-align: center; color: var(--faint); padding: 40px 20px; }
.empty .icon { font-size: 40px; margin-bottom: 8px; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.alert { background: rgba(186,214,247,0.055); color: var(--comet); padding: 10px; border-radius: 14px; font-size: 12px; margin-bottom: 10px; border: 1px solid var(--border); box-shadow: var(--glass); }
.alert-info { color: var(--light); }
.alert-ok { color: var(--light); }
.alert-error { color: #ffb4b4; border-color: rgba(255,157,157,0.28); background: rgba(255,157,157,0.08); }
footer { position: fixed; bottom: 0; left: 0; right: 0; background: rgba(5,6,15,0.9); border-top: 1px solid var(--border);
         padding: 9px 16px; font-size: 10px; color: var(--faint); text-align: center; backdrop-filter: blur(14px); }
.read-only { background: rgba(186,214,247,0.06); color: var(--mist); padding: 4px 9px; border-radius: 999px; font-size: 10px;
             font-weight: 600; display: inline-block; border: 1px solid var(--border); }
.count { color: var(--faint); font-size: 11px; margin-top: 4px; }
.btn { display: inline-block; padding: 8px 14px; border-radius: 999px; font-size: 13px; font-weight: 500;
       border: 1px solid var(--border); background: rgba(186,214,247,0.045); color: var(--mist); text-decoration: none; cursor: pointer; box-shadow: inset rgba(186,215,247,0.12) 0 0 0 1px; }
.btn-primary { background: var(--violet); color: white; border-color: rgba(255,255,255,0.16); box-shadow: rgba(102,58,243,0.32) 0 0 16px; }
.btn-primary:active { background: #7750f5; }
.btn-secondary:active { background: rgba(186,214,247,0.1); }
.btn-sm { padding: 6px 10px; font-size: 12px; }
.btn-group { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.first-decl-banner { background: rgba(186,214,247,0.055); border: 1px solid rgba(244,213,158,0.26);
                     padding: 10px; border-radius: 16px; margin-bottom: 12px; box-shadow: var(--glass); }
.first-decl-banner strong { color: #f4d59e; }
.first-decl-banner .label-pill { display:inline-block; padding:2px 8px; background:rgba(244,213,158,0.14); color:#f4d59e;
                                  border-radius:999px; font-size: 10px; font-weight:700; margin-right:6px; }
.due { font-weight: 700; }
.due-overridden { color: #f4d59e; }
.due-overridden small { text-decoration: line-through; opacity: 0.6; font-weight: normal; margin-left: 4px; }
.decl-detail { margin-top: 12px; }
.decl-sale-row { padding: 6px 0; border-bottom: 1px solid rgba(186,215,247,0.1); font-size: 12px; }
.decl-sale-row:last-child { border-bottom: none; }
.muted { color: var(--faint); }
@media (min-width: 640px) {
  main { max-width: 720px; margin: 0 auto; }
}

/* ---------- Invoice modal (Facture / Justificatif) ---------- */
#invoice-modal { position: fixed; inset: 0; background: var(--midnight); z-index: 100; overflow-y: auto; display: none; }
#invoice-modal.open { display: block; }
.invoice-actions { position: sticky; top: 0; background: rgba(5,6,15,0.94); color: white; padding: 10px 16px;
                    display: flex; gap: 8px; justify-content: space-between; align-items: center; z-index: 110; }
.invoice-actions .title { font-size: 13px; font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.invoice-actions button { padding: 8px 12px; border: none; border-radius: 999px; font-size: 13px; font-weight: 600; cursor: pointer; }
.invoice-actions .btn-print { background: var(--violet); color: white; }
.invoice-actions .btn-close { background: rgba(255,255,255,0.15); color: white; }
.invoice-page { max-width: 800px; margin: 16px auto; padding: 24px; color: var(--comet);
                 background:
                   radial-gradient(circle at 92% 0%, rgba(102,58,243,0.24), transparent 240px),
                   linear-gradient(180deg, #070914 0%, #05060f 58%, #03040a 100%);
                 border: 1px solid rgba(216,236,248,0.16); box-shadow: 0 22px 48px rgba(0,0,0,0.42);
                 border-radius: 22px; font-size: 11pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.invoice-page h1 { color: white; font-size: 20pt; line-height: 1.05; margin: 0 0 6px; }
.invoice-page h2 { color: white; font-size: 13pt; margin: 18px 0 8px; border-bottom: 1px solid rgba(216,236,248,0.16); padding-bottom: 6px; }
.invoice-page strong { color: white; }
.invoice-page .inv-muted { color: var(--faint); font-size: 10pt; }
.invoice-page .inv-row { display: flex; justify-content: space-between; gap: 16px; }
.invoice-page > .inv-row:first-child { padding: 16px; border: 1px solid rgba(216,236,248,0.16); border-radius: 18px;
                                        background: linear-gradient(135deg, rgba(102,58,243,0.22), rgba(186,214,247,0.06)); margin-bottom: 14px; }
.invoice-page .inv-box { border: 1px solid rgba(216,236,248,0.14); padding: 12px; border-radius: 14px; margin-bottom: 12px;
                         background: rgba(8,10,22,0.72); box-shadow: inset rgba(255,255,255,0.05) 0 1px 0; }
.invoice-page table.inv-table { width: 100%; border-collapse: separate; border-spacing: 0; margin: 8px 0;
                                 overflow: hidden; border: 1px solid rgba(216,236,248,0.12); border-radius: 14px; background: rgba(5,6,15,0.55); }
.invoice-page table.inv-table th, .invoice-page table.inv-table td {
  padding: 7px 8px; text-align: left; border-bottom: 1px solid rgba(216,236,248,0.1); font-size: 10.5pt;
}
.invoice-page table.inv-table tr:last-child td { border-bottom: 0; }
.invoice-page table.inv-table th { color: white; background: rgba(186,214,247,0.085); font-weight: 700; }
.invoice-page table.inv-table td { color: var(--mist); }
.invoice-page table.inv-table .inv-right { text-align: right; }
.invoice-page table.inv-table .inv-total { color: white; font-weight: 800; background: linear-gradient(90deg, rgba(102,58,243,0.24), rgba(182,217,252,0.08)); }
.invoice-page table.inv-table .inv-total td { color: white; }
.invoice-page .inv-mention { color: #fff4cf; background: rgba(245,158,11,0.14); padding: 9px 11px;
                              border-left: 4px solid #f6c96f; border-radius: 12px; font-size: 10.5pt; margin: 12px 0; }
.invoice-page .inv-mention.green { color: #dffbea; background: rgba(22,163,74,0.16); border-left-color: #33d69f; }
.invoice-page .inv-footer { color: var(--faint); font-size: 9pt; margin-top: 18px; padding-top: 10px; border-top: 1px solid rgba(216,236,248,0.12); }

@media print {
  body { background: #05060f; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  header, .tabs, footer, main { display: none !important; }
  #invoice-modal { position: static !important; }
  .invoice-actions { display: none !important; }
  .invoice-page { box-shadow: none; max-width: none; margin: 0; padding: 0; border-radius: 0; border: 0; }
  @page { size: A4; margin: 12mm; }
}
</style>
</head>
<body>
<header>
  <h1>Revendo <span class="read-only">LECTURE SEULE</span></h1>
  <div class="sub" id="gen-info"></div>
</header>
<div class="tabs">
  <button class="active" data-tab="dashboard">📊 Tableau</button>
  <button data-tab="sales">🛍️ Ventes</button>
  <button data-tab="purchases">🧾 Achats</button>
  <button data-tab="expenses">💸 Dépenses</button>
  <button data-tab="stock">📦 Stock</button>
  <button data-tab="profitability">📈 Rentabilité</button>
  <button data-tab="agenda">📅 Agenda</button>
  <button data-tab="docs">📄 Documents</button>
  <button data-tab="urssaf">🇫🇷 URSSAF</button>
</div>
<main>
  <section id="dashboard" class="active"></section>
  <section id="sales"></section>
  <section id="purchases"></section>
  <section id="expenses"></section>
  <section id="stock"></section>
  <section id="profitability"></section>
  <section id="agenda"></section>
  <section id="docs"></section>
  <section id="urssaf"></section>
</main>
<footer>📱 Mode lecture seule · Modifications uniquement sur PC · Synchronisé via Google Drive</footer>
<div id="invoice-modal">
  <div class="invoice-actions">
    <span class="title" id="invoice-title">Facture</span>
    <button class="btn-print" onclick="printInvoice()">🖨️ Imprimer / PDF</button>
    <button class="btn-close" onclick="closeInvoice()">✕ Fermer</button>
  </div>
  <div id="invoice-body"></div>
</div>
<script>
const DATA = ${safe};

// ---------- Helpers ----------
const eur = (n) => (n == null || !Number.isFinite(Number(n))) ? '—' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(n));
const fmt = (iso) => { if (!iso) return '—'; const s = String(iso).slice(0,10); const m = s.match(/^(\\d{4})-(\\d{2})-(\\d{2})$/); return m ? m[3]+'/'+m[2]+'/'+m[1] : s; };
const fmtDateTime = (iso) => { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleString('fr-FR'); };
const pct = (n) => new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 2 }).format(n);

function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function escapeAttr(s) { return escapeHtml(s); }

document.getElementById('gen-info').textContent =
  'Snapshot du ' + fmtDateTime(DATA.generatedAt) + ' · ' + DATA.sales.length + ' ventes, ' + DATA.purchases.length + ' achats, ' + DATA.expenses.length + ' dépenses, ' + DATA.stock.length + ' stock';

// ---------- Tabs ----------
document.querySelectorAll('.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('section').forEach((s) => s.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById(tab).classList.add('active');
    renderTab(tab);
  });
});

// ---------- Download via data URL ----------
function downloadDataUri(base64, mime, filename) {
  const link = document.createElement('a');
  link.href = 'data:' + mime + ';base64,' + base64;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
function downloadText(content, mime, filename) {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ---------- Invoice generation (client-side, print-to-PDF) ----------
function buildFactureVente(sale) {
  const c = DATA.company;
  const isPro = sale.urssaf_declarable === 1 && sale.classification === 'professional_resale';
  const isFranchise = (c.vat_regime || 'franchise_en_base') === 'franchise_en_base';
  const num = sale.external_id || ('M-' + sale.id);
  const date = (sale.declared_encashment_date || sale.sale_date || new Date().toISOString()).slice(0, 10);
  const totalTtc = sale.amount_received || 0;
  const tva = (sale.vat_amount || 0);
  const totalHt = totalTtc - tva;
  const docTitle = isPro ? ('Facture n° ' + num) : ('Note de cession n° ' + num);

  return {
    title: docTitle,
    filename: (isPro ? 'facture_' : 'note_cession_') + String(num).replace(/[^a-zA-Z0-9._-]/g, '_') + '.pdf',
    html:
      '<div class="invoice-page">'
      + '<div class="inv-row">'
      +   '<div>'
      +     '<h1>' + escapeHtml(docTitle) + '</h1>'
      +     '<div class="inv-muted">' + (isPro ? 'Facture' : 'Note de cession') + ' · ' + fmt(date) + '</div>'
      +   '</div>'
      +   '<div class="inv-muted" style="text-align:right">'
      +     '<strong>' + escapeHtml((c.commercial_name || (c.first_name + ' ' + c.last_name)).trim()) + '</strong><br>'
      +     escapeHtml(c.address || '') + '<br>'
      +     (c.siret ? 'SIRET : ' + escapeHtml(c.siret) + '<br>' : '')
      +   '</div>'
      + '</div>'
      + '<div class="inv-box">'
      +   '<strong>Acheteur :</strong> '
      +   (sale.buyer_username ? escapeHtml(sale.buyer_username) : '<em>(anonyme — vente plateforme)</em>')
      +   (sale.buyer_country ? ' — ' + escapeHtml(sale.buyer_country) : '')
      +   (sale.platform ? '<div class="inv-muted">via ' + escapeHtml(sale.platform) + '</div>' : '')
      + '</div>'
      + '<h2>Article</h2>'
      + '<table class="inv-table">'
      +   '<thead><tr><th>Description</th><th>SKU</th><th class="inv-right">Qté</th>'
      +     (isFranchise ? '' : '<th class="inv-right">HT</th><th class="inv-right">TVA</th>')
      +     '<th class="inv-right">' + (isFranchise ? 'Total' : 'TTC') + '</th></tr></thead>'
      +   '<tbody>'
      +     '<tr>'
      +       '<td>' + escapeHtml(sale.article_name || '') + '</td>'
      +       '<td>' + escapeHtml(sale.sku || '—') + '</td>'
      +       '<td class="inv-right">' + (sale.quantity || 1) + '</td>'
      +       (isFranchise ? '' : '<td class="inv-right">' + eur(totalHt) + '</td><td class="inv-right">' + eur(tva) + '</td>')
      +       '<td class="inv-right">' + eur(totalTtc) + '</td>'
      +     '</tr>'
      +     '<tr class="inv-total">'
      +       '<td colspan="' + (isFranchise ? '3' : '5') + '" class="inv-right">Total</td>'
      +       '<td class="inv-right">' + eur(totalTtc) + '</td>'
      +     '</tr>'
      +   '</tbody>'
      + '</table>'
      + (isPro && isFranchise ? '<div class="inv-mention"><strong>TVA non applicable</strong>, art. 293 B du CGI.<br>Régime de la micro-entreprise — franchise en base de TVA.</div>' : '')
      + (!isPro ? '<div class="inv-mention"><strong>Vente d\\'un bien personnel</strong> — hors activité professionnelle.<br>Cette transaction ne fait pas partie du chiffre d\\'affaires de la micro-entreprise et n\\'est pas soumise à TVA ni à cotisations URSSAF.</div>' : '')
      + (sale.vinted_fees ? '<p class="inv-muted">Frais plateforme : ' + eur(sale.vinted_fees) + ' (déjà déduits du montant encaissé).</p>' : '')
      + (sale.tracking_number ? '<p class="inv-muted">Suivi : ' + escapeHtml(sale.carrier || '') + ' ' + escapeHtml(sale.tracking_number) + '</p>' : '')
      + '<div class="inv-footer">Document généré par Revendo le ' + fmt(new Date().toISOString()) + '.' + (isPro ? '' : ' Vente entre particuliers (non commerciale).') + '</div>'
      + '</div>'
  };
}

function buildJustificatifAchat(purchase) {
  const c = DATA.company;
  const ref = purchase.external_id || ('M-' + purchase.id);
  const date = (purchase.payment_date || new Date().toISOString()).slice(0, 10);
  const platform = purchase.platform || purchase.source || 'Inconnu';
  const isVinted = (platform.toLowerCase().includes('vinted') || purchase.source === 'vinteer');
  const isWhatNot = platform.toLowerCase().includes('whatnot');
  const sourceLabel = isVinted ? 'Vinted (achat entre particuliers)' :
                       isWhatNot ? 'WhatNot (achat via live shopping)' :
                       platform;

  return {
    title: 'Justificatif achat n° ' + ref,
    filename: 'justificatif_achat_' + String(ref).replace(/[^a-zA-Z0-9._-]/g, '_') + '.pdf',
    html:
      '<div class="invoice-page">'
      + '<div class="inv-row">'
      +   '<div>'
      +     '<h1>Justificatif d\\'achat</h1>'
      +     '<div class="inv-muted">Référence : <strong>' + escapeHtml(ref) + '</strong> · Source : ' + escapeHtml(sourceLabel) + '</div>'
      +     '<div class="inv-muted">Date d\\'achat : <strong>' + fmt(date) + '</strong></div>'
      +   '</div>'
      +   '<div class="inv-muted" style="text-align:right">'
      +     '<strong>Acheteur (vous)</strong><br>'
      +     escapeHtml((c.commercial_name || (c.first_name + ' ' + c.last_name)).trim()) + '<br>'
      +     (c.siret ? 'SIRET : ' + escapeHtml(c.siret) + '<br>' : '')
      +     escapeHtml(c.address || '')
      +   '</div>'
      + '</div>'
      + '<h2>Vendeur</h2>'
      + '<div class="inv-box">'
      +   '<strong>' + escapeHtml(purchase.seller || '(anonyme — vendeur particulier sur ' + platform + ')') + '</strong><br>'
      +   (purchase.platform ? 'Plateforme : ' + escapeHtml(purchase.platform) : '')
      +   (isVinted ? '<div class="inv-muted">Vinted ne fournit pas l\\'identité légale du vendeur particulier. L\\'identifiant ci-dessus est le pseudo public.</div>' : '')
      + '</div>'
      + '<h2>Article(s) acheté(s)</h2>'
      + '<table class="inv-table">'
      +   '<thead><tr><th>Description</th><th class="inv-right">Qté</th><th class="inv-right">Prix articles</th><th class="inv-right">Port</th><th class="inv-right">Total TTC</th></tr></thead>'
      +   '<tbody>'
      +     '<tr>'
      +       '<td>' + escapeHtml(purchase.articles || '—') + '</td>'
      +       '<td class="inv-right">' + (purchase.quantity || 1) + '</td>'
      +       '<td class="inv-right">' + eur(purchase.items_price) + '</td>'
      +       '<td class="inv-right">' + eur(purchase.shipping_fee) + '</td>'
      +       '<td class="inv-right">' + eur(purchase.total_ttc) + '</td>'
      +     '</tr>'
      +     '<tr class="inv-total"><td colspan="4" class="inv-right">Total payé</td><td class="inv-right">' + eur(purchase.total_ttc) + '</td></tr>'
      +   '</tbody>'
      + '</table>'
      + '<div class="inv-mention green"><strong>Régime fiscal de l\\'acheteur :</strong> Micro-entreprise — Franchise en base de TVA<br>Mention : <em>"TVA non applicable, art. 293 B du CGI"</em>. Aucune TVA récupérable sur cet achat.</div>'
      + '<div class="inv-mention"><strong>Document interne reconstitué depuis les données de la plateforme ' + escapeHtml(platform) + '.</strong> Ce justificatif consigne les informations nécessaires en cas de contrôle fiscal pour démontrer la provenance du stock acheté en vue de la revente dans le cadre de l\\'activité de micro-entrepreneur achat-revente (BIC).'
      +   (isVinted ? ' Sur Vinted, les vendeurs particuliers ne fournissent pas de facture : ce document tient lieu de justificatif de la transaction.' : '')
      + '</div>'
      + '<div class="inv-footer">Document généré par Revendo le ' + fmt(new Date().toISOString()) + '. Référence interne achat #' + purchase.id + ' · Statut : ' + escapeHtml(purchase.status || 'inconnu') + '.</div>'
      + '</div>'
  };
}

function openInvoice(invoice) {
  document.getElementById('invoice-title').textContent = invoice.title;
  document.getElementById('invoice-body').innerHTML = invoice.html;
  document.getElementById('invoice-modal').classList.add('open');
  document.body.dataset.printName = invoice.filename;
  window.scrollTo(0, 0);
}
function closeInvoice() {
  document.getElementById('invoice-modal').classList.remove('open');
  document.getElementById('invoice-body').innerHTML = '';
  delete document.body.dataset.printName;
}
function printInvoice() {
  const filename = document.body.dataset.printName || 'facture';
  const originalTitle = document.title;
  document.title = filename.replace(/\\.pdf$/i, '');
  window.print();
  setTimeout(() => { document.title = originalTitle; }, 500);
}

// ---------- Classification helper ----------
function classLabel(cls) {
  const m = {
    professional_resale: ['Pro / revente', 'pill-green'],
    personal_item: ['Personnel', 'pill-slate'],
    uncertain_to_review: ['À revoir', 'pill-amber'],
    excluded: ['Annulée', 'pill-red'],
    pre_activity: ['Avant début', 'pill-orange']
  };
  const [l, c] = m[cls] || ['—', 'pill-slate'];
  return '<span class="pill ' + c + '">' + l + '</span>';
}

function saleStatusLabel(st) {
  const m = {
    completed: ['Complétée', 'pill-green'],
    colis_perdu: ['Colis perdu indemnisé', 'pill-blue'],
    shipped: ['Expédiée', 'pill-amber'],
    processing: ['En cours', 'pill-amber'],
    pending: ['En attente', 'pill-amber'],
    canceled: ['Annulée', 'pill-red'],
    refunded: ['Remboursée', 'pill-red']
  };
  const [l, c] = m[st] || [st || '—', 'pill-slate'];
  return '<span class="pill ' + c + '">' + escapeHtml(l) + '</span>';
}

// ---------- Dashboard ----------
function renderDashboard() {
  const t = DATA.totals;
  const c = DATA.company;
  const html = '<div class="card">'
    + '<div class="card-title">Chiffre d\\'affaires URSSAF (depuis toujours)</div>'
    + '<div class="big" style="color:#15803d">' + eur(t.ca_urssaf_total) + '</div>'
    + '<div class="count">' + t.sales_completed + ' ventes encaissées</div>'
    + '</div>'
    + '<div class="grid-2">'
    +   '<div class="card"><div class="card-title">En expédition</div><div class="big" style="color:#b45309">' + (t.in_transit || 0) + '</div></div>'
    +   '<div class="card"><div class="card-title">Annulations</div><div class="big" style="color:#dc2626">' + (t.cancellations || 0) + '</div></div>'
    +   '<div class="card"><div class="card-title">Stock à la maison</div><div class="big" style="color:#0369a1">' + (t.stock_count || 0) + '</div><div class="count">' + eur(t.stock_value) + ' (valeur coût)</div></div>'
    +   '<div class="card"><div class="card-title">Dépenses totales</div><div class="big" style="color:#dc2626">' + eur(t.expenses_total) + '</div></div>'
    + '</div>'
    + '<div class="card">'
    +   '<div class="card-title">Entreprise</div>'
    +   '<div style="font-weight:600">' + escapeHtml((c.commercial_name || (c.first_name + ' ' + c.last_name)).trim()) + '</div>'
    +   (c.siret ? '<div class="row-sub">SIRET : ' + escapeHtml(c.siret) + '</div>' : '')
    +   (c.activity_start_date ? '<div class="row-sub">Début activité : ' + fmt(c.activity_start_date) + '</div>' : '')
    +   '<div class="row-sub">Régime : Franchise en base de TVA</div>'
    + '</div>'
    + '<div class="alert alert-info">📱 Cette vue est <strong>en lecture seule</strong>. Pour modifier, utilisez Revendo sur PC.</div>';
  document.getElementById('dashboard').innerHTML = html;
}

// ---------- Sales ----------
function renderSales(search = '', cls = 'all', status = 'all') {
  const root = document.getElementById('sales');
  const q = search.trim().toLowerCase();
  const filtered = DATA.sales.filter((s) => {
    if (cls !== 'all' && s.classification !== cls) return false;
    if (status !== 'all' && s.status !== status) return false;
    if (q) {
      const txt = (s.article_name + ' ' + (s.buyer_username || '') + ' ' + (s.sku || '') + ' ' + (s.external_id || '')).toLowerCase();
      if (!txt.includes(q)) return false;
    }
    return true;
  });
  const totalAmt = filtered.filter((s) => s.urssaf_declarable === 1).reduce((sum, s) => sum + (s.declarable_amount || 0), 0);

  let html = '<div class="filter-bar">'
    + '<input type="search" id="sales-search" placeholder="🔍 Recherche…" value="' + escapeAttr(search) + '">'
    + '<select id="sales-class">'
    +   '<option value="all">Tout type</option>'
    +   '<option value="professional_resale">Pro / revente</option>'
    +   '<option value="personal_item">Personnel</option>'
    +   '<option value="pre_activity">Avant début</option>'
    +   '<option value="uncertain_to_review">À revoir</option>'
    +   '<option value="excluded">Annulées</option>'
    + '</select>'
    + '<select id="sales-status">'
    +   '<option value="all">Tout statut</option>'
    +   '<option value="completed">Complétée</option>'
    +   '<option value="colis_perdu">Colis perdu indemnisé</option>'
    +   '<option value="shipped">Expédiée</option>'
    +   '<option value="processing">En cours</option>'
    +   '<option value="canceled">Annulée</option>'
    +   '<option value="refunded">Remboursée</option>'
    + '</select>'
    + '</div>'
    + '<div class="card"><div class="card-title">CA filtré (déclarable)</div><div class="big" style="color:#15803d">' + eur(totalAmt) + '</div><div class="count">' + filtered.length + ' / ' + DATA.sales.length + ' ventes</div></div>';

  if (filtered.length === 0) {
    html += '<div class="empty"><div class="icon">🛍️</div>Aucune vente avec ces filtres.</div>';
  } else {
    html += '<div class="card">' + filtered.slice(0, 200).map((s, i) => (
      '<div style="padding:8px 0;border-bottom:1px solid #f1f5f9">'
      + '<div class="row" style="border-bottom:none;padding-bottom:4px">'
      +   '<div class="row-main">'
      +     '<div class="row-title">' + escapeHtml(s.article_name || '') + '</div>'
      +     '<div class="row-sub">'
      +       fmt(s.declared_encashment_date || s.sale_date) + ' · ' + escapeHtml(s.platform || '?') + ' · ' + escapeHtml(s.buyer_username || 'anonyme')
      +       '<br>' + classLabel(s.classification) + ' ' + saleStatusLabel(s.status)
      +     '</div>'
      +   '</div>'
      +   '<div class="row-amount">'
      +     (s.urssaf_declarable === 1 ? eur(s.declarable_amount) : '<span class="muted">—</span>')
      +   '</div>'
      + '</div>'
      + '<div class="btn-group" style="margin-top:6px"><button class="btn btn-primary btn-sm" data-facture="' + i + '">🧾 Facture PDF</button></div>'
      + '</div>'
    )).join('') + '</div>';
    if (filtered.length > 200) html += '<div class="empty">+ ' + (filtered.length - 200) + ' ventes non affichées. Affinez les filtres.</div>';
  }
  root.innerHTML = html;
  document.getElementById('sales-search').addEventListener('input', (e) => renderSales(e.target.value, document.getElementById('sales-class').value, document.getElementById('sales-status').value));
  document.getElementById('sales-class').value = cls;
  document.getElementById('sales-status').value = status;
  document.getElementById('sales-class').addEventListener('change', (e) => renderSales(document.getElementById('sales-search').value, e.target.value, document.getElementById('sales-status').value));
  document.getElementById('sales-status').addEventListener('change', (e) => renderSales(document.getElementById('sales-search').value, document.getElementById('sales-class').value, e.target.value));
  // Facture buttons
  document.querySelectorAll('[data-facture]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.facture);
      const sale = filtered[idx];
      if (sale) openInvoice(buildFactureVente(sale));
    });
  });
}

// ---------- Purchases / Expenses (basic) ----------
function renderPurchases(search = '') {
  const root = document.getElementById('purchases');
  const q = search.trim().toLowerCase();
  const filtered = DATA.purchases.filter((p) => !q || (((p.seller || '') + ' ' + (p.articles || '') + ' ' + (p.platform || '')).toLowerCase().includes(q)));
  const total = filtered.reduce((sum, p) => sum + (p.total_ttc || 0), 0);
  let html = '<div class="filter-bar"><input type="search" id="p-search" placeholder="🔍 Vendeur, articles, plateforme…" value="' + escapeAttr(search) + '"></div>'
    + '<div class="card"><div class="card-title">Total filtré</div><div class="big" style="color:#b45309">' + eur(total) + '</div><div class="count">' + filtered.length + ' achats</div></div>';
  if (filtered.length === 0) html += '<div class="empty"><div class="icon">🧾</div>Aucun achat.</div>';
  else html += '<div class="card">' + filtered.slice(0, 200).map((p, i) => (
    '<div style="padding:8px 0;border-bottom:1px solid #f1f5f9">'
    + '<div class="row" style="border-bottom:none;padding-bottom:4px">'
    +   '<div class="row-main">'
    +     '<div class="row-title">' + escapeHtml(p.articles || '') + '</div>'
    +     '<div class="row-sub">' + fmt(p.payment_date) + ' · ' + escapeHtml(p.platform || p.source || '?') + ' · ' + escapeHtml(p.seller || '?') + '</div>'
    +   '</div>'
    +   '<div class="row-amount">' + eur(p.total_ttc) + '</div>'
    + '</div>'
    + '<div class="btn-group" style="margin-top:6px"><button class="btn btn-primary btn-sm" data-justif="' + i + '">🧾 Justificatif PDF</button></div>'
    + '</div>'
  )).join('') + '</div>';
  root.innerHTML = html;
  document.getElementById('p-search').addEventListener('input', (e) => renderPurchases(e.target.value));
  // Justificatif buttons
  document.querySelectorAll('[data-justif]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.justif);
      const purchase = filtered[idx];
      if (purchase) openInvoice(buildJustificatifAchat(purchase));
    });
  });
}

function renderExpenses(search = '') {
  const root = document.getElementById('expenses');
  const q = search.trim().toLowerCase();
  const filtered = DATA.expenses.filter((e) => !q || (((e.description || '') + ' ' + (e.supplier || '') + ' ' + e.category).toLowerCase().includes(q)));
  const total = filtered.reduce((sum, e) => sum + (e.amount_ttc || 0), 0);
  let html = '<div class="filter-bar"><input type="search" id="e-search" placeholder="🔍 Description, fournisseur, catégorie…" value="' + escapeAttr(search) + '"></div>'
    + '<div class="card"><div class="card-title">Total filtré</div><div class="big" style="color:#dc2626">' + eur(total) + '</div><div class="count">' + filtered.length + ' dépenses</div></div>';
  if (filtered.length === 0) html += '<div class="empty"><div class="icon">💸</div>Aucune dépense.</div>';
  else html += '<div class="card">' + filtered.slice(0, 200).map((e) => (
    '<div class="row">'
    + '<div class="row-main">'
    +   '<div class="row-title">' + escapeHtml(e.description || e.category) + '</div>'
    +   '<div class="row-sub">' + fmt(e.date) + ' · <span class="pill pill-slate">' + escapeHtml(e.category) + '</span> · ' + escapeHtml(e.supplier || '') + '</div>'
    + '</div>'
    + '<div class="row-amount">' + eur(e.amount_ttc) + '</div>'
    + '</div>'
  )).join('') + '</div>';
  root.innerHTML = html;
  document.getElementById('e-search').addEventListener('input', (e) => renderExpenses(e.target.value));
}

// ---------- Stock ----------
function statusLabel(st) {
  const m = {
    in_stock: ['À la maison','pill-blue'], listed: ['Publié','pill-amber'], reserved: ['Réservé','pill-orange'],
    sold_pending: ['Vendu en attente','pill-amber'], sold_completed: ['Vendu','pill-green'],
    received: ['Reçu','pill-blue'], donated: ['Donné','pill-slate'], gifted: ['Offert','pill-slate'],
    personal_use: ['Usage perso','pill-slate'], lost: ['Perdu','pill-red'], returned: ['Retourné','pill-slate']
  };
  const [l, c] = m[st] || [st, 'pill-slate'];
  return '<span class="pill ' + c + '">' + l + '</span>';
}

function renderStock(search = '', status = 'all') {
  const root = document.getElementById('stock');
  const q = search.trim().toLowerCase();
  const filtered = DATA.stock.filter((s) => {
    if (status !== 'all' && s.status !== status) return false;
    if (!q) return true;
    return ((s.name || '') + ' ' + (s.sku || '') + ' ' + (s.brand || '') + ' ' + (s.internal_code || '') + ' ' + (s.location || '')).toLowerCase().includes(q);
  });
  const totalQty = filtered.reduce((sum, s) => sum + (s.quantity || 0), 0);
  const totalCost = filtered.reduce((sum, s) => sum + ((s.unit_cost_ttc || 0) * (s.quantity || 0)), 0);

  let html = '<div class="filter-bar">'
    + '<input type="search" id="st-search" placeholder="🔍 Nom, SKU, marque, emplacement…" value="' + escapeAttr(search) + '">'
    + '<select id="st-status">'
    +   '<option value="all">Tout statut</option>'
    +   '<option value="in_stock">À la maison</option>'
    +   '<option value="listed">Publié</option>'
    +   '<option value="reserved">Réservé</option>'
    +   '<option value="sold_pending">Vendu en attente</option>'
    +   '<option value="sold_completed">Vendu</option>'
    + '</select>'
    + '</div>'
    + '<div class="grid-2">'
    +   '<div class="card"><div class="card-title">Articles affichés</div><div class="big" style="color:#0369a1">' + totalQty + '</div><div class="count">' + filtered.length + ' lignes</div></div>'
    +   '<div class="card"><div class="card-title">Valeur (coût)</div><div class="big">' + eur(totalCost) + '</div></div>'
    + '</div>';

  if (filtered.length === 0) html += '<div class="empty"><div class="icon">📦</div>Aucun article.</div>';
  else html += '<div class="card">' + filtered.slice(0, 200).map((s) => (
    '<div class="row">'
    + '<div class="row-main">'
    +   '<div class="row-title">' + escapeHtml(s.name || '') + ' ' + (s.quantity > 1 ? '<span class="pill pill-slate">x' + s.quantity + '</span>' : '') + '</div>'
    +   '<div class="row-sub">'
    +     '<span class="muted">' + escapeHtml(s.internal_code) + '</span>'
    +     (s.sku ? ' · SKU ' + escapeHtml(s.sku) : '')
    +     (s.brand ? ' · ' + escapeHtml(s.brand) : '')
    +     (s.size ? ' · taille ' + escapeHtml(s.size) : '')
    +     (s.color ? ' · ' + escapeHtml(s.color) : '')
    +     (s.location ? ' · 📍 ' + escapeHtml(s.location) : '')
    +     '<br>' + statusLabel(s.status)
    +   '</div>'
    + '</div>'
    + '<div class="row-amount">' + eur(s.unit_cost_ttc) + '<br><span class="muted" style="font-size:10px;font-weight:normal">' + (s.estimated_sale_price ? '→ ' + eur(s.estimated_sale_price) : '') + '</span></div>'
    + '</div>'
  )).join('') + '</div>';

  root.innerHTML = html;
  document.getElementById('st-search').addEventListener('input', (e) => renderStock(e.target.value, document.getElementById('st-status').value));
  document.getElementById('st-status').value = status;
  document.getElementById('st-status').addEventListener('change', (e) => renderStock(document.getElementById('st-search').value, e.target.value));
}

// ---------- Rentabilité ----------
function profitYears() {
  return Array.from(new Set((DATA.profitability || []).map((p) => p.year))).sort((a, b) => b - a);
}
function profitQuarters() {
  return [
    ['all', 'Année entière'],
    [1, 'T1'],
    [2, 'T2'],
    [3, 'T3'],
    [4, 'T4']
  ];
}
function renderProfitability(year, quarter) {
  const root = document.getElementById('profitability');
  const years = profitYears();
  if (!DATA.profitability || DATA.profitability.length === 0 || years.length === 0) {
    root.innerHTML = (DATA.profitability_error ? '<div class="alert alert-error">⚠️ Rentabilité indisponible dans ce snapshot : ' + escapeHtml(DATA.profitability_error) + '</div>' : '')
      + '<div class="empty"><div class="icon">📈</div>Aucune donnée de rentabilité.</div>';
    return;
  }
  const selectedYear = year || years[0];
  const selectedQuarter = quarter == null ? 'all' : quarter;
  const s = DATA.profitability.find((p) => String(p.year) === String(selectedYear) && String(p.quarter) === String(selectedQuarter))
    || DATA.profitability.find((p) => String(p.year) === String(selectedYear))
    || DATA.profitability[0];
  const maxVal = Math.max(1, s.caKeptActual || 0, (s.cogs || 0) + (s.cogsUnlinked || 0), s.boostsTotal || 0, s.expensesTotal || 0, Math.abs(s.margeReelleEstimee || 0));
  const bar = (label, value, color) => {
    const width = Math.min(100, ((Math.abs(value || 0) / maxVal) * 100));
    return '<div style="margin:8px 0">'
      + '<div class="row-sub" style="display:flex;justify-content:space-between;margin-bottom:4px"><span>' + escapeHtml(label) + '</span><strong>' + eur(value) + '</strong></div>'
      + '<div style="height:10px;border-radius:999px;background:rgba(186,214,247,0.08);overflow:hidden;border:1px solid var(--border)">'
      + '<div style="height:100%;width:' + width + '%;background:' + color + ';border-radius:999px"></div>'
      + '</div>'
      + '</div>';
  };
  const productRows = (items) => {
    if (!items || items.length === 0) return '<div class="muted" style="font-size:12px">Aucune donnée.</div>';
    return items.slice(0, 6).map((p) => (
      '<div class="row">'
      + '<div class="row-main"><div class="row-title">' + escapeHtml(p.name || '—') + '</div><div class="row-sub">CA ' + eur(p.ca) + ' · coût ' + eur(p.cogs) + '</div></div>'
      + '<div class="row-amount" style="color:' + ((p.margin || 0) >= 0 ? '#33d69f' : '#ff9d9d') + '">' + eur(p.margin) + '</div>'
      + '</div>'
    )).join('');
  };

  root.innerHTML = '<div class="filter-bar">'
    + '<select id="profit-year">' + years.map((y) => '<option value="' + y + '">' + y + '</option>').join('') + '</select>'
    + '<select id="profit-quarter">' + profitQuarters().map((q) => '<option value="' + q[0] + '">' + q[1] + '</option>').join('') + '</select>'
    + '</div>'
    + '<div class="alert alert-info">📌 Le CA URSSAF ne déduit pas les dépenses. La rentabilité est une estimation interne.</div>'
    + '<div class="grid-2">'
    +   '<div class="card"><div class="card-title">CA URSSAF</div><div class="big" style="color:#33d69f">' + eur(s.caUrssaf) + '</div><div class="count">Ventes pro déclarables</div></div>'
    +   '<div class="card"><div class="card-title">Argent reçu</div><div class="big">' + eur(s.caKeptActual) + '</div><div class="count">Pro + personnel + avant début</div></div>'
    +   '<div class="card"><div class="card-title">Ventes personnelles</div><div class="big" style="font-size:20px">' + eur(s.personalSalesAmount) + '</div><div class="count">Hors CA URSSAF</div></div>'
    +   '<div class="card"><div class="card-title">Marge estimée</div><div class="big" style="color:' + ((s.margeReelleEstimee || 0) >= 0 ? '#33d69f' : '#ff9d9d') + '">' + eur(s.margeReelleEstimee) + '</div></div>'
    + '</div>'
    + '<div class="card"><div class="card-title">Décomposition</div>'
    +   bar('Argent reçu', s.caKeptActual, 'linear-gradient(90deg,#33d69f,#b6d9fc)')
    +   bar('Coût stock vendu', (s.cogs || 0) + (s.cogsUnlinked || 0), 'linear-gradient(90deg,#ff9d9d,#ef4444)')
    +   bar('Boosts marketing', s.boostsTotal || 0, 'linear-gradient(90deg,#c084fc,#663af3)')
    +   bar('Autres dépenses', s.expensesTotal || 0, 'linear-gradient(90deg,#f4d59e,#f59e0b)')
    + '</div>'
    + '<div class="card"><div class="card-title">Top produits</div>' + productRows(s.topProducts) + '</div>'
    + '<div class="card"><div class="card-title">Produits en perte</div>' + productRows(s.lossProducts) + '</div>'
    + '<div class="card"><div class="card-title">Par plateforme</div>'
    + ((s.byPlatform || []).slice(0, 8).map((p) => '<div class="row"><span>' + escapeHtml(p.platform || '—') + '</span><strong>' + eur(p.ca) + '</strong></div>').join('') || '<div class="muted">Aucune donnée.</div>')
    + '</div>';

  document.getElementById('profit-year').value = selectedYear;
  document.getElementById('profit-quarter').value = selectedQuarter;
  document.getElementById('profit-year').addEventListener('change', (e) => renderProfitability(e.target.value, document.getElementById('profit-quarter').value));
  document.getElementById('profit-quarter').addEventListener('change', (e) => renderProfitability(document.getElementById('profit-year').value, e.target.value));
}

// ---------- Agenda ----------
function agendaYears() {
  const years = Array.from(new Set((DATA.agenda || []).map((e) => String(e.entry_date || '').slice(0, 4)).filter(Boolean))).sort((a, b) => Number(b) - Number(a));
  return years.length ? years : [String(new Date().getFullYear())];
}
function icsDate(iso) {
  return String(iso || '').slice(0, 10).replace(/-/g, '');
}
function icsEscape(s) {
  const bs = String.fromCharCode(92);
  return String(s == null ? '' : s)
    .split(bs).join(bs + bs)
    .split(';').join(bs + ';')
    .split(',').join(bs + ',')
    .split(String.fromCharCode(13) + String.fromCharCode(10)).join(bs + 'n')
    .split(String.fromCharCode(10)).join(bs + 'n')
    .split(String.fromCharCode(13)).join(bs + 'n');
}
function buildAgendaIcs(entries) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Revendo//Agenda mobile//FR', 'CALSCALE:GREGORIAN'];
  entries.forEach((e) => {
    const start = icsDate(e.entry_date);
    if (!start) return;
    const endDate = new Date(String(e.entry_date).slice(0, 10) + 'T00:00:00.000Z');
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    const end = endDate.toISOString().slice(0, 10).replace(/-/g, '');
    const nowIso = new Date().toISOString();
    const stamp = nowIso.split('.')[0].replace(/-/g, '').replace(/:/g, '') + 'Z';
    const description = (e.note || '') + (e.tags ? String.fromCharCode(10) + String.fromCharCode(10) + 'Tags: ' + e.tags : '');
    lines.push('BEGIN:VEVENT');
    lines.push('UID:revendo-agenda-' + e.id + '@local');
    lines.push('DTSTAMP:' + stamp);
    lines.push('DTSTART;VALUE=DATE:' + start);
    lines.push('DTEND;VALUE=DATE:' + end);
    lines.push('SUMMARY:' + icsEscape(String(e.note || '').split('\\n')[0].slice(0, 90) || 'Note Revendo'));
    lines.push('DESCRIPTION:' + icsEscape(description));
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\\r\\n');
}
function renderAgenda(search = '', year = 'all', month = 'all') {
  const root = document.getElementById('agenda');
  const q = search.trim().toLowerCase();
  const years = agendaYears();
  const filtered = (DATA.agenda || []).filter((e) => {
    const d = String(e.entry_date || '').slice(0, 10);
    if (year !== 'all' && d.slice(0, 4) !== String(year)) return false;
    if (month !== 'all' && d.slice(5, 7) !== String(month).padStart(2, '0')) return false;
    if (q && !((e.note || '') + ' ' + (e.tags || '')).toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => String(a.entry_date).localeCompare(String(b.entry_date)));

  root.innerHTML = (DATA.agenda_error ? '<div class="alert alert-error">⚠️ Agenda indisponible dans ce snapshot : ' + escapeHtml(DATA.agenda_error) + '</div>' : '')
    + '<div class="filter-bar">'
    + '<input type="search" id="ag-search" placeholder="🔍 Recherche note, tag…" value="' + escapeAttr(search) + '">'
    + '<select id="ag-year"><option value="all">Toutes années</option>' + years.map((y) => '<option value="' + y + '">' + y + '</option>').join('') + '</select>'
    + '<select id="ag-month"><option value="all">Tous mois</option>'
    + ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'].map((m, i) => '<option value="' + String(i + 1).padStart(2, '0') + '">' + m + '</option>').join('')
    + '</select></div>'
    + '<div class="card"><div class="card-title">Notes affichées</div><div class="big">' + filtered.length + '</div><div class="btn-group"><button class="btn btn-primary btn-sm" id="ag-ics">📤 Télécharger .ics</button></div></div>'
    + (filtered.length === 0
      ? '<div class="empty"><div class="icon">📅</div>Aucune note d\\'agenda.</div>'
      : '<div class="card">' + filtered.slice(0, 200).map((e) => (
          '<div class="row">'
          + '<div class="row-main"><div class="row-title">' + fmt(e.entry_date) + '</div>'
          + '<div class="row-sub">' + escapeHtml(e.tags || 'sans tag') + '</div>'
          + '<div style="font-size:13px;margin-top:5px;white-space:pre-wrap">' + escapeHtml(e.note || '') + '</div></div>'
          + '</div>'
        )).join('') + '</div>');

  document.getElementById('ag-search').addEventListener('input', (e) => renderAgenda(e.target.value, document.getElementById('ag-year').value, document.getElementById('ag-month').value));
  document.getElementById('ag-year').value = year;
  document.getElementById('ag-month').value = month;
  document.getElementById('ag-year').addEventListener('change', (e) => renderAgenda(document.getElementById('ag-search').value, e.target.value, document.getElementById('ag-month').value));
  document.getElementById('ag-month').addEventListener('change', (e) => renderAgenda(document.getElementById('ag-search').value, document.getElementById('ag-year').value, e.target.value));
  document.getElementById('ag-ics').addEventListener('click', () => downloadText(buildAgendaIcs(filtered), 'text/calendar', 'agenda_revendo.ics'));
}

// ---------- Documents (with embedded base64 download) ----------
function docTypeLabel(t) {
  const m = {
    facture_vente: '🧾 Facture vente', facture_achat: '🧾 Facture achat',
    ticket_caisse: '🎫 Ticket', justificatif_urssaf: '🇫🇷 Justif URSSAF',
    facture_boost: '📣 Boost', export_vinteer: '📥 Export Vinteer',
    export_whatnot: '📥 Export WhatNot', autre: '📄 Autre'
  };
  return m[t] || '📄 ' + (t || 'doc');
}

function renderDocs(search = '', type = 'all') {
  const root = document.getElementById('docs');
  const q = search.trim().toLowerCase();
  const filtered = DATA.documents.filter((d) => {
    if (type !== 'all' && d.document_type !== type) return false;
    if (q && !((d.original_file_name + ' ' + (d.supplier_or_customer || '') + ' ' + (d.external_reference || '')).toLowerCase().includes(q))) return false;
    return true;
  });

  const embeddedCount = filtered.filter((d) => d.embed).length;

  let html = '<div class="alert alert-info">📥 ' + embeddedCount + ' fichier(s) sur ' + filtered.length + ' intégrés directement. Pour garder la page mobile rapide, les autres restent accessibles dans Google Drive ▸ <strong>Revendo Backups</strong> ▸ <strong>documents/</strong>.</div>'
    + '<div class="filter-bar">'
    +   '<input type="search" id="d-search" placeholder="🔍 Nom fichier, fournisseur…" value="' + escapeAttr(search) + '">'
    +   '<select id="d-type">'
    +     '<option value="all">Tous types</option>'
    +     '<option value="facture_vente">Facture vente</option>'
    +     '<option value="facture_achat">Facture achat (justif. achats)</option>'
    +     '<option value="ticket_caisse">Reçu / ticket caisse</option>'
    +     '<option value="justificatif_urssaf">Justificatif URSSAF</option>'
    +     '<option value="autre">Autre</option>'
    +   '</select>'
    + '</div>';

  if (filtered.length === 0) html += '<div class="empty"><div class="icon">📄</div>Aucun document.</div>';
  else html += filtered.slice(0, 100).map((d, i) => {
    const fileName = d.original_file_name || ('document_' + d.id);
    return '<div class="card">'
      + '<div class="row" style="border-bottom:none;padding-bottom:4px">'
      +   '<div class="row-main">'
      +     '<div class="row-title">' + escapeHtml(fileName) + '</div>'
      +     '<div class="row-sub">'
      +       fmt(d.date) + ' · ' + docTypeLabel(d.document_type)
      +       (d.supplier_or_customer ? ' · ' + escapeHtml(d.supplier_or_customer) : '')
      +     '</div>'
      +   '</div>'
      +   (d.amount != null ? '<div class="row-amount">' + eur(d.amount) + '</div>' : '')
      + '</div>'
      + '<div class="btn-group">'
      +   (d.embed
            ? '<button class="btn btn-primary btn-sm" data-dl="' + i + '">📥 Télécharger (' + Math.round(d.embed.size / 1024) + ' KB)</button>'
            : '<span class="muted" style="font-size:11px">Non intégré au snapshot mobile pour éviter une page trop lourde. Ouvrez Drive ▸ documents/' + escapeHtml(d.relative_path || '?') + '</span>'
          )
      + '</div>'
      + '</div>';
  }).join('');

  root.innerHTML = html;
  document.getElementById('d-search').addEventListener('input', (e) => renderDocs(e.target.value, document.getElementById('d-type').value));
  document.getElementById('d-type').value = type;
  document.getElementById('d-type').addEventListener('change', (e) => renderDocs(document.getElementById('d-search').value, e.target.value));
  // wire download buttons
  document.querySelectorAll('[data-dl]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.dl);
      const d = filtered[idx];
      if (d && d.embed) downloadDataUri(d.embed.base64, d.embed.mime, d.original_file_name || ('document_' + d.id + '.pdf'));
    });
  });
}

// ---------- URSSAF (with first-declaration display + CSV + récap PDF) ----------
function csvEscape(v) {
  const s = String(v == null ? '' : v);
  if (s.includes(';') || s.includes('"') || s.includes('\\n')) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function buildLivreCsv(decl) {
  const lines = [];
  lines.push(['Date encaissement','Numéro pièce / ID','Client','Origine / plateforme','Description','Montant encaissé (€)','Mode paiement','Statut','Document justificatif','Notes'].map(csvEscape).join(';'));
  for (const s of decl.included_sales) {
    lines.push([
      fmt(s.declared_encashment_date),
      s.external_id || '',
      s.buyer_username || '',
      s.platform || '',
      String(s.article_name || '').slice(0, 200),
      Number(s.declarable_amount || 0).toFixed(2).replace('.', ','),
      'Virement plateforme', 'completed', '', ''
    ].map(csvEscape).join(';'));
  }
  const total = decl.included_sales.reduce((sum, s) => sum + (s.declarable_amount || 0), 0);
  lines.push('');
  lines.push(['','','','','TOTAL', total.toFixed(2).replace('.', ','), '', '', '', ''].map(csvEscape).join(';'));
  lines.push('');
  lines.push(csvEscape('Période interne URSSAF : ' + fmt(decl.periodStart) + ' → ' + fmt(decl.periodEnd) + '. Échéance : ' + fmt(decl.dueDate) + '. Document généré depuis la vue mobile Revendo.'));
  // BOM + lines
  return '\\ufeff' + lines.join('\\n');
}

function renderUrssaf() {
  const root = document.getElementById('urssaf');
  if (DATA.declarations.length === 0) {
    root.innerHTML = '<div class="empty"><div class="icon">🇫🇷</div>Aucune déclaration calculée.</div>';
    return;
  }

  root.innerHTML = '<div class="alert alert-info">📊 Vue informationnelle. Pour déclarer officiellement : <strong>autoentrepreneur.urssaf.fr</strong>.</div>'
    + DATA.declarations.map((d, idx) => {
      const isFirst = d.isFirstDeclaration;
      const dueOverridden = d.dueDate !== d.rawDueDate;
      const cotisDisplayed = d.contributionsApplied || d.contributionsAcre || d.contributionsNormal;

      return '<div class="card">'
        + '<div style="display:flex;justify-content:space-between;align-items:start;gap:8px">'
        +   '<div style="flex:1;min-width:0">'
        +     '<div style="font-weight:700;font-size:18px">Q' + d.quarter + ' ' + d.year
        +       (isFirst ? ' <span class="pill" style="background:#9a3412;color:white">1ère déclaration</span>' : '')
        +     '</div>'
        +     '<div class="row-sub" style="margin-top:4px">Période URSSAF : <strong>' + fmt(d.periodStart) + ' → ' + fmt(d.periodEnd) + '</strong></div>'
        +     '<div class="row-sub" style="margin-top:2px">Échéance : <span class="due ' + (dueOverridden ? 'due-overridden' : '') + '">' + fmt(d.dueDate) + (dueOverridden ? ' <small>(au lieu du ' + fmt(d.rawDueDate) + ' standard)</small>' : '') + '</span></div>'
        +     (d.firstDeclarationLabel ? '<div class="first-decl-banner" style="margin-top:8px"><strong>' + escapeHtml(d.firstDeclarationLabel) + '</strong></div>' : '')
        +   '</div>'
        +   (d.status === 'declared' ? '<span class="pill pill-green">Déclaré</span>' : '<span class="pill pill-amber">Brouillon</span>')
        + '</div>'

        + '<div class="grid-2" style="margin-top:10px">'
        +   '<div>'
        +     '<div class="card-title">CA déclarable</div>'
        +     '<div class="big" style="font-size:20px;color:#15803d">' + eur(d.caGoods) + '</div>'
        +     '<div class="count">' + d.includedSalesCount + ' ventes pro</div>'
        +   '</div>'
        +   '<div>'
        +     '<div class="card-title">Cotisations estimées'
        +       (d.acreFullPeriod ? ' <span class="pill pill-blue">ACRE</span>' : d.acreApplied ? ' <span class="pill pill-blue">ACRE partiel</span>' : ' <span class="pill pill-slate">normal</span>')
        +     '</div>'
        +     '<div class="big" style="font-size:20px;color:#b45309">' + eur(cotisDisplayed) + '</div>'
        +     '<div class="count">Réf. ACRE ' + pct(d.rateAcre) + ' / normal ' + pct(d.rateNormal) + '</div>'
        +   '</div>'
        + '</div>'

        + '<div class="row-sub" style="margin-top:10px;font-size:11px">'
        +   '<strong>Exclues du CA :</strong> '
        +   d.preActivitySalesCount + ' avant début (' + eur(d.preActivitySalesAmount) + ')'
        +   ' · ' + d.personalSalesCount + ' personnelles (' + eur(d.personalSalesAmount) + ')'
        +   ' · ' + d.uncertainSalesCount + ' à revoir'
        +   ' · ' + d.canceledSalesCount + ' annulées'
        + '</div>'

        + (d.actual_declared_ca != null ? (
            '<div class="row" style="margin-top:10px;padding-top:10px;border-top:1px solid #e2e8f0">'
            + '<span>CA réellement déclaré (le ' + fmt(d.declaration_date) + ')</span>'
            + '<strong>' + eur(d.actual_declared_ca) + '</strong>'
            + '</div>'
            + (d.actual_paid_contributions != null ? '<div class="row"><span>Cotisations payées</span><strong>' + eur(d.actual_paid_contributions) + '</strong></div>' : '')
          ) : '')

        + '<div class="btn-group">'
        +   '<button class="btn btn-primary btn-sm" data-csv="' + idx + '">📄 Télécharger Livre des recettes (CSV)</button>'
        +   (d.recap_pdf
              ? '<button class="btn btn-sm" data-recap="' + idx + '">📑 Télécharger Récap PDF</button>'
              : '<span class="muted" style="font-size:11px;align-self:center">Récap PDF : générer sur PC d\\'abord</span>'
            )
        + '</div>'
        + '</div>';
    }).join('');

  // Wire CSV downloads
  document.querySelectorAll('[data-csv]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.csv);
      const d = DATA.declarations[idx];
      const csv = buildLivreCsv(d);
      downloadText(csv, 'text/csv', 'livre_recettes_' + d.year + '_Q' + d.quarter + '.csv');
    });
  });
  // Wire récap PDF downloads
  document.querySelectorAll('[data-recap]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.recap);
      const d = DATA.declarations[idx];
      if (d.recap_pdf) downloadDataUri(d.recap_pdf.base64, d.recap_pdf.mime, 'recap_URSSAF_Q' + d.quarter + '_' + d.year + '.pdf');
    });
  });
}

// ---------- Router ----------
function showRenderError(tab, error) {
  const root = document.getElementById(tab);
  if (root) {
    root.innerHTML = '<div class="alert alert-error">⚠️ Impossible de charger cette section. Régénérez la vue mobile depuis Réglages, puis réessayez.<br><small>' + escapeHtml(error && error.message ? error.message : error) + '</small></div>';
  }
  console.error(error);
}
function renderTab(tab) {
  try {
    if (tab === 'dashboard') renderDashboard();
    else if (tab === 'sales') renderSales();
    else if (tab === 'purchases') renderPurchases();
    else if (tab === 'expenses') renderExpenses();
    else if (tab === 'stock') renderStock();
    else if (tab === 'profitability') renderProfitability();
    else if (tab === 'agenda') renderAgenda();
    else if (tab === 'docs') renderDocs();
    else if (tab === 'urssaf') renderUrssaf();
  } catch (error) {
    showRenderError(tab, error);
  }
}

renderTab('dashboard');
</script>
</body></html>`;
}
