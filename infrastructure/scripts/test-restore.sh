#!/usr/bin/env bash
# ============================================================
# SolarNext — Test de restauration PostgreSQL
#
# Ce script restaure le dernier backup disponible dans une DB
# temporaire, vérifie l'intégrité des tables critiques, puis
# nettoie. À exécuter manuellement ou en cron mensuel.
#
# Usage : ./test-restore.sh [chemin_dump_optionnel]
#
# Sans argument : utilise le dernier backup local dans
#   /home/ubuntu/backups/ (ou télécharge depuis R2 si vide)
# Avec argument : utilise le fichier .dump.gz fourni
#
# Retour :
#   exit 0 = restauration et vérifications OK
#   exit 1 = échec (détails dans le log)
# ============================================================
set -euo pipefail

# ── Configuration ────────────────────────────────────────────
BACKUP_DIR="/home/ubuntu/backups"
TEST_DB="solarnext_restore_test"
R2_REMOTE="r2:solarnext-backups"
LOG_FILE="/home/ubuntu/logs/test-restore.log"
DUMP_PATH="${1:-}"

# ── Initialisation ───────────────────────────────────────────
mkdir -p "$(dirname "$LOG_FILE")"
exec >> "$LOG_FILE" 2>&1

log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
ok()   { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✅ $*"; }
fail() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ❌ $*"; exit 1; }

log "======================================================"
log "TEST DE RESTAURATION SOLARNEXT — $(date '+%Y-%m-%d')"
log "======================================================"

# ── 1. Trouver le dump à utiliser ────────────────────────────
if [ -z "$DUMP_PATH" ]; then
  log "🔍 Recherche du dernier backup local..."
  DUMP_PATH=$(find "$BACKUP_DIR" -name "solarnext_*.dump.gz" -type f \
    | sort | tail -1)

  if [ -z "$DUMP_PATH" ]; then
    log "⚠️  Aucun backup local — téléchargement depuis R2..."
    LATEST=$(rclone ls "$R2_REMOTE/daily/" \
      --s3-no-check-bucket 2>/dev/null \
      | sort | tail -1 | awk '{print $2}')
    [ -z "$LATEST" ] && fail "Aucun backup trouvé ni local ni sur R2"
    mkdir -p "$BACKUP_DIR"
    rclone copy "$R2_REMOTE/daily/$LATEST" "$BACKUP_DIR/" \
      --s3-no-check-bucket --retries 3
    DUMP_PATH="$BACKUP_DIR/$LATEST"
  fi
fi

[ -f "$DUMP_PATH" ] || fail "Fichier introuvable : $DUMP_PATH"
SIZE=$(du -sh "$DUMP_PATH" | cut -f1)
ok "Dump sélectionné : $(basename "$DUMP_PATH") ($SIZE)"

# ── 2. Préparer la DB temporaire ─────────────────────────────
log "🗄️  Création de la DB temporaire '$TEST_DB'..."
sudo -u postgres psql -c \
  "DROP DATABASE IF EXISTS $TEST_DB;" postgres 2>/dev/null || true

sudo -u postgres createdb "$TEST_DB" \
  || fail "Impossible de créer la DB de test $TEST_DB"
ok "DB temporaire créée"

# ── 3. Restaurer le dump ─────────────────────────────────────
log "📥 Restauration en cours..."
RESTORE_START=$(date +%s)
gunzip -c "$DUMP_PATH" | \
  PGHOST=/var/run/postgresql pg_restore \
    -d "$TEST_DB" \
    --no-owner \
    --no-privileges \
    2>&1 | grep -v "^$" | head -20 || true
RESTORE_END=$(date +%s)
DURATION=$((RESTORE_END - RESTORE_START))
ok "Restauration terminée en ${DURATION}s"

# ── 4. Vérifications d'intégrité ─────────────────────────────
log "🔎 Vérification des tables critiques..."

check_table() {
  local TABLE="$1"
  local MIN_ROWS="${2:-0}"
  local COUNT
  COUNT=$(PGHOST=/var/run/postgresql psql -U postgres -d "$TEST_DB" \
    -t -c "SELECT COUNT(*) FROM $TABLE;" 2>/dev/null | tr -d ' ')
  if [ -z "$COUNT" ]; then
    log "   ⚠️  $TABLE : table introuvable ou erreur"
    return 1
  elif [ "$MIN_ROWS" -gt 0 ] && [ "$COUNT" -lt "$MIN_ROWS" ]; then
    log "   ⚠️  $TABLE : $COUNT lignes (minimum attendu : $MIN_ROWS)"
    return 1
  else
    log "   ✅ $TABLE : $COUNT ligne(s)"
    return 0
  fi
}

ERRORS=0

# Tables structurelles (doivent exister, même vides)
check_table "organizations"          || ERRORS=$((ERRORS+1))
check_table "users"                  || ERRORS=$((ERRORS+1))
check_table "roles"                  || ERRORS=$((ERRORS+1))
check_table "permissions"            || ERRORS=$((ERRORS+1))
check_table "leads"                  || ERRORS=$((ERRORS+1))
check_table "clients"                || ERRORS=$((ERRORS+1))
check_table "studies"                || ERRORS=$((ERRORS+1))
check_table "study_data"             || ERRORS=$((ERRORS+1))
check_table "calpinage_data"         || ERRORS=$((ERRORS+1))
check_table "entity_documents"       || ERRORS=$((ERRORS+1))
check_table "quotes"                 || ERRORS=$((ERRORS+1))
check_table "quote_lines"            || ERRORS=$((ERRORS+1))
check_table "invoices"               || ERRORS=$((ERRORS+1))
check_table "pipeline_stages"        || ERRORS=$((ERRORS+1))
check_table "articles"               || ERRORS=$((ERRORS+1))
check_table "audit_logs"             || ERRORS=$((ERRORS+1))
check_table "refresh_tokens"         || ERRORS=$((ERRORS+1))
check_table "pgmigrations"           || ERRORS=$((ERRORS+1))

# Tables avec données de référence (seeds critiques)
check_table "roles"             1    || ERRORS=$((ERRORS+1))
check_table "pipeline_stages"   1    || ERRORS=$((ERRORS+1))

# Vérifier les migrations appliquées
MIGRATION_COUNT=$(PGHOST=/var/run/postgresql psql -d "$TEST_DB" \
  -t -c "SELECT COUNT(*) FROM pgmigrations;" 2>/dev/null | tr -d ' ') \
  || MIGRATION_COUNT="inconnu"
log "   📋 Migrations appliquées dans le backup : $MIGRATION_COUNT"

# ── 5. Test FK integrity ──────────────────────────────────────
log "🔗 Vérification des foreign keys critiques..."
ORPHAN_LEADS=$(PGHOST=/var/run/postgresql psql -d "$TEST_DB" -t -c \
  "SELECT COUNT(*) FROM leads l
   LEFT JOIN organizations o ON l.organization_id = o.id
   WHERE o.id IS NULL;" 2>/dev/null | tr -d ' ') \
  || ORPHAN_LEADS="0"
if [ "${ORPHAN_LEADS:-0}" -gt 0 ]; then
  log "   ⚠️  $ORPHAN_LEADS leads orphelins (sans organization)"
  ERRORS=$((ERRORS+1))
else
  log "   ✅ Aucun lead orphelin"
fi

# ── 6. Nettoyage ─────────────────────────────────────────────
log "🧹 Suppression de la DB temporaire..."
sudo -u postgres dropdb "$TEST_DB" 2>/dev/null \
  && ok "DB temporaire supprimée" \
  || log "   ⚠️  Impossible de supprimer $TEST_DB (à faire manuellement)"

# ── 7. Résultat final ────────────────────────────────────────
log "======================================================"
if [ "$ERRORS" -eq 0 ]; then
  ok "RESTORE TEST PASSED — $(basename "$DUMP_PATH") est valide"
  log "   Durée restauration : ${DURATION}s"
  log "   Migrations : $MIGRATION_COUNT"
else
  log "❌ RESTORE TEST FAILED — $ERRORS vérification(s) en échec"
  log "   Consulter les détails ci-dessus"
fi
log "======================================================"

exit $ERRORS
