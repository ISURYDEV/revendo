/**
 * Minimal IndexedDB wrapper for Revendo Mobile.
 *
 * Two object stores:
 *  - `snapshot` : holds at most ONE row (key='current') with the imported snapshot.
 *  - `actions`  : the pending actions queue created offline by the user.
 *
 * Why raw IndexedDB and not `idb` package?
 *  - No new dependency to maintain.
 *  - The API surface used here is small (~40 lines).
 *  - Reduces bundle size on a mobile-first app.
 */

const DB_NAME = 'revendo-mobile';
const DB_VERSION = 1;
const STORE_SNAPSHOT = 'snapshot';
const STORE_ACTIONS = 'actions';

let _dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SNAPSHOT)) {
        db.createObjectStore(STORE_SNAPSHOT, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_ACTIONS)) {
        const s = db.createObjectStore(STORE_ACTIONS, { keyPath: 'id' });
        s.createIndex('status', 'status', { unique: false });
        s.createIndex('created_at', 'created_at', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

export async function dbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function dbPut(store: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function dbDelete(store: string, key: IDBValidKey): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function dbAll<T>(store: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve((req.result ?? []) as T[]);
    req.onerror = () => reject(req.error);
  });
}

export async function dbClear(store: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function dbWipeAll(): Promise<void> {
  await dbClear(STORE_SNAPSHOT);
  await dbClear(STORE_ACTIONS);
}

export const STORES = {
  SNAPSHOT: STORE_SNAPSHOT,
  ACTIONS: STORE_ACTIONS
} as const;
