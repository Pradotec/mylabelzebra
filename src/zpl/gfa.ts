/** Encodage / décodage des graphiques ZPL ^GFA (hexadécimal + compression ASCII ZPL). */

export interface Bitmap {
  width: number;
  height: number;
  /** 1 = noir */
  bits: Uint8Array;
}

/** Convertit un canvas (déjà seuillé ou non) en bitmap 1 bit. */
export function canvasToBitmap(cv: HTMLCanvasElement, threshold = 128): Bitmap {
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  const d = c.getImageData(0, 0, cv.width, cv.height).data;
  const bits = new Uint8Array(cv.width * cv.height);
  for (let i = 0; i < bits.length; i++) {
    const a = d[i * 4 + 3] / 255;
    const lum = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) * a + 255 * (1 - a);
    bits[i] = lum < threshold ? 1 : 0;
  }
  return { width: cv.width, height: cv.height, bits };
}

/** Boîte englobante des pixels noirs, ou null si vide. */
export function blackBounds(b: Bitmap) {
  let x0 = b.width,
    y0 = b.height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < b.height; y++) {
    const row = y * b.width;
    for (let x = 0; x < b.width; x++)
      if (b.bits[row + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function countCode(n: number): string {
  let s = '';
  while (n >= 20) {
    const k = Math.min(20, Math.floor(n / 20));
    s += String.fromCharCode(0x67 + k - 1); // g..z = 20..400
    n -= k * 20;
  }
  if (n > 0) s += String.fromCharCode(0x47 + n - 1); // G..Y = 1..19
  return s;
}

function compressRow(hex: string): string {
  let end = hex.length;
  let tail = '';
  const m0 = /0+$/.exec(hex);
  const mF = /F+$/.exec(hex);
  if (m0 && m0[0].length > 2) {
    end = m0.index;
    tail = ',';
  } else if (mF && mF[0].length > 2) {
    end = mF.index;
    tail = '!';
  }
  let out = '';
  let i = 0;
  while (i < end) {
    const ch = hex[i];
    let j = i;
    while (j < end && hex[j] === ch) j++;
    const n = j - i;
    out += n > 1 ? countCode(n) + ch : ch;
    i = j;
  }
  return out + tail;
}

/** Bitmap (ou zone) → commande ^GFA compressée. */
export function bitmapToGfa(b: Bitmap, region = { x: 0, y: 0, w: b.width, h: b.height }, compress = true): string {
  const bpr = Math.ceil(region.w / 8);
  const total = bpr * region.h;
  const rows: string[] = [];
  let prev = '';
  for (let y = 0; y < region.h; y++) {
    let hex = '';
    const base = (region.y + y) * b.width + region.x;
    for (let bx = 0; bx < bpr; bx++) {
      let byte = 0;
      for (let k = 0; k < 8; k++) {
        const x = bx * 8 + k;
        if (x < region.w && b.bits[base + x]) byte |= 0x80 >> k;
      }
      hex += (byte < 16 ? '0' : '') + byte.toString(16).toUpperCase();
    }
    if (!compress) rows.push(hex);
    else rows.push(hex === prev ? ':' : compressRow(hex));
    prev = hex;
  }
  const data = compress ? rows.join('') : rows.join('\n');
  return `^GFA,${total},${total},${bpr},${data}`;
}

/** Décode les données d'un ^GFA (hex brut ou compressé ASCII ; Z64 géré à part). */
export function decodeGfaHex(data: string, bpr: number, totalBytes: number): Bitmap {
  const rowLen = bpr * 2;
  const height = Math.max(1, Math.floor(totalBytes / bpr));
  const rows: string[] = [];
  let cur = '';
  let count = 0;
  const push = () => {
    rows.push(cur.padEnd(rowLen, '0').slice(0, rowLen));
    cur = '';
  };
  for (let i = 0; i < data.length && rows.length < height; i++) {
    const ch = data[i];
    const code = ch.charCodeAt(0);
    if (ch === '\n' || ch === '\r' || ch === ' ') continue;
    if (code >= 0x47 && code <= 0x59) {
      count += code - 0x46;
      continue;
    }
    if (code >= 0x67 && code <= 0x7a) {
      count += (code - 0x66) * 20;
      continue;
    }
    if (ch === ',') {
      cur = cur.padEnd(rowLen, '0');
      push();
      count = 0;
      continue;
    }
    if (ch === '!') {
      cur = cur.padEnd(rowLen, 'F');
      push();
      count = 0;
      continue;
    }
    if (ch === ':') {
      if (cur.length) push();
      rows.push(rows.length ? rows[rows.length - 1] : '0'.repeat(rowLen));
      count = 0;
      continue;
    }
    if (/[0-9A-Fa-f]/.test(ch)) {
      cur += ch.toUpperCase().repeat(Math.max(1, count));
      count = 0;
      while (cur.length >= rowLen) {
        const extra = cur.slice(rowLen);
        cur = cur.slice(0, rowLen);
        push();
        cur = extra;
      }
    }
  }
  if (cur.length && rows.length < height) push();
  const width = bpr * 8;
  const bits = new Uint8Array(width * height);
  rows.forEach((hex, y) => {
    for (let bx = 0; bx < bpr; bx++) {
      const byte = parseInt(hex.substr(bx * 2, 2), 16) || 0;
      for (let k = 0; k < 8; k++) if (byte & (0x80 >> k)) bits[y * width + bx * 8 + k] = 1;
    }
  });
  return { width, height, bits };
}

/** Décode Z64 (base64 + zlib) en bitmap */
export async function decodeZ64(b64: string, bpr: number, totalBytes: number): Promise<Bitmap> {
  const bin = Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0));
  const ds = new DecompressionStream('deflate');
  const buf = await new Response(new Blob([bin]).stream().pipeThrough(ds)).arrayBuffer();
  const bytes = new Uint8Array(buf);
  const height = Math.max(1, Math.floor(totalBytes / bpr));
  const width = bpr * 8;
  const bits = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let bx = 0; bx < bpr; bx++) {
      const byte = bytes[y * bpr + bx] || 0;
      for (let k = 0; k < 8; k++) if (byte & (0x80 >> k)) bits[y * width + bx * 8 + k] = 1;
    }
  return { width, height, bits };
}

export function bitmapToCanvas(b: Bitmap, color = '#000'): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = b.width;
  cv.height = b.height;
  const c = cv.getContext('2d')!;
  const img = c.createImageData(b.width, b.height);
  const [r, g, bl] = color === '#fff' ? [255, 255, 255] : [0, 0, 0];
  for (let i = 0; i < b.bits.length; i++)
    if (b.bits[i]) {
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = bl;
      img.data[i * 4 + 3] = 255;
    }
  c.putImageData(img, 0, 0);
  return cv;
}
