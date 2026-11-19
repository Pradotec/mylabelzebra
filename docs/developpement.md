# Développement

## Pile technique

Vite 5, React 18, TypeScript 5 (strict), zustand (état), Konva / react-konva (édition), bwip-js (codes-barres), jsPDF et JSZip (PDF, ZIP), PapaParse (CSV), SheetJS `xlsx` 0.20.3 (Excel/ODS), pdf.js (PDF transporteur), lucide-react (icônes). Tests : Vitest 2 + happy-dom + @napi-rs/canvas.

## Commandes

```bash
npm ci
npm run dev        # serveur de développement (http://localhost:5173)
npx tsc --noEmit   # vérification des types
npm test           # vitest run
npm run build      # tsc --noEmit && vite build
npm run preview    # sert dist/ avec le service worker
```

En développement, le store est exposé dans la console sous `window.__mlz` (pour les tests manuels et automatisés) ; le service worker n’est enregistré qu’en production.

## Structure du code

```
src/
├── main.tsx, App.tsx       point d'entrée, raccourcis clavier, coller / déposer, barres
├── store.ts                état global (zustand) : document, sélection, annuler/rétablir (80 états)
├── types.ts                modèle de document (LabelDoc, éléments, données, réglages)
├── elements.ts             création / normalisation des éléments
├── actions.ts              actions de haut niveau (Mes étiquettes, import JSON, insertion de champs…)
├── storage.ts              stockage clé/valeur IndexedDB (repli localStorage), erreurs de quota
├── data.ts                 import CSV/TSV/Excel/ODS/Google Sheets, encodage, avertissements
├── jobs.ts                 travaux d'impression/export : saisies, SSCC, historique, réimpression
├── export.ts               PNG/JPG, PDF, ZIP, SVG, planches, impression navigateur, miniatures
├── prompts.ts              champs {{?…}} : options et validation
├── remote.ts, urlParams.ts impression pilotée (lien, postMessage) et liens pré-remplis
├── zebra.ts                client Zebra Browser Print (/available, /default, /write, /read)
├── sscc.ts                 compteur SSCC sans doublon (verrou, journal)
├── food.ts, nutrition.ts   conformité INCO, tableau nutritionnel
├── pictos.ts               bibliothèque de pictogrammes personnels
├── sizes.ts, templates.ts  formats, planches, modèles
├── i18n.ts, i18n.en.ts     traduction (clé = texte français)
├── render/
│   ├── draw.ts             rendu canvas d'un élément / d'une étiquette (partagé écran, export, ZPL image)
│   ├── textLayout.ts       mise en page du texte (fonction unique pour tous les rendus)
│   ├── resolve.ts          champs {{…}}, filtres, dates, conditions, numérotation, lots
│   ├── flow.ts             lignes vides et ancrage vertical
│   ├── codes.ts            encodage des codes (bwip-js), validation, clés GS1
│   ├── shapes.ts, marks.ts formes, symboles, estampille, signe ℮
│   ├── allergens.ts, foodRoles.ts
│   └── images.ts
├── zpl/
│   ├── generate.ts         générateur ZPL (natif + ^GFA), rouleau multi-colonnes
│   ├── code128.ts          mots de code Code 128 / GS1-128 → ^BC mode N
│   ├── gfa.ts              ^GFA (hexadécimal, compression ASCII), bitmap 1 bit
│   └── parse.ts            interpréteur ZPL de la visionneuse + vérificateur (lint)
├── carrier/                étiquettes transporteur (ZPL brut, PDF/images → ^GFA)
├── components/             interface React (Editor, panneaux, fenêtres)
└── test/                   configuration des tests (setup.ts, mesure déterministe)
```

## Architecture de rendu

Une étiquette est décrite par un `LabelDoc` dont toutes les géométries sont en **unités « u » = 1/203 de pouce** (un point à 203 dpi). La résolution réelle n’intervient qu’à la sortie.

```
             LabelDoc + ligne de données
                        │
             render/resolve.ts  ── champs, filtres, conditions, numéros, SSCC
                        │
             render/flow.ts     ── lignes vides, ancrage vertical
                        │
             render/textLayout.ts ── lignes, taille de police effective (une seule fonction)
        ┌───────────────┼──────────────────────────┬─────────────────────┐
        ▼               ▼                          ▼                     ▼
  Écran (Konva)   render/draw.ts (canvas)     export.ts : SVG     zpl/generate.ts
  components/     PNG, JPG, PDF, planches,    (texte, codes et    commandes natives,
  Editor.tsx      impression, aperçu          formes vectoriels)  sinon élément rendu
                  thermique, ^GFA                                 par draw.ts → ^GFA
```

Principes :

- **Une seule mise en page du texte** (`textLayout.ts`) pour l’éditeur, les exports et le ZPL : une valeur longue est réduite de la même façon partout.
- **Les codes-barres** sont encodés une fois par bwip-js (`codes.ts`) ; la géométrie (module en points entiers à la résolution du document) est partagée entre l’écran, les images et le ZPL. Le ZPL GS1-128 réutilise les mêmes mots de code (`code128.ts`).
- **ZPL hybride** : un élément est écrit en commande native quand le résultat est fidèle à l’écran (police sans-serif, pas de rotation, texte qui ne frôle pas le bord…), sinon il est rendu par `draw.ts` puis converti en `^GFA` (seuil, tramage de Bayer 8×8 pour les gris). L’option « tout en image » rasterise l’étiquette entière — c’est aussi le rendu de l’aperçu thermique.
- **Résolution des champs par ligne** : chaque sortie appelle `resolve.ts` avec un contexte (index, ligne, document). Un travail fige une copie du document (`jobDoc`) avec les valeurs saisies, la date de référence et la plage SSCC, conservée dans l’historique pour une réimpression à l’identique.
- **Chargement à la demande** : jsPDF, JSZip, SheetJS et pdf.js sont importés dynamiquement ; bwip-js, Konva, React et les icônes sont séparés en fichiers `vendor-*` (voir `vite.config.ts`).

## Tests

- Fichiers `src/**/*.test.ts` (Vitest, environnement happy-dom, `pool: 'forks'`).
- `src/test/setup.ts` fournit un vrai canvas 2D (`@napi-rs/canvas`, binaire précompilé) et une **mesure de texte déterministe** (largeur = nombre de caractères × taille × 0,5) : les tests ne dépendent pas des polices installées.
- Couverture : filtres et dates (`resolve.test.ts`), mise en page du texte, flux, ZPL (générateur, `^GFA`, parseur, symbologies, tableaux, rouleau), codes, conformité alimentaire, nutrition, SSCC, travaux et historique, stockage, impression pilotée, transporteur (PDF de bout en bout, raster, encodage ZPL).

## Ajouter une langue

`src/i18n.ts` déclare `LANGS` et un dictionnaire par langue (clé = texte français utilisé dans le code). Copiez `src/i18n.en.ts`, traduisez les valeurs, puis ajoutez la langue dans `LANGS` et `DICTS`.

## Intégration continue

`.github/workflows/ci.yml` : sur chaque push / pull request, Node 22 → `npm ci`, `npx tsc --noEmit`, `npm test`, `npm run build` (artefact `dist`), puis construction de l’image Docker et vérifications HTTP (`/healthz`, titre, repli SPA, cache des assets, `sw.js`, types MIME du manifeste et du worker `.mjs`).
