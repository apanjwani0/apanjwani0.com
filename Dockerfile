# syntax=docker/dockerfile:1

# ── Stage 1: build ────────────────────────────────────────────────────────────
# node:22-alpine, pinned by digest (15 Nov 2026) so a moved tag cannot change what ships.
# To update: read the new digest (docker buildx imagetools inspect node:22-alpine), change both lines.
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS runtime
WORKDIR /app

# Copy built output and production dependencies only
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev

# data/ is mounted as a volume at runtime — JSON config written by /admin
# persists here across container restarts and image upgrades.
# uid/gid 1001 = the host user that owns /opt/portfolio/data (the Actions runner's
# user). Unpinned, adduser picked uid 100 and every write to data/ failed with EACCES.
RUN addgroup -S -g 1001 portfolio \
  && adduser -S -u 1001 -G portfolio portfolio \
  && mkdir -p data \
  && chown -R portfolio:portfolio /app

EXPOSE 4321
ENV HOST=0.0.0.0
ENV PORT=4321
ENV NODE_ENV=production
# Slow name lookups (dns.lookup) occupy libuv's 4 default threads and stall file reads and
# crypto behind them; 16 leaves headroom. The visitor-typed names go through c-ares instead.
ENV UV_THREADPOOL_SIZE=16

USER portfolio

# Boot this image's own server once before it can ship (AGENTS.md → Build /
# Test / Run). Here, not in the builder, so it runs the production-only
# dependency tree as the user the container runs as; a server that cannot
# start fails the image build while the old container keeps serving.
COPY --chown=portfolio:portfolio scripts/boot-check.mjs ./scripts/boot-check.mjs
RUN node scripts/boot-check.mjs

CMD ["node", "dist/server/entry.mjs"]
