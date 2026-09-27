# syntax=docker/dockerfile:1

# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# Copy built output and production dependencies only
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev

# data/ is mounted as a volume at runtime — JSON config written by /admin
# persists here across container restarts and image upgrades.
RUN addgroup -S portfolio \
  && adduser -S portfolio -G portfolio \
  && mkdir -p data \
  && chown -R portfolio:portfolio /app

EXPOSE 4321
ENV HOST=0.0.0.0
ENV PORT=4321
ENV NODE_ENV=production

USER portfolio

# Boot this image's own server once before it can ship (AGENTS.md → Build /
# Test / Run). Here, not in the builder, so it runs the production-only
# dependency tree as the user the container runs as; a server that cannot
# start fails the image build while the old container keeps serving.
COPY --chown=portfolio:portfolio scripts/boot-check.mjs ./scripts/boot-check.mjs
RUN node scripts/boot-check.mjs

CMD ["node", "dist/server/entry.mjs"]
