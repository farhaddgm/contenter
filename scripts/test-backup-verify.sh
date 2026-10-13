#!/usr/bin/env bash
# Tests for `scripts/backup.sh verify` against a real Postgres (no Docker, no rclone needed).
#
#   TEST_PG_ADMIN_URL=postgresql://user:pass@localhost:5432/postgres bash scripts/test-backup-verify.sh
#
# The URL's user must be allowed to CREATE DATABASE. Every case gets its own empty scratch database
# (contenter_verify_test_<n>) that is dropped afterwards. CI runs this with the Postgres service.
set -uo pipefail

ADMIN="${TEST_PG_ADMIN_URL:-}"
[ -n "$ADMIN" ] || { echo "Set TEST_PG_ADMIN_URL (a postgresql:// URL that may CREATE DATABASE)"; exit 2; }
command -v psql >/dev/null || { echo "psql is required"; exit 2; }

cd "$(dirname "$0")/.."
BASE="${ADMIN%/*}" # URL without the database name
WORK="$(mktemp -d)"
CASE_N=0
FAILED=0
trap 'rm -rf "$WORK"' EXIT

stamp() { date -d "$1" +%Y%m%d-%H%M%S; }

# make_dump <file> <variant>: a tiny stand-in for a pg_dump of the app database
make_dump() {
  local file="$1" variant="$2" users=2
  [ "$variant" = nousers ] && users=0
  {
    echo 'CREATE TABLE "User" (id text PRIMARY KEY, email text);'
    [ "$variant" = notable ] || echo 'CREATE TABLE "AuditLog" (id text PRIMARY KEY);'
    echo 'CREATE TABLE "Business" (id text PRIMARY KEY);'
    echo 'CREATE TABLE "Topic" (id text PRIMARY KEY);'
    echo 'CREATE TABLE "Content" (id text PRIMARY KEY);'
    echo 'CREATE TABLE "AiJob" (id text PRIMARY KEY);'
    echo 'CREATE TABLE _prisma_migrations (id text PRIMARY KEY, finished_at timestamptz, rolled_back_at timestamptz);'
    local i
    for ((i = 1; i <= users; i++)); do echo "INSERT INTO \"User\" VALUES ('u$i', 'u$i@example.com');"; done
    echo "INSERT INTO \"Business\" VALUES ('b1');"
    echo "INSERT INTO _prisma_migrations VALUES ('m1', now(), NULL);"
    [ "$variant" = unfinished ] && echo "INSERT INTO _prisma_migrations VALUES ('m2', NULL, NULL);"
    [ "$variant" = broken-sql ] && echo 'THIS IS NOT SQL;'
  } | gzip > "$file"
}

# run_case <name> <expected exit 0|1> <variant> [db-time] [extra check command]
run_case() {
  local name="$1" expect="$2" variant="$3" when="${4:-1 hour ago}" bdir db code
  CASE_N=$((CASE_N + 1))
  bdir="$WORK/case$CASE_N"
  mkdir -p "$bdir"
  db="contenter_verify_test_$CASE_N"
  PGOPTIONS='-c client_min_messages=warning' psql "$ADMIN" -Atqc "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db" >/dev/null || { echo "cannot create $db"; exit 2; }

  case "$variant" in
    corrupt) printf 'not gzip' > "$bdir/db-$(stamp "$when").sql.gz" ;;
    missing) ;; # no backup file at all
    preloaded)
      make_dump "$bdir/db-$(stamp "$when").sql.gz" good
      psql "$BASE/$db" -Atqc 'CREATE TABLE "User" (id text)' >/dev/null
      ;;
    *) make_dump "$bdir/db-$(stamp "$when").sql.gz" "$variant" ;;
  esac

  BACKUP_DIR="$bdir" BACKUP_CONFIG=/nonexistent BACKUP_REMOTE= VERIFY_DB_URL="$BASE/$db" \
    bash scripts/backup.sh verify local > "$bdir/out.log" 2>&1
  code=$?

  local verdict=ok
  [ "$code" = "$expect" ] || verdict="exit $code, expected $expect"
  [ -s "$bdir/verify-status.json" ] || verdict="no verify-status.json written"
  if [ "$expect" = 0 ]; then
    grep -q '"ok":true' "$bdir/verify-status.json" 2>/dev/null || verdict="status not ok:true"
    [ -s "$bdir/verify-last-ok" ] || verdict="verify-last-ok missing"
  else
    grep -q '"ok":false' "$bdir/verify-status.json" 2>/dev/null || verdict="status not ok:false"
    [ ! -e "$bdir/verify-last-ok" ] || verdict="verify-last-ok written on failure"
  fi
  # no temp folders or leftovers may remain in the backup dir
  ls "$bdir" | grep -q '^verify\.' && verdict="temp folder left behind"

  if [ "$verdict" = ok ]; then
    echo "ok    $name"
  else
    echo "FAIL  $name — $verdict"
    sed 's/^/        /' "$bdir/out.log" | tail -15
    echo "        status: $(cat "$bdir/verify-status.json" 2>/dev/null)"
    FAILED=$((FAILED + 1))
  fi
  LAST_DIR="$bdir"
  LAST_DB="$db"
}

drop_all() {
  local n
  for ((n = 1; n <= CASE_N; n++)); do psql "$ADMIN" -Atqc "DROP DATABASE IF EXISTS contenter_verify_test_$n" >/dev/null 2>&1; done
}
trap 'drop_all; rm -rf "$WORK"' EXIT

run_case "good backup restores and passes" 0 good
grep -q '"User":2' "$LAST_DIR/verify-status.json" || { echo "FAIL  row count User:2 missing from status"; FAILED=$((FAILED + 1)); }
grep -q '"tables":7' "$LAST_DIR/verify-status.json" || { echo "FAIL  tables:7 missing from status"; FAILED=$((FAILED + 1)); }

run_case "backup with no users fails" 1 nousers
run_case "backup missing a key table fails" 1 notable
grep -q 'Table AuditLog is missing' "$LAST_DIR/verify-status.json" || { echo "FAIL  AuditLog problem not reported"; FAILED=$((FAILED + 1)); }
run_case "unfinished migration fails" 1 unfinished
run_case "stale backup (10 days) fails" 1 good "10 days ago"
grep -q 'nightly backups may have stopped' "$LAST_DIR/verify-status.json" || { echo "FAIL  stale problem not reported"; FAILED=$((FAILED + 1)); }
run_case "dump that does not restore fails" 1 broken-sql
run_case "corrupt gzip fails" 1 corrupt
run_case "no backup at all fails" 1 missing

run_case "non-empty scratch database is refused" 1 preloaded
# the guard must not have touched the existing data
[ "$(psql "$BASE/$LAST_DB" -Atqc 'select count(*) from information_schema.tables where table_schema = '"'public'")" = 1 ] ||
  { echo "FAIL  refused run still changed the scratch database"; FAILED=$((FAILED + 1)); }

run_case "fresh enough backup passes at the age limit" 0 good "40 hours ago"

# ── handing the result to the app (a fake `docker` that records what it receives) ──
FAKEBIN="$WORK/fakebin"
mkdir -p "$FAKEBIN"
cat > "$FAKEBIN/docker" <<'FAKE'
#!/usr/bin/env bash
# docker compose ps ...  -> pretend the api container runs; docker compose exec ... -> keep stdin and args
if [ "$1" = compose ] && [ "$2" = ps ]; then
  [ "${FAKE_API_UP:-1}" = 1 ] && echo api
  exit 0
fi
if [ "$1" = compose ] && [ "$2" = exec ]; then
  echo "$*" > "$FAKE_CAPTURE.args"
  cat > "$FAKE_CAPTURE"
  [ "${FAKE_EXEC_FAIL:-0}" = 1 ] && exit 1
  exit 0
fi
exit 0
FAKE
chmod +x "$FAKEBIN/docker"

report_case() {
  local name="$1" expect="$2" variant="$3" up="$4" execfail="$5" want_sent="$6" bdir code db
  CASE_N=$((CASE_N + 1))
  bdir="$WORK/case$CASE_N"
  mkdir -p "$bdir"
  db="contenter_verify_test_$CASE_N"
  PGOPTIONS='-c client_min_messages=warning' psql "$ADMIN" -Atqc "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db" >/dev/null || exit 2
  make_dump "$bdir/db-$(stamp '1 hour ago').sql.gz" "$variant"
  PATH="$FAKEBIN:$PATH" FAKE_CAPTURE="$bdir/captured" FAKE_API_UP="$up" FAKE_EXEC_FAIL="$execfail" \
    VERIFY_REPORT=1 BACKUP_DIR="$bdir" BACKUP_CONFIG=/nonexistent BACKUP_REMOTE= VERIFY_DB_URL="$BASE/$db" \
    bash scripts/backup.sh verify local > "$bdir/out.log" 2>&1
  code=$?
  local verdict=ok
  [ "$code" = "$expect" ] || verdict="exit $code, expected $expect"
  if [ "$want_sent" = yes ]; then
    cmp -s "$bdir/captured" "$bdir/verify-status.json" || verdict="the app did not receive verify-status.json"
    grep -q 'APP_ROLE=api' "$bdir/captured.args" 2>/dev/null || verdict="exec without -e APP_ROLE=api"
    grep -q 'dist/cli/record-backup-verify.js' "$bdir/captured.args" 2>/dev/null || verdict="exec does not run the CLI"
  else
    [ ! -e "$bdir/captured" ] || verdict="the result was sent although it should not"
  fi
  if [ "$verdict" = ok ]; then echo "ok    $name"; else
    echo "FAIL  $name — $verdict"; sed 's/^/        /' "$bdir/out.log" | tail -8; FAILED=$((FAILED + 1))
  fi
}

report_case "a passing check is reported to the app" 0 good 1 0 yes
report_case "a failing check is reported to the app too" 1 nousers 1 0 yes
report_case "api container down: warns, verdict unchanged, nothing sent" 0 good 0 0 no
report_case "reporting fails: warns, verdict unchanged" 0 good 1 1 yes

echo
if [ "$FAILED" -eq 0 ]; then echo "All backup verify tests passed ($CASE_N cases)"; else echo "$FAILED check(s) failed"; exit 1; fi
