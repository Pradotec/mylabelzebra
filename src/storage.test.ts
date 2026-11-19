/**
 * happy-dom ne fournit pas IndexedDB : on installe un IndexedDB minimal en mémoire,
 * capable de simuler une transaction annulée pour dépassement de quota.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { kvGet, kvSet, kvDel, isQuotaError, storageErrorMessage, StorageFullError, _resetStorageForTests } from './storage';

type Handler = ((this: unknown) => void) | null;

function quotaError() {
  const e = new Error('The quota has been exceeded.');
  e.name = 'QuotaExceededError';
  return e;
}

/** Faux IndexedDB : `mode` règle le comportement des écritures */
function installFakeIdb(mode: { write: 'ok' | 'quota-abort' | 'throw' }) {
  const data = new Map<string, unknown>();
  const db = {
    onversionchange: null as Handler,
    close() {},
    transaction(_store: string, txMode: string = 'readonly') {
      const tx = {
        error: null as Error | null,
        oncomplete: null as Handler,
        onerror: null as Handler,
        onabort: null as Handler,
        abort() {
          setTimeout(() => tx.onabort?.call(tx), 0);
        },
        objectStore() {
          const req = (fn: () => unknown) => {
            const r = { result: undefined as unknown, error: null as Error | null, onsuccess: null as Handler, onerror: null as Handler };
            setTimeout(() => {
              if (txMode === 'readwrite' && mode.write === 'quota-abort') {
                // comme les navigateurs : l'écriture échoue à la validation, la transaction est annulée
                tx.error = quotaError();
                tx.onabort?.call(tx);
                return;
              }
              r.result = fn();
              r.onsuccess?.call(r);
              tx.oncomplete?.call(tx);
            }, 0);
            return r;
          };
          return {
            get: (k: string) => req(() => structuredClone(data.get(k))),
            put: (v: unknown, k: string) => {
              if (mode.write === 'throw') throw new DOMException('could not be cloned', 'DataCloneError');
              return req(() => data.set(k, structuredClone(v)));
            },
            delete: (k: string) => req(() => data.delete(k)),
          };
        },
      };
      return tx;
    },
  };
  (globalThis as unknown as { indexedDB: unknown }).indexedDB = {
    open() {
      const r = { result: db, error: null, onsuccess: null as Handler, onerror: null as Handler, onupgradeneeded: null as Handler, onblocked: null as Handler };
      setTimeout(() => r.onsuccess?.call(r), 0);
      return r;
    },
  };
  return data;
}

beforeEach(() => {
  _resetStorageForTests();
  localStorage.clear();
});
afterEach(() => {
  delete (globalThis as unknown as { indexedDB?: unknown }).indexedDB;
  _resetStorageForTests();
});

describe('IndexedDB', () => {
  it('écrit, relit et supprime', async () => {
    const data = installFakeIdb({ write: 'ok' });
    await kvSet('k', { a: 1 });
    expect(data.get('k')).toEqual({ a: 1 });
    expect(await kvGet('k')).toEqual({ a: 1 });
    await kvDel('k');
    expect(await kvGet('k')).toBeUndefined();
  });

  it('transaction annulée (quota dépassé) : la promesse est rejetée, pas bloquée', async () => {
    installFakeIdb({ write: 'quota-abort' });
    const p = kvSet('k', { gros: 'x' });
    await expect(p).rejects.toBeInstanceOf(StorageFullError);
    // aucun repli silencieux vers localStorage
    expect(localStorage.getItem('mlz.k')).toBeNull();
  });

  it('erreur synchrone (clonage impossible) : rejetée', async () => {
    installFakeIdb({ write: 'throw' });
    await expect(kvSet('k', 1)).rejects.toThrow(/cloned/);
  });
});

describe('repli localStorage (IndexedDB indisponible)', () => {
  it('écrit et relit dans localStorage', async () => {
    await kvSet('k', [1, 2]);
    expect(localStorage.getItem('mlz.k')).toBe('[1,2]');
    expect(await kvGet('k')).toEqual([1, 2]);
    await kvDel('k');
    expect(await kvGet('k')).toBeUndefined();
  });

  it('quota localStorage dépassé : StorageFullError', async () => {
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw quotaError();
    });
    try {
      await expect(kvSet('k', 'v')).rejects.toBeInstanceOf(StorageFullError);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('messages', () => {
  it('reconnaît les erreurs de quota', () => {
    expect(isQuotaError(quotaError())).toBe(true);
    expect(isQuotaError(new StorageFullError())).toBe(true);
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaError(new Error('autre'))).toBe(false);
    expect(isQuotaError(undefined)).toBe(false);
  });

  it('message clair « Stockage du navigateur plein »', () => {
    expect(storageErrorMessage(new StorageFullError())).toMatch(/^Stockage du navigateur plein/);
    expect(storageErrorMessage(new Error('boom'))).toMatch(/boom/);
  });
});
