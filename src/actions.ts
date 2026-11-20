import { useStore } from './store';
import type { LabelDoc, LabelElement, SavedLabel, Symbology, TextEl, MarkKind, MarkEl } from './types';
import { BASE_DPI } from './types';
import { makeBarcode, makeImage, makeQr, makeShape, makeTable, makeText, makeMark, newDoc } from './elements';
import { fileToDataUrl, loadImage } from './render/images';
import { kvGet, kvSet, storageErrorMessage, prefGet, prefSet } from './storage';
import { thumbnail, jsonToDocWithWarnings } from './export';
import { migrationWarningText } from './migrate';
import { uid, deepClone } from './util';
import { t } from './i18n';
import { docUsesSerial, docUsesSscc, serialNextStart, serialDigits, type PrintJob } from './render/resolve';
import { elementBounds, elementHeight, hasFixedHeight, rollColumns } from './render/draw';
import { generateJobsZpl } from './zpl/generate';
import { CancelledError, isCancelled } from './progress';
import type { QueueCtl } from './printQueue';
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
    const { doc, warnings } = jsonToDocWithWarnings(text);
    doc.id = uid();
    S().loadDoc(doc, true);
    S().toast(t('Étiquette importée'), 'ok');
    for (const w of warnings) S().toast(migrationWarningText(w), 'error');
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
const isBrowserPrintDown = (e: unknown) => e instanceof zebra.BrowserPrintMissing || (e as Error)?.name === 'TypeError' || (e as Error)?.name === 'AbortError';

/** Imprimante à utiliser ; null (avec message et fenêtre Zebra ouverte) si aucune */
async function zebraDevice(): Promise<zebra.ZebraDevice | null> {
  const s = S();
  try {
    const dev = zebra.lastPrinter() ?? (await zebra.getDefaultPrinter());
    if (dev) return dev;
    s.toast(t('Aucune imprimante Zebra sélectionnée.'), 'error');
  } catch (e) {
    if (!isBrowserPrintDown(e)) throw e;
    s.toast(t('Zebra Browser Print est introuvable. Installez-le puis réessayez.'), 'error');
  }
  s.set('modal', 'zebra');
  return null;
}

/** Message (traduit) d'une imprimante pas prête ou d'un état illisible */
export function readinessMessage(r: zebra.Readiness): string {
  if (r.state === 'notReady') return t('Imprimante pas prête : {p}', { p: r.problems.map((p) => t(p)).join(', ') });
  if (r.state === 'unknown') return t('État de l’imprimante illisible : Browser Print n’a pas renvoyé de réponse à ~HS.');
  return '';
}

/** Avance le départ de la numérotation de l'éditeur après l'envoi de `n` étiquettes numérotées */
function advanceNumbering(doc: LabelDoc, n: number) {
  const s = S();
  // seulement si l'éditeur montre toujours le document du travail
  if (s.doc.id !== doc.id || n <= 0) return;
  const cur = s.doc;
  if (!docUsesSerial(cur) || (cur.data && cur.data.rows.length)) return;
  // même calcul que l'aperçu : pas, répétition (même numéro sur N étiquettes), base 36
  const next = serialNextStart(cur.numbering, n);
  s.setDoc((d) => {
    d.numbering = { ...d.numbering, start: next };
  });
  s.toast(t('Numérotation : prochain départ à {n}', { n: (next < 0 ? '-' : '') + serialDigits(next, cur.numbering.alpha) }));
}

/**
 * Envoi d'un programme ZPL déjà prêt (visionneuse ZPL) : vérification de l'état avant
 * l'envoi, mais pas de découpage (le code est envoyé tel quel).
 */
export async function sendToZebra(zpl: string, advanceSerial = true): Promise<boolean> {
  const s = S();
  try {
    const dev = await zebraDevice();
    if (!dev) return false;
    const r = await zebra.checkReady(dev);
    if (r.state === 'notReady') {
      s.toast(readinessMessage(r), 'error');
      return false;
    }
    if (r.state === 'unknown' && !window.confirm(readinessMessage(r) + '\n\n' + t('Envoyer quand même ?'))) return false;
    const saved = zebra.savedSettings(dev);
    const pre = zebra.settingsZpl({ darkness: saved.darkness, speed: saved.speed });
    await zebra.write(dev, pre + zpl, Math.max(20000, Math.ceil(zpl.length / 20000) * 1000));
    s.toast(t('Envoyé à {p}', { p: dev.name }), 'ok');
    if (advanceSerial) advanceNumbering(s.doc, Math.min(500, Math.max(1, s.doc.numbering.count)));
    return true;
  } catch (e) {
    if (isBrowserPrintDown(e)) {
      s.toast(t('Zebra Browser Print est introuvable. Installez-le puis réessayez.'), 'error');
      s.set('modal', 'zebra');
    } else s.toast(t('Erreur d’impression : {m}', { m: (e as Error).message }), 'error');
    return false;
  }
}

/** Taille des paquets envoyés à l'imprimante (étiquettes), réglable et mémorisée */
export const DEFAULT_CHUNK = 50;
const CHUNK_KEY = 'zebra.chunk';
export const getChunkSize = () => {
  const v = Math.round(Number(prefGet<number>(CHUNK_KEY, DEFAULT_CHUNK)));
  return Number.isFinite(v) && v >= 1 ? Math.min(1000, v) : DEFAULT_CHUNK;
};
export const setChunkSize = (n: number) => prefSet(CHUNK_KEY, Math.max(1, Math.min(1000, Math.round(n) || DEFAULT_CHUNK)));

export const labelCount = (jobs: PrintJob[]) => jobs.reduce((a, j) => a + j.copies, 0);

/**
 * Découpe un travail en paquets d'au plus `size` étiquettes, dans l'ordre. Une ligne dont
 * les copies dépassent la place restante est coupée (copies réparties sur deux paquets),
 * sauf si `splitCopies` est faux (SSCC : les copies d'une étiquette restent ensemble).
 */
export function splitChunks(jobs: PrintJob[], size: number, splitCopies = true): PrintJob[][] {
  const max = Math.max(1, Math.floor(size));
  const out: PrintJob[][] = [];
  let cur: PrintJob[] = [];
  let n = 0;
  const flush = () => {
    if (cur.length) out.push(cur);
    cur = [];
    n = 0;
  };
  for (const j of jobs) {
    let left = Math.max(1, j.copies);
    while (left > 0) {
      const room = max - n;
      if (!splitCopies) {
        if (n && left > room) flush();
        cur.push({ index: j.index, copies: left });
        n += left;
        left = 0;
        if (n >= max) flush();
        continue;
      }
      const take = Math.min(left, room);
      cur.push({ index: j.index, copies: take });
      n += take;
      left -= take;
      if (n >= max) flush();
    }
  }
  flush();
  return out;
}

/** Retire les `skip` premières étiquettes d'un travail (copies comprises) */
export function skipLabels(jobs: PrintJob[], skip: number): PrintJob[] {
  let rest = Math.max(0, Math.floor(skip));
  const out: PrintJob[] = [];
  for (const j of jobs) {
    if (rest >= j.copies) {
      rest -= j.copies;
      continue;
    }
    out.push({ index: j.index, copies: j.copies - rest });
    rest = 0;
  }
  return out;
}

/** Regroupe les entrées consécutives d'une même étiquette (copies additionnées) */
export function mergeJobs(jobs: PrintJob[]): PrintJob[] {
  const out: PrintJob[] = [];
  for (const j of jobs) {
    const last = out[out.length - 1];
    if (last && last.index === j.index) last.copies += j.copies;
    else out.push({ ...j });
  }
  return out;
}

export interface ZebraSendResult {
  /** étiquettes transmises à l'imprimante (paquets complets) */
  sent: PrintJob[];
  /** étiquettes non transmises */
  remaining: PrintJob[];
  /** arrêt demandé par l'utilisateur */
  cancelled?: boolean;
  /** cause de l'arrêt (message traduit) */
  error?: string;
}

/** Commandes minimales pour un envoi hors file (fenêtres de confirmation du navigateur) */
function standaloneCtl(): QueueCtl {
  let cancelled = false;
  return {
    id: '',
    update() {},
    async checkpoint() {
      if (cancelled) throw new CancelledError();
    },
    async problem(message, canForce) {
      const go = canForce ? window.confirm(message + '\n\n' + t('Envoyer quand même ?')) : window.confirm(message + '\n\n' + t('Réessayer ?'));
      if (!go) cancelled = true;
      return go ? (canForce ? 'force' : 'resume') : 'cancel';
    },
    finish() {},
    isCancelled: () => cancelled,
  };
}

/**
 * Envoie un travail à l'imprimante Zebra par paquets, avec vérification de l'état (~HS)
 * avant chaque paquet :
 * - imprimante pas prête : le travail se met en pause (Reprendre = nouvelle vérification,
 *   Annuler = arrêt) ;
 * - état illisible : « Envoyer quand même » proposé (une fois pour tout le travail) ;
 * - erreur d'envoi d'un paquet : pause, Reprendre renvoie ce paquet.
 * Rien n'est envoyé tant que l'imprimante n'a pas été jugée prête (ou forcée).
 * « sent » = étiquettes TRANSMISES : ~HS ne dit pas combien ont réellement été imprimées.
 */
export async function sendJobsToZebra(doc: LabelDoc, jobs: PrintJob[], o: { ctl?: QueueCtl; advanceSerial?: boolean; chunkSize?: number } = {}): Promise<ZebraSendResult> {
  const s = S();
  const ctl = o.ctl ?? standaloneCtl();
  const fail = (error: string): ZebraSendResult => ({ sent: [], remaining: jobs, error });
  let dev: zebra.ZebraDevice | null;
  try {
    dev = await zebraDevice();
  } catch (e) {
    return fail(t('Erreur d’impression : {m}', { m: (e as Error).message }));
  }
  if (!dev) return fail(t('Aucune imprimante Zebra disponible'));
  const cols = rollColumns(doc);
  // rouleau à plusieurs étiquettes de front : paquets en rangées complètes autant que possible
  let size = Math.max(1, Math.floor(o.chunkSize ?? getChunkSize()));
  if (cols > 1) size = Math.max(cols, size - (size % cols));
  const chunks = splitChunks(jobs, size, !docUsesSscc(doc));
  const total = labelCount(jobs);
  const saved = zebra.savedSettings(dev);
  const pre = zebra.settingsZpl({ darkness: saved.darkness, speed: saved.speed });
  const sent: PrintJob[] = [];
  let forceUnknown = false;
  let error: string | undefined;
  let cancelled = false;
  ctl.update({ total, chunks: chunks.length, chunk: 0, sent: 0 });

  const ask = async (msg: string, canForce: boolean) => {
    const d = await ctl.problem(msg, canForce);
    if (d === 'cancel') {
      cancelled = true;
      error = msg;
    }
    return d;
  };

  outer: for (let i = 0; i < chunks.length; i++) {
    // 1. état de l'imprimante
    for (;;) {
      const r = await zebra.checkReady(dev);
      if (r.state === 'ready' || (r.state === 'unknown' && forceUnknown)) break;
      const d = await ask(readinessMessage(r), r.state === 'unknown');
      if (d === 'cancel') break outer;
      if (d === 'force') {
        forceUnknown = true;
        break;
      }
    }
    // 2. envoi du paquet
    ctl.update({ chunk: i + 1 });
    const zpl = (i === 0 ? pre : '') + generateJobsZpl(doc, chunks[i]);
    try {
      await zebra.write(dev, zpl, Math.max(20000, Math.ceil(zpl.length / 20000) * 1000));
    } catch (e) {
      const msg = isBrowserPrintDown(e)
        ? t('Zebra Browser Print ne répond plus (paquet {i}/{n}).', { i: i + 1, n: chunks.length })
        : t('Erreur d’envoi du paquet {i}/{n} : {m}', { i: i + 1, n: chunks.length, m: (e as Error).message });
      const d = await ask(msg + ' ' + t('« Reprendre » renvoie ce paquet (il a pu être reçu en partie).'), false);
      if (d === 'cancel') break;
      i--; // renvoi du même paquet
      continue;
    }
    sent.push(...chunks[i]);
    ctl.update({ sent: labelCount(sent) });
    // 3. pause / annulation demandées par l'utilisateur
    if (i < chunks.length - 1) {
      try {
        await ctl.checkpoint();
      } catch (e) {
        if (!isCancelled(e)) throw e;
        cancelled = true;
        break;
      }
    }
  }

  const n = labelCount(sent);
  const remaining = mergeJobs(skipLabels(jobs, n));
  if (n) {
    if (remaining.length) s.toast(t('Envoi interrompu : {n} étiquette(s) sur {t} envoyée(s) à {p}', { n, t: total, p: dev.name }), 'error');
    else s.toast(t('Envoyé à {p}', { p: dev.name }), 'ok');
    if (o.advanceSerial) advanceNumbering(doc, new Set(sent.map((j) => j.index)).size);
  } else if (error) s.toast(error, 'error');
  return { sent: mergeJobs(sent), remaining, cancelled: cancelled || undefined, error };
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
