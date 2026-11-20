import { describe, it, expect, beforeEach, vi } from 'vitest';

// stockage clé/valeur en mémoire (IndexedDB absent sous happy-dom)
const mem = vi.hoisted(() => ({ kv: new Map<string, unknown>() }));
vi.mock('./storage', async (orig) => {
  const real = await orig<typeof import('./storage')>();
  return {
    ...real,
    kvGet: vi.fn(async (k: string) => (mem.kv.has(k) ? structuredClone(mem.kv.get(k)) : undefined)),
    kvSet: vi.fn(async (k: string, v: unknown) => void mem.kv.set(k, structuredClone(v))),
    kvDel: vi.fn(async (k: string) => void mem.kv.delete(k)),
    kvUpdate: vi.fn(async (k: string, fn: (old: unknown) => unknown) => {
      const v = fn(mem.kv.has(k) ? structuredClone(mem.kv.get(k)) : undefined);
      mem.kv.set(k, structuredClone(v));
      return v;
    }),
  };
});

// module Zebra simulé : écritures mémorisées, états ~HS programmables
const zb = vi.hoisted(() => ({ writes: [] as string[], statuses: [] as unknown[], failWrites: 0, onCheck: null as null | ((n: number) => void), checks: 0 }));
vi.mock('./zebra', async (orig) => {
  const m = await orig<typeof import('./zebra')>();
  return {
    ...m,
    lastPrinter: () => ({ name: 'ZD421', uid: 'z', connection: 'usb', deviceType: 'printer' }),
    getDefaultPrinter: async () => null,
    savedSettings: () => ({}),
    settingsZpl: () => '',
    write: vi.fn(async (_d: unknown, data: string) => {
      if (zb.failWrites > 0) {
        zb.failWrites--;
        throw new Error('connexion perdue');
      }
      zb.writes.push(data);
    }),
    checkReady: vi.fn(async () => {
      zb.checks++;
      zb.onCheck?.(zb.checks);
      return zb.statuses.length ? zb.statuses.shift() : { state: 'ready', status: m.parseHostStatus('') };
    }),
  };
});

import { startJob, startJobDetailed, listHistory, reprint, resumeHistory, resumeJobs, plannedCount, isIncomplete, hashString, _resetHistoryForTests, type HistoryEntry, type SsccLogEntryExt } from './jobs';
import { splitChunks, skipLabels, mergeJobs, setChunkSize } from './actions';
import { useQueue, cancelJob, resumeJob, forceJob, pauseJob, _resetQueueForTests } from './printQueue';
import { newDoc, makeText, makeBarcode } from './elements';
import { useStore } from './store';
import type { LabelDoc } from './types';
import { saveSsccSettings, loadSscc, getSsccConfig, nextSerial, listSsccLog, composeSscc, _resetSsccForTests } from './sscc';

const S = () => useStore.getState();
const notReady = (problems: string[]) => ({ state: 'notReady', status: {}, problems });
const unknown = { state: 'unknown' };
const labelsIn = (zpl: string) => (zpl.match(/\^XA/g) || []).length;

async function waitFor(fn: () => boolean) {
  for (let i = 0; i < 500 && !fn(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(fn()).toBe(true);
}
const item = () => useQueue.getState().items[useQueue.getState().items.length - 1];

/** Série numérotée de n étiquettes (une par numéro) */
function serialDoc(n: number): LabelDoc {
  const d = newDoc({ name: 'Série', widthIn: 2, heightIn: 1 });
  d.elements = [{ ...makeText(d, 'N° {{numero}}'), id: 't1' }];
  d.numbering = { ...d.numbering, start: 1, step: 1, count: n, repeat: 1 };
  return d;
}
function palette(n: number): LabelDoc {
  const d = newDoc({ name: 'Palette', widthIn: 2, heightIn: 1 });
  d.elements = [{ ...makeBarcode(d, 'sscc18', '{{#sscc}}'), id: 'b1' }];
  d.numbering = { ...d.numbering, count: n };
  return d;
}

beforeEach(async () => {
  mem.kv.clear();
  localStorage.clear();
  zb.writes.length = 0;
  zb.statuses.length = 0;
  zb.failWrites = 0;
  zb.onCheck = null;
  zb.checks = 0;
  _resetHistoryForTests();
  _resetQueueForTests();
  _resetSsccForTests();
  await loadSscc();
  useStore.setState({ promptAsk: null });
});

describe('découpage en paquets', () => {
  it('paquets d’au plus N étiquettes, copies réparties', () => {
    expect(splitChunks([{ index: 0, copies: 120 }], 50)).toEqual([[{ index: 0, copies: 50 }], [{ index: 0, copies: 50 }], [{ index: 0, copies: 20 }]]);
    expect(splitChunks([{ index: 0, copies: 30 }, { index: 1, copies: 30 }], 50)).toEqual([
      [{ index: 0, copies: 30 }, { index: 1, copies: 20 }],
      [{ index: 1, copies: 10 }],
    ]);
  });
  it('sans coupure des copies (SSCC) : une étiquette reste entière', () => {
    expect(splitChunks([{ index: 0, copies: 30 }, { index: 1, copies: 30 }], 50, false)).toEqual([[{ index: 0, copies: 30 }], [{ index: 1, copies: 30 }]]);
  });
  it('skipLabels / mergeJobs', () => {
    expect(skipLabels([{ index: 0, copies: 3 }, { index: 1, copies: 2 }], 4)).toEqual([{ index: 1, copies: 1 }]);
    expect(mergeJobs([{ index: 0, copies: 1 }, { index: 0, copies: 2 }, { index: 1, copies: 1 }])).toEqual([{ index: 0, copies: 3 }, { index: 1, copies: 1 }]);
  });
});

describe('envoi Zebra fiabilisé', () => {
  it('lot de 120 : 3 paquets, état vérifié avant chacun, numérotation avancée, historique complet', async () => {
    S().loadDoc(serialDoc(120));
    expect(await startJob('zebra')).toBe(120);
    expect(zb.writes).toHaveLength(3);
    expect(zb.writes.map(labelsIn)).toEqual([50, 50, 20]);
    expect(zb.checks).toBe(3);
    expect(S().doc.numbering.start).toBe(121);
    const [e] = await listHistory();
    expect(e.count).toBe(120);
    expect(isIncomplete(e)).toBe(false);
    expect(e.planned).toBeUndefined();
    expect(item()).toMatchObject({ status: 'done', sent: 120, total: 120, chunks: 3 });
  });

  it('taille de paquet réglable', async () => {
    setChunkSize(10);
    S().loadDoc(serialDoc(25));
    expect(await startJob('zebra')).toBe(25);
    expect(zb.writes.map(labelsIn)).toEqual([10, 10, 5]);
  });

  it('imprimante pas prête : pause avec message, Annuler = rien envoyé, rien consommé, pas d’historique', async () => {
    await saveSsccSettings({ prefix: '3012345' });
    zb.statuses.push(notReady(['Plus de papier', 'Tête ouverte']));
    const p = startJob('zebra', { doc: palette(3) });
    await waitFor(() => item()?.status === 'paused');
    expect(item().message).toMatch(/Plus de papier, Tête ouverte/);
    expect(item().canForce).toBe(false);
    cancelJob(item().id);
    expect(await p).toBeNull();
    expect(zb.writes).toHaveLength(0);
    expect(nextSerial(getSsccConfig())).toBe(0);
    expect(await listSsccLog()).toEqual([]);
    expect(await listHistory()).toEqual([]);
    expect(item().status).toBe('cancelled');
  });

  it('pas prête puis Reprendre : nouvelle vérification puis envoi', async () => {
    zb.statuses.push(notReady(['En pause']));
    const p = startJob('zebra', { doc: serialDoc(2) });
    await waitFor(() => item()?.status === 'paused');
    resumeJob(item().id);
    expect(await p).toBe(2);
    expect(zb.checks).toBe(2);
    expect(zb.writes).toHaveLength(1);
  });

  it('état illisible : « Envoyer quand même » proposé, puis plus redemandé pour ce travail', async () => {
    setChunkSize(1);
    zb.statuses.push(unknown, unknown, unknown);
    const p = startJob('zebra', { doc: serialDoc(3) });
    await waitFor(() => item()?.status === 'paused');
    expect(item().canForce).toBe(true);
    expect(item().message).toMatch(/illisible/);
    forceJob(item().id);
    expect(await p).toBe(3);
    expect(zb.writes).toHaveLength(3);
  });

  it('erreur d’envoi d’un paquet : pause, Reprendre renvoie ce paquet', async () => {
    zb.failWrites = 1;
    const p = startJob('zebra', { doc: serialDoc(2) });
    await waitFor(() => item()?.status === 'paused');
    expect(item().message).toMatch(/connexion perdue/);
    resumeJob(item().id);
    expect(await p).toBe(2);
    expect(zb.writes).toHaveLength(1);
  });

  it('pause demandée par l’utilisateur : effective entre deux paquets', async () => {
    zb.onCheck = (n) => {
      if (n === 1) pauseJob(item().id); // pendant le premier paquet
    };
    const p = startJob('zebra', { doc: serialDoc(60) });
    await waitFor(() => item()?.status === 'paused');
    expect(zb.writes).toHaveLength(1);
    expect(item().sent).toBe(50);
    resumeJob(item().id);
    expect(await p).toBe(60);
    expect(zb.writes).toHaveLength(2);
  });

  it('arrêt en cours de lot : historique n / N, SSCC de la plage gardés pour le travail, reprise avec les mêmes SSCC', async () => {
    await saveSsccSettings({ prefix: '3012345', extension: 1 });
    zb.statuses.push({ state: 'ready' }, { state: 'ready' }, notReady(['Plus de ruban']));
    const p = startJobDetailed('zebra', { doc: palette(120) });
    await waitFor(() => item()?.status === 'paused');
    expect(item()).toMatchObject({ sent: 100, chunk: 2, chunks: 3 });
    cancelJob(item().id);
    expect(await p).toMatchObject({ count: 100, planned: 120 });
    expect(item().status).toBe('cancelled');
    expect(item().message).toMatch(/100 étiquette\(s\) sur 120/);
    // plage entière attribuée au travail : jamais réattribuée à un autre
    expect(nextSerial(getSsccConfig())).toBe(120);
    let [log] = (await listSsccLog()) as SsccLogEntryExt[];
    expect(log).toMatchObject({ count: 120, notPrinted: 20 });
    const [e] = await listHistory();
    expect(e).toMatchObject({ count: 100, planned: 120 });
    expect(e.jobs).toHaveLength(100);
    expect(e.remaining).toHaveLength(20);
    expect(e.rows).toEqual([]);
    expect(isIncomplete(e)).toBe(true);
    expect(plannedCount(e)).toBe(120);
    expect(resumeJobs(e, 119)).toEqual([{ index: 118, copies: 1 }, { index: 119, copies: 1 }]);

    // reprise à partir de l'étiquette 101 : mêmes SSCC, rien de neuf consommé
    zb.writes.length = 0;
    const r = await resumeHistory(e);
    expect(r).toMatchObject({ count: 20, planned: 20 });
    expect(zb.writes.join('\n')).toContain(composeSscc(1, '3012345', 100).slice(0, 17));
    expect(zb.writes.join('\n')).not.toContain(composeSscc(1, '3012345', 99).slice(0, 17));
    expect(nextSerial(getSsccConfig())).toBe(120);
    [log] = (await listSsccLog()) as SsccLogEntryExt[];
    expect(log.notPrinted).toBeUndefined();
    const list = await listHistory();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ resumeOf: e.id, count: 20 });
    expect(isIncomplete(list[0])).toBe(false);
  });

  it('travail en attente annulé : jamais exécuté', async () => {
    zb.statuses.push(notReady(['En pause']));
    const p1 = startJob('zebra', { doc: serialDoc(1) });
    const p2 = startJob('zebra', { doc: serialDoc(1) });
    await waitFor(() => useQueue.getState().items[0]?.status === 'paused');
    const [first, second] = useQueue.getState().items;
    expect(second.status).toBe('pending');
    cancelJob(second.id);
    resumeJob(first.id);
    expect(await p1).toBe(1);
    expect(await p2).toBeNull();
    expect(zb.writes).toHaveLength(1);
  });
});

describe('historique : entrées enregistrées avant l’envoi par paquets', () => {
  it('une entrée sans les nouveaux champs se lit, se réimprime et se reprend', async () => {
    const doc = serialDoc(3);
    const at = 1_700_000_000_000;
    const { promptValues: _p, jobDate: _j, ...base } = { ...doc, promptValues: {}, jobDate: at };
    const json = JSON.stringify(base);
    const hash = hashString(json);
    // format v2 tel qu'il est stocké chez les utilisateurs (aucun champ planned / remaining / resumeOf)
    const stored = { id: 'old1', at, name: doc.name, docId: doc.id, kind: 'zebra', count: 3, rows: [], prompts: {}, jobs: [{ index: 0, copies: 1 }, { index: 1, copies: 1 }, { index: 2, copies: 1 }], opts: { currentRow: 0 }, docHash: hash, promptValues: {}, jobDate: at };
    mem.kv.set('jobs.d.' + hash, JSON.parse(json));
    mem.kv.set('jobs.e.old1', stored);
    mem.kv.set('jobs.index', { v: 2, items: [{ id: 'old1', at, doc: hash, size: JSON.stringify(stored).length }], docs: { [hash]: json.length } });

    const [e] = await listHistory();
    expect(e.id).toBe('old1');
    expect(isIncomplete(e)).toBe(false);
    expect(plannedCount(e)).toBe(3);
    expect(resumeJobs(e, 3)).toEqual([{ index: 2, copies: 1 }]);
    expect(await reprint(e as HistoryEntry)).toBe(true);
    expect(zb.writes.map(labelsIn)).toEqual([3]);
    const list = await listHistory();
    expect(list[0]).toMatchObject({ reprintOf: 'old1', count: 3 });
    expect(list[0].planned).toBeUndefined();
    // reprise à partir de l'étiquette 2 d'une ancienne entrée
    zb.writes.length = 0;
    expect(await resumeHistory(e, 2)).toMatchObject({ count: 2 });
    expect(zb.writes.map(labelsIn)).toEqual([2]);
  });
});
