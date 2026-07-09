# Poker Together — autonomous build log

Aman put the build into **autonomous mode** on 2026-07-09 ("run everything
autonomously… take decisions for the user and log them"). This file records every
decision I made on his behalf so they can be reviewed/reverted. A 30-minute
in-session heartbeat monitors and continues the work.

Scope handed over: improve the desktop/web UI (the game was built mobile-first)
and finish slices 4–6 (P2P private rooms, PocketBase auth, audit bot + real-money
acknowledgements). Slices 1–3 (Home, public tables, odds pet) already shipped.

## Decisions

### D0 — Autonomous mode + heartbeat (2026-07-09)
- Enabled autonomous execution; 30-min `ScheduleWakeup` heartbeat re-enters the
  build each cycle, continues the next task, and stops itself when all are done.
- Tracking the four work items as tasks (#1 desktop UI, #2 PocketBase, #3 P2P,
  #4 audit/acks).

### D1 — Execution order (2026-07-09)
- **Order: desktop UI → PocketBase auth (#2) → P2P private rooms (#3) → audit + real-money acks (#4).**
- **Why:** the desktop pass is visible, independent, and improves what already
  ships. PocketBase auth is fully testable locally and is what private rooms hang
  off. P2P is the design-sensitive online-table UX — built with documented
  defaults (below) since Aman opted into autonomous. Audit/acks depend on the
  replicated log/ledger, so they come last.

### D2 — Desktop/web UI (2026-07-09)
- **Kept the phone-first design language** (pure black, top players row, floating
  cards) rather than re-architecting the table into a seats-around-an-oval layout
  — that's a design departure I won't make unilaterally.
- **What changed on ≥768px:** the `<poker-game>` host becomes a centred flex frame
  on a soft dark **radial backdrop** (so the box reads as intentional, not a
  stranded column); Home and Table widen (Home ≤46rem, Table ≤40rem) and their
  cards/type/pot scale up; mode tiles get a capped height so they don't become
  giant. Mobile is untouched.
- **Why:** biggest perceived win for least churn and zero risk to the locked
  design. A fancier 2-column desktop Home is a possible follow-up.

### D3 — PocketBase auth scope + mechanics (2026-07-09)
- **Scope:** slice 5 = **accounts only** (client API seam + signup/login/logout +
  account UI). The server-side **room registry** (invite-code → room) moves to
  slice 4 where invites are actually used — cleaner separation, each slice
  independently testable. `PUBLIC_POKER_API` seam defaults to `http://127.0.0.1:8090`.
- **Username↔email:** default PocketBase `users` rejects username-identity auth, so
  the typed name is mapped to a deterministic hidden email `slug@poker.local`
  (slug = lowercased, non-alnum→`-`). The user only ever sees a "name"; signup
  omits `username` (PB auto-generates) and stores the display name in `name`.
- **Accounts are OPTIONAL, not a hard gate (deviation from the spec's "login
  required for private rooms").** Rationale: the backend is an on-demand
  Raspberry Pi that's usually OFF; hard-requiring login would make private rooms
  unavailable most of the time. Signing in persists your name/rooms across devices
  and (later) books; guests still play. Everything degrades to local/P2P-only when
  the API is unset or down.
- **Verification note:** signup + login + CORS all confirmed against local PB via
  curl; the offline fallback, form validation, account chip and sign-out confirmed
  in-browser. The browser→PB *happy path* could NOT be exercised through the preview
  MCP because its sandboxed browser only has a network route to the exact
  `localhost:4321` preview URL — it can't reach `:8090` (or even `127.0.0.1:4321`).
  On Aman's real machine (same-origin localhost, CORS `*`) it will connect. Not a
  code bug — an environment limit.

### D4 — P2P live sync: scaffold now, defer cross-device sync (2026-07-09)
- **Reordered:** doing slice 6 (audit + real-money acks — fully local + verifiable)
  BEFORE finishing slice 4's live sync. Maximises verified value while I can't
  test P2P here.
- **What ships for slice 4 now:** friends tables get a short **invite code + a
  shareable `?join=CODE` link** on the room screen (safe, visible, no change to the
  verified game loop). The transport (`net-session.ts`, Trystero) and engine
  determinism (`startHand({rng})` + seeded replay) are both ready.
- **What's deferred (needs Aman on 2 devices):** the in-hand action replication —
  routing `deal`/`action` through `session.append` and applying via `onEntry`. I
  won't ship a blind, unverifiable rewrite of the working local loop.
  **Integration plan:** unify local + online behind one `Transport`: a synchronous
  **loopback** transport drives offline play (so the whole log-driven loop is
  locally verifiable) and `createSession` (Trystero) drives online — identical
  loop, transport swapped. deal → `append({kind:'deal', seed, seats, button})`;
  onEntry(deal) → `startHand({..., rng: seededRng(hashSeed(seed))})`; actor →
  `append({kind:'action', seat, action})`; onEntry(action) → `applyAction`. Host
  runs bots + seals seq; joiners submit their own moves.

### D5 — Slice 6: real-money acks + audit books (2026-07-09)
- **Real-money flag** is a private-room host setting. When on, every buy-in/rebuy
  pops an explicit **acknowledgement** ("you acknowledge settling N chips with the
  host offline") before it applies. The platform moves no money — this is just the
  bookkeeping consent the product model calls for.
- **Audit bot** = personified session books: a non-playing panel on the table that
  shows each seat's running net chip delta since sitting down, plus the existing
  hand log. Reuses data already on hand; no new engine state.

### D8 — Transport decision: dedicated backend (PocketBase sequencer), drop P2P (2026-07-09)
- Aman: "if we've decided on a dedicated backend, skip the others — you decide." **Decided: PocketBase as the sequencer; retire the Trystero P2P path.**
- **Grounded in research** (four sourced passes, 2026-07-09): (1) **P2P doesn't avoid a server** — ~15–25% of WebRTC sessions need a TURN relay (symmetric NAT/CGNAT, worse on mobile), so a daily-driver needs coturn or a relay *anyway*; (2) Trystero is well-maintained — its instability is architectural (public tracker + NAT), not neglect, and no other P2P lib is better (PeerJS coasting, simple-peer abandoned, y-webrtc/GUN wrong data model, libp2p/hyperswarm need a relay/aren't browser-fit); (3) **PocketBase Realtime** is a single ARM binary (runs on the Pi we already use), hyper-active (v0.39.6), zero new infra, and its append-only-log + catch-up-by-seq model fits our design; (4) a server sequencer **deletes host-migration and host-discovery entirely** — the exact things that blocked the P2P wiring.
- **Retired now:** removed `net-session.ts` + the `trystero`/`@trystero-p2p/nostr` deps; relocated the transport-agnostic wire types to `net-log.ts` (`LogEntry`/`EntryBody`/`DealConfig`/`SeatSnapshot`/`Peer`/`Transport`). Local loopback play re-verified (dealt, played, clean console); build green. Docs `poker-multiplayer.md`/`poker-backend.md` keep the P2P plan for the record.
- **Implementation notes for the PB transport (from research):** order by our OWN `seq` column, NOT SSE arrival order (PocketBase doesn't guarantee SSE order); SSE is a "something changed, go read" nudge — on connect/reconnect, query `seq > lastSeen` to catch up, then live. Presence = a `presence` collection of heartbeat rows (no native presence). Host-relay model: host writes sealed entries to `actions`; joiners read + write their move; host runs bots/deals.

### D7 — Live P2P, step 1: log-driven loop unification (2026-07-09)
- Aman asked to finish the pending P2P sync. Executed the D4 plan step 1: the game
  loop now runs off an ordered **log** through a `Transport` seam. `deal()` (host
  only) seals a `deal` entry (random seed + seat snapshot + button); `applyEntry`
  is the single place a hand advances (`startHand({rng: seededRng(hashSeed(seed))})`
  for `deal`, `applyAction` for `action`); `advance()` decides who acts (host runs
  bots; `controlsSeat` shows controls for a seat you own). `tick()` deleted.
- **Local play uses a synchronous loopback transport** → the entire sync loop is
  exercised by ordinary offline play. **Verified live:** Practice hand 1 → showdown
  ("You +774") → Next hand → hand 2 → flop, chips conserved (7500), zero console
  errors. So the loop logic is proven; only the Trystero wire (step 2) needs 2
  devices.
- **Step 2 groundwork done + verified:** every `deal` entry now carries its
  `DealConfig` (name/variant/blinds/ante), so `applyEntry` replays from the wire
  alone — an online joiner needs no local Room. Re-verified local play unaffected
  (full hand, chips conserved 7500, clean console).
- **Step 2 STOPPED here deliberately — the rest needs 2 live devices.** Wiring the
  real Trystero session surfaced a genuine protocol gap I won't paper over blind:
  1. **Host discovery.** `net-session.createSession` wants `hostId` (host peer id)
     up front so a joiner can target proposes, but join-by-code only carries the
     *room* code — the joiner can't know the host's `selfId` until presence
     arrives. Needs a host-announce step (host broadcasts "I'm host" on hello, or
     first-peer-is-host), added to net-session's presence.
  2. **Seat assignment.** A joiner must claim an open human seat (heads-up: the one
     `human` seat with index > 0; multi-human needs claim/ack to avoid collisions).
  3. **Joiner Room synthesis.** On the first `deal`, a joiner with no `this.room`
     must build one from `e.config` + `e.seats` so the existing render pipeline
     (buildView/tableSeats/renderTable) works; set `this.mySeat`, `this.online`,
     `this.isHost=false`.
  4. **Entry point.** `goOnline()` (host: lazy-import net-session, createSession,
     set session/online, then deal) + `joinOnline(code)` from the `?join=` link /
     a "Join by code" field on Home.
  These are small and well-scoped against the proven loop + transport seam, but
  each is only *validatable* with two browsers on the tracker — not in this
  sandbox (no WebRTC/tracker/loopback route, single controllable tab). Shipping
  them untested would very likely hide a peer-only bug. Handed to Aman for a
  2-device pass.

### D6 — Desktop, take 2: real dashboard (2026-07-09)
- Aman re-flagged that the web UI still felt phone-first. The first pass only
  widened + framed the mobile column. **Now:** Home is a true **two-column
  dashboard** on ≥900px — left column = bankroll + the two action tiles + name;
  right column = public tables (a 2-up card grid, no scroll) + your tables. One
  small HTML change (wrap the body in `pk-home-body` → `pk-home-main`/`pk-home-side`,
  tag the two table sections `data-kind`), the rest is a `@media (min-width:900px)`
  grid. Mobile still stacks (flex column) — verified.
- **Left the table screen a centred column** (widened + bigger cards): a centred
  card table is the defensible poker layout, and the DOM groups hero cards + odds
  in one node, so a CSS-only side-rail would fight the markup. Not worth the churn.
