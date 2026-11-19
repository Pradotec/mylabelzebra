/**
 * Conversion d'une page rasterisée (PDF transporteur, PNG, JPG) en étiquette ZPL ^GFA.
 * Fonctions pures sur des images en niveaux de gris (Uint8Array, 0 = noir, 255 = blanc) :
 * testables sans navigateur.
 *
 * Chaîne : gris → recadrage sur le contenu → rotation éventuelle → mise à l'échelle sur le
 * format (centrée, proportions conservées) → seuil noir/blanc ou tramage → ^GFA.
 */
import { bitmapToGfa, type Bitmap } from '../zpl/gfa';

export interface Gray {
  w: number;
  h: number;
  /** 0 = noir, 255 = blanc */
  px: Uint8Array;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Rotation = 0 | 90 | 180 | 270;

/** RGBA (ImageData) → gris, transparence composée sur fond blanc (pondération BT.601). */
export function rgbaToGray(data: ArrayLike<number>, w: number, h: number): Gray {
  const px = new Uint8Array(w * h);
  for (let i = 0; i < px.length; i++) {
    const a = data[i * 4 + 3] / 255;
    const lum = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    px[i] = Math.round(lum * a + 255 * (1 - a));
  }
  return { w, h, px };
}

/**
 * Boîte englobante du contenu : pixels plus sombres que `level`.
 * `margin` (en pixels) est ajouté autour, borné à l'image. null si la page est vide.
 */
export function contentBounds(g: Gray, level = 224, margin = 0): Rect | null {
  let x0 = g.w,
    y0 = g.h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < g.h; y++) {
    const row = y * g.w;
    for (let x = 0; x < g.w; x++)
      if (g.px[row + x] < level) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - margin);
  y0 = Math.max(0, y0 - margin);
  x1 = Math.min(g.w - 1, x1 + margin);
  y1 = Math.min(g.h - 1, y1 + margin);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function cropGray(g: Gray, r: Rect): Gray {
  const px = new Uint8Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) px.set(g.px.subarray((r.y + y) * g.w + r.x, (r.y + y) * g.w + r.x + r.w), y * r.w);
  return { w: r.w, h: r.h, px };
}

/** Rotation horaire de 90°, 180° ou 270°. */
export function rotateGray(g: Gray, deg: Rotation): Gray {
  if (deg === 0) return g;
  const { w, h } = g;
  const nw = deg === 180 ? w : h;
  const nh = deg === 180 ? h : w;
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = g.px[y * w + x];
      let nx: number, ny: number;
      if (deg === 90) {
        nx = h - 1 - y;
        ny = x;
      } else if (deg === 180) {
        nx = w - 1 - x;
        ny = h - 1 - y;
      } else {
        nx = y;
        ny = w - 1 - x;
      }
      px[ny * nw + nx] = v;
    }
  return { w: nw, h: nh, px };
}

/** Poids de rééchantillonnage par recouvrement de surface (réduction = moyenne, agrandissement = plus proche lissé). */
function weights(src: number, dst: number) {
  const scale = src / dst;
  const out: { i0: number; w: number[] }[] = [];
  for (let d = 0; d < dst; d++) {
    const a = d * scale;
    const b = a + scale;
    const i0 = Math.floor(a);
    const i1 = Math.min(src, Math.ceil(b));
    const w: number[] = [];
    for (let i = i0; i < i1; i++) w.push(Math.min(b, i + 1) - Math.max(a, i));
    const s = w.reduce((p, c) => p + c, 0) || 1;
    out.push({ i0, w: w.map((v) => v / s) });
  }
  return out;
}

/** Redimensionne une image grise (filtre de surface, séparable). */
export function resizeGray(g: Gray, nw: number, nh: number): Gray {
  nw = Math.max(1, Math.round(nw));
  nh = Math.max(1, Math.round(nh));
  if (nw === g.w && nh === g.h) return g;
  const wx = weights(g.w, nw);
  const wy = weights(g.h, nh);
  const tmp = new Float32Array(nw * g.h);
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < nw; x++) {
      const { i0, w } = wx[x];
      let s = 0;
      for (let k = 0; k < w.length; k++) s += g.px[y * g.w + i0 + k] * w[k];
      tmp[y * nw + x] = s;
    }
  const px = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    const { i0, w } = wy[y];
    for (let x = 0; x < nw; x++) {
      let s = 0;
      for (let k = 0; k < w.length; k++) s += tmp[(i0 + k) * nw + x] * w[k];
      px[y * nw + x] = Math.round(s);
    }
  }
  return { w: nw, h: nh, px };
}

/** Place l'image dans un cadre W×H blanc, proportions conservées, centrée (marge en pixels). */
export function fitGray(g: Gray, W: number, H: number, margin = 0): Gray {
  const aw = Math.max(1, W - 2 * margin);
  const ah = Math.max(1, H - 2 * margin);
  const k = Math.min(aw / g.w, ah / g.h);
  const sw = Math.max(1, Math.min(aw, Math.round(g.w * k)));
  const sh = Math.max(1, Math.min(ah, Math.round(g.h * k)));
  const s = resizeGray(g, sw, sh);
  const px = new Uint8Array(W * H).fill(255);
  const ox = Math.floor((W - sw) / 2);
  const oy = Math.floor((H - sh) / 2);
  for (let y = 0; y < sh; y++) px.set(s.px.subarray(y * sw, (y + 1) * sw), (oy + y) * W + ox);
  return { w: W, h: H, px };
}

/** Seuil : gris < t → noir (1). */
export function thresholdGray(g: Gray, t = 128): Bitmap {
  const bits = new Uint8Array(g.w * g.h);
  for (let i = 0; i < bits.length; i++) bits[i] = g.px[i] < t ? 1 : 0;
  return { width: g.w, height: g.h, bits };
}

/** Tramage Floyd–Steinberg (logos, photos) autour du seuil t. */
export function ditherGray(g: Gray, t = 128): Bitmap {
  const { w, h } = g;
  const e = new Float32Array(w * h);
  for (let i = 0; i < e.length; i++) e[i] = g.px[i];
  const bits = new Uint8Array(w * h);
  // décalage du seuil : t = 128 → neutre ; un seuil plus haut assombrit
  const bias = t - 128;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = e[i] - bias;
      const black = old < 128;
      bits[i] = black ? 1 : 0;
      const err = old - (black ? 0 : 255);
      if (x + 1 < w) e[i + 1] += (err * 7) / 16;
      if (y + 1 < h) {
        if (x > 0) e[i + w - 1] += (err * 3) / 16;
        e[i + w] += (err * 5) / 16;
        if (x + 1 < w) e[i + w + 1] += err / 16;
      }
    }
  return { width: w, height: h, bits };
}

/** Rotation à appliquer : 'auto' tourne de 90° si l'orientation (paysage / portrait) diffère du format. */
export function chooseRotation(srcW: number, srcH: number, dstW: number, dstH: number, mode: 'auto' | Rotation): Rotation {
  if (mode !== 'auto') return mode;
  return srcW > srcH !== dstW > dstH && srcW !== srcH && dstW !== dstH ? 90 : 0;
}

export interface RasterOpts {
  /** format cible en points imprimante */
  widthDots: number;
  heightDots: number;
  /** seuil noir/blanc 1..254 (défaut 128) */
  threshold?: number;
  dither?: boolean;
  /** recadrage automatique sur le contenu (défaut true) */
  crop?: boolean;
  rotate?: 'auto' | Rotation;
  /** marge autour du contenu, en points imprimante (défaut 0) */
  margin?: number;
}

/** Page grise → bitmap 1 bit au format exact de l'étiquette. */
export function grayToLabelBitmap(g: Gray, o: RasterOpts): Bitmap {
  let img = g;
  if (o.crop !== false) {
    const r = contentBounds(img);
    if (r) img = cropGray(img, r);
  }
  img = rotateGray(img, chooseRotation(img.w, img.h, o.widthDots, o.heightDots, o.rotate ?? 'auto'));
  img = fitGray(img, o.widthDots, o.heightDots, o.margin ?? 0);
  return o.dither ? ditherGray(img, o.threshold ?? 128) : thresholdGray(img, o.threshold ?? 128);
}

/**
 * Étiquette ZPL complète : une image ^GFA (compression ASCII ZPL, voir zpl/gfa.ts) en 0,0.
 * ^PW / ^LL fixent la largeur et la longueur ; les réglages du support de l'imprimante
 * (^MN, ^MT, vitesse, contraste) ne sont pas modifiés.
 */
export function bitmapToLabelZpl(b: Bitmap): string {
  return `^XA\n^PW${b.width}\n^LL${b.height}\n^LH0,0\n^FO0,0${bitmapToGfa(b)}^FS\n^PQ1\n^XZ\n`;
}

/** Points imprimante pour un format en mm */
export const mmToDots = (mm: number, dpi: number) => Math.round((mm / 25.4) * dpi);
