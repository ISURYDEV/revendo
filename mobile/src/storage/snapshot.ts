import { dbGet, dbPut, STORES } from './db';
import type { MobileSnapshot } from '@shared/mobile';

const KEY = 'current';

interface StoredSnapshot {
  id: string;
  imported_at: string;
  schema_version: string;
  data: MobileSnapshot;
}

export async function saveSnapshot(snapshot: MobileSnapshot): Promise<void> {
  const row: StoredSnapshot = {
    id: KEY,
    imported_at: new Date().toISOString(),
    schema_version: snapshot.schema_version,
    data: snapshot
  };
  await dbPut(STORES.SNAPSHOT, row);
}

export async function loadSnapshot(): Promise<{ importedAt: string; data: MobileSnapshot } | null> {
  const row = await dbGet<StoredSnapshot>(STORES.SNAPSHOT, KEY);
  if (!row) return null;
  return { importedAt: row.imported_at, data: row.data };
}
