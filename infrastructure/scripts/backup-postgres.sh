#!/usr/bin/env bash
# ============================================================
# SolarNext — Backup PostgreSQL automatique
# Stratégie 3-2-1 :
#   1. Backup local sur le VPS  (/home/ubuntu/backups/)
#   2. Upload vers Cloudflare R2 (via rclone)
#   3. Snapshots VPS Infomaniak  (gérés séparément)
#
# Rétention :
#   - Local  : 7 jours
#   - R2 daily  : 7 jours
#   - R2 weekly : 4 semaines  (chaque dimanche)
#   - R2 monthly: 6 mois      (1er de chaque mois)
#
# Cron recommandé : 0 2 * * * /home/ubuntu/scripts/backup-postgres.sh
# ============================================================
set -euo pipefail

# ── Configuration ────────────────────────────────────────────
DB_NAME="solarnext_prod"
BACKUP_DIR="/home/ubuntu/backups"
SCRIPTS_LOG="/home/ubuntu/logs/backup.log"
R2_REMOTE="r2:solarnext-backups"
DATE=$(date +%Y-%m-%d)
DOW=$(date +%u)   # 1=Lun … 7=Dim
DOM=$(date +%d)   # Jour du mois (01-31)
FILENAME="solarnext_${DATE}.dump.gz"
DUMP_PATH="$BACKUP_DIR/$FILENAME"

# ── Initialisation ───────────────────────────────────────────
mkdir -p "$BACKUP_DIR"
mkdir -p "$(dirname "$SCRIPTS_LOG")"
exec >> "$SCRIPTS_LOG" 2>&1

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

log "=============================="
log "Démarrage backup SolarNext"
log "=============================="

# ── 1. pg_dump → gzip ────────────────────────────────────────
log "📦 Dump PostgreSQL..."
PGHOST=/var/run/postgresql pg_dump -Fc "$DB_NAME" | gzip > "$DUMP_PATH"
SIZE=$(du -sh "$DUMP_PATH" | cut -f1)
log "✅ Dump terminé : $FILENAME ($SIZE)"

# ── 2. Upload R2 — daily ─────────────────────────────────────
log "☁️  Upload R2 daily/..."
rclone copy "$DUMP_PATH" "$R2_REMOTE/daily/" \
  --s3-no-check-bucket \
  --retries 3 \
  --log-level INFO
log "✅ Upload daily/ OK"

# ── 3. Upload R2 — weekly (dimanche) ─────────────────────────
if [ "$DOW" = "7" ]; then
  log "📅 Dimanche → upload R2 weekly/..."
  rclone copy "$DUMP_PATH" "$R2_REMOTE/weekly/" \
    --s3-no-check-bucket \
    --retries 3
  log "✅ Upload weekly/ OK"
fi

# ── 4. Upload R2 — monthly (1er du mois) ─────────────────────
if [ "$DOM" = "01" ]; then
  log "📅 1er du mois → upload R2 monthly/..."
  rclone copy "$DUMP_PATH" "$R2_REMOTE/monthly/" \
    --s3-no-check-bucket \
    --retries 3
  log "✅ Upload monthly/ OK"
fi

# ── 5. Nettoyage local (7 jours) ─────────────────────────────
log "🧹 Nettoyage local (> 7 jours)..."
find "$BACKUP_DIR" -name "solarnext_*.dump.gz" -mtime +7 -delete
log "✅ Nettoyage local OK"

# ── 6. Nettoyage R2 — retention ──────────────────────────────
log "🧹 Nettoyage R2 daily/ (> 8 jours)..."
rclone delete "$R2_REMOTE/daily/" \
  --min-age 8d \
  --s3-no-check-bucket 2>/dev/null || true

log "🧹 Nettoyage R2 weekly/ (> 29 jours)..."
rclone delete "$R2_REMOTE/weekly/" \
  --min-age 29d \
  --s3-no-check-bucket 2>/dev/null || true

log "🧹 Nettoyage R2 monthly/ (> 181 jours)..."
rclone delete "$R2_REMOTE/monthly/" \
  --min-age 181d \
  --s3-no-check-bucket 2>/dev/null || true

# ── 7. Résumé ─────────────────────────────────────────────────
LOCAL_COUNT=$(find "$BACKUP_DIR" -name "solarnext_*.dump.gz" | wc -l)
log "=============================="
log "✅ Backup terminé !"
log "   Fichier local : $DUMP_PATH ($SIZE)"
log "   Backups locaux présents : $LOCAL_COUNT"
log "=============================="
