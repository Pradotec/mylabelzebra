import { describe, it, expect } from 'vitest';
import { generateJobsZpl, generateBatchZpl, rollRows, rollGeometryDots, generateLabelZpl } from './generate';
import { lintZpl, parseZpl } from './parse';
import { newDoc, makeText, makeShape } from '../elements';
import type { LabelDoc } from '../types';

const errors = (z: string) => lintZpl(z).filter((x) => x.level === 'error');
const formats = (z: string) => z.split('^XZ').filter((s) => s.includes('^XA'));

/** étiquette 1" × 1" à 203 dpi (203 points), un texte {{n}} par ligne et un cadre */
function rollDoc(columns: number, rows = 5): LabelDoc {
  const d = newDoc({ widthIn: 1, heightIn: 1, dpi: 203 });
  d.elements = [
    { ...makeText(d, '{{n}}'), x: 10, y: 10, w: 150, fontSize: 30 },
    { ...makeShape(d, 'rect'), x: 0, y: 0, w: 200, h: 200, strokeWidth: 2 },
  ];
  d.data = {
    columns: ['n'],
    rows: Array.from({ length: rows }, (_, i) => ({ n: 'L' + (i + 1) })),
    checked: Array(rows).fill(true),
    copies: Array(rows).fill(1),
  };
  d.roll = { columns, gapMm: 2.5, leftMm: 1 };
  return d;
}

describe('rollRows', () => {
  it('développe les copies et regroupe les rangées identiques consécutives', () => {
    expect(rollRows([{ index: 0, copies: 5 }], 2)).toEqual([
      { slots: [0, 0], count: 2 },
      { slots: [0], count: 1 },
    ]);
    expect(rollRows([{ index: 0, copies: 1 }, { index: 1, copies: 1 }, { index: 2, copies: 1 }], 3)).toEqual([{ slots: [0, 1, 2], count: 1 }]);
    expect(rollRows([{ index: 0, copies: 2 }, { index: 1, copies: 3 }], 2)).toEqual([
      { slots: [0, 0], count: 1 },
      { slots: [1, 1], count: 1 },
      { slots: [1], count: 1 },
    ]);
  });
});

describe('ZPL rouleau à plusieurs étiquettes de front', () => {
  it('géométrie : ^PW = marge + colonnes + écarts', () => {
    const g = rollGeometryDots(rollDoc(2));
    // 1 mm = 8 points, 2,5 mm = 20 points à 203 dpi
    expect(g).toMatchObject({ W: 203, cols: 2, left: 8, gap: 20, totalW: 8 + 203 * 2 + 20 });
    expect(g.offsets).toEqual([8, 8 + 203 + 20]);
  });

  it('2 colonnes, 5 lignes : 3 formats, dernière rangée incomplète, décalage ^FO, lint OK', async () => {
    const d = rollDoc(2, 5);
    const z = generateBatchZpl(d);
    const f = formats(z);
    expect(f).toHaveLength(3);
    for (const x of f) expect(x).toContain('^PW434');
    expect(f[0]).toMatch(/\^FO18,\d+\^A0N[^\n]*\^FDL1\^FS/);
    expect(f[0]).toMatch(/\^FO241,\d+\^A0N[^\n]*\^FDL2\^FS/);
    expect(f[2]).toContain('^FDL5^FS');
    expect(f[2]).not.toMatch(/\^FO241,/); // colonne 2 vierge
    expect(z.match(/\^PQ1,0,1,Y/g)).toHaveLength(3);
    expect(errors(z)).toEqual([]);
    const labels = await parseZpl(z);
    expect(labels).toHaveLength(3);
    expect(labels[0].width).toBe(434);
    const xs = labels[0].ops.filter((o) => o.k === 'text').map((o) => (o as { x: number }).x);
    expect(xs).toEqual([18, 241]);
  });

  it('3 colonnes : ^PW et décalages des trois colonnes, lint OK', async () => {
    const d = rollDoc(3, 7);
    const z = generateBatchZpl(d);
    const f = formats(z);
    expect(f).toHaveLength(3);
    const g = rollGeometryDots(d);
    expect(g.totalW).toBe(8 + 3 * 203 + 2 * 20);
    expect(f[0]).toContain(`^PW${g.totalW}`);
    expect(f[0]).toContain(`^FO${g.offsets[2]},0^GB`);
    expect(f[1]).toContain('^FDL6^FS');
    expect(f[2]).toContain('^FDL7^FS');
    expect(f[2].match(/\^GB/g)).toHaveLength(1);
    expect(errors(z)).toEqual([]);
    const labels = await parseZpl(z);
    for (const l of labels) for (const o of l.ops) if ('x' in o) expect(o.x).toBeLessThan(g.totalW);
  });

  it('copies : rangées identiques regroupées en ^PQ', () => {
    const d = rollDoc(2, 1);
    d.data!.copies = [5];
    const z = generateJobsZpl(d, [{ index: 0, copies: 5 }]);
    const f = formats(z);
    expect(f).toHaveLength(2);
    expect(f[0]).toContain('^PQ2,0,1,Y');
    expect(f[1]).toContain('^PQ1,0,1,Y');
    expect(errors(z)).toEqual([]);
  });

  it('image ^GFA décalée par colonne (texte forcé en image)', () => {
    const d = rollDoc(2, 2);
    (d.elements[0] as { zplAsImage?: boolean }).zplAsImage = true;
    const z = generateBatchZpl(d);
    const single = generateLabelZpl({ ...d, roll: undefined }, { index: 1 });
    const x1 = Number(/\^FO(\d+),\d+\^GFA/.exec(single)![1]);
    expect(z).toContain(`^FO${x1 + 8 + 203 + 20},`);
    expect(errors(z)).toEqual([]);
  });

  it('1 colonne : sortie inchangée', () => {
    const d = rollDoc(1, 2);
    expect(generateBatchZpl(d)).toBe(generateBatchZpl({ ...d, roll: undefined }));
  });
});
