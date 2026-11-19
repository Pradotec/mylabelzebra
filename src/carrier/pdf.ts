/**
 * Rasterisation des PDF transporteur avec pdf.js (pdfjs-dist), chargé à la demande.
 *
 * Worker : l'URL du fichier pdf.worker.min.mjs est obtenue par l'import `?url` de Vite, qui
 * copie le fichier tel quel dans dist/assets (nom haché) ; pdf.js le lance comme module
 * worker. Rien n'est chargé tant que la fenêtre « Étiquettes transporteur » n'importe pas
 * de PDF (import dynamique → morceau séparé). Aucun accès réseau : tout reste local.
 */
import { rgbaToGray, type Gray } from './raster';

type PdfJs = typeof import('pdfjs-dist');
let lib: Promise<PdfJs> | null = null;

export function loadPdfjs(): Promise<PdfJs> {
  if (!lib)
    lib = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([m, w]) => {
      m.GlobalWorkerOptions.workerSrc = w.default;
      return m;
    });
  lib.catch(() => (lib = null));
  return lib;
}

/** Plafond de pixels par page rendue (≈ A4 à 600 dpi) */
const MAX_PIXELS = 36e6;

/**
 * Rend chaque page à la résolution de l'imprimante (1 point PDF = 1/72 pouce), en gris.
 * Une étiquette 4×6 imprimée à l'échelle 1 sur une page A4 garde ainsi sa taille réelle.
 */
export async function renderPdfPages(bytes: Uint8Array, dpi: number, onPage?: (i: number, n: number) => void): Promise<Gray[]> {
  const pdfjs = await loadPdfjs();
  // pdf.js transfère le tampon au worker : on lui donne une copie
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  const out: Gray[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      onPage?.(i, doc.numPages);
      const page = await doc.getPage(i);
      let scale = dpi / 72;
      const vp0 = page.getViewport({ scale: 1 });
      const px = vp0.width * vp0.height * scale * scale;
      if (px > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / px);
      const vp = page.getViewport({ scale });
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.floor(vp.width));
      cv.height = Math.max(1, Math.floor(vp.height));
      await page.render({ canvas: cv, viewport: vp, intent: 'print', background: '#ffffff' }).promise;
      const ctx = cv.getContext('2d', { willReadFrequently: true })!;
      out.push(rgbaToGray(ctx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height));
      page.cleanup();
      cv.width = cv.height = 0;
    }
  } finally {
    await task.destroy();
  }
  return out;
}
