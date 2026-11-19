import { describe, it, expect } from 'vitest';
import { rgbaToGray, contentBounds, cropGray, rotateGray, resizeGray, fitGray, thresholdGray, ditherGray, chooseRotation, grayToLabelBitmap, bitmapToLabelZpl, mmToDots, type Gray } from './raster';
import { decodeGfaHex } from '../zpl/gfa';
import { parseZpl } from '../zpl/parse';

/** image blanche w×h avec un rectangle noir */
function page(w: number, h: number, r?: { x: number; y: number; w: number; h: number }, v = 0): Gray {
  const px = new Uint8Array(w * h).fill(255);
  if (r) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) px[y * w + x] = v;
  return { w, h, px };
}

const gfaHeader = (zpl: string) => {
  const m = /\^GFA,(\d+),(\d+),(\d+),([^^]*)\^FS/.exec(zpl)!;
  return { total: +m[1], count: +m[2], bpr: +m[3], data: m[4] };
};

describe('gris', () => {
  it('RGBA → gris avec transparence sur blanc', () => {
    const g = rgbaToGray([0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 128], 4, 1);
    expect(Array.from(g.px)).toEqual([0, 255, 255, 127]);
  });
});

describe('recadrage', () => {
  it('boîte englobante du contenu', () => {
    const g = page(20, 10, { x: 3, y: 2, w: 5, h: 4 });
    expect(contentBounds(g)).toEqual({ x: 3, y: 2, w: 5, h: 4 });
    expect(contentBounds(g, 224, 2)).toEqual({ x: 1, y: 0, w: 9, h: 8 });
    expect(contentBounds(page(5, 5))).toBeNull();
  });
  it('les gris clairs (≥ niveau) ne comptent pas', () => {
    expect(contentBounds(page(10, 10, { x: 1, y: 1, w: 2, h: 2 }, 240))).toBeNull();
  });
  it('découpe', () => {
    const g = page(20, 10, { x: 3, y: 2, w: 5, h: 4 });
    const c = cropGray(g, contentBounds(g)!);
    expect(c.w).toBe(5);
    expect(c.h).toBe(4);
    expect(c.px.every((v) => v === 0)).toBe(true);
  });
});

describe('rotation', () => {
  const g: Gray = { w: 3, h: 2, px: new Uint8Array([1, 2, 3, 4, 5, 6]) };
  it('90° horaire', () => {
    const r = rotateGray(g, 90);
    expect([r.w, r.h]).toEqual([2, 3]);
    expect(Array.from(r.px)).toEqual([4, 1, 5, 2, 6, 3]);
  });
  it('180° et 270°', () => {
    expect(Array.from(rotateGray(g, 180).px)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(Array.from(rotateGray(g, 270).px)).toEqual([3, 6, 2, 5, 1, 4]);
  });
  it('automatique : paysage vers portrait → 90°', () => {
    expect(chooseRotation(300, 200, 812, 1218, 'auto')).toBe(90);
    expect(chooseRotation(200, 300, 812, 1218, 'auto')).toBe(0);
    expect(chooseRotation(200, 200, 812, 1218, 'auto')).toBe(0);
    expect(chooseRotation(200, 300, 812, 1218, 270)).toBe(270);
  });
});

describe('mise à l’échelle', () => {
  it('réduction par moyenne de surface', () => {
    const g: Gray = { w: 4, h: 1, px: new Uint8Array([0, 255, 0, 255]) };
    expect(Array.from(resizeGray(g, 2, 1).px)).toEqual([128, 128]);
  });
  it('agrandissement ×2', () => {
    const g: Gray = { w: 2, h: 1, px: new Uint8Array([0, 255]) };
    expect(Array.from(resizeGray(g, 4, 1).px)).toEqual([0, 0, 255, 255]);
  });
  it('centrage proportionnel dans le cadre', () => {
    const f = fitGray(page(10, 10, { x: 0, y: 0, w: 10, h: 10 }), 20, 40);
    expect([f.w, f.h]).toEqual([20, 40]);
    expect(contentBounds(f)).toEqual({ x: 0, y: 10, w: 20, h: 20 });
  });
});

describe('seuil et tramage', () => {
  const g: Gray = { w: 4, h: 1, px: new Uint8Array([0, 100, 160, 255]) };
  it('seuil réglable', () => {
    expect(Array.from(thresholdGray(g, 128).bits)).toEqual([1, 1, 0, 0]);
    expect(Array.from(thresholdGray(g, 200).bits)).toEqual([1, 1, 1, 0]);
    expect(Array.from(thresholdGray(g, 50).bits)).toEqual([1, 0, 0, 0]);
  });
  it('tramage : gris moyen ≈ 50 % de noir, noir et blanc purs inchangés', () => {
    const mid = ditherGray({ w: 100, h: 100, px: new Uint8Array(10000).fill(128) });
    const black = mid.bits.reduce((a, b) => a + b, 0);
    expect(black).toBeGreaterThan(4500);
    expect(black).toBeLessThan(5500);
    expect(ditherGray(page(8, 8)).bits.every((b) => b === 0)).toBe(true);
    expect(ditherGray(page(8, 8, { x: 0, y: 0, w: 8, h: 8 })).bits.every((b) => b === 1)).toBe(true);
  });
});

describe('chaîne complète et ^GFA', () => {
  it('format 4×6 à 203 dpi', () => {
    expect([mmToDots(101.6, 203), mmToDots(152.4, 203)]).toEqual([812, 1218]);
    expect([mmToDots(101.6, 300), mmToDots(152.4, 600)]).toEqual([1200, 3600]);
  });

  it('A4 paysage avec une étiquette → bitmap au format, rotation automatique', () => {
    const a4 = page(300, 200, { x: 100, y: 50, w: 60, h: 40 });
    const b = grayToLabelBitmap(a4, { widthDots: 40, heightDots: 60 });
    expect([b.width, b.height]).toEqual([40, 60]);
    // contenu recadré, tourné (40×60) : remplit tout le cadre
    expect(b.bits.every((v) => v === 1)).toBe(true);
    const noCrop = grayToLabelBitmap(a4, { widthDots: 40, heightDots: 60, crop: false, rotate: 0 });
    expect(noCrop.bits.reduce((a, v) => a + v, 0)).toBeLessThan(40 * 60 / 4);
  });

  it('^GFA : octets par ligne, total, nombre de lignes', () => {
    const b = grayToLabelBitmap(page(30, 20, { x: 0, y: 0, w: 10, h: 20 }), { widthDots: 30, heightDots: 20, crop: false, rotate: 0 });
    const zpl = bitmapToLabelZpl(b);
    expect(zpl.startsWith('^XA\n^PW30\n^LL20\n^LH0,0\n^FO0,0^GFA,')).toBe(true);
    expect(zpl.trim().endsWith('^XZ')).toBe(true);
    const h = gfaHeader(zpl);
    expect(h.bpr).toBe(4); // ceil(30 / 8)
    expect(h.total).toBe(4 * 20);
    expect(h.count).toBe(h.total);
    const back = decodeGfaHex(h.data, h.bpr, h.total);
    expect(back.height).toBe(20);
    for (let y = 0; y < 20; y++)
      for (let x = 0; x < 30; x++) expect(back.bits[y * back.width + x]).toBe(x < 10 ? 1 : 0);
  });

  it('relu par le parseur ZPL interne', async () => {
    const b = grayToLabelBitmap(page(50, 70, { x: 5, y: 5, w: 20, h: 30 }), { widthDots: 64, heightDots: 96, crop: false, rotate: 0 });
    const labels = await parseZpl(bitmapToLabelZpl(b) + bitmapToLabelZpl(b));
    expect(labels).toHaveLength(2);
    expect(labels[0].width).toBe(64);
    expect(labels[0].height).toBe(96);
    const img = labels[0].ops.find((o) => o.k === 'image') as { bitmap: { width: number; height: number } } | undefined;
    expect(img?.bitmap.width).toBe(64);
    expect(img?.bitmap.height).toBe(96);
  });
});
