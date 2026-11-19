/**
 * Interpréteur ZPL local (sous-ensemble courant) pour la visionneuse :
 * ^XA ^XZ ^FO ^FT ^FS ^FD ^FH ^FB ^FR ^LR ^A ^CF ^LH ^PW ^LL ^BY ^BC ^BE ^B8 ^BU ^B9 ^B3 ^BA ^B2 ^BK
 * ^BQ ^BX ^GB ^GE ^GC ^GF(A, Z64) ^FX ^CI ^PQ (ignoré).
 */
import type { LabelElement, Symbology, QrLevel } from '../types';
import { encodeBarcode, encodeQr, encodeCode128Codewords } from '../render/codes';
import { zplToCodewords, codewordsToGs1, codewordsText } from './code128';
import { decodeGfaHex, decodeZ64, bitmapToCanvas, type Bitmap } from './gfa';
import { uid } from '../util';

/** Orientation ZPL : Normal, Rotation 90° horaire, Inversé 180°, Bas (270°) */
export type Orient = 'N' | 'R' | 'I' | 'B';
/** ft = origine ^FT (ligne de base / bas du champ) au lieu de ^FO (coin haut-gauche) */
type Placed = { x: number; y: number; o: Orient; ft: boolean };

export type ZOp =
  | ({ k: 'text'; h: number; w: number; f: string; text: string; block?: { w: number; lines: number; spacing: number; just: string }; reverse: boolean } & Placed)
  | { k: 'box'; x: number; y: number; w: number; h: number; t: number; color: 'B' | 'W'; r: number; reverse: boolean }
  | { k: 'ellipse'; x: number; y: number; w: number; h: number; t: number; color: 'B' | 'W'; reverse: boolean }
  | ({ k: 'barcode'; sym: Symbology; data: string; module: number; height: number; hr: boolean; reverse: boolean; raw?: number[] } & Placed)
  | ({ k: 'qr'; mag: number; data: string; level: QrLevel; reverse: boolean } & Placed)
  | { k: 'image'; x: number; y: number; bitmap: Bitmap; reverse: boolean };

const ORIENT = (s: string | undefined, d: Orient): Orient => {
  const c = (s || '').trim().toUpperCase()[0];
  return c === 'N' || c === 'R' || c === 'I' || c === 'B' ? c : d;
};

/**
 * Polices bitmap Zebra (A–H) : cellule de base hauteur × avance (espace inclus).
 * La police 0 (CG Triumvirate Bold Condensed) est vectorielle.
 */
const BITMAP_FONTS: Record<string, [number, number]> = {
  A: [9, 6],
  B: [11, 9],
  C: [18, 12],
  D: [18, 12],
  E: [28, 20],
  F: [26, 16],
  G: [60, 48],
  H: [21, 19],
};

export interface ZLabel {
  width?: number;
  height?: number;
  ops: ZOp[];
  warnings: string[];
}

function decodeFH(s: string, ind: string): string {
  const bytes: number[] = [];
  const enc = new TextEncoder();
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ind && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) {
      bytes.push(parseInt(s.substr(i + 1, 2), 16));
      i += 2;
    } else bytes.push(...enc.encode(s[i]));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

const SYM: Record<string, Symbology> = {
  BC: 'code128',
  BE: 'ean13',
  B8: 'ean8',
  BU: 'upca',
  B9: 'upce',
  B3: 'code39',
  BA: 'code93',
  B2: 'interleaved2of5',
  BK: 'rationalizedCodabar',
  BX: 'datamatrix',
};

export async function parseZpl(code: string): Promise<ZLabel[]> {
  const labels: ZLabel[] = [];
  let cur: ZLabel | null = null;
  // état global
  let lhX = 0,
    lhY = 0;
  let cf = { f: 'A', h: 9, w: 5 };
  let by = { m: 2, ratio: 3, h: 10 };
  let lr = false;
  let fw: Orient = 'N';
  // état de champ
  let fx = 0,
    fy = 0,
    ft = false;
  let font: { f: string; h: number; w: number; o: Orient } | null = null;
  let fb: { w: number; lines: number; spacing: number; just: string } | undefined;
  let fr = false;
  let fh: string | null = null;
  let bc: { sym: Symbology; h: number; hr: boolean; o: Orient; mode?: string; mag?: number; level?: QrLevel; isQr?: boolean } | null = null;
  let data: string | null = null;

  const resetField = () => {
    font = null;
    fb = undefined;
    fr = false;
    fh = null;
    bc = null;
    data = null;
    ft = false;
  };
  const L = () => {
    if (!cur) {
      cur = { ops: [], warnings: [] };
      labels.push(cur);
    }
    return cur;
  };
  const unknown = new Set<string>();

  // découpe en commandes
  const re = /[\^~]/g;
  const idx: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) idx.push(m.index);
  for (let n = 0; n < idx.length; n++) {
    const start = idx[n];
    let end = n + 1 < idx.length ? idx[n + 1] : code.length;
    let name = code.substr(start + 1, 2).toUpperCase();
    // ^FD : les données vont jusqu'au prochain ^FS (pas de ^ dans les données)
    if (name === 'FD' || name === 'FV') {
      const fs = code.toUpperCase().indexOf('^FS', start + 3);
      end = fs >= 0 ? fs : code.length;
      while (n + 1 < idx.length && idx[n + 1] < end) n++;
    }
    if (name === 'FX') continue;
    let params: string;
    if (name[0] === 'A' && name !== 'A@') {
      // ^A{police}{orientation},h,w
      params = code.slice(start + 3, end);
      const f = name[1];
      const o = ORIENT(/^[NRIBnrib]/.test(params) ? params[0] : '', fw);
      const parts = params.replace(/^[NRIBnrib]?,?/, '').split(',');
      const h = parseInt(parts[0], 10);
      const w = parseInt(parts[1], 10);
      const bmp = BITMAP_FONTS[f];
      if (bmp) {
        // police bitmap : tailles arrondies à un multiple de la matrice de base
        const mh = Math.max(1, Math.round((h || bmp[0]) / bmp[0]));
        const mw = Math.max(1, Math.round((w || (h ? (h / bmp[0]) * bmp[1] : bmp[1])) / bmp[1]));
        font = { f, h: bmp[0] * mh, w: bmp[1] * mw, o };
      } else font = { f, h: h || cf.h, w: w || h || cf.w, o };
      continue;
    }
    params = code.slice(start + 3, end);
    const P = params.split(',');
    const num = (i: number, d: number) => {
      const v = parseFloat(P[i]);
      return Number.isFinite(v) ? v : d;
    };
    switch (name) {
      case 'XA':
        cur = { ops: [], warnings: [] };
        labels.push(cur);
        resetField();
        break;
      case 'XZ':
        cur = null;
        break;
      case 'LH':
        lhX = num(0, 0);
        lhY = num(1, 0);
        break;
      case 'PW':
        L().width = num(0, 0) || undefined;
        break;
      case 'LL':
        L().height = num(0, 0) || undefined;
        break;
      case 'LR':
        lr = (P[0] || 'N').trim().toUpperCase() === 'Y';
        break;
      case 'CF': {
        const f = (P[0] || cf.f).trim().toUpperCase()[0] || cf.f;
        const bmp = BITMAP_FONTS[f];
        if (bmp) {
          // police bitmap : même arrondi au multiple de la matrice de base que ^A
          const rh = num(1, NaN);
          const rw = num(2, NaN);
          const mh = Math.max(1, Math.round((Number.isFinite(rh) ? rh : bmp[0]) / bmp[0]));
          const mw = Math.max(1, Math.round((Number.isFinite(rw) ? rw : Number.isFinite(rh) ? (rh / bmp[0]) * bmp[1] : bmp[1]) / bmp[1]));
          cf = { f, h: bmp[0] * mh, w: bmp[1] * mw };
        } else {
          const h = num(1, cf.h);
          const w = num(2, h);
          cf = { f, h, w };
        }
        break;
      }
      case 'FW':
        fw = ORIENT(P[0], fw);
        break;
      case 'FO':
      case 'FT':
        fx = num(0, 0) + lhX;
        fy = num(1, 0) + lhY;
        ft = name === 'FT';
        break;
      case 'FB':
        fb = { w: num(0, 0), lines: num(1, 1), spacing: num(2, 0), just: (P[3] || 'L').trim().toUpperCase() };
        break;
      case 'FR':
        fr = true;
        break;
      case 'FH':
        fh = (P[0] || '_').trim()[0] || '_';
        break;
      case 'BY':
        by = { m: num(0, by.m), ratio: num(1, by.ratio), h: num(2, by.h) };
        break;
      case 'BC':
        bc = { sym: (P[5] || '').trim().toUpperCase() === 'D' ? 'gs1-128' : 'code128', o: ORIENT(P[0], fw), h: num(1, by.h), hr: (P[2] || 'Y').trim().toUpperCase() !== 'N' };
        break;
      case 'BE':
      case 'B8':
      case 'BU':
      case 'B9':
      case 'BA':
      case 'B2':
        bc = { sym: SYM[name], o: ORIENT(P[0], fw), h: num(1, by.h), hr: (P[2] || 'Y').trim().toUpperCase() !== 'N' };
        break;
      case 'B3':
      case 'BK':
        bc = { sym: SYM[name], o: ORIENT(P[0], fw), h: num(2, by.h), hr: (P[3] || 'Y').trim().toUpperCase() !== 'N' };
        break;
      case 'BX':
        bc = { sym: 'datamatrix', o: ORIENT(P[0], fw), h: 0, hr: false, mag: num(1, 4) };
        break;
      case 'BQ':
        // ^BQ n'accepte que l'orientation normale
        bc = { sym: 'code128', o: 'N', h: 0, hr: false, isQr: true, mag: num(2, 2) };
        break;
      case 'FD':
      case 'FV':
        data = params;
        break;
      case 'GB': {
        const t = num(2, 1);
        const w = Math.max(num(0, t), t);
        const h = Math.max(num(1, t), t);
        L().ops.push({ k: 'box', x: fx, y: fy, w, h, t, color: (P[3] || 'B').trim().toUpperCase() === 'W' ? 'W' : 'B', r: num(4, 0), reverse: fr || lr });
        break;
      }
      case 'GE':
      case 'GC': {
        const isC = name === 'GC';
        const w = num(0, 3);
        const h = isC ? w : num(1, 3);
        const t = num(isC ? 1 : 2, 1);
        const c = (P[isC ? 2 : 3] || 'B').trim().toUpperCase() === 'W' ? 'W' : 'B';
        L().ops.push({ k: 'ellipse', x: fx, y: fy, w, h, t, color: c, reverse: fr || lr });
        break;
      }
      case 'GF': {
        const fmt = (P[0] || 'A').trim().toUpperCase();
        const total = num(2, num(1, 0));
        const bpr = num(3, 1);
        const raw = P.slice(4).join(',');
        try {
          let bmp: Bitmap;
          const z = /^:?(Z64|B64):([^:]+)/.exec(raw.trim());
          if (z) {
            if (z[1] === 'B64') {
              const bytes = Uint8Array.from(atob(z[2]), (ch) => ch.charCodeAt(0));
              const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
              bmp = decodeGfaHex(hex, bpr, total);
            } else bmp = await decodeZ64(z[2], bpr, total);
          } else if (fmt === 'A') bmp = decodeGfaHex(raw, bpr, total);
          else {
            L().warnings.push('^GF format ' + fmt + ' non géré');
            break;
          }
          // ^FT : l'origine d'un graphique est son coin bas-gauche
          L().ops.push({ k: 'image', x: fx, y: ft ? fy - bmp.height : fy, bitmap: bmp, reverse: fr || lr });
        } catch {
          L().warnings.push('^GF illisible');
        }
        break;
      }
      case 'FS': {
        if (data !== null) {
          const text = fh ? decodeFH(data, fh) : data;
          if (bc) {
            if (bc.isQr) {
              const lv = (text[0] || 'M').toUpperCase();
              const level: QrLevel = (['L', 'M', 'Q', 'H'].includes(lv) ? lv : 'M') as QrLevel;
              const comma = text.indexOf(',');
              const payload = comma >= 0 && comma <= 3 ? text.slice(comma + 1) : text;
              L().ops.push({ k: 'qr', x: fx, y: fy, o: 'N', ft, mag: bc.mag || 2, data: payload, level, reverse: fr || lr });
            } else if (bc.sym === 'datamatrix') {
              L().ops.push({ k: 'barcode', x: fx, y: fy, o: bc.o, ft, sym: 'datamatrix', data: text, module: bc.mag || 4, height: 0, hr: false, reverse: fr || lr });
            } else {
              let d = text;
              let sym = bc.sym;
              let raw: number[] | undefined;
              // ^BC mode N avec codes d'invocation (>; >8 …) : mots de code exacts ; un FNC1
              // en tête = GS1-128, reconstruit en « (AI)valeur » quand la structure est reconnue
              const cw = bc.sym === 'code128' ? zplToCodewords(d) : null;
              if (cw) {
                const gs1 = codewordsToGs1(cw);
                if (gs1 && encodeBarcode(gs1, 'gs1-128').error === undefined) {
                  sym = 'gs1-128';
                  d = gs1;
                } else {
                  raw = cw;
                  d = codewordsText(cw);
                }
              } else if (bc.sym === 'code128') d = d.replace(/>[0-9:;<=>]/g, '');
              const h = bc.h || by.h;
              L().ops.push({ k: 'barcode', x: fx, y: fy, o: bc.o, ft, sym, data: d, module: by.m, height: h, hr: bc.hr, reverse: fr || lr, raw });
            }
          } else {
            const f = font || { ...cf, o: fw };
            L().ops.push({ k: 'text', x: fx, y: fy, o: f.o, ft, f: f.f, h: f.h, w: f.w, text, block: fb, reverse: fr || lr });
          }
        }
        resetField();
        break;
      }
      case 'CI':
      case 'PQ':
      case 'MM':
      case 'PR':
      case 'MD':
      case 'PO':
      case 'MN':
      case 'MT':
      case 'LS':
      case 'LT':
      case 'JM':
      case 'PM':
      case 'MU':
        break;
      default:
        if (code[start] === '^' && /^[A-Z0-9@]{2}$/.test(name)) unknown.add('^' + name);
    }
  }
  if (unknown.size && labels.length) labels[0].warnings.push('Commandes ignorées : ' + Array.from(unknown).join(' '));
  return labels.filter((l) => l.ops.length || l.width);
}

const TEXT_SCALE = 0.86;
const isBitmapFont = (f: string) => !!BITMAP_FONTS[f];
/** Police 0 ≈ linéale grasse condensée ; polices A–H ≈ chasse fixe */
function zFont(h: number, f = '0') {
  return isBitmapFont(f) ? `${Math.max(1, h * 0.92)}px "DejaVu Sans Mono", Consolas, "Courier New", monospace` : `bold ${Math.max(1, h)}px Arial, Helvetica, sans-serif`;
}

type TextOp = Extract<ZOp, { k: 'text' }>;

/** Largeur d'une ligne de texte ZPL en points */
function textWidth(c: CanvasRenderingContext2D, op: TextOp, s: string) {
  if (isBitmapFont(op.f)) return Array.from(s).length * op.w;
  return c.measureText(s).width * (op.w / op.h) * TEXT_SCALE;
}

function wrap(c: CanvasRenderingContext2D, op: TextOp, maxW: number) {
  const out: string[] = [];
  for (const para of op.text.split(/\\&|\n/)) {
    let line = '';
    for (const word of para.split(' ')) {
      const cand = line ? line + ' ' + word : word;
      if (textWidth(c, op, cand) > maxW && line) {
        out.push(line);
        line = word;
      } else line = cand;
    }
    out.push(line);
  }
  return out;
}

function textLines(c: CanvasRenderingContext2D, op: TextOp) {
  c.font = zFont(op.h, op.f);
  return op.block ? wrap(c, op, op.block.w).slice(0, Math.max(1, op.block.lines)) : [op.text];
}

/** Taille du champ avant rotation (lw × lh) et décalage de la ligne de base (pour ^FT) */
function fieldBox(c: CanvasRenderingContext2D, op: Extract<ZOp, Placed>): { lw: number; lh: number; base: number } {
  switch (op.k) {
    case 'text': {
      const lines = textLines(c, op);
      const step = op.h + (op.block?.spacing || 0);
      const lw = op.block ? op.block.w : Math.max(1, ...lines.map((l) => textWidth(c, op, l)));
      // ^FT d'un bloc ^FB : origine = ligne de base de la DERNIÈRE ligne
      return { lw, lh: step * (lines.length - 1) + op.h, base: step * (lines.length - 1) + op.h * 0.78 };
    }
    case 'barcode': {
      const enc = op.raw ? encodeCode128Codewords(op.raw, op.data) : encodeBarcode(op.data, op.sym);
      if (enc.error !== undefined) return { lw: 300, lh: op.height || 40, base: op.height || 40 };
      if (enc.kind === 'matrix') return { lw: enc.cols * op.module, lh: enc.rows * op.module, base: enc.rows * op.module };
      const hr = op.hr ? hrSize(op.module) * 1.2 : 0;
      return { lw: enc.modules * op.module, lh: op.height + hr, base: op.height };
    }
    case 'qr': {
      const q = encodeQr(op.data, op.level);
      const s = q.error !== undefined ? 150 : q.cols * op.mag;
      return { lw: s, lh: s, base: s };
    }
  }
}

const hrSize = (module: number) => Math.max(12, Math.min(40, module * 5));
const ANGLE: Record<Orient, number> = { N: 0, R: 90, I: 180, B: 270 };

/**
 * Où se trouve l'origine locale (coin haut-gauche du champ non pivoté) et de combien
 * le champ est tourné. ^FO : l'origine donnée est le coin haut-gauche de la boîte
 * pivotée ; ^FT : c'est le début de la ligne de base (ou le bas des barres).
 */
export function fieldTransform(op: Placed, lw: number, lh: number, base: number) {
  const deg = ANGLE[op.o];
  if (op.ft) {
    const a = (deg * Math.PI) / 180;
    return { tx: op.x + base * Math.sin(a), ty: op.y - base * Math.cos(a), deg };
  }
  switch (op.o) {
    case 'R':
      return { tx: op.x + lh, ty: op.y, deg };
    case 'I':
      return { tx: op.x + lw, ty: op.y + lh, deg };
    case 'B':
      return { tx: op.x, ty: op.y + lw, deg };
    default:
      return { tx: op.x, ty: op.y, deg };
  }
}

function drawTextLocal(c: CanvasRenderingContext2D, op: TextOp, lw: number) {
  const lines = textLines(c, op);
  c.textBaseline = 'top';
  lines.forEach((ln, i) => {
    const tw = textWidth(c, op, ln);
    let x = 0;
    if (op.block) {
      if (op.block.just === 'C') x = (lw - tw) / 2;
      else if (op.block.just === 'R') x = lw - tw;
    }
    const y = i * (op.h + (op.block?.spacing || 0));
    if (isBitmapFont(op.f)) {
      // chasse fixe : un caractère par cellule, glyphe centré
      c.textAlign = 'center';
      Array.from(ln).forEach((ch, k) => {
        const gw = c.measureText(ch).width || 1;
        const sx = Math.min(1.4, (op.w * 0.86) / Math.max(gw, op.h * 0.5));
        c.save();
        c.translate(x + k * op.w + op.w / 2, y + op.h * 0.06);
        c.scale(sx, 1);
        c.fillText(ch, 0, 0);
        c.restore();
      });
    } else {
      c.save();
      c.translate(x, y + op.h * 0.08);
      c.scale((op.w / op.h) * TEXT_SCALE, 1);
      c.fillText(ln, 0, 0);
      c.restore();
    }
  });
}

/** Rend une étiquette ZPL interprétée dans un canvas (en points). */
export function renderZplLabel(label: ZLabel, W: number, H: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(W));
  cv.height = Math.max(1, Math.round(H));
  const c = cv.getContext('2d')!;
  c.fillStyle = '#fff';
  c.fillRect(0, 0, cv.width, cv.height);
  for (const op of label.ops) {
    c.save();
    const color = 'color' in op && op.color === 'W' ? '#fff' : '#000';
    if (op.reverse) {
      c.globalCompositeOperation = 'difference';
      c.fillStyle = '#fff';
    } else c.fillStyle = color;
    switch (op.k) {
      case 'box': {
        const { x, y, w, h, t } = op;
        const rad = (op.r / 8) * (Math.min(w, h) / 2);
        c.beginPath();
        rr(c, x, y, w, h, rad);
        if (t * 2 < Math.min(w, h)) rr(c, x + t, y + t, w - 2 * t, h - 2 * t, Math.max(0, rad - t));
        c.fill('evenodd');
        break;
      }
      case 'ellipse': {
        const { x, y, w, h, t } = op;
        c.beginPath();
        c.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        if (t * 2 < Math.min(w, h)) {
          c.moveTo(x + w - t, y + h / 2);
          c.ellipse(x + w / 2, y + h / 2, w / 2 - t, h / 2 - t, 0, 0, Math.PI * 2, true);
        }
        c.fill('evenodd');
        break;
      }
      case 'text':
      case 'barcode':
      case 'qr': {
        const { lw, lh, base } = fieldBox(c, op);
        const tf = fieldTransform(op, lw, lh, base);
        c.translate(tf.tx, tf.ty);
        if (tf.deg) c.rotate((tf.deg * Math.PI) / 180);
        if (op.k === 'text') {
          drawTextLocal(c, op, lw);
          break;
        }
        if (op.k === 'qr') {
          const q = encodeQr(op.data, op.level);
          if (q.error !== undefined) break;
          for (let r = 0; r < q.rows; r++) for (let k = 0; k < q.cols; k++) if (q.get(r, k)) c.fillRect(k * op.mag, r * op.mag, op.mag, op.mag);
          break;
        }
        const enc = op.raw ? encodeCode128Codewords(op.raw, op.data) : encodeBarcode(op.data, op.sym);
        if (enc.error !== undefined) {
          c.globalCompositeOperation = 'source-over';
          c.fillStyle = '#c53030';
          c.font = '14px Arial';
          c.fillText('⚠ ' + enc.error, 0, 14);
          break;
        }
        if (enc.kind === 'matrix') {
          for (let r = 0; r < enc.rows; r++) for (let k = 0; k < enc.cols; k++) if (enc.get(r, k)) c.fillRect(k * op.module, r * op.module, op.module, op.module);
          break;
        }
        let x = 0;
        enc.sbs.forEach((wd, i) => {
          if (i % 2 === 0) c.fillRect(x, 0, wd * op.module, op.height);
          x += wd * op.module;
        });
        if (op.hr) {
          c.font = `${hrSize(op.module)}px Arial`;
          c.textAlign = 'center';
          c.textBaseline = 'top';
          c.fillText(enc.text, x / 2, op.height + 2);
        }
        break;
      }
      case 'image': {
        const img = bitmapToCanvas(op.bitmap, op.reverse ? '#fff' : '#000');
        c.drawImage(img, op.x, op.y);
        break;
      }
    }
    c.restore();
  }
  return cv;
}

function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (r <= 0) {
    c.rect(x, y, w, h);
    return;
  }
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** Convertit une étiquette ZPL interprétée en éléments éditables (unités u). */
export function zplLabelToElements(label: ZLabel, ds: number): LabelElement[] {
  const U = (v: number) => v / ds;
  const els: LabelElement[] = [];
  const meas = document.createElement('canvas').getContext('2d')!;
  for (const op of label.ops) {
    let base = { id: uid(), x: U(op.x), y: U(op.y), rotation: 0 };
    let box = { lw: 0, lh: 0 };
    if (op.k === 'text' || op.k === 'barcode' || op.k === 'qr') {
      // l'éditeur pivote autour du coin haut-gauche local : même convention que fieldTransform
      const fb = fieldBox(meas, op);
      const tf = fieldTransform(op, fb.lw, fb.lh, fb.base);
      base = { ...base, x: U(tf.tx), y: U(tf.ty), rotation: tf.deg };
      box = fb;
    }
    switch (op.k) {
      case 'text': {
        const tw = op.block?.w || box.lw + op.h * 0.3;
        els.push({
          ...base,
          type: 'text',
          w: U(tw),
          h: U(box.lh),
          text: op.text.replace(/\\&/g, '\n'),
          fontFamily: isBitmapFont(op.f) ? 'Courier New' : 'Arial',
          fontSize: U(op.h),
          bold: !isBitmapFont(op.f),
          italic: false,
          align: op.block?.just === 'C' ? 'center' : op.block?.just === 'R' ? 'right' : 'left',
          lineHeight: 1.1,
          color: op.reverse ? '#ffffff' : '#000000',
          invert: false,
        });
        break;
      }
      case 'box': {
        const filled = op.t * 2 >= Math.min(op.w, op.h);
        const c = op.reverse || op.color === 'W' ? '#ffffff' : '#000000';
        // seule une boîte pleine vraiment fine (trait) devient une ligne
        const thin = filled && Math.min(op.w, op.h) <= Math.max(3, op.t) && Math.max(op.w, op.h) > 4 * Math.min(op.w, op.h);
        els.push({
          ...base,
          type: 'shape',
          kind: thin ? (op.w >= op.h ? 'line' : 'vline') : op.r > 0 ? 'roundrect' : 'rect',
          w: U(op.w),
          h: U(op.h),
          fill: filled ? c : 'none',
          stroke: filled ? 'none' : c,
          strokeWidth: U(op.t),
          radius: op.r > 0 ? U((op.r / 8) * (Math.min(op.w, op.h) / 2)) : 0,
        });
        break;
      }
      case 'ellipse': {
        const filled = op.t * 2 >= Math.min(op.w, op.h);
        const c = op.reverse || op.color === 'W' ? '#ffffff' : '#000000';
        els.push({ ...base, type: 'shape', kind: op.w === op.h ? 'circle' : 'ellipse', w: U(op.w), h: U(op.h), fill: filled ? c : 'none', stroke: filled ? 'none' : c, strokeWidth: U(op.t) });
        break;
      }
      case 'barcode': {
        const isM = op.sym === 'datamatrix';
        els.push({
          ...base,
          type: 'barcode',
          w: U(box.lw),
          h: U(box.lh),
          value: op.data,
          symbology: op.sym,
          showText: !isM && op.hr,
          fontSize: U(hrSize(op.module)),
          color: op.reverse ? '#ffffff' : '#000000',
        });
        break;
      }
      case 'qr': {
        els.push({ ...base, type: 'qr', qrType: 'text', w: U(box.lw), h: U(box.lh), value: op.data, level: op.level, color: op.reverse ? '#ffffff' : '#000000' });
        break;
      }
      case 'image': {
        const cv = bitmapToCanvas(op.bitmap);
        els.push({ ...base, type: 'image', w: U(op.bitmap.width), h: U(op.bitmap.height), src: cv.toDataURL('image/png'), threshold: 128, dither: false, keepRatio: false });
        break;
      }
    }
  }
  return els;
}
