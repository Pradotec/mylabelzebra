import Papa from 'papaparse';
import type { DataSet } from './types';

function toDataSet(rows: string[][], source: string): DataSet {
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
  const body = clean.slice(1, 5001).map((r) => Object.fromEntries(columns.map((c, i) => [c, String(r[i] ?? '').trim()])));
  return { columns, rows: body, checked: body.map(() => false), copies: body.map(() => 1), source };
}

/** CSV / TSV (séparateur détecté automatiquement, guillemets gérés) */
export function parseDelimited(text: string, source = 'collé'): DataSet {
  const t = text.replace(/^﻿/, '');
  const firstLine = t.split(/\r?\n/)[0] || '';
  const delimiter = firstLine.includes('\t') ? '\t' : undefined;
  const res = Papa.parse<string[]>(t, { delimiter, skipEmptyLines: 'greedy' });
  return toDataSet(res.data as string[][], source);
}

export async function parseFile(file: File): Promise<DataSet> {
  const name = file.name.toLowerCase();
  if (/\.(xlsx|xlsm|xls|ods)$/.test(name)) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '' });
    return toDataSet(rows as string[][], file.name);
  }
  return parseDelimited(await file.text(), file.name);
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
