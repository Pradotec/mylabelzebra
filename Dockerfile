# syntax=docker/dockerfile:1
#
# MyLabelZebra — image de production (site statique servi par nginx, utilisateur non root)
#
#   docker build -t mylabelzebra .
#   docker run -d --name mylabelzebra -p 8080:8080 mylabelzebra
#   → http://localhost:8080
#
# Étape 1 : build (Node 22 : pdfjs-dist 6 exige Node >= 22.13)
FROM node:22-alpine AS build
WORKDIR /app

# Dépendances d'abord (cache Docker tant que package*.json ne change pas).
# @napi-rs/canvas (devDependency utilisée par les tests) fournit un binaire précompilé
# linux-x64-musl / linux-arm64-musl : aucune compilation native n'est nécessaire sur Alpine.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Sources nécessaires au build (tsc --noEmit puis vite build)
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
RUN npm run build

# Étape 2 : service statique
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

LABEL org.opencontainers.image.title="MyLabelZebra" \
      org.opencontainers.image.description="Éditeur web d'étiquettes pour imprimantes Zebra (ZPL), PDF et planches — 100 % navigateur" \
      org.opencontainers.image.licenses="LicenseRef-Commercial-Source-License-Revenue-Share-1.0"

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html

# L'image nginx-unprivileged tourne sous l'utilisateur « nginx » (uid 101) et écoute sur 8080
EXPOSE 8080
USER 101

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
