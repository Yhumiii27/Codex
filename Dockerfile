# syntax=docker/dockerfile:1
#
# Image générique de Codex (docs/exploitation.md, « Image générique »). Elle ne choisit ni hébergeur, ni reverse proxy,
# ni TLS, ni authentification (M22, M23 et O-02 restent ouverts) : un serveur Codex, ses migrations et ses commandes de
# sauvegarde, rien de plus. Aucun secret, aucune donnée et aucun fichier .env n'entrent dans l'image (.dockerignore) :
# tout se règle au lancement par des variables d'environnement (.env.example).
#
#   docker build -t codex .
#   docker run -d --name codex -p 3100:3100 -v codex:/var/lib/codex codex
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
FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 CODEX_STANDALONE=1
RUN npm run build

# ── 3. Image d'exécution : le serveur autonome, sans les sources ni les dépendances de développement ──
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
# PORT et HOSTNAME sont lus par server.js (Docker pose HOSTNAME au nom du conteneur : 0.0.0.0 pour écouter partout).
# Les données (base PGlite, fichiers déposés) sont dans le volume ; sauvegardes et exports, par défaut à côté
# (/var/lib/codex/data-backups, /var/lib/codex/data-exports), y sont aussi. CODEX_SEED n'est pas posé : même défaut que
# l'application (docs/exploitation.md, « Image générique »).
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3100 \
    HOSTNAME=0.0.0.0 \
    CODEX_DATA_DIR=/var/lib/codex/data
# Next.js trace tout le dossier du projet (le serveur lit drizzle/ et package.json dans son dossier) : seul ce dont le
# serveur a besoin est copié. Les fichiers de l'application appartiennent à root, en lecture seule pour le serveur.
COPY --from=build /build/.next/standalone/server.js /build/.next/standalone/package.json ./
COPY --from=build /build/.next/standalone/node_modules ./node_modules
COPY --from=build /build/.next/standalone/.next ./.next
COPY --from=build /build/.next/static ./.next/static
COPY --from=build /build/drizzle ./drizzle
# Commandes d'exploitation, serveur arrêté (docs/sauvegarde.md, docs/export.md) :
#   docker run --rm -v codex:/var/lib/codex codex node scripts/codex-backup.mjs create|list|check|restore …
COPY --from=build /build/scripts/codex-backup.mjs /build/scripts/codex-export.mjs /build/scripts/codex-integrity.mjs ./scripts/
COPY --from=build /build/src/lib/backup-core.mjs /build/src/lib/export-core.mjs /build/src/lib/integrity-core.mjs ./src/lib/
# Utilisateur non root (celui de l'image Node, uid 1000) : seul le dossier des données lui est ouvert en écriture.
RUN mkdir -p /var/lib/codex && chown node:node /var/lib/codex
USER node
VOLUME ["/var/lib/codex"]
EXPOSE 3100
# GET /api/health (docs/exploitation.md §2) : 200 quand la base et le stockage répondent. Au tout premier lancement
# (base créée puis amorcée), la première réponse peut dépasser 5 s : d'où le délai de démarrage.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3100) + '/api/health', { signal: AbortSignal.timeout(9000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server.js"]
