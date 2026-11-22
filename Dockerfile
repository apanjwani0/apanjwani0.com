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

# data/ is mounted as a volume at runtime — JSON config written by /admin
# persists here across container restarts and image upgrades.
# uid/gid 1001 = the host user that owns /opt/portfolio/data (the Actions runner's
# user). Unpinned, adduser picked uid 100 and every write to data/ failed with EACCES.
RUN addgroup -S -g 1001 portfolio \
  && adduser -S -u 1001 -G portfolio portfolio \
  && mkdir -p data \
  && chown portfolio:portfolio /app data

# Everything below runs as the container's user and copies with --chown, so no
# file is ever chowned afterwards (a recursive chown writes a second copy of every file
# into a new layer). Production dependencies come before the build output: this
# layer changes only with the lockfile, so a deploy that changes only source
# reuses it. The user has no home, so npm's cache goes to a temp dir, removed in the same step.
USER portfolio
COPY --chown=portfolio:portfolio package*.json ./
RUN npm ci --omit=dev --cache /tmp/npm-cache && rm -rf /tmp/npm-cache
COPY --from=builder --chown=portfolio:portfolio /app/dist ./dist

EXPOSE 4321
ENV HOST=0.0.0.0
ENV PORT=4321
ENV NODE_ENV=production
# Slow name lookups (dns.lookup) occupy libuv's 4 default threads and stall file reads and
# crypto behind them; 16 leaves headroom. The visitor-typed names go through c-ares instead.
ENV UV_THREADPOOL_SIZE=16

# Boot this image's own server once before it can ship (AGENTS.md → Build /
# Test / Run). Here, not in the builder, so it runs the production-only
# dependency tree as the user the container runs as; a server that cannot
# start fails the image build while the old container keeps serving.
COPY --chown=portfolio:portfolio scripts/boot-check.mjs ./scripts/boot-check.mjs
RUN node scripts/boot-check.mjs

CMD ["node", "dist/server/entry.mjs"]
