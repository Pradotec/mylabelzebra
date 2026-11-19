import { useStore } from './store';
import type { LabelDoc, LabelElement, SavedLabel, Symbology, TextEl } from './types';
import { BASE_DPI } from './types';
import { makeBarcode, makeImage, makeQr, makeShape, makeTable, makeText, newDoc } from './elements';
import { fileToDataUrl, loadImage } from './render/images';
import { kvGet, kvSet } from './storage';
import { thumbnail, jsonToDoc } from './export';
import { uid, deepClone } from './util';
import { t } from './i18n';
import { docUsesSerial } from './render/resolve';
import * as zebra from './zebra';

const S = () => useStore.getState();

export function addText(text?: string, extra?: Partial<TextEl>) {
  const s = S();
  s.addElements([makeText(s.doc, text, extra)]);
}
export function addBarcode(sym: Symbology = 'code128', value?: string) {
  const s = S();
  s.addElements([makeBarcode(s.doc, sym, value)]);
}
export function addQr(value?: string) {
  const s = S();
  s.addElements([makeQr(s.doc, value)]);
}
export function addShape(kind: string) {
  const s = S();
  s.addElements([makeShape(s.doc, kind)]);
}
export function addTable(rows = 3, cols = 3) {
  const s = S();
  s.addElements([makeTable(s.doc, rows, cols)]);
}

export async function addImageSrc(src: string) {
  try {
    const img = await loadImage(src);
    const s = S();
    s.addElements([makeImage(s.doc, src, img.naturalWidth || 200, img.naturalHeight || 200)]);
  } catch {
    S().toast(t('Image illisible'), 'error');
  }
}

export async function addImageFile(file: File | Blob) {
  if (!/^image\//.test(file.type)) {
    S().toast(t('Format non pris en charge (PNG, JPG, GIF, SVG)'), 'error');
    return;
  }
  const src = await fileToDataUrl(file as File);
  await addImageSrc(src);
}

/** Insère un champ {{…}} dans l'élément sélectionné, ou crée un texte. */
export function insertToken(token: string) {
  const s = S();
  const sel = s.doc.elements.filter((e) => s.selected.includes(e.id));
  const el = sel.length === 1 ? sel[0] : undefined;
  if (!el) {
    // champ de données : une ligne, la police se réduit si la valeur est longue
    const fs = Math.max(14, Math.round(Math.min(s.doc.heightIn, s.doc.widthIn) * 203 * 0.12));
    addText(token, { fit: 'shrinkLine', h: fs * 1.15 });
    return;
  }
  if (el.type === 'text') s.updateEls([el.id], { text: el.text ? el.text + (el.text.endsWith(' ') || el.text.endsWith('\n') ? '' : ' ') + token : token });
  else if (el.type === 'barcode') s.updateEls([el.id], { value: token });
  else if (el.type === 'qr') s.updateEls([el.id], { value: token, qrType: 'text' } as Partial<LabelElement>);
  else if (el.type === 'table') {
    const cells = el.cells.map((r) => [...r]);
    let done = false;
    for (let r = el.headerRow ? 1 : 0; r < el.rows && !done; r++)
      for (let c = 0; c < el.cols && !done; c++)
        if (!cells[r][c]) {
          cells[r][c] = token;
          done = true;
        }
    if (!done) cells[el.rows - 1][el.cols - 1] += ' ' + token;
    s.updateEls([el.id], { cells } as Partial<LabelElement>);
  } else addText(token, { fit: 'shrinkLine' });
}

// ---------- Mes étiquettes ----------
export const MAX_SAVED = 50;

export async function listSaved(): Promise<SavedLabel[]> {
  const list = (await kvGet<SavedLabel[]>('saved')) || [];
  return list.sort((a, b) => b.savedAt - a.savedAt);
}

export async function saveCurrent(): Promise<boolean> {
  const s = S();
  const list = await listSaved();
  const doc = { ...s.doc, updatedAt: Date.now() };
  const i = list.findIndex((x) => x.doc.id === doc.id);
  if (i < 0 && list.length >= MAX_SAVED) {
    s.toast(t('Limite de {n} étiquettes atteinte : supprimez-en une dans « Mes étiquettes ».', { n: MAX_SAVED }), 'error');
    return false;
  }
  const entry: SavedLabel = { doc, thumb: thumbnail(doc), savedAt: Date.now() };
  if (i >= 0) list[i] = entry;
  else list.unshift(entry);
  await kvSet('saved', list);
  useStore.setState({ dirty: false, savedVersion: s.savedVersion + 1 });
  s.toast(t('Étiquette enregistrée'), 'ok');
  return true;
}

export async function deleteSaved(id: string) {
  const list = (await listSaved()).filter((x) => x.doc.id !== id);
  await kvSet('saved', list);
}
export async function renameSaved(id: string, name: string) {
  const list = await listSaved();
  const e = list.find((x) => x.doc.id === id);
  if (e) e.doc = { ...e.doc, name };
  await kvSet('saved', list);
  const s = S();
  if (s.doc.id === id) useStore.setState({ doc: { ...s.doc, name } });
}
export async function duplicateSaved(id: string) {
  const list = await listSaved();
  if (list.length >= MAX_SAVED) {
    S().toast(t('Limite de {n} étiquettes atteinte : supprimez-en une dans « Mes étiquettes ».', { n: MAX_SAVED }), 'error');
    return;
  }
  const e = list.find((x) => x.doc.id === id);
  if (!e) return;
  const copy: SavedLabel = { doc: { ...deepClone(e.doc), id: uid(), name: e.doc.name + ' ' + t('(copie)') }, thumb: e.thumb, savedAt: Date.now() };
  list.unshift(copy);
  await kvSet('saved', list);
}

export function confirmDiscard(): boolean {
  const s = S();
  if (!s.doc.elements.length) return true;
  return window.confirm(t('Remplacer l’étiquette actuelle ? Les modifications non enregistrées dans « Mes étiquettes » seront perdues (annulable avec Ctrl+Z).'));
}

export function newLabel() {
  if (!confirmDiscard()) return;
  const s = S();
  s.loadDoc(newDoc({ widthIn: s.doc.widthIn, heightIn: s.doc.heightIn, dpi: s.doc.dpi, round: s.doc.round }), true);
}

export async function importJsonText(text: string) {
  try {
    const doc = jsonToDoc(text);
    doc.id = uid();
    S().loadDoc(doc, true);
    S().toast(t('Étiquette importée'), 'ok');
  } catch (e) {
    S().toast((e as Error).message || t('Fichier d’étiquette invalide'), 'error');
  }
}

// ---------- Taille ----------
/**
 * Que faire du contenu quand la taille de l'étiquette change :
 * - 'scale' : tout est mis à l'échelle proportionnellement et recentré ;
 * - 'keep'  : taille conservée, les éléments sont seulement ramenés dans l'étiquette.
 */
export type ResizeMode = 'scale' | 'keep';
const RESIZE_KEY = 'mlz.resizeMode';
export function getResizeMode(): ResizeMode {
  try {
    return localStorage.getItem(RESIZE_KEY) === 'keep' ? 'keep' : 'scale';
  } catch {
    return 'scale';
  }
}
export function setResizeMode(m: ResizeMode) {
  try {
    localStorage.setItem(RESIZE_KEY, m);
  } catch {
    /* stockage indisponible */
  }
}

// La saisie d'une taille personnalisée applique chaque frappe : on repart donc
// toujours de l'état d'origine tant que rien d'autre n'a été modifié, sinon
// « 4 → 1 → 12 » réduirait le contenu de façon cumulative.
let resizeBase: { docId: string; w: number; h: number; elements: LabelElement[]; guides: LabelDoc['guides']; out: LabelElement[] } | null = null;

function scaleElement(e: LabelElement, s: number, dx: number, dy: number): LabelElement {
  const n = { ...e, x: e.x * s + dx, y: e.y * s + dy, w: e.w * s, h: e.h * s } as LabelElement;
  switch (n.type) {
    case 'text':
      n.fontSize *= s;
      if (n.minFontSize) n.minFontSize *= s;
      break;
    case 'barcode':
      n.fontSize *= s;
      break;
    case 'table':
      n.fontSize *= s;
      n.strokeWidth *= s;
      break;
    case 'shape':
      n.strokeWidth *= s;
      if (n.radius) n.radius *= s;
      break;
  }
  return n;
}

function clampElement(e: LabelElement, W: number, H: number): LabelElement {
  const x = Math.max(0, Math.min(e.x, W - e.w));
  const y = Math.max(0, Math.min(e.y, H - e.h));
  return x === e.x && y === e.y ? e : { ...e, x, y };
}

export function setLabelSize(w: number, h: number, round = false) {
  const cur = S().doc;
  const nw = Math.max(0.25, Math.min(40, w));
  const nh = Math.max(0.25, Math.min(40, h));
  if (!resizeBase || resizeBase.docId !== cur.id || resizeBase.out !== cur.elements)
    resizeBase = { docId: cur.id, w: cur.widthIn, h: cur.heightIn, elements: cur.elements, guides: cur.guides, out: cur.elements };
  const base = resizeBase;
  const mode = getResizeMode();
  const W0 = base.w * BASE_DPI,
    H0 = base.h * BASE_DPI,
    W1 = nw * BASE_DPI,
    H1 = nh * BASE_DPI;
  let elements: LabelElement[];
  let guides = base.guides;
  if (mode === 'scale') {
    const s = Math.min(W1 / W0, H1 / H0);
    const dx = (W1 - W0 * s) / 2,
      dy = (H1 - H0 * s) / 2;
    elements = base.elements.map((e) => scaleElement(e, s, dx, dy));
    guides = { x: base.guides.x.map((g) => g * s + dx), y: base.guides.y.map((g) => g * s + dy) };
  } else {
    elements = base.elements.map((e) => clampElement(e, W1, H1));
  }
  S().setDoc((d) => {
    d.widthIn = nw;
    d.heightIn = nh;
    d.round = round;
    d.zoom = undefined;
    d.elements = elements;
    d.guides = guides;
  }, 'label-size');
  base.out = S().doc.elements;
  useStore.setState((st) => ({ fitRequest: st.fitRequest + 1 }));
}

// ---------- Zebra ----------
export async function sendToZebra(zpl: string, advanceSerial = true): Promise<boolean> {
  const s = S();
  let dev = zebra.lastPrinter();
  try {
    if (!dev) dev = await zebra.getDefaultPrinter();
    if (!dev) {
      s.toast(t('Aucune imprimante Zebra sélectionnée.'), 'error');
      s.set('modal', 'zebra');
      return false;
    }
    const saved = zebra.savedSettings(dev);
    const pre = zebra.settingsZpl({ darkness: saved.darkness, speed: saved.speed });
    await zebra.write(dev, pre + zpl);
    s.toast(t('Envoyé à {p}', { p: dev.name }), 'ok');
    const doc = s.doc;
    if (advanceSerial && docUsesSerial(doc) && !(doc.data && doc.data.rows.length)) {
      const n = Math.min(500, Math.max(1, doc.numbering.count));
      s.setDoc((d) => {
        d.numbering = { ...d.numbering, start: d.numbering.start + n * d.numbering.step };
      });
      s.toast(t('Numérotation : prochain départ à {n}', { n: doc.numbering.start + n * doc.numbering.step }));
    }
    return true;
  } catch (e) {
    if (e instanceof zebra.BrowserPrintMissing || (e as Error).name === 'TypeError' || (e as Error).name === 'AbortError') {
      s.toast(t('Zebra Browser Print est introuvable. Installez-le puis réessayez.'), 'error');
      s.set('modal', 'zebra');
    } else s.toast(t('Erreur d’impression : {m}', { m: (e as Error).message }), 'error');
    return false;
  }
}

export function labelDots(doc: LabelDoc) {
  return { w: Math.round(doc.widthIn * doc.dpi), h: Math.round(doc.heightIn * doc.dpi), u: BASE_DPI };
}
