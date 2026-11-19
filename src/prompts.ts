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

// ---------- Options des champs à saisir : {{?Nom|liste:A;B|obligatoire|gtin|regex:…|min:0|max:9}} ----------

export type PromptOption =
  | { kind: 'liste'; choices: string[] }
  | { kind: 'obligatoire' }
  | { kind: 'gtin' }
  | { kind: 'regex'; pattern: string }
  | { kind: 'min'; value: number }
  | { kind: 'max'; value: number };

/** Description d'un champ à saisir (fusion des options de toutes ses occurrences) */
export interface PromptSpec {
  name: string;
  /** text = saisie libre ; list = liste déroulante ; gtin = code GTIN-8/12/13/14 contrôlé ; number = nombre borné */
  type: 'text' | 'list' | 'gtin' | 'number';
  required: boolean;
  choices?: string[];
  pattern?: string;
  min?: number;
  max?: number;
}

/** Message d'erreur à traduire avec t(msg, vars) */
export interface PromptError {
  msg: string;
  vars?: Record<string, string | number>;
}

/** Nombre « 1 234,5 » ou « 1234.5 » (copie locale de parseNumber, sans dépendance circulaire) */
function num(s: string): number {
  const v = s.replace(/[\s  ]/g, '').replace(',', '.');
  return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(v) ? parseFloat(v) : NaN;
}

/**
 * Filtre d'un champ {{?Nom|…}} reconnu comme option de saisie (null = vrai filtre).
 * « min » / « max » ne sont des options qu'avec un argument numérique (« min » seul = minuscules).
 */
export function parsePromptOption(name: string, arg: string): PromptOption | null {
  switch (name) {
    case 'liste':
    case 'choix': {
      const choices = arg.split(';').map((x) => x.trim()).filter(Boolean);
      return { kind: 'liste', choices };
    }
    case 'obligatoire':
    case 'requis':
      return { kind: 'obligatoire' };
    case 'gtin':
      return { kind: 'gtin' };
    case 'regex':
      return { kind: 'regex', pattern: arg };
    case 'min':
    case 'max': {
      const v = num(arg);
      if (isNaN(v)) return null;
      return name === 'min' ? { kind: 'min', value: v } : { kind: 'max', value: v };
    }
  }
  return null;
}

/** Ajoute des options à la description d'un champ */
export function mergePromptSpec(spec: PromptSpec, opts: PromptOption[]): PromptSpec {
  const s: PromptSpec = { ...spec };
  for (const o of opts) {
    switch (o.kind) {
      case 'liste':
        s.choices = Array.from(new Set([...(s.choices ?? []), ...o.choices]));
        s.type = 'list';
        break;
      case 'obligatoire':
        s.required = true;
        break;
      case 'gtin':
        if (s.type === 'text') s.type = 'gtin';
        break;
      case 'regex':
        s.pattern = o.pattern;
        break;
      case 'min':
        s.min = o.value;
        if (s.type === 'text') s.type = 'number';
        break;
      case 'max':
        s.max = o.value;
        if (s.type === 'text') s.type = 'number';
        break;
    }
  }
  return s;
}

/** Clé de contrôle GS1 (modulo 10) des chiffres donnés sans la clé */
export function gs1CheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

/** GTIN-8 / 12 / 13 / 14 avec clé correcte */
export function isValidGtin(s: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(s)) return false;
  return gs1CheckDigit(s.slice(0, -1)) === Number(s[s.length - 1]);
}

/**
 * Vérifie une valeur saisie (pure). null = valide ; sinon message à traduire.
 * Une valeur vide n'est refusée que si le champ est obligatoire.
 */
export function validatePrompt(spec: PromptSpec, raw: string): PromptError | null {
  const v = (raw ?? '').trim();
  if (!v) return spec.required ? { msg: 'Champ obligatoire' } : null;
  if (spec.choices?.length && !spec.choices.includes(v)) return { msg: 'Choisissez une valeur de la liste' };
  if (spec.type === 'gtin') {
    if (!/^\d+$/.test(v)) return { msg: 'Le GTIN ne doit contenir que des chiffres' };
    if (![8, 12, 13, 14].includes(v.length)) return { msg: 'Le GTIN doit faire 8, 12, 13 ou 14 chiffres ({n} saisis)', vars: { n: v.length } };
    const key = gs1CheckDigit(v.slice(0, -1));
    if (key !== Number(v[v.length - 1])) return { msg: 'Clé de contrôle GTIN incorrecte (attendue : {k})', vars: { k: key } };
  }
  if (spec.min != null || spec.max != null) {
    const n = num(v);
    if (isNaN(n)) return { msg: 'Nombre attendu' };
    if (spec.min != null && n < spec.min) return { msg: 'Valeur minimale : {n}', vars: { n: String(spec.min).replace('.', ',') } };
    if (spec.max != null && n > spec.max) return { msg: 'Valeur maximale : {n}', vars: { n: String(spec.max).replace('.', ',') } };
  }
  if (spec.pattern) {
    let re: RegExp;
    try {
      re = new RegExp('^(?:' + spec.pattern + ')$', 'u');
    } catch {
      return null; // expression invalide : ignorée (signalée par promptSpecErrors)
    }
    if (!re.test(v)) return { msg: 'Format attendu : {p}', vars: { p: spec.pattern } };
  }
  return null;
}

/** Vérifie toutes les valeurs ; renvoie les erreurs par nom de champ (objet vide = tout est valide) */
export function validatePrompts(specs: PromptSpec[], values: Record<string, string>): Record<string, PromptError> {
  const out: Record<string, PromptError> = {};
  for (const s of specs) {
    const e = validatePrompt(s, values[s.name] ?? '');
    if (e) out[s.name] = e;
  }
  return out;
}
