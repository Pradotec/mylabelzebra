/**
 * File d'impression unique : impressions lancées depuis l'éditeur, le mode poste et les
 * demandes venues d'autres outils (lien, postMessage). Les travaux s'exécutent un par un,
 * dans l'ordre d'arrivée.
 *
 * Chaque travail a un statut visible (en attente, en cours — paquet i/n —, en pause,
 * terminé, erreur, annulé) et peut être mis en pause, repris ou annulé :
 * - la pause demandée par l'utilisateur prend effet au prochain point d'arrêt (entre deux
 *   paquets d'étiquettes) ;
 * - un travail peut se mettre lui-même en pause sur un problème (imprimante pas prête) et
 *   attendre la décision : reprendre, envoyer quand même (état illisible) ou annuler ;
 * - annuler un travail en attente le retire avant tout envoi.
 */
import { create } from 'zustand';
import { CancelledError, isCancelled } from './progress';
import { uid } from './util';

export type QueueStatus = 'pending' | 'running' | 'paused' | 'done' | 'error' | 'cancelled';

export interface QueueItem {
  id: string;
  /** nom de l'étiquette ou de la demande */
  name: string;
  /** type de sortie (JobKind) ou 'remote' pour une demande distante */
  kind: string;
  /** origine : 'url', origine postMessage, mode poste… */
  source?: string;
  status: QueueStatus;
  /** étiquettes prévues / envoyées */
  total: number;
  sent: number;
  /** paquet en cours (1…chunks), 0 = pas de découpage */
  chunk: number;
  chunks: number;
  /** message affiché (problème d'imprimante, erreur, résumé) */
  message?: string;
  /** la pause vient d'un problème (et non de l'utilisateur) */
  problem?: boolean;
  /** « Envoyer quand même » proposé (état de l'imprimante illisible) */
  canForce?: boolean;
  /** pause demandée, effective au prochain point d'arrêt */
  pauseRequested?: boolean;
  /** entrée d'historique du travail (reprise possible s'il est incomplet) */
  historyId?: string;
  createdAt: number;
  endedAt?: number;
}

export const useQueue = create<{ items: QueueItem[] }>()(() => ({ items: [] }));

/** Nombre maximal de travaux terminés gardés dans la liste */
const KEEP_FINISHED = 30;

export const isActive = (s: QueueStatus) => s === 'pending' || s === 'running' || s === 'paused';
export const activeCount = (items: QueueItem[]) => items.filter((i) => isActive(i.status)).length;

export type Decision = 'resume' | 'force' | 'cancel';

interface Internal {
  cancel: boolean;
  pause: boolean;
  waiter: ((d: Decision) => void) | null;
}
const internals = new Map<string, Internal>();

function patch(id: string, p: Partial<QueueItem>) {
  useQueue.setState((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...p } : i)) }));
}
const get = (id: string) => useQueue.getState().items.find((i) => i.id === id);

/** Commandes d'un travail en cours d'exécution */
export interface QueueCtl {
  readonly id: string;
  update(p: Partial<Pick<QueueItem, 'name' | 'total' | 'sent' | 'chunk' | 'chunks' | 'message' | 'historyId'>>): void;
  /**
   * Point d'arrêt (entre deux paquets) : lève CancelledError si le travail est annulé,
   * attend la reprise si une pause a été demandée.
   */
  checkpoint(): Promise<void>;
  /** Met le travail en pause sur un problème et attend la décision de l'utilisateur */
  problem(message: string, canForce?: boolean): Promise<Decision>;
  /** Fixe le statut final (sinon : terminé, ou annulé / erreur si `run` lève) */
  finish(status: 'done' | 'error' | 'cancelled', message?: string): void;
  isCancelled(): boolean;
}

function waitDecision(id: string): Promise<Decision> {
  const it = internals.get(id)!;
  return new Promise((resolve) => {
    it.waiter = (d) => {
      it.waiter = null;
      resolve(d);
    };
  });
}

function makeCtl(id: string, final: { status?: 'done' | 'error' | 'cancelled'; message?: string }): QueueCtl {
  const it = internals.get(id)!;
  return {
    id,
    update: (p) => patch(id, p),
    async checkpoint() {
      if (it.cancel) throw new CancelledError();
      if (it.pause) {
        patch(id, { status: 'paused', pauseRequested: false, problem: false, canForce: false });
        const d = await waitDecision(id);
        if (d === 'cancel' || it.cancel) throw new CancelledError();
        patch(id, { status: 'running', message: undefined });
      }
    },
    async problem(message, canForce = false) {
      if (it.cancel) return 'cancel';
      patch(id, { status: 'paused', message, problem: true, canForce, pauseRequested: false });
      const d = await waitDecision(id);
      it.pause = false;
      if (d !== 'cancel' && !it.cancel) patch(id, { status: 'running', message: undefined, problem: false, canForce: false });
      return it.cancel ? 'cancel' : d;
    },
    finish(status, message) {
      final.status = status;
      final.message = message;
    },
    isCancelled: () => it.cancel,
  };
}

function prune() {
  useQueue.setState((s) => {
    const finished = s.items.filter((i) => !isActive(i.status));
    if (finished.length <= KEEP_FINISHED) return s;
    const drop = new Set(finished.slice(0, finished.length - KEEP_FINISHED).map((i) => i.id));
    return { items: s.items.filter((i) => !drop.has(i.id)) };
  });
}

let chain: Promise<unknown> = Promise.resolve();

export interface EnqueueMeta {
  name: string;
  kind: string;
  source?: string;
  total?: number;
}

/**
 * Ajoute un travail à la file. `run` est appelé à son tour avec les commandes du travail ;
 * la promesse renvoie son résultat, ou null s'il a été annulé avant de démarrer ou a levé
 * une erreur (statut « annulé » / « erreur »).
 */
export function enqueue<R>(meta: EnqueueMeta, run: (ctl: QueueCtl) => Promise<R>): Promise<R | null> {
  const id = uid();
  internals.set(id, { cancel: false, pause: false, waiter: null });
  const item: QueueItem = { id, name: meta.name, kind: meta.kind, source: meta.source, status: 'pending', total: meta.total ?? 0, sent: 0, chunk: 0, chunks: 0, createdAt: Date.now() };
  useQueue.setState((s) => ({ items: [...s.items, item] }));
  const p = chain.then(async (): Promise<R | null> => {
    const it = internals.get(id)!;
    const final: { status?: 'done' | 'error' | 'cancelled'; message?: string } = {};
    const ctl = makeCtl(id, final);
    try {
      if (it.cancel) {
        patch(id, { status: 'cancelled', endedAt: Date.now() });
        return null;
      }
      patch(id, { status: 'running' });
      await ctl.checkpoint(); // pause demandée pendant l'attente
      const r = await run(ctl);
      patch(id, { status: final.status ?? (it.cancel ? 'cancelled' : 'done'), message: final.message ?? get(id)?.message, endedAt: Date.now(), pauseRequested: false, problem: false, canForce: false });
      return r;
    } catch (e) {
      const cancelled = isCancelled(e);
      patch(id, { status: cancelled ? 'cancelled' : 'error', message: cancelled ? final.message : (e as Error)?.message || String(e), endedAt: Date.now(), pauseRequested: false, problem: false, canForce: false });
      return null;
    } finally {
      internals.delete(id);
      prune();
    }
  });
  chain = p.catch(() => undefined);
  return p;
}

/** Pause : immédiate pour un travail en attente, au prochain paquet pour un travail en cours */
export function pauseJob(id: string) {
  const it = internals.get(id);
  const item = get(id);
  if (!it || !item || !isActive(item.status) || item.status === 'paused') return;
  it.pause = true;
  patch(id, { pauseRequested: true });
}

/** Reprend un travail en pause (après un problème : nouvelle vérification de l'imprimante) */
export function resumeJob(id: string) {
  const it = internals.get(id);
  if (!it) return;
  it.pause = false;
  patch(id, { pauseRequested: false });
  it.waiter?.('resume');
}

/** « Envoyer quand même » (état illisible) */
export function forceJob(id: string) {
  const it = internals.get(id);
  if (!it) return;
  it.pause = false;
  it.waiter?.('force');
}

/** Annule un travail (en attente : retiré ; en cours : arrêté au prochain paquet) */
export function cancelJob(id: string) {
  const it = internals.get(id);
  const item = get(id);
  if (!it || !item) return;
  it.cancel = true;
  if (item.status === 'pending') patch(id, { status: 'cancelled', endedAt: Date.now(), pauseRequested: false });
  it.waiter?.('cancel');
}

/** Retire les travaux terminés de la liste */
export function clearFinished() {
  useQueue.setState((s) => ({ items: s.items.filter((i) => isActive(i.status)) }));
}

/** Réinitialise la file (tests) */
export function _resetQueueForTests() {
  for (const it of internals.values()) {
    it.cancel = true;
    it.waiter?.('cancel');
  }
  internals.clear();
  chain = Promise.resolve();
  useQueue.setState({ items: [] });
}
