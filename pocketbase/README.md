# PocketBase — local backend (dev only, for now)

Thin coordinator for Poker Together: **accounts, room registry, invite codes, and
(later) durable books**. Game state stays P2P — the server does no game
computation (see [../docs/poker-backend.md](../docs/poker-backend.md)). Running
locally only right now; the same binary later moves to the Raspberry Pi (behind a
Cloudflare Tunnel) or a free scale-to-zero host — no code change, just a URL.

## Run

```sh
npm run pb          # downloads the binary on first run, serves 127.0.0.1:8090
```

- REST API: <http://127.0.0.1:8090/api/>
- Admin dashboard: <http://127.0.0.1:8090/_/>
- Local dev superuser: `admin@poker.local` / `pokeradmin123` (local only — never
  used anywhere real).

## Layout

- `run.sh` — portable download + serve (macOS now, linux/arm64 on the Pi later). Committed.
- `pb_migrations/` — schema as code (collections). Committed, so the DB is reproducible. Applied automatically on `serve` startup.
- `pocketbase`, `pb_data/` — the binary and the SQLite data. **Gitignored** (platform-specific / local state).

## Online-play collections (the sequencer)

`1783600000_pk_realtime.js` creates the two collections the online transport uses —
**PocketBase is the sequencer**, so there is no P2P host election:

- **`pk_actions`** — the replicated log. `{ room, seq, body }`. Clients POST entries and
  read them back **sorted by `seq`** (never trust SSE arrival order); SSE is only a
  "go read" nudge, and a reconnecting client catches up with `seq > lastSeen`.
  ⚠️ `seq` is deliberately **not `required`** — PocketBase treats a required number of
  `0` as empty and would reject the first `(deal, seq 0)` entry.
- **`pk_presence`** — heartbeat rows `{ room, peer, name, seat, updated }` (unique per
  room+peer); stale `updated` ⇒ that peer dropped.

Rules are open (play-money; invite codes gate access; deterministic replay + the
chip-conservation check catch bad entries). Verified end-to-end via curl on 2026-07-09.

## Client wiring (not yet — comes with the rooms slice)

The app will read one env var and fall back to public-P2P-only if it's unset or
the server is down:

```
PUBLIC_POKER_API=http://127.0.0.1:8090
```

No PocketBase SDK in the app — plain `fetch` against that base URL, so switching to
the Pi/cloud later is a one-line change.
