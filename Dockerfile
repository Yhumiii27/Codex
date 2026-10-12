# Deployment image for Codex (Coolify or any Docker host).
# - Internal port: 3000.
# - Data: /data (PGlite database in /data/pglite, uploaded files in /data/files). Mount a persistent volume
#   there, otherwise the data is lost on every deployment.
FROM node:22-bookworm-slim

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Public URLs of the sibling apps ("Ouvrir dans Keystone", "Ouvrir dans Vigie"). They are fixed at build time, so they
# must be passed as build arguments (Coolify: environment variables marked "Available during build"). Left empty, the
# links keep their localhost defaults.
ARG NEXT_PUBLIC_KEYSTONE_URL
ARG NEXT_PUBLIC_VIGIE_URL
# A database created while building must not stay in the image.
RUN if [ -z "$NEXT_PUBLIC_KEYSTONE_URL" ]; then unset NEXT_PUBLIC_KEYSTONE_URL; fi; \
    if [ -z "$NEXT_PUBLIC_VIGIE_URL" ]; then unset NEXT_PUBLIC_VIGIE_URL; fi; \
    npm run build && rm -rf .data

ENV NODE_ENV=production \
    CODEX_DATA_DIR=/data \
    TZ=Europe/Paris

EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "--port", "3000", "--hostname", "0.0.0.0"]
