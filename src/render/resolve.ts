import type { LabelDoc, LabelElement, ShowCondition } from '../types';
import { qrPayload, priceCheck4 } from './codes';
import { getLastPrompts } from '../prompts';

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

/**
 * Formate une date. Jetons : YYYY / AAAA, YY / AA, MMMM, MMM, MM, DD / JJ, HH, mm, ss.
 */
export function formatDate(d: Date, format: string): string {
  const f = format.replace(/AAAA/g, 'YYYY').replace(/AA/g, 'YY').replace(/JJ/g, 'DD');
  return f.replace(/YYYY|YY|MMMM|MMM|MM|DD|HH|mm|ss/g, (t) => {
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

/** « Maintenant » d'un document : date figée d'un travail (réimpression) ou date courante */
export function docNow(doc: LabelDoc): Date {
  return doc.jobDate ? new Date(doc.jobDate) : new Date();
}

function dateObj(doc: LabelDoc, extraDays?: number): Date {
  const d = docNow(doc);
  d.setDate(d.getDate() + (extraDays ?? (doc.date.offsetDays || 0)));
  return d;
}

/** extraDays défini : aujourd'hui + extraDays (ignore le décalage du document) */
export function dateValue(doc: LabelDoc, extraDays?: number): string {
  return formatDate(dateObj(doc, extraDays), doc.date.format || 'DD/MM/YYYY');
}

export function serialValue(doc: LabelDoc, index: number): string {
  const n = doc.numbering;
  const v = (Number(n.start) || 0) + index * (Number(n.step) || 1);
  const neg = v < 0;
  const s = String(Math.abs(v)).padStart(Math.max(0, Number(n.padding) || 0), '0');
  return `${n.prefix || ''}${neg ? '-' : ''}${s}${n.suffix || ''}`;
}

const TOKEN = /\{\{\s*([^}]+?)\s*\}\}/g;

// ---------- Analyse des valeurs ----------

/** Nombre saisi à la française ou à l'anglaise : « 1 234,5 », « 1234.5 », « 12,50 € » */
export function parseNumber(s: string): number {
  let v = s.replace(/[\s  €$£%]/g, '');
  if (!v) return NaN;
  const lc = v.lastIndexOf(','),
    ld = v.lastIndexOf('.');
  if (lc >= 0 && ld >= 0) {
    // le dernier séparateur est la virgule décimale
    if (lc > ld) v = v.replace(/\./g, '').replace(',', '.');
    else v = v.replace(/,/g, '');
  } else if (lc >= 0) {
    v = (v.match(/,/g) || []).length > 1 ? v.replace(/,/g, '') : v.replace(',', '.');
  } else if ((v.match(/\./g) || []).length > 1) v = v.replace(/\./g, '');
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(v) ? parseFloat(v) : NaN;
}

const year2 = (y: number) => (y < 100 ? (y < 70 ? 2000 + y : 1900 + y) : y);

/**
 * Date saisie : ISO (2026-11-19, avec heure éventuelle), jj/mm/aaaa (ou - .), jj/mm/aa,
 * AAAAMMJJ, numéro de série Excel (45980). Renvoie null si illisible.
 */
export function parseDate(v: string | Date): Date | null {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : new Date(v.getTime());
  const s = v.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) return mk(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:\s+(\d{1,2})[:h](\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m) return mk(year2(+m[3]), +m[2], +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  m = /^(19|20)(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (m) return mk(+(m[1] + m[2]), +m[3], +m[4]);
  if (/^\d{1,5}(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    if (n >= 1 && n < 100000) {
      // série Excel : jours depuis le 30/12/1899 (bogue 1900 inclus dans ce décalage)
      const d = new Date(1899, 11, 30);
      d.setDate(d.getDate() + Math.floor(n));
      const frac = n - Math.floor(n);
      if (frac) d.setSeconds(Math.round(frac * 86400));
      return d;
    }
  }
  return null;
}
function mk(y: number, mo: number, d: number, h = 0, mi = 0, se = 0): Date | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const r = new Date(y, mo - 1, d, h, mi, se);
  return r.getMonth() === mo - 1 ? r : null;
}

// ---------- Filtres ----------

type Val = string | Date;
interface Filter {
  name: string;
  arg: string;
}

/** Filtres reconnus (nom → description courte, pour l'aide) */
export const FILTERS: { name: string; example: string; help: string }[] = [
  { name: 'defaut', example: '{{lot|defaut:N/A}}', help: 'Valeur de remplacement si le champ est vide' },
  { name: 'maj', example: '{{nom|maj}}', help: 'MAJUSCULES' },
  { name: 'min', example: '{{nom|min}}', help: 'minuscules' },
  { name: 'cap', example: '{{nom|cap}}', help: 'Première lettre en majuscule' },
  { name: 'trim', example: '{{nom|trim}}', help: 'Retire les espaces au début et à la fin' },
  { name: 'tronquer', example: '{{nom|tronquer:20}}', help: 'Garde les N premiers caractères' },
  { name: 'pad', example: '{{code|pad:6}}', help: 'Complète avec des zéros devant (N caractères)' },
  { name: 'nombre', example: '{{poids|nombre:2}}', help: 'Nombre à la française, N décimales' },
  { name: 'prix', example: '{{prix|prix}}', help: 'Prix en euros (12,50 €)' },
  { name: 'date', example: '{{fabrication|date:JJ/MM/AAAA}}', help: 'Lit une date (Excel, ISO, jj/mm/aaaa) et la formate' },
  { name: 'jours', example: '{{fabrication|jours:+5|date:JJ/MM/AAAA}}', help: 'Ajoute (ou retire) N jours à une date' },
  { name: 'remplacer', example: '{{ref|remplacer:-:/}}', help: 'Remplace un texte par un autre' },
  { name: 'chiffres', example: '{{poids|nombre:3|chiffres}}', help: 'Ne garde que les chiffres' },
  { name: 'cleprix', example: '{{prix|nombre:2|chiffres|pad:4|cleprix}}', help: 'EAN-13 prix variable : ajoute la clé prix devant 4 chiffres' },
];
const FILTER_NAMES = new Set(FILTERS.map((f) => f.name));
const ALIASES: Record<string, string> = { défaut: 'defaut', default: 'defaut', upper: 'maj', lower: 'min', majuscules: 'maj', minuscules: 'min', replace: 'remplacer', days: 'jours' };
const normName = (n: string) => {
  const k = n.trim().toLowerCase();
  return ALIASES[k] ?? k;
};

/** Sépare « clé|filtre:arg|filtre » (le « | » à l'intérieur d'un argument n'est pas géré) */
function parseToken(raw: string): { key: string; filters: Filter[] } {
  const parts = raw.split('|');
  const key = parts[0].trim();
  const filters = parts.slice(1).map((p) => {
    const i = p.indexOf(':');
    return i < 0 ? { name: normName(p), arg: '' } : { name: normName(p.slice(0, i)), arg: p.slice(i + 1) };
  });
  return { key, filters };
}

const asStr = (v: Val, doc: LabelDoc) => (v instanceof Date ? formatDate(v, doc.date.format || 'DD/MM/YYYY') : v);
const frNum = (n: number, dec: number) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec }).replace(/ /g, ' ');

function applyFilter(v: Val, f: Filter, doc: LabelDoc): Val {
  const s = () => asStr(v, doc);
  switch (f.name) {
    case 'defaut':
      return s().trim() === '' ? f.arg : v;
    case 'maj':
      return s().toLocaleUpperCase('fr-FR');
    case 'min':
      return s().toLocaleLowerCase('fr-FR');
    case 'cap': {
      const x = s();
      return x ? x.charAt(0).toLocaleUpperCase('fr-FR') + x.slice(1) : x;
    }
    case 'trim':
      return s().trim();
    case 'tronquer': {
      const n = parseInt(f.arg, 10);
      return isNaN(n) ? v : Array.from(s()).slice(0, Math.max(0, n)).join('');
    }
    case 'pad': {
      const n = parseInt(f.arg, 10);
      const x = s();
      if (isNaN(n)) return v;
      return x.startsWith('-') ? '-' + x.slice(1).padStart(n - 1, '0') : x.padStart(n, '0');
    }
    case 'nombre': {
      const n = parseNumber(s());
      const dec = f.arg === '' ? 2 : Math.max(0, Math.min(10, parseInt(f.arg, 10) || 0));
      return isNaN(n) ? v : frNum(n, dec);
    }
    case 'prix': {
      const n = parseNumber(s());
      return isNaN(n) ? v : frNum(n, 2) + ' €';
    }
    case 'jours': {
      const d = parseDate(v);
      const n = parseInt(f.arg.replace(/\s/g, ''), 10);
      if (!d || isNaN(n)) return v;
      d.setDate(d.getDate() + n);
      return d;
    }
    case 'date': {
      const d = parseDate(v);
      return d ? formatDate(d, f.arg || doc.date.format || 'DD/MM/YYYY') : v;
    }
    case 'remplacer': {
      const i = f.arg.indexOf(':');
      const a = i < 0 ? f.arg : f.arg.slice(0, i);
      const b = i < 0 ? '' : f.arg.slice(i + 1);
      return a ? s().split(a).join(b) : v;
    }
    case 'chiffres':
      return s().replace(/\D/g, '');
    case 'cleprix': {
      const x = s().replace(/\D/g, '');
      return x.length ? String(priceCheck4(x)) + x.padStart(4, '0').slice(-4) : v;
    }
    default:
      return v; // filtre inconnu : valeur inchangée (signalé dans l'éditeur)
  }
}

/** Filtres inconnus utilisés dans un texte (pour l'avertissement de l'éditeur) */
export function unknownFilters(text: string): string[] {
  const out = new Set<string>();
  if (!text || text.indexOf('{{') < 0) return [];
  for (const m of text.matchAll(TOKEN)) for (const f of parseToken(m[1]).filters) if (!FILTER_NAMES.has(f.name)) out.add(f.name);
  return Array.from(out);
}

// ---------- Champs à saisir à l'impression ----------

/** Nom d'un champ « à saisir » ({{?Lot}} → « Lot »), sinon null */
export function promptName(key: string): string | null {
  const k = key.trim();
  return k.startsWith('?') ? k.slice(1).trim() || null : null;
}

function promptValue(doc: LabelDoc, name: string): string {
  if (doc.promptValues) return doc.promptValues[name] ?? '';
  // éditeur : dernière valeur saisie, sinon le nom du champ comme repère
  const last = getLastPrompts(doc.id)[name];
  return last != null && last !== '' ? last : name;
}

/** Liste des champs « à saisir » d'un document, dans l'ordre d'apparition */
export function promptFields(doc: LabelDoc): string[] {
  const out: string[] = [];
  const add = (key: string) => {
    const n = promptName(key);
    if (n && !out.includes(n)) out.push(n);
  };
  for (const el of doc.elements) {
    if (el.hidden) continue;
    const s = textOf(el);
    if (s.indexOf('{{') >= 0) for (const m of s.matchAll(TOKEN)) add(parseToken(m[1]).key);
    if (el.showIf?.field) add(parseToken(stripBraces(el.showIf.field)).key);
  }
  return out;
}

// ---------- Résolution ----------

const isSerialKey = (lower: string) => lower === 'numero' || lower === 'numéro' || lower === '#' || lower === 'serial';

/** Valeur brute d'une clé ; undefined = clé inconnue sans ligne de données */
function keyValue(key: string, ctx: ResolveCtx, filtered: boolean): Val | undefined {
  const lower = key.toLowerCase();
  if (isSerialKey(lower)) return serialValue(ctx.doc, ctx.index);
  const dm = /^date\s*([+-]\s*\d+)?$/i.exec(key);
  if (dm) {
    const extra = dm[1] ? parseInt(dm[1].replace(/\s/g, ''), 10) : undefined;
    return filtered ? dateObj(ctx.doc, extra) : dateValue(ctx.doc, extra);
  }
  if (/^(aujourd'?hui|aujourd’hui|today|maintenant)$/i.test(key)) return docNow(ctx.doc);
  const pn = promptName(key);
  if (pn) return promptValue(ctx.doc, pn);
  if (ctx.row) {
    if (key in ctx.row) return ctx.row[key] ?? '';
    const found = Object.keys(ctx.row).find((k) => k.trim().toLowerCase() === lower);
    if (found) return ctx.row[found] ?? '';
    return '';
  }
  return undefined;
}

function evalToken(raw: string, ctx: ResolveCtx): string | undefined {
  const { key, filters } = parseToken(raw);
  let v = keyValue(key, ctx, filters.length > 0);
  if (v === undefined) return undefined;
  for (const f of filters) v = applyFilter(v, f, ctx.doc);
  return asStr(v, ctx.doc);
}

export function resolveText(text: string, ctx: ResolveCtx): string {
  if (!ctx.resolve || !text || text.indexOf('{{') < 0) return text;
  return text.replace(TOKEN, (whole, rawKey: string) => evalToken(rawKey, ctx) ?? whole);
}

// ---------- Conditions d'affichage ----------

const stripBraces = (s: string) => s.trim().replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '');
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** Valeur du champ testé par une condition (champ inconnu sans données → vide) */
export function conditionValue(c: ShowCondition, ctx: ResolveCtx): string {
  const f = stripBraces(c.field || '');
  if (!f) return '';
  return evalToken(f, { ...ctx, resolve: true }) ?? '';
}

export function conditionHolds(c: ShowCondition | undefined, ctx: ResolveCtx): boolean {
  if (!c || !c.field?.trim()) return true;
  const v = fold(conditionValue(c, ctx));
  const ref = fold(resolveText(c.value ?? '', { ...ctx, resolve: true }));
  switch (c.op) {
    case 'empty':
      return v === '';
    case 'notEmpty':
      return v !== '';
    case 'eq':
      return v === ref;
    case 'ne':
      return v !== ref;
    case 'contains':
      return ref === '' ? true : v.includes(ref);
    default:
      return true;
  }
}

/**
 * L'élément est-il imprimé pour cette ligne ? (masqué → non ; condition évaluée
 * seulement quand les champs sont résolus, sinon on montre tout)
 */
export function isPrinted(el: LabelElement, ctx: ResolveCtx): boolean {
  if (el.hidden) return false;
  if (!ctx.resolve || !el.showIf) return true;
  return conditionHolds(el.showIf, ctx);
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
  return doc.elements.some((e) => /\{\{\s*(numero|numéro|#|serial)\s*(\|[^}]*)?\}\}/i.test(textOf(e)));
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
