#!/usr/bin/env bash
# ============================================================
# SolarNext VPS — Script de déploiement (appelé par GitHub Actions)
# Exécuté sur le VPS via : ssh ubuntu@VPS "bash ~/solarnext-crm/infrastructure/scripts/deploy.sh"
# ============================================================
set -euo pipefail

APP_DIR="/home/ubuntu/solarnext-crm"
BACKEND_DIR="$APP_DIR/backend"
LOG_DIR="/home/ubuntu/logs"

echo "🚀 [$(date '+%Y-%m-%d %H:%M:%S')] Déploiement démarré"

# 0. Garantir que le dossier de stockage existe AVANT le pull
#    (git pull ne le supprime jamais, mais une reinstall manuelle du VPS pourrait l'effacer)
mkdir -p /home/ubuntu/solarnext-crm/storage
chmod 755 /home/ubuntu/solarnext-crm/storage

# 1. Pull latest code
cd "$APP_DIR"
git pull --ff-only origin main

# 2. Install backend dependencies (prod only)
cd "$BACKEND_DIR"
npm ci --omit=dev --prefer-offline

# 3. Run DB migrations (avec rollback automatique en cas d'échec)
echo "🗄 Migrations..."
if NODE_ENV=production npm run migrate:up; then
  echo "✅ Migrations appliquées"
else
  status=$?
  echo "❌ Migration échouée — rollback d'une étape"
  NODE_ENV=production npm run migrate:down || true
  exit "$status"
fi

# 3.5 Import catalogue équipements PV officiel (idempotent)
echo "📦 Import catalogue PV..."
NODE_ENV=production npm run import:official-pv-catalog || echo "⚠ Catalogue PV déjà à jour (ignoré)"

# 4. Reload PM2 (zero-downtime)
echo "♻ Reload PM2..."
pm2 reload solarnext-api --wait-ready

# 5. Health check
HTTP_STATUS="000"
for attempt in $(seq 1 12); do
    sleep 5
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health/ready || echo "000")
    if [ "$HTTP_STATUS" = "200" ]; then
        echo "âœ… Health check OK (HTTP $HTTP_STATUS, tentative $attempt/12)"
        break
    fi
    echo "â³ Health check attente (HTTP $HTTP_STATUS, tentative $attempt/12)"
done
if [ "$HTTP_STATUS" = "200" ]; then
    echo "✅ Health check OK (HTTP $HTTP_STATUS)"
else
    echo "❌ Health check FAILED (HTTP $HTTP_STATUS) — rollback PM2"
    pm2 reload solarnext-api
    exit 1
fi

echo "✅ [$(date '+%Y-%m-%d %H:%M:%S')] Déploiement terminé"
