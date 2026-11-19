import type { FoodRole } from '../types';

/**
 * Rôles des mentions d'étiquetage (sans dépendance : partagé par le rendu, le panneau de
 * propriétés et l'analyse de conformité).
 */
export const FOOD_ROLES: { id: FoodRole; label: string; hint: string }[] = [
  { id: 'denomination', label: 'Dénomination de la denrée', hint: 'Art. 9 §1 a) et art. 17' },
  { id: 'ingredients', label: 'Liste des ingrédients', hint: 'Art. 9 §1 b) et art. 18' },
  { id: 'allergens', label: 'Allergènes', hint: 'Art. 9 §1 c) et art. 21 (peuvent figurer en gras dans la liste des ingrédients)' },
  { id: 'netQuantity', label: 'Quantité nette', hint: 'Art. 9 §1 e) et art. 23' },
  { id: 'useBy', label: 'Date limite de consommation (DLC)', hint: 'Art. 9 §1 f), art. 24 et annexe X : « à consommer jusqu’au » + jour et mois' },
  { id: 'bestBefore', label: 'Date de durabilité minimale (DDM)', hint: 'Art. 9 §1 f) et annexe X : « à consommer de préférence avant »' },
  { id: 'storage', label: 'Conditions de conservation', hint: 'Art. 9 §1 g) et art. 25' },
  { id: 'operator', label: 'Exploitant (nom et adresse)', hint: 'Art. 9 §1 h) et art. 8' },
  { id: 'origin', label: 'Pays d’origine / lieu de provenance', hint: 'Art. 9 §1 i) et art. 26' },
  { id: 'nutrition', label: 'Déclaration nutritionnelle', hint: 'Art. 9 §1 l) et art. 29 à 35' },
  { id: 'alcohol', label: 'Titre alcoométrique (TAV)', hint: 'Art. 9 §1 k) et art. 28 : boissons titrant plus de 1,2 % vol.' },
  { id: 'instructions', label: 'Mode d’emploi', hint: 'Art. 9 §1 j) et art. 27' },
  { id: 'lot', label: 'Numéro de lot', hint: 'Directive 2011/91/UE' },
  { id: 'healthMark', label: 'Estampille sanitaire', hint: 'Règl. CE 853/2004, annexe II section I' },
];

/**
 * Rôles relevant de l'art. 9 §1 : le contrôle de hauteur de x (art. 13 §2) s'y applique
 * automatiquement. Le lot (directive 2011/91/UE) et l'estampille (853/2004) n'en relèvent pas.
 */
export const INCO_ROLES: ReadonlySet<FoodRole> = new Set<FoodRole>([
  'denomination',
  'ingredients',
  'allergens',
  'netQuantity',
  'useBy',
  'bestBefore',
  'storage',
  'operator',
  'origin',
  'nutrition',
  'alcohol',
  'instructions',
]);

export const roleLabel = (r: FoodRole) => FOOD_ROLES.find((x) => x.id === r)?.label ?? r;
