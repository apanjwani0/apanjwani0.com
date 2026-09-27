# Ideas / backlog

Not committed to, not scheduled. Delete an entry when it ships or when it stops
being a good idea.

## Leaderboards on scoring games

A leaderboard **section inside** a game page (2048 first), not a separate page.
Only 5 of the 12 wired games produce a rankable number — 2048, quintle,
type-trial, hue-hunt, maze-weaver. The rest (game-of-life, flow-field,
starfield-toy, murmuration, turing-bloom, sand-loom, lsystem-tree) are
screensavers with no win condition, so there is nothing to rank.

**Storage: `node:sqlite`**, stdlib since Node 22 and the Docker image is
`node:22-alpine`, so no new dependency. One file at `data/leaderboard.db` on the
same bind mount as `visits.json`. Table `(game, period, name, score, created_at)`,
index on `(game, period, score DESC)`, delete below rank 100 on insert to bound it.

Do **not** reuse the `visits.json` pattern. That design is right for analytics and
wrong here: whole-file read-modify-write has a lost-update race, and the 4 MB
`serializeBounded` backstop drops the oldest data — correct for counters, silent
data loss for scores.

**The page shape is forced by the edge cache.** `/games/2048` is served with
`s-maxage=600`, so a server-rendered board would be frozen for ten minutes and
shared across every visitor in the colo. The section must fetch
`/api/leaderboard/<game>` client-side, from inside an `astro:page-load` listener
(ClientRouter is on — see AGENTS.md). `/api/*` already gets `no-store` from
middleware, so the headers are correct without new code.

Deferred, and none of these change the table shape:
- **Replay verification** — submit `{seed, inputs[]}` instead of a score and
  re-run the engine server-side, so a fake run has to be a real run. 2048 is
  deterministic given the spawn seed, so this stays available. Without it,
  `curl -d '{"score":999999}'` is the whole attack; label it "high scores", clamp
  to a plausible max, and rate-limit with `createRateLimiter()`.
- **Daily seed** — everyone gets the same board that day, which makes scores
  comparable and gives the server a known seed to verify against.
- **Names** — 3-letter arcade initials `[A-Z]{3}`. Bounded, no moderation queue,
  no accounts, nothing personal retained.
- **Cloudflare D1** — the equivalent if the site ever moves to Workers. Not a
  reason to move; Durable Objects only earn their keep once replay verification
  exists.
