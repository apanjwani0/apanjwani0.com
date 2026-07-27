# Poker Together — backend (free, portable, Pi-on-demand)

## Principle: the backend is thin because the game is P2P

Game state is the **replicated action log** (see [poker-multiplayer.md](./poker-multiplayer.md)) —
every peer holds it, play happens peer-to-peer, bots and the odds "pet" run on the
client. So the server does **no game computation**. It only needs to:

| Needs a server | Stays P2P / client-only |
|---|---|
| Accounts (username+password) to create private rooms | All gameplay + the action log |
| Room registry (list, invite codes, share links) | Bots, the odds pet, equity, timers |
| Durable books: pin the audit log / ledger when *all* peers leave | Live audit log (a peer holds it) |
| (optional later) self-hosted WebRTC signaling | Signaling — public trackers for now |

Because it's idle almost always, it fits **scale-to-zero** hosts and a **low-power
Raspberry Pi** perfectly. And nothing *needs* it to just play: with the backend
asleep/off, the app still serves the 5 public rooms purely P2P (hardcoded fallback
list) — graceful degradation. The server only unlocks accounts + durable private
rooms + persistent books.

## Recommended stack

**Backend = [PocketBase](https://pocketbase.io/)** — one Go binary = SQLite +
email/username-password auth + REST + realtime WebSocket + admin UI, ~50–100 MB RAM,
zero dependencies. The *same binary + same SQLite file* runs on the Pi and on any
cloud, so there's no lock-in and "move it" = copy one file. Auth and a `rooms`
collection cover our needs out of the box; realtime can later carry signaling.

**Two interchangeable homes for that one binary (pick per moment):**

1. **On the Raspberry Pi, exposed on-demand via [Cloudflare Tunnel](https://www.cloudflare.com/products/tunnel/)**
   — free for personal use, stable hostname + HTTPS + DDoS, **no open ports / no
   port-forwarding** (`cloudflared` dials out). This is the "runs on my Pi
   on-demand" path: start `pocketbase serve` + the tunnel when you want to host;
   stop them and the app falls back to public P2P. (Tailscale *Funnel* is the
   alternative but is weaker for public hosting: no custom domain, 3-funnel cap,
   only ports 443/8443/10000 — better for private access than publishing.)
2. **On a free scale-to-zero cloud** (when the Pi is off): **Koyeb** free instance
   (0.1 vCPU / 512 MB, scales to zero after 1 h) or **Render** free web service
   (spins down after 15 min, 30–60 s cold start). Same binary, restore the SQLite
   file. ⚠️ Fly.io's free tier **ended in 2024** (trial only now) — don't plan on it.

**Signaling = keep Trystero's public trackers** for now (zero infra). Self-hosting
signaling on PocketBase realtime is a later option if the public trackers get flaky —
a one-module swap, doesn't change anything else.

## Portability contract (so "move it" is one setting)

The client talks to the backend through a **single base URL**
(`PUBLIC_POKER_API`) and **plain `fetch`** (not a cloud SDK). Switching between
Pi-tunnel and cloud is one env var. This mirrors the repo rule that
`astro.config.mjs` is the only deploy-specific file — no backend-specific code leaks
into the app. If `PUBLIC_POKER_API` is unset or unreachable, the client runs in
"public P2P only" mode (no login, no private rooms) — the game still plays.

## Security (exposing a Pi to the internet is a real surface)

- Run PocketBase as a **non-root user**, ideally in a container/systemd unit with a
  restart policy; tunnel **only** the PocketBase port — never SSH.
- Put the **admin UI behind Cloudflare Access** (free, up to 50 users) so only you
  reach `/`_`/admin`.
- Keep `cloudflared` + PocketBase updated; back up the SQLite file.
- The platform still touches **no real money** — the "real money" room flag only
  gates an acknowledgement step; books are play-chip bookkeeping.

## Phasing (when each piece is actually needed)

1. **Now / next slices:** none. Public rooms + local + P2P private rooms (invite
   link) work with zero backend.
2. **When private rooms must persist across sessions / need real accounts:** stand up
   PocketBase (Pi or Koyeb), add `PUBLIC_POKER_API`, wire auth + `rooms` collection.
3. **When "all peers left" durability / audit history matters:** add a `ledgers`
   collection; peers push signed log snapshots; server just stores them.

Net: one ~15 MB binary you can run on a Pi behind a free tunnel, move to a free
cloud when the Pi sleeps, and delete entirely without breaking public play.

Sources: [PocketBase](https://pocketbase.io/) ·
[Cloudflare Tunnel vs Tailscale/ngrok 2026](https://insights.nomadlab.cc/blog/2026/04/tailscale-vs-cloudflare-tunnel-vs-ngrok-2026) ·
[Koyeb free tier 2026](https://www.srvrlss.io/provider/koyeb/) ·
[Fly.io free tier ended — alternatives 2026](https://expresstech.io/7-fly-io-alternatives-in-2026-real-pricing-after-the-free-tier-died/)
