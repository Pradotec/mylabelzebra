/**
 * Allergènes à déclarer (règlement INCO n° 1169/2011, annexe II) : repérage dans une
 * liste d'ingrédients pour les mettre en gras. Insensible à la casse et aux accents,
 * mots entiers (pluriels en -s / -x acceptés).
 */

/** Les 14 groupes et leurs dénominations / variantes courantes (forme sans accent, minuscules) */
export const ALLERGEN_GROUPS: { label: string; terms: string[] }[] = [
  { label: 'Céréales contenant du gluten', terms: ['gluten', 'ble', 'froment', 'seigle', 'orge', 'avoine', 'epeautre', 'kamut', 'triticale', 'malt'] },
  { label: 'Crustacés', terms: ['crustace', 'crevette', 'crabe', 'homard', 'langoustine', 'langouste', 'ecrevisse'] },
  { label: 'Œufs', terms: ['oeuf', 'ovalbumine', 'lysozyme'] },
  { label: 'Poissons', terms: ['poisson', 'anchois', 'saumon', 'thon', 'cabillaud', 'colin', 'sardine', 'maquereau', 'merlu'] },
  { label: 'Arachides', terms: ['arachide', 'cacahuete', 'cacahouete'] },
  { label: 'Soja', terms: ['soja', 'soya'] },
  { label: 'Lait', terms: ['lait', 'lactose', 'lactoserum', 'beurre', 'babeurre', 'creme', 'fromage', 'caseine', 'caseinate', 'yaourt', 'yoghourt', 'mascarpone', 'mozzarella', 'ricotta', 'parmesan', 'emmental'] },
  { label: 'Fruits à coque', terms: ['fruits a coque', 'fruit a coque', 'amande', 'noisette', 'noix', 'cajou', 'pecan', 'pistache', 'macadamia', 'noix du bresil', 'noix de queensland', 'praline'] },
  { label: 'Céleri', terms: ['celeri', 'celeri-rave'] },
  { label: 'Moutarde', terms: ['moutarde'] },
  { label: 'Graines de sésame', terms: ['sesame', 'tahini', 'tahin'] },
  { label: 'Anhydride sulfureux et sulfites', terms: ['sulfite', 'anhydride sulfureux', 'dioxyde de soufre', 'bisulfite', 'metabisulfite', 'disulfite'] },
  { label: 'Lupin', terms: ['lupin'] },
  { label: 'Mollusques', terms: ['mollusque', 'huitre', 'calamar', 'calmar', 'poulpe', 'seiche', 'coquille saint-jacques', 'saint-jacques', 'bulot', 'palourde'] },
];

/** « Faux amis » : lait de coco, beurre de cacao, noix de muscade… */
const NOT_FOLLOWED = String.raw`(?!\s+(?:de|d')\s*(?:coco|cacao|karite|muscade|cassis))`;

const foldChar = (ch: string) => {
  const l = ch.toLowerCase();
  if (l === 'œ') return 'oe';
  if (l === 'æ') return 'ae';
  if (l === '’' || l === 'ʼ') return "'";
  return l.normalize('NFD').replace(/[̀-ͯ]/g, '');
};
const fold = (s: string) => Array.from(s).map(foldChar).join('');
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');

const reCache = new Map<string, RegExp>();
function regexFor(extra: string[]) {
  const key = extra.join('\u0001');
  let re = reCache.get(key);
  if (re) return re;
  const terms = new Set<string>();
  ALLERGEN_GROUPS.forEach((g) => g.terms.forEach((x) => terms.add(x)));
  extra.map((x) => fold(x.trim())).filter(Boolean).forEach((x) => terms.add(x));
  const alt = Array.from(terms)
    .sort((a, b) => b.length - a.length)
    .map(esc)
    .join('|');
  re = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${alt})(?:s|x)?(?![\p{L}\p{N}])${NOT_FOLLOWED}`, 'gu');
  if (reCache.size > 20) reCache.clear();
  reCache.set(key, re);
  return re;
}

/**
 * Masque « gras » par unité UTF-16 du texte (true = allergène), ou null si aucun allergène.
 */
export function allergenMask(text: string, extra: string[] = []): boolean[] | null {
  if (!text) return null;
  // texte replié (minuscules sans accents) + correspondance vers les positions d'origine
  let norm = '';
  const map: number[] = [];
  let i = 0;
  for (const ch of text) {
    const f = foldChar(ch);
    for (let k = 0; k < f.length; k++) map.push(i);
    norm += f;
    i += ch.length;
  }
  const re = regexFor(extra);
  re.lastIndex = 0;
  let mask: boolean[] | null = null;
  for (const m of norm.matchAll(re)) {
    if (!mask) mask = new Array(text.length).fill(false);
    const s = map[m.index!];
    const eNorm = m.index! + m[0].length - 1;
    const e = map[eNorm];
    // fin : couvrir toute l'unité de code (caractères hors BMP)
    const end = e + (text.codePointAt(e)! > 0xffff ? 2 : 1);
    for (let k = s; k < end; k++) mask[k] = true;
  }
  return mask;
}

/** Liste des allergènes trouvés (formes d'origine, sans doublons) */
export function allergensFound(text: string, extra: string[] = []): string[] {
  const m = allergenMask(text, extra);
  if (!m) return [];
  const out: string[] = [];
  let cur = '';
  for (let k = 0; k <= text.length; k++) {
    if (k < text.length && m[k]) cur += text[k];
    else if (cur) {
      if (!out.some((x) => x.toLowerCase() === cur.toLowerCase())) out.push(cur);
      cur = '';
    }
  }
  return out;
}
