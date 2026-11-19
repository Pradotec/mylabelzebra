// jsPDF et JSZip ne servent qu'à l'export : chargés à la demande, hors du bundle initial
import type { jsPDF } from 'jspdf';
const loadPdf = () => import('jspdf').then((m) => m.jsPDF);
const loadZip = () => import('jszip').then((m) => m.default);
import type { LabelDoc, LabelElement } from './types';
import { BASE_DPI } from './types';
import {
  renderLabel,
  labelSizeU,
  elementHeight,
  layoutText,
  hasFixedHeight,
  col,
  isNone,
  linearGeometry,
  dpiScale,
  tableColumns,
  tableRows,
} from './render/draw';
import { batchJobs, resolveText, type PrintJob, type ResolveCtx } from './render/resolve';
import { encodeBarcode, encodeQr, qrPayload, type MatrixCode } from './render/codes';
import { preloadImages } from './render/images';
import { shapeDef } from './render/shapes';
import { fontString as fontStr, textOffsetY, justifyWords } from './render/textLayout';
import { canvasToBlob, downloadBlob, downloadText, safeFileName } from './util';
import { normalizeDoc } from './elements';
import { sheetById, type SheetDef } from './sizes';
import { t } from './i18n';

export async function ready(doc: LabelDoc) {
  await preloadImages(doc.elements.filter((e) => e.type === 'image').map((e) => (e as { src: string }).src));
  if (document.fonts?.ready) await document.fonts.ready;
}

// ---------- JSON ----------
export function docToJson(doc: LabelDoc) {
  return JSON.stringify({ app: 'MyLabelZebra', version: 1, doc }, null, 2);
}
export function jsonToDoc(text: string): LabelDoc {
  const o = JSON.parse(text);
  const d = o && o.doc ? o.doc : o;
  if (!d || !Array.isArray(d.elements)) throw new Error(t('Fichier d’étiquette invalide'));
  return normalizeDoc({ ...d });
}
export function exportJson(doc: LabelDoc) {
  downloadText(docToJson(doc), safeFileName(doc.name) + '.mlz.json', 'application/json');
}

// ---------- Images ----------
export async function labelBlob(doc: LabelDoc, index: number, dpi: number, type: 'image/png' | 'image/jpeg') {
  await ready(doc);
  const cv = renderLabel(doc, { index, scale: dpi / BASE_DPI });
  return canvasToBlob(cv, type, 0.95);
}

export async function downloadImage(doc: LabelDoc, index: number, dpi: number, type: 'png' | 'jpg') {
  const blob = await labelBlob(doc, index, dpi, type === 'png' ? 'image/png' : 'image/jpeg');
  downloadBlob(blob, `${safeFileName(doc.name)}.${type}`);
}

// ---------- PDF ----------
async function pdfFor(w: number, h: number) {
  const JsPDF = await loadPdf();
  return new JsPDF({ unit: 'in', format: [w, h], orientation: w > h ? 'landscape' : 'portrait', compress: true });
}

async function addLabelPage(pdf: jsPDF, doc: LabelDoc, index: number, dpi: number, first: boolean) {
  const cv = renderLabel(doc, { index, scale: Math.max(dpi, 300) / BASE_DPI });
  if (!first) pdf.addPage([doc.widthIn, doc.heightIn], doc.widthIn > doc.heightIn ? 'landscape' : 'portrait');
  pdf.addImage(cv.toDataURL('image/png'), 'PNG', 0, 0, doc.widthIn, doc.heightIn, undefined, 'FAST');
}

/** PDF de la taille exacte de l'étiquette, une page par étiquette du lot */
export async function downloadPdf(doc: LabelDoc, jobs: PrintJob[], dpi: number) {
  await ready(doc);
  const pdf = await pdfFor(doc.widthIn, doc.heightIn);
  let first = true;
  for (const j of jobs)
    for (let c = 0; c < j.copies; c++) {
      await addLabelPage(pdf, doc, j.index, dpi, first);
      first = false;
    }
  pdf.save(safeFileName(doc.name) + '.pdf');
}

/** Un PDF par étiquette, zippés */
export async function downloadPdfZip(doc: LabelDoc, jobs: PrintJob[], dpi: number) {
  await ready(doc);
  const JSZip = await loadZip();
  const zip = new JSZip();
  let n = 0;
  for (const j of jobs) {
    const pdf = await pdfFor(doc.widthIn, doc.heightIn);
    await addLabelPage(pdf, doc, j.index, dpi, true);
    n++;
    zip.file(`${safeFileName(doc.name)}-${String(n).padStart(3, '0')}.pdf`, pdf.output('blob'));
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, safeFileName(doc.name) + '-pdf.zip');
}

// ---------- Planches (Avery) ----------
/** Décalage de calibrage de la planche, en pouces */
function sheetOffset(doc: LabelDoc) {
  return { x: (doc.sheet?.offsetXmm || 0) / 25.4, y: (doc.sheet?.offsetYmm || 0) / 25.4 };
}
/** Liste ordonnée des cases : index d'étiquette ou null (case vide) */
export function sheetSlots(doc: LabelDoc, sheet: SheetDef, currentRow: number): (number | null)[] {
  const cfg = doc.sheet!;
  const per = sheet.cols * sheet.rows;
  const skip = Math.max(0, Math.min(per - 1, (cfg.startAt || 1) - 1));
  const slots: (number | null)[] = Array(skip).fill(null);
  if (cfg.mode === 'each') {
    for (const j of batchJobs(doc, currentRow)) for (let c = 0; c < j.copies; c++) slots.push(j.index);
  } else {
    const n = Math.max(1, cfg.howMany || per - skip);
    for (let i = 0; i < n; i++) slots.push(currentRow);
  }
  return slots;
}

export async function sheetPages(doc: LabelDoc, currentRow: number, dpi = 300): Promise<HTMLCanvasElement[]> {
  const sheet = sheetById(doc.sheet?.id);
  if (!sheet) return [];
  await ready(doc);
  const slots = sheetSlots(doc, sheet, currentRow);
  const per = sheet.cols * sheet.rows;
  const pages: HTMLCanvasElement[] = [];
  const cache = new Map<number, HTMLCanvasElement>();
  const only = doc.sheet?.textOnly ? (e: LabelElement) => e.type === 'text' : undefined;
  for (let p = 0; p * per < slots.length; p++) {
    const cv = document.createElement('canvas');
    cv.width = Math.round(sheet.pageW * dpi);
    cv.height = Math.round(sheet.pageH * dpi);
    const c = cv.getContext('2d')!;
    c.fillStyle = '#fff';
    c.fillRect(0, 0, cv.width, cv.height);
    for (let k = 0; k < per; k++) {
      const idx = slots[p * per + k];
      if (idx == null) continue;
      let img = cache.get(idx);
      if (!img) {
        img = renderLabel(doc, { index: idx, scale: dpi / BASE_DPI, only, transparent: true });
        cache.set(idx, img);
      }
      const col_ = k % sheet.cols;
      const row = Math.floor(k / sheet.cols);
      const off = sheetOffset(doc);
      const x = (sheet.left + off.x + col_ * (sheet.w + sheet.hgap)) * dpi;
      const y = (sheet.top + off.y + row * (sheet.h + sheet.vgap)) * dpi;
      c.save();
      if (sheet.round || doc.round) {
        c.beginPath();
        c.ellipse(x + (sheet.w * dpi) / 2, y + (sheet.h * dpi) / 2, (sheet.w * dpi) / 2, (sheet.h * dpi) / 2, 0, 0, Math.PI * 2);
        c.clip();
      }
      c.drawImage(img, x, y, sheet.w * dpi, sheet.h * dpi);
      c.restore();
    }
    pages.push(cv);
  }
  return pages;
}

export async function downloadSheetsPdf(doc: LabelDoc, currentRow: number) {
  const sheet = sheetById(doc.sheet?.id);
  if (!sheet) return;
  const pages = await sheetPages(doc, currentRow);
  const JsPDF = await loadPdf();
  const pdf = new JsPDF({ unit: 'in', format: [sheet.pageW, sheet.pageH], orientation: 'portrait' });
  pages.forEach((cv, i) => {
    if (i) pdf.addPage([sheet.pageW, sheet.pageH], 'portrait');
    pdf.addImage(cv.toDataURL('image/png'), 'PNG', 0, 0, sheet.pageW, sheet.pageH, undefined, 'FAST');
  });
  pdf.save(safeFileName(doc.name) + '-planches.pdf');
}

// ---------- Impression navigateur ----------
function printImages(urls: string[], wIn: number, hIn: number) {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(iframe);
  const d = iframe.contentDocument!;
  const orient = wIn > hIn ? 'landscape' : 'portrait';
  d.open();
  d.write(`<!doctype html><html><head><title>MyLabelZebra</title><style>
    @page { size: ${wIn}in ${hIn}in; margin: 0; }
    @page { size: ${orient === 'landscape' ? `${wIn}in ${hIn}in` : `${wIn}in ${hIn}in`}; }
    html, body { margin: 0; padding: 0; background: #fff; }
    img { display: block; width: ${wIn}in; height: ${hIn}in; page-break-after: always; break-after: page; }
    img:last-child { page-break-after: auto; break-after: auto; }
  </style></head><body>${urls.map((u) => `<img src="${u}">`).join('')}</body></html>`);
  d.close();
  const imgs = Array.from(d.images);
  Promise.all(imgs.map((im) => (im.complete ? Promise.resolve() : new Promise((r) => (im.onload = im.onerror = r))))).then(() => {
    setTimeout(() => {
      iframe.contentWindow!.focus();
      iframe.contentWindow!.print();
      setTimeout(() => iframe.remove(), 60_000);
    }, 50);
  });
}

export async function printOnComputer(doc: LabelDoc, jobs: PrintJob[], currentRow: number) {
  await ready(doc);
  if (doc.sheet && sheetById(doc.sheet.id)) {
    const sheet = sheetById(doc.sheet.id)!;
    const pages = await sheetPages(doc, currentRow, 200);
    printImages(
      pages.map((p) => p.toDataURL('image/png')),
      sheet.pageW,
      sheet.pageH,
    );
    return;
  }
  const urls: string[] = [];
  const cache = new Map<number, string>();
  for (const j of jobs) {
    let u = cache.get(j.index);
    if (!u) {
      u = renderLabel(doc, { index: j.index, scale: Math.max(300, doc.dpi) / BASE_DPI }).toDataURL('image/png');
      cache.set(j.index, u);
    }
    for (let c = 0; c < j.copies; c++) urls.push(u);
  }
  printImages(urls, doc.widthIn, doc.heightIn);
}

/** Impression test : contours numérotés de chaque étiquette */
export function testPrint(doc: LabelDoc) {
  const sheet = sheetById(doc.sheet?.id);
  const dpi = 150;
  const pageW = sheet ? sheet.pageW : doc.widthIn;
  const pageH = sheet ? sheet.pageH : doc.heightIn;
  const cv = document.createElement('canvas');
  cv.width = Math.round(pageW * dpi);
  cv.height = Math.round(pageH * dpi);
  const c = cv.getContext('2d')!;
  c.fillStyle = '#fff';
  c.fillRect(0, 0, cv.width, cv.height);
  c.strokeStyle = '#000';
  c.lineWidth = 2;
  c.fillStyle = '#000';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const off = sheetOffset(doc);
  const cells = sheet
    ? Array.from({ length: sheet.cols * sheet.rows }, (_, k) => ({
        x: sheet.left + off.x + (k % sheet.cols) * (sheet.w + sheet.hgap),
        y: sheet.top + off.y + Math.floor(k / sheet.cols) * (sheet.h + sheet.vgap),
        w: sheet.w,
        h: sheet.h,
      }))
    : [{ x: 0.02, y: 0.02, w: doc.widthIn - 0.04, h: doc.heightIn - 0.04 }];
  const round = sheet?.round || doc.round;
  cells.forEach((r, i) => {
    c.beginPath();
    if (round) c.ellipse((r.x + r.w / 2) * dpi, (r.y + r.h / 2) * dpi, (r.w / 2) * dpi, (r.h / 2) * dpi, 0, 0, Math.PI * 2);
    else c.rect(r.x * dpi, r.y * dpi, r.w * dpi, r.h * dpi);
    c.stroke();
    c.font = `bold ${Math.max(12, Math.min(r.w, r.h) * dpi * 0.35)}px Arial`;
    c.fillText(String(i + 1), (r.x + r.w / 2) * dpi, (r.y + r.h / 2) * dpi);
  });
  printImages([cv.toDataURL('image/png')], pageW, pageH);
}

// ---------- SVG ----------
const escXml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

function matrixSvg(q: MatrixCode, w: number, h: number, ds: number, color: string) {
  const m = Math.max(1, Math.floor(Math.min(w / q.cols, h / q.rows) * ds)) / ds;
  let d = '';
  for (let r = 0; r < q.rows; r++) {
    let k = 0;
    while (k < q.cols) {
      if (q.get(r, k)) {
        let j = k;
        while (j < q.cols && q.get(r, j)) j++;
        d += `M${(k * m).toFixed(3)} ${(r * m).toFixed(3)}h${((j - k) * m).toFixed(3)}v${m.toFixed(3)}h${(-(j - k) * m).toFixed(3)}z`;
        k = j;
      } else k++;
    }
  }
  return `<path d="${d}" fill="${col(color)}"/>`;
}

function elementSvg(el: LabelElement, ctx: ResolveCtx, doc: LabelDoc): string {
  const ds = dpiScale(doc);
  switch (el.type) {
    case 'text': {
      if (el.curve && el.curve !== 'none') return '';
      const txt = resolveText(el.text, ctx);
      const L = layoutText(el, txt);
      const font = fontStr(el, L.fontSize);
      const fg = el.invert ? (col(el.color).toLowerCase() === '#ffffff' ? '#000' : '#fff') : col(el.color);
      const clipId = 'c' + el.id;
      let s = hasFixedHeight(el) ? `<clipPath id="${clipId}"><rect width="${el.w}" height="${L.h}"/></clipPath>` : '';
      s += `<g${hasFixedHeight(el) ? ` clip-path="url(#${clipId})"` : ''}>`;
      if (el.invert) s += `<rect width="${el.w}" height="${L.h}" fill="${col(el.color)}"/>`;
      const al = el.align === 'justify' ? 'left' : el.align;
      const anchor = al === 'left' ? 'start' : al === 'center' ? 'middle' : 'end';
      const ax = al === 'left' ? L.pad : al === 'center' ? el.w / 2 : el.w - L.pad;
      const oy = textOffsetY(el, L);
      const attrs = `dominant-baseline="central" font-family="${escXml(el.fontFamily)}" font-size="${L.fontSize}"${el.bold ? ' font-weight="bold"' : ''}${el.italic ? ' font-style="italic"' : ''}${el.underline ? ' text-decoration="underline"' : ''} fill="${fg}" xml:space="preserve"`;
      L.lines.forEach((ln, i) => {
        const y = oy + L.pad + i * L.lh + L.lh / 2;
        const jw = el.align === 'justify' ? justifyWords(ln, font, el.w - L.pad * 2) : null;
        if (jw) jw.forEach((w) => (s += `<text x="${L.pad + w.x}" y="${y}" ${attrs}>${escXml(w.word)}</text>`));
        else s += `<text x="${ax}" y="${y}" text-anchor="${anchor}" ${attrs}>${escXml(ln.text)}</text>`;
      });
      return s + '</g>';
    }
    case 'barcode': {
      const enc = encodeBarcode(resolveText(el.value, ctx), el.symbology);
      if (enc.error !== undefined) return '';
      if (enc.kind === 'matrix') return matrixSvg(enc, el.w, el.h, ds, el.color);
      const g = linearGeometry(el.w, enc.modules, ds);
      const textH = el.showText ? el.fontSize * 1.15 : 0;
      const barH = Math.max(4, el.h - textH);
      let x = g.ox;
      let d = '';
      enc.sbs.forEach((wd, i) => {
        if (i % 2 === 0) d += `M${x.toFixed(3)} 0h${(wd * g.m).toFixed(3)}v${barH}h${(-wd * g.m).toFixed(3)}z`;
        x += wd * g.m;
      });
      let s = `<path d="${d}" fill="${col(el.color)}"/>`;
      if (el.showText)
        s += `<text x="${g.ox + g.total / 2}" y="${barH + el.fontSize * 0.1}" dominant-baseline="hanging" text-anchor="middle" font-family="Arial" font-size="${el.fontSize}" fill="${col(el.color)}">${escXml(enc.text)}</text>`;
      return s;
    }
    case 'qr': {
      const q = encodeQr(resolveText(qrPayload(el), ctx), el.level);
      return q.error !== undefined ? '' : matrixSvg(q, el.w, el.h, ds, el.color);
    }
    case 'shape': {
      const def = shapeDef(el.kind);
      if (!def || def.category !== 'forme') return '';
      if (def.bar) return `<rect width="${el.w}" height="${el.h}" fill="${col(isNone(el.fill) ? el.stroke : el.fill)}"/>`;
      const sw = isNone(el.stroke) ? 0 : el.strokeWidth;
      const fill = isNone(el.fill) ? 'none' : col(el.fill);
      const stroke = sw ? ` stroke="${col(el.stroke)}" stroke-width="${sw}"` : '';
      if (el.kind === 'rect' || el.kind === 'roundrect') {
        const r = el.kind === 'roundrect' ? el.radius || Math.min(el.w, el.h) * 0.2 : 0;
        return `<rect x="${sw / 2}" y="${sw / 2}" width="${el.w - sw}" height="${el.h - sw}" rx="${Math.max(0, r - sw / 2)}" fill="${fill}"${stroke}/>`;
      }
      if (el.kind === 'circle' || el.kind === 'ellipse') return `<ellipse cx="${el.w / 2}" cy="${el.h / 2}" rx="${(el.w - sw) / 2}" ry="${(el.h - sw) / 2}" fill="${fill}"${stroke}/>`;
      return '';
    }
    case 'table': {
      const cw = tableColumns(el);
      const rh = tableRows(el);
      const sw = el.strokeWidth;
      let s = sw ? `<rect x="${sw / 2}" y="${sw / 2}" width="${el.w - sw}" height="${el.h - sw}" fill="none" stroke="#000" stroke-width="${sw}"/>` : '';
      let y = 0;
      for (let r = 0; r < el.rows; r++) {
        let x = 0;
        for (let k = 0; k < el.cols; k++) {
          if (k > 0 && sw && r === 0) s += `<rect x="${x - sw / 2}" y="0" width="${sw}" height="${el.h}" fill="#000"/>`;
          const raw = el.cells[r]?.[k];
          if (raw) {
            const anchor = el.align === 'left' ? 'start' : el.align === 'center' ? 'middle' : 'end';
            const padX = sw + el.fontSize * 0.3;
            const tx = el.align === 'left' ? x + padX : el.align === 'center' ? x + cw[k] / 2 : x + cw[k] - padX;
            s += `<text x="${tx}" y="${y + rh[r] / 2}" dominant-baseline="central" text-anchor="${anchor}" font-family="${escXml(el.fontFamily)}" font-size="${el.fontSize}"${el.headerRow && r === 0 ? ' font-weight="bold"' : ''}>${escXml(resolveText(raw, ctx))}</text>`;
          }
          x += cw[k];
        }
        if (r > 0 && sw) s += `<rect x="0" y="${y - sw / 2}" width="${el.w}" height="${sw}" fill="#000"/>`;
        y += rh[r];
      }
      return s;
    }
    default:
      return '';
  }
}

/** SVG : vectoriel pour texte, codes, formes simples, tableaux ; image intégrée pour le reste. */
export async function downloadSvg(doc: LabelDoc, index: number) {
  await ready(doc);
  const { W, H } = labelSizeU(doc);
  const ctx: ResolveCtx = { doc, index, row: doc.data?.rows[index], resolve: true };
  let body = `<rect width="${W}" height="${H}" fill="${escXml(doc.background || '#fff')}"/>`;
  for (const el of doc.elements) {
    if (el.hidden) continue;
    const h = elementHeight(el, ctx);
    let inner = el.flipX || el.flipY ? '' : elementSvg(el, ctx, doc);
    let tr = `translate(${el.x} ${el.y})${el.rotation ? ` rotate(${el.rotation})` : ''}`;
    if (!inner) {
      // rendu image pour cet élément
      const cv = renderLabel(doc, { index, scale: 300 / BASE_DPI, only: (e) => e.id === el.id, transparent: true });
      inner = `<image width="${W}" height="${H}" href="${cv.toDataURL('image/png')}"/>`;
      tr = '';
    }
    body += `<g${tr ? ` transform="${tr}"` : ''} data-h="${h.toFixed(1)}">${inner}</g>`;
  }
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${doc.widthIn}in" height="${doc.heightIn}in" viewBox="0 0 ${W} ${H}">${body}</svg>`;
  downloadText(svg, safeFileName(doc.name) + '.svg', 'image/svg+xml');
}

/** Miniature pour « Mes étiquettes » */
export function thumbnail(doc: LabelDoc, max = 220): string {
  const { W, H } = labelSizeU(doc);
  const k = max / Math.max(W, H);
  try {
    return renderLabel(doc, { scale: k }).toDataURL('image/png');
  } catch {
    return '';
  }
}
