#!/usr/bin/env bash
# Deploy to a cloud VPS or container registry
# Usage: ./scripts/deploy-cloud.sh [registry/image:tag] [user@host]
# Example: ./scripts/deploy-cloud.sh ghcr.io/your-username/portfolio:latest user@1.2.3.4
#
# Requires docker login to the registry first:
#   docker login ghcr.io -u your-username
#
# Set DOCKER_IMAGE in your .env (or environment) to override the default.

set -euo pipefail

IMAGE="${1:-${DOCKER_IMAGE:-ghcr.io/your-username/portfolio:latest}}"
TARGET="${2:-}"
REMOTE_DIR="/opt/portfolio"

echo "▶ Building multi-platform image..."
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag "$IMAGE" \
  --push \
  .

if [ -n "$TARGET" ]; then
  echo "▶ Deploying to $TARGET..."
  ssh "$TARGET" "
    mkdir -p $REMOTE_DIR/data
    docker pull $IMAGE
    cd $REMOTE_DIR
    IMAGE=$IMAGE docker compose up -d
    docker compose ps
  "
  echo "✓ Deployed to $TARGET"
else
  echo "✓ Image pushed to $IMAGE — no remote host specified, skipping SSH deploy"
fi
