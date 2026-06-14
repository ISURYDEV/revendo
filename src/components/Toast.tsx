import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

type ToastKind = 'success' | 'error' | 'info' | 'warning';
interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

interface ToastContextValue {
  push: (kind: ToastKind, title: string, message?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let _id = 0;
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((kind: ToastKind, title: string, message?: string) => {
    const id = ++_id;
    setItems((prev) => [...prev, { id, kind, title, message }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  useEffect(() => {
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: ToastKind; title?: string; message?: string }>).detail;
      push(detail?.kind ?? 'info', detail?.title ?? 'Revendo', detail?.message);
    };
    window.addEventListener('revendo:toast', onToast);
    return () => window.removeEventListener('revendo:toast', onToast);
  }, [push]);
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="fixed top-4 right-4 space-y-2 z-[60] max-w-sm">
        {items.map((t) => (
          <div key={t.id} className={
            `card p-3 shadow-lg border-l-4 ${
              t.kind === 'success' ? 'border-emerald-500 bg-emerald-50' :
              t.kind === 'error'   ? 'border-red-500 bg-red-50' :
              t.kind === 'warning' ? 'border-amber-500 bg-amber-50' :
                                     'border-sky-500 bg-sky-50'
            }`
          }>
            <div className="flex justify-between gap-3">
              <div>
                <div className="font-semibold text-sm">{t.title}</div>
                {t.message && <div className="text-xs text-slate-600 mt-0.5">{t.message}</div>}
              </div>
              <button onClick={() => setItems((p) => p.filter((x) => x.id !== t.id))} className="text-slate-400 hover:text-slate-700">×</button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be inside ToastProvider');
  return {
    success: (title: string, message?: string) => ctx.push('success', title, message),
    error: (title: string, message?: string) => ctx.push('error', title, message),
    info: (title: string, message?: string) => ctx.push('info', title, message),
    warning: (title: string, message?: string) => ctx.push('warning', title, message)
  };
}

// Confirmation dialog as React component (replaces window.confirm)
interface ConfirmState { open: boolean; title: string; message: string; onYes: () => void; danger?: boolean }
const ConfirmContext = createContext<((opts: { title: string; message: string; danger?: boolean }) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState>({ open: false, title: '', message: '', onYes: () => {} });
  const [resolver, setResolver] = useState<((v: boolean) => void) | null>(null);

  const confirm = useCallback((opts: { title: string; message: string; danger?: boolean }) => {
    return new Promise<boolean>((resolve) => {
      setState({ open: true, title: opts.title, message: opts.message, danger: opts.danger ?? false, onYes: () => {} });
      setResolver(() => resolve);
    });
  }, []);

  const close = (val: boolean) => {
    setState((s) => ({ ...s, open: false }));
    resolver?.(val);
    setResolver(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state.open && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[70]" onClick={() => close(false)}>
          <div className="bg-white rounded-lg p-5 w-[440px] max-w-[95vw] shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-2">{state.title}</h3>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{state.message}</p>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn-secondary" onClick={() => close(false)} autoFocus>Annuler</button>
              <button className={state.danger ? 'btn-danger' : 'btn-primary'} onClick={() => close(true)}>Confirmer</button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be inside ConfirmProvider');
  return ctx;
}

// Global keyboard listener — closes any open Modal on Escape (Modal still has its own listener if needed)
export function useEscapeKey(handler: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') handler(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [handler, enabled]);
}
