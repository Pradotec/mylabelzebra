import type { LabelDoc, LabelElement, NumberingConfig, ShowCondition } from '../types';
import { qrPayload, priceCheck4 } from './codes';
import { getLastPrompts, parsePromptOption, mergePromptSpec, type PromptOption, type PromptSpec } from '../prompts';
import { composeSscc, ssccPreview, type SsccDoc } from '../sscc';

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

const DATE_TOKEN = /YYYY|yyyy|AAAA|aaaa|YY|yy|AA|aa|MMMM|mmmm|MMM|mmm|MM|mm|DD|dd|JJ|jj|HH|hh|ss/g;

/**
 * Formate une date. Jetons (majuscules ou minuscules) : AAAA / YYYY, AA / YY, MMMM, MMM,
 * MM, JJ / DD, HH / hh (heures 0-23), mm, ss.
 * « mm » en minuscules = MOIS, sauf juste après HH / hh (« HH:mm », « hhhmm ») ou juste
 * avant ss (« mm:ss ») où il désigne les minutes.
 */
export function formatDate(d: Date, format: string): string {
  return format.replace(DATE_TOKEN, (t, at: number, all: string) => {
    switch (t) {
      case 'YYYY': case 'yyyy': case 'AAAA': case 'aaaa': return String(d.getFullYear());
      case 'YY': case 'yy': case 'AA': case 'aa': return pad(d.getFullYear() % 100);
      case 'MMMM': case 'mmmm': return MONTHS_LONG[d.getMonth()];
      case 'MMM': case 'mmm': return MONTHS[d.getMonth()];
      case 'MM': return pad(d.getMonth() + 1);
      case 'mm': {
        const minutes = /(HH|hh)[:h.]?$/.test(all.slice(0, at)) || /^[:.]?ss/.test(all.slice(at + 2));
        return pad(minutes ? d.getMinutes() : d.getMonth() + 1);
      }
      case 'DD': case 'dd': case 'JJ': case 'jj': return pad(d.getDate());
      case 'HH': case 'hh': return pad(d.getHours());
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

/** Répétition effective du compteur (même numéro sur N étiquettes), ≥ 1 */
export const serialRepeat = (n: NumberingConfig) => Math.max(1, Math.floor(Number(n.repeat) || 1));

/** Valeur numérique du compteur pour l'étiquette d'index donné (pas, répétition) */
export function serialNumber(n: NumberingConfig, index: number): number {
  return (Number(n.start) || 0) + Math.floor(Math.max(0, index) / serialRepeat(n)) * (Number(n.step) || 1);
}

/** Départ de la série suivante après avoir produit « count » étiquettes */
export function serialNextStart(n: NumberingConfig, count: number): number {
  return serialNumber(n, Math.ceil(Math.max(0, count) / serialRepeat(n)) * serialRepeat(n));
}

/** Nombre → chiffres du compteur (décimal ou base 36 majuscules), sans signe ni zéros */
export const serialDigits = (v: number, alpha?: boolean) => (alpha ? Math.abs(v).toString(36).toUpperCase() : String(Math.abs(v)));

/** Lit un départ saisi en base 36 (« A0 » → 360) ; NaN si invalide */
export function parseSerialAlpha(s: string): number {
  const t = s.trim();
  if (!/^-?[0-9a-z]+$/i.test(t)) return NaN;
  return parseInt(t, 36);
}

export function serialValue(doc: LabelDoc, index: number): string {
  const n = doc.numbering;
  const v = serialNumber(n, index);
  const s = serialDigits(v, n.alpha).padStart(Math.max(0, Number(n.padding) || 0), '0');
  return `${n.prefix || ''}${v < 0 ? '-' : ''}${s}${n.suffix || ''}`;
}

// ---------- Position dans le travail ({{#pos}} / {{#total}}) ----------

const jobCache = new WeakMap<object, { total: number; rank: Map<number, number> }>();

/**
 * Position (1-based) de l'étiquette dans le travail et nombre d'étiquettes différentes
 * du travail : lignes cochées (sinon 1), sinon la série numérotée. Les copies d'une même
 * étiquette (×N) sont identiques et ne sont pas comptées.
 */
export function jobPosition(doc: LabelDoc, index: number): { pos: number; total: number } {
  const d = doc.data;
  if (d && d.rows.length) {
    let c = jobCache.get(d.checked);
    if (!c) {
      const rank = new Map<number, number>();
      d.checked.forEach((v, i) => v && i < d.rows.length && rank.set(i, rank.size + 1));
      c = { total: rank.size || 1, rank };
      jobCache.set(d.checked, c);
    }
    return { pos: c.rank.get(index) ?? Math.min(index + 1, c.total), total: c.total };
  }
  const total = Math.min(500, Math.max(1, Number(doc.numbering.count) || 1));
  return { pos: index + 1, total };
}

// ---------- SSCC ({{#sscc}}) ----------

/**
 * SSCC 18 chiffres de l'étiquette : dans un travail, celui de la plage réservée (même
 * SSCC pour les copies d'une étiquette, un SSCC par ligne / numéro) ; dans l'éditeur, le
 * prochain SSCC prévu (non réservé). Un document de travail sans plage réservée ne
 * reçoit jamais de numéro (le champ reste affiché tel quel) ; undefined = non configuré.
 */
export function ssccValue(doc: LabelDoc, index: number): string | undefined {
  const a = (doc as SsccDoc).ssccJob;
  if (a) {
    const k = a.indices.indexOf(index);
    return k < 0 ? '' : composeSscc(a.extension, a.prefix, a.start + k);
  }
  if (doc.jobDate != null) return undefined;
  return ssccPreview(jobPosition(doc, index).pos - 1);
}

const SSCC_RE = /\{\{\s*#sscc\s*(\|[^}]*)?\}\}/i;

/** L'étiquette contient-elle {{#sscc}} (éléments visibles, condition d'affichage comprise) ? */
export function docUsesSscc(doc: LabelDoc): boolean {
  return doc.elements.some((e) => !e.hidden && (SSCC_RE.test(textOf(e)) || SSCC_RE.test(e.showIf?.value ?? '') || /^\s*(\{\{)?\s*#sscc\s*(\||\}\}|$)/i.test(e.showIf?.field ?? '')));
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
  { name: 'si', example: '{{lot|si:Lot présent}}', help: 'Affiche ce texte si le champ n’est pas vide (sinon rien)' },
  { name: 'sinon', example: '{{lot|si:Avec lot|sinon:Sans lot}}', help: 'Affiche ce texte si le champ (ou le résultat précédent) est vide' },
  { name: 'maj', example: '{{nom|maj}}', help: 'MAJUSCULES' },
  { name: 'min', example: '{{nom|min}}', help: 'minuscules' },
  { name: 'cap', example: '{{nom|cap}}', help: 'Première lettre en majuscule' },
  { name: 'trim', example: '{{nom|trim}}', help: 'Retire les espaces au début et à la fin' },
  { name: 'tronquer', example: '{{nom|tronquer:20}}', help: 'Garde les N premiers caractères' },
  { name: 'sous', example: '{{ref|sous:3,4}}', help: 'Sous-chaîne : à partir du caractère N (1 = premier, négatif = depuis la fin), sur L caractères' },
  { name: 'pad', example: '{{code|pad:6}}', help: 'Complète avec des zéros devant (N caractères)' },
  { name: 'nombre', example: '{{poids|nombre:2}}', help: 'Nombre à la française, N décimales' },
  { name: 'arrondi', example: '{{poids|arrondi:2}}', help: 'Arrondit à N décimales (sans séparateur de milliers)' },
  { name: 'calc', example: '{{prix|calc:*1,2}}', help: 'Calcul sur la valeur : *1,2  /1000  +5  -3  ou expression avec x, ex. (x-10)/2' },
  { name: 'prix', example: '{{prix|prix}}', help: 'Prix en euros (12,50 €)' },
  { name: 'prixkg', example: '{{prix|prixkg:Poids|prix}}', help: 'Prix au kilo : prix ÷ poids (kg) de la colonne indiquée ; « prixkg:Poids,g » si le poids est en grammes' },
  { name: 'date', example: '{{fabrication|date:JJ/MM/AAAA}}', help: 'Lit une date (Excel, ISO, jj/mm/aaaa) et la formate. Jetons : JJ, MM, MMM, MMMM, AA, AAAA, HH, mm, ss (minuscules acceptées : jj/mm/aaaa ; « mm » = minutes seulement après HH)' },
  { name: 'jours', example: '{{fabrication|jours:+5|date:JJ/MM/AAAA}}', help: 'Ajoute (ou retire) N jours à une date' },
  { name: 'remplacer', example: '{{ref|remplacer:-:/}}', help: 'Remplace un texte par un autre' },
  { name: 'chiffres', example: '{{poids|nombre:3|chiffres}}', help: 'Ne garde que les chiffres' },
  { name: 'cleprix', example: '{{prix|nombre:2|chiffres|pad:4|cleprix}}', help: 'EAN-13 prix variable : ajoute la clé prix devant 4 chiffres' },
];
const FILTER_NAMES = new Set(FILTERS.map((f) => f.name));
const ALIASES: Record<string, string> = {
  défaut: 'defaut',
  default: 'defaut',
  upper: 'maj',
  lower: 'min',
  majuscules: 'maj',
  minuscules: 'min',
  replace: 'remplacer',
  days: 'jours',
  round: 'arrondi',
  substr: 'sous',
};
const normName = (n: string) => {
  const k = n.trim().toLowerCase();
  return ALIASES[k] ?? k;
};

/**
 * Sépare « clé|filtre:arg|filtre » (le « | » à l'intérieur d'un argument n'est pas géré).
 * Pour un champ à saisir ({{?Nom|…}}), les options de saisie (liste, obligatoire, gtin,
 * regex, min:N, max:N) sont mises à part et ne sont pas appliquées comme filtres.
 */
function parseToken(raw: string): { key: string; filters: Filter[]; options: PromptOption[] } {
  const parts = raw.split('|');
  const key = parts[0].trim();
  const isPrompt = promptName(key) != null;
  const filters: Filter[] = [];
  const options: PromptOption[] = [];
  for (const p of parts.slice(1)) {
    const i = p.indexOf(':');
    const f = i < 0 ? { name: normName(p), arg: '' } : { name: normName(p.slice(0, i)), arg: p.slice(i + 1) };
    const o = isPrompt ? parsePromptOption(f.name, f.arg) : null;
    if (o) options.push(o);
    else filters.push(f);
  }
  return { key, filters, options };
}

const asStr = (v: Val, doc: LabelDoc) => (v instanceof Date ? formatDate(v, doc.date.format || 'DD/MM/YYYY') : v);
const frNum = (n: number, dec: number) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec }).replace(/ /g, ' ');

/** Résultat de calcul → texte : virgule décimale, sans milliers ni notation scientifique (10 décimales max) */
export function numText(n: number, dec?: number): string {
  const s = n.toLocaleString('en-US', {
    useGrouping: false,
    minimumFractionDigits: dec ?? 0,
    maximumFractionDigits: dec ?? 10,
  });
  return (/^-0([.,]0*)?$/.test(s) ? s.slice(1) : s).replace('.', ',');
}

/** Arrondi « commercial » (au plus loin de zéro) à N décimales (N négatif : dizaines…) */
export function roundTo(n: number, dec: number): number {
  const sign = n < 0 ? -1 : 1;
  return sign * Number(Math.round(Number(Math.abs(n) + 'e' + dec)) + 'e' + -dec);
}

/**
 * Calcul sûr (sans eval) : + - * / ( ), nombres à virgule ou à point, « x » (ou « valeur »)
 * = la valeur du champ. Une expression qui commence par un opérateur s'applique à la valeur
 * (« *1,2 » = « x*1,2 »). Renvoie NaN si l'expression est invalide ou divise par zéro.
 */
export function calcExpr(expr: string, x: number): number {
  let src = expr.replace(/\s+/g, '').replace(/valeur/gi, 'x').replace(/[×]/g, '*').replace(/[÷]/g, '/');
  if (/^[*/+-]/.test(src)) src = 'x' + src;
  const toks = src.match(/\d+(?:[.,]\d+)?|[.,]\d+|[x()*/+-]|./gi) ?? [];
  let i = 0;
  const peek = () => toks[i];
  const fail = () => {
    throw new Error('calc');
  };
  const primary = (): number => {
    const t = toks[i++];
    if (t === undefined) return fail();
    if (t === '(') {
      const v = sum();
      if (toks[i++] !== ')') fail();
      return v;
    }
    if (t === '-') return -primary();
    if (t === '+') return primary();
    if (t.toLowerCase() === 'x') return x;
    if (/^[\d.,]/.test(t)) return parseFloat(t.replace(',', '.'));
    return fail();
  };
  const product = (): number => {
    let v = primary();
    while (peek() === '*' || peek() === '/') {
      const op = toks[i++];
      const r = primary();
      if (op === '/' && r === 0) fail();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (peek() === '+' || peek() === '-') {
      const op = toks[i++];
      const r = product();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  try {
    if (!toks.length || toks.length > 200) return NaN;
    const v = sum();
    return i === toks.length && Number.isFinite(v) ? v : NaN;
  } catch {
    return NaN;
  }
}

function applyFilter(v: Val, f: Filter, ctx: ResolveCtx): Val {
  const doc = ctx.doc;
  const s = () => asStr(v, doc);
  switch (f.name) {
    case 'defaut':
      return s().trim() === '' ? f.arg : v;
    case 'si':
      return s().trim() === '' ? '' : f.arg;
    case 'sinon':
      return s().trim() === '' ? f.arg : v;
    case 'sous': {
      const [a, l] = f.arg.split(/[,;]/).map((x) => parseInt(x.trim(), 10));
      if (isNaN(a)) return v;
      const chars = Array.from(s());
      const start = a > 0 ? a - 1 : a < 0 ? Math.max(0, chars.length + a) : 0;
      return chars.slice(start, isNaN(l) ? undefined : start + Math.max(0, l)).join('');
    }
    case 'arrondi': {
      const n = parseNumber(s());
      const dec = f.arg.trim() === '' ? 0 : parseInt(f.arg, 10);
      if (isNaN(n) || isNaN(dec)) return v;
      const d = Math.max(-10, Math.min(10, dec));
      return numText(roundTo(n, d), Math.max(0, d));
    }
    case 'calc': {
      const x = parseNumber(s());
      const r = calcExpr(f.arg, x);
      return isNaN(r) ? v : numText(roundTo(r, 10));
    }
    case 'prixkg': {
      const price = parseNumber(s());
      const parts = f.arg.split(',');
      const unit = parts.length > 1 ? parts[parts.length - 1].trim().toLowerCase() : '';
      const col = stripBraces(unit === 'g' || unit === 'kg' ? parts.slice(0, -1).join(',') : f.arg).trim();
      if (!col || isNaN(price)) return v;
      const wv = keyValue(col, ctx, false);
      let w = wv === undefined ? NaN : parseNumber(asStr(wv, doc));
      if (unit === 'g') w /= 1000;
      // poids absent ou nul : rien (un prix au kilo faux serait trompeur)
      return !(w > 0) ? '' : numText(roundTo(price / w, 2), 2);
    }
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

/**
 * Description des champs à saisir (type, choix, contraintes), dans l'ordre d'apparition.
 * Options : {{?Nom|liste:A;B;C}}, |obligatoire, |gtin, |regex:…, |min:N, |max:N
 * (les options de toutes les occurrences d'un même champ sont fusionnées).
 */
export function promptSpecs(doc: LabelDoc): PromptSpec[] {
  const out = new Map<string, PromptSpec>();
  const add = (raw: string) => {
    const { key, options } = parseToken(raw);
    const n = promptName(key);
    if (!n) return;
    out.set(n, mergePromptSpec(out.get(n) ?? { name: n, type: 'text', required: false }, options));
  };
  for (const el of doc.elements) {
    if (el.hidden) continue;
    const s = textOf(el);
    if (s.indexOf('{{') >= 0) for (const m of s.matchAll(TOKEN)) add(m[1]);
    if (el.showIf?.field) add(stripBraces(el.showIf.field));
  }
  return Array.from(out.values());
}

// ---------- Résolution ----------

const isSerialKey = (lower: string) => lower === 'numero' || lower === 'numéro' || lower === '#' || lower === 'serial';
/** {{#pos}} position dans le travail, {{#total}} nombre d'étiquettes du travail (colis « 1/N ») */
const isPosKey = (lower: string) => lower === '#pos' || lower === '#colis';
const isTotalKey = (lower: string) => lower === '#total' || lower === '#nb';

/** Valeur brute d'une clé ; undefined = clé inconnue sans ligne de données */
function keyValue(key: string, ctx: ResolveCtx, filtered: boolean): Val | undefined {
  const lower = key.toLowerCase();
  if (isSerialKey(lower)) return serialValue(ctx.doc, ctx.index);
  if (isPosKey(lower)) return String(jobPosition(ctx.doc, ctx.index).pos);
  if (isTotalKey(lower)) return String(jobPosition(ctx.doc, ctx.index).total);
  if (lower === '#sscc') return ssccValue(ctx.doc, ctx.index);
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
  for (const f of filters) v = applyFilter(v, f, ctx);
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
  return doc.elements.some((e) => /\{\{\s*(numero|numéro|#|serial|#pos|#colis|#total|#nb)\s*(\|[^}]*)?\}\}/i.test(textOf(e)));
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
  if (docUsesSerial(doc) || docUsesSscc(doc)) {
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
