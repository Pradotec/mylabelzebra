const cache = new Map<string, HTMLImageElement>();
const listeners = new Set<() => void>();

export function onImageLoaded(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Renvoie l'image si elle est déjà décodée, sinon lance le chargement. */
export function getImage(src: string): HTMLImageElement | undefined {
  if (!src) return undefined;
  let img = cache.get(src);
  if (!img) {
    img = new Image();
    img.onload = () => listeners.forEach((l) => l());
    img.src = src;
    cache.set(src, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : undefined;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  const img = getImage(src);
  if (img) return Promise.resolve(img);
  const pending = cache.get(src)!;
  return new Promise((resolve, reject) => {
    if (pending.complete && pending.naturalWidth > 0) return resolve(pending);
    pending.addEventListener('load', () => resolve(pending), { once: true });
    pending.addEventListener('error', () => reject(new Error('Image illisible')), { once: true });
  });
}

export async function preloadImages(srcs: string[]) {
  await Promise.all(srcs.filter(Boolean).map((s) => loadImage(s).catch(() => undefined)));
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
