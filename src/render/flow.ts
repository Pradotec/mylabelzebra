/**
 * Positionnement relatif (fonctions pures, sans canvas) :
 * - suppression des lignes vides d'un texte multi-lignes (adresses) ;
 * - ancre verticale : un élément suit l'élément au-dessus et remonte s'il est absent.
 */

/** Une ligne contient-elle un champ {{…}} ? */
const hasField = (line: string) => /\{\{[^}]*\}\}/.test(line);

/**
 * Retire du MODÈLE les lignes qui contiennent au moins un champ et dont la valeur résolue
 * est vide (espaces compris). Les lignes sans champ sont conservées telles quelles, même
 * vides (blanc voulu par l'utilisateur).
 */
export function removeEmptyFieldLines(raw: string, resolveLine: (line: string) => string): string {
  if (!raw || raw.indexOf('{{') < 0) return raw;
  const lines = raw.split('\n');
  const kept = lines.filter((l) => !hasField(l) || resolveLine(l).trim() !== '');
  return kept.length === lines.length ? raw : kept.join('\n');
}

export interface FlowItem {
  id: string;
  /** position du modèle */
  y: number;
  anchorTo?: string;
  /** imprimé pour cette ligne (ni masqué, ni écarté par sa condition) */
  printed: boolean;
  /** contenu vide pour cette ligne (texte / code sans valeur) */
  empty: boolean;
  /** hauteur effective pour cette ligne */
  h: number;
  /** hauteur dans le modèle (champs non résolus) : sert à calculer l'écart conservé */
  designH: number;
}

/**
 * Positions verticales effectives. Pour un élément B ancré sous A :
 * écart = B.y − (A.y + hauteur de A dans le modèle) ;
 * A imprimé et non vide → B.y' = A.y' + hauteur effective de A + écart ;
 * sinon B prend la place de A (B.y' = A.y').
 * Chaînes gérées (A peut lui-même être ancré) ; une ancre inconnue ou circulaire est ignorée.
 * Ne renvoie que les éléments déplacés.
 */
export function computeFlow(items: FlowItem[]): Map<string, number> {
  const byId = new Map(items.map((it) => [it.id, it]));
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const eff = (it: FlowItem): number => {
    const m = memo.get(it.id);
    if (m !== undefined) return m;
    const a = it.anchorTo ? byId.get(it.anchorTo) : undefined;
    let y = it.y;
    if (a && a.id !== it.id && !visiting.has(it.id)) {
      visiting.add(it.id);
      const ay = eff(a);
      visiting.delete(it.id);
      const gap = it.y - (a.y + a.designH);
      y = a.printed && !a.empty ? ay + a.h + gap : ay;
    }
    memo.set(it.id, y);
    return y;
  };
  const out = new Map<string, number>();
  for (const it of items) {
    const y = eff(it);
    if (Math.abs(y - it.y) > 1e-9) out.set(it.id, y);
  }
  return out;
}
