import fs from 'node:fs';
import pdfParse from 'pdf-parse';

export interface ExtractedMetadata {
  text: string;
  date: string | null;          // ISO YYYY-MM-DD if found
  amount: number | null;        // largest "amount-looking" number in €
  candidates: { amounts: number[]; dates: string[] };
}

/**
 * Light-weight OCR-by-heuristic for PDFs of invoices/tickets.
 * pdf-parse extracts the text layer (no image OCR — that would need tesseract).
 *  - dates: matches dd/mm/yyyy, yyyy-mm-dd, "1er janvier 2026" etc.
 *  - amounts: matches "12,50 €", "€ 12,50", "12.50 EUR" — returns the LARGEST as best-guess total.
 */
export async function extractPdfMetadata(filePath: string): Promise<ExtractedMetadata> {
  if (!fs.existsSync(filePath)) throw new Error('Fichier introuvable : ' + filePath);
  const buf = fs.readFileSync(filePath);
  const parsed = await pdfParse(buf);
  const text = parsed.text ?? '';

  // Dates
  const datePatterns: RegExp[] = [
    /\b(\d{4})-(\d{2})-(\d{2})\b/g,
    /\b(\d{2})\/(\d{2})\/(\d{4})\b/g,
    /\b(\d{2})-(\d{2})-(\d{4})\b/g
  ];
  const dates: string[] = [];
  for (const re of datePatterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[1].length === 4) {
        dates.push(`${m[1]}-${m[2]}-${m[3]}`);
      } else {
        dates.push(`${m[3]}-${m[2]}-${m[1]}`);
      }
    }
  }
  // Pick earliest plausible date as document date (heuristic: usually printed near the top)
  const firstDate = dates[0] ?? null;

  // Amounts: "12,50 €", "12.50 EUR", "€ 12,50"
  const amounts: number[] = [];
  const amtPatterns: RegExp[] = [
    /(\d{1,3}(?:[ .]\d{3})*(?:[.,]\d{2}))\s*€/g,
    /€\s*(\d{1,3}(?:[ .]\d{3})*(?:[.,]\d{2}))/g,
    /(\d{1,3}(?:[ .]\d{3})*(?:[.,]\d{2}))\s*EUR/gi
  ];
  for (const re of amtPatterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const raw = m[1].replace(/[ .](?=\d{3}\b)/g, '').replace(',', '.');
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0 && n < 100000) amounts.push(n);
    }
  }
  amounts.sort((a, b) => b - a);

  return {
    text: text.slice(0, 4000),
    date: firstDate,
    amount: amounts[0] ?? null,
    candidates: { amounts, dates }
  };
}
