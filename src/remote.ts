/**
 * Impression pilotée par d'autres outils, en local :
 * - lien : ?modele=…&data=<base64url JSON>&imprimer=zebra|ordinateur|pdf|zpl&copies=N&invite.Lot=…
 * - window.postMessage : { type: 'mlz.print', modele, rows, prompts, imprimer, copies, id? }
 *   → réponse { type: 'mlz.result', ok, count, error?, id? }
 *
 * Jamais d'impression silencieuse au premier usage : un bandeau demande confirmation,
 * sauf si l'utilisateur a autorisé l'impression automatique pour ce modèle (et cette origine).
 */
import { useStore } from './store';
import type { DataSet, LabelDoc } from './types';
import { listSaved } from './actions';
import { normalizeDoc } from './elements';
import { batchJobs } from './render/resolve';
import { startJob, type JobKind } from './jobs';
import { prefGet, prefSet } from './storage';
import { deepClone, uid } from './util';
import { t } from './i18n';

export interface RemoteJob {
  /** nom ou identifiant d'une étiquette de « Mes étiquettes » */
  modele: string;
  rows?: Record<string, unknown>[];
  prompts?: Record<string, string>;
  imprimer?: string;
  copies?: number;
  /** 'url' ou origine de la fenêtre émettrice */
  source: string;
}
export interface RemoteResult {
  ok: boolean;
  count: number;
  error?: string;
}

const TARGETS: Record<string, JobKind> = {
  zebra: 'zebra',
  ordinateur: 'ordinateur',
  computer: 'ordinateur',
  navigateur: 'ordinateur',
  pdf: 'pdf',
  zpl: 'zpl-fichier',
};
export const TARGET_LABELS: Record<string, string> = {
  zebra: 'Imprimante Zebra',
  ordinateur: 'Cet ordinateur',
  pdf: 'PDF',
  'zpl-fichier': 'Fichier .zpl',
};

// ---------- autorisations « impression automatique » ----------
const PERM = 'autoPrint';
type Perms = Record<string, { name: string; source: string; at: number }>;
const permKey = (docId: string, source: string) => `${docId}|${source}`;
export const listAutoPrint = (): Perms => prefGet<Perms>(PERM, {});
export function isAutoPrint(docId: string, source: string) {
  return !!listAutoPrint()[permKey(docId, source)];
}
export function setAutoPrint(docId: string, name: string, source: string, on: boolean) {
  const p = listAutoPrint();
  if (on) p[permKey(docId, source)] = { name, source, at: Date.now() };
  else delete p[permKey(docId, source)];
  prefSet(PERM, p);
}
export function revokeAutoPrint(key: string) {
  const p = listAutoPrint();
  delete p[key];
  prefSet(PERM, p);
}

// ---------- utilitaires ----------
export function decodeBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
export function encodeBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function rowsToData(rows: Record<string, unknown>[], copies?: number): DataSet {
  const columns: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!columns.includes(k)) columns.push(k);
  const str = (v: unknown) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return {
    columns,
    rows: rows.map((r) => Object.fromEntries(columns.map((c) => [c, str(r[c])]))),
    checked: rows.map(() => true),
    copies: rows.map(() => Math.max(1, Math.min(999, Math.round(copies || 1)))),
    source: t('Données reçues'),
  };
}

async function findModel(m: string): Promise<LabelDoc | null> {
  const list = await listSaved();
  const k = m.trim().toLowerCase();
  const hit = list.find((x) => x.doc.id === m) ?? list.find((x) => x.doc.name.trim().toLowerCase() === k);
  return hit ? normalizeDoc(deepClone(hit.doc)) : null;
}

/**
 * Bandeau de confirmation. `kind` null = simple ouverture du modèle (sans impression),
 * `unsaved` = l'étiquette en cours a des modifications non enregistrées qui seront remplacées.
 */
function confirmRemote(doc: LabelDoc, kind: JobKind | null, source: string, unsaved: boolean): Promise<boolean> {
  const count = batchJobs(doc, 0).reduce((a, j) => a + j.copies, 0);
  return new Promise((resolve) => {
    useStore.setState({
      remoteRequest: {
        source,
        docName: doc.name,
        docId: doc.id,
        target: kind ? (TARGET_LABELS[kind] ?? kind) : '',
        count,
        open: !kind,
        unsaved,
        resolve: (ok, remember) => {
          useStore.setState({ remoteRequest: null });
          if (ok && remember && kind) setAutoPrint(doc.id, doc.name, source, true);
          resolve(ok);
        },
      },
    });
  });
}

/** L'étiquette en cours serait perdue si on la remplaçait */
function hasUnsavedWork(): boolean {
  const s = useStore.getState();
  return s.dirty && s.doc.elements.length > 0;
}

let queue: Promise<unknown> = Promise.resolve();

/** Exécute une demande (une à la fois). */
export function runRemote(job: RemoteJob): Promise<RemoteResult> {
  const p = queue.then(() => runRemoteNow(job));
  queue = p.catch(() => undefined);
  return p;
}

async function runRemoteNow(job: RemoteJob): Promise<RemoteResult> {
  const st = useStore.getState();
  if (!job.modele) return { ok: false, count: 0, error: t('Paramètre « modele » manquant') };
  const doc = await findModel(job.modele);
  if (!doc) {
    st.toast(t('Modèle « {m} » introuvable dans « Mes étiquettes »', { m: job.modele }), 'error');
    return { ok: false, count: 0, error: 'modele introuvable' };
  }
  if (job.rows && !Array.isArray(job.rows)) return { ok: false, count: 0, error: 'rows doit être un tableau' };
  const target = (job.imprimer || '').toLowerCase();
  const kind = target ? TARGETS[target] : null;
  // paramètre invalide : refusé AVANT de toucher au document en cours
  if (target && !kind) return { ok: false, count: 0, error: `imprimer=${job.imprimer} inconnu (zebra, ordinateur, pdf, zpl)` };
  const injected = !!job.rows?.length || !!job.copies;
  if (job.rows?.length) doc.data = rowsToData(job.rows, job.copies);
  else if (job.copies) doc.copies = Math.max(1, Math.min(9999, Math.round(job.copies)));

  const unsaved = hasUnsavedWork();
  const auto = !!kind && isAutoPrint(doc.id, job.source);
  // Confirmation AVANT tout remplacement : toujours pour une impression non autorisée
  // d'avance, et pour une simple ouverture si l'étiquette en cours n'est pas enregistrée.
  if ((kind && !auto) || (!kind && unsaved)) {
    const ok = await confirmRemote(doc, kind, job.source, unsaved);
    if (!ok) return { ok: false, count: 0, error: 'annulé par l’utilisateur' };
  }
  // Impression automatique alors que l'étiquette en cours n'est pas enregistrée :
  // on imprime le modèle sans remplacer le travail en cours.
  const replace = !(auto && unsaved);
  if (replace) {
    useStore.getState().loadDoc(editorCopy(doc, injected), true);
    // le document chargé reste « modifié » (loadDoc) : il n'est pas enregistré dans « Mes étiquettes »
    useStore.setState({ previewRow: 0, showData: true });
  } else st.toast(t('Impression automatique de « {d} » : l’étiquette en cours est conservée.', { d: doc.name }), 'info');
  if (!kind) return { ok: true, count: 0 };
  if (kind === 'zebra') useStore.getState().set('printer', 'zebra');
  // le travail porte l'identifiant du modèle (valeurs saisies mémorisées, historique)
  const n = await startJob(kind, { doc, prompts: job.prompts, source: job.source, currentRow: 0 });
  return n == null ? { ok: false, count: 0, error: 'impression annulée ou en échec' } : { ok: true, count: n };
}

/**
 * Copie du modèle pour l'éditeur. Si des données (lignes, copies) ont été injectées,
 * la copie reçoit un nouvel identifiant et un nom distinct : un « Enregistrer » ne
 * remplace pas le modèle de « Mes étiquettes » par les lignes reçues (toutes cochées).
 */
export function editorCopy(doc: LabelDoc, injected: boolean): LabelDoc {
  const d = deepClone(doc);
  if (injected) {
    d.id = uid();
    d.name = t('{n} (données reçues)', { n: doc.name });
  }
  return d;
}

/** Lien : ?modele=… (appelé une fois au démarrage) */
/**
 * Décode les paramètres d'un lien. null = pas de demande (pas de « modele ») ;
 * `{ error }` = paramètre « data » illisible.
 */
export function parseRemoteUrl(search: string): RemoteJob | { error: string } | null {
  const p = new URLSearchParams(search);
  const modele = p.get('modele');
  if (!modele) return null;
  let rows: Record<string, unknown>[] | undefined;
  const data = p.get('data');
  if (data) {
    try {
      const parsed = JSON.parse(decodeBase64Url(data));
      rows = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return { error: t('Paramètre « data » illisible (JSON en base64url attendu)') };
    }
  }
  const prompts: Record<string, string> = {};
  p.forEach((v, k) => {
    if (k.startsWith('invite.')) prompts[k.slice(7)] = v;
  });
  const copies = parseInt(p.get('copies') || '', 10);
  return { modele, rows, prompts, imprimer: p.get('imprimer') || undefined, copies: isNaN(copies) ? undefined : copies, source: 'url' };
}

/** Lien : ?modele=… (appelé une fois au démarrage). Vrai si le lien contenait une demande. */
export function applyRemoteUrl(): boolean {
  return startRemoteUrl() !== null;
}
/** Comme applyRemoteUrl, mais renvoie la promesse du travail (null = pas de demande). */
export function startRemoteUrl(): Promise<RemoteResult> | null {
  const job = parseRemoteUrl(location.search);
  if (!job) return null;
  const lang = new URLSearchParams(location.search).get('lang');
  // le lien n'est traité qu'une fois (pas de réimpression en rafraîchissant la page)
  history.replaceState(null, '', location.pathname + (lang ? `?lang=${lang}` : ''));
  if ('error' in job) {
    useStore.getState().toast(job.error, 'error');
    return Promise.resolve({ ok: false, count: 0, error: job.error });
  }
  return runRemote(job);
}

/** postMessage : à installer une fois */
export function installMessageApi() {
  window.addEventListener('message', async (e: MessageEvent) => {
    const d = e.data as { type?: string; id?: unknown } & Partial<RemoteJob>;
    if (!d || typeof d !== 'object' || d.type !== 'mlz.print') return;
    const source = e.origin && e.origin !== 'null' ? e.origin : 'fichier local';
    let res: RemoteResult;
    try {
      res = await runRemote({
        modele: String(d.modele ?? ''),
        rows: d.rows,
        prompts: d.prompts && typeof d.prompts === 'object' ? Object.fromEntries(Object.entries(d.prompts).map(([k, v]) => [k, String(v)])) : undefined,
        imprimer: d.imprimer,
        copies: typeof d.copies === 'number' ? d.copies : undefined,
        source,
      });
    } catch (err) {
      res = { ok: false, count: 0, error: (err as Error).message };
    }
    const reply = { type: 'mlz.result', id: d.id, ...res };
    try {
      (e.source as Window | null)?.postMessage(reply, e.origin && e.origin !== 'null' ? e.origin : '*');
    } catch {
      /* fenêtre fermée */
    }
  });
  // signale à l'application qui a ouvert / intégré l'éditeur qu'il est prêt
  const ready = { type: 'mlz.ready' };
  try {
    if (window.opener) (window.opener as Window).postMessage(ready, '*');
    if (window.parent && window.parent !== window) window.parent.postMessage(ready, '*');
  } catch {
    /* ignore */
  }
}
