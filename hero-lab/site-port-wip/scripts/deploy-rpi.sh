#!/usr/bin/env bash
# Deploy to Raspberry Pi via SSH
# Usage: ./scripts/deploy-rpi.sh [user@host]
# Example: ./scripts/deploy-rpi.sh pi@192.168.1.42
#
# Requirements on the Pi:
#   - Docker + Docker Compose installed
#   - SSH key auth set up
#   - ADMIN_SECRET set in /opt/portfolio/.env on the Pi

set -euo pipefail

TARGET="${1:-pi@raspberrypi.local}"
REMOTE_DIR="/opt/portfolio"
IMAGE="portfolio:latest"

echo "▶ Building image for linux/arm64..."
docker buildx build \
  --platform linux/arm64 \
  --tag "$IMAGE" \
  --load \
  .

echo "▶ Transferring image to $TARGET..."
docker save "$IMAGE" | ssh "$TARGET" "docker load"

echo "▶ Syncing compose files..."
ssh "$TARGET" "mkdir -p $REMOTE_DIR/data"
scp docker-compose.yml "$TARGET:$REMOTE_DIR/docker-compose.yml"

echo "▶ Restarting container..."
ssh "$TARGET" "
  cd $REMOTE_DIR
  docker compose up -d --no-build
  docker compose ps
"

echo "✓ Deployed to $TARGET"
