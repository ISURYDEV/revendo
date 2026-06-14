import type { ReactNode } from 'react';

export function Modal({
  title,
  onClose,
  children,
  size = 'md'
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const widthClass = size === 'sm' ? 'w-[420px]' : size === 'lg' ? 'w-[760px]' : 'w-[560px]';
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className={`bg-white rounded-lg shadow-xl ${widthClass} max-w-[95vw] max-h-[90vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center px-5 py-3 border-b border-slate-200 sticky top-0 bg-white">
          <h2 className="text-lg font-bold">{title}</h2>
          <button className="text-slate-400 hover:text-slate-700 text-xl leading-none" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
  hint
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
      {children}
      {hint && <div className="text-xs text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full border border-slate-300 rounded px-2 py-1.5 text-sm ${props.className ?? ''}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select
      {...props}
      className={`w-full border border-slate-300 rounded px-2 py-1.5 text-sm ${props.className ?? ''}`}
    >
      {props.children}
    </select>
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full border border-slate-300 rounded px-2 py-1.5 text-sm ${props.className ?? ''}`}
    />
  );
}
