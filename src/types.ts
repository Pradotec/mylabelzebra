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
  | 'datamatrix';
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
}

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
}

export interface BarcodeEl extends Base {
  type: 'barcode';
  value: string;
  symbology: Symbology;
  showText: boolean;
  fontSize: number;
  color: Color;
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

export type LabelElement = TextEl | BarcodeEl | QrEl | ImageEl | ShapeEl | TableEl;
export type ElementType = LabelElement['type'];

export interface DataSet {
  columns: string[];
  rows: Record<string, string>[];
  /** lignes cochées (à imprimer) */
  checked: boolean[];
  /** nombre de copies par ligne */
  copies: number[];
  source?: string;
}

export interface NumberingConfig {
  start: number;
  step: number;
  padding: number;
  prefix: string;
  suffix: string;
  count: number;
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
}

export interface SavedLabel {
  doc: LabelDoc;
  thumb?: string;
  savedAt: number;
}
