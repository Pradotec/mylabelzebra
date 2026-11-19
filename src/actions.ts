import { useStore } from './store';
import type { LabelDoc, LabelElement, SavedLabel, Symbology, TextEl, MarkKind, MarkEl } from './types';
import { BASE_DPI } from './types';
import { makeBarcode, makeImage, makeQr, makeShape, makeTable, makeText, makeMark, newDoc } from './elements';
import { fileToDataUrl, loadImage } from './render/images';
import { kvGet, kvSet, storageErrorMessage } from './storage';
import { thumbnail, jsonToDoc } from './export';
import { uid, deepClone } from './util';
import { t } from './i18n';
import { docUsesSerial, serialNextStart, serialDigits } from './render/resolve';
import { elementBounds, elementHeight, hasFixedHeight } from './render/draw';
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
/** Estampille sanitaire ovale (« health ») ou signe ℮ (« estimated ») */
export function addMark(kind: MarkKind, extra?: Partial<MarkEl>) {
  const s = S();
  s.addElements([makeMark(s.doc, kind, extra)]);
}
export const addHealthMark = () => addMark('health');
export const addEstimatedSign = () => addMark('estimated');

export async function addImageSrc(src: string, extra: Partial<LabelElement> = {}) {
  try {
    const img = await loadImage(src);
    const s = S();
    s.addElements([{ ...makeImage(s.doc, src, img.naturalWidth || 200, img.naturalHeight || 200), ...extra } as LabelElement]);
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
  try {
    await kvSet('saved', list);
  } catch (e) {
    s.toast(storageErrorMessage(e), 'error');
    return false;
  }
  useStore.setState({ dirty: false, savedVersion: s.savedVersion + 1 });
  s.toast(t('Étiquette enregistrée'), 'ok');
  return true;
}

/** Écrit la liste « Mes étiquettes » ; en cas d'échec (quota…), message et false */
async function writeSaved(list: SavedLabel[]): Promise<boolean> {
  try {
    await kvSet('saved', list);
    return true;
  } catch (e) {
    S().toast(storageErrorMessage(e), 'error');
    return false;
  }
}

export async function deleteSaved(id: string): Promise<boolean> {
  const list = (await listSaved()).filter((x) => x.doc.id !== id);
  return writeSaved(list);
}
export async function renameSaved(id: string, name: string): Promise<boolean> {
  const list = await listSaved();
  const e = list.find((x) => x.doc.id === id);
  if (e) e.doc = { ...e.doc, name };
  if (!(await writeSaved(list))) return false;
  const s = S();
  if (s.doc.id === id) useStore.setState({ doc: { ...s.doc, name } });
  return true;
}
export async function duplicateSaved(id: string): Promise<boolean> {
  const list = await listSaved();
  if (list.length >= MAX_SAVED) {
    S().toast(t('Limite de {n} étiquettes atteinte : supprimez-en une dans « Mes étiquettes ».', { n: MAX_SAVED }), 'error');
    return false;
  }
  const e = list.find((x) => x.doc.id === id);
  if (!e) return false;
  const copy: SavedLabel = { doc: { ...deepClone(e.doc), id: uid(), name: e.doc.name + ' ' + t('(copie)') }, thumb: e.thumb, savedAt: Date.now() };
  list.unshift(copy);
  return writeSaved(list);
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
    case 'mark':
      n.strokeWidth *= s;
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
      // même calcul que l'aperçu : pas, répétition (même numéro sur N étiquettes), base 36
      const next = serialNextStart(doc.numbering, n);
      s.setDoc((d) => {
        d.numbering = { ...d.numbering, start: next };
      });
      s.toast(t('Numérotation : prochain départ à {n}', { n: (next < 0 ? '-' : '') + serialDigits(next, doc.numbering.alpha) }));
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

// ---------- Répartir / uniformiser ----------
type Box = { x: number; y: number; w: number; h: number };

/**
 * Répartition à espacement égal (≥ 3 éléments) : les deux éléments extrêmes restent en
 * place, les autres sont déplacés pour que l'écart entre boîtes englobantes soit constant.
 * Les éléments verrouillés ne bougent pas mais comptent dans la répartition.
 * Renvoie les nouvelles positions x (axe 'h') ou y (axe 'v') par id.
 */
export function distributePatches(els: LabelElement[], axis: 'h' | 'v', boxOf: (el: LabelElement) => Box): Map<string, Partial<LabelElement>> {
  const out = new Map<string, Partial<LabelElement>>();
  if (els.length < 3) return out;
  const items = els.map((e) => ({ e, b: boxOf(e) }));
  const pos = (b: Box) => (axis === 'h' ? b.x : b.y);
  const size = (b: Box) => (axis === 'h' ? b.w : b.h);
  items.sort((a, b) => pos(a.b) + size(a.b) / 2 - (pos(b.b) + size(b.b) / 2));
  const first = items[0].b;
  const last = items[items.length - 1].b;
  const span = pos(last) + size(last) - pos(first);
  const total = items.reduce((a, it) => a + size(it.b), 0);
  const gap = (span - total) / (items.length - 1);
  let cur = pos(first) + size(first) + gap;
  for (let i = 1; i < items.length - 1; i++) {
    const { e, b } = items[i];
    const d = cur - pos(b);
    if (!e.locked && Math.abs(d) > 1e-9) out.set(e.id, axis === 'h' ? { x: e.x + d } : { y: e.y + d });
    cur += size(b) + gap;
  }
  return out;
}

/**
 * Même largeur / même hauteur (≥ 2 éléments) que l'élément de référence (le premier
 * sélectionné). Les textes à hauteur automatique gardent leur hauteur ; verrouillés ignorés.
 */
export function sameSizePatches(els: LabelElement[], dim: 'w' | 'h', ref: LabelElement): Map<string, Partial<LabelElement>> {
  const out = new Map<string, Partial<LabelElement>>();
  if (els.length < 2) return out;
  for (const e of els) {
    if (e.id === ref.id || e.locked) continue;
    if (dim === 'h' && e.type === 'text' && !hasFixedHeight(e)) continue;
    if (e[dim] !== ref[dim]) out.set(e.id, { [dim]: ref[dim] } as Partial<LabelElement>);
  }
  return out;
}

const selCtx = () => {
  const s = S();
  return { doc: s.doc, index: s.previewRow, row: s.doc.data?.rows[s.previewRow], resolve: true };
};
/** éléments sélectionnés, dans l'ordre de sélection */
function selectedEls() {
  const s = S();
  return s.selected.map((id) => s.doc.elements.find((e) => e.id === id)).filter((e): e is LabelElement => !!e && !e.hidden);
}
function applyPatches(p: Map<string, Partial<LabelElement>>) {
  if (!p.size) return;
  // une seule entrée d'historique (annulable en une fois)
  S().updateEls(Array.from(p.keys()), (e) => p.get(e.id) ?? {});
}

/** Répartir horizontalement / verticalement les éléments sélectionnés */
export function distributeSelected(axis: 'h' | 'v') {
  const ctx = selCtx();
  applyPatches(distributePatches(selectedEls(), axis, (e) => elementBounds(e, elementHeight(e, ctx))));
}

/** Même largeur / hauteur que le premier élément sélectionné */
export function sameSizeSelected(dim: 'w' | 'h') {
  const els = selectedEls();
  if (els.length < 2) return;
  applyPatches(sameSizePatches(els, dim, els[0]));
}

export function labelDots(doc: LabelDoc) {
  return { w: Math.round(doc.widthIn * doc.dpi), h: Math.round(doc.heightIn * doc.dpi), u: BASE_DPI };
}
