export function eur(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
}

export function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 2 }).format(n);
}

/** DD/MM/YYYY from any ISO-like string. Returns '—' if invalid. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = String(iso).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** DD/MM/YYYY HH:mm from any ISO-like string. */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = String(iso);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return shortDate(iso);
  return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
}

/** Convert DD/MM/YYYY string to ISO YYYY-MM-DD (for HTML date inputs). */
export function frToIso(fr: string): string {
  const m = fr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return fr;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Today as YYYY-MM-DD (for HTML date inputs). */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
