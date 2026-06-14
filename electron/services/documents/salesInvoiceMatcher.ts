import type Database from 'better-sqlite3';
import { extractPdfMetadata, type ExtractedMetadata } from '../ocr/pdfMetadata';
import { linkDocument } from './storage';

interface DocumentRow {
  id: number;
  file_path: string;
  date: string | null;
  amount: number | null;
}

interface SaleCandidate {
  id: number;
  sku: string;
  article_name: string | null;
  buyer_username: string | null;
  declared_encashment_date: string | null;
  sale_date: string | null;
  amount_received: number | null;
}

function normalizeSku(s: string): string {
  return s.trim().toUpperCase();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function extractSkusFromText(text: string, knownSkus: string[] = []): string[] {
  const found: string[] = [];
  const patterns = [
    /\bSKU\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})\b/gi,
    /\bR[ée]f[ée]rence\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})\b/gi,
    /\bReference\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})\b/gi
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      found.push(normalizeSku(m[1]));
    }
  }

  const upper = text.toUpperCase();
  for (const sku of knownSkus) {
    const s = normalizeSku(sku);
    if (s.length >= 3 && upper.includes(s)) found.push(s);
  }

  return unique(found).slice(0, 20);
}

function clearCandidates(db: Database.Database, documentId: number): void {
  db.prepare(`DELETE FROM document_match_candidates WHERE document_id=? AND match_type='sale_invoice_sku'`).run(documentId);
}

function saleCandidates(db: Database.Database, sku: string): SaleCandidate[] {
  return db.prepare(
    `SELECT id, sku, article_name, buyer_username, declared_encashment_date, sale_date, amount_received
     FROM sales
     WHERE upper(trim(sku))=upper(trim(?))
     ORDER BY declared_encashment_date DESC, id DESC`
  ).all(sku) as SaleCandidate[];
}

function scoreSale(db: Database.Database, doc: DocumentRow, sale: SaleCandidate): number {
  let score = 80;
  if (doc.amount != null && sale.amount_received != null && Math.abs(doc.amount - sale.amount_received) < 0.05) {
    score += 15;
  }
  const saleDate = sale.declared_encashment_date ?? sale.sale_date;
  if (doc.date && saleDate) {
    const delta = db.prepare(`SELECT julianday(?) - julianday(?) AS d`).get(doc.date.slice(0, 10), saleDate.slice(0, 10)) as { d: number | null };
    const diff = Math.abs(delta.d ?? Number.NaN);
    if (Number.isFinite(diff) && diff <= 7) score += 10;
  }
  return score;
}

function insertCandidate(db: Database.Database, documentId: number, sale: SaleCandidate, score: number): void {
  db.prepare(
    `INSERT INTO document_match_candidates (document_id, entity_type, entity_id, match_type, confidence, score, reasons_json)
     VALUES (?, 'sale', ?, 'sale_invoice_sku', ?, ?, ?)
     ON CONFLICT(document_id, entity_type, entity_id, match_type)
     DO UPDATE SET confidence=excluded.confidence, score=excluded.score, reasons_json=excluded.reasons_json, status='candidate'`
  ).run(documentId, sale.id, score >= 95 ? 'high' : 'medium', score, JSON.stringify({
    sku: sale.sku,
    article: sale.article_name,
    reason: 'Facture de vente rapprochée par SKU'
  }));
}

export async function matchSalesInvoiceBySku(
  db: Database.Database,
  documentId: number,
  metadata?: ExtractedMetadata
): Promise<{ status: 'matched' | 'ambiguous' | 'unmatched'; skus: string[]; linkedSales: number[]; candidates: number }> {
  const doc = db.prepare(`SELECT id, file_path, date, amount FROM documents WHERE id=?`).get(documentId) as DocumentRow | undefined;
  if (!doc) throw new Error('Document introuvable');

  const meta = metadata ?? (doc.file_path.toLowerCase().endsWith('.pdf') ? await extractPdfMetadata(doc.file_path) : null);
  const known = (db.prepare(`SELECT DISTINCT sku FROM sales WHERE sku IS NOT NULL AND trim(sku) != ''`).all() as { sku: string }[])
    .map((r) => r.sku);
  const skus = meta ? extractSkusFromText(meta.text, known) : [];

  clearCandidates(db, documentId);
  db.prepare(
    `UPDATE documents
     SET extracted_sku=?,
         extracted_metadata_json=?,
         date=COALESCE(date, ?),
         amount=COALESCE(amount, ?),
         updated_at=datetime('now')
     WHERE id=?`
  ).run(
    skus.join(',') || null,
    meta ? JSON.stringify({ date: meta.date, amount: meta.amount, candidates: meta.candidates }) : null,
    meta?.date ?? null,
    meta?.amount ?? null,
    documentId
  );

  if (skus.length === 0) {
    db.prepare(`UPDATE documents SET match_status='unmatched', match_confidence='low' WHERE id=?`).run(documentId);
    return { status: 'unmatched', skus, linkedSales: [], candidates: 0 };
  }

  const linkedSales: number[] = [];
  const allCandidates: Array<{ sale: SaleCandidate; score: number }> = [];
  let ambiguous = false;

  for (const sku of skus) {
    const candidates = saleCandidates(db, sku).map((sale) => ({ sale, score: scoreSale(db, { ...doc, date: meta?.date ?? doc.date, amount: meta?.amount ?? doc.amount }, sale) }));
    if (candidates.length === 1 && candidates[0].score >= 80) {
      linkDocument(db, { document_id: documentId, entity_type: 'sale', entity_id: candidates[0].sale.id });
      linkedSales.push(candidates[0].sale.id);
    } else if (candidates.length > 1) {
      ambiguous = true;
      allCandidates.push(...candidates);
    }
  }

  if (ambiguous) {
    for (const c of allCandidates) insertCandidate(db, documentId, c.sale, c.score);
    db.prepare(`UPDATE documents SET match_status='ambiguous', match_confidence='medium' WHERE id=?`).run(documentId);
    return { status: 'ambiguous', skus, linkedSales, candidates: allCandidates.length };
  }

  if (linkedSales.length > 0) {
    db.prepare(`UPDATE documents SET match_status='matched', match_confidence='high' WHERE id=?`).run(documentId);
    return { status: 'matched', skus, linkedSales, candidates: linkedSales.length };
  }

  db.prepare(`UPDATE documents SET match_status='unmatched', match_confidence='low' WHERE id=?`).run(documentId);
  return { status: 'unmatched', skus, linkedSales: [], candidates: 0 };
}
