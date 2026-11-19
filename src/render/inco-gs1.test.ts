import { describe, it, expect } from 'vitest';
import { incoCheck, incoThresholdMm, incoPrintSummary, xHeightMm, xHeightRatio, gs1LogisticsCheck, isGs1Logistics } from './draw';
import { batchJobs } from './resolve';
import { newDoc, makeText, makeBarcode } from '../elements';
import { buildDigitalLink, parseDigitalLink, buildGs1, parseGs1, DEFAULT_DL_DOMAIN } from '../components/Gs1Assist';
import { encodeBarcode, type LinearCode } from './codes';
import type { LabelDoc, TextEl, BarcodeEl } from '../types';

const MM = 25.4 / 203;

function incoDoc(extra: Partial<TextEl> = {}, rows: Record<string, string>[] = [{ d: 'Lait' }, { d: 'Lait entier pasteurisé, sucre, cacao maigre' }]) {
  const d: LabelDoc = newDoc({ data: { columns: ['d'], rows, checked: rows.map(() => true), copies: rows.map((_, i) => i + 1) } });
  const el: TextEl = { ...makeText(d, '{{d}}'), id: 'ing', x: 10, y: 10, w: 200, h: 24, fontSize: 20, minFontSize: 6, fit: 'shrinkLine', ellipsis: false, incoMandatory: true, ...extra };
  d.elements = [el];
  return { d, el };
}

describe('INCO — hauteur de x', () => {
  it('seuils : 0,9 mm sous 80 cm², sinon 1,2 mm (non renseigné → 1,2 mm)', () => {
    const { el } = incoDoc();
    expect(incoThresholdMm(el)).toBe(1.2);
    expect(incoThresholdMm({ ...el, incoFaceCm2: 79 })).toBe(0.9);
    expect(incoThresholdMm({ ...el, incoFaceCm2: 80 })).toBe(1.2);
    expect(incoThresholdMm({ ...el, incoFaceCm2: 250 })).toBe(1.2);
  });

  it('hauteur de x = rapport de la police × taille (u → mm) ; police inconnue : 0,52', () => {
    expect(xHeightRatio('Arial')).toBeCloseTo(0.519, 3);
    expect(xHeightRatio('Police inconnue')).toBe(0.52);
    expect(xHeightMm({ fontFamily: 'Arial' }, 20)).toBeCloseTo(0.519 * 20 * MM, 6);
  });

  it('réduction automatique : la ligne longue passe sous 0,9 mm, la courte reste conforme', () => {
    const { d, el } = incoDoc({ incoFaceCm2: 50 });
    const r = incoCheck(el, d);
    expect(r.thresholdMm).toBe(0.9);
    // « Lait » tient à 20 u : 0,519 × 20 × 25,4/203 ≈ 1,30 mm
    expect(r.byIndex.get(0)).toBeCloseTo(1.3, 2);
    // 43 caractères × 0,5 × fs ≤ 200 → fs ≈ 9,3 u → ≈ 0,60 mm
    expect(r.byIndex.get(1)!).toBeLessThan(0.9);
    expect(r.failing).toEqual([1]);
    expect(r.minMm).toBeCloseTo(r.byIndex.get(1)!, 9);
  });

  it('seuil 1,2 mm : une police fixe de 18 u (≈ 1,17 mm) ne suffit pas, 19 u oui', () => {
    const { d, el } = incoDoc({ fit: 'wrapGrow', fontSize: 18 }, [{ d: 'Sel' }]);
    expect(incoCheck(el, d).failing).toEqual([0]);
    expect(incoCheck({ ...el, fontSize: 19 }, d).failing).toEqual([]);
    expect(incoCheck({ ...el, fontSize: 18, incoFaceCm2: 40 }, d).failing).toEqual([]);
  });

  it('avant impression : nombre d’étiquettes concernées, copies comprises', () => {
    const { d } = incoDoc({ incoFaceCm2: 50 });
    // ligne 2 : 2 copies
    expect(incoPrintSummary(d, batchJobs(d))).toEqual({ labels: 2, elements: 1 });
    const off = { ...d, elements: d.elements.map((e) => ({ ...e, incoMandatory: false })) } as LabelDoc;
    expect(incoPrintSummary(off, batchJobs(off))).toEqual({ labels: 0, elements: 0 });
  });
});

describe('Codes logistiques GS1 (SSCC, GS1-128, ITF-14)', () => {
  const ctx = (doc: LabelDoc) => ({ doc, index: 0, resolve: true });
  const sscc = (extra: Partial<BarcodeEl> = {}) => {
    const d = newDoc();
    const el: BarcodeEl = { ...makeBarcode(d, 'sscc18', '00614141000000001'), x: 0, y: 0, ...extra };
    d.elements = [el];
    return { d, el };
  };

  it('ITF : seulement l’ITF-14', () => {
    const d = newDoc();
    expect(isGs1Logistics(makeBarcode(d, 'interleaved2of5'), '12345670')).toBe(false);
    expect(isGs1Logistics(makeBarcode(d, 'interleaved2of5'), '15012345678907')).toBe(true);
    expect(isGs1Logistics(makeBarcode(d, 'code128'), 'ABC')).toBe(false);
  });

  it('défaut 380 × 130 u : barres trop basses (< 31,75 mm) et module trop fin (< 0,495 mm)', () => {
    const { d, el } = sscc();
    const r = gs1LogisticsCheck(el, ctx(d))!;
    expect(r.lowH).toBe(true);
    expect(r.lowX).toBe(true);
  });

  it('grand format : 4 points (0,50 mm) et 260 u de barres (32,5 mm) → conforme', () => {
    const { d, el } = sscc({ w: 812, h: 260 + 22 * 1.15 });
    const enc = encodeBarcode('00614141000000001', 'sscc18') as LinearCode;
    expect(Math.floor(812 / enc.modules)).toBeGreaterThanOrEqual(4);
    const r = gs1LogisticsCheck(el, ctx(d))!;
    expect(r.xMm).toBeGreaterThanOrEqual(0.495);
    expect(r.barMm).toBeCloseTo((260 * 25.4) / 203, 6);
    expect(r.lowH || r.lowX).toBe(false);
  });
});

describe('Assistant GS1 : Digital Link', () => {
  const rows = parseGs1('(01)09501101530003(17)261231(10)ABC 1/2(3103)001250');

  it('chemin /01/GTIN/10/LOT, autres AI en paramètres, valeurs %-encodées', () => {
    const r = buildDigitalLink('', rows);
    expect(r.error).toBeUndefined();
    expect(r.url).toBe(DEFAULT_DL_DOMAIN + '/01/09501101530003/10/ABC%201%2F2?17=261231&3103=001250');
  });

  it('domaine configurable ; GTIN-13 complété à 14 chiffres ; URL acceptée par bwip-js', () => {
    const r = buildDigitalLink('https://exemple.fr/', parseGs1('(01)9501101530003(10)LOT7(17)261231'));
    expect(r.url).toBe('https://exemple.fr/01/09501101530003/10/LOT7?17=261231');
    expect(encodeBarcode(r.url, 'gs1dlqrcode').error).toBeUndefined();
  });

  it('erreurs : GTIN absent, domaine invalide', () => {
    expect(buildDigitalLink('', parseGs1('(10)LOT')).error).toMatch(/GTIN/);
    expect(buildDigitalLink('exemple.fr', rows).error).toMatch(/Domaine/);
  });

  it('relecture URL → AI (aller-retour)', () => {
    const url = buildDigitalLink('https://exemple.fr', rows).url;
    const p = parseDigitalLink(url)!;
    expect(p.domain).toBe('https://exemple.fr');
    expect(buildGs1(p.rows)).toBe(buildGs1(rows));
  });

  it('les {{champs}} restent intacts dans l’URL', () => {
    const r = buildDigitalLink('', parseGs1('(01)09501101530003(10){{lot}}'));
    expect(r.url).toBe(DEFAULT_DL_DOMAIN + '/01/09501101530003/10/{{lot}}');
  });
});
