/** Petit stockage clé/valeur IndexedDB (avec repli localStorage). */
const DB = 'mylabelzebra';
const STORE = 'kv';

let dbp: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  if (!dbp)
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  return dbp;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T | undefined>((resolve, reject) => {
      const r = db.transaction(STORE).objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result as T | undefined);
      r.onerror = () => reject(r.error);
    });
  } catch {
    const v = localStorage.getItem('mlz.' + key);
    return v ? (JSON.parse(v) as T) : undefined;
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    try {
      localStorage.setItem('mlz.' + key, JSON.stringify(value));
    } catch {
      /* quota */
    }
  }
}

export function prefGet<T>(key: string, def: T): T {
  try {
    const v = localStorage.getItem('mlz.pref.' + key);
    return v == null ? def : (JSON.parse(v) as T);
  } catch {
    return def;
  }
}
export function prefSet(key: string, v: unknown) {
  try {
    localStorage.setItem('mlz.pref.' + key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}
