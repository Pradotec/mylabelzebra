/**
 * Progression des traitements longs (exports de masse, impression) avec annulation.
 *
 *   const p = beginProgress(t('Export PDF'), n);
 *   try { for (...) { await p.step(); ... } } finally { p.end(); }
 *
 * `step()` cède la main au navigateur (l'interface reste réactive, la barre se met à
 * jour) et lève `CancelledError` si l'utilisateur a cliqué sur « Annuler ».
 */
import { create } from 'zustand';
import { t } from './i18n';

export class CancelledError extends Error {
  constructor() {
    super(t('Opération annulée'));
    this.name = 'CancelledError';
  }
}
export const isCancelled = (e: unknown) => e instanceof CancelledError || (e as Error)?.name === 'CancelledError';

export interface ProgressState {
  /** null = aucun traitement en cours */
  label: string | null;
  done: number;
  total: number;
  cancelRequested: boolean;
  /** identifiant du traitement en cours (évite qu'un ancien end() n'efface un nouveau) */
  token: number;
}

export const useProgress = create<ProgressState>()(() => ({ label: null, done: 0, total: 0, cancelRequested: false, token: 0 }));

/** Demande l'annulation du traitement en cours */
export function cancelProgress() {
  if (useProgress.getState().label != null) useProgress.setState({ cancelRequested: true });
}

/** Cède la main au navigateur (rendu, événements) */
export function yieldToBrowser(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

export interface ProgressHandle {
  /** cède la main, vérifie l'annulation, puis avance de `n` (0 = vérifie seulement) */
  step(n?: number): Promise<void>;
  /** lève CancelledError si l'annulation a été demandée */
  check(): void;
  /** change le libellé (ex. « Compression… ») */
  setLabel(label: string): void;
  end(): void;
}

let seq = 0;

export function beginProgress(label: string, total: number): ProgressHandle {
  const token = ++seq;
  useProgress.setState({ label, done: 0, total: Math.max(0, total), cancelRequested: false, token });
  const mine = () => useProgress.getState().token === token;
  const check = () => {
    if (mine() && useProgress.getState().cancelRequested) throw new CancelledError();
  };
  let last = 0;
  return {
    async step(n = 1) {
      // céder à chaque étape coûte ~4 ms (setTimeout bridé) : au plus toutes les 30 ms
      const now = Date.now();
      if (now - last > 30) {
        last = now;
        await yieldToBrowser();
      }
      check();
      if (n && mine()) useProgress.setState((s) => ({ done: Math.min(s.total, s.done + n) }));
    },
    check,
    setLabel(l: string) {
      if (mine()) useProgress.setState({ label: l });
    },
    end() {
      if (mine()) useProgress.setState({ label: null, done: 0, total: 0, cancelRequested: false });
    },
  };
}
