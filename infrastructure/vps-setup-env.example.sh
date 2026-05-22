#!/usr/bin/env bash
# ============================================================
# SolarNext VPS - exemple de creation du fichier .env production
#
# Copier ce fichier sur le VPS, remplacer les CHANGE_ME, puis executer :
#   bash infrastructure/vps-setup-env.example.sh
#
# Le fichier reel infrastructure/vps-setup-env.sh peut contenir des secrets
# et reste volontairement ignore par Git.
# ============================================================
set -euo pipefail

TARGET="/home/ubuntu/solarnext-crm/backend/.env"

if [ -f "$TARGET" ]; then
  echo "Attention: $TARGET existe deja. Sauvegarde -> ${TARGET}.bak"
  cp "$TARGET" "${TARGET}.bak"
fi

cat > "$TARGET" << 'ENVEOF'
# ============================================================
# SolarNext API - Production VPS
# ============================================================

NODE_ENV=production
PORT=3000

# Base de donnees
DATABASE_URL=CHANGE_ME_POSTGRES_DATABASE_URL

# Auth / chiffrement
JWT_SECRET=CHANGE_ME_LONG_RANDOM_JWT_SECRET
MAIL_ENCRYPTION_KEY=CHANGE_ME_64_HEX_CHARS_AES_256_KEY

# PDF / Playwright
PDF_RENDERER_BASE_URL=https://solarnext-crm.fr
PDF_RENDER_READY_TIMEOUT=30000
CALPINAGE_RENDER_READY_TIMEOUT=30000

# CORS / proxy
CORS_ORIGIN=https://solarnext-crm.fr
TRUST_PROXY=1

# RBAC
RBAC_ENFORCE=1
ENABLE_SUPER_ADMIN=true

# Stockage fichiers
S3_ENDPOINT=https://s3.infomaniak.com
S3_REGION=eu-west-1
S3_BUCKET=CHANGE_ME_BUCKET
S3_ACCESS_KEY=CHANGE_ME_ACCESS_KEY
S3_SECRET_KEY=CHANGE_ME_SECRET_KEY
STORAGE_ROOT=/home/ubuntu/solarnext-crm/storage

# SMTP
SMTP_HOST=smtp.infomaniak.com
SMTP_PORT=465
SMTP_USER=CHANGE_ME_EMAIL
SMTP_PASS=CHANGE_ME_SMTP_PASSWORD

# Rate limiting
RATE_LIMIT_STORE=memory

# OAuth Enedis
ENEDIS_CLIENT_ID=CHANGE_ME_ENEDIS_CLIENT_ID
ENEDIS_CLIENT_SECRET=CHANGE_ME_ENEDIS_CLIENT_SECRET
ENEDIS_REDIRECT_URI=https://api.solarnext-crm.fr/api/enedis/callback
ENEDIS_AUTH_URL=https://mon-compte-particulier.enedis.fr/oauth2/v3/authorize
ENEDIS_TOKEN_URL=https://mon-compte-particulier.enedis.fr/oauth2/v3/token

# Feature flags
CALPINAGE_ENABLED=true
HORIZON_DSM_ENABLED=false
DSM_PROVIDER=LOCAL
EVENT_LOG_ENABLED=false

# DB pool
DB_POOL_MAX=10
ENVEOF

chmod 600 "$TARGET"
echo ".env cree : $TARGET"
echo ""
echo "Valeurs a remplacer restantes :"
grep "CHANGE_ME" "$TARGET" | sed 's/=.*//' | while read -r key; do echo "  -> $key"; done
