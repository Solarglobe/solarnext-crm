#!/usr/bin/env bash
# ============================================================
# SolarNext backend Infomaniak/VPS - deploy with application rollback
# Called by GitHub Actions on the VPS.
# Example:
#   ssh ubuntu@<infomaniak-host> "bash ~/solarnext-crm/infrastructure/scripts/deploy.sh"
# Simulation:
#   bash infrastructure/scripts/deploy.sh --simulate-rollback
# ============================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/solarnext-crm}"
BACKEND_DIR="$APP_DIR/backend"
RELEASES_DIR="${RELEASES_DIR:-/home/ubuntu/solarnext-releases}"
PREVIOUS_LINK="$RELEASES_DIR/previous"
CURRENT_METADATA="$RELEASES_DIR/current.env"
SERVICE_NAME="${PM2_SERVICE_NAME:-solarnext-api}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/api/health/ready}"
DEPLOY_REF="${DEPLOY_REF:-origin/main}"
LOG_DIR="${LOG_DIR:-/home/ubuntu/logs}"

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

log() {
  echo "[$(timestamp)] $*"
}

wait_health() {
  local status="000"
  for attempt in $(seq 1 12); do
    sleep 5
    status="$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" || echo "000")"
    if [ "$status" = "200" ]; then
      log "Health check OK (HTTP $status, attempt $attempt/12)"
      return 0
    fi
    log "Health check waiting (HTTP $status, attempt $attempt/12)"
  done
  log "Health check FAILED (HTTP $status)"
  return 1
}

ensure_clean_worktree() {
  if ! git -C "$APP_DIR" diff --quiet || ! git -C "$APP_DIR" diff --cached --quiet; then
    log "Refusing deploy: VPS worktree has local tracked changes."
    log "Rollback safety requires a clean tracked worktree. No reset was attempted."
    exit 1
  fi
}

copy_release_tree() {
  local target="$1"
  mkdir -p "$target"
  (
    cd "$APP_DIR"
    tar \
      --exclude='./.git' \
      --exclude='./storage' \
      --exclude='./node_modules' \
      --exclude='./backend/node_modules' \
      --exclude='./frontend/node_modules' \
      --exclude='./frontend/dist-crm' \
      -cf - .
  ) | (
    cd "$target"
    tar -xf -
  )
}

install_backend_dependencies() {
  local backend_dir="$1"
  cd "$backend_dir"
  npm ci --omit=dev --prefer-offline
}

restart_service_from_backend() {
  local backend_dir="$1"
  local ecosystem="$backend_dir/ecosystem.config.cjs"
  log "Restarting PM2 service $SERVICE_NAME from $backend_dir"
  cd "$backend_dir"
  SOLARNEXT_BACKEND_CWD="$backend_dir" pm2 startOrReload "$ecosystem" --env production --update-env
}

write_metadata() {
  local file="$1"
  local commit="$2"
  local backend_dir="$3"
  {
    echo "commit=$commit"
    echo "backend_dir=$backend_dir"
    echo "pm2_service=$SERVICE_NAME"
    echo "health_url=$HEALTH_URL"
    echo "created_at=$(date -Iseconds)"
  } > "$file"
}

prepare_previous_release() {
  mkdir -p "$RELEASES_DIR" "$LOG_DIR"
  local current_commit
  current_commit="$(git -C "$APP_DIR" rev-parse --short=12 HEAD)"
  local release_dir="$RELEASES_DIR/previous-$current_commit-$(date +%Y%m%d%H%M%S)"

  log "Saving previous release $current_commit into $release_dir"
  copy_release_tree "$release_dir"
  install_backend_dependencies "$release_dir/backend"
  write_metadata "$release_dir/RELEASE_METADATA.env" "$current_commit" "$release_dir/backend"
  ln -sfn "$release_dir" "$PREVIOUS_LINK"
  log "Previous release ready: $PREVIOUS_LINK -> $release_dir"
}

rollback_previous_release() {
  if [ ! -L "$PREVIOUS_LINK" ]; then
    log "Rollback impossible: missing previous release link $PREVIOUS_LINK"
    return 1
  fi

  local release_dir
  release_dir="$(readlink -f "$PREVIOUS_LINK")"
  if [ ! -d "$release_dir/backend" ]; then
    log "Rollback impossible: invalid previous backend directory $release_dir/backend"
    return 1
  fi

  log "Rolling back $SERVICE_NAME to previous release $release_dir"
  install_backend_dependencies "$release_dir/backend"
  restart_service_from_backend "$release_dir/backend"
  wait_health
}

simulate_rollback() {
  local sim_root
  sim_root="$(mktemp -d /tmp/solarnext-rollback-sim.XXXXXX)"
  RELEASES_DIR="$sim_root/releases"
  PREVIOUS_LINK="$RELEASES_DIR/previous"
  CURRENT_METADATA="$RELEASES_DIR/current.env"
  mkdir -p "$RELEASES_DIR"

  local current_commit
  current_commit="$(git -C "$APP_DIR" rev-parse --short=12 HEAD)"
  local release_dir="$RELEASES_DIR/previous-$current_commit-simulation"
  mkdir -p "$release_dir/backend"
  write_metadata "$release_dir/RELEASE_METADATA.env" "$current_commit" "$release_dir/backend"
  ln -sfn "$release_dir" "$PREVIOUS_LINK"

  test -e "$PREVIOUS_LINK"
  test -f "$release_dir/RELEASE_METADATA.env"
  grep -q "pm2_service=$SERVICE_NAME" "$release_dir/RELEASE_METADATA.env"
  grep -q "commit=$current_commit" "$release_dir/RELEASE_METADATA.env"
  log "Rollback simulation OK: metadata, service name and previous reference are usable."
  log "No git, npm, PM2, DB or production service command was executed."
}

if [ "${1:-}" = "--simulate-rollback" ] || [ "${SIMULATE_ROLLBACK:-0}" = "1" ]; then
  simulate_rollback
  exit 0
fi

log "Backend deployment started"
mkdir -p /home/ubuntu/solarnext-crm/storage
chmod 755 /home/ubuntu/solarnext-crm/storage

ensure_clean_worktree
prepare_previous_release

log "Fetching $DEPLOY_REF"
git -C "$APP_DIR" fetch origin main
git -C "$APP_DIR" merge --ff-only "$DEPLOY_REF"

log "Installing current backend dependencies"
install_backend_dependencies "$BACKEND_DIR"

log "Running non-destructive DB migrations"
if NODE_ENV=production npm --prefix "$BACKEND_DIR" run migrate:up; then
  log "Migrations applied"
else
  status=$?
  log "Migration failed; reverting one migration step then restoring previous application release"
  NODE_ENV=production npm --prefix "$BACKEND_DIR" run migrate:down || true
  rollback_previous_release || true
  exit "$status"
fi

log "Importing official PV catalog"
NODE_ENV=production npm --prefix "$BACKEND_DIR" run import:official-pv-catalog || log "PV catalog already up to date or import skipped"

if restart_service_from_backend "$BACKEND_DIR" && wait_health; then
  current_commit="$(git -C "$APP_DIR" rev-parse --short=12 HEAD)"
  write_metadata "$CURRENT_METADATA" "$current_commit" "$BACKEND_DIR"
  log "Backend deployment finished"
else
  status=$?
  log "Current release failed to start or failed health check; starting automatic application rollback"
  rollback_previous_release
  exit "$status"
fi
