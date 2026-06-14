import { useEffect, useState } from 'react';

type ToastKind = 'success' | 'error' | 'info' | 'warning';
interface ToastEvent { kind: ToastKind; message: string }

export function notify(message: string, kind: ToastKind = 'info'): void {
  window.dispatchEvent(new CustomEvent<ToastEvent>('revendo:toast', { detail: { kind, message } }));
}

export function ToastHost() {
  const [toast, setToast] = useState<ToastEvent | null>(null);
  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<ToastEvent>).detail;
      setToast(detail);
      window.setTimeout(() => setToast((prev) => (prev === detail ? null : prev)), 4000);
    };
    window.addEventListener('revendo:toast', onToast);
    return () => window.removeEventListener('revendo:toast', onToast);
  }, []);
  if (!toast) return null;
  const color =
    toast.kind === 'success' ? 'bg-green-600' :
    toast.kind === 'error' ? 'bg-red-600' :
    toast.kind === 'warning' ? 'bg-amber-600' : 'bg-slate-800';
  return (
    <div className={`${color} text-white fixed left-3 right-3 bottom-20 z-50 px-3 py-2 rounded-lg text-sm shadow-lg whitespace-pre-line`}>
      {toast.message}
    </div>
  );
}
