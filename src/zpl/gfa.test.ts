import { describe, it, expect } from 'vitest';
import { bitmapToGfa, decodeGfaHex, blackBounds, canvasToBitmap, type Bitmap } from './gfa';

function bitmap(w: number, h: number, f: (x: number, y: number) => boolean): Bitmap {
  const bits = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bits[y * w + x] = f(x, y) ? 1 : 0;
  return { width: w, height: h, bits };
}

/** PRNG déterministe (mulberry32) */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ^GFA,a,b,c,data → champs */
function parseGfa(cmd: string) {
  const m = /^\^GFA,(\d+),(\d+),(\d+),([\s\S]*)$/.exec(cmd);
  if (!m) throw new Error('pas un ^GFA : ' + cmd.slice(0, 40));
  return { total: +m[1], total2: +m[2], bpr: +m[3], data: m[4] };
}

/** Encode → décode, puis compare pixel à pixel (le décodage est paddé à un multiple de 8) */
function roundTrip(b: Bitmap, compress: boolean, region = { x: 0, y: 0, w: b.width, h: b.height }) {
  const g = parseGfa(bitmapToGfa(b, region, compress));
  expect(g.bpr).toBe(Math.ceil(region.w / 8));
  expect(g.total).toBe(g.bpr * region.h);
  expect(g.total2).toBe(g.total);
  const d = decodeGfaHex(g.data, g.bpr, g.total);
  expect(d.width).toBe(g.bpr * 8);
  expect(d.height).toBe(region.h);
  for (let y = 0; y < region.h; y++)
    for (let x = 0; x < d.width; x++) {
      const want = x < region.w ? b.bits[(region.y + y) * b.width + region.x + x] : 0;
      if (d.bits[y * d.width + x] !== want) throw new Error(`pixel (${x},${y}) : attendu ${want}, obtenu ${d.bits[y * d.width + x]}`);
    }
  return g;
}

describe('bitmapToGfa ↔ decodeGfaHex', () => {
  const cases: [string, Bitmap][] = [
    ['tout blanc', bitmap(40, 6, () => false)],
    ['tout noir', bitmap(40, 6, () => true)],
    ['largeur non multiple de 8', bitmap(13, 5, (x, y) => (x + y) % 3 === 0)],
    ['damier', bitmap(64, 16, (x, y) => (x + y) % 2 === 0)],
    ['lignes identiques (répétition « : »)', bitmap(48, 10, (x) => x % 5 === 0)],
    ['alternance lignes vides / pleines', bitmap(32, 8, (_, y) => y % 2 === 1)],
    ['longs aplats (> 20 et > 400 caractères hex)', bitmap(1700, 3, (x, y) => (y === 1 ? x < 900 : x > 1650))],
    ['une seule colonne', bitmap(1, 7, (_, y) => y % 2 === 0)],
    ['fin de ligne en F puis 0', bitmap(80, 4, (x, y) => (y < 2 ? x > 40 : x < 20))],
  ];
  for (const [name, b] of cases) {
    it(`aller-retour compressé : ${name}`, () => {
      roundTrip(b, true);
    });
    it(`aller-retour non compressé : ${name}`, () => {
      roundTrip(b, false);
    });
  }

  it('aller-retour sur bitmaps aléatoires (compressé et brut)', () => {
    const r = rng(42);
    for (let n = 0; n < 30; n++) {
      const w = 1 + Math.floor(r() * 90);
      const h = 1 + Math.floor(r() * 12);
      const density = r();
      const b = bitmap(w, h, () => r() < density);
      roundTrip(b, true);
      roundTrip(b, false);
    }
  });

  it('aller-retour d’une sous-région', () => {
    const b = bitmap(50, 30, (x, y) => (x * 7 + y * 3) % 11 < 4);
    roundTrip(b, true, { x: 5, y: 7, w: 21, h: 9 });
    roundTrip(b, false, { x: 5, y: 7, w: 21, h: 9 });
  });

  it('compression : ligne vide → « , », ligne pleine → « ! », ligne répétée → « : »', () => {
    const blank = parseGfa(bitmapToGfa(bitmap(32, 1, () => false)));
    expect(blank.data).toBe(',');
    const full = parseGfa(bitmapToGfa(bitmap(32, 1, () => true)));
    expect(full.data).toBe('!');
    const rep = parseGfa(bitmapToGfa(bitmap(32, 3, (x) => x === 0)));
    // 80 00 00 00 → « 8 » puis zéros finaux « , » ; puis deux répétitions
    expect(rep.data).toBe('8,::');
  });

  it('non compressé : une ligne hexadécimale par rangée', () => {
    const g = parseGfa(bitmapToGfa(bitmap(16, 2, (x, y) => (y === 0 ? x < 8 : x >= 8)), undefined, false));
    expect(g.data).toBe('FF00\n00FF');
  });

  it('décode les codes de répétition ZPL (G..Y = 1..19, g..z = 20..400)', () => {
    // 1 ligne de 30 octets : 60 caractères hex = « h » (40) + « S » (13) + « H » (2) soit 55 « F », puis « , » complète en 0
    const d = decodeGfaHex('hFSFHF,', 30, 30);
    const ones = Array.from(d.bits).filter((v) => v === 1).length;
    expect(ones).toBe(55 * 4);
    expect(d.bits[54 * 4 + 3]).toBe(1);
    expect(d.bits[55 * 4]).toBe(0);
  });

  it('« : » en première ligne répète une ligne vide', () => {
    const d = decodeGfaHex(':FF', 1, 2);
    expect(Array.from(d.bits.slice(0, 8))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(Array.from(d.bits.slice(8, 16))).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });
});

describe('blackBounds', () => {
  it('null pour un bitmap vide', () => {
    expect(blackBounds(bitmap(10, 10, () => false))).toBeNull();
  });
  it('un seul pixel', () => {
    expect(blackBounds(bitmap(10, 10, (x, y) => x === 3 && y === 7))).toEqual({ x: 3, y: 7, w: 1, h: 1 });
  });
  it('englobe plusieurs taches', () => {
    expect(blackBounds(bitmap(20, 20, (x, y) => (x === 2 && y === 5) || (x === 15 && y === 1) || (x === 9 && y === 18)))).toEqual({ x: 2, y: 1, w: 14, h: 18 });
  });
  it('bitmap plein', () => {
    expect(blackBounds(bitmap(7, 4, () => true))).toEqual({ x: 0, y: 0, w: 7, h: 4 });
  });
});

describe('canvasToBitmap', () => {
  it('seuil de luminance et transparence = blanc', () => {
    const cv = document.createElement('canvas');
    cv.width = 4;
    cv.height = 1;
    const c = cv.getContext('2d')!;
    c.fillStyle = '#000';
    c.fillRect(0, 0, 1, 1);
    c.fillStyle = '#7f7f7f'; // 127 < 128 → noir
    c.fillRect(1, 0, 1, 1);
    c.fillStyle = '#848484'; // 132 → blanc (128 pile tombe à 127,99… par arrondi flottant)
    c.fillRect(2, 0, 1, 1);
    // pixel 3 : transparent → blanc
    expect(Array.from(canvasToBitmap(cv).bits)).toEqual([1, 1, 0, 0]);
  });
});
