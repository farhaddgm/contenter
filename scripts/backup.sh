#!/usr/bin/env bash
# Contenter — backups of the database, apps/api/.env and uploaded files (run on the server, inside the repo folder).
#
#   bash scripts/backup.sh                 back up now: local copy + encrypted off-site copy
#   bash scripts/backup.sh setup           one-time: create the encryption key and the settings file
#   bash scripts/backup.sh rclone <args>   run rclone (e.g. `rclone config`) — installed rclone or its Docker image
#   bash scripts/backup.sh test            download the newest off-site backup and check it can be unpacked
#   bash scripts/backup.sh verify [local]  really restore the newest backup into a throwaway database and check it
#   bash scripts/backup.sh fetch [file]    download and unpack an off-site backup (default: newest)
#   bash scripts/backup.sh install-cron    back up every night at 03:17 and verify a restore every Sunday at 04:07
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
    verify) verify "$@" ;;
    fetch) fetch "$@" ;;
    install-cron) install_cron ;;
    *) fail "Unknown command '$cmd'. Use: backup.sh [run|setup|rclone|test|verify|fetch|install-cron]" ;;
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

# ── Restore check ──────────────────────────────────────────────────────────
# A backup that was never restored is unproven. `verify` takes the newest backup (off-site when
# BACKUP_REMOTE is set, else local; `verify local` forces local), restores the database into a
# THROWAWAY Postgres (a --network none container; never the live database) and checks the result.
# Writes $BACKUP_DIR/verify-status.json and, on success, $BACKUP_DIR/verify-last-ok; exits 1 on failure.
#   VERIFY_MAX_AGE_HOURS  newest backup must be younger than this (default 48)
#   VERIFY_PG_IMAGE       image for the throwaway database (default postgres:17-alpine)
#   VERIFY_DB_URL         use this EMPTY database instead of a container (tests); refused when it has tables
#   VERIFY_REPORT         1 = always hand the result to the app, 0 = never (default: yes, except with VERIFY_DB_URL)
# The result is also handed to the api container (apps/api/src/cli/record-backup-verify.ts): the app
# stores it, shows it in /api/health and warns the admins when it failed (in-app, e-mail, webhook).
VERIFY_TABLES=(User Business Topic Content AiJob AuditLog)

verify() {
  local want="${1:-}" src stamp="" age_h=0 db up_count=0 tables=0 mig_total=0 mig_bad=0 t n
  if [ -n "$want" ] && [ "$want" != local ]; then fail "Unknown option '$want'. Use: backup.sh verify [local]"; fi
  VERIFY_PROBLEMS=() VERIFY_WARNINGS=() VERIFY_ROWS="" VERIFY_DONE=0 VERIFY_SOURCE="" VERIFY_BACKUP="" VERIFY_CONTAINER=""
  VERIFY_TMP="$(mktemp -d "$BACKUP_DIR/verify.XXXXXX")"
  trap verify_exit EXIT
  if [ -z "$want" ] && [ -n "$BACKUP_REMOTE" ]; then src=offsite; else src=local; fi
  VERIFY_SOURCE="$src"

  say "Restore check ($src backup)"
  local dir
  if [ "$src" = offsite ]; then
    dir="$VERIFY_TMP"
    fetch_into "$dir" ""
  else
    dir="$BACKUP_DIR"
  fi
  db="$(ls -1t "$dir"/db-*.sql.gz 2>/dev/null | head -1 || true)"
  [ -n "$db" ] || verify_abort "No database backup (db-*.sql.gz) found in $dir"
  gzip -t "$db" || verify_abort "$(basename "$db") is damaged"
  VERIFY_BACKUP="$(basename "$db")"

  # age comes from the time stamp in the name (db-YYYYMMDD-HHMMSS.sql.gz), so a dead cron is caught too
  stamp="$(basename "$db" | sed -E 's/^db-([0-9]{8})-([0-9]{6})\.sql\.gz$/\1 \2/')"
  if [[ "$stamp" =~ ^([0-9]{4})([0-9]{2})([0-9]{2})\ ([0-9]{2})([0-9]{2})([0-9]{2})$ ]]; then
    local made now
    made="$(date -d "${BASH_REMATCH[1]}-${BASH_REMATCH[2]}-${BASH_REMATCH[3]} ${BASH_REMATCH[4]}:${BASH_REMATCH[5]}:${BASH_REMATCH[6]}" +%s 2>/dev/null || echo 0)"
    now="$(date +%s)"
    if [ "$made" -gt 0 ]; then
      age_h=$(((now - made) / 3600))
      [ "$age_h" -le "${VERIFY_MAX_AGE_HOURS:-48}" ] || VERIFY_PROBLEMS+=("The newest backup is ${age_h}h old (limit ${VERIFY_MAX_AGE_HOURS:-48}h): nightly backups may have stopped")
    fi
  else
    VERIFY_WARNINGS+=("Could not read the time from the backup name, age not checked")
  fi

  # uploaded files: archive must list; an empty/missing one is only a warning (no uploads yet, or api was down)
  local up
  up="$(ls -1t "$dir"/uploads-*.tar.gz 2>/dev/null | head -1 || true)"
  if [ -n "$up" ]; then
    if gzip -t "$up" 2>/dev/null; then
      up_count="$(tar -tzf "$up" 2>/dev/null | grep -vc '/$' || true)"
    else
      VERIFY_PROBLEMS+=("$(basename "$up") is damaged")
    fi
  else
    VERIFY_WARNINGS+=("No uploaded-files archive in this backup")
  fi

  start_scratch
  n="$(vq "select count(*) from information_schema.tables where table_schema = 'public'")"
  [ "$n" = 0 ] || verify_abort "The scratch database is not empty ($n tables); refusing to restore into it"

  say "Restoring $VERIFY_BACKUP into a throwaway database"
  if ! gunzip -c "$db" | vpsql -q -o /dev/null; then
    VERIFY_PROBLEMS+=("The database dump does not restore (psql failed)")
  else
    tables="$(vq "select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")"
    for t in "${VERIFY_TABLES[@]}"; do
      if [ "$(vq "select to_regclass('public.\"$t\"') is not null")" = t ]; then
        n="$(vq "select count(*) from \"$t\"")"
        VERIFY_ROWS="${VERIFY_ROWS:+$VERIFY_ROWS,}\"$t\":$n"
        if [ "$t" = User ] && [ "$n" -lt 1 ]; then VERIFY_PROBLEMS+=("Table User restored but has no rows"); fi
      else
        VERIFY_PROBLEMS+=("Table $t is missing after restore")
      fi
    done
    if [ "$(vq "select to_regclass('public._prisma_migrations') is not null")" = t ]; then
      mig_total="$(vq "select count(*) from _prisma_migrations")"
      mig_bad="$(vq "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")"
      [ "$mig_total" -ge 1 ] || VERIFY_PROBLEMS+=("_prisma_migrations is empty")
      [ "$mig_bad" = 0 ] || VERIFY_PROBLEMS+=("$mig_bad migration(s) are unfinished in the backup")
    else
      VERIFY_PROBLEMS+=("Table _prisma_migrations is missing after restore")
    fi
  fi

  VERIFY_TABLE_COUNT="$tables" VERIFY_UPLOAD_FILES="$up_count" VERIFY_AGE_HOURS="$age_h" VERIFY_MIGRATIONS="$mig_total"
  verify_finish
}

verify_abort() { VERIFY_PROBLEMS+=("$1"); verify_finish; }

# write the status file, print the verdict, exit 0 / 1
verify_finish() {
  local passed=true now p w
  [ "${#VERIFY_PROBLEMS[@]}" -eq 0 ] || passed=false
  now="$(date '+%Y-%m-%d %H:%M:%S')"
  write_verify_status "$passed" "$now"
  VERIFY_DONE=1
  report_to_app
  for w in ${VERIFY_WARNINGS[@]+"${VERIFY_WARNINGS[@]}"}; do warn "$w"; done
  if [ "$passed" = true ]; then
    echo "$now" > "$BACKUP_DIR/verify-last-ok"
    ok "Restore check passed: $VERIFY_BACKUP restores (${VERIFY_TABLE_COUNT:-0} tables, ${VERIFY_UPLOAD_FILES:-0} uploaded files, ${VERIFY_AGE_HOURS:-0}h old)"
    exit 0
  fi
  for p in "${VERIFY_PROBLEMS[@]}"; do printf '\033[1;31m✘ %s\033[0m\n' "$p" >&2; done
  printf '\n\033[1;31m✘ Restore check FAILED\033[0m (last success: %s). Details: %s\n' \
    "$(cat "$BACKUP_DIR/verify-last-ok" 2>/dev/null || echo never)" "$BACKUP_DIR/verify-status.json" >&2
  exit 1
}

json_str() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\r\n'; }
json_list() {
  local out="" x
  for x in "$@"; do out="${out:+$out,}\"$(json_str "$x")\""; done
  printf '[%s]' "$out"
}

write_verify_status() {
  local passed="$1" now="$2" tmp="$BACKUP_DIR/verify-status.json.tmp"
  printf '{"ok":%s,"checkedAt":"%s","source":"%s","backup":"%s","backupAgeHours":%s,"tables":%s,"migrations":%s,"uploadFiles":%s,"rows":{%s},"problems":%s,"warnings":%s}\n' \
    "$passed" "$now" "$VERIFY_SOURCE" "$(json_str "$VERIFY_BACKUP")" "${VERIFY_AGE_HOURS:-0}" "${VERIFY_TABLE_COUNT:-0}" \
    "${VERIFY_MIGRATIONS:-0}" "${VERIFY_UPLOAD_FILES:-0}" "$VERIFY_ROWS" \
    "$(json_list ${VERIFY_PROBLEMS[@]+"${VERIFY_PROBLEMS[@]}"})" "$(json_list ${VERIFY_WARNINGS[@]+"${VERIFY_WARNINGS[@]}"})" > "$tmp"
  mv "$tmp" "$BACKUP_DIR/verify-status.json"
}

# always runs: removes the temp folder and the container; records a failure when the script died early
verify_exit() {
  local code=$?
  if [ -n "${VERIFY_CONTAINER:-}" ]; then docker rm -f "$VERIFY_CONTAINER" >/dev/null 2>&1 || true; fi
  rm -rf "${VERIFY_TMP:-}"
  if [ "${VERIFY_DONE:-1}" = 0 ]; then
    VERIFY_PROBLEMS+=("The check stopped before it finished (exit $code); see the log")
    write_verify_status false "$(date '+%Y-%m-%d %H:%M:%S')" || true
    report_to_app
  fi
}

# Hands verify-status.json to the api container so the app can store it and warn the admins.
# Never changes the verdict: when the app cannot be reached (not running, an older image without
# the command) it only warns, and the file in $BACKUP_DIR is still the record.
report_to_app() {
  case "${VERIFY_REPORT:-}" in 0) return 0 ;; 1) ;; *) [ -z "${VERIFY_DB_URL:-}" ] || return 0 ;; esac
  [ -s "$BACKUP_DIR/verify-status.json" ] || return 0
  command -v docker >/dev/null || return 0
  if ! docker compose ps --status running --services 2>/dev/null | grep -qx api; then
    warn "The api container is not running: the result was not reported to the app."
    return 0
  fi
  if docker compose exec -T -e APP_ROLE=api api node apps/api/dist/cli/record-backup-verify.js < "$BACKUP_DIR/verify-status.json"; then
    echo "The app has the result (admins are warned when it failed)."
  else
    warn "Could not report the result to the app (an older version without the command?). It is in $BACKUP_DIR/verify-status.json."
  fi
  return 0
}

# throwaway database: a container with no network, or $VERIFY_DB_URL (must be empty, checked by the caller)
start_scratch() {
  if [ -n "${VERIFY_DB_URL:-}" ]; then return 0; fi
  command -v docker >/dev/null || verify_abort "docker is required to start the throwaway database"
  VERIFY_CONTAINER="contenter-verify-$$"
  say "Starting a throwaway database"
  docker run -d --rm --name "$VERIFY_CONTAINER" --network none --memory 1g \
    -e POSTGRES_USER=contenter -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=contenter \
    "${VERIFY_PG_IMAGE:-postgres:17-alpine}" >/dev/null || verify_abort "Could not start the throwaway database container"
  local i
  # the image starts a temporary server for init, then the real one: wait for the second "ready" line
  for i in $(seq 1 90); do
    [ "$(docker logs "$VERIFY_CONTAINER" 2>&1 | grep -c 'ready to accept connections')" -ge 2 ] && return 0
    sleep 1
  done
  verify_abort "The throwaway database did not become ready in 90 seconds"
}

vpsql() {
  if [ -n "${VERIFY_DB_URL:-}" ]; then
    psql "$VERIFY_DB_URL" -X -v ON_ERROR_STOP=1 "$@"
  else
    docker exec -i "$VERIFY_CONTAINER" psql -U contenter -d contenter -X -v ON_ERROR_STOP=1 "$@"
  fi
}
# a failing query ends the script (set -e); verify_exit then records "stopped before it finished"
vq() { vpsql -Atq -c "$1"; }

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
  local backup="17 3 * * * cd $REPO && bash scripts/backup.sh >> $BACKUP_DIR/backup.log 2>&1"
  local check="7 4 * * 0 cd $REPO && bash scripts/backup.sh verify >> $BACKUP_DIR/verify.log 2>&1"
  { crontab -l 2>/dev/null | grep -vF 'scripts/backup.sh' || true; echo "$backup"; echo "$check"; } | crontab -
  ok "Nightly backup scheduled (03:17 server time). Log: $BACKUP_DIR/backup.log"
  ok "Weekly restore check scheduled (Sunday 04:07). Log: $BACKUP_DIR/verify.log, result: $BACKUP_DIR/verify-status.json"
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
