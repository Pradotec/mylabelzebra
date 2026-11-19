import { describe, it, expect } from 'vitest';
import { generateLabelZpl, generateBatchZpl, needsRaster, rasterElement, rasterStats, tableNeedsRaster } from './generate';
import { lintZpl, parseZpl } from './parse';
import { newDoc, makeTable, makeText, makeShape, makeBarcode } from '../elements';
import { TEMPLATES } from '../templates';
import type { LabelDoc, LabelElement, TableEl } from '../types';

const ctx = (doc: LabelDoc, index = 0) => ({ doc, index, row: doc.data?.rows[index], resolve: true });
const errors = (z: string) => lintZpl(z).filter((x) => x.level === 'error');

function tableDoc(extra: Partial<TableEl> = {}, partial: Partial<LabelDoc> = {}) {
  const d = newDoc(partial);
  const tb: TableEl = { ...makeTable(d, 2, 2), id: 'tb', x: 20, y: 20, w: 600, h: 100, fontSize: 24, cells: [['Nom', 'Qté'], ['Vis', '12']], ...extra };
  d.elements = [tb];
  return d;
}

describe('tableaux en ZPL', () => {
  it('cellules courtes, police linéale → natif ; en-tête gras simulé (double impression décalée d’un point)', async () => {
    const doc = tableDoc();
    expect(needsRaster(doc.elements[0], ctx(doc))).toBe(false);
    const z = generateLabelZpl(doc);
    expect(z).not.toContain('^GFA');
    const nom = z.split('\n').filter((l) => l.includes('^FDNom^FS'));
    expect(nom).toHaveLength(2);
    const xs = nom.map((l) => +/\^FO(\d+),/.exec(l)![1]);
    expect(xs[1] - xs[0]).toBe(1);
    expect(z.split('\n').filter((l) => l.includes('^FDVis^FS'))).toHaveLength(1);
    expect(errors(z)).toEqual([]);
    const [lab] = await parseZpl(z);
    // 2 cellules d'en-tête × 2 (gras simulé) + 2 cellules
    expect(lab.ops.filter((o) => o.k === 'text')).toHaveLength(6);
  });

  it('texte plus large que la cellule (l’écran le rogne) → tout le tableau en image', () => {
    const doc = tableDoc({ cells: [['Nom', 'Qté'], ['Désignation beaucoup trop longue pour la cellule', '12']] });
    expect(tableNeedsRaster(doc.elements[0] as TableEl, ctx(doc))).toBe(true);
    const z = generateLabelZpl(doc);
    expect(z).not.toContain('^A0');
    expect(z).not.toContain('^FB');
    expect(z).toContain('^GFA');
  });

  it('police non disponible sur l’imprimante (Georgia) → image', () => {
    const doc = tableDoc({ fontFamily: 'Georgia' });
    expect(needsRaster(doc.elements[0])).toBe(true);
    expect(generateLabelZpl(doc)).not.toContain('^A0');
  });

  it('police plus haute que la ligne (rognée à l’écran) → image', () => {
    const doc = tableDoc({ fontSize: 60 });
    expect(tableNeedsRaster(doc.elements[0] as TableEl, ctx(doc))).toBe(true);
  });

  it('la règle s’évalue par ligne de données : une valeur longue bascule seulement cette étiquette', () => {
    const doc = tableDoc({ cells: [['Nom', 'Qté'], ['{{nom}}', '1']] }, {
      data: { columns: ['nom'], rows: [{ nom: 'Vis' }, { nom: 'Vis à tête fraisée inox A4 très longue' }], checked: [true, true], copies: [1, 1] },
    });
    const [a, b] = generateBatchZpl(doc).split('^XZ');
    expect(a).toContain('^FDVis^FS');
    expect(a).not.toContain('^GFA');
    expect(b).toContain('^GFA');
  });
});

describe('^GFA par élément : zone de l’élément seulement + cache', () => {
  const rotated = (d: LabelDoc): LabelElement[] => [
    { ...makeText(d, 'Pivoté'), id: 'rot', x: 300, y: 40, w: 200, fontSize: 30, rotation: 90 },
    { ...makeShape(d, 'rect'), id: 'grey', x: 40, y: 200, w: 120, h: 80, fill: '#999999', stroke: 'none' },
    { ...makeBarcode(d, 'databaromni', '09501101530003'), id: 'db', x: 420, y: 250, w: 300, h: 100 },
    { ...makeText(d, '{{nom}}'), id: 'dyn', x: 20, y: 20, w: 200, fontSize: 30, italic: true },
  ];

  it('même sortie octet pour octet que le rendu de toute l’étiquette', () => {
    for (const dpi of [203, 300, 600]) {
      const d = newDoc({ dpi, data: { columns: ['nom'], rows: [{ nom: 'Ana' }], checked: [true], copies: [1] } });
      d.elements = rotated(d);
      for (const el of d.elements) {
        const f0 = rasterStats.fallbacks;
        const fast = rasterElement(d, el, 0);
        expect(rasterStats.fallbacks).toBe(f0); // la zone réduite a suffi
        const full = rasterElement(d, el, 0, { full: true });
        expect(fast.length).toBeGreaterThan(20);
        expect(fast).toBe(full);
      }
    }
  });

  it('éléments sans champ : rendus une seule fois pour tout le lot ; éléments à champ : à chaque ligne', () => {
    const d = newDoc({ data: { columns: ['nom'], rows: [{ nom: 'Ana' }, { nom: 'Bob' }, { nom: 'Cid' }], checked: [true, true, true], copies: [1, 1, 1] } });
    d.elements = rotated(d);
    const r0 = rasterStats.renders,
      h0 = rasterStats.hits;
    const z = generateBatchZpl(d);
    // 3 éléments statiques × 1 rendu + 1 élément dynamique × 3 lignes
    expect(rasterStats.renders - r0).toBe(3 + 3);
    expect(rasterStats.hits - h0).toBe(3 * 2);
    expect(z.match(/\^XA/g)).toHaveLength(3);
    // le ^GFA du texte pivoté est identique sur les trois étiquettes
    const labels = z.split('^XZ').filter((s) => s.includes('^XA'));
    const g = (s: string) => s.split('\n').filter((l) => l.includes('^GFA'));
    expect(g(labels[0])[0]).toBe(g(labels[2])[0]);
    expect(errors(z)).toEqual([]);
  });
});

describe('lintZpl', () => {
  it('ZPL généré pour tous les modèles : aucune erreur', () => {
    for (const tpl of TEMPLATES) {
      const z = generateBatchZpl(tpl.build());
      const errs = errors(z);
      expect(errs, tpl.id + ' : ' + JSON.stringify(errs)).toEqual([]);
    }
  });

  it('^XA / ^XZ manquants, ^FD sans ^FS, avec numéros de ligne', () => {
    const z = ['^XA', '^FO10,10^A0N,30,30^FDBonjour', '^FO10,60^FDSuite^FS', '^XZ', '^XZ', '^XA', '^FO1,1^GB10,10,1^FS'].join('\n');
    const l = lintZpl(z);
    expect(l).toContainEqual(expect.objectContaining({ line: 2, level: 'error', msg: expect.stringMatching(/\^FD sans \^FS/) }));
    expect(l).toContainEqual(expect.objectContaining({ line: 5, level: 'error', msg: expect.stringMatching(/\^XZ sans \^XA/) }));
    expect(l).toContainEqual(expect.objectContaining({ line: 6, level: 'error', msg: expect.stringMatching(/sans \^XZ/) }));
  });

  it('commande inconnue, champ hors étiquette, ^GB qui dépasse', () => {
    const z = '^XA\n^PW400\n^LL200\n^QQ12\n^FO500,10^A0N,20,20^FDx^FS\n^FO300,10^GB200,50,2^FS\n^XZ';
    const l = lintZpl(z);
    expect(l).toContainEqual(expect.objectContaining({ line: 4, level: 'warning', msg: expect.stringContaining('^QQ') }));
    expect(l).toContainEqual(expect.objectContaining({ line: 5, level: 'warning', msg: expect.stringMatching(/hors de l’étiquette/) }));
    expect(l).toContainEqual(expect.objectContaining({ line: 6, level: 'warning', msg: expect.stringMatching(/\^GB dépasse/) }));
  });

  it('données de code-barres invalides (mêmes règles que l’éditeur)', () => {
    const z = '^XA\n^FO10,10^BEN,80,Y,N^FDABC^FS\n^FO10,200^BEN,80,Y,N^FD5901234123457^FS\n^FO10,300^B2N,80,Y,N,N^FD123^FS\n^XZ';
    const l = lintZpl(z).filter((x) => x.level === 'error');
    expect(l.map((x) => x.line)).toEqual([2, 4]);
    expect(l[0].msg).toMatch(/EAN-13/);
  });

  it('^GFA : taille incohérente', () => {
    // 2 octets par ligne, 3 lignes annoncées (6 octets) mais 2 lignes de données
    const bad = '^XA\n^FO0,0^GFA,6,6,2,FFFF0000^FS\n^XZ';
    expect(lintZpl(bad)).toContainEqual(expect.objectContaining({ line: 2, level: 'error', msg: expect.stringMatching(/2 ligne\(s\), 3 annoncée/) }));
    const odd = '^XA\n^FO0,0^GFA,5,5,2,FFFF0000FF^FS\n^XZ';
    expect(lintZpl(odd)).toContainEqual(expect.objectContaining({ level: 'error', msg: expect.stringMatching(/nombre entier de lignes/) }));
    expect(errors('^XA\n^FO0,0^GFA,6,6,2,FFFF0000FFFF^FS\n^XZ')).toEqual([]);
  });
});
