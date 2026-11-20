# FAQ et dépannage

## Zebra Browser Print n’est pas détecté

La fenêtre *Imprimante Zebra* affiche « Zebra Browser Print n’est pas détecté ». Vérifiez dans l’ordre :

1. **Browser Print est installé et lancé** (icône dans la barre des tâches / barre de menus). Il démarre parfois seulement à l’ouverture de session : relancez-le.
2. **Le certificat HTTPS local est accepté** : ouvrez `https://127.0.0.1:9101/ssl_support` dans le même navigateur et acceptez l’avertissement de sécurité. Sans cela, seul `http://127.0.0.1:9100` est utilisable.
3. **Le site est autorisé** : à la première impression, Browser Print demande d’accepter l’origine (`http://localhost:5173`, `http://localhost:8080`, `https://etiquettes.exemple.fr`…). Un refus est mémorisé : rouvrez les réglages de Browser Print pour l’autoriser.
4. **L’imprimante est déclarée dans Browser Print** (USB ou réseau) : si Browser Print répond mais qu’aucune imprimante n’apparaît, ajoutez-la dans son interface.
5. **Le navigateur autorise l’accès au réseau local** : certains navigateurs ou politiques d’entreprise bloquent les requêtes d’un site vers `127.0.0.1` (accès au réseau privé). Autorisez-le pour l’adresse de MyLabelZebra, ou utilisez l’application depuis `localhost`.
6. Cliquez sur **Réessayer**.

En attendant : *Imprimer* → *Cet ordinateur*, ou *Options* → *Télécharger le ZPL (.zpl)* et envoyez le fichier par l’outil de votre choix (Zebra Setup Utilities, copie sur le port de l’imprimante…).

## Faut-il HTTPS ?

- Sur **`http://localhost`**, tout fonctionne (contexte sécurisé).
- Sur une **autre adresse en HTTP** (ex. `http://192.168.1.10:8080`), le navigateur désactive le service worker (pas de mode hors ligne ni d’installation), l’API presse-papiers (*Coller une étiquette (JSON)*, *Coller une image*) et la pipette ; l’accès à Browser Print peut aussi être bloqué. Servez l’application en **HTTPS** derrière un proxy (voir [Installation](installation.md#derrière-un-proxy-https)).
- Les appels de la page HTTPS vers `http://127.0.0.1:9100` sont autorisés par les navigateurs actuels (`127.0.0.1` est considéré comme sûr) ; l’application essaie aussi `https://127.0.0.1:9101`.

## « Stockage du navigateur plein »

Les étiquettes, l’historique (jusqu’à 40 Mo), les pictogrammes et le compteur SSCC sont stockés dans le navigateur, dont le quota dépend de l’espace disque et du navigateur (souvent limité en navigation privée). En cas de dépassement, un message s’affiche au lieu d’un échec silencieux :

- *Options* → *Historique d’impression* → **Effacer l’historique** (ou supprimer des entrées) ;
- supprimer des étiquettes inutiles dans *Mes étiquettes*, ou des images lourdes (privilégiez des images de taille raisonnable) ;
- supprimer des pictogrammes de *Mes pictogrammes* ;
- ne pas utiliser la navigation privée pour un usage durable.

Pensez à **exporter vos étiquettes en JSON** (*Options* → *Exporter l’étiquette*) : effacer les données du site dans le navigateur supprime tout.

## Les accents de mon CSV sont mal affichés

- Les fichiers UTF-8 (avec ou sans BOM) sont lus tels quels ; sinon le fichier est relu en **Windows-1252** (le « CSV » d’Excel en France) et un avertissement s’affiche. Si les accents restent faux, le fichier est dans un autre encodage : enregistrez-le depuis Excel en **« CSV UTF-8 (délimité par des virgules) »**, ou importez directement le `.xlsx`.
- Coller les cellules depuis le tableur évite toute question d’encodage.

## Mes codes GTIN / SSCC perdent leurs derniers chiffres

Excel stocke les nombres de plus de 15 chiffres en virgule flottante : un SSCC de 18 chiffres saisi comme nombre est arrondi. L’import le signale. Formatez la colonne en **Texte** dans Excel (ou préfixez par une apostrophe) puis réimportez. Les SSCC du journal sont exportés avec « (00) » pour cette raison.

## Une date de mon fichier est mal lue

Le filtre `date:` lit les dates au format jour/mois/année (convention française), ISO `AAAA-MM-JJ`, `AAAAMMJJ` ou les numéros de série Excel. Une date américaine `mm/jj/aaaa` sera mal interprétée : convertissez-la en ISO dans le tableur.

## Seule une étiquette s’imprime alors que j’ai importé 200 lignes

Les lignes importées sont **décochées** : cochez-les (*Tout*, ou filtre puis *Cocher les lignes filtrées*). Sans ligne cochée, seule la ligne affichée est imprimée.

## L’impression sur planche est décalée

Faites une *Impression test* sur papier ordinaire **à 100 %** (désactivez « Ajuster à la page » et les marges), superposez-la à une planche à contre-jour et corrigez *Calibrage de l’imprimante* (mm). Voir [Planches](impression-et-export.md#planches-a4--letter-avery).

## L’étiquette imprimée par la Zebra est décalée, trop claire ou à la mauvaise taille

- Vérifiez que la **résolution** du document (203/300/600 dpi) est celle de l’imprimante (*Imprimante Zebra…* → *Lire les réglages de l’imprimante*).
- Ajustez la *Noirceur* et la *Vitesse* (*Appliquer et mémoriser*).
- Calibrez le support sur l’imprimante (procédure du constructeur) si les étiquettes « sautent ».
- Si un texte natif ne ressemble pas à l’écran, cochez *ZPL : envoyer ce texte en image* ou *ZPL : tout en image (^GFA)*.

## Le texte change de taille d’une étiquette à l’autre

C’est l’**ajustement du texte** : une valeur longue est réduite pour tenir dans la boîte. Choisissez le mode *Aucun* ou augmentez la *Taille minimale* ([Ajustement du texte](editeur.md#ajustement-du-texte)).

## Le lien Google Sheets ne fonctionne pas

Utilisez *Fichier › Partager › Publier sur le Web*, choisissez l’onglet et le format **CSV**, puis collez le lien (`…/pub?output=csv`). Un lien de partage ordinaire ne fonctionne que si la feuille est accessible sans connexion. Les données de la feuille sont alors **publiques** : n’y mettez rien de confidentiel, ou importez plutôt un fichier.

## Où sont mes données ? Comment passer sur un autre poste ?

Dans le navigateur (IndexedDB et localStorage), pour cette adresse précise : `http://localhost:5173`, `http://localhost:8080` et votre domaine sont trois espaces de stockage distincts. Pour transférer : *Options* → *Exporter l’étiquette* (JSON) puis *Importer une étiquette* sur l’autre poste.

## Mes étiquettes exportées restent-elles compatibles après une mise à jour ?

Oui. Un fichier `.mlz.json` indique la version de son format ; à l’ouverture, l’application convertit automatiquement les fichiers plus anciens, et il en va de même pour « Mes étiquettes ». Chaque mise à jour est testée sur des fichiers d’exemple des versions précédentes.

Si un fichier vient d’une version **plus récente** de l’application (par exemple ouvert sur un poste qui n’a pas encore été mis à jour), il s’ouvre quand même, avec un avertissement : ce que cette version ne connaît pas n’est pas affiché, mais est conservé si vous réexportez le fichier. Vérifiez l’étiquette avant d’imprimer, ou mettez à jour l’application (voir ci-dessous).

**Conseil** : gardez vos exports `.mlz.json` comme sauvegarde (*Options* → *Exporter l’étiquette*). « Mes étiquettes » vit dans le navigateur : effacer les données du site ou changer de poste les fait disparaître, pas vos fichiers.

## L’application ne se met pas à jour

Le service worker sert la version en cache puis récupère la nouvelle en arrière-plan : rechargez la page une seconde fois. Côté serveur, `index.html`, `sw.js` et `manifest.webmanifest` doivent être servis en `Cache-Control: no-cache` (c’est le cas de la configuration Docker fournie).

## Le PDF transporteur n’est pas converti

La lecture des PDF utilise un worker pdf.js (`assets/pdf.worker.min-*.mjs`) : le serveur doit le servir avec le type `application/javascript`. C’est le cas de la configuration nginx fournie ; avec un autre serveur, ajoutez le type MIME pour `.mjs`.
