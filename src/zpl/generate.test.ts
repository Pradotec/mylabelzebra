import { describe, it, expect } from 'vitest';
import { generateLabelZpl, generateBatchZpl, fd, needsRaster } from './generate';
import { decodeGfaHex } from './gfa';
import { parseZpl } from './parse';
import { newDoc, makeText, makeShape, makeBarcode, makeQr } from '../elements';
import type { LabelDoc, LabelElement, TextEl, ShapeEl, BarcodeEl } from '../types';

function docWith(els: (d: LabelDoc) => LabelElement[], partial: Partial<LabelDoc> = {}) {
  const d = newDoc(partial);
  d.elements = els(d);
  return d;
}
const text = (d: LabelDoc, s: string, extra: Partial<TextEl> = {}) => ({ ...makeText(d, s), x: 10, y: 20, w: 300, fontSize: 30, ...extra });
const rect = (d: LabelDoc, extra: Partial<ShapeEl> = {}) => ({ ...makeShape(d, 'rect'), x: 50, y: 50, w: 100, h: 100, ...extra });
const bar = (d: LabelDoc, sym: BarcodeEl['symbology'], value: string, extra: Partial<BarcodeEl> = {}) => ({ ...makeBarcode(d, sym, value), x: 20, y: 30, ...extra });

const lines = (zpl: string) => zpl.split('\n');
const count = (zpl: string, re: RegExp) => (zpl.match(new RegExp(re.source, 'g')) || []).length;

/** Extrait les ^GFA de la sortie et les décode */
function gfas(zpl: string) {
  const out: { x: number; y: number; bpr: number; total: number; ones: number; size: number }[] = [];
  const re = /\^FO(\d+),(\d+)\^GFA,(\d+),(\d+),(\d+),([^^]*)\^FS/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(zpl))) {
    const bpr = +m[5],
      total = +m[3];
    const b = decodeGfaHex(m[6], bpr, total);
    out.push({ x: +m[1], y: +m[2], bpr, total, ones: b.bits.reduce((a, v) => a + v, 0), size: b.bits.length });
  }
  return out;
}

describe('generateLabelZpl — en-tête', () => {
  it('^PW / ^LL d’après la taille et la résolution', () => {
    const z203 = generateLabelZpl(newDoc({ widthIn: 4, heightIn: 2, dpi: 203 }));
    expect(lines(z203).slice(0, 5)).toEqual(['^XA', '^CI28', '^PW812', '^LL406', '^LH0,0']);
    expect(z203.endsWith('^PQ1,0,1,Y\n^XZ')).toBe(true);
    const z300 = generateLabelZpl(newDoc({ widthIn: 4, heightIn: 6, dpi: 300 }));
    expect(z300).toContain('^PW1200');
    expect(z300).toContain('^LL1800');
    const z600 = generateLabelZpl(newDoc({ widthIn: 2.25, heightIn: 1.25, dpi: 600 }));
    expect(z600).toContain('^PW1350');
    expect(z600).toContain('^LL750');
  });

  it('copies → ^PQ', () => {
    expect(generateLabelZpl(newDoc(), { copies: 4 })).toContain('^PQ4,0,1,Y');
  });

  it('fd : échappement ^FH de _ ^ ~ et retours à la ligne', () => {
    expect(fd('a_b^c~d\ne')).toBe('a_5Fb_5Ec_7Ed_0Ae');
    expect(fd('éà€')).toBe('éà€');
  });
});

describe('generateLabelZpl — éléments natifs', () => {
  it('texte → ^A0N + ^FB, sans image', () => {
    const doc = docWith((d) => [text(d, 'Bonjour')]);
    const z = generateLabelZpl(doc);
    // y = 20 + (33 − 30)/2 (centrage de la ligne) = 21,5 → 22
    expect(z).toContain('^FO10,22^A0N,30,30^FB300,1,0,L,0^FH^FDBonjour^FS');
    expect(z).not.toContain('^GFA');
  });

  it('texte : taille en points à 300 dpi, alignement centré, plusieurs lignes', () => {
    const doc = docWith((d) => [text(d, 'un\ndeux', { align: 'center' })], { dpi: 300 });
    const z = generateLabelZpl(doc);
    expect(count(z, /\^A0N,44,44/)).toBe(2); // 30 × 300/203 = 44,3
    expect(z).toContain(',C,0^FH^FDun^FS');
    expect(z).toContain(',C,0^FH^FDdeux^FS');
  });

  it('texte : caractères spéciaux échappés, champs résolus', () => {
    const doc = docWith((d) => [text(d, 'A_B {{#}}')], { numbering: { start: 7, step: 1, padding: 2, prefix: '', suffix: '', count: 1 } });
    expect(generateLabelZpl(doc)).toContain('^FDA_5FB 07^FS');
  });

  it('texte blanc sur fond noir (invert) → ^GB noir + ^FR', () => {
    const doc = docWith((d) => [text(d, 'Inv', { invert: true, color: '#000000' })]);
    const z = generateLabelZpl(doc);
    expect(z).toMatch(/\^FO10,20\^GB300,\d+,\d+,B,0\^FS/);
    expect(z).toMatch(/\^FR\^FH\^FDInv\^FS/);
  });

  it('élément masqué ignoré', () => {
    const doc = docWith((d) => [text(d, 'Caché', { hidden: true })]);
    expect(generateLabelZpl(doc)).not.toContain('Caché');
  });

  it('code 128 → ^BY + ^BCN', () => {
    const doc = docWith((d) => [bar(d, 'code128', 'ABC123')]);
    const z = generateLabelZpl(doc);
    expect(z).toMatch(/\^FO\d+,30\^BY\d+,3,\d+\^BCN,\d+,Y,N,N,A\^FH\^FDABC123\^FS/);
    expect(z).not.toContain('^GFA');
  });

  it('EAN-13 → ^BEN avec 12 chiffres (l’imprimante calcule la clé)', () => {
    const doc = docWith((d) => [bar(d, 'ean13', '5901234123457')]);
    expect(generateLabelZpl(doc)).toMatch(/\^BEN,\d+,Y,N\^FH\^FD590123412345\^FS/);
  });

  // GS1 : jeu C explicite (>;) + FNC1 (>8), mots de code identiques à l'écran ;
  // le texte lisible « (00) … » est envoyé à part en image
  it('SSCC-18 → ^BC mode N avec FNC1 explicite, (00) et clé', async () => {
    const doc = docWith((d) => [bar(d, 'sscc18', '10614141234567890')]);
    const z = generateLabelZpl(doc);
    expect(z).toMatch(/\^BCN,\d+,N,N,N,N\^FH\^FD>;>800106141412345678908\^FS/);
    // relu par la visionneuse : l'AI (00) est reconstitué
    const [lab] = await parseZpl(z);
    const op = lab.ops.find((o) => o.k === 'barcode');
    expect(op && op.k === 'barcode' && op.data.replace(/\D/g, '')).toBe('00106141412345678908');
  });

  it('module ^BY : la largeur du code est respectée', () => {
    const doc = docWith((d) => [bar(d, 'code128', 'ABC', { w: 300, showText: false })]);
    // 68 modules dans 300 points → module de 4 points ; texte masqué → N
    expect(generateLabelZpl(doc)).toMatch(/\^BY4,3,\d+\^BCN,\d+,N,/);
  });

  it('Data Matrix → ^BXN ; QR → ^BQN', () => {
    const doc = docWith((d) => [bar(d, 'datamatrix', 'hello'), { ...makeQr(d, 'https://ex.fr'), x: 400, y: 10 }]);
    const z = generateLabelZpl(doc);
    expect(z).toMatch(/\^BXN,\d+,200\^FH\^FDhello\^FS/);
    expect(z).toMatch(/\^FO\d+,10\^BQN,2,\d+\^FH\^FDMA,https:\/\/ex\.fr\^FS/);
  });

  it('code-barres invalide → rien n’est émis', () => {
    const doc = docWith((d) => [bar(d, 'ean13', 'ABC')]);
    const z = generateLabelZpl(doc);
    expect(z).not.toMatch(/\^BE|\^GFA/);
  });

  it('code-barres gris → reste natif (jamais tramé)', () => {
    const doc = docWith((d) => [bar(d, 'code128', 'GRIS', { color: '#666666' })]);
    const z = generateLabelZpl(doc);
    expect(z).toContain('^BCN');
    expect(z).not.toContain('^GFA');
  });

  it('formes : rectangle (contour) → ^GB ; cercle → ^GC ; ligne → ^GB plein', () => {
    const doc = docWith((d) => [
      rect(d, { fill: 'none', stroke: '#000000', strokeWidth: 4 }),
      { ...makeShape(d, 'circle'), x: 300, y: 50, w: 80, h: 80, fill: '#000000', stroke: 'none' },
      { ...makeShape(d, 'line'), x: 10, y: 300, w: 400, h: 3 },
    ]);
    const z = generateLabelZpl(doc);
    expect(z).toContain('^FO50,50^GB100,100,4,B,0^FS');
    expect(z).toContain('^FO300,50^GC80,40,B^FS');
    expect(z).toContain('^FO10,300^GB400,3,3,B,0^FS');
    expect(z).not.toContain('^GFA');
  });

  it('fond noir → ^GB pleine étiquette, fond gris → image complète', () => {
    expect(generateLabelZpl(newDoc({ background: '#000000' }))).toContain('^FO0,0^GB812,406,406,B,0^FS');
    const g = gfas(generateLabelZpl(newDoc({ background: '#888888' })));
    expect(g).toHaveLength(1);
  });

  it('le ZPL natif se relit avec l’interpréteur local', async () => {
    const doc = docWith((d) => [text(d, 'Relu'), bar(d, 'code128', 'XYZ', { y: 200 }), rect(d, { y: 300, h: 50 })]);
    const [label] = await parseZpl(generateLabelZpl(doc));
    expect(label.width).toBe(812);
    expect(label.ops.map((o) => o.k).sort()).toEqual(['barcode', 'box', 'text']);
    expect(label.ops.find((o) => o.k === 'text')).toMatchObject({ text: 'Relu', h: 30 });
    expect(label.ops.find((o) => o.k === 'barcode')).toMatchObject({ sym: 'code128', data: 'XYZ' });
  });
});

describe('generateLabelZpl — images ^GFA', () => {
  it('élément pivoté → ^GFA, pas de commande native', () => {
    const doc = docWith((d) => [bar(d, 'code128', 'ROT', { rotation: 90, showText: false, x: 300, y: 20, w: 200, h: 80 })]);
    expect(needsRaster(doc.elements[0])).toBe(true);
    const z = generateLabelZpl(doc);
    expect(z).not.toContain('^BC');
    const g = gfas(z);
    expect(g).toHaveLength(1);
    // pivoté de 90° autour de (300,20) : la zone noire s'étend vers la gauche, plus haute que large
    expect(g[0].x).toBeLessThan(300);
    expect(g[0].total / g[0].bpr).toBeGreaterThan(g[0].bpr * 8 - 8);
  });

  it('texte pivoté → pas de ^A0 (rendu en image)', () => {
    const doc = docWith((d) => [text(d, 'Vertical', { rotation: 270 })]);
    expect(needsRaster(doc.elements[0])).toBe(true);
    expect(generateLabelZpl(doc)).not.toContain('^A0');
  });

  it('forme grise seule → ^GFA tramé à sa place', () => {
    const doc = docWith((d) => [rect(d, { fill: '#808080', stroke: 'none' })]);
    const z = generateLabelZpl(doc);
    expect(z).not.toContain('^GB');
    const g = gfas(z);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ x: 50, y: 50, bpr: 13, total: 1300 });
    // trame de Bayer à ~50 % : ni plein, ni vide
    const density = g[0].ones / (100 * 100);
    expect(density).toBeGreaterThan(0.4);
    expect(density).toBeLessThan(0.6);
  });

  it('texte gris → ^GFA (pas de ^A0)', () => {
    const doc = docWith((d) => [text(d, 'Gris', { color: '#808080', fontSize: 60 })]);
    const z = generateLabelZpl(doc);
    expect(z).not.toContain('^A0');
  });

  it('forme grise posée sur un élément antérieur → une seule image pour toute l’étiquette', () => {
    const doc = docWith((d) => [rect(d, { fill: '#000000', stroke: 'none' }), rect(d, { x: 100, y: 100, fill: '#c0c0c0', stroke: 'none' })]);
    const z = generateLabelZpl(doc);
    expect(z).not.toContain('^GB');
    const g = gfas(z);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ x: 0, y: 0, bpr: 102, total: 102 * 406 });
    expect(count(z, /\^FO/)).toBe(1);
  });

  it('forme grise sans chevauchement → images séparées, le reste natif', () => {
    const doc = docWith((d) => [rect(d, { fill: '#000000', stroke: 'none' }), rect(d, { x: 400, y: 200, fill: '#c0c0c0', stroke: 'none' })]);
    const z = generateLabelZpl(doc);
    expect(z).toContain('^FO50,50^GB100,100,100,B,0^FS');
    const g = gfas(z);
    expect(g).toHaveLength(1);
    // la boîte englobante suit les points de trame (la 1re rangée peut être blanche)
    expect(g[0].x).toBeGreaterThanOrEqual(400);
    expect(g[0].x).toBeLessThan(408);
    expect(g[0].y).toBeGreaterThanOrEqual(200);
    expect(g[0].y).toBeLessThan(208);
  });

  it('élément gris posé SOUS un élément ultérieur → pas d’image complète', () => {
    // seul un gris dessiné par-dessus un élément antérieur force le rendu complet
    const doc = docWith((d) => [rect(d, { fill: '#c0c0c0', stroke: 'none' }), rect(d, { x: 100, y: 100, fill: '#000000', stroke: 'none' })]);
    const z = generateLabelZpl(doc);
    expect(z).toContain('^FO100,100^GB100,100,100,B,0^FS');
    const g = gfas(z);
    expect(g).toHaveLength(1);
    expect(g[0].x).toBeGreaterThanOrEqual(50);
    expect(g[0].x).toBeLessThan(58);
    expect(g[0].y).toBeGreaterThanOrEqual(50);
    expect(g[0].y).toBeLessThan(58);
  });

  it('doc.zplRaster / opts.raster → image complète', () => {
    const doc = docWith((d) => [text(d, 'Tout en image')], { zplRaster: true });
    const z = generateLabelZpl(doc);
    expect(z).not.toContain('^A0');
    expect(gfas(z)[0]).toMatchObject({ x: 0, y: 0, bpr: 102 });
    const z2 = generateLabelZpl(docWith((d) => [rect(d, { fill: '#000000', stroke: 'none' })]), { raster: true });
    const g = gfas(z2);
    expect(g).toHaveLength(1);
    expect(g[0].ones).toBe(100 * 100);
  });
});

describe('generateBatchZpl', () => {
  it('série numérotée : une étiquette par numéro', () => {
    const doc = docWith((d) => [text(d, 'N{{#}}')], { numbering: { start: 1, step: 1, padding: 3, prefix: '', suffix: '', count: 3 } });
    const z = generateBatchZpl(doc);
    expect(count(z, /\^XA/)).toBe(3);
    expect(z).toContain('^FDN001^FS');
    expect(z).toContain('^FDN003^FS');
  });

  it('données : lignes cochées et copies → ^PQ', () => {
    const doc = docWith((d) => [text(d, '{{nom}}')], {
      data: { columns: ['nom'], rows: [{ nom: 'Ana' }, { nom: 'Bob' }, { nom: 'Cid' }], checked: [true, false, true], copies: [2, 1, 1] },
    });
    const z = generateBatchZpl(doc);
    expect(count(z, /\^XA/)).toBe(2);
    expect(z).toMatch(/\^FDAna\^FS[\s\S]*\^PQ2,0,1,Y[\s\S]*\^FDCid\^FS[\s\S]*\^PQ1,0,1,Y/);
    expect(z).not.toContain('Bob');
  });
});
