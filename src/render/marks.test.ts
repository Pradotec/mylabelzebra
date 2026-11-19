import { describe, it, expect } from 'vitest';
import { fitOvalText, ovalWidthAt, estimatedSignPaths, healthMarkLines, estimatedHeightMm, ESTIMATED_MIN_MM } from './marks';
import { renderLabel } from './draw';
import { newDoc, makeMark, normalizeDoc } from '../elements';
import { generateLabelZpl, needsRaster } from '../zpl/generate';
import { lintZpl, parseZpl } from '../zpl/parse';
import type { MarkEl } from '../types';

const errors = (z: string) => lintZpl(z).filter((x) => x.level === 'error');
const measure = (s: string, fs: number) => s.length * fs * 0.5;

describe('fitOvalText', () => {
  it('chaque ligne tient dans la corde de l’ellipse à son bord le plus éloigné', () => {
    const lines = ['FR', '75.056.001', 'CE'];
    const a = 100,
      b = 60;
    const f = fitOvalText(lines, measure, a, b);
    expect(f.fontSize).toBeGreaterThan(5);
    lines.forEach((l, i) => {
      const edge = Math.abs(f.ys[i]) + f.fontSize * 0.37;
      expect(edge).toBeLessThanOrEqual(b + 1e-6);
      expect(measure(l, f.fontSize)).toBeLessThanOrEqual(ovalWidthAt(a, b, edge) + 1e-6);
    });
    // optimale : 2 % de plus ne tient plus
    const g = f.fontSize * 1.02;
    const ys = lines.map((_, i) => (i - 1) * g * 1.12);
    expect(lines.some((l, i) => Math.abs(ys[i]) + g * 0.37 > b || measure(l, g) > ovalWidthAt(a, b, Math.abs(ys[i]) + g * 0.37))).toBe(true);
    // lignes symétriques autour du centre
    expect(f.ys[0]).toBeCloseTo(-f.ys[2]);
  });
  it('aucune ligne : taille 0', () => {
    expect(fitOvalText([], measure, 10, 10).fontSize).toBe(0);
  });
  it('lignes vides retirées', () => {
    expect(healthMarkLines({ country: 'FR', approval: ' ', suffix: 'CE' })).toEqual(['FR', 'CE']);
  });
});

describe('signe ℮', () => {
  it('deux tracés fermés dans la boîte 100 × 100', () => {
    const p = estimatedSignPaths();
    expect(p).toHaveLength(2);
    for (const d of p) {
      expect(d.endsWith('Z')).toBe(true);
      for (const n of d.match(/-?\d+(\.\d+)?/g)!.map(Number)) {
        expect(n).toBeGreaterThanOrEqual(-0.001);
        expect(n).toBeLessThanOrEqual(100.001);
      }
    }
  });
  it('hauteur en mm et minimum légal de 3 mm', () => {
    expect(ESTIMATED_MIN_MM).toBe(3);
    expect(estimatedHeightMm({ w: 24, h: 24 })).toBeCloseTo(3.003, 2);
    const d = newDoc();
    const e = makeMark(d, 'estimated');
    expect(estimatedHeightMm(e)).toBeGreaterThanOrEqual(3);
  });
  it('ZPL : image ^GFA, lint sans erreur', async () => {
    const d = newDoc({ dpi: 300 });
    const e = { ...makeMark(d, 'estimated'), x: 40, y: 40 };
    d.elements = [e];
    expect(needsRaster(e)).toBe(true);
    const z = generateLabelZpl(d);
    expect(z).toMatch(/\^FO\d+,\d+\^GFA,/);
    expect(errors(z)).toEqual([]);
    const [lab] = await parseZpl(z);
    expect(lab.ops.some((o) => o.k === 'image')).toBe(true);
  });
  it('rendu écran : pixels noirs dans l’anneau, centre de la boucle haute blanc', () => {
    const d = newDoc({ widthIn: 1, heightIn: 1 });
    const e: MarkEl = { ...makeMark(d, 'estimated'), x: 0, y: 0, w: 200, h: 200 };
    d.elements = [e];
    const c = renderLabel(d, { scale: 1 }).getContext('2d')!;
    const at = (x: number, y: number) => c.getImageData(x, y, 1, 1).data[0];
    expect(at(100, 4)).toBeLessThan(128); // haut de l'anneau
    expect(at(100, 100)).toBeLessThan(128); // barre médiane
    expect(at(100, 50)).toBeGreaterThan(128); // intérieur de la boucle
    expect(at(185, 140)).toBeGreaterThan(128); // ouverture en bas à droite
  });
});

describe('estampille sanitaire', () => {
  it('ZPL natif : ^GE aux dimensions de la boîte + une ligne ^A0 centrée par mention, lint OK', async () => {
    const d = newDoc({ dpi: 203 });
    const m = { ...makeMark(d, 'health'), x: 100, y: 50 };
    d.elements = [m];
    const z = generateLabelZpl(d);
    expect(z).toContain(`^FO100,50^GE${Math.round(m.w)},${Math.round(m.h)},3,B^FS`);
    expect(z).toMatch(/\^A0N,\d+,\d+\^FB\d+,1,0,C,0\^FH\^FDFR\^FS/);
    expect(z).toContain('^FD75.056.001^FS');
    expect(z).toContain('^FDCE^FS');
    expect(z).not.toContain('^GFA');
    expect(errors(z)).toEqual([]);
    const [lab] = await parseZpl(z);
    const ell = lab.ops.find((o) => o.k === 'ellipse');
    expect(ell).toMatchObject({ x: 100, y: 50, w: Math.round(m.w), h: Math.round(m.h), t: 3 });
    const texts = lab.ops.filter((o) => o.k === 'text').map((o) => (o as { text: string }).text);
    expect(texts).toEqual(['FR', '75.056.001', 'CE']);
  });
  it('numéro d’agrément avec champ de données, option « UE »', () => {
    const d = newDoc();
    d.elements = [{ ...makeMark(d, 'health'), approval: '{{agr}}', suffix: 'UE' }];
    d.data = { columns: ['agr'], rows: [{ agr: '29.019.002' }], checked: [true], copies: [1] };
    const z = generateLabelZpl(d, { index: 0 });
    expect(z).toContain('^FD29.019.002^FS');
    expect(z).toContain('^FDUE^FS');
  });
  it('rotation ou police non linéale → image', () => {
    const d = newDoc();
    const m = makeMark(d, 'health');
    expect(needsRaster({ ...m, rotation: 90 })).toBe(true);
    expect(needsRaster({ ...m, fontFamily: 'Georgia' })).toBe(true);
    expect(needsRaster(m)).toBe(false);
  });
  it('normalizeDoc complète une marque incomplète', () => {
    const d = normalizeDoc({ elements: [{ id: 'm', type: 'mark', kind: 'health', x: 0, y: 0, w: 100, h: 60, rotation: 0 } as unknown as MarkEl] });
    const m = d.elements[0] as MarkEl;
    expect(m.country).toBe('');
    expect(m.strokeWidth).toBe(3);
    expect(m.color).toBe('#000000');
  });
});
