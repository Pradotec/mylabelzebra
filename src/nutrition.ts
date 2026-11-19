/**
 * Déclaration nutritionnelle — règlement (UE) n° 1169/2011 (INCO).
 *
 * Énergie : facteurs de conversion de l'annexe XIV (kJ / kcal par gramme) :
 *   glucides (hors polyols) 17 / 4, polyols 10 / 2,4, protéines 17 / 4, lipides 37 / 9,
 *   alcool (éthanol) 29 / 7, fibres alimentaires 8 / 2.
 *   (Non gérés ici : salatrims 25 / 6, acides organiques 13 / 3, érythritol 0 / 0.)
 *   Les « glucides » déclarés incluent les polyols (annexe I, point 7) : l'énergie compte
 *   donc (glucides − polyols) × 17 + polyols × 10.
 *
 * Arrondis : « Guidance document for competent authorities for the control of compliance
 * with EU legislation on Regulation (EU) No 1169/2011 […] with regard to the setting of
 * tolerances for nutrient values declared on a label », Commission européenne,
 * décembre 2012 — tableau « Rounding guidelines for nutrition declaration » (section 6) :
 *   - énergie : au kJ / à la kcal près ;
 *   - matières grasses, glucides, sucres, protéines, fibres, polyols, amidon :
 *       ≥ 10 g → au gramme ; < 10 g et > 0,5 g → à 0,1 g ;
 *       ≤ 0,5 g (ou non détectable) → « 0 g » ou « < 0,5 g » ;
 *   - acides gras saturés (mono-, polyinsaturés) :
 *       ≥ 10 g → au gramme ; < 10 g et > 0,1 g → à 0,1 g ; ≤ 0,1 g → « 0 g » ou « < 0,1 g » ;
 *   - sodium : ≥ 1 g → à 0,1 g ; < 1 g et > 0,005 g → à 0,01 g ; ≤ 0,005 g → « 0 g » ou « < 0,005 g » ;
 *   - sel : ≥ 1 g → à 0,1 g ; < 1 g et > 0,0125 g → à 0,01 g ; ≤ 0,0125 g → « 0 g » ou « < 0,01 g ».
 * Le guide recommande de calculer à partir des valeurs non arrondies (énergie comprise) :
 * c'est ce qui est fait ; seuls les affichages sont arrondis.
 *
 * Sel = sodium × 2,5 (annexe I, point 11).
 */

/** Valeurs pour 100 g ou 100 ml (grammes) */
export interface NutritionInput {
  fat: number;
  saturates: number;
  carbohydrate: number;
  sugars: number;
  protein: number;
  /** sel (g) ; si absent, calculé depuis le sodium */
  salt?: number;
  sodium?: number;
  fibre?: number;
  polyols?: number;
  /** alcool (éthanol), en grammes */
  alcohol?: number;
}

export const ENERGY_FACTORS = {
  fat: { kJ: 37, kcal: 9 },
  carbohydrate: { kJ: 17, kcal: 4 },
  protein: { kJ: 17, kcal: 4 },
  fibre: { kJ: 8, kcal: 2 },
  polyols: { kJ: 10, kcal: 2.4 },
  alcohol: { kJ: 29, kcal: 7 },
} as const;

export const SODIUM_TO_SALT = 2.5;

const n0 = (v: number | undefined) => (v != null && Number.isFinite(v) ? Math.max(0, v) : 0);

/** Sel en grammes : saisi, sinon sodium × 2,5 (undefined si aucun des deux) */
export function saltOf(n: NutritionInput): number | undefined {
  if (n.salt != null && Number.isFinite(n.salt)) return Math.max(0, n.salt);
  if (n.sodium != null && Number.isFinite(n.sodium)) return Math.max(0, n.sodium) * SODIUM_TO_SALT;
  return undefined;
}

/** Énergie non arrondie (annexe XIV) */
export function computeEnergy(n: NutritionInput): { kJ: number; kcal: number } {
  const polyols = Math.min(n0(n.polyols), n0(n.carbohydrate));
  const carbs = n0(n.carbohydrate) - polyols;
  const parts: [number, { kJ: number; kcal: number }][] = [
    [n0(n.fat), ENERGY_FACTORS.fat],
    [carbs, ENERGY_FACTORS.carbohydrate],
    [polyols, ENERGY_FACTORS.polyols],
    [n0(n.protein), ENERGY_FACTORS.protein],
    [n0(n.fibre), ENERGY_FACTORS.fibre],
    [n0(n.alcohol), ENERGY_FACTORS.alcohol],
  ];
  return {
    kJ: parts.reduce((a, [g, f]) => a + g * f.kJ, 0),
    kcal: parts.reduce((a, [g, f]) => a + g * f.kcal, 0),
  };
}

/** Arrondi au plus proche, demi vers le haut, sans artefact binaire (0,15 → 0,2) */
export function roundTo(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(Number((v * f).toPrecision(12))) / f;
}

export type NutrientKind = 'macro' | 'saturates' | 'sodium' | 'salt';
/** Valeurs négligeables : « < 0,5 g » (lt) ou « 0 g » (zero) — les deux sont admis par le guide */
export type LowStyle = 'lt' | 'zero';

const RULES: Record<NutrientKind, { low: number; lowLabel: string; mid: number; midDecimals: number; highDecimals: number }> = {
  // valeur ≤ low → négligeable ; low < v < mid → midDecimals ; v ≥ mid → highDecimals
  macro: { low: 0.5, lowLabel: '0.5', mid: 10, midDecimals: 1, highDecimals: 0 },
  saturates: { low: 0.1, lowLabel: '0.1', mid: 10, midDecimals: 1, highDecimals: 0 },
  sodium: { low: 0.005, lowLabel: '0.005', mid: 1, midDecimals: 2, highDecimals: 1 },
  salt: { low: 0.0125, lowLabel: '0.01', mid: 1, midDecimals: 2, highDecimals: 1 },
};

export interface Rounded {
  /** valeur arrondie (0 pour une valeur négligeable) */
  value: number;
  decimals: number;
  /** valeur négligeable (≤ seuil) */
  negligible: boolean;
}

/** Arrondi d'un nutriment selon le guide de 2012 */
export function roundNutrient(kind: NutrientKind, v: number): Rounded {
  const r = RULES[kind];
  const x = n0(v);
  if (x <= r.low) return { value: 0, decimals: 0, negligible: true };
  const decimals = x >= r.mid ? r.highDecimals : r.midDecimals;
  return { value: roundTo(x, decimals), decimals, negligible: false };
}

const fmtNum = (v: number, decimals: number, dec: string) => v.toFixed(decimals).replace('.', dec);

/** Texte affiché pour un nutriment, ex. « 3,1 g », « 12 g », « <0,5 g », « 0 g » */
export function formatNutrient(kind: NutrientKind, v: number, style: LowStyle = 'lt', dec = ','): string {
  const r = roundNutrient(kind, v);
  if (r.negligible) {
    if (style === 'zero' || n0(v) === 0) return '0 g';
    return `<${RULES[kind].lowLabel.replace('.', dec)} g`;
  }
  return `${fmtNum(r.value, r.decimals, dec)} g`;
}

/** Texte de l'énergie, ex. « 1520 kJ / 360 kcal » (au kJ / à la kcal près) */
export function formatEnergy(e: { kJ: number; kcal: number }): string {
  return `${roundTo(e.kJ, 0)} kJ / ${roundTo(e.kcal, 0)} kcal`;
}

export interface NutritionRow {
  key: 'energy' | 'fat' | 'saturates' | 'carbohydrate' | 'sugars' | 'polyols' | 'fibre' | 'protein' | 'salt';
  /** libellé français (annexe XV) */
  label: string;
  per100: string;
  perPortion?: string;
}

export interface NutritionOptions {
  /** portion en g / ml (absent ou 0 → pas de colonne portion) */
  portion?: number;
  lowStyle?: LowStyle;
  /** séparateur décimal (défaut « , ») */
  dec?: string;
  /** libellés (traduction) ; défaut : français */
  labels?: Partial<Record<NutritionRow['key'], string>>;
}

export const ROW_LABELS: Record<NutritionRow['key'], string> = {
  energy: 'Énergie',
  fat: 'Matières grasses',
  saturates: 'dont acides gras saturés',
  carbohydrate: 'Glucides',
  sugars: 'dont sucres',
  polyols: 'dont polyols',
  fibre: 'Fibres alimentaires',
  protein: 'Protéines',
  salt: 'Sel',
};

const scale = (n: NutritionInput, k: number): NutritionInput => {
  const o: NutritionInput = { ...n };
  (Object.keys(o) as (keyof NutritionInput)[]).forEach((key) => {
    const v = o[key];
    if (v != null) o[key] = v * k;
  });
  return o;
};

/**
 * Lignes du tableau, dans l'ordre de l'annexe XV. Fibres et polyols n'apparaissent que s'ils
 * sont renseignés ; l'alcool ne compte que dans l'énergie. La colonne portion est calculée à
 * partir des valeurs non arrondies pour 100 g, puis arrondie avec les mêmes règles.
 */
export function nutritionRows(n: NutritionInput, o: NutritionOptions = {}): NutritionRow[] {
  const style = o.lowStyle ?? 'lt';
  const dec = o.dec ?? ',';
  const portion = o.portion && o.portion > 0 ? o.portion : 0;
  const p = portion ? scale(n, portion / 100) : null;
  const L = { ...ROW_LABELS, ...o.labels };
  const rows: NutritionRow[] = [];
  const add = (key: NutritionRow['key'], f: (x: NutritionInput) => string) => rows.push({ key, label: L[key], per100: f(n), ...(p ? { perPortion: f(p) } : {}) });
  add('energy', (x) => formatEnergy(computeEnergy(x)));
  add('fat', (x) => formatNutrient('macro', x.fat, style, dec));
  add('saturates', (x) => formatNutrient('saturates', x.saturates, style, dec));
  add('carbohydrate', (x) => formatNutrient('macro', x.carbohydrate, style, dec));
  add('sugars', (x) => formatNutrient('macro', x.sugars, style, dec));
  if (n.polyols != null && Number.isFinite(n.polyols)) add('polyols', (x) => formatNutrient('macro', x.polyols!, style, dec));
  if (n.fibre != null && Number.isFinite(n.fibre)) add('fibre', (x) => formatNutrient('macro', x.fibre!, style, dec));
  add('protein', (x) => formatNutrient('macro', x.protein, style, dec));
  add('salt', (x) => formatNutrient('salt', saltOf(x) ?? 0, style, dec));
  return rows;
}

export type NutritionWarning = 'saturatesGtFat' | 'sugarsGtCarbs' | 'polyolsGtCarbs' | 'sumGt100' | 'negative';

/** Incohérences de saisie (pour 100 g) */
export function nutritionWarnings(n: NutritionInput): NutritionWarning[] {
  const w: NutritionWarning[] = [];
  const vals = [n.fat, n.saturates, n.carbohydrate, n.sugars, n.protein, n.salt, n.sodium, n.fibre, n.polyols, n.alcohol];
  if (vals.some((v) => v != null && v < 0)) w.push('negative');
  if (n0(n.saturates) > n0(n.fat)) w.push('saturatesGtFat');
  if (n0(n.sugars) > n0(n.carbohydrate)) w.push('sugarsGtCarbs');
  if (n0(n.polyols) > n0(n.carbohydrate)) w.push('polyolsGtCarbs');
  const sum = n0(n.fat) + n0(n.carbohydrate) + n0(n.protein) + n0(n.fibre) + n0(saltOf(n)) + n0(n.alcohol);
  if (sum > 100 + 1e-9) w.push('sumGt100');
  return w;
}
