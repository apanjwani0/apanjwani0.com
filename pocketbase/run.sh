#!/usr/bin/env bash
# Run the local PocketBase backend for Poker Together.
# Downloads the right binary on first run (works on macOS and the Raspberry Pi —
# linux/arm64 — for later), then serves on 127.0.0.1:8090. Binary + pb_data are
# gitignored; this script + pb_migrations/ are the reproducible part.
set -euo pipefail

VERSION="0.39.6"
DIR="$(cd "$(dirname "$0")" && pwd)"
BIN="$DIR/pocketbase"

if [ ! -x "$BIN" ]; then
  OS="$(uname -s | tr '[:upper:]' '[:lower:]')"          # darwin | linux
  ARCH="$(uname -m)"
  case "$ARCH" in arm64|aarch64) ARCH="arm64";; x86_64|amd64) ARCH="amd64";; esac
  URL="https://github.com/pocketbase/pocketbase/releases/download/v${VERSION}/pocketbase_${VERSION}_${OS}_${ARCH}.zip"
  echo "pocketbase: downloading ${URL}"
  curl -sL -o "$DIR/pb.zip" "$URL"
  unzip -oq "$DIR/pb.zip" pocketbase -d "$DIR"
  rm -f "$DIR/pb.zip"
  chmod +x "$BIN"
fi

exec "$BIN" serve --http=127.0.0.1:8090 --dir "$DIR/pb_data"
