# syntax=docker/dockerfile:1
#
# Image de Codex (docs/exploitation.md §10), construite par Coolify depuis main ou à la main. Elle ne choisit ni
# reverse proxy, ni TLS, ni authentification (M22, M23 et O-02 restent ouverts) : un serveur Codex, ses migrations et
# ses commandes de sauvegarde, rien de plus. Aucun secret, aucune donnée et aucun fichier .env n'entrent dans l'image
# (.dockerignore) : tout se règle au lancement par des variables d'environnement (.env.example).
#
# Contrat de déploiement (celui de Coolify depuis le 10 octobre 2026, inchangé) :
# - port interne 3000 ;
# - données dans /data (CODEX_DATA_DIR) : fichiers déposés (/data/files), base PGlite de repli (/data/pglite) et
#   sauvegardes (/data/backups). Monter un volume persistant sur /data, sinon tout est perdu à chaque déploiement ;
# - base : le serveur PostgreSQL commun EPC2I (schéma codex, rôle codex_app) quand DATABASE_URL est posée au lancement.
#   Jamais DATABASE_URL dans l'image ni au build. Sans elle : PGlite dans /data/pglite.
#
#   docker build -t codex .
#   docker run -d --name codex -p 3000:3000 -v codex-data:/data codex
#
# Derrière un proxy TLS d'entreprise, pour npm ci : --build-arg HTTPS_PROXY=<adresse du proxy> et, s'il réécrit les
# certificats, --secret id=npm_ca,src=<certificat de son autorité, PEM> (ni l'un ni l'autre n'est gardé dans l'image).

ARG NODE_IMAGE=node:22-bookworm-slim

# ── 1. Dépendances : exactement celles de package-lock.json ──
FROM ${NODE_IMAGE} AS deps
WORKDIR /build
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=npm_ca,target=/run/secrets/npm_ca \
    if [ -s /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci --no-audit --no-fund

# ── 2. Build de production, sortie autonome (next.config.ts : output 'standalone' quand CODEX_STANDALONE=1) ──
# next build n'ouvre jamais le serveur commun (src/db/index.ts, NEXT_PHASE) : DATABASE_URL n'a rien à faire ici.
FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 CODEX_STANDALONE=1
RUN npm run build

# ── 3. Image d'exécution : le serveur autonome, sans les sources ni les dépendances de développement ──
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
# PORT et HOSTNAME sont lus par server.js (Docker pose HOSTNAME au nom du conteneur : 0.0.0.0 pour écouter partout).
# NEXT_PUBLIC_KEYSTONE_URL et NEXT_PUBLIC_VIGIE_URL sont lues au lancement par le serveur (aucune n'est figée au build).
# CODEX_SEED n'est pas posé : même défaut que l'application (docs/exploitation.md §10).
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=Europe/Paris \
    CODEX_DATA_DIR=/data \
    CODEX_BACKUP_DIR=/data/backups
# Next.js trace tout le dossier du projet (le serveur lit drizzle/ et package.json dans son dossier) : seul ce dont le
# serveur a besoin est copié. Les fichiers de l'application appartiennent à root, en lecture seule pour le serveur.
COPY --from=build /build/.next/standalone/server.js /build/.next/standalone/package.json ./
COPY --from=build /build/.next/standalone/node_modules ./node_modules
COPY --from=build /build/.next/standalone/.next ./.next
COPY --from=build /build/.next/static ./.next/static
COPY --from=build /build/drizzle ./drizzle
# Commandes d'exploitation, serveur arrêté (docs/sauvegarde.md, docs/export.md) :
#   docker run --rm -v codex-data:/data codex node scripts/codex-backup.mjs create|list|check|restore …
COPY --from=build /build/scripts/codex-backup.mjs /build/scripts/codex-export.mjs /build/scripts/codex-integrity.mjs ./scripts/
COPY --from=build /build/src/lib/backup-core.mjs /build/src/lib/export-core.mjs /build/src/lib/integrity-core.mjs /build/src/lib/pglite-options.mjs ./src/lib/
COPY --chmod=0755 scripts/docker-entrypoint.sh /usr/local/bin/codex-entrypoint
# Le serveur tourne sous l'utilisateur node (uid 1000), jamais root. Le point d'entrée démarre en root le temps de
# rendre /data à node (un volume créé par une image précédente, qui tournait en root, lui appartient encore), puis
# passe la main à node (setpriv, util-linux). Lancé directement sous un autre utilisateur (--user), il ne change rien.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 3000
# GET /api/health (docs/exploitation.md §2) : 200 quand la base et le stockage répondent. Au tout premier lancement
# (base créée puis remplie, ou serveur commun migré), la première réponse peut dépasser 5 s : d'où le délai de démarrage.
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health', { signal: AbortSignal.timeout(9000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["codex-entrypoint"]
CMD ["node", "server.js"]
