/**
 * Champs saisis à l'impression ({{?Lot}}) : dernières valeurs mémorisées par étiquette
 * (localStorage), utilisées pour pré-remplir la fenêtre de saisie et pour l'affichage
 * dans l'éditeur.
 */
const KEY = 'mlz.prompts.';
const cache = new Map<string, Record<string, string>>();
const listeners = new Set<() => void>();
let version = 0;

export function getLastPrompts(docId: string): Record<string, string> {
  let v = cache.get(docId);
  if (!v) {
    try {
      v = JSON.parse(localStorage.getItem(KEY + docId) || '{}') as Record<string, string>;
    } catch {
      v = {};
    }
    cache.set(docId, v);
  }
  return v;
}

export function setLastPrompts(docId: string, values: Record<string, string>) {
  const next = { ...getLastPrompts(docId), ...values };
  cache.set(docId, next);
  try {
    localStorage.setItem(KEY + docId, JSON.stringify(next));
  } catch {
    /* stockage indisponible */
  }
  version++;
  listeners.forEach((f) => f());
}

export function promptsVersion() {
  return version;
}

export function onPromptsChange(f: () => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}
