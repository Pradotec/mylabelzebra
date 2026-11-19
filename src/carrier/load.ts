/**
 * Import des étiquettes transporteur (navigateur) : fichiers multiples, .zip, détection du
 * type, conversion PDF / image → ZPL ^GFA, vignettes. Le ZPL importé reste octet pour octet
 * celui du fichier.
 */
import { decodeZplBytes, zplPageCount } from './zplText';
import { bitmapToLabelZpl, grayToLabelBitmap, mmToDots, rgbaToGray, type Gray, type Rotation } from './raster';
import { bitmapToCanvas } from '../zpl/gfa';
import { parseZpl, renderZplLabel } from '../zpl/parse';
import { uid } from '../util';

export type CarrierKind = 'zpl' | 'pdf' | 'image';

export interface CarrierItem {
  id: string;
  name: string;
  kind: CarrierKind;
  /** ZPL importé : octets d'origine (téléchargement identique) */
  raw?: Uint8Array;
  encoding?: 'utf-8' | 'latin1';
  /** sources raster */
  pdf?: Uint8Array;
  image?: Blob;
  /** pages rendues en gris, à la résolution grayDpi (PDF) ou en pixels natifs (image) */
  grays?: Gray[];
  grayDpi?: number;
  /** ZPL envoyé à l'imprimante (importé tel quel, ou produit par la conversion) */
  zpl: string;
  pages: number;
  thumb?: string;
  checked: boolean;
  error?: string;
}

export interface CarrierFormat {
  id: string;
  label: string;
  wMm: number;
  hMm: number;
}

export const CARRIER_FORMATS: CarrierFormat[] = [
  { id: '4x6', label: '4×6" (10×15 cm)', wMm: 101.6, hMm: 152.4 },
  { id: '100x150', label: '100×150 mm', wMm: 100, hMm: 150 },
  { id: 'a6', label: 'A6 (105×148 mm)', wMm: 105, hMm: 148 },
  { id: '4x8', label: '4×8"', wMm: 101.6, hMm: 203.2 },
  { id: '100x210', label: '100×210 mm', wMm: 100, hMm: 210 },
  { id: '4x4', label: '4×4"', wMm: 101.6, hMm: 101.6 },
];

export interface CarrierSettings {
  dpi: number;
  formatId: string;
  threshold: number;
  dither: boolean;
  crop: boolean;
  rotate: 'auto' | Rotation;
}

export const DEFAULT_SETTINGS: CarrierSettings = { dpi: 203, formatId: '4x6', threshold: 160, dither: false, crop: true, rotate: 'auto' };

export function formatDots(s: CarrierSettings) {
  const f = CARRIER_FORMATS.find((x) => x.id === s.formatId) ?? CARRIER_FORMATS[0];
  return { w: mmToDots(f.wMm, s.dpi), h: mmToDots(f.hMm, s.dpi) };
}

export interface InFile {
  name: string;
  bytes: Uint8Array;
}

const ZIP = /\.zip$/i;
const SUPPORTED = /\.(zpl|txt|prn|pdf|png|jpe?g|zip)$/i;

/** Type d'un fichier : extension, puis signature (PDF, PNG, JPEG) ou présence de ^XA. */
export function detectKind(name: string, bytes: Uint8Array): CarrierKind | null {
  const b = (i: number) => bytes[i];
  if (b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46) return 'pdf'; // %PDF
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return 'image'; // PNG
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image'; // JPEG
  if (/\.pdf$/i.test(name)) return 'pdf';
  if (/\.(png|jpe?g)$/i.test(name)) return 'image';
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 1 << 20)));
  if (/\^XA/i.test(head)) return 'zpl';
  return null;
}

/** Fichiers choisis / déposés → liste à plat (les .zip sont ouverts, un niveau). */
export async function expandFiles(files: File[]): Promise<{ files: InFile[]; skipped: string[] }> {
  const out: InFile[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    if (ZIP.test(f.name)) {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(await f.arrayBuffer());
      const entries = Object.values(zip.files)
        .filter((e) => !e.dir && !/(^|\/)(__MACOSX|\.)/.test(e.name))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      for (const e of entries) {
        const short = e.name.split('/').pop() || e.name;
        if (!SUPPORTED.test(short) || ZIP.test(short)) {
          skipped.push(`${f.name}/${e.name}`);
          continue;
        }
        out.push({ name: short, bytes: await e.async('uint8array') });
      }
    } else out.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  }
  return { files: out, skipped };
}

async function imageToGray(blob: Blob): Promise<Gray> {
  const bmp = await createImageBitmap(blob);
  const cv = document.createElement('canvas');
  cv.width = bmp.width;
  cv.height = bmp.height;
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.drawImage(bmp, 0, 0);
  bmp.close?.();
  return rgbaToGray(c.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
}

/** Crée l'entrée de liste d'un fichier (sans conversion raster). */
export function makeItem(f: InFile): CarrierItem | null {
  const kind = detectKind(f.name, f.bytes);
  if (!kind) return null;
  const base = { id: uid(), name: f.name, kind, checked: true };
  if (kind === 'zpl') {
    const { text, encoding } = decodeZplBytes(f.bytes);
    return { ...base, raw: f.bytes, encoding, zpl: text, pages: zplPageCount(text) };
  }
  if (kind === 'pdf') return { ...base, pdf: f.bytes, zpl: '', pages: 0 };
  const type = f.bytes[0] === 0x89 ? 'image/png' : 'image/jpeg';
  return { ...base, image: new Blob([f.bytes], { type }), zpl: '', pages: 0 };
}

/** Rend les pages sources si nécessaire (PDF : à la résolution choisie). */
async function ensureGrays(it: CarrierItem, dpi: number): Promise<Gray[]> {
  if (it.grays && (it.kind === 'image' || it.grayDpi === dpi)) return it.grays;
  if (it.kind === 'pdf') {
    const { renderPdfPages } = await import('./pdf');
    it.grays = await renderPdfPages(it.pdf!, dpi);
    it.grayDpi = dpi;
  } else it.grays = [await imageToGray(it.image!)];
  return it.grays;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** PDF / image → ZPL ^GFA (une étiquette par page) ; ZPL importé : inchangé. Modifie `it`. */
export async function convertItem(it: CarrierItem, s: CarrierSettings): Promise<void> {
  if (it.kind === 'zpl') return;
  const grays = await ensureGrays(it, s.dpi);
  const { w, h } = formatDots(s);
  const parts: string[] = [];
  let first: HTMLCanvasElement | null = null;
  for (const g of grays) {
    await tick();
    const bmp = grayToLabelBitmap(g, { widthDots: w, heightDots: h, threshold: s.threshold, dither: s.dither, crop: s.crop, rotate: s.rotate });
    if (!first) first = bitmapToCanvas(bmp);
    parts.push(bitmapToLabelZpl(bmp));
  }
  it.zpl = parts.join('');
  it.pages = grays.length;
  it.thumb = first ? thumbOf(first) : undefined;
  it.error = grays.length ? undefined : 'empty';
}

/** Vignette PNG (data URL) d'un canvas, plus grand côté = max px, fond blanc */
export function thumbOf(src: HTMLCanvasElement, max = 160): string {
  const k = Math.min(1, max / Math.max(src.width, src.height));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(src.width * k));
  cv.height = Math.max(1, Math.round(src.height * k));
  const c = cv.getContext('2d')!;
  c.fillStyle = '#fff';
  c.fillRect(0, 0, cv.width, cv.height);
  c.imageSmoothingEnabled = true;
  c.drawImage(src, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/png');
}

/**
 * Rendu des étiquettes d'un texte ZPL avec le parseur interne (aperçu, vignette).
 * Taille : ^PW / ^LL de l'étiquette, sinon le format choisi.
 */
export async function renderZplPages(zpl: string, fallbackW: number, fallbackH: number, max = Infinity): Promise<HTMLCanvasElement[]> {
  const labels = await parseZpl(zpl);
  return labels.slice(0, max).map((l) => renderZplLabel(l, l.width || fallbackW, l.height || fallbackH));
}

/** Vignette d'une entrée ZPL importée */
export async function zplThumb(it: CarrierItem, s: CarrierSettings): Promise<void> {
  if (it.kind !== 'zpl') return;
  const { w, h } = formatDots(s);
  try {
    const [cv] = await renderZplPages(it.zpl, w, h, 1);
    it.thumb = cv ? thumbOf(cv) : undefined;
  } catch {
    it.thumb = undefined;
  }
}

/** Octets à envoyer / télécharger pour une entrée : fichier d'origine pour le ZPL importé. */
export function itemBytes(it: CarrierItem): Uint8Array {
  if (it.kind === 'zpl' && it.raw) return it.raw;
  return new TextEncoder().encode(it.zpl);
}
