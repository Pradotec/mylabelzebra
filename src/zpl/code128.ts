/**
 * Code 128 ↔ ZPL (^BC mode N, codes d'invocation « > »).
 *
 * Le générateur ZPL reprend exactement les mots de code calculés par bwip-js (même
 * jeu de départ, mêmes changements de jeu, mêmes FNC1) : le code imprimé est identique
 * à l'écran, et le FNC1 du GS1-128 est explicite (>8) au lieu de dépendre du mode D
 * du micrologiciel.
 */

// motifs barre/espace des 107 symboles (0…105, 106 = stop sur 7 éléments)
const PATTERNS =
  '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112'.split(
    ' ',
  );
const BY_PATTERN = new Map(PATTERNS.map((p, i) => [p, i]));

/** Largeurs barre/espace (bwip-js « sbs ») → mots de code (départ … clé incluse, stop exclu) ; null si illisible */
export function sbsToCodewords(sbs: number[]): number[] | null {
  // bwip-js peut ajouter des zones de silence : on ne garde que les modules du code
  const out: number[] = [];
  let i = 0;
  while (i + 6 <= sbs.length) {
    if (i + 7 <= sbs.length && sbs.slice(i, i + 7).join('') === PATTERNS[106]) return out.length ? out : null;
    const v = BY_PATTERN.get(sbs.slice(i, i + 6).join(''));
    if (v === undefined) return null;
    out.push(v);
    i += 6;
  }
  return null;
}

/** Clé Code 128 (modulo 103) */
export function code128Check(cw: number[]): number {
  let s = cw[0];
  for (let i = 1; i < cw.length; i++) s += cw[i] * i;
  return s % 103;
}

/**
 * Mots de code (départ … données, sans clé ni stop) → données ^FD pour ^BC mode N.
 * Renvoie null si un caractère ne peut pas s'écrire (caractères de contrôle du jeu A).
 */
export function codewordsToZpl(cw: number[]): string | null {
  let set: 'A' | 'B' | 'C';
  let out = '';
  const start = cw[0];
  if (start === 103) (set = 'A'), (out = '>9');
  else if (start === 104) (set = 'B'), (out = '>:');
  else if (start === 105) (set = 'C'), (out = '>;');
  else return null;
  for (let i = 1; i < cw.length; i++) {
    const v = cw[i];
    if (v === 102) out += '>8';
    else if (set === 'C') {
      if (v < 100) out += String(v).padStart(2, '0');
      else if (v === 100) (out += '>6'), (set = 'B');
      else if (v === 101) (out += '>7'), (set = 'A');
      else return null;
    } else {
      if (v === 99) (out += '>5'), (set = 'C');
      else if (v === 100) {
        if (set === 'A') (out += '>6'), (set = 'B');
        else return null; // FNC4 (latin étendu) : non géré
      } else if (v === 101) {
        if (set === 'B') (out += '>7'), (set = 'A');
        else return null;
      } else if (v === 96) out += '>2';
      else if (v === 97) out += '>3';
      else if (v === 98) return null; // SHIFT : non utilisé par bwip-js pour le GS1
      else if (v < 64 || (set === 'B' && v < 96)) {
        const ch = String.fromCharCode(v + 32);
        out += ch === '>' ? '><' : ch;
      } else return null; // caractère de contrôle (jeu A)
    }
  }
  return out;
}

/**
 * Données ^FD d'un ^BC mode N contenant des codes d'invocation → mots de code
 * (départ + données, sans clé). Sans code de départ explicite : null (l'appelant
 * laisse alors bwip-js choisir les jeux).
 */
export function zplToCodewords(data: string): number[] | null {
  let set: 'A' | 'B' | 'C';
  const cw: number[] = [];
  let i = 0;
  if (data.startsWith('>9')) (set = 'A'), cw.push(103);
  else if (data.startsWith('>:')) (set = 'B'), cw.push(104);
  else if (data.startsWith('>;')) (set = 'C'), cw.push(105);
  else return null;
  i = 2;
  while (i < data.length) {
    const ch = data[i];
    if (ch === '>' && i + 1 < data.length) {
      const k = data[i + 1];
      i += 2;
      if (k === '<') {
        if (set === 'C') return null;
        cw.push(62 - 32);
      } else if (k === '8') cw.push(102);
      else if (k === '2') cw.push(96);
      else if (k === '3') cw.push(97);
      else if (k === '4') cw.push(98);
      else if (k === '5') {
        cw.push(99);
        set = 'C';
      } else if (k === '6') {
        cw.push(100);
        if (set !== 'B') set = 'B';
      } else if (k === '7') {
        cw.push(101);
        if (set !== 'A') set = 'A';
      } else if (k === '0') {
        if (set === 'C') return null;
        cw.push(62 - 32);
      } else return null;
      continue;
    }
    if (set === 'C') {
      const two = data.slice(i, i + 2);
      if (!/^\d\d$/.test(two)) return null;
      cw.push(+two);
      i += 2;
    } else {
      const c = data.charCodeAt(i);
      if (c < 32 || c > 127) return null;
      if (set === 'A' && c >= 96) return null;
      cw.push(c - 32);
      i++;
    }
  }
  return cw;
}

/** Texte lisible d'un GS1-128 à partir des mots de code : « (01)…(10)… » n'est pas reconstructible sans table d'AI ; on rend la suite brute, FNC1 omis */
export function codewordsText(cw: number[]): string {
  let set = cw[0] === 103 ? 'A' : cw[0] === 104 ? 'B' : 'C';
  let s = '';
  for (let i = 1; i < cw.length; i++) {
    const v = cw[i];
    if (v === 102) continue;
    if (set === 'C') {
      if (v < 100) s += String(v).padStart(2, '0');
      else set = v === 100 ? 'B' : 'A';
    } else if (v === 99) set = 'C';
    else if (v === 100 && set === 'A') set = 'B';
    else if (v === 101 && set === 'B') set = 'A';
    else if (v < 96) s += String.fromCharCode(v + 32);
  }
  return s;
}

// Longueur des AI selon leurs deux premiers chiffres, et longueur fixe des données (GS1)
const AI_LEN: Record<string, number> = { '23': 3, '24': 3, '25': 3, '31': 4, '32': 4, '33': 4, '34': 4, '35': 4, '36': 4, '39': 4, '40': 3, '41': 3, '42': 3, '43': 4, '70': 4, '71': 3, '72': 4, '80': 4, '81': 4, '82': 4 };
const FIXED: Record<string, number> = { '00': 18, '01': 14, '02': 14, '03': 14, '04': 16, '11': 6, '12': 6, '13': 6, '14': 6, '15': 6, '16': 6, '17': 6, '18': 6, '19': 6, '20': 2, '31': 6, '32': 6, '33': 6, '34': 6, '35': 6, '36': 6, '41': 13 };

/**
 * Mots de code d'un GS1-128 (FNC1 en tête) → « (AI)valeur… » ; null si ce n'est pas un
 * GS1-128 ou si la structure n'est pas reconnue.
 */
export function codewordsToGs1(cw: number[]): string | null {
  if (cw[1] !== 102) return null;
  // flux de caractères, FNC1 = \x1d
  let set = cw[0] === 103 ? 'A' : cw[0] === 104 ? 'B' : 'C';
  let s = '';
  for (let i = 2; i < cw.length; i++) {
    const v = cw[i];
    if (v === 102) s += '\x1d';
    else if (set === 'C') {
      if (v < 100) s += String(v).padStart(2, '0');
      else set = v === 100 ? 'B' : 'A';
    } else if (v === 99) set = 'C';
    else if (v === 100 && set === 'A') set = 'B';
    else if (v === 101 && set === 'B') set = 'A';
    else if (v < 96) s += String.fromCharCode(v + 32);
    else return null;
  }
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '\x1d') {
      i++;
      continue;
    }
    const p2 = s.slice(i, i + 2);
    if (!/^\d\d$/.test(p2)) return null;
    const aiLen = AI_LEN[p2] ?? 2;
    const ai = s.slice(i, i + aiLen);
    if (!/^\d+$/.test(ai) || ai.length < aiLen) return null;
    i += aiLen;
    const fixed = FIXED[p2];
    let val: string;
    if (fixed) {
      val = s.slice(i, i + fixed);
      i += fixed;
    } else {
      const e = s.indexOf('\x1d', i);
      val = e < 0 ? s.slice(i) : s.slice(i, e);
      i = e < 0 ? s.length : e;
    }
    if (!val || val.includes('\x1d')) return null;
    out += `(${ai})${val}`;
  }
  return out || null;
}
