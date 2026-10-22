#!/bin/sh
# Point d'entrée de l'image (Dockerfile) : le serveur et les commandes d'exploitation tournent sous l'utilisateur node
# (uid 1000), jamais root.
# - Lancé en root (cas par défaut) : rend le dossier de données ($CODEX_DATA_DIR, /data) à node s'il ne lui appartient
#   pas, ce qui arrive au volume /data d'une image précédente qui tournait en root (Coolify, avant le lot 11), puis
#   exécute la commande sous node.
# - Lancé sous un autre utilisateur (docker run --user …) : exécute la commande telle quelle.
set -eu

data="${CODEX_DATA_DIR:-/data}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$data"
  # Tout ce qui, dans le dossier de données, n'appartient pas encore à node (base, fichiers, sauvegardes).
  if [ -n "$(find "$data" ! -user node -print -quit 2>/dev/null)" ]; then
    echo "codex-entrypoint : $data rendu à l'utilisateur node (uid 1000)" >&2
    chown -R node:node "$data"
  fi
  exec setpriv --reuid=node --regid=node --init-groups -- "$@"
fi
exec "$@"
