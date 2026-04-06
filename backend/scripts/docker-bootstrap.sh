#!/bin/sh
# Bootstrap Docker : attend Postgres, migrations, org, admin, puis démarre le serveur.
# Idempotent : relançable sans casser.

set -e

echo "[bootstrap] Attente de PostgreSQL..."
node scripts/wait-for-db.js

echo "[bootstrap] Lancement des migrations..."
npm run migrate:up || true

echo "[bootstrap] Création de l'organisation si absente..."
node scripts/create-first-organization.js || true

echo "[bootstrap] Création de l'admin fondateur si absent..."
node scripts/create-founder-admin.js || true

echo "[bootstrap] Démarrage du serveur..."
exec node bootstrap.js
