#!/usr/bin/env bash
# Deploy a verified commit while preserving the VPS's existing working tree.
# The old PM2 backend directory remains available for an immediate rollback.
set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/solarnext-crm}"
RELEASES_DIR="${RELEASES_DIR:-/home/ubuntu/solarnext-releases}"
SERVICE_NAME="${PM2_SERVICE_NAME:-solarnext-api}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/api/health/ready}"
DEPLOY_REF="${DEPLOY_REF:-}"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

if [[ "${1:-}" != "--skip-db" ]]; then
  log "Refusing isolated release without --skip-db."
  exit 1
fi
if [[ ! "$DEPLOY_REF" =~ ^[0-9a-f]{40}$ ]]; then
  log "DEPLOY_REF must be a full commit SHA."
  exit 1
fi

wait_health() {
  local status
  for attempt in $(seq 1 12); do
    status="$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL" || true)"
    if [[ "$status" == "200" ]]; then
      log "Health check OK (attempt $attempt/12)."
      return 0
    fi
    sleep 5
  done
  log "Health check failed (HTTP ${status:-000})."
  return 1
}

pm2_backend_dir() {
  pm2 jlist | node -e '
    const fs = require("fs");
    const apps = JSON.parse(fs.readFileSync(0, "utf8"));
    const service = apps.find((app) => app.name === process.argv[1]);
    if (!service || !service.pm2_env?.pm_cwd) process.exit(2);
    process.stdout.write(service.pm2_env.pm_cwd);
  ' "$SERVICE_NAME"
}

restart_from() {
  local backend_dir="$1"
  test -f "$backend_dir/server.js"
  test -f "$backend_dir/ecosystem.config.cjs"
  # PM2's startOrReload retains the existing process cwd even when the
  # ecosystem file points elsewhere. Replace only this API process to switch code.
  if pm2 describe "$SERVICE_NAME" >/dev/null 2>&1; then
    pm2 delete "$SERVICE_NAME"
  fi
  (
    cd "$backend_dir"
    SOLARNEXT_BACKEND_CWD="$backend_dir" pm2 start "$backend_dir/ecosystem.config.cjs" --env production --update-env
  )
}

log "Preparing isolated backend release $DEPLOY_REF"
test -d "$APP_DIR/.git"
test -d "$RELEASES_DIR"
previous_backend_dir="$(pm2_backend_dir)"
test -f "$previous_backend_dir/server.js"
test -f "$previous_backend_dir/ecosystem.config.cjs"
log "Existing backend directory: $previous_backend_dir"

git -C "$APP_DIR" fetch origin main
git -C "$APP_DIR" cat-file -e "$DEPLOY_REF^{commit}"
if ! git -C "$APP_DIR" merge-base --is-ancestor "$DEPLOY_REF" origin/main; then
  log "Target commit is not in origin/main."
  exit 1
fi
server_head="$(git -C "$APP_DIR" rev-parse HEAD)"
if ! git -C "$APP_DIR" diff --quiet "$server_head" "$DEPLOY_REF" -- \
  backend/migrations backend/scripts/run-pg-migrate.cjs backend/scripts/import-official-pv-catalog.mjs \
  backend/config/database.cjs backend/config/db.js; then
  log "Database-related tracked files differ from the VPS commit; refusing --skip-db."
  exit 1
fi

release_dir="$RELEASES_DIR/isolated-${DEPLOY_REF:0:12}-$(date +%Y%m%d%H%M%S)"
mkdir "$release_dir"
git -C "$APP_DIR" archive "$DEPLOY_REF" | tar -xf - -C "$release_dir"
test -f "$release_dir/backend/server.js"
backend_dir="$release_dir/backend"
env_sources=0
if test -f "$(dirname "$previous_backend_dir")/.env.dev"; then
  ln -s "$(dirname "$previous_backend_dir")/.env.dev" "$release_dir/.env.dev"
  env_sources=$((env_sources + 1))
fi
if test -f "$previous_backend_dir/.env"; then
  ln -s "$previous_backend_dir/.env" "$backend_dir/.env"
  env_sources=$((env_sources + 1))
fi
if [[ "$env_sources" -eq 0 ]]; then
  log "The existing backend has no local environment file to reuse."
  exit 1
fi
(
  cd "$backend_dir"
  npm ci --omit=dev --prefer-offline
)
node --check "$backend_dir/server.js"

rollback_needed=0
on_exit() {
  local status="$?"
  trap - EXIT
  if [[ "$status" -ne 0 && "$rollback_needed" -eq 1 ]]; then
    log "New backend failed; restoring the previous PM2 directory."
    if restart_from "$previous_backend_dir" && wait_health; then
      log "Previous backend restored."
    else
      log "Automatic rollback failed; the previous directory is $previous_backend_dir."
    fi
  fi
  exit "$status"
}
trap on_exit EXIT

rollback_needed=1
restart_from "$backend_dir"
wait_health
active_backend_dir="$(pm2_backend_dir)"
if [[ "$active_backend_dir" != "$backend_dir" ]]; then
  log "PM2 did not switch to the new backend directory: $active_backend_dir"
  exit 1
fi
rollback_needed=0
printf 'commit=%s\nbackend_dir=%s\nprevious_backend_dir=%s\ncreated_at=%s\n' \
  "$DEPLOY_REF" "$backend_dir" "$previous_backend_dir" "$(date -Iseconds)" > "$release_dir/RELEASE_METADATA.env"
log "Isolated backend release active: $DEPLOY_REF"
