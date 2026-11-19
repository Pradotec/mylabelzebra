import { BASE_DPI, type LabelDoc, type LabelElement, type TextEl, type TableEl } from '../types';
import { encodeBarcode, encodeQr, qrPayload, type MatrixCode } from './codes';
import { getImage } from './images';
import { resolveText, isPrinted, type ResolveCtx } from './resolve';
import { shapeDef, drawSymbol } from './shapes';
import { fontString, layoutText, hasFixedHeight, textOffsetY, justifyWords, richSegments } from './textLayout';

export interface DrawCtx extends ResolveCtx {
  /** pixels de sortie par unité u */
  scale: number;
  /** rendu monochrome (images seuillées/tramées) */
  mono?: boolean;
  /** affiche les erreurs (codes invalides, image manquante) */
  screen?: boolean;
}

export const isNone = (c?: string) => !c || c === 'none' || c === 'transparent';
export const col = (c: string) => (c === 'black' ? '#000000' : c === 'white' ? '#ffffff' : c);
export function luminance(c: string) {
  const h = col(c).replace('#', '');
  if (h.length < 6) return 255;
  const r = parseInt(h.slice(0, 2), 16),
    g = parseInt(h.slice(2, 4), 16),
    b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
export const isDark = (c: string) => !isNone(c) && luminance(c) < 128;
/** Gris « vrai » : ni quasi noir ni quasi blanc → tramé à l'impression thermique. */
export const isGrey = (c: string) => {
  if (isNone(c)) return false;
  const l = luminance(c);
  return l > 30 && l < 225;
};

// Matrice de Bayer 8×8 : tramage ordonné, régulier et net en thermique
const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49,
  17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
];
const halftoneCache = new Map<number, HTMLCanvasElement>();
function halftoneTile(lum: number) {
  const key = Math.round(lum);
  let cv = halftoneCache.get(key);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = cv.height = 8;
  const c = cv.getContext('2d')!;
  const img = c.createImageData(8, 8);
  for (let i = 0; i < 64; i++) {
    const black = (BAYER8[i] + 0.5) / 64 >= key / 255;
    const v = black ? 0 : 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  halftoneCache.set(key, cv);
  return cv;
}

/**
 * Couleur de remplissage pour le contexte courant. En monochrome (ZPL, aperçu
 * thermique), un gris devient une trame alignée sur les points d'impression,
 * au lieu de basculer entièrement en noir ou en blanc au seuillage.
 */
export function paint(c: CanvasRenderingContext2D, color: string, mono?: boolean): string | CanvasPattern {
  const k = col(color);
  if (!mono || !isGrey(k)) return k;
  const p = c.createPattern(halftoneTile(luminance(k)), 'repeat');
  if (!p) return k;
  // 1 point de trame = 1 point d'impression, quelle que soit la transformation en cours
  p.setTransform(c.getTransform().inverse());
  return p;
}

/** Codes-barres et QR : jamais tramés (illisibles sinon) → noir ou blanc pur. */
const inkColor = (color: string, mono?: boolean) => (mono && !isNone(color) ? (luminance(col(color)) >= 225 ? '#ffffff' : '#000000') : col(color));

export { fontString, layoutText, hasFixedHeight, textPad, fitMode, measure as measureTextWidth } from './textLayout';
export type { TextLayout } from './textLayout';

function quoteFamily(f: string) {
  return f.includes(' ') && !f.includes(',') && !f.includes('"') ? `"${f}"` : f;
}

/** Hauteur effective d'un élément (le texte libre a une hauteur automatique). */
export function elementHeight(el: LabelElement, rctx: ResolveCtx): number {
  if (el.type === 'text' && !hasFixedHeight(el)) return layoutText(el, resolveText(el.text, rctx), rctx.doc.allergensExtra).h;
  return el.h;
}

export function dpiScale(doc: LabelDoc) {
  return (doc.dpi || BASE_DPI) / BASE_DPI;
}

function errorBox(c: CanvasRenderingContext2D, w: number, h: number, msg: string, screen?: boolean) {
  if (!screen) return;
  c.save();
  c.fillStyle = 'rgba(229,62,62,0.07)';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = '#e53e3e';
  c.setLineDash([6, 4]);
  c.lineWidth = 2;
  c.strokeRect(1, 1, w - 2, h - 2);
  c.fillStyle = '#c53030';
  c.font = `bold ${Math.max(10, Math.min(22, h / 4))}px Arial`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(msg, w / 2, h / 2, w - 8);
  c.restore();
}

function drawMatrix(c: CanvasRenderingContext2D, q: MatrixCode, w: number, h: number, ds: number, scale: number, color: string, mono?: boolean) {
  const mDots = Math.max(1, Math.floor((Math.min(w / q.cols, h / q.rows) * ds)));
  const m = mDots / ds;
  c.fillStyle = inkColor(color, mono);
  const eps = scale * m > 3 ? 0.5 / scale : 0;
  for (let r = 0; r < q.rows; r++) {
    let k = 0;
    while (k < q.cols) {
      if (q.get(r, k)) {
        let j = k;
        while (j < q.cols && q.get(r, j)) j++;
        c.fillRect(k * m, r * m, (j - k) * m + eps, m + eps);
        k = j;
      } else k++;
    }
  }
}

/** Géométrie d'un code linéaire (partagée avec le générateur ZPL) */
export function linearGeometry(w: number, modules: number, ds: number) {
  const mDots = Math.max(1, Math.floor((w * ds) / modules));
  const m = mDots / ds;
  const total = modules * m;
  return { mDots, m, total, ox: Math.max(0, (w - total) / 2) };
}

/** Dessine un élément à l'origine (0,0), sans rotation ni miroir, en unités u. */
export function drawElement(c: CanvasRenderingContext2D, el: LabelElement, rctx: DrawCtx) {
  switch (el.type) {
    case 'text':
      return drawText(c, el, rctx);
    case 'barcode': {
      const value = resolveText(el.value, rctx);
      const enc = encodeBarcode(value, el.symbology);
      if (enc.error !== undefined) return errorBox(c, el.w, el.h, enc.error, rctx.screen);
      const ds = dpiScale(rctx.doc);
      if (enc.kind === 'matrix') return drawMatrix(c, enc, el.w, el.h, ds, rctx.scale, el.color, rctx.mono);
      const g = linearGeometry(el.w, enc.modules, ds);
      const textH = el.showText ? el.fontSize * 1.15 : 0;
      const barH = Math.max(4, el.h - textH);
      c.fillStyle = inkColor(el.color, rctx.mono);
      let x = g.ox;
      enc.sbs.forEach((wd, i) => {
        if (i % 2 === 0) c.fillRect(x, 0, wd * g.m, barH);
        x += wd * g.m;
      });
      if (el.showText) {
        c.font = `${el.fontSize}px Arial, Helvetica, sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'top';
        c.fillText(enc.text, g.ox + g.total / 2, barH + el.fontSize * 0.1);
      }
      return;
    }
    case 'qr': {
      const value = resolveText(qrPayload(el), rctx);
      const q = encodeQr(value, el.level);
      if (q.error !== undefined) return errorBox(c, el.w, el.h, q.error, rctx.screen);
      return drawMatrix(c, q, el.w, el.h, dpiScale(rctx.doc), rctx.scale, el.color, rctx.mono);
    }
    case 'image': {
      const img = getImage(el.src);
      if (!img) return errorBox(c, el.w, el.h, 'Image…', rctx.screen);
      let dw = el.w,
        dh = el.h,
        dx = 0,
        dy = 0;
      if (el.keepRatio) {
        const r = Math.min(el.w / img.naturalWidth, el.h / img.naturalHeight);
        dw = img.naturalWidth * r;
        dh = img.naturalHeight * r;
        dx = (el.w - dw) / 2;
        dy = (el.h - dh) / 2;
      }
      if (rctx.mono) {
        const pw = Math.max(1, Math.round(dw * rctx.scale));
        const ph = Math.max(1, Math.round(dh * rctx.scale));
        const t = monoImage(img, pw, ph, el.threshold, el.dither);
        c.imageSmoothingEnabled = false;
        c.drawImage(t, dx, dy, dw, dh);
        c.imageSmoothingEnabled = true;
      } else c.drawImage(img, dx, dy, dw, dh);
      return;
    }
    case 'shape': {
      const def = shapeDef(el.kind);
      if (!def) return errorBox(c, el.w, el.h, '?', rctx.screen);
      if (def.category !== 'forme') {
        drawSymbol(c, def, el.w, el.h, col(isNone(el.stroke) ? '#000000' : el.stroke), el.strokeWidth, rctx.doc.background || '#ffffff');
        return;
      }
      if (def.bar) {
        c.fillStyle = paint(c, isNone(el.fill) ? (isNone(el.stroke) ? '#000000' : el.stroke) : el.fill, rctx.mono);
        c.fillRect(0, 0, el.w, el.h);
        return;
      }
      const sw = isNone(el.stroke) ? 0 : Math.max(0, el.strokeWidth);
      const path = def.path!(sw / 2, sw / 2, Math.max(0.1, el.w - sw), Math.max(0.1, el.h - sw), Math.max(0, (el.radius || 0) - sw / 2));
      if (!isNone(el.fill)) {
        c.fillStyle = paint(c, el.fill, rctx.mono);
        c.fill(path);
      }
      if (sw > 0) {
        c.strokeStyle = paint(c, el.stroke, rctx.mono);
        c.lineWidth = sw;
        c.lineJoin = 'miter';
        c.stroke(path);
      }
      return;
    }
    case 'table':
      return drawTable(c, el, rctx);
  }
}

/** Applique miroir puis dessine. */
export function drawElementFull(c: CanvasRenderingContext2D, el: LabelElement, rctx: DrawCtx, h = elementHeight(el, rctx)) {
  if (el.flipX || el.flipY) {
    c.save();
    c.translate(el.flipX ? el.w : 0, el.flipY ? h : 0);
    c.scale(el.flipX ? -1 : 1, el.flipY ? -1 : 1);
    drawElement(c, el, rctx);
    c.restore();
  } else drawElement(c, el, rctx);
}

function drawText(c: CanvasRenderingContext2D, el: TextEl, rctx: DrawCtx) {
  const text = resolveText(el.text, rctx);
  const L = layoutText(el, text, rctx.doc.allergensExtra);
  const fg = el.invert ? (isDark(el.color) ? '#ffffff' : '#000000') : el.color;
  if (el.invert) {
    c.fillStyle = paint(c, el.color, rctx.mono);
    c.fillRect(0, 0, el.w, L.h);
  }
  c.fillStyle = paint(c, fg, rctx.mono);
  const font = fontString(el, L.fontSize);
  c.font = font;
  if (el.curve && el.curve !== 'none') return drawCurved(c, el, L.lines[0]?.text ?? '', L.fontSize);
  c.save();
  if (hasFixedHeight(el)) {
    c.beginPath();
    c.rect(0, 0, el.w, L.h);
    c.clip();
  }
  c.textBaseline = 'middle';
  const innerW = el.w - L.pad * 2;
  const oy = textOffsetY(el, L);
  L.lines.forEach((ln, i) => {
    const cy = oy + L.pad + i * L.lh + L.lh / 2;
    if (ln.runs) {
      // texte enrichi (allergènes en gras) : segments positionnés un par un
      const boldFont = fontString({ ...el, bold: true }, L.fontSize);
      c.textAlign = 'left';
      const segs = richSegments(el, ln, L.fontSize, innerW);
      for (const s of segs) {
        c.font = s.bold ? boldFont : font;
        c.fillText(s.text, L.pad + s.x, cy);
      }
      c.font = font;
      if (el.underline && ln.text && segs.length) {
        const sx = segs[0].x;
        const tw = el.align === 'justify' && !ln.last ? innerW : Math.min(innerW, ln.width);
        c.fillRect(L.pad + sx, cy + L.fontSize * 0.42, tw, Math.max(1, L.fontSize * 0.07));
      }
      return;
    }
    const jw = el.align === 'justify' ? justifyWords(ln, font, innerW) : null;
    if (jw) {
      c.textAlign = 'left';
      jw.forEach((w) => c.fillText(w.word, L.pad + w.x, cy));
    } else {
      const al = el.align === 'justify' ? 'left' : el.align;
      c.textAlign = al;
      const ax = al === 'left' ? L.pad : al === 'center' ? el.w / 2 : el.w - L.pad;
      c.fillText(ln.text, ax, cy);
    }
    if (el.underline && ln.text) {
      const tw = jw ? innerW : Math.min(innerW, ln.width);
      const al = el.align === 'justify' ? 'left' : el.align;
      const sx = al === 'left' ? L.pad : al === 'center' ? el.w / 2 - tw / 2 : el.w - L.pad - tw;
      c.fillRect(sx, cy + L.fontSize * 0.42, tw, Math.max(1, L.fontSize * 0.07));
    }
  });
  c.restore();
}

function drawCurved(c: CanvasRenderingContext2D, el: TextEl, text: string, fs: number) {
  const chars = Array.from(text);
  const widths = chars.map((ch) => c.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) || 1;
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  let R: number, cx: number, cy: number, start: number, dir: number;
  if (el.curve === 'circle') {
    R = Math.max(fs, Math.min(el.w, el.h) / 2 - fs * 0.85);
    cx = el.w / 2;
    cy = el.h / 2;
    const span = total / R;
    start = -Math.PI / 2 - span / 2;
    dir = 1;
  } else {
    const bend = Math.max(1, Math.min(100, el.bend ?? 50));
    const theta = (bend / 100) * Math.PI;
    R = total / theta;
    cx = el.w / 2;
    if (el.curve === 'arcTop') {
      cy = fs * 0.85 + R;
      start = -Math.PI / 2 - theta / 2;
      dir = 1;
    } else {
      cy = el.h - fs * 0.25 - R;
      start = Math.PI / 2 + theta / 2;
      dir = -1;
    }
  }
  let acc = 0;
  chars.forEach((ch, i) => {
    const a = start + (dir * (acc + widths[i] / 2)) / R;
    acc += widths[i];
    c.save();
    c.translate(cx + R * Math.cos(a), cy + R * Math.sin(a));
    c.rotate(dir === 1 ? a + Math.PI / 2 : a - Math.PI / 2);
    c.fillText(ch, 0, dir === 1 ? 0 : fs * 0.72);
    c.restore();
  });
}

export function tableColumns(el: TableEl): number[] {
  return splitSizes(el.colWidths, el.cols, el.w);
}
export function tableRows(el: TableEl): number[] {
  return splitSizes(el.rowHeights, el.rows, el.h);
}
function splitSizes(rel: number[] | undefined, n: number, total: number) {
  const ws = rel && rel.length === n ? rel : Array(n).fill(1);
  const sum = ws.reduce((a, b) => a + b, 0) || 1;
  return ws.map((w) => (w / sum) * total);
}

function drawTable(c: CanvasRenderingContext2D, el: TableEl, rctx: DrawCtx) {
  const sw = Math.max(0, el.strokeWidth);
  const cw = tableColumns(el);
  const rh = tableRows(el);
  c.fillStyle = '#000000';
  if (sw > 0) {
    c.fillRect(0, 0, el.w, sw);
    c.fillRect(0, el.h - sw, el.w, sw);
    c.fillRect(0, 0, sw, el.h);
    c.fillRect(el.w - sw, 0, sw, el.h);
    let y = 0;
    for (let r = 0; r < el.rows - 1; r++) {
      y += rh[r];
      c.fillRect(0, y - sw / 2, el.w, sw);
    }
    let x = 0;
    for (let k = 0; k < el.cols - 1; k++) {
      x += cw[k];
      c.fillRect(x - sw / 2, 0, sw, el.h);
    }
  }
  c.textBaseline = 'middle';
  let y0 = 0;
  for (let r = 0; r < el.rows; r++) {
    let x0 = 0;
    for (let k = 0; k < el.cols; k++) {
      const raw = el.cells[r]?.[k] ?? '';
      if (raw) {
        const txt = resolveText(raw, rctx);
        const bold = el.headerRow && r === 0;
        c.font = `${bold ? 'bold ' : ''}${el.fontSize}px ${quoteFamily(el.fontFamily)}`;
        const padX = sw + el.fontSize * 0.3;
        c.save();
        c.beginPath();
        c.rect(x0 + sw / 2, y0 + sw / 2, cw[k] - sw, rh[r] - sw);
        c.clip();
        c.textAlign = el.align;
        const tx = el.align === 'left' ? x0 + padX : el.align === 'center' ? x0 + cw[k] / 2 : x0 + cw[k] - padX;
        c.fillText(txt, tx, y0 + rh[r] / 2);
        c.restore();
      }
      x0 += cw[k];
    }
    y0 += rh[r];
  }
}

const monoCache = new Map<string, HTMLCanvasElement>();
export function monoImage(img: HTMLImageElement, w: number, h: number, threshold: number, dither: boolean) {
  const key = `${img.src.length}:${img.src.slice(-40)}:${w}x${h}:${threshold}:${dither}`;
  const hit = monoCache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.fillStyle = '#fff';
  c.fillRect(0, 0, w, h);
  c.drawImage(img, 0, 0, w, h);
  const d = c.getImageData(0, 0, w, h);
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * d.data[i * 4] + 0.587 * d.data[i * 4 + 1] + 0.114 * d.data[i * 4 + 2];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = g[i];
      const nv = old < threshold ? 0 : 255;
      if (dither) {
        const err = old - nv;
        if (x + 1 < w) g[i + 1] += (err * 7) / 16;
        if (y + 1 < h) {
          if (x > 0) g[i + w - 1] += (err * 3) / 16;
          g[i + w] += (err * 5) / 16;
          if (x + 1 < w) g[i + w + 1] += err / 16;
        }
      }
      const o = i * 4;
      d.data[o] = d.data[o + 1] = d.data[o + 2] = nv;
      d.data[o + 3] = nv === 0 ? 255 : 0;
    }
  c.clearRect(0, 0, w, h);
  c.putImageData(d, 0, 0);
  if (monoCache.size > 40) monoCache.clear();
  monoCache.set(key, cv);
  return cv;
}

/** Rendu d'un élément seul dans un canvas (éditeur). */
export function renderElementCanvas(el: LabelElement, rctx: DrawCtx) {
  const h = elementHeight(el, rctx);
  const s = rctx.scale;
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.ceil(el.w * s));
  cv.height = Math.max(1, Math.ceil(h * s));
  const c = cv.getContext('2d')!;
  c.scale(s, s);
  drawElementFull(c, el, rctx, h);
  return { canvas: cv, h };
}

export function labelSizeU(doc: LabelDoc) {
  return { W: doc.widthIn * BASE_DPI, H: doc.heightIn * BASE_DPI };
}

export function labelSizeDots(doc: LabelDoc) {
  return { W: Math.round(doc.widthIn * doc.dpi), H: Math.round(doc.heightIn * doc.dpi) };
}

export interface RenderLabelOpts {
  index?: number;
  /** pixels par u ; par défaut : résolution d'impression */
  scale?: number;
  mono?: boolean;
  resolve?: boolean;
  /** n'inclure que ces éléments */
  only?: (el: LabelElement) => boolean;
  transparent?: boolean;
  /** pas de fond (ni blanc ni couleur) */
  noBackground?: boolean;
  /** taille de sortie exacte en pixels (prioritaire sur scale) */
  pixelSize?: { W: number; H: number };
}

export function renderLabel(doc: LabelDoc, opts: RenderLabelOpts = {}) {
  const { W, H } = labelSizeU(doc);
  const pw = opts.pixelSize?.W ?? Math.max(1, Math.round(W * (opts.scale ?? doc.dpi / BASE_DPI)));
  const ph = opts.pixelSize?.H ?? Math.max(1, Math.round(H * (opts.scale ?? doc.dpi / BASE_DPI)));
  const sx = pw / W;
  const sy = ph / H;
  const cv = document.createElement('canvas');
  cv.width = pw;
  cv.height = ph;
  const c = cv.getContext('2d', { willReadFrequently: !!opts.mono })!;
  if (!opts.transparent) {
    c.fillStyle = opts.noBackground ? '#ffffff' : paint(c, doc.background || '#ffffff', opts.mono);
    c.fillRect(0, 0, pw, ph);
  }
  const index = opts.index ?? 0;
  const rctx: DrawCtx = {
    doc,
    index,
    row: doc.data?.rows[index],
    resolve: opts.resolve ?? true,
    scale: sx,
    mono: opts.mono,
  };
  for (const el of doc.elements) {
    if (!isPrinted(el, rctx)) continue;
    if (opts.only && !opts.only(el)) continue;
    c.save();
    c.scale(sx, sy);
    c.translate(el.x, el.y);
    if (el.rotation) c.rotate((el.rotation * Math.PI) / 180);
    drawElementFull(c, el, rctx);
    c.restore();
  }
  if (opts.mono) thresholdCanvas(cv, 128);
  return cv;
}

export function thresholdCanvas(cv: HTMLCanvasElement, t: number) {
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  const d = c.getImageData(0, 0, cv.width, cv.height);
  const a = d.data;
  for (let i = 0; i < a.length; i += 4) {
    const al = a[i + 3] / 255;
    const lum = (0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]) * al + 255 * (1 - al);
    const v = lum < t ? 0 : 255;
    a[i] = a[i + 1] = a[i + 2] = v;
    a[i + 3] = 255;
  }
  c.putImageData(d, 0, 0);
}
