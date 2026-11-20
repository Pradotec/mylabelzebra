# Impression et export

## Ce qui est imprimé

| Situation | Étiquettes produites |
| --- | --- |
| Données importées, lignes cochées | une étiquette par ligne cochée × ses copies |
| Données importées, aucune ligne cochée | la ligne affichée seulement |
| Pas de données, l’étiquette utilise `{{numero}}`, `{{#pos}}`, `{{#total}}` ou `{{#sscc}}` | la série numérotée (*Quantité*, 500 au maximum) |
| Sinon | l’étiquette seule × copies |

S’il y a des champs `{{?…}}`, la fenêtre de saisie s’ouvre d’abord ([détails](donnees-et-fusion.md#valeurs-saisies-à-limpression-)). Avec `{{#sscc}}`, une plage de SSCC est réservée et consommée seulement si au moins une étiquette part ([travaux interrompus](#sscc-et-travaux-interrompus)).

## Fenêtre Imprimer (Ctrl+P)

- **Imprimante** : *Cet ordinateur* ou *Imprimante Zebra* (+ *Réglages Zebra*).
- **Cette étiquette** : *Copies* puis *Imprimer ceci* (la ligne affichée).
- **Tout le lot** : *Imprimer N étiquette(s)*.
- *Impression test (contours)* : contours numérotés des étiquettes sur papier ordinaire (cercles pour les étiquettes rondes), pour vérifier l’alignement.
- Raccourcis vers *Planches Avery…*, *PDF…*, *Conformité alimentaire…*.
- Avertissements (non bloquants) : mentions alimentaires absentes, hauteur de x insuffisante sur des étiquettes du lot.
- La fenêtre se ferme **dès que le travail entre dans la [file d’impression](#file-dimpression-et-reprise)** (après la saisie des champs `{{?…}}`), sans attendre la fin de l’envoi : un envoi Zebra en pause (imprimante pas prête) ne la bloque pas, le panneau de la file prend le relais. Si d’autres travaux attendent déjà, un message indique combien passent avant.

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

Avant tout envoi, l’état de l’imprimante est vérifié (`~HS`) et le lot part par paquets : voir [File d’impression et reprise](#file-dimpression-et-reprise).

Après une impression Zebra du lot, le départ de la numérotation avance automatiquement, du nombre d’étiquettes réellement envoyées.

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
- Travail incomplet (envoi Zebra interrompu) : la colonne *Nb* affiche **n / N étiquette(s)** et le bouton **Reprendre à partir de l’étiquette…** ouvre le choix du numéro de départ (par défaut la première étiquette non envoyée) ; voir [Historique et reprise](#historique-et-reprise).
- Réimpressions et reprises d’impressions (Zebra, *Cet ordinateur*, planches) passent par la file : la fenêtre reste utilisable pendant qu’un envoi est en pause. Celles d’exports de fichiers (PDF, PNG, ZPL…) s’exécutent directement, comme avant.
- **Ouvrir** charge cette version dans l’éditeur.
- Suppression d’une entrée ou *Effacer l’historique*.

## File d’impression et reprise

Toutes les impressions passent par **une seule file** : impression depuis la fenêtre *Imprimer* (Zebra, *Cet ordinateur*, planches), réimpressions et reprises depuis l’historique, scans du [mode poste](#mode-poste) et demandes venues d’autres outils (lien `?modele=…`, `postMessage` `mlz.print` — le protocole `mlz.print` / `mlz.result` est inchangé). Les travaux s’exécutent **un par un**, dans l’ordre d’arrivée. Les exports de fichiers lancés depuis l’éditeur (PDF, PNG, ZPL…) ne passent pas par la file.

Le bouton **File d’impression** de la barre du haut (aussi dans *Options*) affiche le nombre de travaux actifs (pastille rouge si l’un d’eux est en pause) et ouvre le panneau :

- statut de chaque travail : *En attente*, *En cours* (avec *paquet i/n* et la barre *n / N étiquettes*), *En pause*, *Terminé*, *Erreur*, *Annulé* ;
- **Pause** (prend effet entre deux paquets), **Reprendre**, **Annuler** (un travail en attente est retiré sans rien envoyer ; un travail en cours s’arrête avant le paquet suivant) ;
- **Paquet (étiquettes)** : taille des paquets Zebra (50 par défaut, mémorisée) ;
- *Vider* retire les travaux terminés de la liste (l’historique n’est pas touché).

Le panneau s’ouvre tout seul quand un travail se met en pause sur un problème d’imprimante. Une demande distante qui attend la confirmation de l’utilisateur bloque la file jusqu’à la réponse. Pour une demande distante interrompue en cours d’envoi, la réponse `mlz.result` vaut `ok: false` avec `count` = étiquettes réellement envoyées.

### Envoi Zebra par paquets

Un travail Zebra n’est plus envoyé d’un bloc :

1. **Avant le premier paquet**, l’état de l’imprimante est lu (`~HS`). Si elle signale *Plus de papier*, *Plus de ruban*, *Tête ouverte* ou *En pause*, le travail se met en pause avec ce message : **rien n’est envoyé**, ni la plage SSCC ni la numérotation ne sont consommées et **aucune entrée n’est ajoutée à l’historique** si vous annulez. *Reprendre* relit l’état puis continue.
2. Si l’état est **illisible** (Browser Print ne renvoie pas de réponse à `~HS`), le travail propose **Envoyer quand même** ; ce choix vaut pour la suite du travail.
3. Le lot est découpé en **paquets d’environ 50 étiquettes** ; l’état est revérifié **avant chaque paquet**. Une ligne dont les copies dépassent la taille du paquet est répartie sur deux paquets, sauf pour les étiquettes SSCC (les copies d’un même SSCC restent ensemble). Rouleau à plusieurs étiquettes de front : la taille du paquet est arrondie à un multiple du nombre de colonnes (une rangée peut malgré tout rester incomplète en fin de paquet si les copies ne tombent pas juste).
4. **Erreur d’envoi** d’un paquet (Browser Print injoignable…) : pause ; *Reprendre* renvoie **ce paquet** (il a pu être reçu en partie : risque de doublon sur ce paquet).

La visionneuse ZPL (*Envoyer à l’imprimante*) et les [étiquettes transporteur](etiquettes-transporteur.md) (*Imprimer la sélection*) vérifient aussi l’état avant l’envoi, mais envoient le code d’un seul bloc (tel quel pour les étiquettes transporteur) : imprimante pas prête → message et **rien n’est envoyé** ; état illisible → confirmation *Envoyer quand même ?* ; Browser Print injoignable → le fichier .zpl est téléchargé à la place (étiquettes transporteur).

### Historique et reprise

L’historique reflète ce qui a **réellement été transmis** : un travail interrompu est inscrit avec *n* étiquettes sur *N* (colonne *Nb* = étiquettes envoyées). Dans le panneau de la file, un travail interrompu (et la section *Travaux incomplets (historique)*) — ainsi que la fenêtre *Historique d’impression* (*Reprendre à partir de l’étiquette…*) — propose **Reprendre à partir de l’étiquette N** — par défaut la première non envoyée, modifiable pour réimprimer les dernières étiquettes d’un paquet perdu. La reprise réutilise le même document, les mêmes valeurs saisies, la même date et les mêmes SSCC ; la numérotation n’avance pas ; elle crée une nouvelle entrée d’historique liée à l’originale. *Réimprimer* une entrée incomplète reproduit les étiquettes qui étaient parties.

Les entrées enregistrées avant cette version (sans ces informations) restent lisibles, réimprimables, et peuvent aussi être reprises à partir d’une étiquette.

### SSCC et travaux interrompus

La plage SSCC d’un travail est **réservée au début** (avant le premier paquet) :

- si **aucune étiquette n’est partie** (imprimante pas prête puis *Annuler*), la plage est libérée : rien n’est consommé, rien n’est inscrit au journal ;
- dès qu’**au moins un paquet est parti**, la plage **entière** est consommée et reste attribuée au travail. Les SSCC non envoyés sont marqués dans le journal SSCC comme **réservés non imprimés** (champ `notPrinted` : nombre des derniers SSCC de la plage non envoyés). La fenêtre *Journal des SSCC émis* l’affiche (« dont N réservés non imprimés ») et l’export CSV a une dernière colonne *Réservé non imprimé* (« oui » sur ces SSCC ; colonne ajoutée en fin de ligne, les colonnes existantes ne bougent pas). *Reprendre* les imprime avec exactement ces numéros, et la mention disparaît quand tout est parti. Un SSCC n’est donc jamais attribué à deux palettes, même si le travail n’est jamais repris (il reste alors un « trou » documenté dans la série).

Pendant un travail SSCC en pause, les travaux SSCC des autres onglets attendent (verrou de réservation).

### Limites (non testé sur imprimante réelle)

- Seuls les indicateurs documentés de `~HS` sont utilisés : papier épuisé et pause (chaîne 1), tête ouverte et ruban épuisé (chaîne 2). Aucun autre état n’est déduit.
- « Envoyé » signifie **transmis à Browser Print** : `~HS` ne dit pas combien d’étiquettes ont réellement été imprimées. Si le papier manque au milieu d’un paquet, les étiquettes de ce paquet restées dans la mémoire de l’imprimante peuvent sortir après rechargement, ou être perdues selon le modèle : vérifiez les dernières étiquettes et choisissez le numéro de reprise en conséquence.
- Selon le pilote et la connexion, Browser Print ne relaie pas toujours la réponse à `~HS` : d’où l’option *Envoyer quand même*.
- Chaque vérification prend environ une à deux secondes (lecture de la réponse).

## Mode poste

Écran plein écran pour un **poste de préparation** : on scanne, l’étiquette sort. Ouvrez-le avec le bouton **Mode poste** de la barre du haut (ou *Options* → *Mode poste (scanner → imprimer)*). Il travaille sur l’étiquette ouverte dans l’éditeur et ses **données importées**.

- **Douchette USB uniquement** (mode clavier, qui termine le code par *Entrée*). La caméra n’est **pas** prise en charge. Le champ de scan reprend le focus après chaque action.
- **Colonne de recherche** : choisie parmi les colonnes importées ; une colonne dont le nom contient « ean », « code » ou « emplacement » est présélectionnée.
- Au scan, recherche **exacte** dans cette colonne, **sans tenir compte des espaces ni de la casse** :
  - **une ligne** : elle est imprimée aussitôt (comme *Imprimer ceci* sur cette ligne), par la file d’impression, et apparaît dans l’historique ;
  - **plusieurs lignes** : une liste permet de choisir (*Échap* la ferme) ;
  - **aucune ligne** : message d’erreur bien visible et **bip court** (désactivable : *Bip activé / désactivé*, mémorisé).
- **Copies par scan** : nombre d’exemplaires de chaque étiquette.
- Valeurs à saisir `{{?…}}` : demandées **une fois** à l’ouverture (ou au premier scan), puis réutilisées pour toute la session ; *Modifier* pour les changer.
- **Sortie** : l’imprimante Zebra si une imprimante est mémorisée ou définie par défaut dans Browser Print (avec la vérification d’état et la pause décrites plus haut ; *Reprendre* / *Annuler* directement dans l’écran) ; sinon chaque scan **télécharge un fichier .zpl**, ce que l’écran signale (en tête d’écran et dans le message de chaque scan : « fichier .zpl téléchargé »).
- Affichage : aperçu de la dernière étiquette, nombre d’étiquettes imprimées pendant la session, 10 derniers scans.
- **Échap** ou *Fermer* quitte le mode poste (si la liste de choix est ouverte, *Échap* ferme d’abord la liste).

Avec `{{#sscc}}`, chaque scan consomme un nouveau SSCC.
