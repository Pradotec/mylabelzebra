/**
 * Bibliothèque de pictogrammes PERSONNELS (Triman / Info-tri, Nutri-Score, logos…) :
 * l'application n'embarque aucun logo officiel (droits Citeo, Santé publique France…) ;
 * l'utilisateur importe ses propres fichiers (SVG / PNG / JPG), stockés localement dans
 * le navigateur et réutilisables dans tous les documents.
 */
import { kvGet, kvSet, storageErrorMessage } from './storage';
import { uid } from './util';

export interface Picto {
  id: string;
  name: string;
  /** data URL de l'image */
  src: string;
  addedAt: number;
}

const KEY = 'pictos';
/** taille maximale d'un fichier importé (le stockage du navigateur est limité) */
export const PICTO_MAX_BYTES = 1_500_000;
export const PICTO_ACCEPT = 'image/svg+xml,image/png,image/jpeg,.svg,.png,.jpg,.jpeg';

export async function listPictos(): Promise<Picto[]> {
  const l = (await kvGet<Picto[]>(KEY)) || [];
  return l.filter((p) => p && typeof p.src === 'string').sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/** Résultat d'une écriture : null = succès, sinon message d'erreur (traduit) */
async function write(list: Picto[]): Promise<string | null> {
  try {
    await kvSet(KEY, list);
    return null;
  } catch (e) {
    return storageErrorMessage(e);
  }
}

/** Nom par défaut tiré du nom de fichier (« triman-fr.svg » → « triman-fr ») */
export function pictoNameFromFile(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]+$/i, '').trim() || 'Pictogramme';
}

/** Type d'image accepté (SVG / PNG / JPG) */
export function isPictoType(type: string, name = ''): boolean {
  return /^image\/(svg\+xml|png|jpeg)$/.test(type) || /\.(svg|png|jpe?g)$/i.test(name);
}

export async function addPicto(name: string, src: string): Promise<{ picto?: Picto; error?: string }> {
  const list = (await kvGet<Picto[]>(KEY)) || [];
  const picto: Picto = { id: uid(), name: name.trim() || 'Pictogramme', src, addedAt: Date.now() };
  const err = await write([...list, picto]);
  return err ? { error: err } : { picto };
}

export async function renamePicto(id: string, name: string): Promise<string | null> {
  const list = (await kvGet<Picto[]>(KEY)) || [];
  return write(list.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name } : p)));
}

export async function deletePicto(id: string): Promise<string | null> {
  const list = (await kvGet<Picto[]>(KEY)) || [];
  return write(list.filter((p) => p.id !== id));
}
