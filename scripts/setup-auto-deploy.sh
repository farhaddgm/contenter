#!/usr/bin/env bash
# Contenter — one-time setup of automatic deploys from GitHub Actions (run on the server).
#
#   cd ~/contenter && bash scripts/setup-auto-deploy.sh
#
# Creates an SSH key that can do exactly one thing on this server: run scripts/deploy.sh
# (a "restrict,command=" line in ~/.ssh/authorized_keys — no shell, no port forwarding).
# Prints the values to paste into GitHub → Settings → Secrets and variables → Actions.
# Running it again replaces the old key. To turn automatic deploys off, delete the line
# ending in "contenter-github-deploy" from ~/.ssh/authorized_keys.
set -euo pipefail

main() {
  cd "$(dirname "$0")/.."
  umask 077
  local REPO KEY_TAG="contenter-github-deploy" tmp host port
  REPO="$(pwd)"
  [ -f scripts/deploy.sh ] || fail "Run this inside the contenter folder (cd ~/contenter)."
  command -v ssh-keygen >/dev/null || fail "ssh-keygen is not installed."

  # this SSH session tells us the server's address and port: "client_ip client_port server_ip server_port"
  local conn=(${SSH_CONNECTION:-})
  host="${DEPLOY_HOST:-${conn[2]:-}}"
  port="${DEPLOY_PORT:-${conn[3]:-22}}"
  [ -n "$host" ] || fail "Could not detect the server address. Run: DEPLOY_HOST=<server ip> bash scripts/setup-auto-deploy.sh"

  say "Creating a deploy-only SSH key"
  TMP_DIR="$(mktemp -d)" # global: the EXIT trap runs after main's locals are gone
  trap 'rm -rf "$TMP_DIR"' EXIT
  tmp="$TMP_DIR"
  ssh-keygen -q -t ed25519 -N "" -C "$KEY_TAG" -f "$tmp/key"
  mkdir -p ~/.ssh
  chmod 700 ~/.ssh
  touch ~/.ssh/authorized_keys
  chmod 600 ~/.ssh/authorized_keys
  # drop a previous deploy key, then allow the new one to run deploy.sh only
  # (written to a new file and swapped in, so a full disk can never leave authorized_keys empty)
  { grep -vF "$KEY_TAG" ~/.ssh/authorized_keys || true; } > ~/.ssh/authorized_keys.new
  echo "restrict,command=\"cd $REPO && bash scripts/deploy.sh\" $(cat "$tmp/key.pub")" >> ~/.ssh/authorized_keys.new
  grep -qF "$(cut -d' ' -f2 "$tmp/key.pub")" ~/.ssh/authorized_keys.new || fail "Could not write ~/.ssh/authorized_keys.new (disk full?). Nothing was changed."
  chmod 600 ~/.ssh/authorized_keys.new
  mv ~/.ssh/authorized_keys.new ~/.ssh/authorized_keys
  ok "Key added to ~/.ssh/authorized_keys (it can only run scripts/deploy.sh)"

  say "Reading this server's SSH fingerprint"
  local known
  known="$(ssh-keyscan -p "$port" -T 10 "$host" 2>/dev/null || true)"
  [ -n "$known" ] || fail "ssh-keyscan could not reach $host:$port. Run again with DEPLOY_HOST=<public ip> DEPLOY_PORT=<ssh port>."
  ok "Got the fingerprint of $host:$port"

  printf '\n\033[1;33mAdd these in GitHub → repository → Settings → Secrets and variables → Actions → New repository secret:\033[0m\n'
  secret DEPLOY_HOST "$host"
  secret DEPLOY_PORT "$port"
  secret DEPLOY_USER "$(id -un)"
  secret DEPLOY_KNOWN_HOSTS "$known"
  secret DEPLOY_SSH_KEY "$(cat "$tmp/key")"
  printf '\nThe private key above is not stored on this server; if you lose it, just run this script again.\n'
  printf 'Then test it: GitHub → Actions → Deploy → Run workflow.\n'
}

secret() { printf '\n\033[1;36m── %s ──\033[0m\n%s\n' "$1" "$2"; }
say()  { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

main "$@"
