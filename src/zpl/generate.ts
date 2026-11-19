import type { LabelDoc, LabelElement, TextEl, BarcodeEl, QrEl, ShapeEl, TableEl } from '../types';
import {
  dpiScale,
  isDark,
  isGrey,
  isNone,
  labelSizeDots,
  layoutText,
  linearGeometry,
  renderLabel,
  tableColumns,
  tableRows,
} from '../render/draw';
import { encodeBarcode, encodeQr, normalizeBarcode, qrPayload } from '../render/codes';
import { batchJobs, resolveText, type ResolveCtx } from '../render/resolve';
import { shapeDef } from '../render/shapes';
import { bitmapToGfa, blackBounds, canvasToBitmap } from './gfa';
import { textOffsetY } from '../render/textLayout';

/** Échappement ^FH : _XX hexadécimal */
export function fd(s: string): string {
  let out = '';
  for (const ch of s) {
    if (ch === '_' || ch === '^' || ch === '~' || ch === '\n' || ch === '\r') out += '_' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0');
    else out += ch;
  }
  return out;
}

const NATIVE_BARCODES = new Set(['code128', 'gs1-128', 'sscc18', 'ean13', 'ean8', 'upca', 'code39', 'code93', 'interleaved2of5', 'datamatrix']);

function isLight(c: string) {
  return !isDark(c);
}

/** L'élément doit-il être rendu en image (^GFA) ? */
const ZPL_SAFE_FONTS = /^(arial|helvetica|arial narrow|verdana|tahoma|segoe ui|trebuchet ms|consolas)$/i;

/**
 * L'élément doit-il être rendu en image (^GFA) ?
 * Texte : la fidélité prime — si une ligne occupe presque toute la largeur (la police ^A0
 * de l'imprimante n'a pas les mêmes métriques), si le texte est justifié, italique, courbé,
 * tronqué « … » ou dans une police non linéale, on envoie une image.
 */
/** Couleurs grises d'un élément (hors codes, toujours imprimés en noir pur) */
function hasGrey(el: LabelElement): boolean {
  switch (el.type) {
    case 'text':
      return isGrey(el.color);
    case 'shape':
      return isGrey(el.fill) || isGrey(el.stroke);
    default:
      return false;
  }
}

export function needsRaster(el: LabelElement, rctx?: ResolveCtx): boolean {
  if (el.rotation % 360 !== 0 || el.flipX || el.flipY) return true;
  // un gris ne s'exprime pas en ^GB/^A (noir ou blanc seulement) → image tramée
  if (hasGrey(el)) return true;
  switch (el.type) {
    case 'text': {
      if (el.zplAsImage || el.italic || (!!el.curve && el.curve !== 'none') || el.align === 'justify' || !ZPL_SAFE_FONTS.test(el.fontFamily)) return true;
      if (!rctx) return false;
      const L = layoutText(el, resolveText(el.text, rctx));
      const innerW = el.w - L.pad * 2;
      return L.truncated || L.lines.some((l) => l.width > innerW * 0.88 || /[^\u0000-\u024F\u20AC]/.test(l.text));
    }
    case 'barcode':
      return !NATIVE_BARCODES.has(el.symbology);
    case 'qr':
      return false;
    case 'image':
      return true;
    case 'shape': {
      const def = shapeDef(el.kind);
      if (!def || def.category !== 'forme') return true;
      return !['rect', 'roundrect', 'circle', 'ellipse', 'line', 'vline'].includes(el.kind);
    }
    case 'table':
      return false;
  }
}

export interface ZplOptions {
  index?: number;
  copies?: number;
  /** forcer tout en image */
  raster?: boolean;
}

/** Une étiquette → ^XA … ^XZ */
export function generateLabelZpl(doc: LabelDoc, opts: ZplOptions = {}): string {
  const index = opts.index ?? 0;
  const ds = dpiScale(doc);
  const { W, H } = labelSizeDots(doc);
  const D = (v: number) => Math.max(0, Math.round(v * ds));
  const rctx: ResolveCtx = { doc, index, row: doc.data?.rows[index], resolve: true };
  const out: string[] = ['^XA', '^CI28', `^PW${W}`, `^LL${H}`, '^LH0,0'];
  const visible = doc.elements.filter((e) => !e.hidden);

  // fond gris → tout en image (trame) ; seul un fond quasi noir reste un ^GB natif
  const bgDark = !isNone(doc.background) && isDark(doc.background) && !isGrey(doc.background);
  const bgPlain = isNone(doc.background) || /^#?f{3,6}$/i.test(doc.background.replace('#', '')) || doc.background === 'white';
  const rasterLightOnly = visible.some((e) => needsRaster(e, rctx) && elementIsLight(e));
  // une trame grise posée sur un autre élément doit « effacer » des points : seul
  // le rendu complet de l'étiquette le permet (un ^GFA par élément n'ajoute que du noir)
  const greyOverlap = visible.some((e, i) => hasGrey(e) && visible.slice(0, i).some((o) => overlaps(e, o)));
  const whole = opts.raster || doc.zplRaster || (!bgPlain && !bgDark) || rasterLightOnly || greyOverlap;

  if (whole) {
    const cv = renderLabel(doc, { index, mono: true, pixelSize: { W, H } });
    const bm = canvasToBitmap(cv);
    out.push('^FO0,0' + bitmapToGfa(bm) + '^FS');
  } else {
    if (bgDark) out.push(`^FO0,0^GB${W},${H},${Math.min(W, H)},B,0^FS`);
    for (const el of visible) {
      if (needsRaster(el, rctx)) out.push(rasterElement(doc, el, index, W, H));
      else out.push(...nativeElement(el, rctx, D, ds));
    }
  }
  out.push(`^PQ${Math.max(1, opts.copies ?? 1)},0,1,Y`);
  out.push('^XZ');
  return out.filter(Boolean).join('\n');
}

/** Chevauchement des boîtes englobantes (rotation ignorée : approximation prudente) */
function overlaps(a: LabelElement, b: LabelElement) {
  const r = (e: LabelElement) => {
    const m = e.rotation % 180 !== 0 ? Math.max(e.w, e.h) : 0;
    return { x0: e.x - m / 2, y0: e.y - m / 2, x1: e.x + e.w + m / 2, y1: e.y + e.h + m / 2 };
  };
  const A = r(a),
    B = r(b);
  return A.x0 < B.x1 && B.x0 < A.x1 && A.y0 < B.y1 && B.y0 < A.y1;
}

function elementIsLight(el: LabelElement) {
  // un gris clair est tramé (points noirs) : il s'imprime très bien en image isolée
  if (hasGrey(el)) return false;
  switch (el.type) {
    case 'text':
      return el.invert ? false : isLight(el.color);
    case 'barcode':
    case 'qr':
      return isLight(el.color);
    case 'shape':
      return isNone(el.fill) ? !isNone(el.stroke) && isLight(el.stroke) : isLight(el.fill);
    default:
      return false;
  }
}

function rasterElement(doc: LabelDoc, el: LabelElement, index: number, W: number, H: number) {
  const cv = renderLabel(doc, { index, mono: true, pixelSize: { W, H }, only: (e) => e.id === el.id, noBackground: true });
  const bm = canvasToBitmap(cv);
  const b = blackBounds(bm);
  if (!b) return '';
  return `^FO${b.x},${b.y}${bitmapToGfa(bm, b)}^FS`;
}

function nativeElement(el: LabelElement, rctx: ResolveCtx, D: (v: number) => number, ds: number): string[] {
  switch (el.type) {
    case 'text':
      return nativeText(el, rctx, D);
    case 'barcode':
      return nativeBarcode(el, rctx, D, ds);
    case 'qr':
      return nativeQr(el, rctx, D, ds);
    case 'shape':
      return nativeShape(el, D);
    case 'table':
      return nativeTable(el, rctx, D);
    default:
      return [];
  }
}

const J = { left: 'L', center: 'C', right: 'R' } as const; // tableaux

function font(h: number) {
  const hh = Math.max(10, Math.round(h));
  return `^A0N,${hh},${hh}`;
}

function nativeText(el: TextEl, rctx: ResolveCtx, D: (v: number) => number): string[] {
  const text = resolveText(el.text, rctx);
  const L = layoutText(el, text);
  const out: string[] = [];
  const reverse = el.invert || isLight(el.color);
  if (el.invert) out.push(`^FO${D(el.x)},${D(el.y)}^GB${D(el.w)},${D(L.h)},${D(Math.min(el.w, L.h))},${isLight(el.color) ? 'W' : 'B'},0^FS`);
  const oy = textOffsetY(el, L);
  const capOffset = (L.lh - L.fontSize) / 2;
  const just = el.align === 'center' ? 'C' : el.align === 'right' ? 'R' : 'L';
  // une commande par ligne : coupures et taille identiques à l'écran
  L.lines.forEach((ln, i) => {
    if (!ln.text) return;
    const y = el.y + oy + L.pad + i * L.lh + capOffset;
    out.push(`^FO${D(el.x + L.pad)},${D(y)}${font(D(L.fontSize))}^FB${D(el.w - L.pad * 2)},1,0,${just},0${reverse ? '^FR' : ''}^FH^FD${fd(ln.text)}^FS`);
    if (el.underline) out.push(`^FO${D(el.x + L.pad)},${D(y + L.fontSize * 0.95)}^GB${D(el.w - L.pad * 2)},${Math.max(1, D(L.fontSize * 0.07))},${Math.max(1, D(L.fontSize * 0.07))},B,0^FS`);
  });
  return out;
}

function nativeBarcode(el: BarcodeEl, rctx: ResolveCtx, D: (v: number) => number, ds: number): string[] {
  const value = resolveText(el.value, rctx);
  const enc = encodeBarcode(value, el.symbology);
  const n = normalizeBarcode(value, el.symbology);
  if (enc.error !== undefined || 'error' in n) return [];
  const fr = isLight(el.color) ? '^FR' : '';
  if (enc.kind === 'matrix') {
    const mDots = Math.max(1, Math.floor(Math.min(el.w / enc.cols, el.h / enc.rows) * ds));
    return [`^FO${D(el.x)},${D(el.y)}^BXN,${mDots},200${fr}^FH^FD${fd(n.data)}^FS`];
  }
  const g = linearGeometry(el.w, enc.modules, ds);
  const textH = el.showText ? el.fontSize * 1.15 : 0;
  const barH = Math.max(4, D(el.h - textH));
  const hr = el.showText ? 'Y' : 'N';
  const pos = `^FO${D(el.x + g.ox)},${D(el.y)}^BY${g.mDots},3,${barH}`;
  let cmd = '';
  let data = n.data;
  switch (el.symbology) {
    case 'code128':
      cmd = `^BCN,${barH},${hr},N,N,A`;
      break;
    case 'gs1-128':
    case 'sscc18':
      cmd = `^BCN,${barH},${hr},N,N,D`;
      break;
    case 'ean13':
      cmd = `^BEN,${barH},${hr},N`;
      data = data.slice(0, 12);
      break;
    case 'ean8':
      cmd = `^B8N,${barH},${hr},N`;
      data = data.slice(0, 7);
      break;
    case 'upca':
      cmd = `^BUN,${barH},${hr},N,Y`;
      data = data.slice(0, 11);
      break;
    case 'code39':
      cmd = `^B3N,N,${barH},${hr},N`;
      break;
    case 'code93':
      cmd = `^BAN,${barH},${hr},N,N`;
      break;
    case 'interleaved2of5':
      cmd = `^B2N,${barH},${hr},N,N`;
      break;
  }
  return [`${pos}${cmd}${fr}^FH^FD${fd(data)}^FS`];
}

function nativeQr(el: QrEl, rctx: ResolveCtx, D: (v: number) => number, ds: number): string[] {
  const value = resolveText(qrPayload(el), rctx);
  const q = encodeQr(value, el.level);
  if (q.error !== undefined) return [];
  const mag = Math.max(1, Math.floor(Math.min(el.w / q.cols, el.h / q.rows) * ds));
  const fr = isLight(el.color) ? '^FR' : '';
  return [`^FO${D(el.x)},${D(el.y)}^BQN,2,${Math.min(10, mag)}${fr}^FH^FD${el.level}A,${fd(value)}^FS`];
}

function nativeShape(el: ShapeEl, D: (v: number) => number): string[] {
  const w = Math.max(1, D(el.w));
  const h = Math.max(1, D(el.h));
  const x = D(el.x),
    y = D(el.y);
  const out: string[] = [];
  const C = (c: string) => (isDark(c) ? 'B' : 'W');
  if (el.kind === 'line' || el.kind === 'vline') {
    const c = isNone(el.fill) ? el.stroke : el.fill;
    return [`^FO${x},${y}^GB${w},${h},${Math.min(w, h)},${C(c)},0^FS`];
  }
  const t = isNone(el.stroke) ? 0 : Math.max(1, D(el.strokeWidth));
  if (el.kind === 'rect' || el.kind === 'roundrect') {
    const radius = el.kind === 'roundrect' ? el.radius || Math.min(el.w, el.h) * 0.2 : 0;
    const r = Math.max(0, Math.min(8, Math.round((radius / (Math.min(el.w, el.h) / 2)) * 8)));
    if (!isNone(el.fill)) out.push(`^FO${x},${y}^GB${w},${h},${Math.min(w, h)},${C(el.fill)},${r}^FS`);
    if (t && (isNone(el.fill) || C(el.fill) !== C(el.stroke))) out.push(`^FO${x},${y}^GB${w},${h},${Math.min(t, Math.min(w, h))},${C(el.stroke)},${r}^FS`);
    return out;
  }
  // cercle / ellipse
  const circle = Math.abs(w - h) <= 1;
  const shape = (th: number, c: string) =>
    circle ? `^FO${x},${y}^GC${w},${th},${c}^FS` : `^FO${x},${y}^GE${w},${h},${th},${c}^FS`;
  if (!isNone(el.fill)) out.push(shape(Math.ceil(Math.min(w, h) / 2), C(el.fill)));
  if (t && (isNone(el.fill) || C(el.fill) !== C(el.stroke))) out.push(shape(t, C(el.stroke)));
  return out;
}

function nativeTable(el: TableEl, rctx: ResolveCtx, D: (v: number) => number): string[] {
  const out: string[] = [];
  const sw = Math.max(0, el.strokeWidth);
  const cw = tableColumns(el);
  const rh = tableRows(el);
  const t = Math.max(1, D(sw));
  if (sw > 0) {
    out.push(`^FO${D(el.x)},${D(el.y)}^GB${D(el.w)},${D(el.h)},${t},B,0^FS`);
    let yy = el.y;
    for (let r = 0; r < el.rows - 1; r++) {
      yy += rh[r];
      out.push(`^FO${D(el.x)},${D(yy - sw / 2)}^GB${D(el.w)},${t},${t},B,0^FS`);
    }
    let xx = el.x;
    for (let k = 0; k < el.cols - 1; k++) {
      xx += cw[k];
      out.push(`^FO${D(xx - sw / 2)},${D(el.y)}^GB${t},${D(el.h)},${t},B,0^FS`);
    }
  }
  let y0 = el.y;
  for (let r = 0; r < el.rows; r++) {
    let x0 = el.x;
    for (let k = 0; k < el.cols; k++) {
      const raw = el.cells[r]?.[k] ?? '';
      if (raw) {
        const txt = resolveText(raw, rctx);
        const padX = sw + el.fontSize * 0.3;
        out.push(
          `^FO${D(x0 + padX)},${D(y0 + rh[r] / 2 - el.fontSize / 2)}${font(D(el.fontSize))}^FB${Math.max(1, D(cw[k] - padX * 2))},1,0,${J[el.align]},0^FH^FD${fd(txt)}^FS`,
        );
      }
      x0 += cw[k];
    }
    y0 += rh[r];
  }
  return out;
}

/** ZPL pour tout le lot (lignes cochées / série) */
export function generateBatchZpl(doc: LabelDoc, currentRow = 0, onlyCurrent = false, copies?: number): string {
  const jobs = onlyCurrent ? [{ index: currentRow, copies: copies ?? 1 }] : batchJobs(doc, currentRow);
  return jobs.map((j) => generateLabelZpl(doc, { index: j.index, copies: copies ?? j.copies })).join('\n');
}

