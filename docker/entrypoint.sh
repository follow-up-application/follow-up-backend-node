#!/bin/sh
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] applying migrations"
  npx node-pg-migrate up -m src/infra/db/migrations -j sql
  if [ "${RUN_SEEDS:-false}" = "true" ]; then
    echo "[entrypoint] loading seeds"
    node dist/infra/db/seeds/seed.js
  fi
fi

exec "$@"
