import { create } from 'zustand';
import type { LabelDoc, LabelElement } from './types';
import { BASE_DPI } from './types';
import { demoDoc } from './templates';
import { normalizeDoc, newDoc } from './elements';
import { uid, deepClone } from './util';
import { kvGet, kvSet, prefGet, prefSet, isQuotaError, storageErrorMessage } from './storage';
import { onImageLoaded } from './render/images';
import { t } from './i18n';
import type { PromptSpec } from './prompts';
import { onSsccChange, loadSscc } from './sscc';

const HISTORY = 80;

export type Printer = 'none' | 'computer' | 'zebra';
export type LeftPanel = null | 'templates' | 'layers' | 'shapes' | 'barcode' | 'qr' | 'table';
export type RightPanel = null | 'data' | 'number' | 'date';
export type Modal =
  | null
  | 'zpl'
  | 'saved'
  | 'help'
  | 'print'
  | 'zebra'
  | 'sheets'
  | 'tool-barcode'
  | 'tool-qr'
  | 'export'
  | 'history';

export interface GridPrefs {
  show: boolean;
  snap: boolean;
  /** pas de grille en u */
  size: number;
  objects: boolean;
  rulers: boolean;
  unit: 'in' | 'mm';
}

export interface Toast {
  id: number;
  msg: string;
  kind: 'info' | 'ok' | 'error';
}

interface State {
  ready: boolean;
  doc: LabelDoc;
  past: LabelDoc[];
  future: LabelDoc[];
  lastKey?: string;
  lastTime: number;
  selected: string[];
  zoom: number;
  pan: { x: number; y: number };
  /** outil « Main » (déplacement de la vue) verrouillé, bascule par H ou le bouton */
  hand: boolean;
  /** main temporaire tant que la barre d'espace est maintenue */
  spaceHand: boolean;
  preview: boolean;
  /** aperçu thermique : rendu monochrome à la résolution de l'imprimante */
  thermal: boolean;
  previewRow: number;
  showData: boolean;
  printer: Printer;
  grid: GridPrefs;
  leftPanel: LeftPanel;
  rightPanel: RightPanel;
  modal: Modal;
  editingTextId: string | null;
  imgVersion: number;
  toasts: Toast[];
  savedVersion: number;
  dirty: boolean;
  /** demande de recadrage du zoom (incrémenté) */
  fitRequest: number;
  /** saisie des champs {{?Nom}} avant un travail d'impression / export */
  promptAsk: PromptAsk | null;
  /** demande d'impression venue d'un autre outil (lien / postMessage), en attente de confirmation */
  remoteRequest: RemoteRequest | null;
}

export interface PromptAsk {
  fields: string[];
  /** description de chaque champ (type, choix, contraintes), dans l'ordre de « fields » */
  specs: PromptSpec[];
  values: Record<string, string>;
  resolve: (v: Record<string, string> | null) => void;
}

export interface RemoteRequest {
  /** 'url' ou origine de la fenêtre qui a envoyé le message */
  source: string;
  docName: string;
  docId: string;
  target: string;
  count: number;
  /** simple ouverture du modèle, sans impression */
  open?: boolean;
  /** l'étiquette en cours a des modifications non enregistrées, qui seront remplacées */
  unsaved?: boolean;
  resolve: (ok: boolean, remember: boolean) => void;
}

interface Actions {
  init(): Promise<void>;
  setDoc(fn: (d: LabelDoc) => LabelDoc | void, key?: string): void;
  updateEls(ids: string[], patch: Partial<LabelElement> | ((el: LabelElement) => Partial<LabelElement>), key?: string): void;
  addElements(els: LabelElement[], select?: boolean): void;
  removeSelected(): void;
  duplicateSelected(): void;
  copySelected(): void;
  paste(): void;
  groupSelected(): void;
  ungroupSelected(): void;
  reorder(ids: string[], where: 'front' | 'back' | 'up' | 'down'): void;
  moveTo(id: string, newIndex: number): void;
  select(ids: string[], mode?: 'set' | 'add' | 'toggle', exact?: boolean): void;
  undo(): void;
  redo(): void;
  loadDoc(doc: LabelDoc, keepHistory?: boolean): void;
  set<K extends keyof State>(k: K, v: State[K]): void;
  setGrid(p: Partial<GridPrefs>): void;
  setZoom(z: number, persist?: boolean): void;
  toast(msg: string, kind?: Toast['kind']): void;
  dismissToast(id: number): void;
}

let clipboard: LabelElement[] = [];
let pasteCount = 0;

/** Texte écrit dans le presse-papiers système lors de la dernière copie d'éléments */
const CLIP_TEXT = 'mlz.clipboardText';

/**
 * Lors d'une copie d'éléments, écrit aussi leur texte dans le presse-papiers système.
 * Au collage, si le presse-papiers système contient AUTRE CHOSE que ce texte, c'est
 * qu'un texte plus récent a été copié ailleurs (autre application) : il est prioritaire.
 */
function syncSystemClipboard(els: LabelElement[]) {
  const text = els
    .map((e) => (e.type === 'text' ? e.text : e.type === 'barcode' ? e.value : ''))
    .filter(Boolean)
    .join('\n');
  const remember = (v: string | null) => {
    try {
      if (v == null) localStorage.removeItem(CLIP_TEXT);
      else localStorage.setItem(CLIP_TEXT, v);
    } catch {
      /* ignore */
    }
  };
  remember(null);
  try {
    const p = navigator.clipboard?.writeText?.(text);
    if (!p) return;
    p.then(
      () => remember(text),
      () => remember(null),
    );
  } catch {
    /* presse-papiers système inaccessible : les éléments copiés restent prioritaires */
  }
}

/**
 * Texte placé dans le presse-papiers système par la dernière copie d'éléments,
 * ou null si inconnu (écriture refusée / non prise en charge).
 */
export function lastCopiedSystemText(): string | null {
  try {
    return localStorage.getItem(CLIP_TEXT);
  } catch {
    return null;
  }
}

/** Contenu persisté du document courant (clé 'current') */
interface SavedCurrent {
  doc: LabelDoc;
  previewRow?: number;
  dirty?: boolean;
}

const defaultGrid: GridPrefs = { show: false, snap: false, size: BASE_DPI / 10, objects: true, rulers: false, unit: 'mm' };

export const useStore = create<State & Actions>()((set, get) => ({
  ready: false,
  doc: newDoc(),
  past: [],
  future: [],
  lastTime: 0,
  selected: [],
  zoom: 1,
  pan: { x: 0, y: 0 },
  hand: false,
  spaceHand: false,
  preview: false,
  thermal: false,
  previewRow: 0,
  showData: true,
  printer: prefGet<Printer>('printer', 'none'),
  grid: { ...defaultGrid, ...prefGet<Partial<GridPrefs>>('grid', {}) },
  leftPanel: null,
  rightPanel: null,
  modal: null,
  editingTextId: null,
  imgVersion: 0,
  toasts: [],
  savedVersion: 0,
  dirty: false,
  fitRequest: 0,
  promptAsk: null,
  remoteRequest: null,

  async init() {
    // les anciennes sauvegardes contenaient aussi past/future : ignorés (l'historique
    // d'annulation n'est plus persisté), seul le document courant est restauré
    const saved = await kvGet<SavedCurrent>('current');
    if (saved?.doc) {
      set({
        doc: normalizeDoc(saved.doc),
        past: [],
        future: [],
        previewRow: saved.previewRow || 0,
        dirty: !!saved.dirty,
        ready: true,
        fitRequest: get().fitRequest + 1,
      });
    } else set({ doc: demoDoc(), ready: true, fitRequest: get().fitRequest + 1 });
  },

  setDoc(fn, key) {
    const s = get();
    const prev = s.doc;
    const draft = deepCloneShallow(prev);
    const res = fn(draft) || draft;
    res.updatedAt = Date.now();
    const now = Date.now();
    const coalesce = key && key === s.lastKey && now - s.lastTime < 1200;
    set({
      doc: res,
      past: coalesce ? s.past : [...s.past, prev].slice(-HISTORY),
      future: [],
      lastKey: key,
      lastTime: now,
      dirty: true,
    });
  },

  updateEls(ids, patch, key) {
    const set_ = new Set(ids);
    get().setDoc((d) => {
      d.elements = d.elements.map((e) => (set_.has(e.id) ? ({ ...e, ...(typeof patch === 'function' ? patch(e) : patch) } as LabelElement) : e));
    }, key);
  },

  addElements(els, select = true) {
    get().setDoc((d) => {
      d.elements = [...d.elements, ...els];
    });
    if (select) set({ selected: els.map((e) => e.id) });
  },

  removeSelected() {
    const sel = new Set(get().selected);
    if (!sel.size) return;
    get().setDoc((d) => {
      d.elements = d.elements.filter((e) => !sel.has(e.id) || e.locked);
    });
    set({ selected: [] });
  },

  copySelected() {
    const sel = new Set(get().selected);
    clipboard = deepClone(get().doc.elements.filter((e) => sel.has(e.id)));
    pasteCount = 0;
    try {
      localStorage.setItem('mlz.clipboard', JSON.stringify(clipboard));
    } catch {
      /* ignore */
    }
    syncSystemClipboard(clipboard);
  },

  paste() {
    if (!clipboard.length) {
      try {
        clipboard = JSON.parse(localStorage.getItem('mlz.clipboard') || '[]');
      } catch {
        clipboard = [];
      }
    }
    if (!clipboard.length) return;
    pasteCount++;
    get().addElements(cloneElements(clipboard, 16 * pasteCount));
  },

  duplicateSelected() {
    // ne touche ni aux éléments copiés ni au presse-papiers système
    const sel = new Set(get().selected);
    const src = get().doc.elements.filter((e) => sel.has(e.id));
    if (!src.length) return;
    get().addElements(cloneElements(src, 16));
  },

  groupSelected() {
    const sel = new Set(get().selected);
    if (sel.size < 2) return;
    const gid = uid();
    get().setDoc((d) => {
      d.elements = d.elements.map((e) => (sel.has(e.id) ? { ...e, groups: [gid, ...(e.groups || [])] } : e));
    });
  },

  ungroupSelected() {
    const sel = new Set(get().selected);
    get().setDoc((d) => {
      d.elements = d.elements.map((e) => (sel.has(e.id) && e.groups?.length ? { ...e, groups: e.groups.slice(1) } : e));
    });
  },

  reorder(ids, where) {
    const sel = new Set(ids);
    get().setDoc((d) => {
      const els = [...d.elements];
      if (where === 'front') d.elements = [...els.filter((e) => !sel.has(e.id)), ...els.filter((e) => sel.has(e.id))];
      else if (where === 'back') d.elements = [...els.filter((e) => sel.has(e.id)), ...els.filter((e) => !sel.has(e.id))];
      else if (where === 'up') {
        for (let i = els.length - 2; i >= 0; i--) if (sel.has(els[i].id) && !sel.has(els[i + 1].id)) [els[i], els[i + 1]] = [els[i + 1], els[i]];
        d.elements = els;
      } else {
        for (let i = 1; i < els.length; i++) if (sel.has(els[i].id) && !sel.has(els[i - 1].id)) [els[i], els[i - 1]] = [els[i - 1], els[i]];
        d.elements = els;
      }
    });
  },

  moveTo(id, newIndex) {
    get().setDoc((d) => {
      const els = [...d.elements];
      const i = els.findIndex((e) => e.id === id);
      if (i < 0) return;
      const [el] = els.splice(i, 1);
      els.splice(Math.max(0, Math.min(els.length, newIndex)), 0, el);
      d.elements = els;
    });
  },

  select(ids, mode = 'set', exact = false) {
    const els = get().doc.elements;
    // étend la sélection au groupe le plus externe
    const expand = (list: string[]) => {
      if (exact) return list;
      const out = new Set<string>();
      for (const id of list) {
        const el = els.find((e) => e.id === id);
        if (!el) continue;
        const g = el.groups?.[0];
        if (g) els.filter((e) => e.groups?.[0] === g).forEach((e) => out.add(e.id));
        else out.add(id);
      }
      return Array.from(out);
    };
    const add = expand(ids);
    const cur = get().selected;
    let next: string[];
    if (mode === 'set') next = add;
    else if (mode === 'add') next = Array.from(new Set([...cur, ...add]));
    else {
      const allIn = add.every((id) => cur.includes(id));
      next = allIn ? cur.filter((id) => !add.includes(id)) : Array.from(new Set([...cur, ...add]));
    }
    set({ selected: next, editingTextId: null });
  },

  undo() {
    const s = get();
    if (!s.past.length) return;
    const prev = s.past[s.past.length - 1];
    set({
      doc: prev,
      past: s.past.slice(0, -1),
      future: [s.doc, ...s.future].slice(0, HISTORY),
      lastKey: undefined,
      dirty: true,
      selected: s.selected.filter((id) => prev.elements.some((e) => e.id === id)),
      editingTextId: s.editingTextId && prev.elements.some((e) => e.id === s.editingTextId) ? s.editingTextId : null,
    });
  },

  redo() {
    const s = get();
    if (!s.future.length) return;
    const next = s.future[0];
    set({
      doc: next,
      future: s.future.slice(1),
      past: [...s.past, s.doc].slice(-HISTORY),
      lastKey: undefined,
      dirty: true,
      selected: s.selected.filter((id) => next.elements.some((e) => e.id === id)),
      editingTextId: s.editingTextId && next.elements.some((e) => e.id === s.editingTextId) ? s.editingTextId : null,
    });
  },

  loadDoc(doc, keepHistory = false) {
    const s = get();
    set({
      doc: normalizeDoc(doc),
      past: keepHistory ? [...s.past, s.doc].slice(-HISTORY) : [],
      future: [],
      selected: [],
      previewRow: 0,
      editingTextId: null,
      dirty: true,
      fitRequest: s.fitRequest + 1,
    });
  },

  set(k, v) {
    set({ [k]: v } as unknown as State);
    if (k === 'printer') prefSet('printer', v);
  },

  setGrid(p) {
    const grid = { ...get().grid, ...p };
    prefSet('grid', grid);
    set({ grid });
  },

  setZoom(z, persist = true) {
    const zoom = Math.max(0.1, Math.min(8, z));
    set({ zoom });
    if (persist) {
      // le zoom est mémorisé dans le document, sans entrée d'historique ni modification
      // « non enregistrée » : zoomer n'est pas éditer
      set({ doc: { ...get().doc, zoom } });
    }
  },

  toast(msg, kind = 'info') {
    const id = Date.now() + Math.random();
    set({ toasts: [...get().toasts, { id, msg, kind }] });
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 3200);
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

/** Copies décalées d'éléments : nouveaux identifiants, groupes renommés, déverrouillées */
function cloneElements(src: LabelElement[], off: number): LabelElement[] {
  const gmap = new Map<string, string>();
  return deepClone(src).map((e) => ({
    ...e,
    id: uid(),
    x: e.x + off,
    y: e.y + off,
    locked: false,
    groups: e.groups?.map((g) => {
      if (!gmap.has(g)) gmap.set(g, uid());
      return gmap.get(g)!;
    }),
  }));
}

function deepCloneShallow(d: LabelDoc): LabelDoc {
  return { ...d, elements: [...d.elements], guides: { x: [...d.guides.x], y: [...d.guides.y] } };
}

onImageLoaded(() => useStore.setState((s) => ({ imgVersion: s.imgVersion + 1 })));
// SSCC : l'aperçu ({{#sscc}}) suit la configuration (chargée au démarrage, mise à jour par les autres onglets)
onSsccChange(() => useStore.setState((s) => ({ imgVersion: s.imgVersion + 1 })));
void loadSscc().catch(() => undefined);

// --- Sauvegarde automatique du document courant ---
// Seul le document courant est persisté (plus l'historique d'annulation : 80 états,
// images dataURL comprises, réécrits à chaque modification saturaient le stockage).
export const AUTOSAVE_DELAY = 1000;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let lastQuotaToast = 0;

/** Écrit immédiatement le document courant (appelé après le délai, ou en quittant la page). */
export async function flushAutosave(): Promise<void> {
  if (saveTimer === undefined) return;
  clearTimeout(saveTimer);
  saveTimer = undefined;
  const st = useStore.getState();
  const payload: SavedCurrent = { doc: st.doc, previewRow: st.previewRow, dirty: st.dirty };
  try {
    await kvSet('current', payload);
  } catch (e) {
    // un toast au plus par minute : la sauvegarde automatique réessaie à chaque modification
    if (Date.now() - lastQuotaToast > 60_000) {
      lastQuotaToast = Date.now();
      st.toast(isQuotaError(e) ? t('Stockage du navigateur plein : la sauvegarde automatique a échoué. Supprimez des étiquettes ou effacez l’historique d’impression.') : storageErrorMessage(e), 'error');
    }
  }
}

useStore.subscribe((s, prev) => {
  if (!s.ready) return;
  if (s.doc === prev.doc && s.previewRow === prev.previewRow && s.dirty === prev.dirty) return;
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushAutosave(), AUTOSAVE_DELAY);
});

if (typeof window !== 'undefined') {
  // dernière chance en quittant / masquant l'onglet
  window.addEventListener('pagehide', () => void flushAutosave());
  document.addEventListener?.('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushAutosave();
  });
}

export const selectedElements = (s: State) => s.doc.elements.filter((e) => s.selected.includes(e.id));

// accès au store depuis la console en développement (débogage / vérifications)
if (import.meta.env.DEV) (window as unknown as { __mlz?: typeof useStore }).__mlz = useStore;
