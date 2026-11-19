/**
 * Mise en page du texte — fonction unique partagée par l'éditeur, les exports
 * (PNG/JPG/SVG/PDF, impression) et le générateur ZPL.
 * Entrée : texte résolu (valeurs de la ligne de données incluses), boîte, police, mode.
 * Sortie : lignes + taille de police effective + hauteur de boîte.
 */
import type { TextEl, TextFit } from '../types';

export interface TextLine {
  text: string;
  width: number;
  /** dernière ligne d'un paragraphe (non justifiée) */
  last: boolean;
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
export function layoutText(el: TextEl, text: string): TextLayout {
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
