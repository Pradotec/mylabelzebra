export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export const MM_PER_IN = 25.4;
export const inToMm = (v: number) => v * MM_PER_IN;
export const mmToIn = (v: number) => v / MM_PER_IN;

export function round(v: number, d = 2) {
  const k = Math.pow(10, d);
  return Math.round(v * k) / k;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(text: string, filename: string, mime = 'text/plain') {
  downloadBlob(new Blob([text], { type: mime + ';charset=utf-8' }), filename);
}

export function safeFileName(name: string) {
  return (name || 'etiquette').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 80) || 'etiquette';
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function canvasToBlob(cv: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), type, quality));
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.onchange = () => resolve(inp.files?.[0] ?? null);
    inp.click();
  });
}

export function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
