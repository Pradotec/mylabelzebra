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
