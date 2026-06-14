export type NotifyKind = 'success' | 'error' | 'info' | 'warning';

export function notify(message: unknown, kind: NotifyKind = 'info', title = 'Revendo'): void {
  window.dispatchEvent(new CustomEvent('revendo:toast', {
    detail: {
      kind,
      title,
      message: String(message ?? '')
    }
  }));
}
