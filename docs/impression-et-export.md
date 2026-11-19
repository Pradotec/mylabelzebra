# Impression et export

## Ce qui est imprimé

| Situation | Étiquettes produites |
| --- | --- |
| Données importées, lignes cochées | une étiquette par ligne cochée × ses copies |
| Données importées, aucune ligne cochée | la ligne affichée seulement |
| Pas de données, l’étiquette utilise `{{numero}}`, `{{#pos}}`, `{{#total}}` ou `{{#sscc}}` | la série numérotée (*Quantité*, 500 au maximum) |
| Sinon | l’étiquette seule × copies |

S’il y a des champs `{{?…}}`, la fenêtre de saisie s’ouvre d’abord ([détails](donnees-et-fusion.md#valeurs-saisies-à-limpression-)). Avec `{{#sscc}}`, une plage de SSCC est réservée et consommée seulement si le travail réussit.

## Fenêtre Imprimer (Ctrl+P)

- **Imprimante** : *Cet ordinateur* ou *Imprimante Zebra* (+ *Réglages Zebra*).
- **Cette étiquette** : *Copies* puis *Imprimer ceci* (la ligne affichée).
- **Tout le lot** : *Imprimer N étiquette(s)*.
- *Impression test (contours)* : contours numérotés des étiquettes sur papier ordinaire (cercles pour les étiquettes rondes), pour vérifier l’alignement.
- Raccourcis vers *Planches Avery…*, *PDF…*, *Conformité alimentaire…*.
- Avertissements (non bloquants) : mentions alimentaires absentes, hauteur de x insuffisante sur des étiquettes du lot.

## Imprimante Zebra (Zebra Browser Print)

MyLabelZebra envoie le ZPL à l’imprimante par **Zebra Browser Print**, un petit service gratuit de Zebra installé sur le poste (Windows ou macOS) qui écoute sur `http://127.0.0.1:9100` et `https://127.0.0.1:9101`. Le navigateur dialogue directement avec ce service local : rien ne passe par Internet.

Installation :

1. Téléchargez et installez **Zebra Browser Print** depuis le site de Zebra ; lancez-le (icône dans la barre des tâches).
2. Branchez l’imprimante en USB ou ajoutez-la par le réseau dans Browser Print.
3. Ouvrez une fois `https://127.0.0.1:9101/ssl_support` dans le navigateur et acceptez le certificat si demandé.
4. À la première impression, **autorisez le site** dans la fenêtre de Browser Print.

Fenêtre *Options* → **Imprimante Zebra…** (ou *Réglages Zebra*) :

- liste des imprimantes (*Actualiser*), choix et **mémorisation** de la dernière utilisée ;
- *Lire les réglages de l’imprimante* : modèle et résolution (`~HI`), noirceur, vitesse et taille configurée (`^HH`) ; la résolution détectée est appliquée au document et l’application propose d’adopter la taille configurée dans l’imprimante ;
- *Noirceur (0–30)*, *Vitesse (ips)*, *DPI* : *Appliquer et mémoriser* envoie `~SD` et `^PR` et mémorise ces réglages pour cette imprimante ;
- *Vérifier l’état* (`~HS`) : prête, tête ouverte, plus de papier, plus de ruban, en pause.

Si Browser Print est absent, une aide d’installation s’affiche ; en attendant, imprimez via *Cet ordinateur* ou téléchargez le fichier `.zpl`.

Après une impression Zebra du lot, le départ de la numérotation avance automatiquement.

> Zebra Browser Print n’a pas pu être testé faute d’imprimante. La lecture des réglages et des états repose sur la documentation ZPL (`~HI`, `^HH`, `~HS`).

## Résolution (DPI)

Le document a une résolution de **203, 300 ou 600 dpi** (menu de taille), qui doit correspondre à la tête d’impression de l’imprimante Zebra. Elle détermine le ZPL (coordonnées en points), le calcul des modules des codes-barres et la trame des gris. Les PNG et JPG sont produits à la résolution du document, les PDF à 203, 300 ou 600 dpi au choix.

## ZPL

*Options* → **Zebra / ZPL** : *Copier le ZPL*, *Télécharger le ZPL (.zpl)*, *Visionneuse ZPL*, *Imprimante Zebra…*, *ZPL : tout en image (^GFA)*.

- En-tête : `^XA ^CI28 ^PW ^LL ^LH0,0`, une étiquette par ligne avec `^PQ` pour les copies.
- **Commandes natives** pour le texte (`^A0`, `^FB`), les codes-barres (voir [symbologies](codes-barres-gs1.md#symbologies)), le QR, les rectangles, cercles, ellipses et lignes (`^GB`, `^GC`, `^GE`) et les tableaux simples.
- **Rasterisé en `^GFA` compressé** : rotations, miroirs, images, formes complexes, texte italique, justifié ou courbé, texte qui frôle le bord de sa boîte ou dont la police n’est pas une sans-serif courante, allergènes en gras, signe ℮, codes sans équivalent natif.
- *ZPL : envoyer ce texte en image* (propriété d’un texte) force l’image pour ce texte ; *ZPL : tout en image (^GFA)* rasterise toute l’étiquette (rendu identique à l’écran, fichier plus lourd, impression plus lente).
- Gris : une imprimante thermique n’imprime que des points noirs ; les gris sont tramés (trame ordonnée 8×8) ; codes-barres et QR toujours en noir pur.

## Aperçu thermique

Bouton à côté de l’œil, en bas à droite : affiche l’étiquette en noir et blanc à la résolution du document, comme le ZPL « tout en image » (gris tramés, codes en noir pur), pour la ligne de données affichée.

## Cet ordinateur (impression navigateur)

Impression par la boîte de dialogue du navigateur, avec une page `@page` à la **taille exacte de l’étiquette**. Dans la fenêtre d’impression, choisissez le papier de la taille de l’étiquette, une **échelle de 100 %** (désactivez « Ajuster à la page ») et l’orientation indiquée.

## PDF, PNG, JPG, SVG

- *Options* → **Télécharger en PDF…** : page à la taille exacte de l’étiquette, 203/300/600 dpi, *Étiquette affichée* ou *Lot* ; **Un PDF multipage** ou **Un PDF par étiquette (.zip)**.
- *Télécharger en PNG* / *JPG* : étiquette affichée, à la résolution du document.
- *Télécharger en SVG* : vectoriel pour le texte, les codes et les formes simples.

## Planches A4 / Letter (Avery)

*Options* → **Planches A4 / Letter (Avery)…** (ou depuis la fenêtre Imprimer ou la galerie de modèles) :

- planches **Avery 5160, 5161, 5162, 5163, 5164, 5167, 5126, 22806, 22807, 8293** (US Letter) et **A4 L7160, L7163** ; choisir une planche règle la taille de l’étiquette ;
- *Même étiquette partout* (*Combien* — 0 = planche pleine) ou *Une étiquette par ligne* (ligne 1 → case 1…, ou la série numérotée), sur autant de planches que nécessaire ;
- *Commencer à l’étiquette n°* : les cases précédentes restent vierges (planche entamée) ;
- *Texte uniquement (sans codes ni images)* ;
- **Calibrage de l’imprimante** : *Décalage horizontal* / *vertical* en mm (+ = vers la droite / vers le bas) ;
- *Impression test*, *Télécharger le PDF*, *Imprimer*, *Revenir au rouleau*.

Procédure de calibrage : imprimez une page test sur papier ordinaire **à 100 %** (sans « ajuster à la page »), posez-la sur une planche à contre-jour, puis corrigez le décalage. Les dimensions suivent les gabarits publiés, mais chaque imprimante de bureau décale un peu la page : faites toujours un essai avant d’utiliser vos planches.

## Rouleau à plusieurs étiquettes de front

Panneau *Étiquette* (aucun élément sélectionné) → **Étiquettes de front sur le rouleau** : 1, 2 ou 3 colonnes, *Écart entre étiquettes* et *Marge gauche* (mm), avec un aperçu d’une rangée. Les étiquettes successives du lot sont placées côte à côte, une rangée par format ; la dernière rangée peut rester incomplète. En ZPL, `^PW` vaut la largeur totale du rouleau ; le PDF et l’impression navigateur produisent une page par rangée.

## Historique d’impression

*Options* → **Historique d’impression** : journal local (IndexedDB, **500 derniers travaux**, 40 Mo au maximum) de chaque impression ou export — date et heure, étiquette, sortie (ordinateur, Zebra, PDF, PDF .zip, PNG, JPG, SVG, ZPL copié, fichier .zpl, planches), nombre d’étiquettes, lignes imprimées, valeurs saisies, origine (lien ou application pour une impression pilotée) et une copie complète du document.

- **Réimprimer** reproduit exactement le travail : mêmes données, mêmes valeurs saisies, même date de référence pour `{{date}}` / `{{aujourdhui}}`, mêmes SSCC ; la numérotation n’avance pas.
- **Ouvrir** charge cette version dans l’éditeur.
- Suppression d’une entrée ou *Effacer l’historique*.
