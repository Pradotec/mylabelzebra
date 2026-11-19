# Étiquettes transporteur

*Options* → *Outils* → **Étiquettes transporteur…** (ou bouton **Transport** de la barre de gauche) imprime sur une Zebra les étiquettes d’expédition **fournies par les transporteurs ou les places de marché** (ZPL, PDF ou images), sans les redessiner.

## Importer

Déposez les fichiers dans la fenêtre ou utilisez *Choisir des fichiers…* :

- **ZPL** : `.zpl`, `.txt`, `.prn` ;
- **PDF** et **images** PNG / JPG ;
- **archives `.zip`** contenant ces fichiers (ouvertes sur un niveau).

Les fichiers non reconnus sont signalés et ignorés. Chaque entrée de la liste affiche son type (*ZPL d’origine (inchangé)*, *PDF → ZPL ^GFA*, *Image → ZPL ^GFA*), son nombre de pages et une vignette ; *Aperçu*, *Monter* / *Descendre*, *Retirer*, *Tout sélectionner*, *Vider la liste*.

## ZPL : envoyé tel quel

Le ZPL transporteur est envoyé **octet pour octet**, sans aucune modification (le nombre de pages tient compte des `^PQ`). Si le fichier n’est pas en UTF-8, il est lu en Latin-1 (*Encodage Latin-1*) : le `.zpl` téléchargé reste identique, mais Browser Print transmet le texte en UTF-8 — un avertissement le signale. L’aperçu est un rendu interne approximatif.

## PDF et images : conversion en ZPL `^GFA`

Réglages de conversion (appliqués à toutes les entrées PDF/images, reconversion automatique) :

| Réglage | Valeurs |
| --- | --- |
| *Résolution* | 203, 300 ou 600 dpi (celle de l’imprimante) |
| *Format* | 4×6″ (10×15 cm), 100×150 mm, A6 (105×148 mm), 4×8″, 100×210 mm, 4×4″ |
| *Rotation* | automatique ou angle imposé |
| *Seuil noir/blanc* | 20 à 240 |
| *Recadrer sur le contenu* | supprime les marges blanches |
| *Tramage* | pour les logos et photos en niveaux de gris |

Chaque page devient une étiquette `^XA ^PW ^LL ^FO0,0 ^GFA… ^PQ1 ^XZ` ; les réglages de l’imprimante (support, vitesse, contraste) ne sont pas modifiés. Les PDF sont lus localement avec pdf.js (chargé à la demande).

## Imprimer ou télécharger

- **Imprimer la sélection** : envoie les entrées cochées à l’imprimante Zebra choisie via Zebra Browser Print. Si aucune imprimante n’est sélectionnée, la fenêtre *Imprimante Zebra* s’ouvre ; si Browser Print est introuvable, le fichier `.zpl` combiné est téléchargé à la place.
- **Télécharger le .zpl combiné** : un seul fichier avec toutes les entrées sélectionnées, dans l’ordre de la liste.

Les fichiers restent dans le navigateur ; aucune étiquette n’est envoyée à un serveur.
