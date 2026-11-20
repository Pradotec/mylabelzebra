import type { LabelDoc, LabelElement, TextEl, BarcodeEl, QrEl, ShapeEl, TableEl, ImageEl, Symbology, MarkEl, MarkKind } from './types';
import { BASE_DPI } from './types';
import { uid } from './util';
import { shapeDef } from './render/shapes';
import { SYMBOLOGIES, is2D } from './render/codes';
import { t } from './i18n';
import { FORMAT_VERSION, migrateDoc, type RawDoc, type VersionFields } from './migrate';

export const FONTS = ['Arial', 'Helvetica', 'Arial Narrow', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Georgia', 'Times New Roman', 'Courier New', 'Consolas', 'Impact'];

export function newDoc(partial: Partial<LabelDoc> = {}): LabelDoc {
  const doc: LabelDoc & VersionFields = {
    id: uid(),
    name: t('Étiquette sans titre'),
    widthIn: 4,
    heightIn: 2,
    dpi: 203,
    background: '#ffffff',
    elements: [],
    numbering: { start: 1, step: 1, padding: 4, prefix: '', suffix: '', count: 10 },
    date: { format: 'DD/MM/YYYY', offsetDays: 0 },
    guides: { x: [], y: [] },
    zplRaster: false,
    copies: 1,
    formatVersion: FORMAT_VERSION,
    ...partial,
  };
  return doc;
}

/**
 * Complète un document importé (anciennes versions, JSON externe) destiné à l'éditeur.
 * Tous les chemins de chargement y passent (fichier, « Mes étiquettes », document courant,
 * modèles distants) : les migrations de format (src/migrate.ts) s'appliquent ici, d'après
 * le champ formatVersion du document (absent = 1). Les champs inconnus sont conservés.
 * La plage SSCC réservée d'un travail (ssccJob) n'a de sens que sur la copie figée d'un
 * travail : elle est retirée, sauf demande explicite (keepJob, documents de travail).
 */
export function normalizeDoc(src: Partial<LabelDoc>, opts: { keepJob?: boolean } = {}): LabelDoc {
  const base = newDoc();
  const d = migrateDoc(src as RawDoc).doc as Partial<LabelDoc>;
  const doc = { ...base, ...d } as LabelDoc;
  if (!opts.keepJob) delete doc.ssccJob;
  if (doc.roll && !(Number(doc.roll.columns) > 1)) delete doc.roll;
  doc.guides = d.guides ?? { x: [], y: [] };
  doc.numbering = { ...base.numbering, ...(d.numbering || {}) };
  doc.date = { ...base.date, ...(d.date || {}) };
  if (doc.data) {
    const n = doc.data.rows.length;
    doc.data = {
      ...doc.data,
      checked: Array.from({ length: n }, (_, i) => !!doc.data!.checked?.[i]),
      copies: Array.from({ length: n }, (_, i) => Number(doc.data!.copies?.[i]) || 1),
    };
  }
  doc.elements = (doc.elements || []).map((e) => {
    // (autoShrink → fit : migration héritée, voir LEGACY_FIXES dans migrate.ts)
    const n = { ...e, id: e.id || uid(), rotation: e.rotation || 0 } as LabelElement;
    if (n.type === 'mark') {
      n.kind = n.kind === 'estimated' ? 'estimated' : 'health';
      n.country = n.country ?? '';
      n.approval = n.approval ?? '';
      n.suffix = n.suffix ?? '';
      n.color = n.color || '#000000';
      n.strokeWidth = Number(n.strokeWidth) >= 0 ? Number(n.strokeWidth) : 3;
    }
    return n;
  });
  return doc;
}

export function labelCenter(doc: LabelDoc) {
  return { cx: (doc.widthIn * BASE_DPI) / 2, cy: (doc.heightIn * BASE_DPI) / 2 };
}

function place<T extends LabelElement>(doc: LabelDoc, el: T): T {
  const { cx, cy } = labelCenter(doc);
  const W = doc.widthIn * BASE_DPI;
  const H = doc.heightIn * BASE_DPI;
  if (el.w > W * 0.9) {
    const k = (W * 0.9) / el.w;
    el.w *= k;
    if (el.type !== 'text') el.h *= k;
  }
  if (el.h > H * 0.9 && el.type !== 'text') {
    const k = (H * 0.9) / el.h;
    el.h *= k;
    el.w *= k;
  }
  el.x = Math.round(cx - el.w / 2);
  el.y = Math.round(cy - el.h / 2);
  // décale en cascade si un élément occupe déjà exactement cette place
  for (let i = 0; i < 20 && doc.elements.some((o) => Math.abs(o.x - el.x) < 3 && Math.abs(o.y - el.y) < 3); i++) {
    el.x += 16;
    el.y += 16;
  }
  return el;
}

export function makeText(doc: LabelDoc, text = t('Votre texte'), extra: Partial<TextEl> = {}): TextEl {
  const fs = Math.max(14, Math.round(Math.min(doc.heightIn, doc.widthIn) * BASE_DPI * 0.12));
  return place(doc, {
    id: uid(),
    type: 'text',
    x: 0,
    y: 0,
    w: Math.min(doc.widthIn * BASE_DPI * 0.7, fs * 9),
    h: fs * 1.1,
    rotation: 0,
    text,
    fontFamily: 'Arial',
    fontSize: fs,
    bold: false,
    italic: false,
    align: 'left',
    lineHeight: 1.1,
    color: '#000000',
    invert: false,
    fit: 'wrapGrow',
    minFontSize: Math.max(6, Math.round(fs * 0.3)),
    ellipsis: true,
    ...extra,
  });
}

/** Taille par défaut d'un code (u) : carré pour les 2D, large pour PDF417 / DataBar empilé */
export function barcodeDefaultSize(s: Symbology): { w: number; h: number } {
  if (s === 'pdf417') return { w: 360, h: 120 };
  if (s === 'databarstackedomni') return { w: 150, h: 200 };
  return is2D(s) ? { w: 140, h: 140 } : { w: 380, h: 130 };
}

/** Changement de symbologie : texte lisible et proportions adaptés (2D ↔ linéaire) */
export function symbologyPatch(el: BarcodeEl, s: Symbology): Partial<BarcodeEl> {
  const d2 = is2D(s);
  const was = is2D(el.symbology);
  const p: Partial<BarcodeEl> = { symbology: s, showText: d2 ? false : el.showText };
  if (d2 !== was || s === 'pdf417' || el.symbology === 'pdf417') {
    const def = barcodeDefaultSize(s);
    const w = d2 ? Math.max(60, el.w * 0.4) : Math.max(el.w, 300);
    p.w = s === 'pdf417' ? Math.max(el.w, def.w) : w;
    p.h = d2 ? (p.w / def.w) * def.h : 130;
  }
  return p;
}

export function makeBarcode(doc: LabelDoc, symbology: Symbology = 'code128', value?: string): BarcodeEl {
  const sample = SYMBOLOGIES.find((s) => s.id === symbology)?.sample ?? '12345';
  const twoD = is2D(symbology);
  const size = barcodeDefaultSize(symbology);
  return place(doc, {
    id: uid(),
    type: 'barcode',
    x: 0,
    y: 0,
    w: size.w,
    h: size.h,
    rotation: 0,
    value: value ?? sample,
    symbology,
    showText: !twoD,
    fontSize: 22,
    color: '#000000',
  });
}

export function makeQr(doc: LabelDoc, value = 'https://exemple.fr'): QrEl {
  const side = Math.round(Math.min(doc.heightIn, doc.widthIn) * BASE_DPI * 0.6);
  return place(doc, {
    id: uid(),
    type: 'qr',
    qrType: 'text',
    x: 0,
    y: 0,
    w: side,
    h: side,
    rotation: 0,
    value,
    level: 'M',
    color: '#000000',
    wifi: { ssid: '', password: '', enc: 'WPA', hidden: false },
    vcard: { firstName: '', lastName: '', org: '', title: '', phone: '', email: '', url: '', address: '' },
  });
}

export function makeShape(doc: LabelDoc, kind: string): ShapeEl {
  const def = shapeDef(kind);
  const sym = def && def.category !== 'forme';
  const d = def && def.category === 'forme' ? def.defaults : undefined;
  const side = Math.round(Math.min(doc.heightIn, doc.widthIn) * BASE_DPI * 0.5);
  const bar = def && def.category === 'forme' && def.bar;
  return place(doc, {
    id: uid(),
    type: 'shape',
    kind,
    x: 0,
    y: 0,
    w: d?.w ?? side,
    h: d?.h ?? side,
    rotation: 0,
    fill: bar ? '#000000' : 'none',
    stroke: bar ? 'none' : '#000000',
    strokeWidth: sym ? 5 : 4,
    radius: kind === 'roundrect' ? 20 : 0,
  });
}

export function makeTable(doc: LabelDoc, rows = 3, cols = 3): TableEl {
  const cells = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (r === 0 ? `${t('Colonne')} ${c + 1}` : '')));
  return place(doc, {
    id: uid(),
    type: 'table',
    x: 0,
    y: 0,
    w: Math.round(doc.widthIn * BASE_DPI * 0.8),
    h: rows * 44,
    rotation: 0,
    rows,
    cols,
    cells,
    fontSize: 24,
    fontFamily: 'Arial',
    strokeWidth: 3,
    headerRow: true,
    align: 'left',
    colWidths: Array(cols).fill(1),
    rowHeights: Array(rows).fill(1),
  });
}

export function makeImage(doc: LabelDoc, src: string, natW: number, natH: number): ImageEl {
  const W = doc.widthIn * BASE_DPI * 0.6;
  const H = doc.heightIn * BASE_DPI * 0.6;
  const k = Math.min(W / natW, H / natH);
  return place(doc, {
    id: uid(),
    type: 'image',
    x: 0,
    y: 0,
    w: Math.max(10, natW * k),
    h: Math.max(10, natH * k),
    rotation: 0,
    src,
    threshold: 128,
    dither: true,
    keepRatio: true,
  });
}

/** 1 mm en u */
const MM = BASE_DPI / 25.4;

/**
 * Estampille sanitaire ovale (règl. CE 853/2004) ou signe ℮ (directive 76/211/CEE).
 * Tailles par défaut : estampille 30 × 20 mm ; ℮ 4 mm de haut (minimum légal : 3 mm).
 */
export function makeMark(doc: LabelDoc, kind: MarkKind, extra: Partial<MarkEl> = {}): MarkEl {
  const health = kind === 'health';
  return place(doc, {
    id: uid(),
    type: 'mark',
    kind,
    x: 0,
    y: 0,
    w: Math.round((health ? 30 : 4) * MM),
    h: Math.round((health ? 20 : 4) * MM),
    rotation: 0,
    country: health ? 'FR' : '',
    approval: health ? '75.056.001' : '',
    suffix: health ? 'CE' : '',
    color: '#000000',
    strokeWidth: health ? 3 : 0,
    fontFamily: 'Arial',
    ...(health ? { role: 'healthMark' as const } : {}),
    ...extra,
  });
}

export const TYPE_LABELS: Record<string, string> = {
  text: 'Texte',
  barcode: 'Code-barres',
  qr: 'QR code',
  image: 'Image',
  shape: 'Forme',
  table: 'Tableau',
  mark: 'Marque réglementaire',
};

export function elementLabel(el: LabelElement): string {
  if (el.name) return el.name;
  switch (el.type) {
    case 'text':
      return el.text.split('\n')[0].slice(0, 28) || t('Texte');
    case 'barcode':
      return `${SYMBOLOGIES.find((s) => s.id === el.symbology)?.label ?? ''} ${el.value}`.slice(0, 28);
    case 'qr':
      return 'QR ' + (el.qrType === 'wifi' ? 'Wi-Fi' : el.qrType === 'vcard' ? 'vCard' : el.value).slice(0, 24);
    case 'shape':
      return t(shapeDef(el.kind)?.label ?? 'Forme');
    case 'mark':
      return el.kind === 'estimated' ? t('Signe ℮') : `${t('Estampille')} ${[el.country, el.approval, el.suffix].filter(Boolean).join(' ')}`.slice(0, 28);
    default:
      return t(TYPE_LABELS[el.type]);
  }
}
