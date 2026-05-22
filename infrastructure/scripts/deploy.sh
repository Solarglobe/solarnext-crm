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

# 1. Pull latest code
cd "$APP_DIR"
git pull --ff-only origin main

# 2. Install backend dependencies (prod only)
cd "$BACKEND_DIR"
npm ci --omit=dev --prefer-offline

# 3. Run DB migrations
echo "🗄 Migrations..."
NODE_ENV=production npm run migrate:up

# 4. Reload PM2 (zero-downtime)
echo "♻ Reload PM2..."
pm2 reload solarnext-api --wait-ready

# 5. Health check
sleep 3
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health/ready || echo "000")
if [ "$HTTP_STATUS" = "200" ]; then
    echo "✅ Health check OK (HTTP $HTTP_STATUS)"
else
    echo "❌ Health check FAILED (HTTP $HTTP_STATUS) — rollback PM2"
    pm2 reload solarnext-api
    exit 1
fi

echo "✅ [$(date '+%Y-%m-%d %H:%M:%S')] Déploiement terminé"
