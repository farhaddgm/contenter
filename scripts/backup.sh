#!/usr/bin/env bash
# Contenter — backups of the database, apps/api/.env and uploaded files (run on the server, inside the repo folder).
#
#   bash scripts/backup.sh                 back up now: local copy + encrypted off-site copy
#   bash scripts/backup.sh setup           one-time: create the encryption key and the settings file
#   bash scripts/backup.sh rclone <args>   run rclone (e.g. `rclone config`) — installed rclone or its Docker image
#   bash scripts/backup.sh test            download the newest off-site backup and check it can be restored
#   bash scripts/backup.sh fetch [file]    download and unpack an off-site backup (default: newest)
#   bash scripts/backup.sh install-cron    back up automatically every night at 03:17
#
# Local copies go to ~/contenter-backups (newest $KEEP_BACKUPS kept; uploaded files: newest
# $KEEP_UPLOAD_BACKUPS). The off-site copy is one file per run, contenter-<time>.tar.gz.enc
# (AES-256, key in ~/.contenter-backup-key), uploaded with rclone to $BACKUP_REMOTE; copies older than $KEEP_OFFSITE_DAYS days are deleted there.
# Settings live in ~/.contenter-backup.env (outside git). docs/13-operations.md explains it all.
set -euo pipefail

main() {
  cd "$(dirname "$0")/.."
  umask 077 # backups, the key and copies of .env must not be readable by other server users

  local CONFIG="${BACKUP_CONFIG:-$HOME/.contenter-backup.env}"
  # shellcheck source=/dev/null
  if [ -f "$CONFIG" ]; then . "$CONFIG"; fi
  REPO="$(pwd)"
  ENV_FILE="apps/api/.env"
  BACKUP_DIR="${BACKUP_DIR:-$HOME/contenter-backups}"
  KEEP_BACKUPS="${KEEP_BACKUPS:-14}"
  KEEP_UPLOAD_BACKUPS="${KEEP_UPLOAD_BACKUPS:-3}"
  BACKUP_REMOTE="${BACKUP_REMOTE:-}"
  BACKUP_REMOTE="${BACKUP_REMOTE%/}"
  BACKUP_KEY_FILE="${BACKUP_KEY_FILE:-$HOME/.contenter-backup-key}"
  KEEP_OFFSITE_DAYS="${KEEP_OFFSITE_DAYS:-30}"
  mkdir -p "$BACKUP_DIR" "$HOME/.config/rclone"
  chmod 700 "$BACKUP_DIR"
  # how rclone sees $BACKUP_DIR (inside its Docker container it is mounted at /data)
  if command -v rclone >/dev/null; then RC_DATA="$BACKUP_DIR"; else RC_DATA=/data; fi

  local cmd="${1:-run}"
  if [ "$#" -gt 0 ]; then shift; fi
  case "$cmd" in
    run) backup_now ;;
    setup) setup ;;
    rclone) rclone_cmd "$@" ;;
    test) test_offsite ;;
    fetch) fetch "$@" ;;
    install-cron) install_cron ;;
    *) fail "Unknown command '$cmd'. Use: backup.sh [run|setup|rclone|test|fetch|install-cron]" ;;
  esac
}

backup_now() {
  local STAMP files=()
  STAMP="$(date +%Y%m%d-%H%M%S)"
  [ -f docker-compose.yml ] || fail "Run this inside the contenter folder (cd ~/contenter)."

  say "Backing up database, settings and uploaded files to $BACKUP_DIR"
  if [ -s "$ENV_FILE" ]; then
    cp "$ENV_FILE" "$BACKUP_DIR/env-$STAMP"
    files+=("env-$STAMP")
  else
    echo "$ENV_FILE is missing or empty — not backing it up (older copies are kept)"
  fi
  if docker compose ps --status running --services 2>/dev/null | grep -qx postgres; then
    docker compose exec -T postgres pg_dump -U contenter contenter | gzip > "$BACKUP_DIR/db-$STAMP.sql.gz"
    [ -s "$BACKUP_DIR/db-$STAMP.sql.gz" ] || fail "Database backup is empty — stopping before any change."
    files+=("db-$STAMP.sql.gz")
    ok "Database backup: $BACKUP_DIR/db-$STAMP.sql.gz ($(du -h "$BACKUP_DIR/db-$STAMP.sql.gz" | cut -f1))"
  else
    echo "postgres is not running — skipping database backup"
  fi
  # uploaded files (brand assets) live in the api container's "uploads" volume
  if docker compose ps --status running --services 2>/dev/null | grep -qx api; then
    if docker compose exec -T api sh -c 'cd "${UPLOAD_DIR:-uploads}" 2>/dev/null && tar -czf - .' > "$BACKUP_DIR/uploads-$STAMP.tar.gz" &&
      [ -s "$BACKUP_DIR/uploads-$STAMP.tar.gz" ]; then
      files+=("uploads-$STAMP.tar.gz")
      ok "Uploaded files: $BACKUP_DIR/uploads-$STAMP.tar.gz ($(du -h "$BACKUP_DIR/uploads-$STAMP.tar.gz" | cut -f1))"
    else
      rm -f "$BACKUP_DIR/uploads-$STAMP.tar.gz"
      warn "Could not back up uploaded files (the database backup is fine)."
    fi
  else
    echo "api is not running — skipping uploaded files"
  fi
  find "$BACKUP_DIR" -maxdepth 1 -type f -exec chmod 600 {} + 2>/dev/null || true
  # keep only the newest local backups (uploaded files can be large: fewer copies)
  ls -1t "$BACKUP_DIR"/db-*.sql.gz 2>/dev/null | tail -n +"$((KEEP_BACKUPS + 1))" | xargs -r rm -f
  ls -1t "$BACKUP_DIR"/env-* 2>/dev/null | tail -n +"$((KEEP_BACKUPS + 1))" | xargs -r rm -f
  ls -1t "$BACKUP_DIR"/uploads-*.tar.gz 2>/dev/null | tail -n +"$((KEEP_UPLOAD_BACKUPS + 1))" | xargs -r rm -f

  # ── Off-site copy ──────────────────────────────────────────────────────────
  if [ -z "$BACKUP_REMOTE" ]; then
    warn "Off-site backup is not set up: backups exist only on this server (docs/13-operations.md, section 8)."
    return 0
  fi
  [ "${#files[@]}" -gt 0 ] || { warn "Nothing to send off-site."; return 0; }
  say "Sending an encrypted copy to $BACKUP_REMOTE"
  if upload_offsite "$STAMP" "${files[@]}"; then
    date '+%Y-%m-%d %H:%M:%S' > "$BACKUP_DIR/offsite-last-ok"
    ok "Off-site copy uploaded: contenter-$STAMP.tar.gz.enc"
  else
    rm -f "$BACKUP_DIR/contenter-$STAMP.tar.gz.enc"
    warn "Off-site upload FAILED (last success: $(cat "$BACKUP_DIR/offsite-last-ok" 2>/dev/null || echo never)). The local backup is fine."
    # a deploy must not stop because the backup storage is unreachable; cron runs report the failure
    [ "${BACKUP_FROM_DEPLOY:-0}" = 1 ] || exit 1
  fi
}

upload_offsite() {
  local STAMP="$1" name
  shift
  name="contenter-$STAMP.tar.gz.enc"
  [ -s "$BACKUP_KEY_FILE" ] || { echo "Encryption key $BACKUP_KEY_FILE is missing — run: bash scripts/backup.sh setup" >&2; return 1; }
  tar -C "$BACKUP_DIR" -czf - "$@" | encrypt > "$BACKUP_DIR/$name" || return 1
  rclone_cmd copy "$RC_DATA/$name" "$BACKUP_REMOTE" || return 1
  rm -f "$BACKUP_DIR/$name" # the plain local copies stay; the encrypted file only exists to be uploaded
  rclone_cmd delete --min-age "${KEEP_OFFSITE_DAYS}d" --include 'contenter-*.tar.gz.enc' "$BACKUP_REMOTE" ||
    echo "Could not delete old off-site copies (the new one is uploaded)" >&2
}

test_offsite() {
  say "Checking the newest off-site backup in $BACKUP_REMOTE"
  TMP_DIR="$(mktemp -d "$BACKUP_DIR/restore-test.XXXXXX")" # global: the EXIT trap outlives locals
  trap 'rm -rf "$TMP_DIR"' EXIT
  fetch_into "$TMP_DIR" ""
  ok "It can be restored"
}

fetch() {
  local name="${1:-}" dir
  dir="$BACKUP_DIR/restore-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$dir"
  say "Downloading ${name:-the newest backup} from $BACKUP_REMOTE"
  fetch_into "$dir" "$name"
  ok "Unpacked into $dir"
}

# download off-site backup $2 (empty = newest) into folder $1, decrypt, unpack and check it
fetch_into() {
  local dir="$1" name="$2"
  [ -n "$BACKUP_REMOTE" ] || fail "BACKUP_REMOTE is not set in ~/.contenter-backup.env (docs/13-operations.md, section 8)."
  [ -s "$BACKUP_KEY_FILE" ] || fail "Encryption key $BACKUP_KEY_FILE is missing."
  if [ -z "$name" ]; then
    name="$(rclone_cmd lsf --include 'contenter-*.tar.gz.enc' "$BACKUP_REMOTE" | sort | tail -1)"
    [ -n "$name" ] || fail "No backups found in $BACKUP_REMOTE."
  fi
  rclone_cmd copyto "$(remote_path "$name")" "$RC_DATA/$(basename "$dir")/$name" || fail "Could not download $name."
  decrypt < "$dir/$name" | tar -C "$dir" -xzf - || fail "Could not decrypt/unpack $name — wrong key in $BACKUP_KEY_FILE?"
  rm -f "$dir/$name"
  local f
  for f in "$dir"/db-*.sql.gz "$dir"/uploads-*.tar.gz; do
    [ -e "$f" ] || continue
    gzip -t "$f" || fail "$(basename "$f") inside $name is damaged."
  done
  echo "$name:"
  ls -l "$dir" | tail -n +2
}

setup() {
  say "Setting up off-site backups"
  if [ -s "$BACKUP_KEY_FILE" ]; then
    ok "Encryption key already exists: $BACKUP_KEY_FILE"
  else
    openssl rand -base64 32 > "$BACKUP_KEY_FILE"
    chmod 600 "$BACKUP_KEY_FILE"
    ok "Created encryption key: $BACKUP_KEY_FILE"
  fi
  printf '\n\033[1;33mSave this key somewhere OUTSIDE this server (e.g. a password manager).\nWithout it the off-site backups cannot be opened:\033[0m\n\n    %s\n\n' "$(cat "$BACKUP_KEY_FILE")"
  local CONFIG="${BACKUP_CONFIG:-$HOME/.contenter-backup.env}"
  if [ ! -f "$CONFIG" ]; then
    cat > "$CONFIG" <<'EOF'
# Off-site backup settings for scripts/backup.sh (docs/13-operations.md, section 8)
# rclone destination: <remote name>:<bucket or folder>. Empty = local backups only.
BACKUP_REMOTE=
# Delete off-site copies older than this many days
KEEP_OFFSITE_DAYS=30
EOF
    chmod 600 "$CONFIG"
    ok "Created settings file: $CONFIG"
  fi
  echo "Next: create the rclone remote, set BACKUP_REMOTE in $CONFIG, then run: bash scripts/backup.sh && bash scripts/backup.sh test"
}

install_cron() {
  command -v crontab >/dev/null || fail "crontab is not installed on this server."
  local line="17 3 * * * cd $REPO && bash scripts/backup.sh >> $BACKUP_DIR/backup.log 2>&1"
  { crontab -l 2>/dev/null | grep -vF 'scripts/backup.sh' || true; echo "$line"; } | crontab -
  ok "Nightly backup scheduled (03:17 server time). Log: $BACKUP_DIR/backup.log"
  crontab -l | grep -F 'scripts/backup.sh'
}

encrypt() { openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$BACKUP_KEY_FILE"; }
decrypt() { openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$BACKUP_KEY_FILE"; }

# "remote:" + file → "remote:file"; "remote:bucket" + file → "remote:bucket/file"
remote_path() { case "$BACKUP_REMOTE" in *:) echo "$BACKUP_REMOTE$1" ;; *) echo "$BACKUP_REMOTE/$1" ;; esac; }

# rclone from the server if installed, otherwise its official Docker image (nothing to install).
rclone_cmd() {
  if command -v rclone >/dev/null; then
    rclone "$@"
  else
    local tty=()
    [ -t 0 ] && tty=(-it)
    docker run --rm "${tty[@]}" --user "$(id -u):$(id -g)" \
      -v "$HOME/.config/rclone:/config/rclone" -v "$BACKUP_DIR:/data" \
      rclone/rclone "$@"
  fi
}

say()  { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*" >&2; }
fail() { printf '\n\033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

main "$@"
exit
