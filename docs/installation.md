# Installation

MyLabelZebra est un **site statique** : `npm run build` produit un dossier `dist/` (HTML, JS, CSS, icônes, service worker) qui peut être servi par n’importe quel serveur web. Il n’y a ni base de données ni API côté serveur.

> **Licence** : les déploiements décrits ici (Docker, hébergement statique) sont destinés à un **usage personnel ou interne** à votre organisation. Mettre l’application à disposition de tiers (service hébergé, SaaS, même gratuit), la revendre ou la distribuer commercialement est interdit sans accord écrit du titulaire, et tout usage commercial est soumis à redevance : voir le fichier [LICENSE](../LICENSE), seul texte qui fait foi.

- [Développement local](#développement-local)
- [Build de production](#build-de-production)
- [Docker](#docker)
- [Hébergement statique gratuit](#hébergement-statique-gratuit)
- [HTTPS et Zebra Browser Print](#https-et-zebra-browser-print)

## Développement local

Prérequis :

| Outil | Version | Pourquoi |
| --- | --- | --- |
| Node.js | **≥ 22.13** (22 LTS ou 24) | Vite 5 et Vitest 2 demandent Node ^18 ou ≥ 20 ; `pdfjs-dist` 6.5 déclare `node >= 22.13`. Avec une version plus ancienne, `npm ci` affiche un avertissement `EBADENGINE`. |
| npm | celui fourni avec Node | le dépôt contient un `package-lock.json` |
| Accès réseau à `cdn.sheetjs.com` | à l’installation | la dépendance `xlsx` 0.20.3 est téléchargée depuis le CDN de SheetJS (version corrigée, absente de npm) |

```bash
npm ci            # installation reproductible (package-lock.json)
npm run dev       # http://localhost:5173 (port fixé dans vite.config.ts)
npm test          # Vitest (environnement happy-dom, canvas @napi-rs/canvas)
```

Sous Windows, utilisez PowerShell (ou le terminal de votre éditeur). `@napi-rs/canvas` (utilisé uniquement par les tests) est livré en binaires précompilés pour Windows, macOS et Linux (glibc et musl) : aucune chaîne de compilation n’est nécessaire.

En développement, le service worker n’est **pas** enregistré (il ne l’est qu’en production) : le mode hors ligne ne se teste qu’avec `npm run build` puis `npm run preview`.

## Build de production

```bash
npm run build     # = tsc --noEmit && vite build → dist/
npm run preview   # sert dist/ sur http://localhost:4173
```

Contenu de `dist/` :

- `index.html`, `sw.js` (service worker), `manifest.webmanifest`, `favicon.svg`, `icon-192.png`, `icon-512.png` ;
- `assets/` : fichiers JavaScript et CSS nommés avec une empreinte (`index-XXXX.js`), dont le worker pdf.js `pdf.worker.min-XXXX.mjs`.

Règles à appliquer sur tout serveur :

| Chemin | Règle |
| --- | --- |
| `/assets/*` | cache long : `Cache-Control: public, max-age=31536000, immutable` |
| `/index.html`, `/sw.js`, `/manifest.webmanifest` | `Cache-Control: no-cache` (sinon une nouvelle version peut ne jamais être chargée) |
| `*.mjs` | `Content-Type: application/javascript` (sinon le worker pdf.js est refusé) |
| `*.webmanifest` | `Content-Type: application/manifest+json` |
| URL inconnue | renvoyer `index.html` (facultatif : l’application n’utilise que des paramètres `?…`) |

N’ajoutez pas de `Content-Security-Policy` restrictive : l’application doit pouvoir joindre `http://127.0.0.1:9100` / `https://127.0.0.1:9101` (Zebra Browser Print) et `https://docs.google.com` (Google Sheets), charger des images `data:`/`blob:` et créer des workers. N’ajoutez pas non plus `X-Frame-Options: DENY` si vous voulez intégrer l’éditeur en iframe ([intégration](integration.md)).

## Docker

Fichiers fournis :

| Fichier | Rôle |
| --- | --- |
| `Dockerfile` | étape 1 `node:22-alpine` : `npm ci` puis `npm run build` ; étape 2 `nginxinc/nginx-unprivileged:1.27-alpine` : sert `dist/` en utilisateur non root (uid 101), port **8080**, `HEALTHCHECK` sur `/healthz` |
| `docker/nginx.conf` | repli SPA, cache immuable de `/assets/`, `no-cache` pour `index.html` / `sw.js` / `manifest.webmanifest`, types MIME `.mjs` et `.webmanifest`, gzip |
| `docker/security-headers.conf` | `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (sans CSP, sans `X-Frame-Options`, sans COOP — voir les commentaires) |
| `docker-compose.yml` | service `mylabelzebra`, port hôte `${MLZ_PORT:-8080}`, `restart: unless-stopped`, système de fichiers en lecture seule + `tmpfs /tmp`, `no-new-privileges` |
| `.dockerignore` | exclut `node_modules`, `dist`, `.git`, `.playwright-mcp`, journaux… |

### Avec Docker Compose

```bash
docker compose up -d --build     # construit l'image et démarre le conteneur
docker compose ps                # STATUS doit passer à « (healthy) »
# → http://localhost:8080
docker compose logs -f           # journaux nginx
docker compose down              # arrêt et suppression du conteneur
```

Changer le port de l’hôte :

```bash
MLZ_PORT=9000 docker compose up -d          # bash
$env:MLZ_PORT = 9000; docker compose up -d  # PowerShell
```

ou créez un fichier `.env` à côté de `docker-compose.yml` contenant `MLZ_PORT=9000`.

### Sans Compose

```bash
docker build -t mylabelzebra .
docker run -d --name mylabelzebra -p 8080:8080 --restart unless-stopped mylabelzebra
docker inspect --format '{{.State.Health.Status}}' mylabelzebra   # healthy
```

### Derrière un proxy HTTPS

Le conteneur sert du HTTP sur 8080. Pour un usage hors de `localhost`, placez-le derrière un proxy TLS (Traefik, Caddy, nginx, Synology/Unraid…) : le **service worker et l’installation PWA exigent HTTPS** (sauf sur `localhost`). Aucun réglage particulier n’est nécessaire côté conteneur.

### Procédure de test de l’image (réalisée)

Procédure exécutée sur Windows 11 + Docker Desktop (moteur 29.7.2), PowerShell :

```powershell
docker compose build
docker compose up -d
docker compose ps                                     # → Up … (healthy)
curl.exe -s -o NUL -D - http://localhost:8080/        # → 200, text/html, Cache-Control: no-cache
curl.exe -s http://localhost:8080/ | Select-String '<title>'   # → MyLabelZebra — Éditeur d'étiquettes Zebra
# un fichier JS de /assets (nom relevé dans index.html) :
curl.exe -s -o NUL -D - http://localhost:8080/assets/index-XXXX.js
#   → 200, application/javascript, Cache-Control: public, max-age=31536000, immutable
curl.exe -s -o NUL -D - -H "Accept-Encoding: gzip" http://localhost:8080/assets/index-XXXX.js   # → Content-Encoding: gzip
curl.exe -s -o NUL -D - http://localhost:8080/sw.js                 # → 200, Cache-Control: no-cache
curl.exe -s -o NUL -D - http://localhost:8080/manifest.webmanifest  # → Content-Type: application/manifest+json
curl.exe -s -o NUL -D - http://localhost:8080/assets/pdf.worker.min-XXXX.mjs   # → Content-Type: application/javascript
curl.exe -s -o NUL -D - http://localhost:8080/abc                   # → 200, index.html (repli SPA)
curl.exe -s -o NUL -D - http://localhost:8080/assets/inexistant.js  # → 404, sans cache long
docker inspect --format '{{.State.Health.Status}}' mylabelzebra     # → healthy
docker exec mylabelzebra id                                         # → uid=101(nginx)
docker image ls mylabelzebra                                        # → ~80 Mo
docker compose down
```

Résultats obtenus le 19/11/2026 : toutes les réponses ci-dessus conformes (gzip actif sur les `.js`, en-têtes `X-Content-Type-Options: nosniff` et `Referrer-Policy: strict-origin-when-cross-origin` présents), conteneur `healthy` en moins de 10 s, image de **80,4 Mo** (22,5 Mo compressés). Le navigateur ouvert sur `http://localhost:8080` charge l’application sans erreur ni avertissement dans la console et enregistre le service worker (`/sw.js`, portée `/`). La CI (`.github/workflows/ci.yml`) rejoue l’essentiel de ces vérifications avec `curl` à chaque push.

## Hébergement statique gratuit

Ces services gratuits conviennent pour héberger **votre propre instance**, à usage personnel ou interne (voir l’avertissement de licence en haut de page) : une instance ouverte au public ou proposée à des clients relève du SaaS interdit sans accord écrit. Dans tous les cas, l’application reste 100 % côté navigateur : l’hébergeur ne voit passer que les téléchargements des fichiers statiques. Préférez une **racine de domaine** (`https://etiquettes.exemple.fr/` ou `https://xxx.netlify.app/`) : voir [GitHub Pages](#github-pages) pour les sous-dossiers.

### Netlify Drop (sans compte Git)

1. `npm ci && npm run build` sur votre poste.
2. Ouvrez <https://app.netlify.com/drop> et glissez-déposez le dossier **`dist/`**.
3. Netlify fournit une adresse `https://<nom>.netlify.app` en HTTPS.

Netlify sert les `.mjs` et `.webmanifest` avec les bons types. Pour fixer les en-têtes de cache, vous pouvez ajouter dans `dist/` (après le build) un fichier `_headers` :

```text
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/sw.js
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/manifest.webmanifest
  Cache-Control: no-cache
```

### Cloudflare Pages

Connectez le dépôt GitHub dans Cloudflare Pages avec :

| Réglage | Valeur |
| --- | --- |
| Framework preset | Vite (ou aucun) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Variable d’environnement | `NODE_VERSION=22` |

Le fichier `_headers` ci-dessus est aussi reconnu par Cloudflare Pages (placez-le dans `public/` pour qu’il soit copié dans `dist/` à chaque build). Le téléversement direct de `dist/` (Wrangler ou glisser-déposer) fonctionne également.

### GitHub Pages

- **Site utilisateur ou domaine personnalisé** (`https://<utilisateur>.github.io/` ou `https://etiquettes.exemple.fr/`) : l’application est servie à la racine, rien à changer. Publiez `dist/` (par exemple avec l’action officielle `actions/deploy-pages`).
- **Site de projet** (`https://<utilisateur>.github.io/mylabelzebra/`) : l’application est servie dans un sous-dossier. Il faut alors construire avec le bon `base` Vite :

  ```bash
  npx vite build --base=/mylabelzebra/
  ```

  Vite préfixe les fichiers de `assets/` et les liens de `index.html`. **Limite** : `src/main.tsx` enregistre le service worker à l’adresse absolue `/sw.js`, et `public/manifest.webmanifest` / `public/sw.js` utilisent `/` comme portée et page de démarrage. Dans un sous-dossier, le service worker n’est donc pas trouvé (404) et l’installation PWA / le mode hors ligne ne fonctionnent pas ; l’éditeur lui-même fonctionne. Pour un support complet, il faudrait rendre ces chemins relatifs à `import.meta.env.BASE_URL` (non fait à ce jour). Cette configuration n’a pas été testée.

GitHub Pages ne permet pas de définir d’en-têtes HTTP : le cache est géré par GitHub (10 minutes), ce qui convient.

## HTTPS et Zebra Browser Print

- Sur `http://localhost` et en HTTPS, le navigateur autorise les appels à Zebra Browser Print (`http://127.0.0.1:9100`, `https://127.0.0.1:9101`).
- Servie en **HTTP sur une autre adresse** (ex. `http://192.168.1.10:8080`), l’application n’est pas un « contexte sécurisé » : pas de service worker, pas d’installation PWA, et certaines API (presse-papiers, pipette) sont indisponibles. Utilisez HTTPS.
- Voir la [FAQ](faq.md#zebra-browser-print-nest-pas-détecté) pour le certificat de Browser Print et l’autorisation du site.
