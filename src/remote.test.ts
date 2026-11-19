import { describe, it, expect, beforeEach, vi } from 'vitest';

const mem = vi.hoisted(() => ({ kv: new Map<string, unknown>() }));
vi.mock('./storage', async (orig) => {
  const real = await orig<typeof import('./storage')>();
  return {
    ...real,
    kvGet: vi.fn(async (k: string) => (mem.kv.has(k) ? structuredClone(mem.kv.get(k)) : undefined)),
    kvSet: vi.fn(async (k: string, v: unknown) => void mem.kv.set(k, structuredClone(v))),
    kvDel: vi.fn(async (k: string) => void mem.kv.delete(k)),
  };
});
vi.mock('./util', async (orig) => ({ ...(await orig<typeof import('./util')>()), downloadText: vi.fn() }));

import { decodeBase64Url, encodeBase64Url, parseRemoteUrl, rowsToData, runRemote, setAutoPrint, editorCopy, startRemoteUrl } from './remote';
import { useStore } from './store';
import { newDoc, makeText } from './elements';
import { downloadText } from './util';
import { _resetHistoryForTests } from './jobs';
import type { LabelDoc } from './types';

const S = () => useStore.getState();

function saveModel(): LabelDoc {
  const d = newDoc({ name: 'Colis', widthIn: 2, heightIn: 1 });
  d.id = 'model-1';
  d.elements = [{ ...makeText(d, '{{nom}}'), id: 't' }];
  mem.kv.set('saved', [{ doc: d, thumb: '', savedAt: 1 }]);
  return d;
}

function editorWithWork(dirty: boolean) {
  const d = newDoc({ name: 'Travail en cours' });
  d.id = 'work';
  d.elements = [{ ...makeText(d, 'à garder'), id: 'w' }];
  S().loadDoc(d);
  useStore.setState({ dirty, ready: true, remoteRequest: null });
}

/** Attend que le bandeau de confirmation apparaisse (ou que la demande se termine) */
async function waitRequest(p: Promise<unknown>) {
  let done = false;
  void p.then(() => (done = true));
  for (let i = 0; i < 50 && !S().remoteRequest && !done; i++) await new Promise((r) => setTimeout(r, 0));
  return S().remoteRequest;
}

beforeEach(() => {
  mem.kv.clear();
  localStorage.clear();
  _resetHistoryForTests();
  vi.mocked(downloadText).mockClear();
  saveModel();
});

describe('base64url', () => {
  it('aller-retour, accents et caractères hors BMP', () => {
    const s = JSON.stringify([{ nom: 'Crème brûlée €', emoji: '📦', x: '?&=/+' }]);
    const enc = encodeBase64Url(s);
    expect(enc).not.toMatch(/[+/=]/);
    expect(decodeBase64Url(enc)).toBe(s);
  });

  it('accepte toutes les longueurs (padding absent)', () => {
    for (const s of ['a', 'ab', 'abc', 'abcd', 'abcde']) expect(decodeBase64Url(encodeBase64Url(s))).toBe(s);
  });

  it('compatible avec un encodeur base64url indépendant (Node), avec ou sans « = »', () => {
    const s = '[{"nom":"été","q":"a?b>c"}]';
    const ext = Buffer.from(s, 'utf8').toString('base64url');
    expect(decodeBase64Url(ext)).toBe(s);
    expect(encodeBase64Url(s)).toBe(ext);
    const padded = Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    expect(decodeBase64Url(padded)).toBe(s);
  });
});

describe('paramètres du lien', () => {
  it('sans « modele » : pas de demande', () => {
    expect(parseRemoteUrl('?data=abc')).toBeNull();
  });

  it('décode modele, data (objet ou tableau), imprimer, copies et invite.*', () => {
    const data = encodeBase64Url(JSON.stringify({ nom: 'A' }));
    const j = parseRemoteUrl(`?modele=Colis&data=${data}&imprimer=zebra&copies=3&invite.Lot=L1&invite.DLC=2026-01-01`);
    expect(j).toEqual({ modele: 'Colis', rows: [{ nom: 'A' }], prompts: { Lot: 'L1', DLC: '2026-01-01' }, imprimer: 'zebra', copies: 3, source: 'url' });
    const j2 = parseRemoteUrl(`?modele=Colis&data=${encodeBase64Url('[{"nom":"A"},{"nom":"B"}]')}`);
    expect(j2 && 'rows' in j2 && j2.rows).toHaveLength(2);
  });

  it('copies non numériques ignorées, data illisible signalée', () => {
    const j = parseRemoteUrl('?modele=X&copies=abc');
    expect(j && 'copies' in j && j.copies).toBeUndefined();
    expect(parseRemoteUrl('?modele=X&data=%%%')).toHaveProperty('error');
  });

  it('le lien est effacé de la barre d’adresse après lecture (pas de réimpression en rafraîchissant)', async () => {
    history.replaceState(null, '', '/?modele=Colis&lang=en');
    editorWithWork(false);
    const p = startRemoteUrl();
    expect(p).not.toBeNull();
    expect(location.search).toBe('?lang=en');
    await p;
  });

  it('rowsToData : colonnes réunies, lignes cochées, copies bornées', () => {
    const d = rowsToData([{ a: 1 }, { b: { x: 1 }, a: null }], 5000);
    expect(d.columns).toEqual(['a', 'b']);
    expect(d.rows[1]).toEqual({ a: '', b: '{"x":1}' });
    expect(d.checked).toEqual([true, true]);
    expect(d.copies).toEqual([999, 999]);
  });
});

describe('confirmation avant de remplacer l’étiquette en cours', () => {
  it('ouverture simple, étiquette en cours enregistrée : chargée sans confirmation, reste « modifiée »', async () => {
    editorWithWork(false);
    const res = await runRemote({ modele: 'Colis', source: 'https://erp.example' });
    expect(res.ok).toBe(true);
    expect(S().doc.id).toBe('model-1');
    expect(S().dirty).toBe(true);
  });

  it('ouverture simple, modifications non enregistrées : confirmation ; refus = rien ne change', async () => {
    editorWithWork(true);
    const p = runRemote({ modele: 'Colis', rows: [{ nom: 'A' }], source: 'https://erp.example' });
    const req = await waitRequest(p);
    expect(req).toMatchObject({ open: true, unsaved: true, docName: 'Colis' });
    expect(S().doc.id).toBe('work'); // pas encore remplacée
    req!.resolve(false, false);
    const res = await p;
    expect(res.ok).toBe(false);
    expect(S().doc.id).toBe('work');
    expect(S().doc.elements[0].id).toBe('w');
  });

  it('données injectées : la copie ouverte ne remplace pas le modèle à l’enregistrement', async () => {
    editorWithWork(false);
    await runRemote({ modele: 'Colis', rows: [{ nom: 'A' }, { nom: 'B' }], source: 'url' });
    expect(S().doc.id).not.toBe('model-1');
    expect(S().doc.name).toContain('Colis');
    expect(S().doc.name).not.toBe('Colis');
    expect(S().doc.data?.rows).toHaveLength(2);
    expect(S().dirty).toBe(true);
    const m = newDoc();
    expect(editorCopy(m, false).id).toBe(m.id);
  });

  it('impression : confirmation (avec avertissement si non enregistré), puis impression', async () => {
    editorWithWork(true);
    const p = runRemote({ modele: 'Colis', rows: [{ nom: 'A' }], imprimer: 'zpl', source: 'https://erp.example' });
    const req = await waitRequest(p);
    expect(req).toMatchObject({ open: false, unsaved: true, count: 1 });
    expect(S().doc.id).toBe('work');
    req!.resolve(true, false);
    const res = await p;
    expect(res).toEqual({ ok: true, count: 1 });
    expect(downloadText).toHaveBeenCalledTimes(1);
    expect(S().doc.data?.rows[0].nom).toBe('A');
  });

  it('impression automatique autorisée + travail non enregistré : imprime sans remplacer', async () => {
    setAutoPrint('model-1', 'Colis', 'https://erp.example', true);
    editorWithWork(true);
    const res = await runRemote({ modele: 'Colis', rows: [{ nom: 'A' }], imprimer: 'zpl', source: 'https://erp.example' });
    expect(res).toEqual({ ok: true, count: 1 });
    expect(S().remoteRequest).toBeNull();
    expect(S().doc.id).toBe('work');
    expect(downloadText).toHaveBeenCalledTimes(1);
    expect(vi.mocked(downloadText).mock.calls[0][0]).toContain('A');
  });

  it('impression automatique autorisée pour une AUTRE origine : confirmation demandée', async () => {
    setAutoPrint('model-1', 'Colis', 'https://autre.example', true);
    editorWithWork(false);
    const p = runRemote({ modele: 'Colis', imprimer: 'zpl', source: 'https://erp.example' });
    const req = await waitRequest(p);
    expect(req).not.toBeNull();
    req!.resolve(false, false);
    expect((await p).ok).toBe(false);
    expect(downloadText).not.toHaveBeenCalled();
  });

  it('« imprimer » inconnu : refusé sans toucher à l’étiquette en cours', async () => {
    editorWithWork(true);
    const res = await runRemote({ modele: 'Colis', imprimer: 'fax', source: 'url' });
    expect(res.ok).toBe(false);
    expect(S().doc.id).toBe('work');
    expect(S().remoteRequest).toBeNull();
  });

  it('modèle introuvable', async () => {
    const res = await runRemote({ modele: 'Inconnu', source: 'url' });
    expect(res.ok).toBe(false);
  });
});
