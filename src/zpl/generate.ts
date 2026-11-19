import type { LabelDoc, LabelElement, TextEl, BarcodeEl, QrEl, ShapeEl, TableEl, MarkEl } from '../types';
import {
  dpiScale,
  isDark,
  isGrey,
  isNone,
  luminance,
  col,
  labelSizeDots,
  layoutText,
  linearGeometry,
  renderLabel,
  tableColumns,
  tableRows,
  elementHeight,
  elementBounds,
  measureTextWidth,
  fontString,
  elText,
  flowElements,
  healthMarkLayout,
  rollColumns,
  rollRows,
} from '../render/draw';
export { rollColumns, rollRows } from '../render/draw';
import { encodeBarcode, encodeQr, normalizeBarcode, qrPayload, pdf417Level, pdf417Shape, PDF417_ROW_MODULES, type MatrixCode } from '../render/codes';
import { batchJobs, resolveText, usesData, type ResolveCtx } from '../render/resolve';
import { shapeDef } from '../render/shapes';
import { bitmapToGfa, blackBounds, canvasToBitmap } from './gfa';
import { sbsToCodewords, codewordsToZpl, gs1ElementsToStream } from './code128';
import { textOffsetY, hasRichRuns } from '../render/textLayout';

/** Échappement ^FH : _XX hexadécimal */
export function fd(s: string): string {
  let out = '';
  for (const ch of s) {
    if (ch === '_' || ch === '^' || ch === '~' || ch === '\n' || ch === '\r') out += '_' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0');
    else out += ch;
  }
  return out;
}

/**
 * Codes imprimés en natif. Les autres passent en image ^GFA :
 * - GS1 QR Code : ^BQ ne documente pas de FNC1 en tête (mode GS1) ;
 * - GS1 DataBar : ^BR ne documente ni le format des données ni une hauteur réglable
 *   pour les symboles non composites → la taille ne pourrait pas suivre l'écran.
 */
const NATIVE_BARCODES = new Set([
  'code128',
  'gs1-128',
  'sscc18',
  'ean13',
  'ean8',
  'upca',
  'code39',
  'code93',
  'interleaved2of5',
  'datamatrix',
  'gs1datamatrix',
  'pdf417',
  'azteccode',
  'gs1dlqrcode',
]);
/** module maximal accepté par la commande native (^BO / ^BQ : grossissement 1–10 ; ^BY : 1–10) */
const MAX_MODULE: Record<string, number> = { azteccode: 10, gs1dlqrcode: 10, pdf417: 10 };
/** caractère d'échappement ^BX (qualité 200) pour le FNC1 : absent du jeu de caractères GS1 (CSET 82) */
export const BX_ESCAPE = '#';

function isLight(c: string) {
  return !isDark(c);
}
/** Codes-barres / QR : même seuil que l'écran (inkColor) — blanc seulement à partir de 225 */
const inkIsWhite = (c: string) => !isNone(c) && luminance(col(c)) >= 225;

/** L'élément doit-il être rendu en image (^GFA) ? */
const ZPL_SAFE_FONTS = /^(arial|helvetica|arial narrow|verdana|tahoma|segoe ui|trebuchet ms|consolas)$/i;
/** caractères imprimables par ^A0 avec ^CI28 */
const NON_LATIN = /[^\u0000-ɏ€]/;

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

/** Taille du module (points) d'un code 2D : même calcul que l'écran (drawMatrix) */
export function matrixModuleDots(w: number, h: number, q: { cols: number; rows: number }, ds: number) {
  return Math.max(1, Math.floor(Math.min(w / q.cols, h / q.rows) * ds));
}

export function needsRaster(el: LabelElement, rctx?: ResolveCtx): boolean {
  if (el.rotation % 360 !== 0 || el.flipX || el.flipY) return true;
  // un gris ne s'exprime pas en ^GB/^A (noir ou blanc seulement) → image tramée
  if (hasGrey(el)) return true;
  switch (el.type) {
    case 'text': {
      if (el.zplAsImage || el.italic || (!!el.curve && el.curve !== 'none') || el.align === 'justify' || !ZPL_SAFE_FONTS.test(el.fontFamily)) return true;
      if (!rctx) return false;
      const L = layoutText(el, elText(el, rctx), rctx.doc.allergensExtra);
      // segments gras (allergènes) : une commande ^A ne change pas de graisse en cours de ligne
      if (hasRichRuns(L)) return true;
      const innerW = el.w - L.pad * 2;
      return L.truncated || L.lines.some((l) => l.width > innerW * 0.88 || NON_LATIN.test(l.text));
    }
    case 'barcode': {
      if (!NATIVE_BARCODES.has(el.symbology)) return true;
      const max = MAX_MODULE[el.symbology];
      if (!max || !rctx) return false;
      const enc = encodeBarcode(resolveText(el.value, rctx), el.symbology);
      if (enc.error !== undefined || enc.kind !== 'matrix') return false;
      return matrixModuleDots(el.w, el.h, enc, dpiScale(rctx.doc)) > max;
    }
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
      if (!ZPL_SAFE_FONTS.test(el.fontFamily)) return true;
      return rctx ? tableNeedsRaster(el, rctx) : false;
    case 'mark': {
      // ℮ : gabarit vectoriel → image ; estampille : ^GE + ^A0 si la police et les caractères le permettent
      if (el.kind !== 'health' || !ZPL_SAFE_FONTS.test(el.fontFamily || 'Arial')) return true;
      if (!rctx) return false;
      const { g, lines, fit } = healthMarkLayout(el, rctx);
      if (!lines.length || fit.fontSize <= 0) return false;
      const ds = dpiScale(rctx.doc);
      return Math.round(g.sw * ds) < 2 || lines.some((l) => NON_LATIN.test(l));
    }
  }
}

/**
 * Tableau : même règle que les textes, appliquée à chaque cellule. L'écran rogne la cellule
 * (draw.ts) alors qu'un ^FB à une ligne fait passer le surplus à la ligne et le surimprime :
 * dès qu'une cellule risque de déborder (≥ 88 % de la largeur utile, police plus haute que
 * la cellule, plusieurs lignes, caractères hors ^CI28), tout le tableau part en image.
 */
export function tableNeedsRaster(el: TableEl, rctx: ResolveCtx): boolean {
  const sw = Math.max(0, el.strokeWidth);
  const cw = tableColumns(el);
  const rh = tableRows(el);
  const padX = sw + el.fontSize * 0.3;
  for (let r = 0; r < el.rows; r++)
    for (let k = 0; k < el.cols; k++) {
      const raw = el.cells[r]?.[k] ?? '';
      if (!raw) continue;
      const txt = resolveText(raw, rctx);
      if (!txt) continue;
      if (/[\n\r]/.test(txt) || NON_LATIN.test(txt)) return true;
      if (el.fontSize > rh[r] - sw) return true;
      const bold = el.headerRow && r === 0;
      const font = fontString({ bold, italic: false, fontFamily: el.fontFamily }, el.fontSize);
      if (measureTextWidth(txt, font) > Math.max(0, cw[k] - padX * 2) * 0.88) return true;
    }
  return false;
}

export interface ZplOptions {
  index?: number;
  copies?: number;
  /** forcer tout en image */
  raster?: boolean;
}

/** Une étiquette → ^XA … ^XZ */
export function generateLabelZpl(doc: LabelDoc, opts: ZplOptions = {}): string {
  const { W, H } = labelSizeDots(doc);
  const out: string[] = ['^XA', '^CI28', `^PW${W}`, `^LL${H}`, '^LH0,0'];
  out.push(...labelFields(doc, opts.index ?? 0, !!opts.raster));
  out.push(`^PQ${Math.max(1, opts.copies ?? 1)},0,1,Y`);
  out.push('^XZ');
  return out.filter(Boolean).join('\n');
}

/** Champs d'une étiquette (sans en-tête ni ^PQ / ^XZ), coordonnées relatives à l'étiquette */
function labelFields(doc: LabelDoc, index: number, raster: boolean): string[] {
  const ds = dpiScale(doc);
  const { W, H } = labelSizeDots(doc);
  const D = (v: number) => Math.max(0, Math.round(v * ds));
  const rctx: ResolveCtx = { doc, index, row: doc.data?.rows[index], resolve: true };
  const out: string[] = [];
  // éléments imprimés pour cette ligne, ancres verticales appliquées (positionnement relatif)
  const visible = flowElements(doc, rctx);

  // fond gris → tout en image (trame) ; seul un fond quasi noir reste un ^GB natif
  const bgDark = !isNone(doc.background) && isDark(doc.background) && !isGrey(doc.background);
  const bgPlain = isNone(doc.background) || /^#?f{3,6}$/i.test(doc.background.replace('#', '')) || doc.background === 'white';
  const rasterLightOnly = visible.some((e) => needsRaster(e, rctx) && elementIsLight(e));
  // une trame grise posée sur un autre élément doit « effacer » des points : seul
  // le rendu complet de l'étiquette le permet (un ^GFA par élément n'ajoute que du noir)
  const greyOverlap = visible.some((e, i) => hasGrey(e) && visible.slice(0, i).some((o) => overlaps(e, o)));
  const whole = raster || doc.zplRaster || (!bgPlain && !bgDark) || rasterLightOnly || greyOverlap;

  if (whole) {
    const cv = renderLabel(doc, { index, mono: true, pixelSize: { W, H } });
    const bm = canvasToBitmap(cv);
    out.push('^FO0,0' + bitmapToGfa(bm) + '^FS');
  } else {
    if (bgDark) out.push(`^FO0,0^GB${W},${H},${Math.min(W, H)},B,0^FS`);
    for (const el of visible) {
      if (needsRaster(el, rctx)) out.push(rasterElement(doc, el, index));
      else out.push(...nativeElement(el, rctx, D, ds));
    }
  }
  return out.filter(Boolean);
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
      return inkIsWhite(el.color);
    case 'shape':
      return isNone(el.fill) ? !isNone(el.stroke) && isLight(el.stroke) : isLight(el.fill);
    case 'mark':
      return inkIsWhite(el.color);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Éléments en image (^GFA)
// ---------------------------------------------------------------------------

/** Zone de pixels (origine multiple de 8 : même phase de trame que le rendu complet) */
type Region = { x: number; y: number; w: number; h: number };
function snapRegion(x0: number, y0: number, x1: number, y1: number, W: number, H: number): Region | null {
  const x = Math.max(0, Math.floor(x0 / 8) * 8);
  const y = Math.max(0, Math.floor(y0 / 8) * 8);
  const xe = Math.min(W, Math.ceil(x1));
  const ye = Math.min(H, Math.ceil(y1));
  if (xe <= x || ye <= y) return null;
  return { x, y, w: xe - x, h: ye - y };
}

/** Les pixels noirs touchent-ils un bord de la zone qui n'est pas un bord de l'étiquette ? */
function touchesInnerEdge(b: { x: number; y: number; w: number; h: number }, rg: Region, W: number, H: number) {
  return (b.x === 0 && rg.x > 0) || (b.y === 0 && rg.y > 0) || (b.x + b.w >= rg.w && rg.x + rg.w < W) || (b.y + b.h >= rg.h && rg.y + rg.h < H);
}

/** Statistiques du cache ^GFA (tests, diagnostic) */
export const rasterStats = { renders: 0, hits: 0, fallbacks: 0 };
const gfaCache = new WeakMap<LabelElement, Map<string, string>>();

/**
 * Élément seul en ^GFA. Seule la boîte de l'élément (avec une marge) est rendue, plus
 * un canvas de la taille de l'étiquette. Si des pixels noirs atteignent le bord de la
 * zone (débordement inattendu), on refait le rendu complet : la sortie est toujours
 * identique octet pour octet à celle du rendu de toute l'étiquette.
 * Les éléments sans champ {{…}} sont mis en cache (même ^GFA pour chaque ligne).
 */
export function rasterElement(doc: LabelDoc, el: LabelElement, index: number, opts: { full?: boolean } = {}): string {
  const cacheable = !opts.full && !usesData(el) && !(el.type === 'mark' && el.approval.includes('{{')) && !(el.type === 'text' && el.removeEmptyLines);
  const key = `${doc.dpi}|${doc.widthIn}x${doc.heightIn}|${(doc.allergensExtra ?? []).join(',')}`;
  if (cacheable) {
    const hit = gfaCache.get(el)?.get(key);
    if (hit !== undefined) {
      rasterStats.hits++;
      return hit;
    }
  }
  const res = renderElementGfa(doc, el, index, !!opts.full);
  if (cacheable && res) {
    let m = gfaCache.get(el);
    if (!m) gfaCache.set(el, (m = new Map()));
    m.set(key, res);
  }
  return res;
}

function renderElementGfa(doc: LabelDoc, el: LabelElement, index: number, full: boolean): string {
  rasterStats.renders++;
  const { W, H } = labelSizeDots(doc);
  const base = { index, mono: true, pixelSize: { W, H }, only: (e: LabelElement) => e.id === el.id, noBackground: true };
  if (!full) {
    const rctx: ResolveCtx = { doc, index, row: doc.data?.rows[index], resolve: true };
    const sx = W / (doc.widthIn * 203);
    const sy = H / (doc.heightIn * 203);
    const h = elementHeight(el, rctx);
    const bb = elementBounds(el, h);
    // marge : glyphes ou texte lisible qui débordent un peu de la boîte
    const m = Math.max(el.w, h) * 0.25 + 24;
    const rg = snapRegion((bb.x - m) * sx, (bb.y - m) * sy, (bb.x + bb.w + m) * sx, (bb.y + bb.h + m) * sy, W, H);
    if (!rg) return '';
    const bm = canvasToBitmap(renderLabel(doc, { ...base, region: rg }));
    const b = blackBounds(bm);
    if (!b) return '';
    if (!touchesInnerEdge(b, rg, W, H)) return `^FO${b.x + rg.x},${b.y + rg.y}${bitmapToGfa(bm, b)}^FS`;
    rasterStats.fallbacks++;
  }
  const bm = canvasToBitmap(renderLabel(doc, base));
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
    case 'mark':
      return nativeMark(el, rctx, D);
    default:
      return [];
  }
}

const J = { left: 'L', center: 'C', right: 'R' } as const; // tableaux

function font(h: number) {
  const hh = Math.max(10, Math.round(h));
  return `^A0N,${hh},${hh}`;
}

/**
 * Estampille sanitaire native : ovale ^GE (ZPL II Programming Guide, ^GE « Graphic Ellipse » :
 * ^GEw,h,t,c — largeur, hauteur, épaisseur du trait tracée vers l'intérieur, couleur B/W) aux
 * dimensions de la boîte (le trait de l'écran est lui aussi entièrement intérieur), puis
 * une commande ^A0 + ^FB centrée par ligne, à la taille ajustée à l'écran.
 */
function nativeMark(el: MarkEl, rctx: ResolveCtx, D: (v: number) => number): string[] {
  const { g, lines, fit } = healthMarkLayout(el, rctx);
  const out: string[] = [];
  const w = Math.max(3, D(el.w)),
    h = Math.max(3, D(el.h));
  if (g.sw > 0) out.push(`^FO${D(el.x)},${D(el.y)}^GE${w},${h},${Math.max(2, Math.min(D(g.sw), Math.floor(Math.min(w, h) / 2)))},B^FS`);
  if (fit.fontSize > 0)
    lines.forEach((l, i) => {
      const bw = fit.widths[i];
      out.push(`^FO${D(el.x + g.cx - bw / 2)},${D(el.y + g.cy + fit.ys[i] - fit.fontSize / 2)}${font(D(fit.fontSize))}^FB${Math.max(1, D(bw))},1,0,C,0^FH^FD${fd(l)}^FS`);
    });
  return out;
}

function nativeText(el: TextEl, rctx: ResolveCtx, D: (v: number) => number): string[] {
  const text = elText(el, rctx);
  const L = layoutText(el, text, rctx.doc.allergensExtra);
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

/**
 * Codes 2D natifs. Le module (points) est celui de l'écran ; les paramètres qui fixent la
 * taille du symbole sont alignés sur ceux imposés à bwip-js :
 * - PDF417 ^B7 : hauteur de rangée = 3 modules (h × module, ZPL II Programming Guide ^B7),
 *   niveau de sécurité et nombre de colonnes de données identiques ; rangées laissées au
 *   calcul de l'imprimante (forcer c × r supprime le symbole si les données n'y tiennent pas) ;
 * - Aztec ^BO : correction minimale 23 % (valeur par défaut de bwip-js), taille automatique ;
 * - GS1 DataMatrix ^BX qualité 200 : FNC1 explicite via le caractère d'échappement g = « # »
 *   (« #1 » = FNC1 ; ^FH est traité avant les séquences d'échappement) ;
 * - QR GS1 Digital Link : URL ordinaire en ^BQ modèle 2, correction M (défaut bwip-js).
 */
function nativeMatrix(el: BarcodeEl, enc: MatrixCode, data: string, D: (v: number) => number, ds: number, fr: string): string[] {
  const m = matrixModuleDots(el.w, el.h, enc, ds);
  const at = `^FO${D(el.x)},${D(el.y)}`;
  switch (el.symbology) {
    case 'pdf417': {
      const { columns } = pdf417Shape(enc);
      return [`${at}^BY${m}^B7N,${PDF417_ROW_MODULES},${pdf417Level(data)},${columns},,N${fr}^FH^FD${fd(data)}^FS`];
    }
    case 'azteccode':
      return [`${at}^BON,${m},N,23,N${fr}^FH^FD${fd(data)}^FS`];
    case 'gs1datamatrix': {
      const stream = gs1ElementsToStream(data);
      if (stream === null) return [];
      const z = BX_ESCAPE + '1' + stream.replace(/\x1d/g, BX_ESCAPE + '1');
      return [`${at}^BXN,${m},200,0,0,1,${BX_ESCAPE}${fr}^FH^FD${fd(z)}^FS`];
    }
    case 'gs1dlqrcode':
      return [`${at}^BQN,2,${Math.min(10, m)}${fr}^FH^FDMA,${fd(data)}^FS`];
    default:
      return [`${at}^BXN,${m},200${fr}^FH^FD${fd(data)}^FS`];
  }
}

function nativeBarcode(el: BarcodeEl, rctx: ResolveCtx, D: (v: number) => number, ds: number): string[] {
  const value = resolveText(el.value, rctx);
  const enc = encodeBarcode(value, el.symbology);
  const n = normalizeBarcode(value, el.symbology);
  if (enc.error !== undefined || 'error' in n) return [];
  const fr = inkIsWhite(el.color) ? '^FR' : '';
  if (enc.kind === 'matrix') return nativeMatrix(el, enc, n.data, D, ds, fr);
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
    case 'sscc18': {
      // mêmes mots de code que l'écran (bwip-js) : départ, changements de jeu et FNC1 (>8)
      // explicites en mode N ; texte lisible « (AI)… » envoyé en image, placé comme à l'écran
      const cw = sbsToCodewords(enc.sbs);
      const z = cw ? codewordsToZpl(cw.slice(0, -1)) : null;
      if (z) {
        const out = [`${pos}^BCN,${barH},N,N,N,N${fr}^FH^FD${fd(z)}^FS`];
        if (el.showText) out.push(humanReadableGfa(el, enc.text, g, rctx, fr));
        return out.filter(Boolean);
      }
      cmd = `^BCN,${barH},${hr},N,N,D`;
      break;
    }
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

/** Texte lisible d'un code linéaire, en image ^GFA (même police et même position qu'à l'écran) */
function humanReadableGfa(el: BarcodeEl, text: string, g: { ox: number; total: number }, rctx: ResolveCtx, fr: string): string {
  const { W, H } = labelSizeDots(rctx.doc);
  const ds = dpiScale(rctx.doc);
  const barH = Math.max(4, el.h - el.fontSize * 1.15);
  const fontCss = `${el.fontSize}px Arial, Helvetica, sans-serif`;
  const cx = el.x + g.ox + g.total / 2;
  const top = el.y + barH + el.fontSize * 0.1;
  const draw = (rg: Region) => {
    const cv = document.createElement('canvas');
    cv.width = rg.w;
    cv.height = rg.h;
    const c = cv.getContext('2d', { willReadFrequently: true })!;
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, rg.w, rg.h);
    c.translate(-rg.x, -rg.y);
    c.scale(ds, ds);
    c.translate(el.x, el.y);
    c.fillStyle = '#000000';
    c.font = fontCss;
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.fillText(text, g.ox + g.total / 2, barH + el.fontSize * 0.1);
    return canvasToBitmap(cv);
  };
  // zone du texte seulement (pas un canvas de toute l'étiquette) ; repli complet si débordement
  const tw = measureTextWidth(text, fontCss);
  const m = el.fontSize + 16;
  let rg = snapRegion((cx - tw / 2 - m) * ds, (top - m) * ds, (cx + tw / 2 + m) * ds, (top + el.fontSize * 1.5 + m) * ds, W, H);
  let bm = rg ? draw(rg) : null;
  let b = bm ? blackBounds(bm) : null;
  if (!rg || (b && touchesInnerEdge(b, rg, W, H))) {
    rg = { x: 0, y: 0, w: W, h: H };
    bm = draw(rg);
    b = blackBounds(bm);
  }
  return b && bm ? `^FO${b.x + rg.x},${b.y + rg.y}${fr}${bitmapToGfa(bm, b)}^FS` : '';
}

function nativeQr(el: QrEl, rctx: ResolveCtx, D: (v: number) => number, ds: number): string[] {
  const value = resolveText(qrPayload(el), rctx);
  const q = encodeQr(value, el.level);
  if (q.error !== undefined) return [];
  const mag = matrixModuleDots(el.w, el.h, q, ds);
  const fr = inkIsWhite(el.color) ? '^FR' : '';
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

/**
 * Tableau natif (quand tableNeedsRaster a confirmé que chaque cellule tient sur une ligne,
 * sans rognage) : traits ^GB, une commande ^A0 + ^FB par cellule. La ligne d'en-tête,
 * en gras à l'écran, est imprimée deux fois décalée d'un point (gras simulé : la police ^A0
 * n'a qu'une graisse).
 */
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
      const txt = raw ? resolveText(raw, rctx) : '';
      if (txt) {
        const padX = sw + el.fontSize * 0.3;
        const fx = D(x0 + padX);
        const rest = `,${D(y0 + rh[r] / 2 - el.fontSize / 2)}${font(D(el.fontSize))}^FB${Math.max(1, D(cw[k] - padX * 2))},1,0,${J[el.align]},0^FH^FD${fd(txt)}^FS`;
        out.push(`^FO${fx}${rest}`);
        if (el.headerRow && r === 0) out.push(`^FO${fx + 1}${rest}`);
      }
      x0 += cw[k];
    }
    y0 += rh[r];
  }
  return out;
}

/** ZPL d'une liste d'étiquettes (travail d'impression) */
export function generateJobsZpl(doc: LabelDoc, jobs: { index: number; copies: number }[]): string {
  if (rollColumns(doc) > 1) return generateRollZpl(doc, jobs);
  return jobs.map((j) => generateLabelZpl(doc, { index: j.index, copies: j.copies })).join('\n');
}

/** ZPL pour tout le lot (lignes cochées / série) */
export function generateBatchZpl(doc: LabelDoc, currentRow = 0, onlyCurrent = false, copies?: number): string {
  const jobs = onlyCurrent ? [{ index: currentRow, copies: copies ?? 1 }] : batchJobs(doc, currentRow);
  return generateJobsZpl(
    doc,
    jobs.map((j) => ({ index: j.index, copies: copies ?? j.copies })),
  );
}

// ---------------------------------------------------------------------------
// Rouleau à plusieurs étiquettes de front
// ---------------------------------------------------------------------------

/** Géométrie du rouleau en points d'impression : largeur d'étiquette, décalage de chaque colonne, largeur totale (^PW) */
export function rollGeometryDots(doc: LabelDoc) {
  const { W, H } = labelSizeDots(doc);
  const cols = rollColumns(doc);
  const mm = (v: number) => Math.max(0, Math.round(((Number(v) || 0) / 25.4) * doc.dpi));
  const gap = cols > 1 ? mm(doc.roll?.gapMm ?? 0) : 0;
  const left = cols > 1 ? mm(doc.roll?.leftMm ?? 0) : 0;
  const offsets = Array.from({ length: cols }, (_, k) => left + k * (W + gap));
  return { W, H, cols, gap, left, offsets, totalW: left + cols * W + (cols - 1) * gap };
}

/** Décale horizontalement toutes les origines de champ ^FO d'une liste de commandes */
function shiftFields(fields: string[], dx: number): string[] {
  if (!dx) return fields;
  // les données ^FD sont échappées par ^FH (« ^ » → _5E) et les ^GFA sont en hexadécimal :
  // aucun « ^FO » ne peut apparaître ailleurs qu'en tête de champ
  return fields.map((f) => f.replace(/\^FO(\d+),(\d+)/g, (_, x: string, y: string) => `^FO${Number(x) + dx},${y}`));
}

/**
 * Plusieurs étiquettes de front : chaque rangée du rouleau est UN format ^XA…^XZ de
 * largeur ^PW = largeur totale du support (marge gauche + colonnes + écarts) ; les champs
 * de la colonne k sont décalés de marge + k × (largeur + écart). ^PQ = nombre de rangées
 * identiques consécutives. Une dernière rangée incomplète laisse les colonnes restantes vierges.
 */
export function generateRollZpl(doc: LabelDoc, jobs: { index: number; copies: number }[]): string {
  const geo = rollGeometryDots(doc);
  const cache = new Map<number, string[]>();
  const fieldsOf = (i: number) => {
    let f = cache.get(i);
    if (!f) cache.set(i, (f = labelFields(doc, i, false)));
    return f;
  };
  const out: string[] = [];
  for (const row of rollRows(jobs, geo.cols)) {
    out.push('^XA', '^CI28', `^PW${geo.totalW}`, `^LL${geo.H}`, '^LH0,0');
    row.slots.forEach((idx, k) => out.push(...shiftFields(fieldsOf(idx), geo.offsets[k])));
    out.push(`^PQ${row.count},0,1,Y`, '^XZ');
  }
  return out.join('\n');
}
