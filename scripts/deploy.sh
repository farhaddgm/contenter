#!/usr/bin/env bash
# Contenter — one-command production deploy (run on the server, inside the repo folder).
#
#   cd ~/contenter && bash scripts/deploy.sh
#
# Steps: safety checks (.env, disk) → backups (database + .env) → git pull →
# rebuild/restart app containers (migrations run automatically) → health check.
# Nothing is deleted except Docker's build cache when the disk is nearly full.
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE="apps/api/.env"
BACKUP_DIR="${BACKUP_DIR:-$HOME/contenter-backups}"
MIN_FREE_GB="${MIN_FREE_GB:-5}"
KEEP_BACKUPS="${KEEP_BACKUPS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"

say()  { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

# ── 1. Safety checks ─────────────────────────────────────────────────────────
say "Checking configuration"
[ -f docker-compose.yml ] || fail "Run this inside the contenter folder (cd ~/contenter)."
[ -s "$ENV_FILE" ] || fail "$ENV_FILE is missing or EMPTY. Restore it from a backup first (see docs/13-operations.md): ls -l apps/api/.env.bak-*"
for key in DATABASE_URL JWT_ACCESS_SECRET JWT_REFRESH_SECRET; do
  grep -qE "^${key}=.+" "$ENV_FILE" || fail "$ENV_FILE has no value for $key. Restore it from a backup (docs/13-operations.md)."
done
if grep -qE '^JWT_(ACCESS|REFRESH)_SECRET=change-me' "$ENV_FILE"; then
  fail "JWT secrets in $ENV_FILE are still the example values. Generate real ones (docs/09-deployment.md)."
fi
# Google sign-in needs all three values; a partial set silently hides the login button.
google_set=0
for key in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REDIRECT_URI; do
  grep -qE "^${key}=.+" "$ENV_FILE" && google_set=$((google_set + 1))
done
if [ "$google_set" -gt 0 ] && [ "$google_set" -lt 3 ]; then
  fail "Google sign-in is half-configured in $ENV_FILE: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI must all have values (docs/11-google-login.md). Fill them in, or empty all three to turn Google sign-in off."
fi
ok "Configuration looks complete"

say "Checking disk space"
free_gb() { df -BG --output=avail / | tail -1 | tr -dc '0-9'; }
if [ "$(free_gb)" -lt "$MIN_FREE_GB" ]; then
  echo "Only $(free_gb)G free — clearing Docker's build cache (safe: it only holds temporary build files)"
  docker builder prune -f >/dev/null
fi
[ "$(free_gb)" -ge "$MIN_FREE_GB" ] || fail "Only $(free_gb)G free on disk (need ${MIN_FREE_GB}G). Free some space first (docs/13-operations.md)."
ok "$(free_gb)G free"

# ── 2. Backups ───────────────────────────────────────────────────────────────
say "Backing up database and settings to $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cp "$ENV_FILE" "$BACKUP_DIR/env-$STAMP"
chmod 600 "$BACKUP_DIR/env-$STAMP"
if docker compose ps --status running --services 2>/dev/null | grep -qx postgres; then
  docker compose exec -T postgres pg_dump -U contenter contenter | gzip > "$BACKUP_DIR/db-$STAMP.sql.gz"
  [ -s "$BACKUP_DIR/db-$STAMP.sql.gz" ] || fail "Database backup is empty — stopping before any change."
  ok "Database backup: $BACKUP_DIR/db-$STAMP.sql.gz ($(du -h "$BACKUP_DIR/db-$STAMP.sql.gz" | cut -f1))"
else
  echo "postgres is not running yet — skipping database backup"
fi
# keep only the newest backups
ls -1t "$BACKUP_DIR"/db-*.sql.gz 2>/dev/null | tail -n +"$((KEEP_BACKUPS + 1))" | xargs -r rm -f
ls -1t "$BACKUP_DIR"/env-* 2>/dev/null | tail -n +"$((KEEP_BACKUPS + 1))" | xargs -r rm -f

# ── 3. Code ──────────────────────────────────────────────────────────────────
say "Getting the latest version from GitHub"
BEFORE="$(git rev-parse --short HEAD)"
git pull --ff-only
AFTER="$(git rev-parse --short HEAD)"
ok "Version: $BEFORE → $AFTER ($(git describe --tags --always))"

# ── 4. Build & restart ───────────────────────────────────────────────────────
say "Building and restarting the app (a few minutes)"
docker compose --profile app up -d --build

# ── 5. Health check ──────────────────────────────────────────────────────────
say "Waiting for the API to become healthy"
for i in $(seq 1 30); do
  if docker compose exec -T api node -e "fetch('http://localhost:4000/api/health').then(r=>r.json()).then(j=>process.exit(j.status==='ok'?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    ok "API is healthy"
    docker compose ps --format 'table {{.Service}}\t{{.Status}}'
    printf '\n\033[1;32mDeploy finished: %s is live.\033[0m\n' "$(git describe --tags --always)"
    exit 0
  fi
  sleep 5
done
docker compose logs api --tail 40
fail "The API did not become healthy. The log above shows why. Your data and settings backups are in $BACKUP_DIR."
