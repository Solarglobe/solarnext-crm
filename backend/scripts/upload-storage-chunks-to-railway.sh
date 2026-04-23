#!/usr/bin/env bash
# Envoie les parts binaires vers /app/storage.tar.gz (depuis storage_tar_parts/).
set -uo pipefail
BACKEND_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PARTS_DIR="$(cd "$BACKEND_ROOT/../storage_tar_parts" && pwd)"
cd "$BACKEND_ROOT"

wake() {
  curl.exe -s -o /dev/null -w "%{http_code}" "https://solarnext-crm-production.up.railway.app/" || true
  sleep 10
}

run_ssh_dd_new() {
  local part="$1"
  local attempt
  for attempt in 1 2 3 4 5 6; do
    wake
    if railway ssh -- dd of=/app/storage.tar.gz bs=1M < "$part"; then
      return 0
    fi
    echo "[retry] $(basename "$part") attempt $attempt (new)" >&2
    sleep 15
  done
  return 1
}

run_ssh_dd_append() {
  local part="$1"
  local attempt
  for attempt in 1 2 3 4 5 6; do
    wake
    if railway ssh -- dd of=/app/storage.tar.gz bs=1M conv=notrunc oflag=append < "$part"; then
      return 0
    fi
    echo "[retry] $(basename "$part") attempt $attempt (append)" >&2
    sleep 15
  done
  return 1
}

for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  wake
  if railway ssh -- "rm -f /app/storage.tar.gz"; then
    break
  fi
  echo "[retry] rm storage.tar.gz" >&2
  sleep 12
done

first=1
shopt -s nullglob
parts=( "$PARTS_DIR"/part*.bin )
if [ ${#parts[@]} -eq 0 ]; then
  echo "Aucun fichier dans $PARTS_DIR — lancer upload-storage-chunks-to-railway.ps1 -ChunkMB 100 d'abord." >&2
  exit 1
fi

for part in "${parts[@]}"; do
  echo "[upload] $(basename "$part") ($(( $(wc -c < "$part") / 1024 / 1024 )) MB approx)" >&2
  if [ "$first" -eq 1 ]; then
    run_ssh_dd_new "$part"
    first=0
  else
    run_ssh_dd_append "$part"
  fi
done

railway ssh -- "ls -la /app/storage.tar.gz"
