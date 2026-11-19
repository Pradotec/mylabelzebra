import { describe, it, expect, beforeEach, vi } from 'vitest';

// stockage plein : kvSet rejette (quota) ; zebra : impression simulée
vi.mock('./storage', async (orig) => {
  const m = await orig<typeof import('./storage')>();
  return { ...m, kvSet: vi.fn(async () => Promise.reject(new m.StorageFullError())), kvGet: vi.fn(async () => undefined) };
});
vi.mock('./zebra', async (orig) => {
  const m = await orig<typeof import('./zebra')>();
  return {
    ...m,
    lastPrinter: () => ({ name: 'ZD421', uid: 'z' }),
    savedSettings: () => ({}),
    settingsZpl: () => '',
    write: vi.fn(async () => undefined),
  };
});

import { saveCurrent, deleteSaved, renameSaved, duplicateSaved, sendToZebra } from './actions';
import { useStore } from './store';
import { newDoc, makeText, normalizeDoc } from './elements';
import { symbologyFromParam } from './urlParams';

const S = () => useStore.getState();
const lastToast = () => S().toasts[S().toasts.length - 1];

beforeEach(() => {
  const d = newDoc();
  d.elements = [makeText(d, 'N° {{numero}}')];
  S().loadDoc(d);
});

describe('Mes étiquettes : échec d’écriture', () => {
  it('saveCurrent : message « stockage plein » et false, document toujours « modifié »', async () => {
    useStore.setState({ dirty: true });
    expect(await saveCurrent()).toBe(false);
    expect(lastToast()).toMatchObject({ kind: 'error' });
    expect(lastToast().msg).toMatch(/Stockage du navigateur plein/);
    expect(S().dirty).toBe(true);
  });
  it('deleteSaved / renameSaved / duplicateSaved : false + message', async () => {
    expect(await deleteSaved('x')).toBe(false);
    expect(await renameSaved('x', 'y')).toBe(false);
    expect(await duplicateSaved('x')).toBe(false); // introuvable : pas d'écriture
    expect(lastToast().kind).toBe('error');
  });
});

describe('avance automatique du compteur après impression Zebra', () => {
  it('répétition et pas : serialNextStart', async () => {
    S().setDoc((d) => void (d.numbering = { ...d.numbering, start: 1, step: 2, count: 5, repeat: 2 }));
    expect(await sendToZebra('^XA^XZ')).toBe(true);
    // 5 étiquettes, même numéro sur 2 → 3 numéros utilisés (1, 3, 5) → départ suivant 7
    expect(S().doc.numbering.start).toBe(7);
    expect(lastToast().msg).toContain('7');
  });
  it('base 36 : message en base 36', async () => {
    S().setDoc((d) => void (d.numbering = { ...d.numbering, start: 35, step: 1, count: 1, alpha: true, repeat: 1 }));
    await sendToZebra('^XA^XZ');
    expect(S().doc.numbering.start).toBe(36);
    expect(lastToast().msg).toContain('10');
  });
});

describe('normalizeDoc : plage SSCC d’un travail', () => {
  it('retirée pour un document édité, conservée sur demande', () => {
    const job = { ...newDoc(), ssccJob: { prefix: '3012345', extension: 0, start: 1, indices: [0] } };
    expect(normalizeDoc(job).ssccJob).toBeUndefined();
    expect(normalizeDoc(job, { keepJob: true }).ssccJob).toEqual(job.ssccJob);
  });
  it('rouleau à 1 colonne : supprimé', () => {
    expect(normalizeDoc({ ...newDoc(), roll: { columns: 1, gapMm: 2, leftMm: 0 } }).roll).toBeUndefined();
    expect(normalizeDoc({ ...newDoc(), roll: { columns: 2, gapMm: 2, leftMm: 0 } }).roll?.columns).toBe(2);
  });
});

describe('liens pré-remplis : symbologies', () => {
  it('nouvelles symbologies et alias', () => {
    expect(symbologyFromParam('pdf417')).toBe('pdf417');
    expect(symbologyFromParam('AZTEC')).toBe('azteccode');
    expect(symbologyFromParam('gs1datamatrix')).toBe('gs1datamatrix');
    expect(symbologyFromParam('gs1qrcode')).toBe('gs1qrcode');
    expect(symbologyFromParam('gs1dlqrcode')).toBe('gs1dlqrcode');
    expect(symbologyFromParam('databaromni')).toBe('databaromni');
    expect(symbologyFromParam('databarstackedomni')).toBe('databarstackedomni');
    expect(symbologyFromParam('databarexpanded')).toBe('databarexpanded');
    expect(symbologyFromParam('rationalizedcodabar')).toBe('rationalizedCodabar');
    expect(symbologyFromParam('inconnu')).toBe('code128');
  });
});
