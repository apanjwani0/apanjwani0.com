# portfolio-apanjwani0

Personal portfolio dashboard — built with [Astro](https://astro.build) (SSR) and [Oat UI](https://oat.ink).

## Stack

| Layer | Tool |
|---|---|
| Framework | Astro (SSR, `output: 'server'`) |
| Adapter | `@astrojs/node` (Docker/VPS) · swappable to `@astrojs/cloudflare` |
| UI | [Oat UI](https://github.com/knadh/oat) — vendored as flat CSS + JS |
| Config | Runtime JSON files (`data/`) or Cloudflare KV, with TypeScript fallback |
| Admin | Password-protected `/admin` panel — edit all content without a redeploy |

## Run locally

```bash
npm install
npm run dev        # http://localhost:4321
```

Set `ADMIN_SECRET` in `.env` (copy `.env.sample`) to enable the admin panel. Leave it unset to bypass auth in dev.

## Docker

```bash
# Build
docker build -t portfolio:latest .

# Run
ADMIN_SECRET=your_secret docker compose up
```

The `data/` directory is mounted as a volume — content saved via `/admin` persists across restarts.

## Deploy to VPS / cloud registry

```bash
# Build multi-platform image and push
DOCKER_IMAGE=ghcr.io/your-username/portfolio:latest ./scripts/deploy-cloud.sh

# Then deploy to a server
./scripts/deploy-cloud.sh ghcr.io/your-username/portfolio:latest user@your-server
```

## Deploy to Raspberry Pi

```bash
./scripts/deploy-rpi.sh pi@raspberrypi.local
```

## Deploy to Cloudflare Workers

1. Swap the adapter in `astro.config.mjs` (one line — see comment in file)
2. Create KV namespace: `npx wrangler kv namespace create SITE_CONFIG`
3. Add IDs to `wrangler.jsonc`
4. `npx wrangler secret put ADMIN_SECRET`
5. `npm run build && npx wrangler deploy`

## Content

All personal data lives in `src/config/*.ts` — these are the bundled defaults and the git source of truth. In production, `/admin` writes to Cloudflare KV or `data/*.json`; changes take effect on the next request without a redeploy.
