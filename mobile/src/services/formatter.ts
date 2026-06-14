export function eur(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return iso;
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
}

export function bytes(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n > 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
  if (n > 1024) return `${(n / 1024).toFixed(0)} Ko`;
  return `${n} o`;
}
