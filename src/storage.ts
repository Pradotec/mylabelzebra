/**
 * Petit stockage clé/valeur IndexedDB (avec repli localStorage si IndexedDB est indisponible).
 *
 * Les erreurs d'écriture ne sont plus avalées : une transaction annulée (quota dépassé…)
 * rejette la promesse. Le repli localStorage ne sert que lorsque la base ne peut pas être
 * ouverte (navigation privée de certains navigateurs, IndexedDB absent).
 */
import { t } from './i18n';

const DB = 'mylabelzebra';
const STORE = 'kv';
const LS = 'mlz.';

/** Le stockage du navigateur est plein (quota dépassé) */
export class StorageFullError extends Error {
  constructor(cause?: unknown) {
    super(t('Stockage du navigateur plein'));
    this.name = 'StorageFullError';
    (this as { cause?: unknown }).cause = cause;
  }
}

/** Vrai si l'erreur correspond à un dépassement de quota (IndexedDB ou localStorage) */
export function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  if (e instanceof StorageFullError) return true;
  const x = e as { name?: string; code?: number; message?: string; inner?: unknown };
  if (x.name === 'QuotaExceededError' || x.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
  if (x.code === 22 || x.code === 1014) return true;
  return /quota/i.test(x.message || '');
}

/** Message d'erreur lisible pour un échec d'enregistrement */
export function storageErrorMessage(e: unknown): string {
  if (isQuotaError(e)) return t('Stockage du navigateur plein : supprimez des étiquettes ou effacez l’historique d’impression.');
  return t('Enregistrement impossible : {m}', { m: (e as Error)?.message || String(e) });
}

let dbp: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => {
        const db = r.result;
        // une autre version de l'application demande une mise à niveau : on libère la base
        db.onversionchange = () => {
          db.close();
          dbp = null;
        };
        resolve(db);
      };
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
    // échec d'ouverture : on réessaiera au prochain appel
    dbp.catch(() => (dbp = null));
  }
  return dbp;
}

/** Ouvre la base ; null = IndexedDB indisponible (repli localStorage) */
async function openOrNull(): Promise<IDBDatabase | null> {
  try {
    return await open();
  } catch {
    return null;
  }
}

/** Exécute une transaction ; rejette sur erreur ET sur annulation (quota dépassé…) */
function run<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(STORE, mode);
    } catch (e) {
      // base fermée entre-temps : on la rouvrira au prochain appel
      dbp = null;
      reject(e);
      return;
    }
    let req: IDBRequest | void;
    let settled = false;
    const fail = (e: unknown) => {
      if (settled) return;
      settled = true;
      reject(isQuotaError(e) ? new StorageFullError(e) : e || new Error('IndexedDB transaction aborted'));
    };
    tx.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve((req ? req.result : undefined) as T);
    };
    tx.onerror = () => fail(tx.error ?? (req ? req.error : null));
    tx.onabort = () => fail(tx.error ?? (req ? req.error : null));
    try {
      req = fn(tx.objectStore(STORE));
    } catch (e) {
      // DataCloneError, etc. : levée synchrone
      try {
        tx.abort();
      } catch {
        /* déjà terminée */
      }
      fail(e);
    }
  });
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await openOrNull();
  if (db) {
    try {
      return await run<T | undefined>(db, 'readonly', (s) => s.get(key));
    } catch {
      return undefined;
    }
  }
  try {
    const v = localStorage.getItem(LS + key);
    return v ? (JSON.parse(v) as T) : undefined;
  } catch {
    return undefined;
  }
}

/** Écrit une valeur. Rejette (StorageFullError si quota dépassé) en cas d'échec. */
export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await openOrNull();
  if (db) {
    await run<void>(db, 'readwrite', (s) => s.put(value, key));
    return;
  }
  try {
    localStorage.setItem(LS + key, JSON.stringify(value));
  } catch (e) {
    throw isQuotaError(e) ? new StorageFullError(e) : e;
  }
}

/**
 * Lecture-modification-écriture ATOMIQUE d'une clé : avec IndexedDB, lecture et écriture
 * se font dans la même transaction readwrite (les transactions readwrite qui se
 * chevauchent sont sérialisées par le navigateur, y compris entre onglets). Repli
 * localStorage : lecture et écriture synchrones (atomiques dans l'onglet seulement).
 * Si `fn` lève une erreur, rien n'est écrit et la promesse rejette avec cette erreur.
 */
export async function kvUpdate<T>(key: string, fn: (old: T | undefined) => T): Promise<T> {
  const db = await openOrNull();
  if (db) {
    let next: T;
    let userError: unknown = null;
    try {
      await run<void>(db, 'readwrite', (s) => {
        const g = s.get(key);
        g.onsuccess = () => {
          try {
            next = fn(g.result as T | undefined);
          } catch (e) {
            userError = e;
            try {
              g.transaction?.abort();
            } catch {
              /* déjà terminée */
            }
            return;
          }
          s.put(next, key);
        };
      });
    } catch (e) {
      throw userError ?? e;
    }
    if (userError) throw userError;
    return next!;
  }
  let old: T | undefined;
  try {
    const v = localStorage.getItem(LS + key);
    old = v ? (JSON.parse(v) as T) : undefined;
  } catch {
    old = undefined;
  }
  const next = fn(old);
  try {
    localStorage.setItem(LS + key, JSON.stringify(next));
  } catch (e) {
    throw isQuotaError(e) ? new StorageFullError(e) : e;
  }
  return next;
}

/** Supprime une clé (sans erreur si elle n'existe pas). */
export async function kvDel(key: string): Promise<void> {
  const db = await openOrNull();
  if (db) {
    await run<void>(db, 'readwrite', (s) => s.delete(key));
    return;
  }
  try {
    localStorage.removeItem(LS + key);
  } catch {
    /* ignore */
  }
}

/** Réinitialise la connexion (tests) */
export function _resetStorageForTests() {
  dbp = null;
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
