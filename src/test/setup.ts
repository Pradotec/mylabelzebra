/**
 * Environnement de test : happy-dom (window, document, localStorage) + canvas 2D réel
 * fourni par @napi-rs/canvas (Skia précompilé, fonctionne sous Windows sans build natif).
 *
 * La mesure du texte est rendue DÉTERMINISTE : largeur = nb de caractères × taille de
 * police × 0,5. Les tests ne dépendent donc ni des polices installées ni de l'OS.
 */
import { createCanvas, Path2D as NapiPath2D, DOMMatrix as NapiDOMMatrix } from '@napi-rs/canvas';
import { fakeWidth } from './measure';

function makeCanvas() {
  const cv = createCanvas(300, 150);
  const getContext = cv.getContext.bind(cv) as (type: '2d', opts?: unknown) => ReturnType<typeof cv.getContext>;
  let wrapped: ReturnType<typeof cv.getContext> | null = null;
  (cv as unknown as { getContext: unknown }).getContext = (type: string, opts?: unknown) => {
    if (type !== '2d') return null;
    if (wrapped) return wrapped;
    const ctx = getContext('2d', opts);
    // napi-rs normalise parfois la chaîne de police : on garde la dernière valeur affectée
    let font = '10px sans-serif';
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ctx), 'font');
    Object.defineProperty(ctx, 'font', {
      configurable: true,
      get: () => font,
      set: (v: string) => {
        font = v;
        try {
          desc?.set?.call(ctx, v);
        } catch {
          /* police inconnue : sans importance pour la mesure */
        }
      },
    });
    (ctx as unknown as { measureText: (s: string) => { width: number } }).measureText = (s: string) => ({ width: fakeWidth(String(s), font) });
    wrapped = ctx;
    return ctx;
  };
  return cv;
}

const g = globalThis as unknown as Record<string, unknown>;
g.Path2D = NapiPath2D;
g.DOMMatrix = NapiDOMMatrix;

const origCreate = document.createElement.bind(document);
document.createElement = ((tag: string, opts?: ElementCreationOptions) =>
  tag.toLowerCase() === 'canvas' ? makeCanvas() : origCreate(tag, opts)) as typeof document.createElement;
