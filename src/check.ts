/**
 * « Vérifier le lot » : contrôle des lignes à imprimer avant l'impression (logique pure).
 * - colonne {{…}} utilisée par le modèle mais absente des données (une alerte globale) ;
 * - code-barres dont la valeur résolue est refusée par sa symbologie (même validation que le rendu) ;
 * - texte ou code dont la valeur résolue est vide (« / » compte comme vide pour un code) ;
 * - texte réduit jusqu'à sa taille minimale ou tronqué (même mise en page que le rendu) ;
 * - même valeur de code-barres sur plusieurs lignes.
 */
import type { LabelDoc, LabelElement, TextEl, BarcodeEl, Symbology } from './types';
import { resolveText, isPrinted, fieldKeys, isSpecialKey, conditionKey, textOf, type ResolveCtx } from './render/resolve';
import { encodeBarcode, normalizeBarcode } from './render/codes';
import { elText } from './render/draw';
import { layoutText, fitMode, isCurved } from './render/textLayout';
import { t } from './i18n';

export type IssueKind = 'missingColumn' | 'invalidCode' | 'emptyField' | 'textFit' | 'duplicateCode';

export interface Issue {
  /** index de la ligne (0 = première) ; -1 = alerte globale (modèle) */
  row: number;
  elementId?: string;
  kind: IssueKind;
  message: string;
}

/** Ordre d'affichage des groupes */
export const ISSUE_KINDS: IssueKind[] = ['missingColumn', 'invalidCode', 'emptyField', 'duplicateCode', 'textFit'];

export interface CheckOptions {
  /** lignes à contrôler (défaut : checkRows(doc)) */
  rows?: number[];
  /** contrôle de la mise en page des textes (défaut true) */
  layout?: boolean;
}

/** Lignes contrôlées : les lignes cochées, sinon toutes les lignes */
export function checkRows(doc: LabelDoc): number[] {
  const d = doc.data;
  if (!d) return [];
  const all = d.rows.map((_, i) => i);
  const checked = all.filter((i) => d.checked[i]);
  return checked.length ? checked : all;
}

/** Colonnes {{…}} utilisées par les éléments visibles mais absentes des données */
export function missingColumns(doc: LabelDoc): string[] {
  const d = doc.data;
  if (!d) return [];
  const cols = new Set(d.columns);
  const lower = new Set(d.columns.map((c) => c.trim().toLowerCase()));
  const out: string[] = [];
  const add = (key: string) => {
    const k = key.trim();
    if (!k || isSpecialKey(k) || cols.has(k) || lower.has(k.toLowerCase()) || out.includes(k)) return;
    out.push(k);
  };
  for (const el of doc.elements) {
    if (el.hidden) continue;
    fieldKeys(textOf(el)).forEach(add);
    if (el.showIf?.field) add(conditionKey(el.showIf));
    if (el.showIf?.value) fieldKeys(el.showIf.value).forEach(add);
  }
  return out;
}

/** Taille minimale effective d'un texte (même calcul que layoutText) */
function minFontSize(el: TextEl): number {
  const base = Math.max(1, el.fontSize);
  return Math.min(base, Math.max(2, el.minFontSize ?? Math.max(4, base * 0.3)));
}

type FitResult = 'min' | 'truncated' | null;

/**
 * Symbologies entièrement validées par normalizeBarcode (longueur, jeu de caractères, clé) :
 * l'encodage complet (bwip-js, ~1 ms par valeur) n'est nécessaire que pour les codes GS1 à AI,
 * les codes 2D (capacité) et le Code 128 hors ASCII imprimable.
 */
const NORMALIZE_ONLY = new Set<Symbology>(['ean13', 'ean8', 'upca', 'upce', 'interleaved2of5', 'sscc18', 'code39', 'code93', 'rationalizedCodabar', 'databaromni', 'databarstackedomni']);

/** Message d'erreur du code pour cette valeur (même validation que le rendu), null si valide */
export function codeError(value: string, s: Symbology): string | null {
  const n = normalizeBarcode(value, s);
  if ('error' in n) return n.error;
  if (NORMALIZE_ONLY.has(s) || (s === 'code128' && /^[\x20-\x7e]+$/.test(value))) return null;
  const r = encodeBarcode(value, s);
  return 'error' in r && r.error ? r.error : null;
}

/**
 * Parcours ligne par ligne : ajoute les anomalies à « out » et rend la main après chaque
 * ligne (nombre de lignes traitées), pour une exécution par tranches.
 */
function* steps(doc: LabelDoc, rows: number[], opts: CheckOptions, out: Issue[]): Generator<number, void> {
  for (const c of missingColumns(doc)) out.push({ row: -1, kind: 'missingColumn', message: t('Colonne {{{c}}} absente des données (faute de frappe ?)', { c }) });

  const layout = opts.layout !== false;
  const codes = doc.elements.filter((e): e is BarcodeEl => e.type === 'barcode' && !e.hidden);
  const texts = doc.elements.filter((e): e is TextEl => e.type === 'text' && !e.hidden);
  const codeErr = new Map<string, string | null>();
  const fitCache = new Map<string, Map<string, FitResult>>();
  /**
   * valeurs de chaque code-barres alimenté par une colonne : valeur → première ligne
   * (un code fixe ou ne dépendant que d'une saisie est forcément identique partout)
   */
  const seen = new Map<string, Map<string, number>>(codes.filter((e) => fieldKeys(e.value).some((k) => !isSpecialKey(k))).map((e) => [e.id, new Map()]));

  let done = 0;
  for (const row of rows) {
    const ctx: ResolveCtx = { doc, index: row, row: doc.data?.rows[row], resolve: true };
    for (const el of codes) {
      if (!isPrinted(el, ctx)) continue;
      const v = resolveText(el.value, ctx).trim();
      if (!v || v === '/') {
        out.push({ row, elementId: el.id, kind: 'emptyField', message: v ? t('Code-barres sans valeur (« / »)') : t('Code-barres vide') });
        continue;
      }
      const key = el.symbology + '\u0000' + v;
      let err = codeErr.get(key);
      if (err === undefined) {
        err = codeError(v, el.symbology);
        if (codeErr.size > 20000) codeErr.clear();
        codeErr.set(key, err);
      }
      if (err) out.push({ row, elementId: el.id, kind: 'invalidCode', message: `${err} — ${v}` });
      const m = seen.get(el.id);
      if (!m) continue;
      const first = m.get(v);
      if (first === undefined) m.set(v, row);
      else out.push({ row, elementId: el.id, kind: 'duplicateCode', message: t('Même code que la ligne {n} : {v}', { n: first + 1, v }) });
    }
    for (const el of texts) {
      if (!isPrinted(el, ctx)) continue;
      const usesData = el.text.includes('{{');
      const txt = elText(el, ctx);
      if (!txt.trim()) {
        if (usesData) out.push({ row, elementId: el.id, kind: 'emptyField', message: t('Texte vide') });
        continue;
      }
      if (!layout || isCurved(el)) continue;
      let cache = fitCache.get(el.id);
      if (!cache) fitCache.set(el.id, (cache = new Map()));
      let fit = cache.get(txt);
      if (fit === undefined) {
        const L = layoutText(el, txt, doc.allergensExtra);
        const mode = fitMode(el);
        const min = minFontSize(el);
        fit = L.truncated ? 'truncated' : (mode === 'shrinkLine' || mode === 'wrapShrink') && min < el.fontSize && L.fontSize <= min + Math.max(0.1, min * 0.02) ? 'min' : null;
        if (cache.size > 2000) cache.clear();
        cache.set(txt, fit);
      }
      if (fit) out.push({ row, elementId: el.id, kind: 'textFit', message: fit === 'truncated' ? t('Texte tronqué (ne tient pas dans son cadre)') : t('Texte réduit jusqu’à sa taille minimale') });
    }
    yield ++done;
  }
}

/** Trie les anomalies : globales d'abord, puis par ligne et par ordre des éléments */
function sortIssues(doc: LabelDoc, list: Issue[]): Issue[] {
  const pos = new Map(doc.elements.map((e, i) => [e.id, i]));
  return list
    .map((x, i) => ({ x, i }))
    .sort((a, b) => a.x.row - b.x.row || (pos.get(a.x.elementId ?? '') ?? -1) - (pos.get(b.x.elementId ?? '') ?? -1) || a.i - b.i)
    .map((o) => o.x);
}

/** Vérification complète, synchrone */
export function checkBatch(doc: LabelDoc, opts: CheckOptions = {}): Issue[] {
  const out: Issue[] = [];
  const rows = opts.rows ?? checkRows(doc);
  for (const _ of steps(doc, rows, opts, out)) void _;
  return sortIssues(doc, out);
}

export interface AsyncCheckOptions extends CheckOptions {
  /** progression (lignes traitées, total) */
  onProgress?: (done: number, total: number) => void;
  /** arrêt demandé → la promesse renvoie null */
  isCancelled?: () => boolean;
  /** temps de calcul par tranche avant de rendre la main au navigateur (ms) */
  budgetMs?: number;
}

/** Vérification par tranches (l'interface reste fluide sur des milliers de lignes) */
export async function checkBatchAsync(doc: LabelDoc, opts: AsyncCheckOptions = {}): Promise<Issue[] | null> {
  const out: Issue[] = [];
  const rows = opts.rows ?? checkRows(doc);
  const budget = opts.budgetMs ?? 12;
  const it = steps(doc, rows, opts, out);
  let start = Date.now();
  for (;;) {
    const r = it.next();
    if (r.done) break;
    if (Date.now() - start >= budget) {
      opts.onProgress?.(r.value, rows.length);
      await new Promise((res) => setTimeout(res, 0));
      if (opts.isCancelled?.()) return null;
      start = Date.now();
    }
  }
  opts.onProgress?.(rows.length, rows.length);
  return sortIssues(doc, out);
}

/** Lignes concernées par au moins une anomalie (hors alertes globales), dans l'ordre */
export function issueRows(list: Issue[]): number[] {
  return Array.from(new Set(list.filter((x) => x.row >= 0).map((x) => x.row))).sort((a, b) => a - b);
}

/** Nom court d'un élément pour la liste des anomalies */
export function elementLabel(el: LabelElement | undefined): string {
  if (!el) return '';
  if (el.name) return el.name;
  const s = textOf(el).replace(/\s+/g, ' ').trim();
  return s.length > 28 ? s.slice(0, 27) + '…' : s || el.type;
}
