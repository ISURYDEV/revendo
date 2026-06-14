import Papa from 'papaparse';
import fs from 'node:fs';
import crypto from 'node:crypto';

export interface ParseResult {
  headers: string[];
  rows: Record<string, string>[];
  separator: string;
  encoding: string;
  totalRows: number;
  rawSampleText: string;
}

/**
 * Read a CSV file from disk, auto-detecting separator (; , \t), UTF-8 BOM,
 * and returning rows as Record<header, raw string>. We deliberately keep
 * values as strings here; numeric/date coercion happens per-importer.
 */
export function parseCsvFile(filePath: string): ParseResult {
  const buf = fs.readFileSync(filePath);
  let encoding = 'utf-8';
  let content: string;

  // Strip UTF-8 BOM if present
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    encoding = 'utf-8-bom';
    content = buf.subarray(3).toString('utf-8');
  } else {
    content = buf.toString('utf-8');
  }

  const separator = detectSeparator(content);

  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    delimiter: separator,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
    transform: (v) => (typeof v === 'string' ? v.trim() : v)
  });

  return {
    headers: parsed.meta.fields ?? [],
    rows: (parsed.data ?? []).filter((r) => Object.values(r).some((v) => v !== '' && v != null)),
    separator,
    encoding,
    totalRows: parsed.data?.length ?? 0,
    rawSampleText: content.slice(0, 4096)
  };
}

function detectSeparator(content: string): string {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? '';
  const counts = {
    ';': (firstLine.match(/;/g) ?? []).length,
    ',': (firstLine.match(/,/g) ?? []).length,
    '\t': (firstLine.match(/\t/g) ?? []).length,
    '|': (firstLine.match(/\|/g) ?? []).length
  };
  const winner = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return winner?.[1] && winner[1] > 0 ? winner[0] : ',';
}

/** Compute SHA-256 of a file for dedup detection. */
export function hashFile(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Parse a French-formatted number: "1.234,56" or "1234,56" or "1234.56" or "11,6" → 1234.56.
 * Returns null for empty/invalid input.
 */
export function parseFrenchNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (s === '' || s === '-') return null;
  // Strip currency symbols and spaces
  s = s.replace(/[€$£\s ]/g, '');
  if (s === '') return null;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // Assume "1.234,56" — dot=thousands, comma=decimal
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    // "11,6" or "1,234" — French decimal
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a French date string. Accepts:
 *  - "2026-03-24 07:44:14" (ISO-like, Vinteer style)
 *  - "2026-03-24"
 *  - "24/03/2026"
 *  - "24-03-2026"
 *  - "2026-05-21 17:29 (UTC)" (WhatNot style)
 * Returns ISO 8601 UTC string, or null.
 */
export function parseFrenchDate(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (s === '') return null;
  // strip trailing parens "(UTC)"
  s = s.replace(/\s*\([^)]+\)\s*$/, '');

  // ISO-like 2026-03-24 [HH:mm[:ss]]
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const [, y, mo, d, hh = '00', mm = '00', ss = '00'] = m;
    const date = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss));
    return date.toISOString();
  }
  // dd/mm/yyyy or dd-mm-yyyy
  m = s.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const [, d, mo, y, hh = '00', mm = '00', ss = '00'] = m;
    const date = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss));
    return date.toISOString();
  }
  // Fallback: native parse
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
