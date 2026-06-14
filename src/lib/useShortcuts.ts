import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Global keyboard shortcuts (Ctrl/Cmd + letter).
 * Mounted once in App. Ignores shortcuts when typing in input/textarea.
 */
export function useGlobalShortcuts() {
  const nav = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // ignore in inputs/textareas/contenteditable
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (!(e.ctrlKey || e.metaKey)) return;

      const map: Record<string, string> = {
        'd': '/dashboard',
        'i': '/imports',
        'm': '/review',
        'v': '/sales',
        'j': '/justificatifs-ventes',
        'o': '/documents',
        'a': '/purchases',
        's': '/stock',
        'e': '/expenses',
        'u': '/declarations',
        'r': '/rentabilite',
        'g': '/agenda',
        ',': '/settings'
      };
      const route = map[e.key.toLowerCase()];
      if (route) {
        e.preventDefault();
        nav(route);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [nav]);
}
