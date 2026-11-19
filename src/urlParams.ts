import { useStore } from './store';
import { newDoc, makeBarcode, makeQr, makeText } from './elements';
import { SYMBOLOGIES, is2D } from './render/codes';
import type { Symbology, LabelElement } from './types';
import { BASE_DPI } from './types';
import { t } from './i18n';

const ALIASES: Record<string, Symbology> = {
  code128: 'code128',
  c128: 'code128',
  ean13: 'ean13',
  ean: 'ean13',
  ean8: 'ean8',
  upc: 'upca',
  upca: 'upca',
  upce: 'upce',
  code39: 'code39',
  code93: 'code93',
  itf: 'interleaved2of5',
  gs1: 'gs1-128',
  'gs1-128': 'gs1-128',
  sscc: 'sscc18',
  codabar: 'rationalizedCodabar',
  datamatrix: 'datamatrix',
  dm: 'datamatrix',
  pdf417: 'pdf417',
  aztec: 'azteccode',
  azteccode: 'azteccode',
  gs1datamatrix: 'gs1datamatrix',
  'gs1-datamatrix': 'gs1datamatrix',
  gs1dm: 'gs1datamatrix',
  gs1qrcode: 'gs1qrcode',
  'gs1-qr': 'gs1qrcode',
  gs1qr: 'gs1qrcode',
  gs1dlqrcode: 'gs1dlqrcode',
  'gs1-digital-link': 'gs1dlqrcode',
  digitallink: 'gs1dlqrcode',
  databaromni: 'databaromni',
  databar: 'databaromni',
  'gs1-databar': 'databaromni',
  databarstackedomni: 'databarstackedomni',
  databarstacked: 'databarstackedomni',
  databarexpanded: 'databarexpanded',
  'gs1-databar-expanded': 'databarexpanded',
};

/** Symbologie d'après le paramètre « type » (alias, ou identifiant interne sans tenir compte de la casse) */
export function symbologyFromParam(v: string | null): Symbology {
  const ty = (v || 'code128').trim().toLowerCase();
  return ALIASES[ty] ?? SYMBOLOGIES.find((s) => s.id.toLowerCase() === ty)?.id ?? 'code128';
}

/**
 * Liens pré-remplis :
 *  ?barcode=123&type=code128   ?qr=https://…   ?text=Bonjour
 *  ?seq=SKU-{n}&start=1&count=50&pad=4   (série numérotée, code-barres CODE128)
 *  &w=4&h=2&dpi=300&name=…
 */
export function applyUrlParams() {
  const p = new URLSearchParams(location.search);
  const has = ['barcode', 'qr', 'seq', 'text'].some((k) => p.has(k));
  if (!has) return;
  const st = useStore.getState();
  const w = parseFloat(p.get('w') || '') || 4;
  const h = parseFloat(p.get('h') || '') || 2;
  const dpi = [203, 300, 600].includes(+(p.get('dpi') || 0)) ? +p.get('dpi')! : 203;
  const doc = newDoc({ widthIn: w, heightIn: h, dpi, name: p.get('name') || t('Étiquette depuis un lien') });
  const els: LabelElement[] = [];
  const W = w * BASE_DPI,
    H = h * BASE_DPI;
  if (p.has('text')) {
    const tx = makeText(doc, p.get('text')!, { bold: true });
    tx.y = H * 0.06;
    els.push(tx);
  }
  if (p.has('seq')) {
    const pattern = p.get('seq')!;
    const start = parseInt(p.get('start') || '1', 10) || 1;
    const count = Math.min(500, parseInt(p.get('count') || '10', 10) || 10);
    const pad = parseInt(p.get('pad') || '0', 10) || 0;
    const [prefix, suffix] = pattern.includes('{n}') ? pattern.split('{n}') : [pattern, ''];
    doc.numbering = { start, step: parseInt(p.get('step') || '1', 10) || 1, padding: pad, prefix, suffix, count };
    const b = makeBarcode(doc, 'code128', '{{numero}}');
    b.w = W * 0.85;
    b.h = H * 0.6;
    b.x = (W - b.w) / 2;
    b.y = (H - b.h) / 2;
    els.push(b);
  }
  if (p.has('barcode')) {
    const sym = symbologyFromParam(p.get('type'));
    const b = makeBarcode(doc, sym, p.get('barcode')!);
    if (is2D(sym) && !p.has('qr')) {
      // code 2D : carré (ou proportions par défaut) centré dans l'étiquette
      const k = Math.min((W * 0.85) / b.w, (H * 0.85) / b.h);
      b.w *= k;
      b.h *= k;
      b.x = (W - b.w) / 2;
      b.y = (H - b.h) / 2;
    }
    if (p.has('qr')) {
      b.w = W * 0.55;
      b.x = W * 0.04;
    }
    els.push(b);
  }
  if (p.has('qr')) {
    const q = makeQr(doc, p.get('qr')!);
    if (p.has('barcode')) q.x = W - q.w - W * 0.04;
    els.push(q);
  }
  doc.elements = els;
  st.loadDoc(doc, true);
  history.replaceState(null, '', location.pathname + (p.get('lang') ? `?lang=${p.get('lang')}` : ''));
}
