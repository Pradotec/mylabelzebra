import type { LabelDoc, LabelElement } from '../types';
import { qrPayload } from './codes';

export interface ResolveCtx {
  /** index de l'étiquette dans le lot (0 = première) */
  index: number;
  row?: Record<string, string>;
  doc: LabelDoc;
  /** si false, les {{champs}} sont affichés tels quels */
  resolve: boolean;
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const pad = (n: number, l = 2) => String(n).padStart(l, '0');

export function formatDate(d: Date, format: string): string {
  return format.replace(/YYYY|YY|MMMM|MMM|MM|DD|HH|mm|ss/g, (t) => {
    switch (t) {
      case 'YYYY': return String(d.getFullYear());
      case 'YY': return pad(d.getFullYear() % 100);
      case 'MMMM': return MONTHS_LONG[d.getMonth()];
      case 'MMM': return MONTHS[d.getMonth()];
      case 'MM': return pad(d.getMonth() + 1);
      case 'DD': return pad(d.getDate());
      case 'HH': return pad(d.getHours());
      case 'mm': return pad(d.getMinutes());
      case 'ss': return pad(d.getSeconds());
    }
    return t;
  });
}

/** extraDays défini : aujourd'hui + extraDays (ignore le décalage du document) */
export function dateValue(doc: LabelDoc, extraDays?: number): string {
  const d = new Date();
  d.setDate(d.getDate() + (extraDays ?? (doc.date.offsetDays || 0)));
  return formatDate(d, doc.date.format || 'DD/MM/YYYY');
}

export function serialValue(doc: LabelDoc, index: number): string {
  const n = doc.numbering;
  const v = (Number(n.start) || 0) + index * (Number(n.step) || 1);
  const neg = v < 0;
  const s = String(Math.abs(v)).padStart(Math.max(0, Number(n.padding) || 0), '0');
  return `${n.prefix || ''}${neg ? '-' : ''}${s}${n.suffix || ''}`;
}

const TOKEN = /\{\{\s*([^}]+?)\s*\}\}/g;

export function resolveText(text: string, ctx: ResolveCtx): string {
  if (!ctx.resolve || !text || text.indexOf('{{') < 0) return text;
  return text.replace(TOKEN, (whole, rawKey: string) => {
    const key = rawKey.trim();
    const lower = key.toLowerCase();
    if (lower === 'numero' || lower === 'numéro' || lower === '#' || lower === 'serial') {
      return serialValue(ctx.doc, ctx.index);
    }
    const dm = /^date\s*([+-]\s*\d+)?$/i.exec(key);
    if (dm) return dateValue(ctx.doc, dm[1] ? parseInt(dm[1].replace(/\s/g, ''), 10) : undefined);
    if (ctx.row) {
      if (key in ctx.row) return ctx.row[key] ?? '';
      const found = Object.keys(ctx.row).find((k) => k.trim().toLowerCase() === lower);
      if (found) return ctx.row[found] ?? '';
      return '';
    }
    return whole;
  });
}

export function usesData(el: LabelElement): boolean {
  const s = textOf(el);
  return /\{\{/.test(s);
}

export function textOf(el: LabelElement): string {
  switch (el.type) {
    case 'text': return el.text;
    case 'barcode': return el.value;
    case 'qr': return qrPayload(el);
    case 'table': return el.cells.flat().join('\n');
    default: return '';
  }
}

export function docUsesSerial(doc: LabelDoc): boolean {
  return doc.elements.some((e) => /\{\{\s*(numero|numéro|#|serial)\s*\}\}/i.test(textOf(e)));
}

export interface PrintJob {
  index: number;
  copies: number;
}

/**
 * Étiquettes à produire : lignes cochées (sinon la ligne affichée),
 * sinon la série numérotée (max 500), sinon l'étiquette seule.
 */
export function batchJobs(doc: LabelDoc, currentRow = 0): PrintJob[] {
  const d = doc.data;
  if (d && d.rows.length) {
    const idx = d.rows.map((_, i) => i).filter((i) => d.checked[i]);
    const list = idx.length ? idx : [Math.min(currentRow, d.rows.length - 1)];
    return list.map((i) => ({ index: i, copies: Math.max(1, Number(d.copies[i]) || 1) }));
  }
  if (docUsesSerial(doc)) {
    const n = Math.min(500, Math.max(1, Number(doc.numbering.count) || 1));
    return Array.from({ length: n }, (_, i) => ({ index: i, copies: Math.max(1, doc.copies || 1) }));
  }
  return [{ index: 0, copies: Math.max(1, doc.copies || 1) }];
}

export function batchCount(doc: LabelDoc, currentRow = 0): number {
  return batchJobs(doc, currentRow).length;
}

export function ctxFor(doc: LabelDoc, index: number): ResolveCtx {
  return { doc, index, row: doc.data?.rows[index], resolve: true };
}
