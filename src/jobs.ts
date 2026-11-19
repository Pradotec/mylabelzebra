/**
 * Travaux d'impression / d'export : point d'entrée unique pour « Imprimer », les exports
 * (PDF, PNG, JPG, SVG, ZPL), les planches, la réimpression depuis l'historique et les
 * demandes venues d'autres outils (lien, postMessage).
 *
 * 1. demande les champs {{?Nom}} (fenêtre de saisie, dernières valeurs mémorisées) ;
 * 2. fige une copie du document (valeurs saisies + date du travail) ;
 * 3. produit la sortie ;
 * 4. inscrit le travail dans l'historique d'impression (IndexedDB, 500 entrées max).
 */
import { useStore } from './store';
import type { LabelDoc } from './types';
import { batchJobs, promptFields, type PrintJob } from './render/resolve';
import { getLastPrompts, setLastPrompts } from './prompts';
import { kvGet, kvSet } from './storage';
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
const HKEY = 'history';

export async function listHistory(): Promise<HistoryEntry[]> {
  const l = (await kvGet<HistoryEntry[]>(HKEY)) || [];
  return l.sort((a, b) => b.at - a.at);
}
async function addHistory(e: HistoryEntry) {
  const l = await listHistory();
  l.unshift(e);
  await kvSet(HKEY, l.slice(0, MAX_HISTORY));
}
export async function clearHistory() {
  await kvSet(HKEY, []);
}
export async function deleteHistory(id: string) {
  await kvSet(
    HKEY,
    (await listHistory()).filter((e) => e.id !== id),
  );
}

/** Ouvre la fenêtre de saisie des champs {{?Nom}} ; null = annulé */
export function askPrompts(doc: LabelDoc, fields = promptFields(doc), preset: Record<string, string> = {}): Promise<Record<string, string> | null> {
  if (!fields.length) return Promise.resolve({});
  const last = getLastPrompts(doc.id);
  const values = Object.fromEntries(fields.map((f) => [f, preset[f] ?? last[f] ?? '']));
  return new Promise((resolve) => {
    useStore.setState({
      promptAsk: {
        fields,
        values,
        resolve: (v) => {
          useStore.setState({ promptAsk: null });
          resolve(v);
        },
      },
    });
  });
}

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
      const last = getLastPrompts(base.id);
      prompts = Object.fromEntries(fields.map((f) => [f, given[f] ?? last[f] ?? '']));
    }
    setLastPrompts(base.id, prompts);
  }
  const doc = jobDoc(base, prompts);
  const jobs = jobsFor(doc, kind, opts);
  let ok = false;
  try {
    ok = await executeJob(doc, kind, jobs, opts);
  } catch (e) {
    st.toast(t('Erreur : {m}', { m: (e as Error).message }), 'error');
    ok = false;
  }
  if (!ok) return null;
  const count = jobs.reduce((a, j) => a + j.copies, 0);
  await addHistory({
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
  }).catch(() => undefined);
  return count;
}

/** Réimprime un travail de l'historique à l'identique (même document, mêmes valeurs, même date). */
export async function reprint(e: HistoryEntry): Promise<boolean> {
  let ok = false;
  try {
    ok = await executeJob(e.doc, e.kind, e.jobs, e.opts, false);
  } catch (err) {
    useStore.getState().toast(t('Erreur : {m}', { m: (err as Error).message }), 'error');
  }
  if (ok) await addHistory({ ...e, id: uid(), at: Date.now(), reprintOf: e.id });
  return ok;
}

/** Document d'un travail, sans les valeurs propres au travail (pour l'ouvrir dans l'éditeur) */
export function historyDocForEditing(e: HistoryEntry): LabelDoc {
  const d = JSON.parse(JSON.stringify(e.doc)) as LabelDoc;
  delete d.promptValues;
  delete d.jobDate;
  return d;
}
