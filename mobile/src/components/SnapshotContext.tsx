import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadSnapshot } from '../storage/snapshot';
import type { MobileSnapshot } from '@shared/mobile';

interface SnapshotState {
  snapshot: MobileSnapshot | null;
  importedAt: string | null;
  loading: boolean;
  reload: () => Promise<void>;
}

const SnapshotContext = createContext<SnapshotState | null>(null);

export function SnapshotProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<MobileSnapshot | null>(null);
  const [importedAt, setImportedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const row = await loadSnapshot();
      setSnapshot(row?.data ?? null);
      setImportedAt(row?.importedAt ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return (
    <SnapshotContext.Provider value={{ snapshot, importedAt, loading, reload }}>
      {children}
    </SnapshotContext.Provider>
  );
}

export function useSnapshot(): SnapshotState {
  const ctx = useContext(SnapshotContext);
  if (!ctx) throw new Error('useSnapshot must be used inside SnapshotProvider');
  return ctx;
}
