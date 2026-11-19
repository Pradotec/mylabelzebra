import { describe, it, expect } from 'vitest';
import { splitZplBlocks, splitZplLabels, zplPageCount, blockQuantity, isPrintingBlock, decodeZplBytes, concatBytes } from './zplText';

const L1 = '^XA^FO50,50^A0N,40,40^FDColis 1^FS^XZ';
const L2 = '^XA\r\n^FO10,10^GB100,100,3^FS\r\n^PQ2\r\n^XZ';

describe('découpage ZPL transporteur', () => {
  it('sépare plusieurs ^XA…^XZ et garde le texte exact', () => {
    const src = `~SD20\n${L1}\n${L2}\n`;
    const blocks = splitZplBlocks(src);
    expect(blocks.map((b) => b.text)).toEqual([L1, L2]);
    expect(src.slice(blocks[1].start, blocks[1].end)).toBe(L2);
  });

  it('ignore les blocs de configuration et compte ^PQ', () => {
    const src = `^XA^MMT^PW812^XZ${L1}${L2}`;
    expect(splitZplLabels(src)).toEqual([L1, L2]);
    expect(isPrintingBlock('^XA^MMT^XZ')).toBe(false);
    expect(blockQuantity(L2)).toBe(2);
    expect(blockQuantity(L1)).toBe(1);
    expect(zplPageCount(src)).toBe(3);
  });

  it('est insensible à la casse et ignore un ^XA non fermé', () => {
    expect(splitZplLabels('^xa^fdA^fs^xz^XA^FDB^FS')).toEqual(['^xa^fdA^fs^xz']);
    expect(zplPageCount('rien')).toBe(0);
  });

  it('^XA sans ^XZ suivi d’un autre bloc : le bloc ouvert est abandonné', () => {
    expect(splitZplLabels('^XA^FDperdu^FS^XA^FDok^FS^XZ')).toEqual(['^XA^FDok^FS^XZ']);
  });
});

describe('décodage des octets', () => {
  it('UTF-8 valide', () => {
    const r = decodeZplBytes(new TextEncoder().encode('^XA^FDé^FS^XZ'));
    expect(r).toEqual({ text: '^XA^FDé^FS^XZ', encoding: 'utf-8' });
  });
  it('Latin-1 en repli, réversible octet par octet', () => {
    const bytes = new Uint8Array([0x5e, 0x46, 0x44, 0xe9, 0x5e, 0x46, 0x53]);
    const r = decodeZplBytes(bytes);
    expect(r.encoding).toBe('latin1');
    expect(Array.from(r.text, (c) => c.charCodeAt(0))).toEqual(Array.from(bytes));
  });
});

describe('concaténation', () => {
  it('ajoute un saut de ligne seulement si nécessaire', () => {
    const e = (s: string) => new TextEncoder().encode(s);
    const out = new TextDecoder().decode(concatBytes([e('A'), e('B\n'), e('C')]));
    expect(out).toBe('A\nB\nC');
  });
});
