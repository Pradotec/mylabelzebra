/**
 * Bout en bout hors navigateur : un PDF A4 (jsPDF) contenant une « étiquette » 4×6 est
 * rendu par pdf.js (build legacy pour Node, canvas @napi-rs/canvas), puis converti en ZPL
 * et relu par le parseur interne.
 */
import { describe, it, expect } from 'vitest';
import { jsPDF } from 'jspdf';
import { rgbaToGray, grayToLabelBitmap, bitmapToLabelZpl } from './raster';
import { splitZplLabels } from './zplText';
import { blackBounds } from '../zpl/gfa';

describe('PDF → ZPL (pdf.js)', () => {
  it('rend, recadre et encode une page A4 paysage', async () => {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
    pdf.setFillColor(0, 0, 0);
    // cadre 152,4 × 101,6 mm (6×4") à 20 mm du bord, avec un pavé plein
    pdf.setLineWidth(1);
    pdf.rect(20, 20, 152.4, 101.6);
    pdf.rect(30, 30, 40, 20, 'F');
    const bytes = new Uint8Array(pdf.output('arraybuffer'));

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // happy-dom n'a pas de Worker : pdf.js charge ce module dans le même fil (« fake worker »)
    const workerModule = 'pdfjs-dist/legacy/build/pdf.worker.mjs';
    (globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = await import(/* @vite-ignore */ workerModule);
    const task = pdfjs.getDocument({ data: bytes });
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 203 / 72 });
    const { createCanvas } = await import('@napi-rs/canvas');
    const cv = createCanvas(Math.floor(vp.width), Math.floor(vp.height));
    const ctx = cv.getContext('2d');
    await page.render({ canvas: cv as unknown as HTMLCanvasElement, viewport: vp, background: '#ffffff' }).promise;
    const g = rgbaToGray(ctx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
    await task.destroy();

    const b = grayToLabelBitmap(g, { widthDots: 812, heightDots: 1218 });
    expect([b.width, b.height]).toEqual([812, 1218]);
    const zpl = bitmapToLabelZpl(b);
    expect(splitZplLabels(zpl)).toHaveLength(1);
    // le cadre recadré + tourné remplit le format : bords noirs
    const black = (x: number, y: number) => b.bits[y * b.width + x];
    const box = blackBounds(b)!;
    // proportions du cadre (153,4 × 102,6 mm avec le trait) ≈ format : quasi plein cadre, centré
    expect(box.w).toBeGreaterThanOrEqual(808); // bords anticrénelés du trait
    expect(box.h).toBeGreaterThan(1205);
    expect(black(406, 600)).toBe(0);
    // pavé plein (40 × 20 mm, coin haut-gauche du PDF paysage) → après rotation horaire : en haut à droite, 20 × 40 mm
    expect(black(812 - 140, 140)).toBe(1);
    const { parseZpl } = await import('../zpl/parse');
    const [lab] = await parseZpl(zpl);
    expect(lab.width).toBe(812);
  }, 30000);
});
