import { useEffect, useState } from 'react';

/**
 * Persistent state in localStorage. Useful for filters, last selected period, etc.
 * Returns [value, setValue] like useState.
 */
export function useLocalStorage<T>(key: string, defaultValue: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw == null) return defaultValue;
      return JSON.parse(raw) as T;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore (quota / private mode)
    }
  }, [key, value]);

  return [value, setValue];
}
