# Visionneuse et vérificateur ZPL

Bouton **Visionneuse ZPL** (barre de droite, ou *Options* → *Visionneuse ZPL*). Déposer un fichier `.zpl` sur la page ouvre aussi la visionneuse.

## Afficher du ZPL

- Collez du code dans *Code ZPL*, *Ouvrir un fichier .zpl* ou *ZPL de l’étiquette actuelle*.
- Un moteur local en affiche l’aperçu : `^FO ^FT ^A ^CF ^FD ^FH ^FB ^FR ^GB ^GE ^GC ^BY ^BC ^BE ^B8 ^BU ^B9 ^B3 ^BA ^B2 ^BK ^BQ ^BX ^GFA` (y compris les compressions ASCII et Z64), `^LH ^PW ^LL`, ainsi que `^BO` (Aztec), `^B7` (PDF417) et `^BX` GS1 (FNC1). Les commandes ignorées sont listées.
- *Résolution*, *Largeur si ^PW absent*, *Hauteur si ^LL absent*.
- Plusieurs étiquettes `^XA…^XZ` : navigation *Étiquette i / n*.
- Les GS1-128 produits par MyLabelZebra sont relus et la donnée « (AI)valeur » reconstruite.

## Vérification du ZPL

Le vérificateur analyse le programme sans l’imprimer et affiche *N erreur(s), N avertissement(s)* avec le numéro de ligne :

- `^XA` / `^XZ` appariés, `^FD` terminés par `^FS` ;
- champs ou `^GB` hors de l’étiquette (d’après `^PW` / `^LL`), `^GF` qui dépasse ;
- `^GFA` dont le nombre d’octets ne correspond pas à la taille du graphique ;
- données de codes-barres invalides (EAN-13, EAN-8, UPC-A, UPC-E, CODE 39, CODE 93, ITF, Codabar) ;
- commandes inconnues.

## Convertir et imprimer

- **Ouvrir dans l’éditeur** : convertit le ZPL en étiquette modifiable (approximation des polices).
- **Imprimer sur Zebra** : envoie **le code d’origine, tel quel, sans modification** via Zebra Browser Print.
- *Copier*.

## Limites

La visionneuse gère les orientations N/R/I/B (`^A`, `^FW`, codes-barres) et les origines `^FO`/`^FT`, mais elle imite les polices Zebra : `^A0` est rendue par une linéale grasse condensée, les polices bitmap A–H par une police à chasse fixe aux mêmes dimensions de cellule. L’aperçu reste approximatif au pixel près. La reconstruction « (AI)valeur » repose sur une table des longueurs d’AI courantes ; un AI exotique est affiché comme Code 128 brut (barres identiques).
