import type { ReactNode } from 'react';

interface Action { label: string; onClick: () => void; primary?: boolean }

export default function EmptyState({
  icon = '📭',
  title,
  description,
  actions
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  actions?: Action[];
}) {
  return (
    <div className="card p-10 text-center">
      <div className="text-5xl mb-3">{icon}</div>
      <div className="text-lg font-semibold text-slate-700">{title}</div>
      {description && <div className="text-sm text-slate-500 mt-1 max-w-md mx-auto">{description}</div>}
      {actions && actions.length > 0 && (
        <div className="flex gap-2 justify-center mt-4">
          {actions.map((a, i) => (
            <button key={i} className={a.primary ? 'btn-primary' : 'btn-secondary'} onClick={a.onClick}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
