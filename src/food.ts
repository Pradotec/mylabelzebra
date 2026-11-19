/**
 * Mentions obligatoires de l'étiquetage alimentaire (règlement UE 1169/2011 « INCO »,
 * art. 9 et 13) : analyse pure d'un document d'après le rôle attribué aux éléments.
 *
 * L'analyse ne remplace pas un contrôle réglementaire : elle signale ce qui manque parmi
 * les mentions toujours obligatoires en rappelant les exemptions courantes, sans bloquer.
 */
import type { FoodRole, LabelDoc, LabelElement, TextEl } from './types';
import { FOOD_ROLES, roleLabel } from './render/foodRoles';
import { incoCheck, incoIndices, isIncoMandatory } from './render/draw';

export { FOOD_ROLES, roleLabel };

/** Groupe de mentions : une mention de la liste suffit (ex. DLC ou DDM) */
export interface FoodRequirement {
  id: string;
  label: string;
  roles: FoodRole[];
  /** always : toujours obligatoire (sauf exemption) ; conditional : selon le produit */
  kind: 'always' | 'conditional';
  /** référence réglementaire */
  ref: string;
  /** exemptions courantes (always) ou cas où la mention est exigée (conditional) */
  note: string;
}

export const FOOD_REQUIREMENTS: FoodRequirement[] = [
  { id: 'denomination', label: 'Dénomination de la denrée', roles: ['denomination'], kind: 'always', ref: 'Art. 9 §1 a)', note: 'Aucune exemption générale.' },
  {
    id: 'ingredients',
    label: 'Liste des ingrédients',
    roles: ['ingredients'],
    kind: 'always',
    ref: 'Art. 9 §1 b), art. 19',
    note: 'Exemptions courantes (art. 19) : fruits et légumes frais non épluchés ni coupés, eaux gazéifiées, vinaigres de fermentation d’un seul produit, fromages, beurre, laits et crèmes fermentés sans autre ingrédient que lactiques, enzymes et cultures, denrées d’un seul ingrédient dont la dénomination permet de l’identifier ; boissons titrant plus de 1,2 % vol.',
  },
  {
    id: 'allergens',
    label: 'Allergènes',
    roles: ['allergens'],
    kind: 'always',
    ref: 'Art. 9 §1 c), art. 21 et annexe II',
    note: 'Exigés seulement si le produit contient une substance de l’annexe II. Ils peuvent être mis en évidence (gras) dans la liste des ingrédients : option « allergènes en gras » sur la liste.',
  },
  {
    id: 'netQuantity',
    label: 'Quantité nette',
    roles: ['netQuantity'],
    kind: 'always',
    ref: 'Art. 9 §1 e), art. 23 et annexe IX',
    note: 'Exemptions (annexe IX) : denrées soumises à des pertes de volume ou de masse vendues au nombre ou pesées devant l’acheteur, quantité nette inférieure à 5 g ou 5 ml (sauf épices et plantes aromatiques), denrées normalement vendues à la pièce si le nombre est visible.',
  },
  {
    id: 'date',
    label: 'Date limite (DLC) ou de durabilité minimale (DDM)',
    roles: ['useBy', 'bestBefore'],
    kind: 'always',
    ref: 'Art. 9 §1 f), art. 24 et annexe X',
    note: 'Exemptions (annexe X 1 d) : fruits et légumes frais non transformés, vins et boissons titrant 10 % vol. ou plus, produits de boulangerie consommés dans les 24 h, vinaigres, sel de cuisine, sucres, confiseries de sucres aromatisés ou colorés, gommes à mâcher.',
  },
  { id: 'operator', label: 'Nom et adresse de l’exploitant', roles: ['operator'], kind: 'always', ref: 'Art. 9 §1 h) et art. 8', note: 'Aucune exemption générale.' },
  {
    id: 'nutrition',
    label: 'Déclaration nutritionnelle',
    roles: ['nutrition'],
    kind: 'always',
    ref: 'Art. 9 §1 l), art. 16 §4 et annexe V',
    note: 'Exemptions (annexe V) : produits non transformés d’un seul ingrédient, eaux, sel, épices, thés et cafés non additionnés, denrées dont la plus grande face mesure moins de 25 cm², denrées artisanales fournies directement en petites quantités au consommateur ou à un commerce local ; boissons titrant plus de 1,2 % vol.',
  },
  { id: 'storage', label: 'Conditions de conservation', roles: ['storage'], kind: 'conditional', ref: 'Art. 9 §1 g), art. 25', note: 'Si la denrée exige des conditions particulières de conservation (produits réfrigérés, après ouverture…).' },
  { id: 'origin', label: 'Pays d’origine / lieu de provenance', roles: ['origin'], kind: 'conditional', ref: 'Art. 9 §1 i), art. 26', note: 'Si son omission peut induire en erreur, et pour certaines viandes (bœuf, porc, ovins, caprins, volailles), le miel, les fruits et légumes, le poisson, l’huile d’olive…' },
  { id: 'instructions', label: 'Mode d’emploi', roles: ['instructions'], kind: 'conditional', ref: 'Art. 9 §1 j), art. 27', note: 'Si son absence rend difficile un usage approprié de la denrée.' },
  { id: 'alcohol', label: 'Titre alcoométrique volumique', roles: ['alcohol'], kind: 'conditional', ref: 'Art. 9 §1 k), art. 28', note: 'Boissons titrant plus de 1,2 % vol.' },
  { id: 'lot', label: 'Numéro de lot', roles: ['lot'], kind: 'conditional', ref: 'Directive 2011/91/UE', note: 'Obligatoire pour la plupart des denrées préemballées ; la date limite peut en tenir lieu si elle comporte au moins le jour et le mois.' },
  { id: 'healthMark', label: 'Estampille sanitaire', roles: ['healthMark'], kind: 'conditional', ref: 'Règl. CE 853/2004, annexe II section I', note: 'Produits d’origine animale issus d’un établissement agréé.' },
];

export interface RequirementStatus {
  req: FoodRequirement;
  /** éléments imprimés portant ce rôle */
  elements: LabelElement[];
  present: boolean;
  /** couvert autrement (allergènes en gras dans la liste des ingrédients) */
  coveredBy?: string;
  /** présent seulement sous condition d'affichage (peut manquer sur certaines lignes) */
  conditional?: boolean;
}

export interface DateIssue {
  el: LabelElement;
  /** format utilisé (sans jour) */
  format: string;
}

export interface IncoIssue {
  el: TextEl;
  thresholdMm: number;
  minMm: number;
  /** nombre d'étiquettes du lot sous le seuil */
  failing: number;
}

export interface FoodReport {
  items: RequirementStatus[];
  /** mentions toujours obligatoires absentes */
  missing: FoodRequirement[];
  /** rappel « même champ visuel » : dénomination, quantité nette, TAV (art. 13 §5) */
  sameField: FoodRole[];
  /** DLC dont le format de date n'a pas de jour (annexe X 2 c) */
  dateIssues: DateIssue[];
  /** mentions sous la hauteur de x minimale (art. 13 §2-3, annexe IV) */
  inco: IncoIssue[];
  /** au moins un élément porte un rôle alimentaire */
  used: boolean;
}

const TOKEN = /\{\{\s*([^}]+?)\s*\}\}/g;
const DATE_KEY = /^(date\s*([+-]\s*\d+)?|aujourd'?hui|aujourd’hui|today|maintenant)$/i;

/**
 * Formats de date produits par les champs d'un texte : filtre « |date:FMT » (le dernier),
 * sinon format du document pour {{date}}, {{date+N}}, {{aujourdhui}}. Les colonnes de
 * données sans filtre date ne sont pas analysables (texte brut).
 */
export function dateFormatsIn(text: string, docFormat: string): string[] {
  const out: string[] = [];
  for (const m of (text || '').matchAll(TOKEN)) {
    const parts = m[1].split('|');
    const key = parts[0].trim();
    let fmt: string | undefined;
    for (const p of parts.slice(1)) {
      const i = p.indexOf(':');
      const name = (i < 0 ? p : p.slice(0, i)).trim().toLowerCase();
      if (name === 'date') fmt = i < 0 || !p.slice(i + 1).trim() ? docFormat : p.slice(i + 1);
    }
    if (fmt === undefined && DATE_KEY.test(key)) fmt = docFormat;
    if (fmt !== undefined) out.push(fmt || 'DD/MM/YYYY');
  }
  return out;
}

/** Le format affiche-t-il le jour (JJ / DD, majuscules ou minuscules) ? */
export const formatHasDay = (fmt: string) => /JJ|DD/i.test(fmt);

const elText = (el: LabelElement) => (el.type === 'text' ? el.text : el.type === 'barcode' ? el.value : '');

/**
 * Analyse de conformité (pure). Un élément masqué n'est pas compté ; un élément soumis à
 * une condition d'affichage est compté comme présent mais signalé « conditionnel ».
 * indices : étiquettes du lot pour le contrôle de hauteur de x (défaut : toutes).
 */
export function analyzeFood(doc: LabelDoc, opts: { indices?: number[] } = {}): FoodReport {
  const els = doc.elements.filter((e) => !e.hidden);
  const items: RequirementStatus[] = FOOD_REQUIREMENTS.map((req) => {
    const list = els.filter((e) => e.role && req.roles.includes(e.role));
    const st: RequirementStatus = { req, elements: list, present: list.length > 0 };
    if (st.present && list.every((e) => !!e.showIf)) st.conditional = true;
    if (!st.present && req.id === 'allergens') {
      const ing = els.find((e) => e.role === 'ingredients' && e.type === 'text' && e.boldAllergens);
      if (ing) {
        st.present = true;
        st.coveredBy = 'ingredients';
      }
    }
    return st;
  });
  const missing = items.filter((i) => i.req.kind === 'always' && !i.present).map((i) => i.req);
  const sameField = (['denomination', 'netQuantity', 'alcohol'] as FoodRole[]).filter((r) => els.some((e) => e.role === r));
  const dateIssues: DateIssue[] = [];
  for (const el of els) {
    if (el.role !== 'useBy') continue;
    const bad = dateFormatsIn(elText(el), doc.date.format || 'DD/MM/YYYY').find((f) => !formatHasDay(f));
    if (bad !== undefined) dateIssues.push({ el, format: bad });
  }
  const indices = opts.indices ?? incoIndices(doc);
  const inco: IncoIssue[] = [];
  for (const el of els) {
    if (!isIncoMandatory(el)) continue;
    const r = incoCheck(el, doc, indices);
    if (r.failing.length) inco.push({ el, thresholdMm: r.thresholdMm, minMm: r.minMm, failing: r.failing.length });
  }
  return { items, missing, sameField, dateIssues, inco, used: els.some((e) => !!e.role) };
}
