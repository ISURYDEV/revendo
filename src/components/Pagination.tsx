export interface PaginationState {
  page: number;        // 0-indexed
  pageSize: number;
}

export default function Pagination({
  total, page, pageSize, onChange
}: {
  total: number;
  page: number;
  pageSize: number;
  onChange: (next: PaginationState) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-slate-500">{from}-{to} sur {total}</span>
      <div className="flex gap-1">
        <button className="btn-secondary text-xs" disabled={page === 0} onClick={() => onChange({ page: 0, pageSize })}>«</button>
        <button className="btn-secondary text-xs" disabled={page === 0} onClick={() => onChange({ page: page - 1, pageSize })}>‹</button>
        <span className="px-3 py-1 bg-slate-100 rounded">{page + 1} / {totalPages}</span>
        <button className="btn-secondary text-xs" disabled={page >= totalPages - 1} onClick={() => onChange({ page: page + 1, pageSize })}>›</button>
        <button className="btn-secondary text-xs" disabled={page >= totalPages - 1} onClick={() => onChange({ page: totalPages - 1, pageSize })}>»</button>
      </div>
      <select className="border rounded px-2 py-1 text-xs" value={pageSize} onChange={(e) => onChange({ page: 0, pageSize: Number(e.target.value) })}>
        <option value="25">25 / page</option>
        <option value="50">50 / page</option>
        <option value="100">100 / page</option>
        <option value="500">500 / page</option>
      </select>
    </div>
  );
}

export function paginate<T>(items: T[], state: PaginationState): T[] {
  const start = state.page * state.pageSize;
  return items.slice(start, start + state.pageSize);
}
