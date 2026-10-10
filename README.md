# portfolio-apanjwani0

The source of [apanjwani0.com](https://apanjwani0.com): a server-rendered
[Astro](https://astro.build) site with its own lightweight design system
(vendored [Oat](https://oat.ink) is the base layer), with browser tools and
games. The rules for working in it are in [AGENTS.md](AGENTS.md); the longer docs
are indexed in [docs/README.md](docs/README.md).

## Run locally

Node 22.12 or newer.

```bash
npm install
npm run dev        # http://localhost:4321
```

Content lives in `src/config/*.ts`. The dev server's `/admin` page edits those
files; commit them to publish. `/admin` does not exist in production. Leave
`ADMIN_SECRET` unset for an open local `/admin`, or set it in `.env` (see
`.env.sample`) to require a password.

## Before committing

The gate (details in AGENTS.md):

```bash
npm run build && npm run check && npm run security:smoke && npm run poker:check && npm run boot:check
```

## Deploy

A push to `main` builds the Docker image (pushed to GHCR) and restarts the
container on the production host, an OCI VM behind Cloudflare, through a
self-hosted runner (`.github/workflows/deploy.yml`). Work lands on `develop`
first and reaches `main` by PR. `data/` is a mounted volume holding analytics
counts and the daily leaderboards.

Other targets:

- **Any Docker host**: `docker build -t portfolio:latest . && docker compose up`
- **A VPS through a registry**:
  `DOCKER_IMAGE=ghcr.io/<user>/portfolio:latest ./scripts/deploy-cloud.sh`, then
  `./scripts/deploy-cloud.sh <image> user@host`
- **Raspberry Pi**: `./scripts/deploy-rpi.sh pi@raspberrypi.local`
- **Cloudflare Workers**: swap the adapter in `astro.config.mjs`, run
  `npx wrangler kv namespace create SITE_CONFIG`, add its id to
  `wrangler.jsonc`, then `npm run build && npx wrangler deploy`. Link Peek and
  Chainsaw use Node sockets and would need another transport there.
