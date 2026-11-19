/**
 * i18n minimaliste : les chaînes sont écrites en français dans le code
 * (`t('Texte')`) ; chaque langue fournit un dictionnaire français → traduction.
 * Pour ajouter une langue : ajouter une entrée dans LANGS et un dictionnaire.
 */
import { EN } from './i18n.en';

export type Lang = 'fr' | 'en';
export const LANGS: { id: Lang; label: string }[] = [
  { id: 'fr', label: 'Français' },
  { id: 'en', label: 'English' },
];

const DICTS: Record<Lang, Record<string, string>> = { fr: {}, en: EN };

function initial(): Lang {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'en' || q === 'fr') return q;
    const v = localStorage.getItem('mlz.lang');
    if (v === 'en' || v === 'fr') return v;
  } catch {
    /* ignore */
  }
  return 'fr';
}

let current: Lang = initial();
const listeners = new Set<() => void>();

export function getLang() {
  return current;
}
export function setLang(l: Lang) {
  current = l;
  try {
    localStorage.setItem('mlz.lang', l);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = l;
  listeners.forEach((f) => f());
}
export function onLangChange(f: () => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

export function t(s: string, vars?: Record<string, string | number>): string {
  let out = DICTS[current][s] ?? s;
  if (vars) for (const k in vars) out = out.split(`{${k}}`).join(String(vars[k]));
  return out;
}
