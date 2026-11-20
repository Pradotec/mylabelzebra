import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  composeSscc,
  ssccRange,
  saveSsccSettings,
  withSsccRange,
  loadSscc,
  getSsccConfig,
  nextSerial,
  ssccPreview,
  listSsccLog,
  ssccLogCsv,
  serialCapacity,
  SsccError,
  _resetSsccForTests,
  type SsccAssignment,
} from './sscc';
import { gs1CheckDigit } from './prompts';
import { normalizeBarcode } from './render/codes';

// IndexedDB absent sous happy-dom : storage.ts utilise son repli localStorage
const meta = { docName: 'Palette', docId: 'd1', kind: 'zpl-fichier', hasData: true };

/** navigator.locks simulé : verrous exclusifs par nom (file d'attente) */
function installLocks() {
  const chains = new Map<string, Promise<unknown>>();
  const locks = {
    request: <T,>(name: string, cb: () => Promise<T>): Promise<T> => {
      const prev = chains.get(name) ?? Promise.resolve();
      const p = prev.then(cb);
      chains.set(
        name,
        p.catch(() => undefined),
      );
      return p;
    },
  };
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
}
function removeLocks() {
  delete (navigator as unknown as { locks?: unknown }).locks;
}

const deferred = () => {
  let resolve!: (v: boolean) => void;
  const promise = new Promise<boolean>((r) => (resolve = r));
  return { promise, resolve };
};

beforeEach(async () => {
  localStorage.clear();
  _resetSsccForTests();
  await loadSscc();
});

describe('SSCC — composition', () => {
  it('18 chiffres, clé de contrôle GS1 correcte', () => {
    for (const prefix of ['3012345', '30123456', '301234567', '3012345678']) {
      const s = composeSscc(3, prefix, 42);
      expect(s).toMatch(/^\d{18}$/);
      expect(s.startsWith('3' + prefix)).toBe(true);
      expect(Number(s[17])).toBe(gs1CheckDigit(s.slice(0, 17)));
      // accepté tel quel par la symbologie sscc18 (préfixe « (00) » ajouté)
      expect(normalizeBarcode(s, 'sscc18')).toEqual({ data: '(00)' + s, human: '(00) ' + s });
    }
  });

  it('référence série complétée par des zéros', () => {
    expect(composeSscc(0, '0614141', 1).slice(0, 17)).toBe('00614141000000001');
    expect(composeSscc(0, '0614141', 1)).toBe('006141410000000012');
  });

  it('numéros consécutifs', () => {
    const r = ssccRange(1, '3012345', 99, 3);
    expect(r.map((s) => s.slice(8, 17))).toEqual(['000000099', '000000100', '000000101']);
    expect(new Set(r).size).toBe(3);
  });

  it('plage épuisée : erreur claire', () => {
    expect(serialCapacity('3012345678')).toBe(1_000_000);
    expect(() => ssccRange(0, '3012345678', 999_999, 2)).toThrow(/Plage SSCC épuisée/);
    expect(ssccRange(0, '3012345678', 999_999, 1)).toHaveLength(1);
  });
});

describe('SSCC — réglages', () => {
  it('préfixe invalide refusé', async () => {
    await expect(saveSsccSettings({ prefix: '123' })).rejects.toThrow(/7 à 10 chiffres/);
    await expect(saveSsccSettings({ prefix: '12345678901' })).rejects.toThrow(SsccError);
  });

  it('prochain numéro réglable, mais jamais sous les numéros déjà émis', async () => {
    await saveSsccSettings({ prefix: '3012345', extension: 2 });
    await saveSsccSettings({ next: 500 });
    expect(nextSerial(getSsccConfig())).toBe(500);
    await withSsccRange([0, 1], meta, async () => true);
    expect(nextSerial(getSsccConfig())).toBe(502);
    await expect(saveSsccSettings({ next: 501 })).rejects.toThrow(/déjà été émis/);
    await saveSsccSettings({ next: 1000 });
    expect(nextSerial(getSsccConfig())).toBe(1000);
  });

  it('compteur propre à chaque couple extension / préfixe', async () => {
    await saveSsccSettings({ prefix: '3012345', extension: 0 });
    await withSsccRange([0, 1, 2], meta, async () => true);
    await saveSsccSettings({ extension: 1 });
    expect(nextSerial(getSsccConfig())).toBe(0);
    await saveSsccSettings({ extension: 0 });
    expect(nextSerial(getSsccConfig())).toBe(3);
  });

  it('aperçu : prochain SSCC prévu, sans rien réserver', async () => {
    expect(ssccPreview()).toBeUndefined(); // non configuré
    await saveSsccSettings({ prefix: '3012345' });
    const a = ssccPreview(0);
    expect(ssccPreview(0)).toBe(a);
    expect(ssccPreview(1)).toBe(composeSscc(0, '3012345', 1));
    expect(nextSerial(getSsccConfig())).toBe(0);
    expect(await listSsccLog()).toEqual([]);
  });
});

for (const mode of ['repli (sans navigator.locks)', 'navigator.locks'] as const) {
  describe(`SSCC — réservation, ${mode}`, () => {
    beforeEach(async () => {
      if (mode === 'navigator.locks') installLocks();
      await saveSsccSettings({ prefix: '3012345', extension: 1 });
    });
    afterEach(() => removeLocks());

    it('aucun préfixe : travail refusé, non lancé', async () => {
      await saveSsccSettings({ prefix: '' });
      const run = vi.fn(async () => true);
      await expect(withSsccRange([0], meta, run)).rejects.toThrow(/Aucun préfixe entreprise GS1/);
      expect(run).not.toHaveBeenCalled();
    });

    it('succès : plage consommée et inscrite au journal', async () => {
      let got: SsccAssignment | null = null;
      expect(await withSsccRange([4, 7], meta, async (a) => ((got = a), true))).toBe(true);
      expect(got).toMatchObject({ prefix: '3012345', extension: 1, start: 0, indices: [4, 7] });
      expect(nextSerial(getSsccConfig())).toBe(2);
      const log = await listSsccLog();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ count: 2, first: composeSscc(1, '3012345', 0), last: composeSscc(1, '3012345', 1), indices: [4, 7], docName: 'Palette' });
    });

    it('échec ou exception : rien n’est consommé', async () => {
      expect(await withSsccRange([0, 1], meta, async () => false)).toBe(false);
      expect(nextSerial(getSsccConfig())).toBe(0);
      await expect(
        withSsccRange([0], meta, async () => {
          throw new Error('imprimante');
        }),
      ).rejects.toThrow('imprimante');
      expect(nextSerial(getSsccConfig())).toBe(0);
      expect(await listSsccLog()).toEqual([]);
      // le stockage aussi (pas seulement le cache)
      expect(nextSerial(await loadSscc())).toBe(0);
    });

    it('copies ×N d’une même étiquette : un seul SSCC', async () => {
      let got: SsccAssignment | null = null;
      await withSsccRange([0, 0, 0, 2, 2], meta, async (a) => ((got = a), true));
      expect(got!.indices).toEqual([0, 2]);
      expect(nextSerial(getSsccConfig())).toBe(2);
    });

    it('plage épuisée : travail refusé, compteur inchangé', async () => {
      await saveSsccSettings({ prefix: '3012345678' });
      await saveSsccSettings({ next: 999_998 });
      const run = vi.fn(async () => true);
      await expect(withSsccRange([0, 1, 2], meta, run)).rejects.toThrow(/Plage SSCC épuisée/);
      expect(run).not.toHaveBeenCalled();
      expect(nextSerial(getSsccConfig())).toBe(999_998);
      expect(await withSsccRange([0, 1], meta, async () => true)).toBe(true);
    });

    it('deux réservations simultanées : plages disjointes, aucun doublon', async () => {
      const d1 = deferred();
      const seen: SsccAssignment[] = [];
      const p1 = withSsccRange([0, 1, 2], meta, (a) => (seen.push(a), d1.promise));
      const p2 = withSsccRange([0, 1], { ...meta, docName: 'Autre' }, async (a) => (seen.push(a), true));
      await new Promise((r) => setTimeout(r, 5));
      d1.resolve(true);
      expect(await Promise.all([p1, p2])).toEqual([true, true]);
      const all = seen.flatMap((a) => a.indices.map((_, k) => composeSscc(a.extension, a.prefix, a.start + k)));
      expect(all).toHaveLength(5);
      expect(new Set(all).size).toBe(5);
      expect(nextSerial(getSsccConfig())).toBe(5);
      expect(await listSsccLog()).toHaveLength(2);
    });

    it('le premier travail échoue pendant que le second attend : pas de doublon', async () => {
      const d1 = deferred();
      const seen: SsccAssignment[] = [];
      const p1 = withSsccRange([0, 1], meta, (a) => (seen.push(a), d1.promise));
      const p2 = withSsccRange([0], meta, async (a) => (seen.push(a), true));
      await new Promise((r) => setTimeout(r, 5));
      d1.resolve(false);
      await Promise.all([p1, p2]);
      expect(nextSerial(getSsccConfig())).toBe(1);
      expect((await listSsccLog()).map((e) => e.start)).toEqual([0]);
    });
  });
}

describe('SSCC — journal CSV', () => {
  it('une ligne par SSCC, identifiant (00) gardé en texte, séparateur ;', async () => {
    await saveSsccSettings({ prefix: '3012345' });
    await withSsccRange([0, 2], { ...meta, docName: 'Palette; quai 3' }, async () => true);
    await withSsccRange([5], meta, async () => true);
    const csv = ssccLogCsv(await listSsccLog());
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).trim().split('\r\n');
    // colonne « Réservé non imprimé » ajoutée en fin de ligne : les colonnes existantes ne bougent pas
    expect(lines[0]).toBe('Date;Document;Travail;SSCC;Ligne / étiquette;Plage;Réservé non imprimé');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('"Palette; quai 3"');
    expect(lines[1].split(';').slice(-5)).toEqual(['zpl-fichier', '(00)' + composeSscc(0, '3012345', 0), '1', `${composeSscc(0, '3012345', 0)}-${composeSscc(0, '3012345', 1)}`, '']);
    expect(lines[2]).toContain(';(00)' + composeSscc(0, '3012345', 1) + ';3;');
    expect(lines[3]).toContain(';(00)' + composeSscc(0, '3012345', 2) + ';6;');
    expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2};/);
  });

  it('SSCC réservés non imprimés (notPrinted) : « oui » sur les derniers SSCC de la plage', async () => {
    await saveSsccSettings({ prefix: '3012345' });
    await withSsccRange([0, 1, 2], meta, async () => true);
    const [e] = await listSsccLog();
    const lines = ssccLogCsv([{ ...e, notPrinted: 2 }]).slice(1).trim().split('\r\n');
    expect(lines.slice(1).map((l) => l.split(';').pop())).toEqual(['', 'oui', 'oui']);
    // entrée ancienne, sans le champ : colonne vide
    expect(ssccLogCsv([e]).slice(1).trim().split('\r\n').slice(1).map((l) => l.split(';').pop())).toEqual(['', '', '']);
  });
});
