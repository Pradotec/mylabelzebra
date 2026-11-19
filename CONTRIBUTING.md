# Contribuer à MyLabelZebra

Merci de votre intérêt ! Avant de contribuer, lisez la [licence](LICENSE) (source disponible, non open source) et la section [Licence](#licence) ci-dessous. Le projet est une application web statique (Vite 5, React 18, TypeScript) sans serveur : toute contribution doit préserver ce principe — **aucune donnée de l’utilisateur ne doit quitter le navigateur**.

## Signaler un problème

Ouvrez une *issue* en précisant :

- le navigateur et sa version, le système d’exploitation ;
- l’imprimante (modèle, résolution) et la version de Zebra Browser Print s’il s’agit d’impression ;
- les étapes pour reproduire, le résultat attendu et le résultat obtenu ;
- si possible l’étiquette exportée en JSON (*Options* → *Exporter l’étiquette*) **sans données personnelles**, et le ZPL produit (*Options* → *Copier le ZPL*).

## Préparer l’environnement

Node.js ≥ 22.13 et npm :

```bash
npm ci
npm run dev       # http://localhost:5173
```

## Avant une pull request

```bash
npx tsc --noEmit  # types
npm test          # tests unitaires Vitest
npm run build     # build de production
docker build -t mylabelzebra .   # facultatif : l’image se construit
```

La CI GitHub Actions (`.github/workflows/ci.yml`) exécute ces mêmes étapes et vérifie l’image Docker.

## Conventions

- **Langue** : l’interface est écrite en français dans le code (`t('Texte français')`) ; ajoutez la traduction anglaise de tout nouveau texte dans `src/i18n.en.ts`.
- **Rendus** : un même élément est dessiné à l’écran (Konva), en image/PDF (canvas), en SVG et en ZPL. Une modification de mise en page doit rester cohérente dans tous ces rendus — voir [docs/developpement.md](docs/developpement.md).
- **Tests** : la logique pure (filtres, ZPL, codes, mise en page du texte, SSCC, conformité alimentaire…) est couverte par des tests `*.test.ts` à côté du code ; ajoutez-en pour toute correction ou fonctionnalité.
- **Dépendances** : évitez d’en ajouter ; toute bibliothèque lourde doit être chargée à la demande (`import()`).
- **Réglementaire** : les aides GS1 et alimentaires citent leurs sources (articles, annexes) dans le code ; gardez ces références à jour et ne présentez jamais une aide comme une garantie de conformité.

## Licence

Le projet est publié sous la Commercial Source License – Revenue Share v1.0 (fichier [LICENSE](LICENSE)), licence à source disponible et non open source. Selon sa **section 7 (Contributions)**, sauf accord de contributeur distinct, chaque contributeur conserve le droit d’auteur sur sa contribution et accorde au titulaire et aux destinataires du projet les droits nécessaires pour l’utiliser, la reproduire, la modifier et la distribuer sous cette licence. **Un accord de contributeur (CLA) ou des conditions de contribution équivalentes peuvent être demandés avant d’accepter une contribution.** Ne soumettez que du contenu que vous avez le droit de contribuer.

Pour toute question sur la licence ou une demande commerciale : contact@thomasmasson.fr.
