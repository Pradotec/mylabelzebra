/**
 * SSCC (Serial Shipping Container Code, AI 00) : compteur persistant par appareil /
 * navigateur, sans doublon, et journal des SSCC émis (traçabilité palette).
 *
 * SSCC = extension (1 chiffre) + préfixe entreprise GS1 (7 à 10 chiffres)
 *        + référence série (16 − longueur du préfixe chiffres) + clé de contrôle = 18 chiffres.
 *
 * Réservation : la plage n'est consommée (compteur avancé) qu'APRÈS le succès du travail.
 * - navigator.locks disponible (navigateurs actuels) : verrou exclusif « mlz-sscc » tenu
 *   pendant tout le travail (lecture du compteur → impression → écriture). Un second
 *   onglet qui imprime en même temps attend la fin du premier : jamais de doublon, jamais
 *   de trou. Limite : pendant la boîte de dialogue d'impression d'un onglet, les travaux
 *   SSCC des autres onglets attendent.
 * - sinon (repli) : réservation atomique AVANT le travail (une transaction IndexedDB
 *   readwrite lit et avance le compteur), puis, si le travail échoue, annulation
 *   seulement si personne n'a réservé entre-temps (sinon la plage est perdue : un trou,
 *   jamais un doublon). Limite : sans IndexedDB (repli localStorage), deux onglets
 *   strictement simultanés ne sont pas protégés l'un de l'autre.
 * Un BroadcastChannel prévient les autres onglets pour rafraîchir l'aperçu.
 */
import { kvGet, kvUpdate } from './storage';
import { gs1Check } from './render/codes';
import { t } from './i18n';
import type { LabelDoc } from './types';

export const CONFIG_KEY = 'sscc.config';
export const LOG_KEY = 'sscc.log';
/** Nombre maximal d'entrées conservées dans le journal (les plus anciennes sont retirées) */
export const MAX_LOG = 20000;
const LOCK_NAME = 'mlz-sscc';

export interface SsccConfig {
  /** préfixe entreprise GS1 (7 à 10 chiffres), '' = non configuré */
  prefix: string;
  /** chiffre d'extension 0-9 */
  extension: number;
  /** prochain numéro de série, par couple extension:préfixe */
  next: Record<string, number>;
  /** plus petit numéro encore jamais émis, par couple (on ne peut pas revenir en dessous) */
  floor: Record<string, number>;
}

/** Plage attribuée à un travail : l'étiquette d'index indices[k] reçoit le numéro start + k */
export interface SsccAssignment {
  prefix: string;
  extension: number;
  start: number;
  indices: number[];
}

/** Document de travail portant sa plage SSCC (champ hors LabelDoc, conservé dans l'historique) */
export type SsccDoc = LabelDoc & { ssccJob?: SsccAssignment };

export interface SsccLogEntry {
  id: string;
  at: number;
  docName: string;
  docId: string;
  /** type de travail (JobKind) */
  kind: string;
  prefix: string;
  extension: number;
  start: number;
  count: number;
  first: string;
  last: string;
  /** index des étiquettes (lignes de données ou numéros de série), dans l'ordre des SSCC */
  indices: number[];
  /** les index sont des lignes de données importées */
  hasData: boolean;
}

export interface SsccJobMeta {
  docName: string;
  docId: string;
  kind: string;
  hasData: boolean;
}

export class SsccError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'SsccError';
  }
}

/** Le travail a abouti mais le compteur n'a pas pu être enregistré (risque de doublon) */
export class SsccCommitError extends SsccError {
  readonly printed = true;
}

// ---------- Fonctions pures ----------

export const defaultConfig = (): SsccConfig => ({ prefix: '', extension: 0, next: {}, floor: {} });
export const isValidPrefix = (p: string) => /^\d{7,10}$/.test(p);
export const counterKey = (extension: number, prefix: string) => `${extension}:${prefix}`;
/** Nombre de chiffres de la référence série */
export const serialLength = (prefix: string) => 16 - prefix.length;
/** Nombre de numéros de série disponibles pour ce préfixe */
export const serialCapacity = (prefix: string) => 10 ** serialLength(prefix);

/** SSCC 18 chiffres (clé de contrôle comprise) */
export function composeSscc(extension: number, prefix: string, serial: number): string {
  const body = `${extension}${prefix}${String(serial).padStart(serialLength(prefix), '0')}`;
  return body + gs1Check(body);
}

/** N SSCC consécutifs à partir du numéro de série « start » */
export function ssccRange(extension: number, prefix: string, start: number, count: number): string[] {
  checkRange(prefix, start, count);
  return Array.from({ length: count }, (_, i) => composeSscc(extension, prefix, start + i));
}

function checkRange(prefix: string, start: number, count: number) {
  const cap = serialCapacity(prefix);
  if (start + count > cap)
    throw new SsccError(
      t('Plage SSCC épuisée pour le préfixe {p} : {n} numéro(s) demandé(s), {r} restant(s). Utilisez une autre extension ou un autre préfixe.', {
        p: prefix,
        n: count,
        r: Math.max(0, cap - start),
      }),
    );
}

export const nextSerial = (c: SsccConfig) => c.next[counterKey(c.extension, c.prefix)] ?? 0;
export const floorSerial = (c: SsccConfig) => c.floor[counterKey(c.extension, c.prefix)] ?? 0;

function normalize(c: Partial<SsccConfig> | undefined): SsccConfig {
  const d = defaultConfig();
  if (!c || typeof c !== 'object') return d;
  return {
    prefix: typeof c.prefix === 'string' ? c.prefix : '',
    extension: Number.isInteger(c.extension) && c.extension! >= 0 && c.extension! <= 9 ? c.extension! : 0,
    next: c.next && typeof c.next === 'object' ? { ...c.next } : {},
    floor: c.floor && typeof c.floor === 'object' ? { ...c.floor } : {},
  };
}

function requireConfigured(c: SsccConfig) {
  if (!isValidPrefix(c.prefix)) throw new SsccError(t('Aucun préfixe entreprise GS1 configuré pour les SSCC (panneau Numéro › SSCC) : travail refusé.'));
}

/** Dans une configuration : réserve « count » numéros (avance le compteur) ; renvoie le départ */
function advance(c: SsccConfig, extension: number, prefix: string, start: number, count: number): SsccConfig {
  const k = counterKey(extension, prefix);
  const end = start + count;
  return {
    ...c,
    next: { ...c.next, [k]: Math.max(c.next[k] ?? 0, end) },
    floor: { ...c.floor, [k]: Math.max(c.floor[k] ?? 0, end) },
  };
}

// ---------- Cache (aperçu synchrone) et notifications ----------

let cache: SsccConfig = defaultConfig();
let version = 0;
const listeners = new Set<() => void>();
const bc: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('mlz-sscc') : null;
if (bc) bc.onmessage = () => void loadSscc();

function setCache(c: SsccConfig, broadcast: boolean) {
  cache = c;
  version++;
  listeners.forEach((f) => f());
  if (broadcast) {
    try {
      bc?.postMessage('changed');
    } catch {
      /* ignore */
    }
  }
}

/** Configuration connue (synchrone, pour l'aperçu) */
export const getSsccConfig = (): SsccConfig => cache;
export const ssccVersion = () => version;
export function onSsccChange(f: () => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

async function readConfig(): Promise<SsccConfig> {
  return normalize(await kvGet<SsccConfig>(CONFIG_KEY));
}

/** Recharge la configuration depuis le stockage */
export async function loadSscc(): Promise<SsccConfig> {
  const c = await readConfig();
  setCache(c, false);
  return c;
}

/** Prochain SSCC prévu pour l'étiquette de rang « offset » (aperçu, NON réservé) ; undefined si non configuré */
export function ssccPreview(offset = 0): string | undefined {
  const c = cache;
  if (!isValidPrefix(c.prefix)) return undefined;
  const s = nextSerial(c) + Math.max(0, offset);
  if (s >= serialCapacity(c.prefix)) return undefined;
  return composeSscc(c.extension, c.prefix, s);
}

/**
 * Enregistre préfixe / extension / prochain numéro. Le prochain numéro ne peut pas
 * redescendre sous le plus haut numéro déjà émis pour ce couple extension:préfixe.
 */
export async function saveSsccSettings(p: { prefix?: string; extension?: number; next?: number }): Promise<SsccConfig> {
  const c = await kvUpdate<SsccConfig>(CONFIG_KEY, (old) => {
    const c = normalize(old);
    if (p.prefix != null) {
      const v = p.prefix.replace(/\s/g, '');
      if (v && !isValidPrefix(v)) throw new SsccError(t('Le préfixe entreprise GS1 doit faire de 7 à 10 chiffres'));
      c.prefix = v;
    }
    if (p.extension != null) {
      if (!Number.isInteger(p.extension) || p.extension < 0 || p.extension > 9) throw new SsccError(t('L’extension SSCC est un chiffre de 0 à 9'));
      c.extension = p.extension;
    }
    if (p.next != null) {
      if (!isValidPrefix(c.prefix)) throw new SsccError(t('Configurez d’abord le préfixe entreprise GS1'));
      const n = Math.floor(p.next);
      if (!Number.isFinite(n) || n < 0 || n >= serialCapacity(c.prefix)) throw new SsccError(t('Numéro de série SSCC hors plage (0 à {m})', { m: serialCapacity(c.prefix) - 1 }));
      const f = floorSerial(c);
      if (n < f) throw new SsccError(t('Impossible de revenir sous {n} : les numéros inférieurs ont déjà été émis (doublons)', { n: f }));
      c.next = { ...c.next, [counterKey(c.extension, c.prefix)]: n };
    }
    return c;
  });
  setCache(c, true);
  return c;
}

// ---------- Réservation ----------

type LockManagerLike = { request: <T>(name: string, cb: () => Promise<T>) => Promise<T> };
const lockManager = (): LockManagerLike | null => {
  const l = (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks;
  return l && typeof l.request === 'function' ? l : null;
};

// file d'attente dans l'onglet (repli sans navigator.locks)
let queue: Promise<unknown> = Promise.resolve();
function inTab<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn);
  queue = p.catch(() => undefined);
  return p;
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

async function appendLog(a: SsccAssignment, meta: SsccJobMeta) {
  const count = a.indices.length;
  const e: SsccLogEntry = {
    id: newId(),
    at: Date.now(),
    docName: meta.docName,
    docId: meta.docId,
    kind: meta.kind,
    prefix: a.prefix,
    extension: a.extension,
    start: a.start,
    count,
    first: composeSscc(a.extension, a.prefix, a.start),
    last: composeSscc(a.extension, a.prefix, a.start + count - 1),
    indices: a.indices,
    hasData: meta.hasData,
  };
  await kvUpdate<SsccLogEntry[]>(LOG_KEY, (old) => {
    const list = Array.isArray(old) ? old : [];
    list.push(e);
    return list.length > MAX_LOG ? list.slice(list.length - MAX_LOG) : list;
  });
}

/** Écrit le compteur après succès ; une nouvelle tentative en cas d'échec passager */
async function commit(a: SsccAssignment, meta: SsccJobMeta) {
  const write = () => kvUpdate<SsccConfig>(CONFIG_KEY, (old) => advance(normalize(old), a.extension, a.prefix, a.start, a.indices.length));
  let c: SsccConfig;
  try {
    c = await write();
  } catch {
    try {
      c = await write();
    } catch (e) {
      throw new SsccCommitError(
        t('Travail effectué mais compteur SSCC NON enregistré ({m}) : réglez le prochain numéro au-delà de {n} avant la prochaine impression.', {
          m: (e as Error)?.message || String(e),
          n: a.start + a.indices.length - 1,
        }),
      );
    }
  }
  setCache(c, true);
  try {
    await appendLog(a, meta);
  } catch (e) {
    throw new SsccCommitError(t('Travail effectué, SSCC {a} à {b} non inscrits au journal : {m}', { a: composeSscc(a.extension, a.prefix, a.start), b: composeSscc(a.extension, a.prefix, a.start + a.indices.length - 1), m: (e as Error)?.message || String(e) }));
  }
}

/**
 * Attribue une plage de SSCC (un par index d'étiquette, copies comprises) et exécute le
 * travail. La plage n'est consommée que si `run` renvoie true. Lève SsccError si le
 * préfixe n'est pas configuré ou si la plage est épuisée (le travail n'est pas lancé),
 * SsccCommitError si le travail a abouti mais que l'enregistrement a échoué.
 */
export async function withSsccRange(indices: number[], meta: SsccJobMeta, run: (a: SsccAssignment) => Promise<boolean>): Promise<boolean> {
  const list = Array.from(new Set(indices));
  const count = Math.max(1, list.length);
  if (!list.length) list.push(0);
  const locks = lockManager();
  if (locks) {
    return locks.request(LOCK_NAME, async () => {
      const c = await readConfig();
      requireConfigured(c);
      const start = nextSerial(c);
      checkRange(c.prefix, start, count);
      const a: SsccAssignment = { prefix: c.prefix, extension: c.extension, start, indices: list };
      const ok = await run(a);
      if (ok) await commit(a, meta);
      return ok;
    });
  }
  return inTab(async () => {
    // repli : réservation atomique immédiate, annulée si le travail échoue
    let a: SsccAssignment | null = null;
    const c = await kvUpdate<SsccConfig>(CONFIG_KEY, (old) => {
      const c = normalize(old);
      requireConfigured(c);
      const start = nextSerial(c);
      checkRange(c.prefix, start, count);
      a = { prefix: c.prefix, extension: c.extension, start, indices: list };
      const k = counterKey(c.extension, c.prefix);
      return { ...c, next: { ...c.next, [k]: start + count } };
    });
    const res = a as unknown as SsccAssignment;
    setCache(c, true);
    let ok = false;
    try {
      ok = await run(res);
    } finally {
      if (!ok) {
        // annulation seulement si personne n'a réservé après nous (sinon : trou, pas de doublon)
        try {
          const back = await kvUpdate<SsccConfig>(CONFIG_KEY, (old) => {
            const x = normalize(old);
            const k = counterKey(res.extension, res.prefix);
            if ((x.next[k] ?? 0) === res.start + count) x.next = { ...x.next, [k]: res.start };
            return x;
          });
          setCache(back, true);
        } catch {
          /* la plage reste consommée : trou sans conséquence */
        }
      }
    }
    if (ok) await commit(res, meta);
    return ok;
  });
}

// ---------- Journal ----------

export async function listSsccLog(): Promise<SsccLogEntry[]> {
  const l = await kvGet<SsccLogEntry[]>(LOG_KEY);
  return Array.isArray(l) ? l.slice().sort((a, b) => b.at - a.at) : [];
}

const p2 = (n: number) => String(n).padStart(2, '0');
const stamp = (at: number) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
};
const csvCell = (s: string) => (/[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);

/**
 * Journal au format CSV (séparateur « ; », une ligne par SSCC, les plus anciens d'abord).
 * Le SSCC est écrit avec son identifiant « (00) » : le tableur le garde comme texte
 * (un nombre de 18 chiffres perdrait ses derniers chiffres dans Excel).
 */
export function ssccLogCsv(entries: SsccLogEntry[]): string {
  const head = [t('Date'), t('Document'), t('Travail'), 'SSCC', t('Ligne / étiquette'), t('Plage')];
  const lines = [head.join(';')];
  for (const e of entries.slice().sort((a, b) => a.at - b.at)) {
    const range = `${e.first}-${e.last}`;
    for (let k = 0; k < e.count; k++) {
      const idx = e.indices[k];
      lines.push(
        [stamp(e.at), e.docName, e.kind, '(00)' + composeSscc(e.extension, e.prefix, e.start + k), idx == null ? '' : String(idx + 1), range].map(csvCell).join(';'),
      );
    }
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** Réinitialise l'état interne (tests) */
export function _resetSsccForTests() {
  cache = defaultConfig();
  queue = Promise.resolve();
  version = 0;
}
