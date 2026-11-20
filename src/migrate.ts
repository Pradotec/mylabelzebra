/**
 * Compatibilité du format de fichier (.mlz.json, « Mes étiquettes », document courant).
 *
 * Règles (voir docs/developpement.md, « Format de fichier et compatibilité ») :
 * - FORMAT_VERSION n'augmente qu'en cas de rupture (champ renommé, supprimé ou dont le
 *   sens change). Un champ facultatif ajouté n'est pas une rupture : normalizeDoc le complète.
 * - Chaque rupture ajoute une migration { from: n } (n → n + 1) dans MIGRATIONS et une
 *   fixture dans src/__fixtures__/.
 * - Un fichier d'une version plus récente s'ouvre au mieux : champs inconnus conservés,
 *   éléments de type inconnu mis de côté (ni rendus, ni perdus) et avertissement remonté.
 *
 * Ce module ne dépend pas de elements.ts (qui l'importe) : il travaille sur des objets bruts.
 */
import type { ElementType, LabelDoc } from './types';
import { t } from './i18n';

/** Version courante du format de LabelDoc */
export const FORMAT_VERSION = 1;

/** Document brut, tel que lu dans un fichier ou dans IndexedDB (rien n'est garanti) */
export type RawDoc = Record<string, unknown> & { elements?: unknown[] };

export interface Migration {
  /** version de départ : la migration produit la version from + 1 */
  from: number;
  /** ce qui change (pour les développeurs) */
  description: string;
  migrate(doc: RawDoc): RawDoc;
}

/**
 * Migrations versionnées, dans l'ordre. Chacune ne s'exécute que sur un document de
 * version ≤ from : elle n'a pas à être idempotente.
 *
 * Exemple pour une future version 2 (renommage d'un champ) :
 *   { from: 1, description: 'zplRaster → zpl.raster', migrate: (d) => { … return d; } },
 * puis FORMAT_VERSION = 2 et une fixture v1 qui le vérifie.
 */
export const MIGRATIONS: Migration[] = [];

/**
 * Corrections héritées, antérieures au numéro de version : des fichiers « version 1 »
 * existent dans les deux formes, elles s'appliquent donc à tout document et DOIVENT
 * être idempotentes (elles détectent l'ancienne forme). N'en ajoutez plus : utilisez MIGRATIONS.
 */
export const LEGACY_FIXES: { description: string; fix(doc: RawDoc): RawDoc }[] = [
  {
    description: 'texte : autoShrink (booléen) → fit (wrapShrink / wrapGrow)',
    fix(doc) {
      if (!Array.isArray(doc.elements)) return doc;
      doc.elements = doc.elements.map((e) => {
        if (!isObj(e) || e.type !== 'text' || e.fit) return e;
        const n: Record<string, unknown> = { ...e, fit: e.autoShrink ? 'wrapShrink' : 'wrapGrow' };
        delete n.autoShrink;
        return n;
      });
      return doc;
    },
  },
];

/**
 * Types d'éléments connus de cette version. Record<ElementType, …> : ajouter un type à
 * LabelElement sans l'inscrire ici est une erreur de compilation.
 */
const KNOWN_TYPES: Record<ElementType, true> = { text: true, barcode: true, qr: true, image: true, shape: true, table: true, mark: true };
export function isKnownElementType(type: unknown): type is ElementType {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(KNOWN_TYPES, type);
}

/** Élément de type inconnu (fichier plus récent) mis de côté avec sa place d'origine */
export interface UnknownElement {
  index: number;
  element: Record<string, unknown>;
}

/** Champs techniques ajoutés au document (absents de LabelDoc, conservés par les copies) */
export interface VersionFields {
  /** version du format du document ; absent = 1 */
  formatVersion?: number;
  /** éléments d'un type inconnu de cette version : jamais rendus, réinsérés à l'export */
  unknownElements?: UnknownElement[];
}

export type MigrationWarning =
  | { kind: 'newerVersion'; version: number; current: number }
  | { kind: 'unknownElements'; count: number; types: string[] };

export interface MigrationResult {
  doc: RawDoc;
  /** version lue (fichier, ou formatVersion du document, 1 à défaut) */
  version: number;
  warnings: MigrationWarning[];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function asVersion(v: unknown): number | undefined {
  const n = Number(v);
  return v != null && v !== '' && Number.isInteger(n) && n >= 1 ? n : undefined;
}

/** Version d'un document brut : son champ formatVersion, 1 à défaut (anciens documents) */
export function docVersion(doc: unknown): number {
  return (isObj(doc) && asVersion(doc.formatVersion)) || 1;
}

/**
 * Amène un document brut à la version courante. Le document est copié (superficiellement)
 * puis estampillé formatVersion = max(version source, FORMAT_VERSION) : un document déjà
 * migré n'est pas re-migré (normalizeDoc passe souvent deux fois sur le même document).
 */
export function migrateDoc(raw: RawDoc, fromVersion = docVersion(raw)): MigrationResult {
  let doc: RawDoc = { ...raw };
  const warnings: MigrationWarning[] = [];
  for (const f of LEGACY_FIXES) doc = f.fix(doc);
  if (fromVersion > FORMAT_VERSION) warnings.push({ kind: 'newerVersion', version: fromVersion, current: FORMAT_VERSION });
  for (const m of [...MIGRATIONS].sort((a, b) => a.from - b.from)) {
    if (m.from >= fromVersion && m.from < FORMAT_VERSION) doc = m.migrate(doc);
  }
  const found = setAsideUnknownElements(doc);
  if (found.length) warnings.push({ kind: 'unknownElements', count: found.length, types: [...new Set(found.map((u) => String(u.element.type)))] });
  doc.formatVersion = Math.max(fromVersion, FORMAT_VERSION);
  return { doc, version: fromVersion, warnings };
}

/**
 * Retire de doc.elements les éléments de type inconnu (ou qui ne sont pas des objets) et
 * les ajoute à doc.unknownElements. Renvoie les éléments nouvellement mis de côté.
 */
function setAsideUnknownElements(doc: RawDoc): UnknownElement[] {
  if (!Array.isArray(doc.elements)) return [];
  const found: UnknownElement[] = [];
  const kept: unknown[] = [];
  doc.elements.forEach((e, i) => {
    if (isObj(e) && isKnownElementType(e.type)) kept.push(e);
    else if (isObj(e)) found.push({ index: i, element: e });
    // une valeur qui n'est pas un objet (null, nombre…) n'a rien à conserver
  });
  if (kept.length === doc.elements.length) return [];
  doc.elements = kept;
  const prev = Array.isArray(doc.unknownElements) ? (doc.unknownElements as UnknownElement[]) : [];
  doc.unknownElements = [...prev, ...found];
  return found;
}

/** Copie du document où les éléments mis de côté reprennent leur place (export) */
export function restoreUnknownElements<T extends LabelDoc>(doc: T): T {
  const side = (doc as T & VersionFields).unknownElements;
  if (!Array.isArray(side) || !side.length) return doc;
  const elements: unknown[] = [...doc.elements];
  for (const u of [...side].sort((a, b) => a.index - b.index)) {
    elements.splice(Math.min(Math.max(0, Number(u.index) || 0), elements.length), 0, u.element);
  }
  const out = { ...doc, elements } as T & VersionFields;
  delete out.unknownElements;
  return out;
}

/**
 * Lit un fichier d'étiquette : texte JSON ou objet déjà analysé, enveloppe
 * { app, version, doc } ou document nu (fichier ancien, JSON collé — traité en version 1,
 * sauf s'il porte son propre formatVersion). Lève une erreur si ce n'est pas une étiquette.
 * Le document renvoyé est migré mais pas complété : passez-le à normalizeDoc.
 */
export function migrateFile(raw: unknown): MigrationResult {
  const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const envelope = isObj(o) && isObj(o.doc);
  const d = envelope ? (o.doc as RawDoc) : o;
  if (!isObj(d) || !Array.isArray(d.elements)) throw new Error(t('Fichier d’étiquette invalide'));
  const version = (envelope && asVersion(o.version)) || docVersion(d);
  return migrateDoc(d, version);
}

/** Texte d'un avertissement, pour l'utilisateur */
export function migrationWarningText(w: MigrationWarning): string {
  if (w.kind === 'newerVersion') {
    return t('Ce fichier vient d’une version plus récente de MyLabelZebra (format {v}, format actuel {cur}) : il est ouvert au mieux, vérifiez l’étiquette avant d’imprimer.', { v: w.version, cur: w.current });
  }
  return t('{n} élément(s) d’un type inconnu ({types}) ne sont pas affichés ; ils sont conservés à l’export.', { n: w.count, types: w.types.join(', ') });
}
