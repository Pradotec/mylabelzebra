/**
 * Mise en page du texte — fonction unique partagée par l'éditeur, les exports
 * (PNG/JPG/SVG/PDF, impression) et le générateur ZPL.
 * Entrée : texte résolu (valeurs de la ligne de données incluses), boîte, police, mode.
 * Sortie : lignes + taille de police effective + hauteur de boîte.
 */
import type { TextEl, TextFit } from '../types';
import { allergenMask } from './allergens';

export interface TextRun {
  text: string;
  bold: boolean;
}

export interface TextLine {
  text: string;
  width: number;
  /** dernière ligne d'un paragraphe (non justifiée) */
  last: boolean;
  /** segments gras / normaux (texte enrichi : allergènes en gras) ; absent = texte uniforme */
  runs?: TextRun[];
}

export interface TextLayout {
  lines: TextLine[];
  fontSize: number;
  /** hauteur d'une ligne */
  lh: number;
  /** hauteur de la boîte */
  h: number;
  /** marge intérieure (texte inversé) */
  pad: number;
  /** hauteur occupée par le texte (padding compris) */
  textH: number;
  /** le texte a été tronqué (lignes coupées ou « … ») */
  truncated: boolean;
}

let mctx: CanvasRenderingContext2D | null = null;
function ctx() {
  if (!mctx) mctx = document.createElement('canvas').getContext('2d')!;
  return mctx;
}

function quoteFamily(f: string) {
  return f.includes(' ') && !f.includes(',') && !f.includes('"') ? `"${f}"` : f;
}

export function fontString(el: Pick<TextEl, 'bold' | 'italic' | 'fontFamily'>, size: number) {
  return `${el.italic ? 'italic ' : ''}${el.bold ? 'bold ' : ''}${Math.max(1, size)}px ${quoteFamily(el.fontFamily)}`;
}

export function measure(text: string, font: string) {
  const c = ctx();
  c.font = font;
  return c.measureText(text).width;
}

/** Mode effectif (compatibilité avec les anciens documents) */
export function fitMode(el: TextEl): TextFit {
  if (el.fit) return el.fit;
  return el.autoShrink ? 'wrapShrink' : 'wrapGrow';
}

export const isCurved = (el: TextEl) => !!el.curve && el.curve !== 'none';
/** la hauteur de la boîte est-elle fixée par l'utilisateur ? */
export const hasFixedHeight = (el: TextEl) => isCurved(el) || fitMode(el) !== 'wrapGrow';

export function textPad(el: TextEl, fs = el.fontSize) {
  return el.invert ? Math.round(fs * 0.18) : 0;
}

/** Coupe un mot trop long caractère par caractère */
function breakWord(word: string, font: string, maxW: number): string[] {
  const out: string[] = [];
  let chunk = '';
  for (const ch of word) {
    if (chunk && measure(chunk + ch, font) > maxW) {
      out.push(chunk);
      chunk = ch;
    } else chunk += ch;
  }
  if (chunk) out.push(chunk);
  return out;
}

/** Retour à la ligne aux espaces (mots trop longs coupés) */
export function wrapLines(text: string, font: string, maxW: number, wrap: boolean): TextLine[] {
  const out: TextLine[] = [];
  for (const para of text.split('\n')) {
    if (!wrap || maxW <= 0) {
      out.push({ text: para, width: measure(para, font), last: true });
      continue;
    }
    const words = para.split(/\s+/).filter((w, i, a) => w !== '' || (a.length === 1 && i === 0));
    let line = '';
    const start = out.length;
    for (const w of words) {
      const cand = line ? line + ' ' + w : w;
      if (measure(cand, font) <= maxW) {
        line = cand;
        continue;
      }
      if (line) out.push({ text: line, width: measure(line, font), last: false });
      if (measure(w, font) > maxW) {
        const parts = breakWord(w, font, maxW);
        parts.slice(0, -1).forEach((p) => out.push({ text: p, width: measure(p, font), last: false }));
        line = parts[parts.length - 1] ?? '';
      } else line = w;
    }
    out.push({ text: line, width: measure(line, font), last: true });
    if (out.length === start) out.push({ text: '', width: 0, last: true });
  }
  return out;
}

const ELL = '…';
/** Tronque une ligne pour qu'elle tienne avec « … » */
export function ellipsize(line: string, font: string, maxW: number): string {
  if (measure(line, font) <= maxW) return line;
  let lo = 0,
    hi = line.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(line.slice(0, mid).trimEnd() + ELL, font) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? line.slice(0, lo).trimEnd() + ELL : ELL;
}

function cut(lines: TextLine[], max: number, font: string, maxW: number, ellipsis: boolean): { lines: TextLine[]; truncated: boolean } {
  if (lines.length <= max) return { lines, truncated: false };
  const kept = lines.slice(0, Math.max(1, max)).map((l) => ({ ...l }));
  const last = kept[kept.length - 1];
  last.last = true;
  if (ellipsis) {
    last.text = ellipsize(last.text + ELL, font, maxW);
    last.width = measure(last.text, font);
  }
  return { lines: kept, truncated: true };
}

/**
 * Mise en page d'un texte dans sa boîte.
 * - shrinkLine : jamais de retour automatique ; police réduite jusqu'à tenir en largeur
 *   et en hauteur (≥ minFontSize), puis « … » si demandé.
 * - wrapShrink : retour à la ligne ; police réduite si la hauteur (ou maxLines) déborde.
 * - wrapGrow : retour à la ligne à la taille choisie ; la hauteur suit (maxLines optionnel).
 * - none : retour à la ligne à la taille choisie ; boîte fixe, débordement rogné.
 */
export function layoutText(el: TextEl, text: string, allergensExtra?: string[]): TextLayout {
  if (el.boldAllergens && !el.bold && !isCurved(el)) {
    const mask = allergenMask(text, allergensExtra);
    if (mask) return layoutRich(el, text, mask);
  }
  const base = Math.max(1, el.fontSize);
  const lhK = el.lineHeight || 1.1;
  const minFs = Math.min(base, Math.max(2, el.minFontSize ?? Math.max(4, base * 0.3)));
  const maxLines = el.maxLines && el.maxLines > 0 ? Math.floor(el.maxLines) : Infinity;
  const mode = fitMode(el);

  if (isCurved(el)) {
    const font = fontString(el, base);
    const t = text.replace(/\n/g, ' ');
    return { lines: [{ text: t, width: measure(t, font), last: true }], fontSize: base, lh: base * lhK, h: el.h, pad: 0, textH: base * lhK, truncated: false };
  }

  const build = (fs: number, wrap: boolean) => {
    const pad = textPad(el, fs);
    const font = fontString(el, fs);
    const innerW = Math.max(1, el.w - pad * 2);
    const lines = wrapLines(text, font, innerW, wrap);
    return { fs, pad, font, innerW, lines, lh: fs * lhK, textH: lines.length * fs * lhK + pad * 2 };
  };

  const finish = (b: ReturnType<typeof build>, boxH: number, extraTrunc = false): TextLayout => ({
    lines: b.lines,
    fontSize: b.fs,
    lh: b.lh,
    h: boxH,
    pad: b.pad,
    textH: b.lines.length * b.lh + b.pad * 2,
    truncated: extraTrunc,
  });

  if (mode === 'wrapGrow') {
    const b = build(base, true);
    const c = cut(b.lines, maxLines, b.font, b.innerW, !!el.ellipsis);
    b.lines = c.lines;
    const h = Math.max(b.lh, b.lines.length * b.lh) + b.pad * 2;
    return finish(b, h, c.truncated);
  }

  if (mode === 'none') {
    const b = build(base, true);
    const fitByH = Math.max(1, Math.floor((el.h - b.pad * 2 + 0.01) / b.lh));
    const c = cut(b.lines, Math.min(maxLines, fitByH), b.font, b.innerW, !!el.ellipsis);
    b.lines = c.lines;
    return finish(b, el.h, c.truncated);
  }

  const wrap = mode === 'wrapShrink';
  const fits = (b: ReturnType<typeof build>) =>
    b.textH <= el.h + 0.5 && b.lines.length <= maxLines && (wrap ? true : b.lines.every((l) => l.width <= b.innerW + 0.5));

  let b = build(base, wrap);
  if (!fits(b)) {
    // recherche dichotomique de la plus grande taille qui tient
    let lo = minFs,
      hi = base;
    let best = build(minFs, wrap);
    if (fits(best)) {
      for (let i = 0; i < 14 && hi - lo > 0.05; i++) {
        const mid = (lo + hi) / 2;
        const m = build(mid, wrap);
        if (fits(m)) {
          lo = mid;
          best = m;
        } else hi = mid;
      }
      b = best;
    } else {
      // même au minimum ça déborde : on garde le minimum et on tronque
      b = best;
      let truncated = false;
      if (!wrap) {
        if (el.ellipsis)
          b.lines = b.lines.map((l) => {
            if (l.width <= b.innerW) return l;
            truncated = true;
            const tx = ellipsize(l.text, b.font, b.innerW);
            return { text: tx, width: measure(tx, b.font), last: true };
          });
        else truncated = b.lines.some((l) => l.width > b.innerW);
      }
      const fitByH = Math.max(1, Math.floor((el.h - b.pad * 2 + 0.01) / b.lh));
      const c = cut(b.lines, Math.min(maxLines, fitByH), b.font, b.innerW, !!el.ellipsis);
      b.lines = c.lines;
      return finish(b, el.h, truncated || c.truncated);
    }
  }
  return finish(b, el.h);
}

/** Décalage vertical du bloc de texte dans la boîte */
export function textOffsetY(el: TextEl, L: TextLayout) {
  if (!hasFixedHeight(el)) return 0;
  const free = L.h - L.textH;
  return el.vAlign === 'top' ? 0 : el.vAlign === 'bottom' ? free : free / 2;
}

/** Positions x de chaque mot d'une ligne justifiée (sinon null) */
export function justifyWords(line: TextLine, font: string, innerW: number): { word: string; x: number }[] | null {
  if (line.last) return null;
  const words = line.text.split(' ').filter(Boolean);
  if (words.length < 2) return null;
  const widths = words.map((w) => measure(w, font));
  const gap = (innerW - widths.reduce((a, b) => a + b, 0)) / (words.length - 1);
  let x = 0;
  return words.map((w, i) => {
    const r = { word: w, x };
    x += widths[i] + gap;
    return r;
  });
}

// ---------------------------------------------------------------------------
// Texte enrichi (allergènes en gras) : mêmes règles d'ajustement que layoutText,
// mais chaque caractère porte un attribut gras ; les largeurs sont mesurées segment
// par segment (police normale / grasse) pour couper, réduire et tronquer juste.
// ---------------------------------------------------------------------------

interface RStr {
  t: string;
  b: boolean[];
}
interface RFonts {
  reg: string;
  bold: string;
}

const rslice = (r: RStr, a: number, z = r.t.length): RStr => ({ t: r.t.slice(a, z), b: r.b.slice(a, z) });
const rcat = (...xs: RStr[]): RStr => ({ t: xs.map((x) => x.t).join(''), b: ([] as boolean[]).concat(...xs.map((x) => x.b)) });
const rplain = (t: string, bold = false): RStr => ({ t, b: new Array(t.length).fill(bold) });

export function runsOf(r: { t: string; b: boolean[] }): TextRun[] {
  const out: TextRun[] = [];
  for (let i = 0; i < r.t.length; i++) {
    const last = out[out.length - 1];
    if (last && last.bold === !!r.b[i]) last.text += r.t[i];
    else out.push({ text: r.t[i], bold: !!r.b[i] });
  }
  return out;
}

export function measureRuns(runs: TextRun[], f: RFonts) {
  let w = 0;
  for (const x of runs) w += measure(x.text, x.bold ? f.bold : f.reg);
  return w;
}
const rmeasure = (r: RStr, f: RFonts) => measureRuns(runsOf(r), f);

/** espace entre deux mots : gras si les deux mots qui l'entourent le sont */
const space = (a: RStr, b: RStr) => rplain(' ', !!a.b[a.b.length - 1] && !!b.b[0]);

interface RLine {
  r: RStr;
  last: boolean;
}

function rbreakWord(w: RStr, f: RFonts, maxW: number): RStr[] {
  const out: RStr[] = [];
  let start = 0;
  let i = 0;
  while (i < w.t.length) {
    const cl = w.t.codePointAt(i)! > 0xffff ? 2 : 1;
    if (i > start && rmeasure(rslice(w, start, i + cl), f) > maxW) {
      out.push(rslice(w, start, i));
      start = i;
    }
    i += cl;
  }
  if (start < w.t.length) out.push(rslice(w, start));
  return out;
}

function rwrap(r: RStr, f: RFonts, maxW: number, wrap: boolean): RLine[] {
  const out: RLine[] = [];
  const paras: RStr[] = [];
  let p0 = 0;
  for (let i = 0; i <= r.t.length; i++)
    if (i === r.t.length || r.t[i] === '\n') {
      paras.push(rslice(r, p0, i));
      p0 = i + 1;
    }
  for (const para of paras) {
    if (!wrap || maxW <= 0) {
      out.push({ r: para, last: true });
      continue;
    }
    const words = Array.from(para.t.matchAll(/\S+/g), (m) => rslice(para, m.index!, m.index! + m[0].length));
    let line: RStr | null = null;
    const start = out.length;
    for (const w of words) {
      const cand: RStr = line ? rcat(line, space(line, w), w) : w;
      if (rmeasure(cand, f) <= maxW) {
        line = cand;
        continue;
      }
      if (line) out.push({ r: line, last: false });
      if (rmeasure(w, f) > maxW) {
        const parts = rbreakWord(w, f, maxW);
        parts.slice(0, -1).forEach((p) => out.push({ r: p, last: false }));
        line = parts[parts.length - 1] ?? rplain('');
      } else line = w;
    }
    out.push({ r: line ?? rplain(''), last: true });
    if (out.length === start) out.push({ r: rplain(''), last: true });
  }
  return out;
}

function rellipsize(r: RStr, f: RFonts, maxW: number): RStr {
  if (rmeasure(r, f) <= maxW) return r;
  const ell = (x: RStr) => rcat(x, rplain(ELL, !!x.b[x.b.length - 1]));
  const trimEnd = (x: RStr) => {
    let z = x.t.length;
    while (z > 0 && /\s/.test(x.t[z - 1])) z--;
    return rslice(x, 0, z);
  };
  let lo = 0,
    hi = r.t.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (rmeasure(ell(trimEnd(rslice(r, 0, mid))), f) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? ell(trimEnd(rslice(r, 0, lo))) : rplain(ELL);
}

function layoutRich(el: TextEl, text: string, mask: boolean[]): TextLayout {
  const src: RStr = { t: text, b: mask };
  const base = Math.max(1, el.fontSize);
  const lhK = el.lineHeight || 1.1;
  const minFs = Math.min(base, Math.max(2, el.minFontSize ?? Math.max(4, base * 0.3)));
  const maxLines = el.maxLines && el.maxLines > 0 ? Math.floor(el.maxLines) : Infinity;
  const mode = fitMode(el);
  const fonts = (fs: number): RFonts => ({ reg: fontString(el, fs), bold: fontString({ ...el, bold: true }, fs) });
  const toLine = (l: RLine, f: RFonts): TextLine => {
    const runs = runsOf(l.r);
    return { text: l.r.t, width: measureRuns(runs, f), last: l.last, runs };
  };

  type B = { fs: number; pad: number; f: RFonts; innerW: number; rl: RLine[]; lh: number; textH: number };
  const build = (fs: number, wrap: boolean): B => {
    const pad = textPad(el, fs);
    const f = fonts(fs);
    const innerW = Math.max(1, el.w - pad * 2);
    const rl = rwrap(src, f, innerW, wrap);
    return { fs, pad, f, innerW, rl, lh: fs * lhK, textH: rl.length * fs * lhK + pad * 2 };
  };
  const rcut = (b: B, max: number, ellipsis: boolean) => {
    if (b.rl.length <= max) return false;
    const kept = b.rl.slice(0, Math.max(1, max)).map((l) => ({ ...l }));
    const last = kept[kept.length - 1];
    last.last = true;
    if (ellipsis) last.r = rellipsize(rcat(last.r, rplain(ELL, !!last.r.b[last.r.b.length - 1])), b.f, b.innerW);
    b.rl = kept;
    return true;
  };
  const finish = (b: B, boxH: number, truncated = false): TextLayout => ({
    lines: b.rl.map((l) => toLine(l, b.f)),
    fontSize: b.fs,
    lh: b.lh,
    h: boxH,
    pad: b.pad,
    textH: b.rl.length * b.lh + b.pad * 2,
    truncated,
  });

  if (mode === 'wrapGrow') {
    const b = build(base, true);
    const tr = rcut(b, maxLines, !!el.ellipsis);
    const h = Math.max(b.lh, b.rl.length * b.lh) + b.pad * 2;
    return finish(b, h, tr);
  }
  if (mode === 'none') {
    const b = build(base, true);
    const fitByH = Math.max(1, Math.floor((el.h - b.pad * 2 + 0.01) / b.lh));
    const tr = rcut(b, Math.min(maxLines, fitByH), !!el.ellipsis);
    return finish(b, el.h, tr);
  }
  const wrap = mode === 'wrapShrink';
  const fits = (b: B) => b.textH <= el.h + 0.5 && b.rl.length <= maxLines && (wrap ? true : b.rl.every((l) => rmeasure(l.r, b.f) <= b.innerW + 0.5));
  let b = build(base, wrap);
  if (!fits(b)) {
    let lo = minFs,
      hi = base;
    let best = build(minFs, wrap);
    if (fits(best)) {
      for (let i = 0; i < 14 && hi - lo > 0.05; i++) {
        const mid = (lo + hi) / 2;
        const m = build(mid, wrap);
        if (fits(m)) {
          lo = mid;
          best = m;
        } else hi = mid;
      }
      b = best;
    } else {
      b = best;
      let truncated = false;
      if (!wrap) {
        if (el.ellipsis)
          b.rl = b.rl.map((l) => {
            if (rmeasure(l.r, b.f) <= b.innerW) return l;
            truncated = true;
            return { r: rellipsize(l.r, b.f, b.innerW), last: true };
          });
        else truncated = b.rl.some((l) => rmeasure(l.r, b.f) > b.innerW);
      }
      const fitByH = Math.max(1, Math.floor((el.h - b.pad * 2 + 0.01) / b.lh));
      const tr = rcut(b, Math.min(maxLines, fitByH), !!el.ellipsis);
      return finish(b, el.h, truncated || tr);
    }
  }
  return finish(b, el.h);
}

/** La mise en page contient-elle des segments gras (texte enrichi) ? */
export const hasRichRuns = (L: TextLayout) => L.lines.some((l) => l.runs?.some((r) => r.bold));

/**
 * Segments positionnés d'une ligne (x relatif au bord gauche de la zone de texte,
 * padding exclu) : alignement gauche / centre / droite / justifié.
 */
export function richSegments(el: TextEl, line: TextLine, fs: number, innerW: number): { text: string; bold: boolean; x: number }[] {
  const runs = line.runs ?? [{ text: line.text, bold: false }];
  const f: RFonts = { reg: fontString(el, fs), bold: fontString({ ...el, bold: true }, fs) };
  const out: { text: string; bold: boolean; x: number }[] = [];
  if (el.align === 'justify' && !line.last) {
    const words: TextRun[][] = [[]];
    for (const r of runs) {
      r.text.split(' ').forEach((p, i) => {
        if (i > 0) words.push([]);
        if (p) words[words.length - 1].push({ text: p, bold: r.bold });
      });
    }
    const ws = words.filter((w) => w.length);
    if (ws.length >= 2) {
      const widths = ws.map((w) => measureRuns(w, f));
      const gap = (innerW - widths.reduce((a, b) => a + b, 0)) / (ws.length - 1);
      let x = 0;
      ws.forEach((w, i) => {
        let xx = x;
        for (const r of w) {
          out.push({ ...r, x: xx });
          xx += measure(r.text, r.bold ? f.bold : f.reg);
        }
        x += widths[i] + gap;
      });
      return out;
    }
  }
  const total = measureRuns(runs, f);
  let x = el.align === 'center' ? (innerW - total) / 2 : el.align === 'right' ? innerW - total : 0;
  for (const r of runs) {
    out.push({ ...r, x });
    x += measure(r.text, r.bold ? f.bold : f.reg);
  }
  return out;
}
