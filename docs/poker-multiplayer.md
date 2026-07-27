# Poker Together — real multiplayer plan

Status: **planning only.** No multiplayer code exists yet. Today the game is
local: `rooms.ts` persists to `localStorage` and syncs tabs with
`BroadcastChannel('poker')` — same browser only. This doc is the build plan for
turning it into a **money-persistent, peer-replicated** online game where the
host leaving does not end the game.

## The one insight everything rests on

The engine is already a **pure deterministic reducer**:

```
startHand(opts) -> GameState
applyAction(state, action) -> GameState      // no I/O, no randomness read at apply time
legalActions(state) -> ActionRequest | null
```

Same starting state + same ordered list of actions → **bit-identical** table on
every machine. So we never replicate the *state* ("Google Docs sync of a big
JSON blob", which is where conflicts and cheating live). We replicate the
**ordered action log**, and every peer replays it locally. State is derived, the
log is the truth.

This means the whole feature decomposes into four independent seams, each
shippable on its own:

| Phase | What it adds | Ceiling if we stop here |
|-------|--------------|--------------------------|
| A. Transport | actions reach other people's browsers | trust the sequencer's ordering |
| B. Replicated log | one agreed order, survives host leaving | trust peers not to forge actions |
| C. Fair shuffle | nobody (not even the dealer) knows the deck | — |
| D. Money ledger | books tally even for players who left | — |

Build them in order. Each phase is useful before the next exists.

---

## Phase A — Networked transport (lightest first)

**Goal:** an action taken in one browser shows up in the others.

**Recommended start: serverless WebRTC (Trystero), not a relay.**

The end goal is peer-to-peer ("no central server holds the game"). A hand-rolled
WebRTC mesh means STUN/TURN, ICE, NAT traversal, and a signaling handshake — genuinely
not "a few lines". [Trystero](https://github.com/dmotz/trystero) is a ~tiny, zero-own-deps
library that does exactly that handshake for us and then opens **direct peer-to-peer**
data channels. Game data never touches a server — only the initial "find each other"
step uses public infra (a Nostr/BitTorrent/MQTT tracker), and that's swappable.

```
peer ──WebRTC data channel──> peer      (game log flows directly, encrypted, no server)
   \__ tracker (signaling only, public) __/   ← peers discover each other, nothing else
```

Why this over a Cloudflare Durable Object relay:
- **Faithful to the vision** — a relay *is* a central server (even a dumb one);
  Trystero is true P2P, which is what "all peers hold the ledger" means.
- **Lazier** — `npm i trystero` + ~40 lines vs. a separate Worker deploy, `wrangler`
  config, and a Workers plan. Nothing touches `astro.config.mjs` (the only
  deploy-specific file stays that way).
- **Testable now** — two browser tabs are two peers; they connect and sync locally.

New module `src/components/games/poker/engine/net-session.ts`: joins a Trystero room
keyed by the poker room id, exposes `broadcast(entry)` + `onEntry(cb)` + presence, and
owns the replicated action log. `Poker.ts` keeps its local hotseat path unchanged;
"online" is an additive per-room mode that drives the table from the log instead of the
local `tick()` loop.

> ponytail: the tracker is public infra — a *liveness* dependency for the handshake,
> not a *truth* dependency (the signed log in Phase B is the source of truth, and data
> is P2P-encrypted). Upgrade path if public trackers prove flaky: point Trystero at a
> self-hosted signaling endpoint (a tiny Cloudflare Worker) — a one-module change, B–D
> don't care.

**Done when:** two browsers on different machines see each other's folds.

---

## Phase B — Replicated append-only log (host can leave)

**Goal:** one agreed order of actions, and the game outlives whoever started it.

Each entry:

```ts
interface LogEntry {
  seq: number            // global order (assigned by current sequencer)
  roomId: string
  actor: string          // seat/player id
  action: Action         // the exact thing fed to applyAction()
  prevHash: string       // hash of entry seq-1  → tamper-evident chain
  sig: string            // actor signs (action + prevHash) with their keypair
}
```

- **Ordering:** the sequencer (initially the host) assigns `seq`. Cheap and
  simple. Because ordering is the *only* thing the sequencer controls — it can't
  forge a signed action or alter state — a malicious sequencer can at worst
  reorder/withhold, which is detectable (gaps in `seq`, stalled clock).
- **Host migration (the requested feature):** the log *is* the game. If the
  sequencer drops, peers run a tiny deterministic election (lowest connected
  player id, or next seat) and that peer continues assigning `seq` from the last
  entry it has. No state transfer — everyone already has the full log. **The host
  leaving is a non-event.**
- **Tamper-evidence:** `prevHash` + per-actor signatures make the log an
  append-only hash chain. Any peer replaying it verifies every signature and the
  chain; a forged or edited history fails verification. This is the "tamper-audit
  add-on" — it falls out of the log design for free, no separate system.
- **Identity:** generate an ECDSA/Ed25519 keypair per player in the browser
  (`crypto.subtle`), persisted in `localStorage`. Public key = player id. No
  accounts, no login.

**Reuse what's proven:** replay feeds `applyAction`, and after every hand we run
the existing **chip-conservation check** (`engine.selfcheck.ts`: Σ stacks + Σ
pots is invariant). If any peer's replay violates conservation, that peer has a
divergent/forged log — surface it, don't silently continue.

**Done when:** host closes their tab mid-hand and the table keeps playing.

---

## Phase C — Provably-fair shuffle

**Goal:** the deck order is fixed before play and **no single party knew it**,
including the dealer. Prevents "the host can see everyone's cards."

**Start: commit-reveal collaborative shuffle** (simplest scheme that is actually
fair):

1. Each player picks a random 256-bit seed, broadcasts `hash(seed)` (commit).
2. After all commits are in, each reveals their `seed`.
3. Everyone checks the reveals against the commits, then
   `deckSeed = XOR(all seeds)` seeds a deterministic shuffle
   (Fisher–Yates over the existing `cards.ts` deck).

Because the seed mixes every player's contribution and commits are locked before
any reveal, no one can bias the deck and no one predicts it until all reveals
land. The shuffle itself is deterministic, so it becomes just more entries in the
Phase-B log — every peer derives the identical deck and it's auditable after the
hand.

> ponytail: commit-reveal proves *fairness of order* but the deck is public after
> reveal, so it can't hide a player's hole cards from a peer who is willing to
> read the log mid-hand. For a friendly-money game among friends that's usually
> fine. Upgrade path if you need true secrecy: full **mental poker** (commutative
> encryption — each player encrypts the deck in turn, cards decrypt only for their
> owner). Much heavier; add only if hole-card secrecy against curious peers
> becomes a real requirement.

**Done when:** post-hand, any player can verify the deck came from all seeds and
was not chosen by the dealer.

---

## Phase D — Money-persistent books

**Goal:** the room's books always tally — total chips are conserved across
hands, buy-ins, cash-outs, **and players who left mid-session** — so friends can
peg chips to real money with zero extra trust.

A separate **double-entry ledger** (distinct from per-hand chip conservation),
also append-only entries in the Phase-B log:

```
buy-in    Alice +1000     (house -1000)
cash-out  Bob    -1500    (house +1500)   // Bob leaves; his seat empties, book stays
```

Invariant, checkable by any peer at any time:

```
Σ(buy-ins) − Σ(cash-outs) == Σ(chips currently on the table)
```

- A player leaving = a `cash-out` entry recording their stack; their debt/credit
  is now permanent in the ledger even though their seat is gone. Nobody's money
  evaporates.
- The per-hand conservation invariant (Phase B) guards *within* a hand; this
  ledger guards *across* the whole session. Together they close the loop: no
  chips created or destroyed at any timescale.
- Settlement report: at session end, replay the ledger → net position per player.
  Because it's signed and hash-chained, the report is auditable and no one can
  quietly rewrite who owes whom.

**Done when:** a player buys in, plays, leaves, and the closing report still
balances to the cent.

---

## Build order & checks

1. **A** — `net-rooms.ts` adapter + Durable Object relay. Two browsers, same table.
2. **B** — signed hash-chained log + host migration. Reuse `engine.selfcheck` per hand.
3. **C** — commit-reveal shuffle as log entries.
4. **D** — double-entry ledger + settlement report.

Every phase keeps `npm run build` green and leaves one runnable check behind
(extend `engine.selfcheck.ts`: log replay determinism in B, deck reproducibility
in C, ledger balance in D). Ship A before starting B — a networked hotseat is
already better than what exists.

## What we are *not* building (and why)

- **Authoritative game server** — the engine is deterministic; a server that
  recomputes state would just be a second implementation to keep in sync. The log
  + local replay is less code and more auditable.
- **CRDT / OT merge** — there is exactly one shared structure (an append-only,
  totally-ordered log). Append-only + a sequencer needs no conflict resolution.
  We'd only need CRDTs for concurrent edits to shared *state*, which we don't have.
- **A central relay / authoritative-order server** — a Durable Object fan-out would
  work, but it reintroduces the central server the vision rejects. Trystero gives true
  P2P for less setup. If public trackers get flaky, self-hosting *signaling only* (not
  the game) on a tiny Worker is an A-only change; the log stays transport-agnostic.
