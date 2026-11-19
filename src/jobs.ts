/**
 * Travaux d'impression / d'export : point d'entrée unique pour « Imprimer », les exports
 * (PDF, PNG, JPG, SVG, ZPL), les planches, la réimpression depuis l'historique et les
 * demandes venues d'autres outils (lien, postMessage).
 *
 * 1. demande les champs {{?Nom}} (fenêtre de saisie, dernières valeurs mémorisées) ;
 * 2. fige une copie du document (valeurs saisies + date du travail) ;
 * 3. produit la sortie ;
 * 4. inscrit le travail dans l'historique d'impression (IndexedDB, 500 entrées / 40 Mo max,
 *    une clé par entrée, documents identiques stockés une seule fois).
 */
import { useStore } from './store';
import type { LabelDoc } from './types';
import { batchJobs, promptFields, promptSpecs, docUsesSscc, type PrintJob } from './render/resolve';
import { getLastPrompts, setLastPrompts, validatePrompts, type PromptSpec } from './prompts';
import { withSsccRange, SsccCommitError, type SsccAssignment, type SsccDoc } from './sscc';
import { kvGet, kvSet, kvDel, isQuotaError, storageErrorMessage } from './storage';
import { isCancelled } from './progress';
import { generateJobsZpl } from './zpl/generate';
import { sendToZebra } from './actions';
import { printOnComputer, downloadPdf, downloadPdfZip, downloadImage, downloadSvg, downloadSheetsPdf, sheetSlots } from './export';
import { sheetById } from './sizes';
import { copyText, downloadText, safeFileName, uid } from './util';
import { t } from './i18n';

export type JobKind =
  | 'ordinateur'
  | 'zebra'
  | 'pdf'
  | 'pdf-zip'
  | 'png'
  | 'jpg'
  | 'svg'
  | 'zpl-copie'
  | 'zpl-fichier'
  | 'planches-pdf'
  | 'planches';

export const JOB_LABELS: Record<JobKind, string> = {
  ordinateur: 'Cet ordinateur',
  zebra: 'Imprimante Zebra',
  pdf: 'PDF',
  'pdf-zip': 'PDF (.zip)',
  png: 'PNG',
  jpg: 'JPG',
  svg: 'SVG',
  'zpl-copie': 'ZPL copié',
  'zpl-fichier': 'Fichier .zpl',
  'planches-pdf': 'Planches (PDF)',
  planches: 'Planches (impression)',
};

export interface JobOpts {
  /** seulement l'étiquette affichée */
  onlyCurrent?: boolean;
  /** copies pour « seulement l'étiquette affichée » */
  copies?: number;
  /** résolution des PDF */
  dpi?: number;
  /** ligne affichée au moment du travail */
  currentRow?: number;
}

export interface HistoryEntry {
  id: string;
  at: number;
  name: string;
  docId: string;
  kind: JobKind;
  /** nombre d'étiquettes produites (copies comprises) */
  count: number;
  /** lignes de données imprimées (index à partir de 0), vide sans données */
  rows: number[];
  prompts: Record<string, string>;
  jobs: PrintJob[];
  opts: JobOpts;
  /** instantané du document (valeurs saisies et date du travail comprises) */
  doc: LabelDoc;
  /** origine : 'url', origine postMessage… */
  source?: string;
  reprintOf?: string;
}

export const MAX_HISTORY = 500;
/** Taille maximale de l'historique (caractères JSON ≈ octets), documents dédupliqués compris */
export const MAX_HISTORY_BYTES = 40 * 1024 * 1024;
/** Plafonds effectifs (modifiables par les tests) */
export const historyLimits = { items: MAX_HISTORY, bytes: MAX_HISTORY_BYTES };

/*
 * Format de stockage (v2) — une clé par entrée, documents dédupliqués :
 *   'jobs.index'       → JobIndex : liste légère (id, date, document, taille), la plus récente en tête
 *   'jobs.e.<id>'      → StoredEntry : l'entrée sans son document
 *   'jobs.d.<empreinte>' → document du travail SANS les valeurs propres au travail
 *                          (promptValues, jobDate) : identique d'une impression à l'autre
 * Une impression écrit au plus 3 petites clés au lieu de relire / réécrire tout l'historique.
 * L'ancien format (tableau complet sous 'history') est migré silencieusement au premier accès.
 */
const OLD_KEY = 'history';
const INDEX_KEY = 'jobs.index';
const entryKey = (id: string) => 'jobs.e.' + id;
const docKey = (hash: string) => 'jobs.d.' + hash;

interface IndexItem {
  id: string;
  at: number;
  /** empreinte du document */
  doc: string;
  /** taille de l'entrée (JSON) */
  size: number;
}
interface JobIndex {
  v: 2;
  items: IndexItem[];
  /** taille de chaque document stocké, par empreinte */
  docs: Record<string, number>;
}
type StoredEntry = Omit<HistoryEntry, 'doc'> & {
  docHash: string;
  promptValues?: Record<string, string>;
  jobDate?: number;
  /** plage SSCC du travail (réimpression à l'identique) */
  ssccJob?: SsccAssignment;
};

/** Empreinte 53 bits (cyrb53) + longueur : suffisant pour dédupliquer des documents */
export function hashString(s: string): string {
  let h1 = 0xdeadbeef,
    h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + '-' + s.length.toString(36);
}

/** Sépare le document d'un travail en partie commune (dédupliquée) et valeurs propres au travail */
function splitDoc(doc: LabelDoc) {
  const { promptValues, jobDate, ssccJob, ...base } = doc as SsccDoc;
  const json = JSON.stringify(base);
  return { json, hash: hashString(json), promptValues, jobDate, ssccJob };
}

const emptyIndex = (): JobIndex => ({ v: 2, items: [], docs: {} });

// toutes les modifications de l'historique passent par cette file (une à la fois)
let lock: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const p = lock.then(fn);
  lock = p.catch(() => undefined);
  return p;
}

let migrated = false;
async function loadIndex(): Promise<JobIndex> {
  const idx = await kvGet<JobIndex>(INDEX_KEY);
  if (!migrated) {
    migrated = true;
    const old = await kvGet<HistoryEntry[]>(OLD_KEY);
    if (Array.isArray(old)) return migrate(idx && idx.v === 2 ? idx : emptyIndex(), old);
  }
  return idx && idx.v === 2 && Array.isArray(idx.items) ? idx : emptyIndex();
}

/** Migration silencieuse de l'ancien format (un seul tableau). Idempotente si interrompue. */
async function migrate(idx: JobIndex, old: HistoryEntry[]): Promise<JobIndex> {
  try {
    const known = new Set(idx.items.map((i) => i.id));
    const list = old.filter((e) => e && e.id && e.doc && !known.has(e.id)).sort((a, b) => a.at - b.at);
    const docsBefore = { ...idx.docs };
    const removed: string[] = [];
    for (const e of list) {
      await writeEntry(idx, e);
      // purge au fil de l'eau : la migration elle-même ne doit pas dépasser les plafonds
      removed.push(...trim(idx));
    }
    await commit(idx, removed, docsBefore);
    await kvDel(OLD_KEY);
  } catch {
    // échec (stockage plein…) : l'ancien historique reste en place, nouvel essai au prochain chargement
    migrated = false;
  }
  return idx;
}

/** Écrit l'entrée et son document (si nouveau) ; met l'index à jour en mémoire */
async function writeEntry(idx: JobIndex, e: HistoryEntry) {
  const { json, hash, promptValues, jobDate, ssccJob } = splitDoc(e.doc);
  if (idx.docs[hash] == null) {
    await kvSet(docKey(hash), JSON.parse(json));
    idx.docs[hash] = json.length;
  }
  const { doc: _doc, ...rest } = e;
  const stored: StoredEntry = { ...rest, docHash: hash, promptValues, jobDate };
  if (ssccJob) stored.ssccJob = ssccJob;
  const size = JSON.stringify(stored).length;
  await kvSet(entryKey(e.id), stored);
  idx.items = idx.items.filter((i) => i.id !== e.id);
  idx.items.unshift({ id: e.id, at: e.at, doc: hash, size });
}

const totalSize = (idx: JobIndex) => idx.items.reduce((a, i) => a + i.size, 0) + Object.values(idx.docs).reduce((a, n) => a + n, 0);

/**
 * Retire de l'index (en mémoire) les entrées les plus anciennes au-delà des plafonds
 * (nombre d'entrées, taille totale). Renvoie les identifiants retirés.
 */
function trim(idx: JobIndex, maxItems = historyLimits.items, maxBytes = historyLimits.bytes): string[] {
  idx.items.sort((a, b) => b.at - a.at);
  const removed: string[] = [];
  while (idx.items.length > maxItems || (idx.items.length > 1 && totalSize(idx) > maxBytes)) {
    const it = idx.items.pop()!;
    removed.push(it.id);
    // libère le document s'il n'est plus utilisé, pour que la taille totale baisse
    if (!idx.items.some((i) => i.doc === it.doc)) delete idx.docs[it.doc];
  }
  return removed;
}

/**
 * Enregistre l'index puis efface les clés des entrées retirées et des documents qui ne
 * sont plus référencés. L'index est écrit d'abord : une clé orpheline (effacement
 * interrompu) est sans conséquence, une entrée de l'index sans sa clé est ignorée.
 */
async function commit(idx: JobIndex, removedIds: string[], docsBefore: Record<string, number>) {
  const used = new Set(idx.items.map((i) => i.doc));
  const dead = new Set<string>();
  for (const h of [...Object.keys(docsBefore), ...Object.keys(idx.docs)])
    if (!used.has(h)) {
      dead.add(h);
      delete idx.docs[h];
    }
  await kvSet(INDEX_KEY, idx);
  await Promise.all([...removedIds.map((id) => kvDel(entryKey(id)).catch(() => undefined)), ...Array.from(dead, (h) => kvDel(docKey(h)).catch(() => undefined))]);
}

async function hydrate(it: IndexItem, docs: Map<string, Promise<LabelDoc | undefined>>): Promise<HistoryEntry | null> {
  const e = await kvGet<StoredEntry>(entryKey(it.id));
  if (!e) return null;
  if (!docs.has(e.docHash)) docs.set(e.docHash, kvGet<LabelDoc>(docKey(e.docHash)));
  const base = await docs.get(e.docHash)!;
  if (!base) return null;
  const { docHash: _h, promptValues, jobDate, ssccJob, ...rest } = e;
  const doc: SsccDoc = { ...base };
  if (promptValues !== undefined) doc.promptValues = promptValues;
  if (jobDate !== undefined) doc.jobDate = jobDate;
  if (ssccJob !== undefined) doc.ssccJob = ssccJob;
  return { ...rest, doc };
}

/** Historique complet, le plus récent en tête (documents rechargés, partagés entre entrées identiques) */
export async function listHistory(): Promise<HistoryEntry[]> {
  return exclusive(async () => {
    const idx = await loadIndex();
    const docs = new Map<string, Promise<LabelDoc | undefined>>();
    const list = await Promise.all(idx.items.map((it) => hydrate(it, docs).catch(() => null)));
    return list.filter((x): x is HistoryEntry => !!x).sort((a, b) => b.at - a.at);
  });
}

/** Ajoute une entrée ; en cas de stockage plein, purge la moitié la plus ancienne et réessaie une fois. */
export async function addHistory(e: HistoryEntry): Promise<void> {
  return exclusive(async () => {
    const idx = await loadIndex();
    const write = async () => {
      const before = { ...idx.docs };
      await writeEntry(idx, e);
      await commit(idx, trim(idx), before);
    };
    try {
      await write();
    } catch (err) {
      if (!isQuotaError(err)) throw err;
      // stockage plein : on libère la moitié la plus ancienne de l'historique et on réessaie
      const before = { ...idx.docs };
      idx.items = idx.items.filter((i) => i.id !== e.id);
      const removed = trim(idx, Math.floor(idx.items.length / 2));
      await commit(idx, removed, before);
      await write();
    }
  });
}

export async function clearHistory() {
  return exclusive(async () => {
    const idx = await loadIndex();
    const ids = idx.items.map((i) => i.id);
    const before = { ...idx.docs };
    idx.items = [];
    idx.docs = {};
    await commit(idx, ids, before);
  });
}

export async function deleteHistory(id: string) {
  return exclusive(async () => {
    const idx = await loadIndex();
    if (!idx.items.some((i) => i.id === id)) return;
    const before = { ...idx.docs };
    idx.items = idx.items.filter((i) => i.id !== id);
    await commit(idx, [id], before);
  });
}

/** Réinitialise l'état interne (tests) */
export function _resetHistoryForTests() {
  migrated = false;
  lock = Promise.resolve();
}

/** Ouvre la fenêtre de saisie des champs {{?Nom}} ; null = annulé */
export function askPrompts(doc: LabelDoc, fields = promptFields(doc), preset: Record<string, string> = {}): Promise<Record<string, string> | null> {
  if (!fields.length) return Promise.resolve({});
  const last = getLastPrompts(doc.id);
  const values = Object.fromEntries(fields.map((f) => [f, preset[f] ?? last[f] ?? '']));
  const all = promptSpecs(doc);
  const specs: PromptSpec[] = fields.map((f) => all.find((s) => s.name === f) ?? { name: f, type: 'text', required: false });
  return new Promise((resolve) => {
    useStore.setState({
      promptAsk: {
        fields,
        specs,
        values,
        resolve: (v) => {
          useStore.setState({ promptAsk: null });
          resolve(v);
        },
      },
    });
  });
}

/**
 * Vérifie les valeurs saisies d'un document (options {{?Nom|obligatoire|gtin|…}}).
 * null = valide ; sinon message d'erreur (traduit) listant les champs refusés.
 */
export function promptValuesError(doc: LabelDoc, values: Record<string, string>): string | null {
  const errs = Object.entries(validatePrompts(promptSpecs(doc), values));
  if (!errs.length) return null;
  return t('Saisie invalide, travail refusé — {m}', { m: errs.map(([name, e]) => `${name} : ${t(e.msg, e.vars)}`).join(' ; ') });
}

/** Index distincts des étiquettes d'un travail, dans l'ordre (copies ×N = une seule étiquette) */
export const distinctIndices = (jobs: PrintJob[]) => Array.from(new Set(jobs.map((j) => j.index)));

/** Liste des étiquettes d'un travail */
export function jobsFor(doc: LabelDoc, kind: JobKind, opts: JobOpts): PrintJob[] {
  const row = opts.currentRow ?? 0;
  if (kind === 'png' || kind === 'jpg' || kind === 'svg') return [{ index: row, copies: 1 }];
  if (kind === 'planches' || kind === 'planches-pdf' || (kind === 'ordinateur' && doc.sheet)) {
    const sheet = sheetById(doc.sheet?.id);
    if (sheet) {
      const slots = sheetSlots(doc, sheet, row).filter((x): x is number => x != null);
      const m = new Map<number, number>();
      slots.forEach((i) => m.set(i, (m.get(i) || 0) + 1));
      return Array.from(m, ([index, copies]) => ({ index, copies }));
    }
  }
  if (opts.onlyCurrent) return [{ index: row, copies: Math.max(1, opts.copies || 1) }];
  return batchJobs(doc, row);
}

/** Produit la sortie d'un travail déjà préparé (document figé). */
export async function executeJob(doc: LabelDoc, kind: JobKind, jobs: PrintJob[], opts: JobOpts, advanceSerial = true): Promise<boolean> {
  const row = opts.currentRow ?? 0;
  switch (kind) {
    case 'ordinateur':
      await printOnComputer(doc, jobs, row);
      return true;
    case 'planches':
      await printOnComputer(doc, [], row);
      return true;
    case 'planches-pdf':
      await downloadSheetsPdf(doc, row);
      return true;
    case 'zebra':
      return sendToZebra(generateJobsZpl(doc, jobs), advanceSerial && !opts.onlyCurrent);
    case 'pdf':
      await downloadPdf(doc, jobs, opts.dpi || Math.max(300, doc.dpi));
      return true;
    case 'pdf-zip':
      await downloadPdfZip(doc, jobs, opts.dpi || Math.max(300, doc.dpi));
      return true;
    case 'png':
    case 'jpg':
      await downloadImage(doc, jobs[0]?.index ?? row, doc.dpi, kind);
      return true;
    case 'svg':
      await downloadSvg(doc, jobs[0]?.index ?? row);
      return true;
    case 'zpl-copie': {
      const ok = await copyText(generateJobsZpl(doc, jobs));
      if (ok) useStore.getState().toast(t('ZPL copié dans le presse-papiers'), 'ok');
      return ok;
    }
    case 'zpl-fichier':
      downloadText(generateJobsZpl(doc, jobs), safeFileName(doc.name) + '.zpl');
      return true;
  }
}

/** Copie figée du document pour un travail */
export function jobDoc(doc: LabelDoc, prompts: Record<string, string>, at = Date.now()): LabelDoc {
  return JSON.parse(JSON.stringify({ ...doc, promptValues: prompts, jobDate: at })) as LabelDoc;
}

export interface StartOpts extends JobOpts {
  /** document à utiliser (sinon celui de l'éditeur) */
  doc?: LabelDoc;
  /** valeurs imposées (API) : la fenêtre n'est ouverte que s'il en manque */
  prompts?: Record<string, string>;
  /** ne jamais ouvrir la fenêtre de saisie (API : valeurs manquantes = dernières valeurs) */
  noAsk?: boolean;
  source?: string;
}

/**
 * Lance un travail : saisie des champs, sortie, historique.
 * Renvoie le nombre d'étiquettes produites, ou null si annulé / échoué.
 */
export async function startJob(kind: JobKind, o: StartOpts = {}): Promise<number | null> {
  const st = useStore.getState();
  const base = o.doc ?? st.doc;
  const opts: JobOpts = { onlyCurrent: o.onlyCurrent, copies: o.copies, dpi: o.dpi, currentRow: o.currentRow ?? st.previewRow };
  const fields = promptFields(base);
  let prompts: Record<string, string> = {};
  if (fields.length) {
    const given = o.prompts || {};
    const missing = fields.filter((f) => given[f] == null);
    if (missing.length && !o.noAsk) {
      const v = await askPrompts(base, fields, given);
      if (!v) return null;
      prompts = v;
    } else {
      // valeurs reçues sans fenêtre de saisie (API, lien, noAsk) : vérifiées ici
      const last = getLastPrompts(base.id);
      prompts = Object.fromEntries(fields.map((f) => [f, given[f] ?? last[f] ?? '']));
      const err = promptValuesError(base, prompts);
      if (err) {
        st.toast(err, 'error');
        return null;
      }
    }
    setLastPrompts(base.id, prompts);
  }
  const doc: SsccDoc = jobDoc(base, prompts);
  const jobs = jobsFor(doc, kind, opts);
  const run = async () => {
    try {
      return await executeJob(doc, kind, jobs, opts);
    } catch (e) {
      if (isCancelled(e)) st.toast(t('Opération annulée'), 'info');
      else st.toast(t('Erreur : {m}', { m: (e as Error).message }), 'error');
      return false;
    }
  };
  let ok = false;
  if (docUsesSscc(doc)) {
    // plage SSCC attribuée au travail, consommée seulement s'il réussit
    try {
      ok = await withSsccRange(distinctIndices(jobs), { docName: doc.name, docId: doc.id, kind, hasData: !!doc.data?.rows.length }, (a) => {
        doc.ssccJob = a;
        return run();
      });
    } catch (e) {
      st.toast((e as Error).message, 'error');
      if (!(e instanceof SsccCommitError)) return null;
      ok = true; // travail effectué malgré l'échec d'enregistrement (signalé)
    }
  } else ok = await run();
  if (!ok) return null;
  const count = jobs.reduce((a, j) => a + j.copies, 0);
  await recordHistory({
    id: uid(),
    at: doc.jobDate!,
    name: doc.name,
    docId: doc.id,
    kind,
    count,
    rows: doc.data?.rows.length ? jobs.map((j) => j.index) : [],
    prompts,
    jobs,
    opts,
    doc,
    source: o.source,
  });
  return count;
}

/** Inscrit un travail réussi dans l'historique ; un échec d'écriture est signalé sans annuler le travail. */
async function recordHistory(e: HistoryEntry) {
  try {
    await addHistory(e);
  } catch (err) {
    useStore.getState().toast(t('Travail non inscrit dans l’historique d’impression : {m}', { m: storageErrorMessage(err) }), 'error');
  }
}

/** Réimprime un travail de l'historique à l'identique (même document, mêmes valeurs, même date). */
export async function reprint(e: HistoryEntry): Promise<boolean> {
  const err = promptValuesError(e.doc, e.doc.promptValues ?? e.prompts ?? {});
  if (err) {
    useStore.getState().toast(err, 'error');
    return false;
  }
  let ok = false;
  try {
    ok = await executeJob(e.doc, e.kind, e.jobs, e.opts, false);
  } catch (err) {
    if (isCancelled(err)) useStore.getState().toast(t('Opération annulée'), 'info');
    else useStore.getState().toast(t('Erreur : {m}', { m: (err as Error).message }), 'error');
  }
  if (ok) await recordHistory({ ...e, id: uid(), at: Date.now(), reprintOf: e.id });
  return ok;
}

/** Document d'un travail, sans les valeurs propres au travail (pour l'ouvrir dans l'éditeur) */
export function historyDocForEditing(e: HistoryEntry): LabelDoc {
  const d = JSON.parse(JSON.stringify(e.doc)) as LabelDoc;
  delete d.promptValues;
  delete d.jobDate;
  delete (d as SsccDoc).ssccJob;
  return d;
}
