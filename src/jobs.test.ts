import { describe, it, expect, beforeEach, vi } from 'vitest';

// stockage clé/valeur en mémoire (IndexedDB absent sous happy-dom)
const mem = vi.hoisted(() => ({ kv: new Map<string, unknown>(), sets: [] as string[], failNext: 0 }));
vi.mock('./storage', async (orig) => {
  const real = await orig<typeof import('./storage')>();
  return {
    ...real,
    kvGet: vi.fn(async (k: string) => (mem.kv.has(k) ? structuredClone(mem.kv.get(k)) : undefined)),
    kvSet: vi.fn(async (k: string, v: unknown) => {
      if (mem.failNext > 0) {
        mem.failNext--;
        throw new real.StorageFullError();
      }
      mem.sets.push(k);
      mem.kv.set(k, structuredClone(v));
    }),
    kvDel: vi.fn(async (k: string) => void mem.kv.delete(k)),
    kvUpdate: vi.fn(async (k: string, fn: (old: unknown) => unknown) => {
      const v = fn(mem.kv.has(k) ? structuredClone(mem.kv.get(k)) : undefined);
      mem.kv.set(k, structuredClone(v));
      return v;
    }),
  };
});
vi.mock('./util', async (orig) => ({ ...(await orig<typeof import('./util')>()), downloadText: vi.fn() }));

import { listHistory, deleteHistory, clearHistory, reprint, startJob, historyDocForEditing, historyLimits, hashString, _resetHistoryForTests, MAX_HISTORY, MAX_HISTORY_BYTES, type HistoryEntry } from './jobs';
import { downloadText } from './util';
import { newDoc, makeText, makeBarcode } from './elements';
import { useStore } from './store';
import type { LabelDoc } from './types';
import { saveSsccSettings, loadSscc, getSsccConfig, nextSerial, listSsccLog, composeSscc, _resetSsccForTests, type SsccDoc } from './sscc';

const docKeys = () => [...mem.kv.keys()].filter((k) => k.startsWith('jobs.d.'));
const entryKeys = () => [...mem.kv.keys()].filter((k) => k.startsWith('jobs.e.'));

function model(name = 'Modèle', text = 'Lot {{?Lot}}'): LabelDoc {
  const d = newDoc({ name, widthIn: 2, heightIn: 1 });
  d.elements = [{ ...makeText(d, text), id: 't1' }];
  return d;
}

beforeEach(async () => {
  mem.kv.clear();
  mem.sets.length = 0;
  mem.failNext = 0;
  historyLimits.items = MAX_HISTORY;
  historyLimits.bytes = MAX_HISTORY_BYTES;
  _resetHistoryForTests();
  vi.mocked(downloadText).mockReset();
  localStorage.clear();
  useStore.setState({ promptAsk: null });
  _resetSsccForTests();
  await loadSscc();
});

describe('historique — stockage par entrée et déduplication', () => {
  it('deux travaux du même document : un seul document stocké, valeurs propres à chaque travail', async () => {
    const doc = model();
    expect(await startJob('zpl-fichier', { doc, prompts: { Lot: 'A1' } })).toBe(1);
    expect(await startJob('zpl-fichier', { doc, prompts: { Lot: 'B2' } })).toBe(1);
    expect(docKeys()).toHaveLength(1);
    expect(entryKeys()).toHaveLength(2);
    const list = await listHistory();
    expect(list).toHaveLength(2);
    expect(list.map((e) => e.doc.promptValues?.Lot).sort()).toEqual(['A1', 'B2']);
    expect(list.every((e) => typeof e.doc.jobDate === 'number')).toBe(true);
    expect(list[0].doc.elements[0].id).toBe('t1');
  });

  it('une impression n’écrit que l’entrée, le document (s’il est nouveau) et l’index', async () => {
    const doc = model();
    await startJob('zpl-fichier', { doc, prompts: { Lot: 'A' } });
    mem.sets.length = 0;
    await startJob('zpl-fichier', { doc, prompts: { Lot: 'B' } });
    expect(mem.sets.filter((k) => k.startsWith('jobs.'))).toHaveLength(2); // entrée + index
    expect(mem.sets).not.toContain('history');
  });

  it('documents différents : stockés séparément', async () => {
    await startJob('zpl-fichier', { doc: model('A'), prompts: { Lot: '1' } });
    await startJob('zpl-fichier', { doc: model('B'), prompts: { Lot: '1' } });
    expect(docKeys()).toHaveLength(2);
  });

  it('suppression d’une entrée : le document partagé reste, puis disparaît avec la dernière', async () => {
    const doc = model();
    await startJob('zpl-fichier', { doc, prompts: { Lot: 'A' } });
    await startJob('zpl-fichier', { doc, prompts: { Lot: 'B' } });
    const [e1, e2] = await listHistory();
    await deleteHistory(e1.id);
    expect(docKeys()).toHaveLength(1);
    expect(await listHistory()).toHaveLength(1);
    await deleteHistory(e2.id);
    expect(docKeys()).toHaveLength(0);
    expect(entryKeys()).toHaveLength(0);
  });

  it('effacer l’historique supprime toutes les clés', async () => {
    await startJob('zpl-fichier', { doc: model('A'), prompts: { Lot: '1' } });
    await startJob('zpl-fichier', { doc: model('B'), prompts: { Lot: '1' } });
    await clearHistory();
    expect(await listHistory()).toEqual([]);
    expect(docKeys()).toHaveLength(0);
    expect(entryKeys()).toHaveLength(0);
  });

  it('empreinte stable et sensible au contenu', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });
});

describe('historique — plafonds et purge', () => {
  it('nombre d’entrées : les plus anciennes sont purgées', async () => {
    historyLimits.items = 3;
    const doc = model();
    for (let i = 0; i < 5; i++) await startJob('zpl-fichier', { doc, prompts: { Lot: String(i) } });
    const list = await listHistory();
    expect(list).toHaveLength(3);
    expect(list.map((e) => e.prompts.Lot)).toEqual(['4', '3', '2']);
    expect(entryKeys()).toHaveLength(3);
  });

  it('taille totale : purge des plus anciennes et de leurs documents', async () => {
    const big = (n: string) => model(n, 'x'.repeat(5000));
    await startJob('zpl-fichier', { doc: big('A') });
    const one = [...mem.kv.entries()].filter(([k]) => k.startsWith('jobs.d.') || k.startsWith('jobs.e.')).reduce((a, [, v]) => a + JSON.stringify(v).length, 0);
    historyLimits.bytes = Math.floor(one * 2.5); // place pour deux travaux
    await new Promise((r) => setTimeout(r, 2));
    await startJob('zpl-fichier', { doc: big('B') });
    await new Promise((r) => setTimeout(r, 2));
    await startJob('zpl-fichier', { doc: big('C') });
    const list = await listHistory();
    expect(list.map((e) => e.name)).toEqual(['C', 'B']);
    expect(docKeys()).toHaveLength(2);
  });

  it('stockage plein : purge la moitié la plus ancienne et réessaie', async () => {
    const doc = model();
    for (let i = 0; i < 4; i++) {
      await startJob('zpl-fichier', { doc, prompts: { Lot: String(i) } });
      await new Promise((r) => setTimeout(r, 2));
    }
    mem.failNext = 1;
    await startJob('zpl-fichier', { doc, prompts: { Lot: '4' } });
    const list = await listHistory();
    expect(list[0].prompts.Lot).toBe('4');
    expect(list.length).toBe(3); // 4 anciennes → 2 gardées, + la nouvelle
  });

  it('stockage plein persistant : le travail réussit, un message le signale', async () => {
    const toast = vi.spyOn(useStore.getState(), 'toast');
    mem.failNext = 99;
    expect(await startJob('zpl-fichier', { doc: model(), prompts: { Lot: 'x' } })).toBe(1);
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Stockage du navigateur plein/), 'error');
    toast.mockRestore();
  });
});

describe('historique — migration de l’ancien format', () => {
  function oldEntry(id: string, at: number, doc: LabelDoc, lot: string): HistoryEntry {
    return {
      id,
      at,
      name: doc.name,
      docId: doc.id,
      kind: 'zpl-fichier',
      count: 1,
      rows: [],
      prompts: { Lot: lot },
      jobs: [{ index: 0, copies: 1 }],
      opts: { currentRow: 0 },
      doc: { ...doc, promptValues: { Lot: lot }, jobDate: at },
    };
  }

  it('convertit silencieusement le tableau « history », déduplique et supprime l’ancienne clé', async () => {
    const doc = model();
    mem.kv.set('history', [oldEntry('o1', 1000, doc, 'A'), oldEntry('o2', 2000, doc, 'B'), oldEntry('o3', 3000, model('Autre'), 'C')]);
    const list = await listHistory();
    expect(list.map((e) => e.id)).toEqual(['o3', 'o2', 'o1']);
    expect(list[1].doc.promptValues).toEqual({ Lot: 'B' });
    expect(list[1].doc.jobDate).toBe(2000);
    expect(mem.kv.has('history')).toBe(false);
    expect(docKeys()).toHaveLength(2);
    // les nouveaux travaux s'ajoutent à l'historique migré
    await startJob('zpl-fichier', { doc, prompts: { Lot: 'D' } });
    expect(await listHistory()).toHaveLength(4);
    expect(docKeys()).toHaveLength(2);
  });

  it('migration interrompue (stockage plein) : ancien historique conservé, nouvel essai ensuite', async () => {
    mem.kv.set('history', [oldEntry('o1', 1000, model(), 'A')]);
    mem.failNext = 1;
    await listHistory();
    expect(mem.kv.has('history')).toBe(true);
    const list = await listHistory();
    expect(list.map((e) => e.id)).toEqual(['o1']);
    expect(mem.kv.has('history')).toBe(false);
  });
});

describe('historique — réimprimer / rouvrir', () => {
  it('réimprime à l’identique (même sortie) et inscrit une nouvelle entrée', async () => {
    const doc = model();
    await startJob('zpl-fichier', { doc, prompts: { Lot: 'L42' } });
    const first = vi.mocked(downloadText).mock.calls[0][0];
    expect(first).toContain('L42');
    const [e] = await listHistory();
    expect(await reprint(e)).toBe(true);
    expect(vi.mocked(downloadText).mock.calls[1][0]).toBe(first);
    const list = await listHistory();
    expect(list).toHaveLength(2);
    expect(list[0].reprintOf).toBe(e.id);
    expect(docKeys()).toHaveLength(1);
  });

  it('rouvrir : document sans les valeurs propres au travail', async () => {
    await startJob('zpl-fichier', { doc: model(), prompts: { Lot: 'Z' } });
    const [e] = await listHistory();
    const d = historyDocForEditing(e);
    expect(d.promptValues).toBeUndefined();
    expect(d.jobDate).toBeUndefined();
    expect(d.elements[0].id).toBe('t1');
  });
});

describe('travail — vérification des saisies reçues sans fenêtre', () => {
  it('noAsk avec champ obligatoire vide : travail refusé avec message', async () => {
    const toast = vi.spyOn(useStore.getState(), 'toast');
    expect(await startJob('zpl-fichier', { doc: model('M', 'Lot {{?Lot|obligatoire}}'), noAsk: true })).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Saisie invalide.*Lot : Champ obligatoire/), 'error');
    expect(downloadText).not.toHaveBeenCalled();
    expect(await listHistory()).toEqual([]);
    toast.mockRestore();
  });

  it('valeurs imposées (API) invalides : GTIN refusé', async () => {
    const toast = vi.spyOn(useStore.getState(), 'toast');
    expect(await startJob('zpl-fichier', { doc: model('M', '{{?GTIN|gtin}}'), prompts: { GTIN: '3012345678901' } })).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/GTIN : Clé de contrôle GTIN incorrecte/), 'error');
    expect(downloadText).not.toHaveBeenCalled();
    toast.mockRestore();
  });

  it('valeurs imposées valides : travail effectué', async () => {
    expect(await startJob('zpl-fichier', { doc: model('M', '{{?GTIN|gtin}} {{?Qté|min:1|max:10}}'), prompts: { GTIN: '3012345678902', 'Qté': '4' } })).toBe(1);
  });

  it('fenêtre de saisie : la demande porte la description des champs', async () => {
    const p = startJob('zpl-fichier', { doc: model('M', '{{?Lot|obligatoire}} {{?Ligne|liste:A;B}}') });
    await new Promise((r) => setTimeout(r, 0));
    const ask = useStore.getState().promptAsk!;
    expect(ask.fields).toEqual(['Lot', 'Ligne']);
    expect(ask.specs).toEqual([
      { name: 'Lot', type: 'text', required: true },
      { name: 'Ligne', type: 'list', required: false, choices: ['A', 'B'] },
    ]);
    ask.resolve(null);
    expect(await p).toBeNull();
  });

  it('réimpression : saisie devenue invalide refusée', async () => {
    await startJob('zpl-fichier', { doc: model(), prompts: { Lot: '' } });
    const [e] = await listHistory();
    const bad = { ...e, doc: { ...e.doc, elements: [{ ...e.doc.elements[0], text: '{{?Lot|obligatoire}}' } as LabelDoc['elements'][number]] } };
    expect(await reprint(bad)).toBe(false);
  });
});

describe('travail — SSCC', () => {
  function palette(count = 2): LabelDoc {
    const d = model('Palette', 'Palette');
    d.elements.push({ ...makeBarcode(d, 'sscc18', '{{#sscc}}'), id: 'b1' });
    d.numbering = { ...d.numbering, count };
    return d;
  }

  it('aucun préfixe configuré : travail refusé', async () => {
    const toast = vi.spyOn(useStore.getState(), 'toast');
    expect(await startJob('zpl-fichier', { doc: palette() })).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Aucun préfixe entreprise GS1/), 'error');
    expect(downloadText).not.toHaveBeenCalled();
    toast.mockRestore();
  });

  it('succès : une étiquette = un SSCC, plage consommée, journal et historique, réimpression identique', async () => {
    await saveSsccSettings({ prefix: '3012345', extension: 1 });
    expect(await startJob('zpl-fichier', { doc: palette(2) })).toBe(2);
    const zpl = vi.mocked(downloadText).mock.calls[0][0];
    expect(zpl).toContain(composeSscc(1, '3012345', 0).slice(0, 17));
    expect(zpl).toContain(composeSscc(1, '3012345', 1).slice(0, 17));
    expect(nextSerial(getSsccConfig())).toBe(2);
    expect(await listSsccLog()).toHaveLength(1);
    const [e] = await listHistory();
    expect((e.doc as SsccDoc).ssccJob).toMatchObject({ start: 0, indices: [0, 1] });
    expect(historyDocForEditing(e)).not.toHaveProperty('ssccJob');
    expect(await reprint(e)).toBe(true);
    expect(vi.mocked(downloadText).mock.calls[1][0]).toBe(zpl);
    expect(nextSerial(getSsccConfig())).toBe(2); // la réimpression ne consomme rien
    // travail suivant : plage suivante
    await startJob('zpl-fichier', { doc: palette(1) });
    expect(vi.mocked(downloadText).mock.calls[2][0]).toContain(composeSscc(1, '3012345', 2).slice(0, 17));
  });

  it('copies ×N d’une ligne : même SSCC ; lignes différentes : SSCC différents', async () => {
    await saveSsccSettings({ prefix: '3012345' });
    const d = palette();
    d.data = { columns: ['a'], rows: [{ a: '1' }, { a: '2' }, { a: '3' }], checked: [true, false, true], copies: [3, 1, 2] };
    expect(await startJob('zpl-fichier', { doc: d })).toBe(5);
    expect(nextSerial(getSsccConfig())).toBe(2);
    const [log] = await listSsccLog();
    expect(log).toMatchObject({ count: 2, indices: [0, 2], hasData: true });
  });

  it('échec du travail : aucune plage consommée', async () => {
    await saveSsccSettings({ prefix: '3012345' });
    vi.mocked(downloadText).mockImplementationOnce(() => {
      throw new Error('disque plein');
    });
    expect(await startJob('zpl-fichier', { doc: palette(3) })).toBeNull();
    expect(nextSerial(getSsccConfig())).toBe(0);
    expect(await listSsccLog()).toEqual([]);
    expect(await listHistory()).toEqual([]);
  });
});
