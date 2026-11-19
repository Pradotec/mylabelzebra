# Codes-barres et GS1

Les codes sont générés par **bwip-js**. Les modules (largeur des barres) sont calculés en points entiers à la résolution de l’imprimante pour rester lisibles par les scanners. La valeur peut contenir des `{{champs}}` et des filtres ([Données et fusion](donnees-et-fusion.md)).

## Symbologies

| Symbologie | Saisie attendue | ZPL |
| --- | --- | --- |
| CODE 128 | texte et chiffres | natif `^BC` |
| GS1-128 | identifiants entre parenthèses : `(01)…(17)…` | natif `^BC` (mots de code explicites, voir plus bas) |
| EAN-13 | 12 chiffres (clé calculée) ou 13 (clé vérifiée) | natif `^BE` |
| EAN-8 | 7 chiffres (+ clé) | natif `^B8` |
| UPC-A | 11 chiffres (+ clé) | natif `^BU` |
| UPC-E | 7 chiffres commençant par 0 ou 1 | image `^GFA` |
| CODE 39 | majuscules, chiffres, espace `- . $ / + %` | natif `^B3` |
| CODE 93 | majuscules, chiffres, espace `- . $ / + %` | natif `^BA` |
| ITF (2/5 entrelacé) | nombre pair de chiffres | natif `^B2` |
| SSCC-18 | 17 chiffres : la clé est ajoutée automatiquement | natif `^BC` |
| Codabar | `A…B` autour de chiffres et `- $ : / . +` | image `^GFA` |
| Data Matrix | texte libre | natif `^BX` |
| GS1 DataMatrix | `(01)…(17)…(10)…` | natif `^BX` qualité 200, FNC1 explicite |
| PDF417 | texte libre | natif `^B7` |
| Aztec | texte libre | natif `^BO` |
| GS1 QR Code | `(01)…(10)…` | image `^GFA` |
| QR GS1 Digital Link | URL `https://domaine/01/GTIN/10/LOT?17=AAMMJJ` | natif `^BQ` |
| GS1 DataBar omnidirectionnel | GTIN 13 ou 14 chiffres, ou `(01)…` | image `^GFA` |
| GS1 DataBar empilé omnidirectionnel | GTIN 13 ou 14 chiffres, ou `(01)…` | image `^GFA` |
| GS1 DataBar Expanded | `(01)…(3103)…` | image `^GFA` |

L’élément **QR code** (bouton QR) produit un QR classique en `^BQ` : URL ou texte, Wi-Fi, vCard, correction L/M/Q/H.

**Validation immédiate** : un message rouge signale une valeur invalide (longueur, caractère interdit, clé de contrôle incorrecte). Pour les chaînes GS1 : AI inconnu, longueur incorrecte, caractère non autorisé, clé GTIN/SSCC incorrecte pour l’AI. Le texte lisible est optionnel (*Afficher le texte lisible*, *Taille du texte*).

## Assistant GS1 (GS1-128, GS1 DataMatrix, GS1 QR, DataBar Expanded, Digital Link)

Dans les propriétés d’un code GS1, l’**Assistant GS1** construit la donnée ligne par ligne, un identifiant d’application (AI) par ligne :

| AI | Contenu | Contrôle |
| --- | --- | --- |
| (00) | SSCC (colis / palette) | 18 chiffres, clé calculée ou vérifiée |
| (01) | GTIN de l’article | 8/12/13/14 chiffres, complété à 14, clé calculée ou vérifiée |
| (02) | GTIN du contenu | idem |
| (10) | numéro de lot | 20 caractères max |
| (11) | date de production | AAMMJJ |
| (13) | date d’emballage | AAMMJJ |
| (15) | DDM (à consommer de préférence avant) | AAMMJJ |
| (17) | DLC / date de péremption | AAMMJJ |
| (21) | numéro de série | 20 caractères max |
| (37) | nombre d’unités contenues | 1 à 8 chiffres |
| (3100)–(3105) | poids net en kg, 0 à 5 décimales | valeur saisie en kg, chiffres calculés |
| (3920)–(3923) | prix à payer, 0 à 3 décimales | montant saisi, chiffres calculés |

- Sélecteur de date pour les AI de date ; les valeurs peuvent contenir des `{{champs}}` : dates depuis une colonne `{{fabrication|date:AAMMJJ}}`, DLC à J+21 `{{aujourdhui|jours:+21|date:AAMMJJ}}`.
- Les AI à longueur fixe sont placés en premier ; le séparateur FNC1 est ajouté automatiquement.
- Caractères autorisés dans les AI alphanumériques : lettres sans accent, chiffres, ponctuation simple (pas d’espace ni de parenthèse).
- **Digital Link** (*Symbole à produire* → QR GS1 Digital Link) : le GTIN (01) est requis ; (01) et les qualificatifs (22), (10), (21) forment le chemin de l’URL, les autres AI (dates, poids…) passent en paramètres. *Domaine du Digital Link* : `https://id.gs1.org` par défaut, ou votre propre domaine (URL `https://…`).

**ZPL des GS1-128 / SSCC** : le générateur reprend exactement les mots de code calculés à l’écran et les écrit en `^BC` mode N avec départ et changements de jeu explicites (`>;`, `>6`, `>5`) et FNC1 explicites (`>8`), au lieu de dépendre du mode D (firmware x.11+). Le texte lisible « (AI)… » est envoyé en image, placé comme à l’écran. La visionneuse ZPL relit ces codes et reconstruit la donnée « (AI)valeur ».

## Assistant SSCC (code SSCC-18)

Dans les propriétés d’un code **SSCC-18** : *Extension* (1 chiffre) + *Préfixe entreprise GS1* + *Référence de série* (chiffres, ou `{{numero}}` pour une série), clé calculée (à l’impression si la référence contient un champ). *Utiliser ce SSCC* remplit la valeur. Pour des SSCC garantis uniques d’une impression à l’autre, utilisez plutôt le compteur ci-dessous.

## Compteur SSCC (`{{#sscc}}`)

Panneau **Numéro** → section **SSCC (palettes, colis)** :

- *Préfixe entreprise GS1* (7 à 10 chiffres), *Extension* (0–9), *Prochain numéro de série*. Le SSCC = extension + préfixe + numéro de série (16 − longueur du préfixe chiffres) + clé = 18 chiffres.
- Réglages **propres à cet appareil / navigateur** (IndexedDB). Le prochain numéro ne peut pas redescendre sous le plus haut numéro déjà émis pour ce couple extension/préfixe.
- *Insérer {{#sscc}}* : à placer dans un code SSCC-18 (le « (00) » est ajouté) ou un texte. Un SSCC par ligne cochée ou par numéro de série ; les copies gardent le même SSCC. Dans l’éditeur, l’aperçu montre le prochain SSCC prévu (non réservé).
- **Réservation sans doublon** : la plage n’est consommée qu’**après** le succès de l’impression ou de l’export. Avec `navigator.locks` (navigateurs actuels), un verrou empêche deux onglets d’émettre les mêmes numéros (le second attend la fin du premier). Sans préfixe configuré, ou si la plage est épuisée, l’impression est refusée.
- **Journal des SSCC émis** : date, document, plage, nombre, lignes ; *Exporter en CSV* (séparateur `;`, une ligne par SSCC, SSCC écrit avec « (00) » pour qu’Excel le garde en texte). 20 000 entrées conservées au maximum.
- Une réimpression depuis l’historique reprend les mêmes SSCC.

Le modèle **Étiquette palette SSCC A6** et le modèle **Colis / palette GS1-128 4×6** donnent des exemples complets.

## EAN-13 à poids / prix variable

Propriétés d’un **EAN-13** → *EAN-13 poids / prix variable* : trois structures :

| Structure | Composition |
| --- | --- |
| 2X + article (5) + valeur (5) | préfixe 20–29, code article sur 5 chiffres, valeur sur 5 chiffres |
| 2 + article (6) + valeur (5) | convention française courante |
| 2X + article (5) + clé prix + valeur (4) | valeur sur 4 chiffres précédée de sa clé de contrôle « prix » (pondérations GS1 2-, 2-, 3, 5-) |

*Type de valeur* : poids (grammes) ou prix (centimes). La valeur est saisie, ou tirée d’un `{{champ}}` qui contient des kilogrammes (1,25), des euros (4,90), des grammes (1250) ou des centimes (490) — la conversion est faite par filtres. La clé EAN est calculée automatiquement (à l’impression si la valeur vient d’un champ). Le filtre `cleprix` permet de construire la clé prix à la main : `{{prix|nombre:2|chiffres|pad:4|cleprix}}`.

## Contrôles logistiques GS1

Pour les codes **SSCC-18**, **GS1-128** et **ITF-14** (ITF de 14 chiffres), le panneau signale si le code imprimé est en dessous des minima GS1 pour les unités logistiques en distribution générale : **module X ≥ 0,495 mm** et **hauteur des barres ≥ 31,75 mm** (valeurs calculées à la résolution du document). Le format A6 et le modèle palette respectent ces minima.

## Générateur de code-barres / QR

*Options* → *Outils* → **Générateur de code-barres** / **Générateur de QR code** : saisie, aperçu, téléchargement PNG (600 dpi) ou *Ajouter à l’étiquette*.

## Liens pré-remplis

`?barcode=123&type=code128` crée une étiquette avec un code (voir [Intégration](integration.md#liens-pré-remplis) pour la liste des types acceptés).
