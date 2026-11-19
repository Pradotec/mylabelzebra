/**
 * ZPL transporteur importé tel quel : découpage en étiquettes (^XA…^XZ) pour l'aperçu et le
 * comptage, décodage des octets du fichier. Le texte d'origine n'est JAMAIS réécrit : c'est
 * lui qui est envoyé à l'imprimante ou concaténé dans le .zpl combiné.
 *
 * Limite connue : un changement de caractère de commande (^CC / ~CC / ^CT / ~CT) n'est pas
 * suivi par le découpage — il ne sert qu'à l'aperçu et au nombre de pages, l'envoi reste identique.
 */

export interface ZplBlock {
  /** texte exact, de ^XA à ^XZ inclus */
  text: string;
  /** position dans le texte source */
  start: number;
  end: number;
}

/** Découpe un texte ZPL en blocs ^XA…^XZ (texte exact, positions dans la source). */
export function splitZplBlocks(src: string): ZplBlock[] {
  const out: ZplBlock[] = [];
  const re = /\^XA|\^XZ/gi;
  let open = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const isStart = m[0].toUpperCase() === '^XA';
    if (isStart) {
      // ^XA sans ^XZ précédent : le bloc ouvert est abandonné (programme mal formé)
      open = m.index;
    } else if (open >= 0) {
      const end = m.index + 3;
      out.push({ text: src.slice(open, end), start: open, end });
      open = -1;
    }
  }
  return out;
}

/** Commandes qui produisent quelque chose sur l'étiquette (vs blocs de configuration ^XA^MMT^XZ…) */
const PRINTS = /\^(FD|FV|GF|GB|GC|GD|GE|XG|IM|IL)/i;

/** Le bloc imprime-t-il quelque chose ? (un bloc de configuration seule ne compte pas comme une page) */
export const isPrintingBlock = (b: string) => PRINTS.test(b);

/** Quantité demandée par ^PQ (1 par défaut) */
export function blockQuantity(b: string): number {
  const m = /\^PQ\s*(\d+)/i.exec(b);
  const n = m ? parseInt(m[1], 10) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Étiquettes imprimables d'un texte ZPL (texte exact de chaque bloc) */
export function splitZplLabels(src: string): string[] {
  return splitZplBlocks(src)
    .map((b) => b.text)
    .filter(isPrintingBlock);
}

/** Nombre de pages imprimées (blocs imprimables × ^PQ) */
export function zplPageCount(src: string): number {
  return splitZplBlocks(src)
    .filter((b) => isPrintingBlock(b.text))
    .reduce((a, b) => a + blockQuantity(b.text), 0);
}

/** Décode les octets d'un fichier ZPL : UTF-8 strict si valide, sinon Latin-1 (octet → caractère, réversible). */
export function decodeZplBytes(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'latin1' } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { text: s, encoding: 'latin1' };
  }
}

/** Concatène des fichiers (octets d'origine), séparés par un saut de ligne si besoin. */
export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const NL = 0x0a;
  const chunks: Uint8Array[] = [];
  parts.forEach((p, i) => {
    chunks.push(p);
    const last = p[p.length - 1];
    if (i < parts.length - 1 && p.length && last !== NL && last !== 0x0d) chunks.push(new Uint8Array([NL]));
  });
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
