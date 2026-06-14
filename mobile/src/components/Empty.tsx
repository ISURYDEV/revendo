import { Link } from 'react-router-dom';

export function Empty({ title, hint, ctaTo, ctaLabel }: { title: string; hint?: string; ctaTo?: string; ctaLabel?: string }) {
  return (
    <div className="card text-center text-slate-500 py-8">
      <div className="text-2xl mb-2">📭</div>
      <div className="font-medium text-slate-700">{title}</div>
      {hint && <div className="text-xs mt-2">{hint}</div>}
      {ctaTo && ctaLabel && (
        <Link to={ctaTo} className="btn-primary inline-block mt-3">{ctaLabel}</Link>
      )}
    </div>
  );
}
