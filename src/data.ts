import Papa from 'papaparse';
import type { DataSet } from './types';

export type DataWarning = NonNullable<DataSet['warnings']>[number];

/** Nombre maximal de lignes importées */
export const MAX_ROWS = 5000;

function toDataSet(rows: string[][], source: string, extra: Partial<DataSet> = {}): DataSet {
  const clean = rows.filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
  if (!clean.length) throw new Error('Aucune donnée trouvée');
  const header = clean[0].map((h, i) => String(h ?? '').trim() || `Colonne ${i + 1}`);
  // dédoublonne les en-têtes
  const seen = new Map<string, number>();
  const columns = header.map((h) => {
    const n = seen.get(h) || 0;
    seen.set(h, n + 1);
    return n ? `${h}_${n + 1}` : h;
  });
  const total = clean.length - 1;
  const body = clean.slice(1, MAX_ROWS + 1).map((r) => Object.fromEntries(columns.map((c, i) => [c, String(r[i] ?? '').trim()])));
  const warnings: DataWarning[] = [...(extra.warnings ?? [])];
  if (total > MAX_ROWS) warnings.push({ kind: 'truncated', kept: MAX_ROWS, total });
  const ds: DataSet = { columns, rows: body, checked: body.map(() => false), copies: body.map(() => 1), source, ...extra };
  if (warnings.length) ds.warnings = warnings;
  else delete ds.warnings;
  return ds;
}

/** CSV / TSV (séparateur détecté automatiquement, guillemets gérés) */
export function parseDelimited(text: string, source = 'collé', warnings: DataWarning[] = []): DataSet {
  const t = text.replace(/^﻿/, '');
  const firstLine = t.split(/\r?\n/)[0] || '';
  const delimiter = firstLine.includes('\t') ? '\t' : undefined;
  const res = Papa.parse<string[]>(t, { delimiter, skipEmptyLines: 'greedy' });
  return toDataSet(res.data as string[][], source, warnings.length ? { warnings } : {});
}

// ---------- Encodage des fichiers texte ----------

/** Caractères windows-1252 des octets 0x80–0x9F (le reste = latin-1) */
const CP1252_HIGH =
  '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F' +
  '\u0090‘’“”•–—˜™š›œ\u009DžŸ';

function decode1252(bytes: Uint8Array): string {
  try {
    return new TextDecoder('windows-1252').decode(bytes);
  } catch {
    // TextDecoder sans prise en charge de windows-1252 : table intégrée
    let s = '';
    for (const b of bytes) s += b >= 0x80 && b < 0xa0 ? CP1252_HIGH[b - 0x80] : String.fromCharCode(b);
    return s;
  }
}

/**
 * Décode un fichier texte : UTF-8 strict (BOM retiré), sinon windows-1252
 * (CSV enregistré par Excel « CSV (séparateur : point-virgule) » sous Windows).
 */
export function decodeText(buf: ArrayBuffer | Uint8Array): { text: string; encoding: 'utf-8' | 'windows-1252' } {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: decode1252(bytes), encoding: 'windows-1252' };
  }
}

/** CSV / TSV depuis les octets du fichier (encodage détecté) */
export function parseDelimitedBytes(buf: ArrayBuffer | Uint8Array, source: string): DataSet {
  const { text, encoding } = decodeText(buf);
  return parseDelimited(text, source, encoding === 'utf-8' ? [] : [{ kind: 'encoding', encoding }]);
}

// ---------- Classeurs Excel / ODS ----------

type XLSXModule = typeof import('xlsx');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cell = { t?: string; v?: any; w?: string; z?: string | number };

const p2 = (n: number) => String(n).padStart(2, '0');

/** Date sans fuseau horaire → JJ/MM/AAAA, + HH:MM(:SS) si l'heure n'est pas minuit */
function fmtDateParts(y: number, m: number, d: number, H: number, M: number, S: number, timeOnly = false): string {
  const time = H || M || S ? `${p2(H)}:${p2(M)}${S ? ':' + p2(S) : ''}` : '';
  if (timeOnly) return time || '00:00';
  return `${p2(d)}/${p2(m)}/${y}` + (time ? ' ' + time : '');
}

/** Retire du format les chaînes entre guillemets, les [couleurs] et les caractères échappés */
const fmtCore = (z: string) => z.split(';')[0].replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');

/**
 * Nombre → texte complet, sans notation scientifique ni séparateur de milliers.
 * Décimales : VIRGULE française (« 12,5 »), relue correctement par parseNumber et
 * prête à imprimer telle quelle ; précision limitée à 15 chiffres significatifs (comme Excel).
 * Les décimales imposées par le format de cellule (0,00) sont respectées au minimum.
 */
export function numberToText(v: number, z?: string): string {
  if (!Number.isFinite(v)) return String(v);
  const core = typeof z === 'string' && z !== 'General' ? fmtCore(z) : '';
  if (core.includes('%')) return numberToText(Number((v * 100).toPrecision(15)), core.replace(/%/g, '')) + '%';
  const minDec = /\.(0+)/.exec(core)?.[1].length ?? 0;
  let s: string;
  if (Number.isInteger(v)) {
    s = BigInt(v).toString();
    // format « 00000 » (code postal…) : zéros devant
    const zeros = /^0+$/.exec(core.trim());
    if (zeros && s.length < zeros[0].length && v >= 0) s = s.padStart(zeros[0].length, '0');
    if (minDec) s += ',' + '0'.repeat(minDec);
    return s;
  }
  const r = Number(v.toPrecision(15));
  s = r.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20, minimumFractionDigits: minDec });
  return s.replace('.', ',');
}

/** Nombre entier de plus de 15 chiffres significatifs (précision perdue dans Excel) ? */
const tooPrecise = (v: number) => Number.isInteger(v) && Math.abs(v) >= 1e15;

function cellText(X: XLSXModule, cell: Cell | undefined, date1904: boolean): string {
  if (!cell || cell.v == null) return '';
  const v = cell.v;
  if (v instanceof Date) {
    // cellules de type date (ODS, ISO) : composantes locales, comme les affiche SheetJS
    if (isNaN(v.getTime())) return cell.w ?? '';
    return fmtDateParts(v.getFullYear(), v.getMonth() + 1, v.getDate(), v.getHours(), v.getMinutes(), v.getSeconds());
  }
  switch (cell.t) {
    case 'n': {
      const z = typeof cell.z === 'string' ? cell.z : undefined;
      if (z && X.SSF.is_date(z)) {
        const p = X.SSF.parse_date_code(v, { date1904 });
        if (p) {
          // format horaire seul (hh:mm) sur une valeur < 1 jour
          const timeOnly = v < 1 && !/[dy]/i.test(fmtCore(z).replace(/\[[^\]]*\]/g, ''));
          return fmtDateParts(p.y, p.m, p.d, p.H, p.M, p.S, timeOnly);
        }
      }
      return numberToText(v as number, z);
    }
    case 's':
      return String(v);
    case 'b':
      return v ? 'VRAI' : 'FAUX';
    case 'e':
      return cell.w ?? '';
    default:
      return cell.w ?? String(v);
  }
}

export interface WorkbookOptions {
  /** nom de la feuille à lire (défaut : la première) */
  sheet?: string;
}

/** Lit un classeur (XLSX, XLS, ODS…) déjà chargé en mémoire */
export async function parseWorkbook(buf: ArrayBuffer | Uint8Array, source: string, opts: WorkbookOptions = {}): Promise<DataSet> {
  const X = await import('xlsx');
  const wb = X.read(buf, { type: 'array', cellDates: false, cellNF: true });
  const names = wb.SheetNames;
  if (!names.length) throw new Error('Aucune donnée trouvée');
  const sheet = opts.sheet && names.includes(opts.sheet) ? opts.sheet : names[0];
  const ws = wb.Sheets[sheet];
  const date1904 = !!wb.Workbook?.WBProps?.date1904;
  const rows: string[][] = [];
  const precision = new Map<string, { count: number; example: string }>();
  const ref = ws?.['!ref'];
  if (ref) {
    const range = X.utils.decode_range(ref);
    const colOf = (c: number) => X.utils.encode_col(c);
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[X.utils.encode_cell({ r, c })] as Cell | undefined;
        const txt = cellText(X, cell, date1904);
        row.push(txt);
        if (cell?.t === 'n' && typeof cell.v === 'number' && tooPrecise(cell.v)) {
          const key = colOf(c);
          const p = precision.get(key) ?? { count: 0, example: txt };
          p.count++;
          precision.set(key, p);
        }
      }
      rows.push(row);
    }
  }
  // nom de colonne lisible pour les avertissements : en-tête de la première ligne non vide
  const headerRow = rows.find((r) => r.some((x) => x.trim() !== ''));
  const firstCol = ref ? X.utils.decode_range(ref).s.c : 0;
  const warnings: DataWarning[] = Array.from(precision, ([col, p]) => {
    const idx = X.utils.decode_col(col) - firstCol;
    return { kind: 'precision' as const, column: headerRow?.[idx]?.trim() || col, count: p.count, example: p.example };
  });
  const extra: Partial<DataSet> = { sheet };
  if (names.length > 1) extra.sheets = [...names];
  if (warnings.length) extra.warnings = warnings;
  return toDataSet(rows, source, extra);
}

/** Dernier classeur importé, gardé en mémoire pour changer de feuille sans le réimporter */
let lastWorkbook: { source: string; buf: ArrayBuffer } | null = null;

/** Le classeur de cette source est-il encore en mémoire (changement de feuille possible) ? */
export function canSwitchSheet(source?: string): boolean {
  return !!lastWorkbook && lastWorkbook.source === source;
}

/** Relit une autre feuille du dernier classeur importé */
export function reloadSheet(source: string, sheet: string): Promise<DataSet> {
  if (!lastWorkbook || lastWorkbook.source !== source) return Promise.reject(new Error('Réimportez le fichier pour changer de feuille'));
  return parseWorkbook(lastWorkbook.buf, source, { sheet });
}

export async function parseFile(file: File, opts: WorkbookOptions = {}): Promise<DataSet> {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  if (/\.(xlsx|xlsm|xls|ods)$/.test(name)) {
    const ds = await parseWorkbook(buf, file.name, opts);
    lastWorkbook = { source: file.name, buf };
    return ds;
  }
  return parseDelimitedBytes(buf, file.name);
}

/** Lien Google Sheets (publié ou partagé) → URL d'export CSV */
export function googleCsvUrl(url: string): string {
  const u = url.trim();
  if (/output=csv|format=csv/.test(u)) return u;
  const m = /docs\.google\.com\/spreadsheets\/d\/(e\/)?([\w-]+)/.exec(u);
  if (!m) return u;
  const gid = /[#&?]gid=(\d+)/.exec(u)?.[1] ?? '0';
  if (m[1]) return `https://docs.google.com/spreadsheets/d/e/${m[2]}/pub?output=csv&gid=${gid}`;
  return `https://docs.google.com/spreadsheets/d/${m[2]}/export?format=csv&gid=${gid}`;
}

export async function fetchSheet(url: string): Promise<DataSet> {
  const r = await fetch(googleCsvUrl(url));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const txt = await r.text();
  if (/^\s*<!DOCTYPE html/i.test(txt)) throw new Error('La feuille n’est pas publiée en CSV');
  return parseDelimited(txt, 'Google Sheets');
}

// ---------- Outils sur les lignes (tri, filtre, recherche, éclatement, génération) ----------

/** Comparaison sans accents ni casse */
export const foldText = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** GTIN-8 / 12 / 13 / 14 avec clé de contrôle correcte (espaces ignorés) */
export function isValidGtinText(v: string): boolean {
  const s = v.replace(/\s/g, '');
  if (!/^(\d{8}|\d{12,14})$/.test(s)) return false;
  let sum = 0;
  for (let i = 1; i < s.length; i++) sum += +s[s.length - 1 - i] * (i % 2 === 1 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === +s[s.length - 1];
}

export type RowOp = 'contains' | 'eq' | 'ne' | 'empty' | 'notEmpty' | 'dup' | 'badGtin';
export interface RowFilter {
  /** recherche dans toutes les colonnes */
  query: string;
  /** colonne du critère ('' = aucun critère) */
  column: string;
  op: RowOp;
  value: string;
}

/**
 * Indices des lignes qui passent la recherche et le critère de colonne. Comparaisons sans
 * casse ni accents. « dup » : valeur non vide présente sur plusieurs lignes de la colonne ;
 * « badGtin » : valeur non vide qui n'est pas un GTIN-8/12/13/14 à clé correcte.
 */
export function filterRows(data: Pick<DataSet, 'rows' | 'columns'>, f: RowFilter): number[] {
  const q = foldText(f.query);
  const v = foldText(f.value);
  let counts: Map<string, number> | undefined;
  if (f.column && f.op === 'dup') {
    counts = new Map();
    for (const r of data.rows) {
      const x = foldText(r[f.column] ?? '');
      if (x) counts.set(x, (counts.get(x) ?? 0) + 1);
    }
  }
  const out: number[] = [];
  data.rows.forEach((r, i) => {
    if (q && !data.columns.some((c) => foldText(r[c] ?? '').includes(q))) return;
    if (f.column) {
      const x = foldText(r[f.column] ?? '');
      switch (f.op) {
        case 'contains':
          if (v && !x.includes(v)) return;
          break;
        case 'eq':
          if (x !== v) return;
          break;
        case 'ne':
          if (x === v) return;
          break;
        case 'empty':
          if (x !== '') return;
          break;
        case 'notEmpty':
          if (x === '') return;
          break;
        case 'dup':
          if (!x || (counts?.get(x) ?? 0) < 2) return;
          break;
        case 'badGtin':
          if (!x || isValidGtinText(x)) return;
          break;
      }
    }
    out.push(i);
  });
  return out;
}

const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

/**
 * Trie les lignes selon une colonne, en ordre naturel (« ZB1-01-02 » avant « ZB1-01-10 »),
 * sans tenir compte de la casse ni des accents. Les valeurs vides restent à la fin dans les
 * deux sens ; tri stable. Cases cochées et copies suivent leur ligne.
 */
export function sortRows(data: DataSet, column: string, dir: 'asc' | 'desc' = 'asc'): DataSet {
  const k = dir === 'desc' ? -1 : 1;
  const order = data.rows.map((_, i) => i);
  const val = data.rows.map((r) => (r[column] ?? '').trim());
  order.sort((a, b) => {
    const x = val[a],
      y = val[b];
    if (!x || !y) return x === y ? a - b : x ? -1 : 1;
    return k * collator.compare(x, y) || a - b;
  });
  return {
    ...data,
    rows: order.map((i) => data.rows[i]),
    checked: order.map((i) => !!data.checked[i]),
    copies: order.map((i) => data.copies[i] ?? 1),
  };
}

/**
 * Ligne cherchée par « Aller à… » : numéro de ligne (1 = première) s'il est dans les
 * bornes, sinon la prochaine ligne (après « from », en boucle) dont une colonne contient
 * le texte (sans casse ni accents). Renvoie aussi le rang de l'occurrence et leur nombre.
 */
export function findRow(data: Pick<DataSet, 'rows' | 'columns'>, query: string, from = -1): { row: number; rank: number; count: number } | null {
  const q = query.trim();
  if (!q) return null;
  if (/^\d+$/.test(q)) {
    const n = parseInt(q, 10);
    if (n >= 1 && n <= data.rows.length) return { row: n - 1, rank: 1, count: 1 };
  }
  const f = foldText(q);
  const hits: number[] = [];
  data.rows.forEach((r, i) => {
    if (data.columns.some((c) => foldText(r[c] ?? '').includes(f))) hits.push(i);
  });
  if (!hits.length) return null;
  const k = hits.findIndex((i) => i > from);
  const at = k < 0 ? 0 : k;
  return { row: hits[at], rank: at + 1, count: hits.length };
}

export type SplitMode = { kind: 'sep'; sep: string } | { kind: 'cases' };

/**
 * Morceaux d'une valeur à éclater.
 * - séparateur : découpe, espaces retirés, morceaux vides ignorés ;
 * - cases : « ZB1-04-03-B1B5C1C3 » → ZB1-04-03-B1, -B5, -C1, -C3 (préfixe jusqu'au dernier
 *   « - » conservé, dernier segment découpé en motifs lettre + chiffres) ; sinon inchangée.
 */
export function splitValue(value: string, mode: SplitMode): string[] {
  if (mode.kind === 'sep') {
    if (!mode.sep) return [value];
    const parts = value
      .split(mode.sep)
      .map((p) => p.trim())
      .filter(Boolean);
    return parts.length ? parts : [value];
  }
  const v = value.trim();
  const i = v.lastIndexOf('-');
  const prefix = v.slice(0, i + 1);
  const last = v.slice(i + 1);
  if (!/^([A-Z]\d+){2,}$/.test(last)) return [value];
  return (last.match(/[A-Z]\d+/g) ?? []).map((p) => prefix + p);
}

/** Nombre de lignes après éclatement (aperçu) */
export function splitCount(data: Pick<DataSet, 'rows'>, column: string, mode: SplitMode): number {
  return data.rows.reduce((n, r) => n + splitValue(r[column] ?? '', mode).length, 0);
}

/**
 * Éclate une colonne : une ligne par morceau, les autres colonnes (case cochée et copies
 * comprises) recopiées. Le résultat est limité à « max » lignes (truncated = lignes perdues).
 */
export function splitColumn(data: DataSet, column: string, mode: SplitMode, max = MAX_ROWS): { data: DataSet; truncated: number } {
  const rows: Record<string, string>[] = [];
  const checked: boolean[] = [];
  const copies: number[] = [];
  let total = 0;
  data.rows.forEach((r, i) => {
    for (const p of splitValue(r[column] ?? '', mode)) {
      total++;
      if (rows.length >= max) continue;
      rows.push({ ...r, [column]: p });
      checked.push(!!data.checked[i]);
      copies.push(data.copies[i] ?? 1);
    }
  });
  return { data: { ...data, rows, checked, copies }, truncated: total - rows.length };
}

// ---------- Générateur d'emplacements ----------

export type RangeSegment =
  | { name: string; kind: 'text'; value: string }
  | { name: string; kind: 'num'; from: number; to: number; pad: number }
  | { name: string; kind: 'alpha'; from: string; to: string };

/** Valeurs d'un segment (plages croissantes ou décroissantes, au plus MAX_ROWS + 1) */
export function segmentValues(s: RangeSegment): string[] {
  if (s.kind === 'text') return [s.value];
  if (s.kind === 'num') {
    const a = Math.round(Number(s.from) || 0),
      b = Math.round(Number(s.to) || 0);
    const pad = Math.max(0, Math.min(20, Math.round(Number(s.pad) || 0)));
    const step = a <= b ? 1 : -1;
    const out: string[] = [];
    for (let v = a; step > 0 ? v <= b : v >= b; v += step) {
      out.push((v < 0 ? '-' : '') + String(Math.abs(v)).padStart(pad, '0'));
      if (out.length > MAX_ROWS) break;
    }
    return out;
  }
  const code = (x: string) => (x.trim() || 'A').toUpperCase().charCodeAt(0);
  const a = code(s.from),
    b = code(s.to);
  if (a < 65 || a > 90 || b < 65 || b > 90) return [];
  const step = a <= b ? 1 : -1;
  const out: string[] = [];
  for (let c = a; step > 0 ? c <= b : c >= b; c += step) out.push(String.fromCharCode(c));
  return out;
}

/** Nombre de combinaisons (produit cartésien) */
export function rangeCount(segments: RangeSegment[]): number {
  return segments.length ? segments.reduce((n, s) => n * segmentValues(s).length, 1) : 0;
}

/**
 * Produit cartésien des segments (le dernier varie le plus vite). Colonnes : une par
 * segment, plus « output » (défaut Emplacement) mis en forme par le modèle
 * (« {Zone}-{Allée}-{Travée}-{Niveau}{Position} » ; modèle vide = segments accolés ;
 * {Nom} inconnu laissé tel quel). Au plus « max » lignes (total = nombre de combinaisons).
 */
export function generateRanges(segments: RangeSegment[], format: string, output = 'Emplacement', max = MAX_ROWS): { columns: string[]; rows: Record<string, string>[]; total: number } {
  const names = segments.map((s, i) => s.name.trim() || `Segment ${i + 1}`);
  const seen = new Set<string>();
  const cols = names.map((n) => {
    let c = n;
    for (let k = 2; seen.has(c); k++) c = `${n}_${k}`;
    seen.add(c);
    return c;
  });
  const outBase = output.trim() || 'Emplacement';
  let out = outBase;
  for (let k = 2; seen.has(out); k++) out = `${outBase}_${k}`;
  const values = segments.map(segmentValues);
  const total = rangeCount(segments);
  const rows: Record<string, string>[] = [];
  const fmt = format.trim();
  if (total > 0) {
    const idx = values.map(() => 0);
    for (let n = 0; n < Math.min(total, max); n++) {
      const r: Record<string, string> = {};
      cols.forEach((c, i) => (r[c] = values[i][idx[i]]));
      r[out] = fmt
        ? fmt.replace(/\{([^{}]+)\}/g, (w, key: string) => {
            const i = names.indexOf(key.trim());
            return i < 0 ? w : values[i][idx[i]];
          })
        : cols.map((c) => r[c]).join('');
      rows.push(r);
      for (let i = idx.length - 1; i >= 0; i--) {
        if (++idx[i] < values[i].length) break;
        idx[i] = 0;
      }
    }
  }
  return { columns: [...cols, out], rows, total };
}

/**
 * Ajoute des lignes à un jeu de données (colonnes réunies, valeurs manquantes vides),
 * ou crée le jeu s'il n'existe pas. Limité à « max » lignes au total.
 */
export function appendRows(data: DataSet | undefined, columns: string[], rows: Record<string, string>[], source: string, max = MAX_ROWS): { data: DataSet; truncated: number } {
  const base: DataSet = data ?? { columns: [], rows: [], checked: [], copies: [], source };
  const cols = [...base.columns];
  for (const c of columns) if (!cols.includes(c)) cols.push(c);
  const room = Math.max(0, max - base.rows.length);
  const full = (r: Record<string, string>) => (cols.every((c) => c in r) ? r : Object.fromEntries(cols.map((c) => [c, r[c] ?? ''])));
  const added = rows.slice(0, room).map(full);
  return {
    data: {
      ...base,
      columns: cols,
      rows: [...base.rows.map(full), ...added],
      checked: [...base.checked, ...added.map(() => false)],
      copies: [...base.copies, ...added.map(() => 1)],
    },
    truncated: rows.length - added.length,
  };
}
