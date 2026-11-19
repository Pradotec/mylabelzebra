import { describe, it, expect } from 'vitest';
import { parseZpl, fieldTransform, renderZplLabel, zplLabelToElements, type ZOp, type ZLabel } from './parse';
import { canvasToBitmap, blackBounds } from './gfa';

type Op<K extends ZOp['k']> = Extract<ZOp, { k: K }>;

async function one(code: string): Promise<ZLabel> {
  const labels = await parseZpl(code);
  expect(labels).toHaveLength(1);
  return labels[0];
}
async function firstOp<K extends ZOp['k']>(code: string, k: K): Promise<Op<K>> {
  const l = await one(code);
  const op = l.ops.find((o) => o.k === k);
  expect(op, `aucune op ${k}`).toBeDefined();
  return op as Op<K>;
}
const text = (code: string) => firstOp(`^XA${code}^XZ`, 'text');
const barcode = (code: string) => firstOp(`^XA${code}^XZ`, 'barcode');

describe('parseZpl — texte', () => {
  it('^FO + ^A0N : position, police, taille, données', async () => {
    const op = await text('^FO10,20^A0N,30,25^FDHello^FS');
    expect(op).toMatchObject({ x: 10, y: 20, o: 'N', ft: false, f: '0', h: 30, w: 25, text: 'Hello', reverse: false });
    expect(op.block).toBeUndefined();
  });

  it('^FT : origine ligne de base', async () => {
    const op = await text('^FT50,60^A0N,20,20^FDx^FS');
    expect(op).toMatchObject({ x: 50, y: 60, ft: true });
  });

  it('^FT ne « fuit » pas sur le champ suivant', async () => {
    const l = await one('^XA^FT50,60^A0N,20^FDa^FS^FO1,2^A0N,20^FDb^FS^XZ');
    expect(l.ops.map((o) => (o as Op<'text'>).ft)).toEqual([true, false]);
  });

  it.each(['N', 'R', 'I', 'B'] as const)('^A0%s : orientation', async (o) => {
    const op = await text(`^FO0,0^A0${o},40,40^FDabc^FS`);
    expect(op.o).toBe(o);
    expect(op.h).toBe(40);
  });

  it('^A0 sans orientation hérite de ^FW', async () => {
    const op = await text('^FWR^FO0,0^A0,30,30^FDabc^FS');
    expect(op).toMatchObject({ o: 'R', h: 30, w: 30 });
  });

  it('^FW s’applique aussi au texte sans ^A (police ^CF)', async () => {
    const op = await text('^FWI^CF0,25^FO0,0^FDabc^FS');
    expect(op).toMatchObject({ o: 'I', f: '0', h: 25, w: 25 });
  });

  it('^A0 : largeur par défaut = hauteur', async () => {
    const op = await text('^FO0,0^A0N,44^FDabc^FS');
    expect(op).toMatchObject({ h: 44, w: 44 });
  });

  it('^CF : police et taille par défaut', async () => {
    const op = await text('^CF0,40^FO0,0^FDabc^FS');
    expect(op).toMatchObject({ f: '0', h: 40, w: 40, o: 'N' });
  });

  it('^CF police bitmap sans taille : cellule de base', async () => {
    const op = await text('^CFA^FO0,0^FDabc^FS');
    expect(op).toMatchObject({ f: 'A', h: 9, w: 6 });
  });

  // ^A avec police bitmap : multiples entiers de la cellule de base
  it.each([
    ['^ADN,36,20', 'D', 36, 24], // 2× (18×12)
    ['^ADN,40,13', 'D', 36, 12], // 40/18 ≈ 2,2 → 2 ; 13/12 → 1
    ['^AAN,20', 'A', 18, 12], // largeur déduite de la hauteur : 20/9×6 = 13,3 → 2×6
    ['^AEN', 'E', 28, 20], // pas de taille : cellule de base
    ['^ABN,5,5', 'B', 11, 9], // jamais en dessous de 1×
    ['^AGN,130,100', 'G', 120, 96], // 130/60 ≈ 2,17 → 2 ; 100/48 ≈ 2,08 → 2
    ['^AHN,42,38', 'H', 42, 38],
  ])('%s → police %s, %i × %i', async (cmd, f, h, w) => {
    const op = await text(`^FO0,0${cmd}^FDabc^FS`);
    expect(op).toMatchObject({ f, h, w });
  });

  // ^CF avec une police bitmap ne passe pas par l'arrondi appliqué à ^A
  it('^CFD,40 est arrondi comme ^ADN,40 (36 = 2 × 18)', async () => {
    const op = await text('^CFD,40^FO0,0^FDabc^FS');
    expect(op.h).toBe(36);
  });

  it('^FB : bloc de texte', async () => {
    const op = await text('^FO0,0^A0N,30^FB300,3,5,C^FDabc^FS');
    expect(op.block).toEqual({ w: 300, lines: 3, spacing: 5, just: 'C' });
  });

  it('^FB : valeurs par défaut', async () => {
    const op = await text('^FO0,0^A0N,30^FB250^FDabc^FS');
    expect(op.block).toEqual({ w: 250, lines: 1, spacing: 0, just: 'L' });
  });

  it('^FB ne s’applique qu’au champ courant', async () => {
    const l = await one('^XA^FO0,0^FB200,2^FDa^FS^FO0,50^FDb^FS^XZ');
    expect((l.ops[1] as Op<'text'>).block).toBeUndefined();
  });

  it('^FH : échappements hexadécimaux (UTF-8)', async () => {
    const op = await text('^FO0,0^A0N,20^FH^FDA_5FB_C3_A9 _7E^FS');
    expect(op.text).toBe('A_Bé ~');
  });

  it('^FH avec indicateur personnalisé', async () => {
    const op = await text('^FO0,0^A0N,20^FH\\^FD\\41\\42_43^FS');
    expect(op.text).toBe('AB_43');
  });

  it('sans ^FH, les séquences _XX restent littérales', async () => {
    const op = await text('^FO0,0^A0N,20^FDA_41^FS');
    expect(op.text).toBe('A_41');
  });

  it('^FH ne s’applique qu’au champ courant', async () => {
    const l = await one('^XA^FO0,0^FH^FD_41^FS^FO0,0^FD_41^FS^XZ');
    expect(l.ops.map((o) => (o as Op<'text'>).text)).toEqual(['A', '_41']);
  });

  it('^LH décale les origines', async () => {
    const op = await text('^LH10,20^FO5,6^A0N,20^FDa^FS');
    expect(op).toMatchObject({ x: 15, y: 26 });
  });

  it('^FR et ^LR → reverse', async () => {
    expect((await text('^FO0,0^FR^FDa^FS')).reverse).toBe(true);
    expect((await text('^LRY^FO0,0^FDa^FS')).reverse).toBe(true);
    expect((await text('^FO0,0^FDa^FS')).reverse).toBe(false);
  });

  it('^FX (commentaire) est ignoré sans avertissement', async () => {
    const l = await one('^XA^FX un commentaire^FO0,0^FDa^FS^XZ');
    expect(l.ops).toHaveLength(1);
    expect(l.warnings).toEqual([]);
  });
});

describe('parseZpl — graphiques', () => {
  it('^GB : boîte avec épaisseur', async () => {
    const op = await firstOp('^XA^FO5,6^GB100,50,3^FS^XZ', 'box');
    expect(op).toEqual({ k: 'box', x: 5, y: 6, w: 100, h: 50, t: 3, color: 'B', r: 0, reverse: false });
  });

  it('^GB : largeur/hauteur jamais inférieures à l’épaisseur (trait horizontal)', async () => {
    const op = await firstOp('^XA^FO0,0^GB300,0,4^FS^XZ', 'box');
    expect(op).toMatchObject({ w: 300, h: 4, t: 4 });
  });

  it('^GB : couleur blanche, arrondi, ^FR', async () => {
    const op = await firstOp('^XA^FO0,0^FR^GB200,100,4,W,2^FS^XZ', 'box');
    expect(op).toMatchObject({ color: 'W', r: 2, reverse: true });
  });

  it('^GE : ellipse', async () => {
    const op = await firstOp('^XA^FO10,10^GE300,100,2^FS^XZ', 'ellipse');
    expect(op).toEqual({ k: 'ellipse', x: 10, y: 10, w: 300, h: 100, t: 2, color: 'B', reverse: false });
  });

  it('^GC : cercle (diamètre, épaisseur, couleur)', async () => {
    const op = await firstOp('^XA^FO10,10^GC80,4,W^FS^XZ', 'ellipse');
    expect(op).toMatchObject({ w: 80, h: 80, t: 4, color: 'W' });
  });

  it('^GFA avec ^FO : coin haut-gauche', async () => {
    const op = await firstOp('^XA^FO10,100^GFA,4,4,1,FF00FF00^FS^XZ', 'image');
    expect(op).toMatchObject({ x: 10, y: 100 });
    expect(op.bitmap).toMatchObject({ width: 8, height: 4 });
    expect(Array.from(op.bitmap.bits.slice(0, 16))).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('^GFA avec ^FT : l’origine est le coin bas-gauche', async () => {
    const op = await firstOp('^XA^FT10,100^GFA,4,4,1,FF00FF00^FS^XZ', 'image');
    expect(op).toMatchObject({ x: 10, y: 96 });
  });

  it('^GFA compressé (virgules dans les données)', async () => {
    const op = await firstOp('^XA^FO0,0^GFA,8,8,2,8,::!^FS^XZ', 'image');
    expect(op.bitmap.height).toBe(4);
    const row = (y: number) => Array.from(op.bitmap.bits.slice(y * 16, y * 16 + 16)).join('');
    expect(row(0)).toBe('1000000000000000');
    expect(row(2)).toBe('1000000000000000');
    expect(row(3)).toBe('1111111111111111');
  });

  it('^GF :B64:', async () => {
    const op = await firstOp(`^XA^FO0,0^GFA,2,2,1,:B64:${btoa(String.fromCharCode(0xf0, 0x0f))}:abcd^FS^XZ`, 'image');
    expect(Array.from(op.bitmap.bits).join('')).toBe('1111000000001111');
  });

  it('^GF :Z64: (zlib)', async () => {
    const raw = new Uint8Array([0xaa, 0x55, 0xff]);
    const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'));
    const z = new Uint8Array(await new Response(stream).arrayBuffer());
    const b64 = btoa(String.fromCharCode(...z));
    const op = await firstOp(`^XA^FO0,0^GFA,3,3,1,:Z64:${b64}:1234^FS^XZ`, 'image');
    expect(Array.from(op.bitmap.bits).join('')).toBe('101010100101010111111111');
  });

  it('^GF format non géré → avertissement', async () => {
    const labels = await parseZpl('^XA^FO0,0^GFB,2,2,1,ab^FS^FO0,0^FDx^FS^XZ');
    expect(labels[0].warnings.join(' ')).toMatch(/\^GF format B/);
  });
});

describe('parseZpl — codes-barres', () => {
  it('^BY + ^BCN : code 128', async () => {
    const op = await barcode('^BY3,2,80^FO10,20^BCN,100,Y,N,N^FDABC123^FS');
    expect(op).toMatchObject({ k: 'barcode', sym: 'code128', x: 10, y: 20, o: 'N', module: 3, height: 100, hr: true, data: 'ABC123', ft: false });
  });

  it('^BC sans hauteur → hauteur de ^BY ; interprétation N', async () => {
    const op = await barcode('^BY2,3,77^FO0,0^BCR,,N^FDX^FS');
    expect(op).toMatchObject({ o: 'R', height: 77, hr: false, module: 2 });
  });

  it('^BC mode D → GS1-128', async () => {
    const op = await barcode('^FO0,0^BCN,50,Y,N,N,D^FD(01)09501101530003^FS');
    expect(op.sym).toBe('gs1-128');
  });

  it('^BC : les codes de sous-ensemble >; >: etc. sont retirés', async () => {
    const op = await barcode('^FO0,0^BCN,50^FD>;123456>6AB^FS');
    expect(op.data).toBe('123456AB');
  });

  it('^BC sans orientation hérite de ^FW', async () => {
    const op = await barcode('^FWB^FO0,0^BC,50^FD123^FS');
    expect(op.o).toBe('B');
  });

  it.each(['N', 'R', 'I', 'B'] as const)('^BC%s : orientation', async (o) => {
    const op = await barcode(`^FO0,0^BC${o},50^FD123^FS`);
    expect(op.o).toBe(o);
  });

  it('^FT avec un code-barres', async () => {
    const op = await barcode('^FT10,200^BCN,50^FD123^FS');
    expect(op.ft).toBe(true);
  });

  it.each([
    ['^BEN,80,Y,N', 'ean13', 80],
    ['^B8N,70,N', 'ean8', 70],
    ['^BUN,60', 'upca', 60],
    ['^B9N,60', 'upce', 60],
    ['^BAN,55', 'code93', 55],
    ['^B2N,45', 'interleaved2of5', 45],
  ])('%s → %s, hauteur %i', async (cmd, sym, h) => {
    const op = await barcode(`^FO0,0${cmd}^FD1234567^FS`);
    expect(op).toMatchObject({ sym, height: h });
  });

  it('^BE : texte lisible désactivé avec N', async () => {
    expect((await barcode('^FO0,0^BEN,80,N^FD590123412345^FS')).hr).toBe(false);
  });

  it('^B3 : la hauteur est le 3e paramètre, l’interprétation le 4e', async () => {
    const op = await barcode('^FO0,0^B3R,N,90,N^FDCODE39^FS');
    expect(op).toMatchObject({ sym: 'code39', o: 'R', height: 90, hr: false });
  });

  it('^BK (Codabar)', async () => {
    const op = await barcode('^FO0,0^BKN,N,66^FDA123B^FS');
    expect(op).toMatchObject({ sym: 'rationalizedCodabar', height: 66, hr: true });
  });

  it('^BX : Data Matrix, taille de module', async () => {
    const op = await barcode('^FO5,5^BXR,6,200^FDhello^FS');
    expect(op).toMatchObject({ sym: 'datamatrix', o: 'R', module: 6, hr: false, data: 'hello' });
  });

  it('^BQ : QR code, grossissement, niveau, données après la virgule', async () => {
    const op = await firstOp('^XA^FO10,20^BQN,2,5^FDHA,hello, world^FS^XZ', 'qr');
    expect(op).toMatchObject({ x: 10, y: 20, mag: 5, level: 'H', data: 'hello, world', o: 'N' });
  });

  it('^BQ : orientation toujours N, niveau inconnu → M', async () => {
    const op = await firstOp('^XA^FO0,0^BQR,2,3^FDZA,abc^FS^XZ', 'qr');
    expect(op).toMatchObject({ o: 'N', level: 'M', data: 'abc', mag: 3 });
  });
});

describe('parseZpl — structure', () => {
  it('plusieurs étiquettes, ^PW / ^LL', async () => {
    const labels = await parseZpl('^XA^PW812^LL406^FO0,0^FDa^FS^XZ\n^XA^FO0,0^FDb^FS^FO0,0^FDc^FS^XZ');
    expect(labels).toHaveLength(2);
    expect(labels[0]).toMatchObject({ width: 812, height: 406 });
    expect(labels[0].ops).toHaveLength(1);
    expect(labels[1].ops).toHaveLength(2);
    expect(labels[1].width).toBeUndefined();
  });

  it('les étiquettes vides sont ignorées, sauf si elles ont une largeur', async () => {
    expect(await parseZpl('^XA^XZ^XA^FO0,0^FDa^FS^XZ')).toHaveLength(1);
    expect(await parseZpl('^XA^PW400^XZ')).toHaveLength(1);
  });

  it('^FD hors ^XA crée une étiquette implicite', async () => {
    const labels = await parseZpl('^FO1,2^FDa^FS');
    expect(labels).toHaveLength(1);
  });

  it('commandes inconnues → un seul avertissement sur la 1re étiquette ; commandes connues ignorées silencieusement', async () => {
    const labels = await parseZpl('^XA^CI28^PQ2^MMT^QQ1^ZZ^FO0,0^FDa^FS^XZ^XA^QQ^FO0,0^FDb^FS^XZ');
    expect(labels[0].warnings).toHaveLength(1);
    expect(labels[0].warnings[0]).toMatch(/\^QQ/);
    expect(labels[0].warnings[0]).toMatch(/\^ZZ/);
    expect(labels[0].warnings[0]).not.toMatch(/\^CI|\^PQ|\^MM/);
    expect(labels[1].warnings).toEqual([]);
  });

  it('le texte de ^FD peut contenir des virgules', async () => {
    const op = await text('^FO0,0^FDa,b,c^FS');
    expect(op.text).toBe('a,b,c');
  });
});

describe('fieldTransform', () => {
  const lw = 100,
    lh = 30,
    base = 24;
  const P = (o: 'N' | 'R' | 'I' | 'B', ft: boolean) => ({ x: 200, y: 300, o, ft });

  it.each([
    ['N', 200, 300, 0],
    ['R', 230, 300, 90], // x + lh
    ['I', 300, 330, 180], // x + lw, y + lh
    ['B', 200, 400, 270], // y + lw
  ] as const)('^FO %s', (o, tx, ty, deg) => {
    const r = fieldTransform(P(o, false), lw, lh, base);
    expect(r).toEqual({ tx, ty, deg });
  });

  it.each([
    ['N', 200, 276, 0], // y - base
    ['R', 224, 300, 90], // x + base
    ['I', 200, 324, 180], // y + base
    ['B', 176, 300, 270], // x - base
  ] as const)('^FT %s', (o, tx, ty, deg) => {
    const r = fieldTransform(P(o, true), lw, lh, base);
    expect(r.deg).toBe(deg);
    expect(r.tx).toBeCloseTo(tx, 9);
    expect(r.ty).toBeCloseTo(ty, 9);
  });

  it('^FO : la boîte pivotée commence toujours au point ^FO', () => {
    // coins du champ local (0..lw, 0..lh) transformés → min x/y = origine ^FO
    for (const o of ['N', 'R', 'I', 'B'] as const) {
      const { tx, ty, deg } = fieldTransform(P(o, false), lw, lh, base);
      const a = (deg * Math.PI) / 180;
      const pts = [
        [0, 0],
        [lw, 0],
        [0, lh],
        [lw, lh],
      ].map(([x, y]) => [tx + x * Math.cos(a) - y * Math.sin(a), ty + x * Math.sin(a) + y * Math.cos(a)]);
      expect(Math.min(...pts.map((p) => p[0]))).toBeCloseTo(200, 9);
      expect(Math.min(...pts.map((p) => p[1]))).toBeCloseTo(300, 9);
    }
  });
});

describe('renderZplLabel / zplLabelToElements (fumée)', () => {
  it('un ^GB plein noircit exactement sa zone', async () => {
    const l = await one('^XA^FO10,20^GB30,15,15^FS^XZ');
    const bm = canvasToBitmap(renderZplLabel(l, 100, 60));
    expect(blackBounds(bm)).toEqual({ x: 10, y: 20, w: 30, h: 15 });
  });

  it('convertit boîte, trait et texte en éléments éditables (unités u à 300 dpi)', async () => {
    const l = await one('^XA^FO0,0^GB300,3,3^FS^FO30,60^GB90,90,90,B,0^FS^FO15,15^A0N,30^FDHi^FS^XZ');
    const els = zplLabelToElements(l, 300 / 203);
    expect(els.map((e) => e.type)).toEqual(['shape', 'shape', 'text']);
    expect(els[0]).toMatchObject({ kind: 'line' });
    // NB : une boîte pleine devient une forme « line » (barre pleine) — rendu identique
    expect(els[1]).toMatchObject({ fill: '#000000', stroke: 'none' });
    expect(els[1].w).toBeCloseTo(90 / (300 / 203), 6);
    expect(els[2].x).toBeCloseTo(15 / (300 / 203), 6);
  });
});
