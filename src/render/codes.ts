import bwipjs from 'bwip-js';
import type { QrLevel, Symbology, QrEl } from '../types';
import { t } from '../i18n';

export const SYMBOLOGIES: { id: Symbology; label: string; hint: string; sample: string; twoD?: boolean }[] = [
  { id: 'code128', label: 'CODE 128', hint: 'Texte et chiffres', sample: 'ABC-12345' },
  { id: 'gs1-128', label: 'GS1-128', hint: 'Identifiants entre parenthèses : (01)…(17)…', sample: '(01)09501101530003(17)261231' },
  { id: 'ean13', label: 'EAN-13', hint: '12 chiffres (+ clé calculée)', sample: '590123412345' },
  { id: 'ean8', label: 'EAN-8', hint: '7 chiffres (+ clé calculée)', sample: '9638507' },
  { id: 'upca', label: 'UPC-A', hint: '11 chiffres (+ clé calculée)', sample: '03600029145' },
  { id: 'upce', label: 'UPC-E', hint: '7 chiffres commençant par 0 ou 1', sample: '0123456' },
  { id: 'code39', label: 'CODE 39', hint: 'Majuscules, chiffres, espace - . $ / + %', sample: 'CODE39' },
  { id: 'code93', label: 'CODE 93', hint: 'Majuscules, chiffres, espace - . $ / + %', sample: 'CODE93' },
  { id: 'interleaved2of5', label: 'ITF (2/5 entrelacé)', hint: 'Nombre pair de chiffres', sample: '12345670' },
  { id: 'sscc18', label: 'SSCC-18', hint: '17 chiffres : la clé est ajoutée automatiquement', sample: '00614141000000001' },
  { id: 'rationalizedCodabar', label: 'Codabar', hint: 'A…B autour de chiffres et - $ : / . +', sample: 'A123456B' },
  { id: 'datamatrix', label: 'Data Matrix', hint: 'Texte libre (2D)', sample: 'MyLabelZebra', twoD: true },
];

export const is2D = (s: Symbology) => s === 'datamatrix';

export interface LinearCode {
  kind: 'linear';
  /** largeurs alternées barre/espace, en modules (commence par une barre) */
  sbs: number[];
  modules: number;
  text: string;
  error?: undefined;
}
export interface MatrixCode {
  kind: 'matrix';
  cols: number;
  rows: number;
  get(r: number, c: number): boolean;
  error?: undefined;
}
export interface CodeError {
  error: string;
}
export type Encoded = LinearCode | MatrixCode | CodeError;

/** clé de contrôle GS1 (modulo 10) */
export function gs1Check(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const d = +digits[digits.length - 1 - i];
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (sum % 10)) % 10;
}

/** Normalise la saisie et renvoie [texte pour bwip, texte lisible] ou une erreur. */
export function normalizeBarcode(value: string, s: Symbology): { data: string; human: string } | CodeError {
  const v = value.trim();
  const digits = /^\d+$/.test(v);
  const bad = (msg: string) => ({ error: msg });
  switch (s) {
    case 'ean13':
      if (!digits || (v.length !== 12 && v.length !== 13)) return bad(t('EAN-13 invalide : 12 ou 13 chiffres'));
      if (v.length === 13 && gs1Check(v.slice(0, 12)) !== +v[12]) return bad(t('EAN-13 : clé de contrôle incorrecte'));
      return { data: v.slice(0, 12) + gs1Check(v.slice(0, 12)), human: v.slice(0, 12) + gs1Check(v.slice(0, 12)) };
    case 'ean8':
      if (!digits || (v.length !== 7 && v.length !== 8)) return bad(t('EAN-8 invalide : 7 ou 8 chiffres'));
      if (v.length === 8 && gs1Check(v.slice(0, 7)) !== +v[7]) return bad(t('EAN-8 : clé de contrôle incorrecte'));
      return { data: v.slice(0, 7) + gs1Check(v.slice(0, 7)), human: v.slice(0, 7) + gs1Check(v.slice(0, 7)) };
    case 'upca':
      if (!digits || (v.length !== 11 && v.length !== 12)) return bad(t('UPC invalide : 11 ou 12 chiffres'));
      if (v.length === 12 && gs1Check(v.slice(0, 11)) !== +v[11]) return bad(t('UPC : clé de contrôle incorrecte'));
      return { data: v.slice(0, 11) + gs1Check(v.slice(0, 11)), human: v.slice(0, 11) + gs1Check(v.slice(0, 11)) };
    case 'upce':
      if (!digits || v.length < 7 || v.length > 8 || (v[0] !== '0' && v[0] !== '1')) return bad(t('UPC-E invalide : 7 chiffres commençant par 0 ou 1'));
      return { data: v.slice(0, 7), human: v };
    case 'interleaved2of5':
      if (!digits) return bad(t('ITF invalide : chiffres uniquement'));
      if (v.length % 2) return bad(t('ITF : nombre pair de chiffres requis'));
      return { data: v, human: v };
    case 'sscc18': {
      const d = v.replace(/^\(00\)/, '').replace(/\s/g, '');
      if (!/^\d+$/.test(d) || (d.length !== 17 && d.length !== 18)) return bad(t('SSCC invalide : 17 chiffres'));
      const full = d.slice(0, 17) + gs1Check(d.slice(0, 17));
      if (d.length === 18 && full !== d) return bad(t('SSCC : clé de contrôle incorrecte'));
      return { data: '(00)' + full, human: '(00) ' + full };
    }
    case 'code39':
    case 'code93':
      if (!/^[0-9A-Z \-.$/+%]+$/.test(v.toUpperCase())) return bad(t('Caractère non autorisé en {s}', { s: s.toUpperCase() }));
      return { data: v.toUpperCase(), human: v.toUpperCase() };
    case 'rationalizedCodabar': {
      let d = v.toUpperCase();
      if (!/^[A-D]/.test(d)) d = 'A' + d;
      if (!/[A-D]$/.test(d)) d = d + 'B';
      if (!/^[A-D][0-9\-$:/.+]*[A-D]$/.test(d)) return bad(t('Codabar invalide'));
      return { data: d, human: d };
    }
    case 'gs1-128':
      if (!/^(\(\d{2,4}\)[^()]+)+$/.test(v)) return bad(t('GS1-128 : format (AI)valeur, ex. (01)…'));
      return { data: v, human: v };
    default:
      return { data: v, human: v };
  }
}

const cache = new Map<string, Encoded>();

export function encodeBarcode(value: string, s: Symbology): Encoded {
  const key = s + '\u0000' + value;
  const hit = cache.get(key);
  if (hit) return hit;
  let res: Encoded;
  if (!value) res = { error: t('Valeur vide') };
  else {
    const n = normalizeBarcode(value, s);
    if ('error' in n) res = n as CodeError;
    else {
      try {
        const raw = bwipjs.raw(s, n.data, {}) as unknown as Array<
          { sbs: number[]; bhs: number[] } & { pixs: number[]; pixx: number; pixy: number }
        >;
        const r = raw[0];
        if (r.pixs) {
          const { pixs, pixx, pixy } = r;
          res = { kind: 'matrix', cols: pixx, rows: pixy, get: (y, x) => pixs[y * pixx + x] === 1 };
        } else {
          res = { kind: 'linear', sbs: r.sbs, modules: r.sbs.reduce((a, b) => a + b, 0), text: n.human };
        }
      } catch (e) {
        res = { error: t('Valeur invalide pour {s}', { s: SYMBOLOGIES.find((x) => x.id === s)?.label ?? s }) };
      }
    }
  }
  if (cache.size > 600) cache.clear();
  cache.set(key, res);
  return res;
}

export function encodeQr(value: string, level: QrLevel): MatrixCode | CodeError {
  const key = 'qr' + level + '\u0000' + value;
  const hit = cache.get(key);
  if (hit) return hit as MatrixCode | CodeError;
  let res: MatrixCode | CodeError;
  if (!value) res = { error: t('Valeur vide') };
  else {
    try {
      const r = bwipjs.raw('qrcode', value, { eclevel: level } as never)[0] as unknown as {
        pixs: number[];
        pixx: number;
        pixy: number;
      };
      res = { kind: 'matrix', cols: r.pixx, rows: r.pixy, get: (y, x) => r.pixs[y * r.pixx + x] === 1 };
    } catch {
      res = { error: t('Texte trop long pour un QR code') };
    }
  }
  if (cache.size > 600) cache.clear();
  cache.set(key, res);
  return res;
}

const esc = (s: string) => s.replace(/([\\;,:"])/g, '\\$1');

/** Contenu brut du QR (avant résolution des {{champs}}) */
export function qrPayload(el: QrEl): string {
  if (el.qrType === 'wifi' && el.wifi) {
    const w = el.wifi;
    return `WIFI:T:${w.enc};S:${esc(w.ssid)};${w.enc !== 'nopass' ? `P:${esc(w.password)};` : ''}${w.hidden ? 'H:true;' : ''};`;
  }
  if (el.qrType === 'vcard' && el.vcard) {
    const v = el.vcard;
    const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${v.lastName};${v.firstName};;;`, `FN:${[v.firstName, v.lastName].filter(Boolean).join(' ')}`];
    if (v.org) lines.push(`ORG:${v.org}`);
    if (v.title) lines.push(`TITLE:${v.title}`);
    if (v.phone) lines.push(`TEL;TYPE=CELL:${v.phone}`);
    if (v.email) lines.push(`EMAIL:${v.email}`);
    if (v.url) lines.push(`URL:${v.url}`);
    if (v.address) lines.push(`ADR:;;${v.address};;;;`);
    lines.push('END:VCARD');
    return lines.join('\n');
  }
  return el.value;
}
