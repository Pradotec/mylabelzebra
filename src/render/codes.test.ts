import { describe, it, expect } from 'vitest';
import { gs1Check, normalizeBarcode, encodeBarcode, encodeQr, qrPayload, type LinearCode, type MatrixCode } from './codes';
import type { QrEl, Symbology } from '../types';

const ok = (v: string, s: Symbology) => {
  const r = normalizeBarcode(v, s);
  if ('error' in r) throw new Error(`erreur inattendue pour ${s} « ${v} » : ${r.error}`);
  return r;
};
const err = (v: string, s: Symbology) => {
  const r = normalizeBarcode(v, s);
  expect('error' in r, `${s} « ${v} » devrait être refusé`).toBe(true);
  return (r as { error: string }).error;
};
const linear = (v: string, s: Symbology) => {
  const e = encodeBarcode(v, s);
  if (e.error !== undefined) throw new Error(e.error);
  expect(e.kind).toBe('linear');
  return e as LinearCode;
};
const matrix = (v: string, s: Symbology) => {
  const e = encodeBarcode(v, s);
  if (e.error !== undefined) throw new Error(e.error);
  expect(e.kind).toBe('matrix');
  return e as MatrixCode;
};

describe('gs1Check', () => {
  it.each([
    ['590123412345', 7], // EAN-13 5901234123457
    ['400638133393', 1], // EAN-13 4006381333931
    ['9638507', 4], // EAN-8 96385074
    ['03600029145', 2], // UPC-A 036000291452
    ['10614141234567890', 8], // SSCC 106141412345678908
    ['0950110153000', 3], // GTIN-14 (01)09501101530003
    ['0000000', 0],
  ])('%s → %i', (d, k) => {
    expect(gs1Check(d)).toBe(k);
  });
});

describe('normalizeBarcode', () => {
  it('EAN-13 : 12 chiffres → clé ajoutée', () => {
    expect(ok('590123412345', 'ean13')).toEqual({ data: '5901234123457', human: '5901234123457' });
  });
  it('EAN-13 : 13 chiffres avec bonne clé acceptés, espaces autour ignorés', () => {
    expect(ok(' 5901234123457 ', 'ean13').data).toBe('5901234123457');
  });
  it('EAN-13 : mauvaise clé, longueur ou lettres → erreur', () => {
    expect(err('5901234123458', 'ean13')).toMatch(/clé/);
    expect(err('59012341234', 'ean13')).toMatch(/12 ou 13/);
    expect(err('59012341234A', 'ean13')).toMatch(/invalide/);
  });

  it('EAN-8 : 7 → 8 chiffres ; mauvaise clé refusée', () => {
    expect(ok('9638507', 'ean8').data).toBe('96385074');
    expect(ok('96385074', 'ean8').data).toBe('96385074');
    expect(err('96385075', 'ean8')).toMatch(/clé/);
    expect(err('963850', 'ean8')).toBeTruthy();
  });

  it('UPC-A : 11 → 12 chiffres ; mauvaise clé et lettres refusées', () => {
    expect(ok('03600029145', 'upca').data).toBe('036000291452');
    expect(ok('036000291452', 'upca').data).toBe('036000291452');
    expect(err('036000291453', 'upca')).toMatch(/clé/);
    expect(err('0360002914A', 'upca')).toMatch(/UPC invalide/);
    expect(err('03600029145X', 'upca')).toMatch(/UPC invalide/);
  });

  it('UPC-E : 7 chiffres commençant par 0 ou 1', () => {
    // le texte lisible inclut la clé calculée (0123456 → UPC-A 01234500006 → clé 5)
    expect(ok('0123456', 'upce')).toEqual({ data: '0123456', human: '01234565' });
    expect(ok('1123456', 'upce').data).toBe('1123456');
    expect(err('2123456', 'upce')).toMatch(/UPC-E/);
    expect(err('012345', 'upce')).toMatch(/UPC-E/);
    expect(err('012345A', 'upce')).toMatch(/UPC-E/);
  });

  // 0123456 → UPC-A 01234500006 → clé 5 : « 01234565 » est correct, « 01234560 » ne l'est pas
  it('UPC-E à 8 chiffres : clé vérifiée', () => {
    expect(gs1Check('01234500006')).toBe(5);
    expect(err('01234560', 'upce')).toMatch(/clé/);
    expect(ok('01234565', 'upce').human).toBe('01234565');
  });

  it('ITF : chiffres, nombre pair', () => {
    expect(ok('12345670', 'interleaved2of5').data).toBe('12345670');
    expect(err('1234567', 'interleaved2of5')).toMatch(/pair/);
    expect(err('12A4', 'interleaved2of5')).toMatch(/chiffres/);
  });

  it('SSCC-18 : 17 chiffres → 18 avec clé, préfixe (00)', () => {
    expect(ok('10614141234567890', 'sscc18')).toEqual({ data: '(00)106141412345678908', human: '(00) 106141412345678908' });
  });
  it('SSCC-18 : (00) et espaces tolérés ; 18 chiffres vérifiés', () => {
    expect(ok('(00)1061414 1234567890 8', 'sscc18').data).toBe('(00)106141412345678908');
    expect(err('106141412345678909', 'sscc18')).toMatch(/clé/);
    expect(err('1061414123456789', 'sscc18')).toMatch(/17/);
  });

  it('Code 39 / 93 : mise en majuscules, jeu de caractères limité', () => {
    expect(ok('abc-12 $', 'code39').data).toBe('ABC-12 $');
    expect(ok('xyz', 'code93').data).toBe('XYZ');
    expect(err('A@B', 'code39')).toMatch(/CODE39/);
    expect(err('é', 'code93')).toMatch(/CODE93/);
  });

  it('Codabar : délimiteurs A…B ajoutés si absents', () => {
    expect(ok('123456', 'rationalizedCodabar').data).toBe('A123456B');
    expect(ok('c12-34d', 'rationalizedCodabar').data).toBe('C12-34D');
    expect(err('12X4', 'rationalizedCodabar')).toMatch(/Codabar/);
  });

  it('GS1-128 : format (AI)valeur obligatoire', () => {
    expect(ok('(01)09501101530003(17)261231', 'gs1-128').data).toBe('(01)09501101530003(17)261231');
    expect(err('0109501101530003', 'gs1-128')).toMatch(/GS1-128/);
  });

  it('Code 128 / Data Matrix : texte libre', () => {
    expect(ok('Hello 123', 'code128').data).toBe('Hello 123');
    expect(ok('abc', 'datamatrix').data).toBe('abc');
  });
});

describe('encodeBarcode', () => {
  it('Code 128 : 11 modules par caractère + départ/clé (11+11) + arrêt (13)', () => {
    const e = linear('ABC', 'code128');
    expect(e.modules).toBe(11 * 3 + 35);
    expect(e.modules).toBe(e.sbs.reduce((a, b) => a + b, 0));
    expect(e.sbs.length % 2).toBe(1); // commence et finit par une barre
    expect(e.text).toBe('ABC');
  });

  it.each([
    ['590123412345', 'ean13', 95],
    ['9638507', 'ean8', 67],
    ['03600029145', 'upca', 95],
    ['0123456', 'upce', 51],
  ] as const)('%s (%s) → %i modules', (v, s, n) => {
    expect(linear(v, s).modules).toBe(n);
  });

  it('EAN-13 : le texte lisible contient la clé', () => {
    expect(linear('590123412345', 'ean13').text).toBe('5901234123457');
  });

  it('SSCC-18, GS1-128, Code 39/93, ITF, Codabar : encodables', () => {
    expect(linear('10614141234567890', 'sscc18').text).toBe('(00) 106141412345678908');
    expect(linear('(01)09501101530003', 'gs1-128').modules).toBeGreaterThan(50);
    expect(linear('CODE39', 'code39').modules).toBeGreaterThan(50);
    expect(linear('CODE93', 'code93').modules).toBeGreaterThan(30);
    expect(linear('12345670', 'interleaved2of5').modules).toBeGreaterThan(30);
    expect(linear('A123456B', 'rationalizedCodabar').modules).toBeGreaterThan(30);
  });

  it('valeur invalide ou vide → erreur (pas d’exception)', () => {
    expect(encodeBarcode('ABC', 'ean13').error).toMatch(/EAN-13/);
    expect(encodeBarcode('', 'code128').error).toBe('Valeur vide');
  });

  it('Data Matrix : matrice carrée', () => {
    const m = matrix('hello', 'datamatrix');
    expect(m.rows).toBe(m.cols);
    expect(m.rows).toBeGreaterThanOrEqual(10);
    // bordure en L : colonne gauche et ligne du bas pleines
    for (let r = 0; r < m.rows; r++) expect(m.get(r, 0)).toBe(true);
    for (let c = 0; c < m.cols; c++) expect(m.get(m.rows - 1, c)).toBe(true);
  });

  it('résultat mis en cache', () => {
    expect(encodeBarcode('CACHE1', 'code128')).toBe(encodeBarcode('CACHE1', 'code128'));
  });
});

describe('encodeQr', () => {
  it('texte court → version 1 (21 × 21), motifs de repérage', () => {
    const q = encodeQr('hello', 'M');
    if (q.error !== undefined) throw new Error(q.error);
    expect(q.rows).toBe(21);
    expect(q.cols).toBe(21);
    // coins des 3 motifs de repérage
    expect(q.get(0, 0)).toBe(true);
    expect(q.get(0, 20)).toBe(true);
    expect(q.get(20, 0)).toBe(true);
    expect(q.get(20, 20)).toBe(false);
  });

  it('taille = 17 + 4 × version, croissante avec la longueur et le niveau', () => {
    const long = 'x'.repeat(200);
    const m = encodeQr(long, 'M') as MatrixCode;
    const h = encodeQr(long, 'H') as MatrixCode;
    expect((m.cols - 17) % 4).toBe(0);
    expect(m.cols).toBeGreaterThan(21);
    expect(h.cols).toBeGreaterThan(m.cols);
  });

  it('vide ou trop long → erreur', () => {
    expect(encodeQr('', 'M').error).toBe('Valeur vide');
    expect(encodeQr('x'.repeat(5000), 'H').error).toMatch(/trop long/);
  });
});

describe('qrPayload', () => {
  const base: QrEl = { id: 'q', type: 'qr', qrType: 'text', x: 0, y: 0, w: 10, h: 10, rotation: 0, value: 'v', level: 'M', color: '#000' };
  it('Wi-Fi : échappement des caractères spéciaux', () => {
    expect(qrPayload({ ...base, qrType: 'wifi', wifi: { ssid: 'My;Net', password: 'p:w', enc: 'WPA', hidden: true } })).toBe('WIFI:T:WPA;S:My\\;Net;P:p\\:w;H:true;;');
    expect(qrPayload({ ...base, qrType: 'wifi', wifi: { ssid: 'Open', password: 'x', enc: 'nopass', hidden: false } })).toBe('WIFI:T:nopass;S:Open;;');
  });
  it('vCard', () => {
    const s = qrPayload({ ...base, qrType: 'vcard', vcard: { firstName: 'Ana', lastName: 'Lee', org: 'ACME', title: '', phone: '+331', email: '', url: '', address: '' } });
    expect(s.split('\n')).toEqual(['BEGIN:VCARD', 'VERSION:3.0', 'N:Lee;Ana;;;', 'FN:Ana Lee', 'ORG:ACME', 'TEL;TYPE=CELL:+331', 'END:VCARD']);
  });
  it('texte', () => {
    expect(qrPayload(base)).toBe('v');
  });
});
