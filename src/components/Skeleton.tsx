export function Skeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`bg-slate-200 animate-pulse rounded ${className}`} style={style} />;
}

export function SkeletonCard({ height = 80 }: { height?: number }) {
  return (
    <div className="card p-4">
      <Skeleton className="h-3 w-1/3 mb-2" />
      <Skeleton className="w-2/3" style={{ height: `${height}px` }} />
    </div>
  );
}

export function SkeletonRow() {
  return (
    <tr>
      <td colSpan={20} className="p-2">
        <Skeleton className="h-4 w-full" />
      </td>
    </tr>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="card overflow-hidden">
      <div className="p-3 bg-slate-100"><Skeleton className="h-4 w-1/4" /></div>
      <div className="p-3 space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    </div>
  );
}
