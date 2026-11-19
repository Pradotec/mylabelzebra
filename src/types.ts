/**
 * Unités : toutes les géométries sont exprimées en « u » = 1/203 de pouce
 * (soit 1 point d'impression à 203 dpi). La résolution réelle (203/300/600 dpi)
 * n'intervient qu'à l'export (PNG, PDF, ZPL).
 */
export const BASE_DPI = 203;

/** couleur CSS hexadécimale ; 'none' = transparent (pour les remplissages) */
export type Color = string;
export type Align = 'left' | 'center' | 'right';
export type TextAlign = Align | 'justify';
/**
 * Ajustement du texte dans sa boîte :
 * - shrinkLine : une ligne, police réduite jusqu'à tenir (min), points de suspension en option ;
 * - wrapShrink : retour à la ligne, police réduite si la hauteur déborde ;
 * - wrapGrow : retour à la ligne illimité, la hauteur suit le contenu (maxLines optionnel) ;
 * - none : taille fixe, le débordement est rogné.
 */
export type TextFit = 'shrinkLine' | 'wrapShrink' | 'wrapGrow' | 'none';
export type VAlign = 'top' | 'middle' | 'bottom';

export type Symbology =
  | 'code128'
  | 'gs1-128'
  | 'ean13'
  | 'ean8'
  | 'upca'
  | 'upce'
  | 'code39'
  | 'code93'
  | 'interleaved2of5'
  | 'sscc18'
  | 'rationalizedCodabar'
  | 'datamatrix'
  | 'pdf417'
  | 'azteccode'
  | 'gs1datamatrix'
  | 'gs1qrcode'
  | 'gs1dlqrcode'
  | 'databaromni'
  | 'databarstackedomni'
  | 'databarexpanded';
export type QrLevel = 'L' | 'M' | 'Q' | 'H';
export type CurveMode = 'none' | 'arcTop' | 'arcBottom' | 'circle';

/** Condition d'affichage d'un élément, évaluée pour chaque ligne de données */
export type CondOp = 'empty' | 'notEmpty' | 'eq' | 'ne' | 'contains';
export interface ShowCondition {
  /** colonne ou champ : « lot », « numero », « ?Lot »… (accolades facultatives) */
  field: string;
  op: CondOp;
  value?: string;
}

interface Base {
  id: string;
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  flipX?: boolean;
  flipY?: boolean;
  locked?: boolean;
  hidden?: boolean;
  /** pile de groupes, du plus externe au plus interne */
  groups?: string[];
  /** afficher seulement si… (optionnel) */
  showIf?: ShowCondition;
  /** rôle réglementaire de l'élément (mentions obligatoires, règl. UE 1169/2011) */
  role?: FoodRole;
  /**
   * ancre verticale : l'élément se place sous l'élément « anchorTo » en conservant l'écart
   * du modèle ; si celui-ci n'est pas imprimé (masqué, condition) ou vide, il remonte à sa place.
   */
  anchorTo?: string;
}

/**
 * Rôles des mentions d'étiquetage alimentaire (règl. UE 1169/2011 art. 9 et 10,
 * directive 2011/91/UE pour le lot, règl. CE 853/2004 pour l'estampille).
 */
export type FoodRole =
  | 'denomination'
  | 'ingredients'
  | 'allergens'
  | 'netQuantity'
  | 'useBy'
  | 'bestBefore'
  | 'storage'
  | 'operator'
  | 'origin'
  | 'nutrition'
  | 'alcohol'
  | 'instructions'
  | 'lot'
  | 'healthMark';

export interface TextEl extends Base {
  type: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline?: boolean;
  align: TextAlign;
  vAlign?: VAlign;
  fit?: TextFit;
  /** taille minimale lors de la réduction (u) */
  minFontSize?: number;
  /** tronquer avec « … » si le texte ne tient toujours pas */
  ellipsis?: boolean;
  /** nombre maximal de lignes (0 / undefined = illimité) */
  maxLines?: number;
  lineHeight: number;
  color: Color;
  /** fond plein derrière le texte (texte inversé) */
  invert: boolean;
  /** @deprecated remplacé par fit = 'wrapShrink' */
  autoShrink?: boolean;
  curve?: CurveMode;
  /** courbure 1..100 pour les arcs */
  bend?: number;
  /** forcer le rendu en image dans le ZPL */
  zplAsImage?: boolean;
  /** mettre les allergènes (INCO) en gras */
  boldAllergens?: boolean;
  /** mention obligatoire (règlement INCO 1169/2011) : contrôle de la hauteur de x imprimée */
  incoMandatory?: boolean;
  /** surface de la plus grande face de l'emballage, en cm² (< 80 → seuil 0,9 mm, sinon 1,2 mm) */
  incoFaceCm2?: number;
  /** supprimer les lignes qui ne contiennent que des champs vides (adresses) */
  removeEmptyLines?: boolean;
}

export interface BarcodeEl extends Base {
  type: 'barcode';
  value: string;
  symbology: Symbology;
  showText: boolean;
  fontSize: number;
  color: Color;
  /** QR GS1 Digital Link : domaine de l'URL (défaut https://id.gs1.org) */
  gs1Domain?: string;
}

export type QrType = 'text' | 'wifi' | 'vcard';
export interface WifiData {
  ssid: string;
  password: string;
  enc: 'WPA' | 'WEP' | 'nopass';
  hidden: boolean;
}
export interface VCardData {
  firstName: string;
  lastName: string;
  org: string;
  title: string;
  phone: string;
  email: string;
  url: string;
  address: string;
}

export interface QrEl extends Base {
  type: 'qr';
  qrType: QrType;
  value: string;
  wifi?: WifiData;
  vcard?: VCardData;
  level: QrLevel;
  color: Color;
}

export interface ImageEl extends Base {
  type: 'image';
  src: string;
  threshold: number;
  dither: boolean;
  keepRatio: boolean;
}

export interface ShapeEl extends Base {
  type: 'shape';
  kind: string;
  fill: Color;
  stroke: Color;
  strokeWidth: number;
  radius?: number;
}

export interface TableEl extends Base {
  type: 'table';
  rows: number;
  cols: number;
  cells: string[][];
  fontSize: number;
  fontFamily: string;
  strokeWidth: number;
  headerRow: boolean;
  align: Align;
  /** largeurs / hauteurs relatives */
  colWidths: number[];
  rowHeights: number[];
}

/**
 * Marques réglementaires dessinées par l'application :
 * - health : estampille sanitaire / marque d'identification ovale (règl. CE 853/2004, annexe II section I) ;
 * - estimated : signe « ℮ » des préemballages (directive 76/211/CEE, annexe I point 3.3).
 */
export type MarkKind = 'health' | 'estimated';
export interface MarkEl extends Base {
  type: 'mark';
  kind: MarkKind;
  /** code pays (ex. « FR ») — estampille */
  country: string;
  /** numéro d'agrément (format libre, {{champs}} acceptés) — estampille */
  approval: string;
  /** mention finale : « CE » (défaut), « UE » ou autre texte — estampille */
  suffix: string;
  color: Color;
  /** épaisseur du contour de l'ovale (u) — estampille */
  strokeWidth: number;
  fontFamily?: string;
}

export type LabelElement = TextEl | BarcodeEl | QrEl | ImageEl | ShapeEl | TableEl | MarkEl;
export type ElementType = LabelElement['type'];

export interface DataSet {
  columns: string[];
  rows: Record<string, string>[];
  /** lignes cochées (à imprimer) */
  checked: boolean[];
  /** nombre de copies par ligne */
  copies: number[];
  source?: string;
  /** feuille importée d'un classeur Excel / ODS */
  sheet?: string;
  /** toutes les feuilles du classeur importé (choix de la feuille) */
  sheets?: string[];
  /** avertissements d'import, affichés dans le panneau Données */
  warnings?: (
    | { kind: 'truncated'; kept: number; total: number }
    | { kind: 'precision'; column: string; count: number; example: string }
    | { kind: 'encoding'; encoding: string }
  )[];
}

export interface NumberingConfig {
  start: number;
  /** incrément (négatif accepté ; 0 → 1) */
  step: number;
  padding: number;
  prefix: string;
  suffix: string;
  count: number;
  /** même numéro sur N étiquettes de suite (défaut 1) */
  repeat?: number;
  /** numéro en base 36 (0-9 puis A-Z) au lieu du décimal (défaut false) */
  alpha?: boolean;
}

export interface DateConfig {
  format: string;
  offsetDays: number;
}

export interface SheetConfig {
  id: string;
  mode: 'each' | 'same';
  howMany: number;
  startAt: number;
  textOnly: boolean;
  /** calibrage de l'imprimante de bureau : décalage de toute la planche, en mm (+ = droite / bas) */
  offsetXmm?: number;
  offsetYmm?: number;
}

/** Rouleau à plusieurs étiquettes de front (2 ou 3 colonnes) */
export interface RollConfig {
  /** nombre d'étiquettes de front (1 = désactivé) */
  columns: number;
  /** écart horizontal entre deux étiquettes, en mm */
  gapMm: number;
  /** marge gauche du support avant la première étiquette, en mm */
  leftMm: number;
}

export interface LabelDoc {
  id: string;
  name: string;
  widthIn: number;
  heightIn: number;
  dpi: number;
  /** étiquette ronde (affichage, impression test) */
  round?: boolean;
  background: string;
  elements: LabelElement[];
  numbering: NumberingConfig;
  date: DateConfig;
  data?: DataSet;
  /** repères (en u) */
  guides: { x: number[]; y: number[] };
  /** ZPL : tout rasteriser en ^GFA */
  zplRaster: boolean;
  /** zoom mémorisé pour ce document */
  zoom?: number;
  sheet?: SheetConfig;
  /** nombre de copies pour « Imprimer » quand il n'y a pas de données */
  copies?: number;
  updatedAt?: number;
  /** allergènes supplémentaires (mots mis en gras en plus de la liste INCO) */
  allergensExtra?: string[];
  /**
   * Valeurs des champs à saisir à l'impression ({{?Nom}}) — renseignées sur la copie
   * du document utilisée pour un travail d'impression (jamais sur le document édité).
   */
  promptValues?: Record<string, string>;
  /** date de référence d'un travail (réimpression à l'identique) */
  jobDate?: number;
  /**
   * plage SSCC réservée pour un travail ({{#sscc}}) — n'existe que sur la copie du
   * document utilisée pour un travail, jamais sur le document édité.
   */
  ssccJob?: { prefix: string; extension: number; start: number; indices: number[] };
  /** plusieurs étiquettes de front sur le même rouleau */
  roll?: RollConfig;
}

export interface SavedLabel {
  doc: LabelDoc;
  thumb?: string;
  savedAt: number;
}
