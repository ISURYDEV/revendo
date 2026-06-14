export type SortDirection = 'asc' | 'desc';
export type SortValueType = 'date' | 'number' | 'string';

function normalizeSortValue(value: unknown, type: SortValueType): string | number | null {
  if (value == null || value === '') return null;

  if (type === 'number') {
    const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  if (type === 'date') {
    const t = new Date(String(value)).getTime();
    return Number.isFinite(t) ? t : null;
  }

  return String(value).toLocaleLowerCase('fr-FR');
}

export function sortRows<T>(
  rows: T[],
  getValue: (row: T) => unknown,
  direction: SortDirection,
  type: SortValueType = 'string'
): T[] {
  const factor = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = normalizeSortValue(getValue(a), type);
    const bv = normalizeSortValue(getValue(b), type);

    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av < bv) return -1 * factor;
    if (av > bv) return 1 * factor;
    return 0;
  });
}
