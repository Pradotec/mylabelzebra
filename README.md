# MyLabelZebra

Éditeur d’étiquettes gratuit qui tourne entièrement dans le navigateur. Il sert aux imprimantes thermiques Zebra (ZPL) comme aux imprimantes de bureau (PDF, planches Avery). Aucune donnée n’est envoyée à un serveur : tout reste dans le navigateur (IndexedDB et localStorage).

Stack : Vite, React 18, TypeScript, Konva (react-konva), bwip-js (codes-barres), jsPDF, JSZip, PapaParse, SheetJS (xlsx) et zustand.

## Lancer le projet

Sous Windows, lancez les commandes dans **PowerShell** :

```powershell
cd C:\Users\Thomas\Desktop\projets\mylabelzebra
npm install
npm run dev        # http://localhost:5173
npm run build      # vérification TypeScript + build de production dans dist/
npm run preview    # sert le build (service worker / mode hors ligne actif)
```

## Fonctionnalités

### Éditeur
- Éléments disponibles : texte, code-barres, QR code, image, formes (22 formes, avec une recherche), tableau, symboles d’entretien textile, pictogrammes de danger et avertissements pour bougies (dessins vectoriels originaux).
- Manipulation : déplacer, redimensionner, faire pivoter (aimantation tous les 45°), miroir H/V et « réduire pour tenir dans l’étiquette ».
- Sélection multiple : rectangle de sélection, ou Maj/Ctrl + clic.
- Groupes imbriqués : Ctrl+G pour grouper, Ctrl+Maj+G pour dégrouper. Alt + clic sélectionne un élément à l’intérieur d’un groupe.
- Repères intelligents : aimantation aux bords et aux centres des autres objets et de l’étiquette. Grille aimantée avec un pas réglable.
- Règles en mm ou en pouces. On tire un repère depuis une règle et on le ramène sur la règle pour le supprimer. Les repères sont enregistrés avec l’étiquette.
- Double-clic sur un texte ou une cellule de tableau pour le modifier directement.
- Historique de 80 étapes (Ctrl+Z, Ctrl+Y ou Ctrl+Maj+Z), conservé après un rafraîchissement de la page. La sauvegarde est automatique et inclut le zoom propre à chaque étiquette.
- Raccourcis : Ctrl+C, V, X, D et A, Suppr. Les flèches déplacent de 1 point (10 avec Maj). Ctrl + molette pour zoomer, molette pour faire défiler.
- Mode aperçu, qui masque les outils.
- **Aperçu thermique** (bouton à côté de l’œil, en bas à droite) : l’étiquette est affichée telle que l’imprimante thermique l’imprimera, en noir et blanc à la résolution du document. C’est le même rendu que le ZPL « tout en image » : gris tramés (trame de Bayer 8×8), codes-barres et QR en noir pur. Il suit la ligne de données affichée et reste modifiable (sélection, déplacement).
- **Éléments conditionnels** : dans les propriétés de n’importe quel élément, « Afficher seulement si [colonne ou champ] [est vide | n’est pas vide | = | ≠ | contient] [valeur] ». La condition est évaluée pour chaque ligne de données partout (éditeur, aperçu, impression, PDF, PNG, SVG, ZPL, planches). Dans l’éditeur, un élément dont la condition n’est pas remplie est estompé (masqué en aperçu) ; un badge « si » le signale dans les calques. Comparaison insensible à la casse et aux accents.
- Images : bouton d’import, glisser-déposer, Ctrl+V ou clic droit › « Coller une image » (PNG, JPG, GIF, SVG). Seuil et tramage réglables pour l’impression.
- Tableaux : ligne d’en-tête, saisie dans les cellules, `{{colonne}}` dans les cellules, colonnes et lignes redimensionnables à la souris.
- Sélecteurs de couleur avec code hexadécimal et pipette (API EyeDropper, Chrome et Edge).
- Étiquettes rondes, couleur de fond, taille personnalisée en pouces ou en mm, résolution 203, 300 ou 600 dpi.

### Ajustement du texte (données de longueur variable)
Chaque texte est une boîte dont la largeur et la hauteur sont explicites. Redimensionner la boîte ne change pas la police, seulement la zone imprimable. Le panneau « Ajustement du texte » propose quatre modes :
- **Une ligne — réduire la police** : le texte ne passe jamais à la ligne. La police diminue jusqu’à la taille minimale, puis le texte est tronqué avec « … » (en option).
- **Retour à la ligne — réduire si déborde** : le texte passe à la ligne entre les mots (les mots trop longs sont coupés). Si le texte dépasse la hauteur de la boîte, la police diminue jusqu’à la taille minimale.
- **Retour à la ligne illimité** : la hauteur de la boîte suit le contenu, avec un nombre maximal de lignes en option.
- **Aucun** : la boîte garde une taille fixe et le débordement est rogné.

Réglages complémentaires : nombre maximal de lignes, interligne, alignement à gauche, centré, à droite ou justifié, alignement vertical haut, milieu ou bas.

L’ajustement est recalculé **pour chaque ligne de données**, aussi bien dans l’éditeur que pour l’impression, le PNG, le SVG, le PDF, le ZIP et le ZPL : une valeur courte garde la taille de base, une valeur longue est réduite. Une seule fonction calcule cette mise en page pour tous les rendus : `src/render/textLayout.ts`.

### Codes-barres et QR
- Symbologies : CODE128, GS1-128, EAN-13, EAN-8, UPC-A, UPC-E, CODE39, CODE93, ITF, SSCC-18 (clé calculée automatiquement à partir de 17 chiffres), Codabar et Data Matrix. Le moteur est bwip-js.
- Validation immédiate avec un message en rouge (par exemple « UPC invalide »). Le texte lisible est optionnel. Les modules sont calculés en points entiers à la résolution de l’imprimante.
- QR code : URL ou texte, Wi-Fi (SSID, mot de passe, chiffrement) ou vCard. Niveau de correction L, M, Q ou H.

### Données et séries
- `{{colonne}}` fonctionne dans les textes, les codes-barres, les QR et les cellules de tableau. Un clic sur le nom d’une colonne l’insère.
- Sources acceptées : fichiers .xlsx, .xls et .csv (virgules entre guillemets gérées), CSV ou TSV collé (chargé dès le collage, sans bouton) et lien Google Sheets publié en CSV.
- Une ligne de données correspond à une étiquette. Chaque ligne a une case à cocher (décochée au départ) et un nombre de copies. Un curseur sous l’étiquette permet de parcourir les lignes. On peut corriger une ligne avec « Modifier la ligne ». Seules les lignes cochées sont imprimées ou exportées.
- Numérotation `{{numero}}` : départ, pas, nombre de chiffres (zéros devant), préfixe, suffixe, jusqu’à 500 étiquettes. Après une impression Zebra, le numéro de départ avance automatiquement.
- Dates : `{{date}}` avec un choix de formats, aujourd’hui ou aujourd’hui + N jours. `{{date+30}}` est aussi accepté. `{{aujourdhui}}` donne la date du jour (à combiner avec les formats ci-dessous).
- **Formats dans les champs** : filtres après le nom du champ, séparés par `|`, appliqués de gauche à droite (texte, codes-barres, QR, cellules de tableau, conditions) :
  `defaut:N/A`, `maj`, `min`, `cap`, `trim`, `tronquer:20`, `pad:6` (zéros devant), `nombre:2` (format français), `prix` (12,50 €), `date:JJ/MM/AAAA` (lit les dates Excel, ISO, jj/mm/aaaa, jj/mm/aa, AAAAMMJJ ; jetons JJ, MM, MMM, MMMM, AA, AAAA, HH, mm), `jours:+5` (ajoute des jours, à placer avant `date`), `remplacer:a:b`, `chiffres` (ne garde que les chiffres), `cleprix` (clé « prix » des EAN-13 à prix variable).
  Exemples : `{{fabrication|jours:+5|date:JJ/MM/AAAA}}`, `{{prix|prix}}`, `{{lot|defaut:SANS LOT|maj}}`. Un filtre inconnu laisse la valeur inchangée et un avertissement s’affiche dans le panneau. Le bouton ⓘ à côté de « {} Champ » liste les formats.
- **Saisie à l’impression** : `{{?Lot}}` ou `{{?Poids (kg)|nombre:3}}` déclare une valeur demandée au moment d’imprimer ou d’exporter (impression, PDF, PNG, JPG, SVG, ZPL, planches). Une fenêtre liste les champs ; les valeurs valent pour tout le travail et les dernières sont mémorisées par étiquette (localStorage). Dans l’éditeur, la dernière valeur (ou le nom du champ) est affichée.

### Étiquetage alimentaire
- **Allergènes en gras** (option du texte) : les 14 allergènes du règlement INCO (UE 1169/2011) et leurs variantes courantes en français (gluten, blé, seigle, orge, avoine, épeautre, crustacés, œufs, poissons, arachides, soja, lait, lactose, beurre, crème, fromage, fruits à coque, amandes, noisettes, noix, cajou, pécan, pistaches, macadamia, céleri, moutarde, sésame, sulfites, anhydride sulfureux, lupin, mollusques…) sont repérés sans tenir compte de la casse ni des accents, en mots entiers (pluriels compris), plus une liste complémentaire propre à l’étiquette. « Lait de coco », « beurre de cacao », « noix de coco / de muscade » ne sont pas mis en gras. La mise en page (retour à la ligne, réduction, « … ») mesure les segments gras et normaux séparément ; le rendu est identique à l’écran, en PNG/PDF, en SVG (un `<text>` par segment) et en ZPL (texte envoyé en image).
- **DLC / DDM** : panneau Date › « Date limite » : à partir d’aujourd’hui ou d’une colonne, + N jours, avec la mention « À consommer jusqu’au » ou « À consommer de préférence avant le » (insère par exemple `À consommer jusqu’au {{aujourdhui|jours:+21|date:JJ/MM/AAAA}}`).
- Modèles « Étiquette produit alimentaire » (dénomination, ingrédients avec allergènes en gras, poids net, lot à saisir, DLC, conservation, EAN-13) et « Colis / palette GS1-128 » (GTIN du contenu, quantité, lot, DLC, SSCC).

### Codes GS1
- **Assistant GS1-128** (propriétés d’un code GS1-128) : construction de la donnée par identifiant d’application — (00) SSCC, (01) GTIN, (02) GTIN du contenu, (10) lot, (11) date de production, (13) date d’emballage, (15) DDM, (17) DLC, (21) série, (37) quantité, (3100–3105) poids net en kg, (3920–3923) prix. Clés GTIN/SSCC calculées ou vérifiées, longueurs et dates contrôlées, sélecteur de date (AAMMJJ), valeurs pouvant contenir des `{{champs}}`. Les AI à longueur fixe sont placés en premier ; le séparateur FNC1 est ajouté automatiquement.
- **Assistant SSCC** (code SSCC-18) : extension + préfixe entreprise + référence (ou `{{numero}}`), clé calculée.
- **EAN-13 à poids / prix variable** (propriétés d’un EAN-13) : trois structures — 2X + article 5 + valeur 5 ; 2 + article 6 + valeur 5 (convention française) ; 2X + article 5 + clé prix + valeur 4 (clé prix GS1 pondérations 2-, 2-, 3, 5-). Valeur saisie (g / centimes) ou tirée d’un champ (kg / € convertis par filtres). La clé EAN est calculée automatiquement.
- **ZPL des GS1-128 / SSCC** : le générateur reprend exactement les mots de code calculés à l’écran (bwip-js) et les écrit en `^BC` mode N avec départ et changements de jeu explicites (`>;`, `>6`, `>5`) et FNC1 explicites (`>8`), au lieu de dépendre du mode D (firmware x.11+). Le texte lisible « (AI)… » est envoyé en image, placé comme à l’écran. La visionneuse relit ces codes et reconstruit la donnée « (AI)valeur ».

### Historique d’impression
Options › « Historique d’impression » : journal local (IndexedDB, 500 derniers travaux) de chaque impression ou export — date et heure, étiquette, sortie (ordinateur, Zebra, PDF, PNG, JPG, SVG, ZPL, planches), nombre d’étiquettes, lignes imprimées, valeurs saisies et une copie complète du document. « Réimprimer » reproduit exactement le travail (mêmes données, valeurs saisies et même date de référence pour `{{date}}` / `{{aujourdhui}}`) ; « Ouvrir » charge cette version dans l’éditeur. L’historique peut être vidé.

### Impression pilotée par d’autres outils (local)
- **Lien** : `?modele=<nom ou id dans Mes étiquettes>&data=<tableau JSON d’objets en base64url>&imprimer=zebra|ordinateur|pdf|zpl&copies=N&invite.Lot=valeur`. Le modèle est chargé, les lignes injectées (toutes cochées), les champs `{{?…}}` remplis, puis l’impression est lancée après confirmation. Le lien n’est traité qu’une fois (il est retiré de la barre d’adresse).
- **window.postMessage** : une application qui ouvre l’éditeur (ou l’intègre en iframe) reçoit `{ type: 'mlz.ready' }`, envoie `{ type: 'mlz.print', modele, rows, prompts, imprimer, copies, id }` et reçoit `{ type: 'mlz.result', ok, count, error, id }`.
- Jamais d’impression silencieuse au premier usage : un bandeau affiche l’origine, le modèle, le nombre d’étiquettes et la sortie. La case « Autoriser l’impression automatique pour ce modèle » supprime la confirmation pour ce modèle et cette origine (révocable dans Aide › Intégration).
- Aide › **Intégration** documente les deux méthodes avec des exemples à copier (lien, script Python, JavaScript).

### Enregistrement et export
- « Mes étiquettes » : jusqu’à 50 modèles stockés dans IndexedDB, avec miniature, du plus récent au plus ancien. On peut les renommer, les dupliquer et les supprimer.
- Exports : PNG, JPG et PDF à la résolution choisie, SVG (vectoriel pour le texte, les codes et les formes simples). En lot : un PDF de plusieurs pages, ou un PDF par étiquette réuni dans un ZIP.
- ZPL : copie ou téléchargement d’un fichier `.zpl`. Le texte, les codes, le QR, les rectangles, les cercles et les tableaux sont générés en commandes natives. Le reste (rotations, miroirs, images, formes complexes, texte justifié, texte qui frôle le bord) est rasterisé en `^GFA` compressé. L’option « tout en image » rasterise toute l’étiquette.
- JSON : export, import, et « Copier / Coller l’étiquette » via le presse-papiers.
- Visionneuse ZPL : on y colle du code ou on ouvre un fichier .zpl. Un moteur local en affiche l’aperçu (^FO ^FT ^A ^CF ^FD ^FH ^FB ^FR ^GB ^GE ^GC ^BY ^BC ^BE ^B8 ^BU ^B9 ^B3 ^BA ^B2 ^BK ^BQ ^BX ^GFA, y compris la compression ASCII et Z64, ^LH ^PW ^LL). La visionneuse gère plusieurs étiquettes, convertit le ZPL en étiquette modifiable et imprime le code d’origine sans le modifier.

### Impression
- **Cet ordinateur** : impression par le navigateur avec une page `@page` à la taille exacte de l’étiquette, des consignes sur l’échelle à 100 % et l’orientation, et une impression test qui trace les contours numérotés des étiquettes (cercles pour les étiquettes rondes).
- **Imprimante Zebra** : passe par Zebra Browser Print (http://127.0.0.1:9100 et https://127.0.0.1:9101). Fonctions : liste et choix de l’imprimante, mémorisation de la dernière utilisée, lecture des réglages (`~HI` pour le modèle et la résolution, `^HH` pour la noirceur, la vitesse et la taille), réglages mémorisés par imprimante, détection de la résolution, état de l’imprimante via `~HS` (tête ouverte, papier, ruban, pause). Une aide d’installation s’affiche si Browser Print est absent.
- **Planches A4 / Letter** (Avery 5160, 5161, 5162, 5163, 5164, 5167, 5126, 22806, 22807, 8293 et A4 L7160, L7163) : mode « une étiquette par ligne » ou « même étiquette partout », avec le nombre d’étiquettes, la case de départ, une option « texte uniquement » et le PDF de toutes les planches.

### Modèles
La galerie compte 15 modèles, avec aperçus, recherche et filtres par catégorie et par marque : inventaire 4×2, expédition 4×6, produit EAN-13 2×2, QR 2×2, valeurs nutritionnelles 2×3, bijou 1,5×1, étagère 3×1, câble 2×1, couvercle de bocal rond, topper cupcake rond, étiquette matériel QR, adresse DYMO, étiquette prix, étiquette produit alimentaire 4×3 et colis / palette GS1-128 4×6.

Formats prédéfinis par marque : rouleaux standard, Zebra, Rollo, DYMO (30252, 30334, 99010…), Brother (DK-11201, DK-11209, DK-22205…) et étiquettes rondes.

### Mobile, hors ligne et langues
- Interface adaptée au téléphone et à la tablette : barre inférieure (Texte, Code-barres, QR, Données, Plus), glisser au doigt, zoom à deux doigts, appui long pour le menu (copier, coller, supprimer, décaler), « Tout sélectionner ».
- PWA : manifeste et service worker pour l’usage hors ligne et l’ajout à l’écran d’accueil. Le service worker n’est actif qu’en production (`npm run build`, puis `npm run preview`).
- Langues : français par défaut, anglais via Options › Langue ou `?lang=en`. Pour ajouter une langue, il suffit de créer un dictionnaire sur le modèle de `src/i18n.en.ts`.
- Liens pré-remplis : `?barcode=123&type=code128`, `?qr=https://…`, `?text=…`, `?seq=SKU-{n}&start=1&count=50&pad=4`, avec en option `&w=4&h=2&dpi=300`.
- Outils autonomes : générateur de code-barres, générateur de QR code et visionneuse ZPL.

## Limites connues
- Planches Avery : les dimensions suivent les gabarits publiés (marges et pas vérifiés pour retomber exactement sur la page), mais chaque imprimante de bureau décale un peu la page. Faites une impression test sur papier ordinaire à 100 %, puis corrigez avec « Calibrage de l’imprimante » (décalage X/Y en mm) dans la fenêtre des planches.
- La visionneuse ZPL gère les orientations N/R/I/B (`^A`, `^FW`, codes-barres) et les origines `^FO`/`^FT`, mais elle imite les polices Zebra : `^A0` est rendue par une linéale grasse condensée, les polices bitmap A–H par une police à chasse fixe aux mêmes dimensions de cellule. L’aperçu reste approximatif au pixel près.
- Le texte natif ZPL utilise la police `^A0` de l’imprimante, dont les métriques diffèrent d’Arial. Dès qu’une ligne frôle le bord de sa boîte, ou que la police n’est pas une sans-serif courante, le texte est envoyé en image pour rester fidèle à l’écran. L’option « ZPL : envoyer ce texte en image » force ce comportement pour un texte donné.
- ZPL et gris : une imprimante thermique n’imprime que des points noirs. Les gris (textes, formes, fond) sont donc tramés (trame ordonnée 8×8 alignée sur les points d’impression), avec une densité égale au gris choisi. Les codes-barres et QR restent toujours en noir pur pour rester lisibles.
- Changer la taille de l’étiquette met le contenu à l’échelle et le recentre (« Adapter à la taille »), ou le garde tel quel en le ramenant dans l’étiquette (« Garder la taille ») : réglage dans le menu de taille.
- Zebra Browser Print n’a pas pu être testé faute d’imprimante. La lecture des réglages et des états repose sur la documentation ZPL (`~HI`, `^HH`, `~HS`).
- `xlsx` est la version 0.20.3 distribuée par SheetJS (cdn.sheetjs.com), qui corrige les failles de la 0.18.5 de npm ; `jspdf` est en 4.2.1. `npm audit` ne signale aucune vulnérabilité.
- Allergènes : le repérage se fait sur une liste de mots (français) ; il ne remplace pas la vérification réglementaire de la liste d’ingrédients. Un mot ambigu (« noix » seul, « crème » d’un dessert sans lait…) est mis en gras par prudence ; ajoutez les cas propres à vos recettes dans la liste complémentaire.
- Formats : un `|` ne peut pas figurer dans l’argument d’un filtre (`remplacer`, `defaut`). `date:` lit les dates jour/mois/année (convention française) : une date américaine mm/jj/aaaa sera mal lue.
- GS1-128 : la reconstruction « (AI)valeur » dans la visionneuse ZPL repose sur une table des longueurs d’AI courantes ; un AI exotique est affiché comme Code 128 brut (barres identiques). Les caractères GS1 autorisés dans les AI alphanumériques sont limités aux lettres sans accent, chiffres et ponctuation simple (pas d’espace).
- Impression pilotée : la page doit être ouverte dans le navigateur où les modèles sont enregistrés (stockage local) ; l’impression navigateur (« ordinateur ») ouvre toujours la boîte de dialogue d’impression du navigateur.
- `bwip-js` (moteur de codes-barres, ~240 Ko compressé) reste le plus gros fichier. jsPDF, JSZip et SheetJS ne sont chargés qu’au premier export ou import Excel.
