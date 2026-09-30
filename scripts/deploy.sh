#!/usr/bin/env bash
# Contenter — one-command production deploy (run on the server, inside the repo folder).
#
#   cd ~/contenter && bash scripts/deploy.sh            deploy the latest version
#   cd ~/contenter && bash scripts/deploy.sh <commit>   deploy up to this commit (never goes back)
#
# GitHub Actions (.github/workflows/deploy.yml) runs it automatically after CI passes on main,
# over SSH with a key that may only run this script; the commit arrives as SSH_ORIGINAL_COMMAND.
#
# Steps: safety checks (.env, disk) → backups (scripts/backup.sh: database + .env, local and
# off-site) → git pull →
# rebuild/restart app containers (migrations run automatically) → health check →
# cleanup of old Docker build leftovers (never touches data or running images).
#
# Everything lives inside main(): bash parses the whole file before running it, so the
# `git pull` below can safely update this very script while it is executing.
set -euo pipefail

main() {
  cd "$(dirname "$0")/.."
  umask 077 # backups and copies of .env must not be readable by other server users

  local ENV_FILE="apps/api/.env"
  local BACKUP_DIR="${BACKUP_DIR:-$HOME/contenter-backups}"
  local MIN_FREE_GB="${MIN_FREE_GB:-5}"
  # commit to deploy: argument, or what the GitHub Actions deploy key sent (empty = latest)
  local TARGET="${1:-${SSH_ORIGINAL_COMMAND:-}}"

  # ── 1. Safety checks ───────────────────────────────────────────────────────
  say "Checking configuration"
  if [ -n "$TARGET" ] && ! [[ "$TARGET" =~ ^[0-9a-f]{7,40}$ ]]; then
    fail "'$TARGET' is not a commit id. Run without arguments to deploy the latest version."
  fi
  [ -f docker-compose.yml ] || fail "Run this inside the contenter folder (cd ~/contenter)."
  [ -s "$ENV_FILE" ] || fail "$ENV_FILE is missing or EMPTY. Restore it from a backup first (see docs/13-operations.md): ls -l ~/contenter-backups/env-* apps/api/.env.bak-*"
  local key
  for key in DATABASE_URL JWT_ACCESS_SECRET JWT_REFRESH_SECRET; do
    grep -qE "^${key}=.+" "$ENV_FILE" || fail "$ENV_FILE has no value for $key. Restore it from a backup (docs/13-operations.md)."
  done
  if grep -qE '^JWT_(ACCESS|REFRESH)_SECRET=change-me' "$ENV_FILE"; then
    fail "JWT secrets in $ENV_FILE are still the example values. Generate real ones (docs/09-deployment.md)."
  fi
  # Google sign-in needs all three values; a partial set silently hides the login button.
  local google_set=0
  for key in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REDIRECT_URI; do
    if grep -qE "^${key}=.+" "$ENV_FILE"; then google_set=$((google_set + 1)); fi
  done
  if [ "$google_set" -gt 0 ] && [ "$google_set" -lt 3 ]; then
    fail "Google sign-in is half-configured in $ENV_FILE: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI must all have values (docs/11-google-login.md). Fill them in, or empty all three to turn Google sign-in off."
  fi
  ok "Configuration looks complete"

  say "Checking disk space"
  if [ "$(free_gb)" -lt "$MIN_FREE_GB" ]; then
    echo "Only $(free_gb)G free — clearing Docker's build cache (safe: it only holds temporary build files)"
    docker builder prune -f >/dev/null
  fi
  [ "$(free_gb)" -ge "$MIN_FREE_GB" ] || fail "Only $(free_gb)G free on disk (need ${MIN_FREE_GB}G). Free some space first (docs/13-operations.md)."
  ok "$(free_gb)G free"

  # ── 2. Backups ─────────────────────────────────────────────────────────────
  # stops the deploy if the database backup fails; an unreachable off-site storage only warns
  BACKUP_DIR="$BACKUP_DIR" BACKUP_FROM_DEPLOY=1 bash scripts/backup.sh

  # ── 3. Code ────────────────────────────────────────────────────────────────
  say "Getting the latest version from GitHub"
  local BEFORE AFTER
  BEFORE="$(git rev-parse --short HEAD)"
  if [ -n "$TARGET" ]; then
    git fetch --quiet origin
    git merge --ff-only "$TARGET" # an older commit than HEAD is a no-op ("Already up to date")
  else
    git pull --ff-only
  fi
  AFTER="$(git rev-parse --short HEAD)"
  ok "Version: $BEFORE → $AFTER ($(git describe --tags --always))"

  # ── 4. Build & restart ─────────────────────────────────────────────────────
  say "Building and restarting the app (a few minutes)"
  docker compose --profile app up -d --build --remove-orphans

  # ── 5. Health check ────────────────────────────────────────────────────────
  say "Waiting for the app to become healthy"
  local i healthy=0
  for i in $(seq 1 30); do
    if docker compose exec -T api node -e "fetch('http://localhost:4000/api/health').then(r=>r.json()).then(j=>process.exit(j.status==='ok'?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
      healthy=1
      break
    fi
    sleep 5
  done
  if [ "$healthy" -ne 1 ]; then
    docker compose logs api --tail 40
    fail "The API did not become healthy. The log above shows why. Your data and settings backups are in $BACKUP_DIR."
  fi
  ok "API is healthy"
  local svc running
  running="$(docker compose ps --status running --services)"
  for svc in api worker web postgres redis; do
    if ! grep -qx "$svc" <<<"$running"; then
      docker compose logs "$svc" --tail 40
      fail "Service '$svc' is not running. The log above shows why."
    fi
  done
  ok "All services are running"
  docker compose ps --format 'table {{.Service}}\t{{.Status}}'

  # ── 6. Cleanup (keeps the disk from filling up again) ──────────────────────
  say "Cleaning up old build leftovers"
  docker builder prune -f --filter until=168h >/dev/null || true # build cache older than 7 days
  docker image prune -f --filter until=168h >/dev/null || true    # untagged images older than 7 days (recent ones stay for rollback)
  ok "$(free_gb)G free on disk"

  printf '\n\033[1;32mDeploy finished: %s is live.\033[0m\n' "$(git describe --tags --always)"
}

say()  { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }
free_gb() { df -BG --output=avail / | tail -1 | tr -dc '0-9'; }

main "$@"
exit
