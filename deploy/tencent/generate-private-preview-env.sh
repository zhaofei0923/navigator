#!/bin/sh
set -eu

: "${NAVIGATOR_API_IMAGE:?NAVIGATOR_API_IMAGE must be set}"
: "${NAVIGATOR_WEB_IMAGE:?NAVIGATOR_WEB_IMAGE must be set}"
: "${NAVIGATOR_SOURCE_SNAPSHOT_SHA256:?NAVIGATOR_SOURCE_SNAPSHOT_SHA256 must be set}"
: "${NAVIGATOR_DEMO_PASSPHRASE:?NAVIGATOR_DEMO_PASSPHRASE must be set}"

target=${1:-/opt/navigator/.env.remote}
target_dir=$(dirname "$target")
temporary="$target_dir/.env.remote.tmp.$$"

cleanup() {
  rm -f "$temporary"
}
trap cleanup EXIT HUP INT TERM

umask 077
db_password=$(openssl rand -hex 32)
access_key=$(openssl rand -hex 32)
session_secret=$(openssl rand -hex 32)

{
  printf 'NAVIGATOR_HOSTNAME=%s\n' "${NAVIGATOR_HOSTNAME:-navigator.easudata.com}"
  printf 'NAVIGATOR_WEB_PORT=%s\n' "${NAVIGATOR_WEB_PORT:-3100}"
  printf 'NAVIGATOR_POSTGRES_IMAGE=%s\n' "${NAVIGATOR_POSTGRES_IMAGE:-postgres:18-alpine}"
  printf 'NAVIGATOR_API_IMAGE=%s\n' "$NAVIGATOR_API_IMAGE"
  printf 'NAVIGATOR_WEB_IMAGE=%s\n' "$NAVIGATOR_WEB_IMAGE"
  printf 'NAVIGATOR_SOURCE_SNAPSHOT_SHA256=%s\n' "$NAVIGATOR_SOURCE_SNAPSHOT_SHA256"
  printf 'NAVIGATOR_DB_PASSWORD=%s\n' "$db_password"
  printf 'NAVIGATOR_DEMO_ACCESS_KEY=%s\n' "$access_key"
  printf 'NAVIGATOR_DEMO_PASSPHRASE=%s\n' "$NAVIGATOR_DEMO_PASSPHRASE"
  printf 'NAVIGATOR_DEMO_SESSION_SECRET=%s\n' "$session_secret"
} >"$temporary"

chmod 0600 "$temporary"
mv "$temporary" "$target"
trap - EXIT HUP INT TERM
