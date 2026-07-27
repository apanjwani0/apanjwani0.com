# Poker Together — design language & asset system

The visual direction for the poker game, distilled from Aman's reference
screenshots (a minimal social-poker app: typography-as-UI setup screens, a
card-forward table, a bankroll-first home). We take the *simplicity*, not the
pixels — our identity is different where noted.

## Product stance (2026-07-09)

**The game is the product; the portfolio is the publisher.** Poker lives at its
normal slug inside the portfolio, but a player must never feel the portfolio:

- No site header/nav/name chrome on the game page — the game owns the full
  viewport, especially on mobile. Someone who bookmarks the game may never see
  the portfolio again, and that's fine.
- One quiet escape hatch ("built by …" / about-the-developer) that never
  interferes with play.
- Built for **daily players**: fast to open, zero questions before playing.

### Product model (ideation capture, to be refined)

- **Rooms.** A room = a session/group; exactly one table plays in it. Each room
  has one game type. **5 public rooms** with fixed types (Hold'em, Omaha, …);
  **private rooms** are user-created (requires simple username+password login)
  and joinable by invite code or share link.
- **Public rooms = quick play.** Bots keep every public table alive; a joining
  human lands "mid-session" into a running game. Humans can meet there too — if
  the table is short of people, say so and backfill with bots.
- **Bot transparency.** Every bot seat wears a `BOT` tag. Humans are untagged.
- **Room bots (non-playing).** e.g. an *audit bot* seat that keeps the table's
  complete history — every action, every pot — as the room's books. (This is the
  Phase-B replicated log given a friendly face.)
- **Personal bot / "mini pet".** A player can bring a private odds companion
  that reads ONLY public info + its owner's hole cards (never other players'),
  and whispers live equity ("26% for two pair"). Others see *that* you have a
  pet, never what it says. Gamified as a pet. (This is the live-equity box,
  productized.)
- **Simple onboarding.** The current create-table form asks too many questions —
  public rooms need zero, private rooms get sensible defaults + a host settings
  sheet (bots allowed, stakes, game type…).
- **"Real money" room flag.** If the host marks a private room real-money, every
  buy-in/rebuy requires an explicit acknowledgement step, tying the table's
  books to the real-life ledger. (Platform still handles no money — it's the
  money-persistent bookkeeping from the multiplayer plan.)

## Design language

- **Pure black, no felt.** The table is empty space; white cards float on it.
  No ovals, no green baize, no decoration that isn't information.
- **Everything is a card.** The signature move: playing-card shapes carry UI
  meaning — game-mode tiles on the home screen are tilted white cards, the
  face-down slot is a card back, the result box borrows card geometry. Where
  the references use gradient rectangles, we use our own cards.
- **Typography is the UI.** Configuration reads as a poster: small mono label
  (`BLINDS`, `BUY-IN`), then the value huge — mint `#37d39b` for stakes/positive,
  ink red `#f0473b` for money-at-risk/negative. Sliders are tick-rulers, not
  thumbs-on-tracks.
- **Opacity encodes turn.** Seats are a row of avatar heads; the actor is full
  brightness, everyone else dims. Folded ≈ 30%. No borders, no boxes.
- **State accents:** green shrinking-pie turn timer above the actor; gold bet
  pills under committed seats; `D`/`SB`/`BB` disc markers; winner gets the
  result box (hand name · avatar · +amount) — the same box that shows live
  equity mid-hand.
- **Big pill CTAs.** One solid-white primary per screen ("Deal in"); everything
  else is a thin-outline ghost pill. Lock glyph marks private tables.
- **Honesty badge:** `play-money` sits next to the wordmark on the home screen.

Screens designed so far (mockup artifact, session scratchpad): **Home**
(wordmark + chips bankroll + mode cards + week's ± ledger), **New table**
(blinds/buy-in poster + tick ruler + seat row + private/deal pills), **Table**
(turn / raising / showdown states).

## Asset system — single source, referenced everywhere

Every image in the game is generated from one module family under
`src/components/games/poker/ui/` — pure vector SVG, sized by the container
(CSS width), never regenerated to resize, re-themeable from a few ink consts:

| Module | Exports |
|---|---|
| `cards-svg.ts` | `cardSvg(card)` (52 faces, viewBox 0 0 60 84) · `cardBackSvg(id)` + `CARD_BACKS` (6 designs) · `suitSvg(suit)` · `RED_INK`/`DARK_INK`/`ASSET_FONT` |
| `assets-svg.ts` | `chipSvg(v)` + `CHIP_VALUES` · `chipStackSvg(v, n)` · `buttonSvg('D'\|'SB'\|'BB')` · `avatarSvg(i)` · `openSeatSvg()` · `timerPieSvg(pct)` · `iconSvg(name)` · `crownSvg()` · `wordmarkSvg()` · `REACTIONS` |
| `catalogue.gen.ts` | dev tool — renders the visual catalogue *from* the modules |

**The rule:** change an asset in its module and it updates everywhere — the
game imports these functions; nothing copies the markup. The browsable
catalogue is generated, never hand-edited:

```sh
npm run poker:catalogue   # → docs/poker-assets.html (gitignored, regenerate at will)
```

Conventions: hand-authored vector paths for suit pips (no font dependency);
`ASSET_FONT` is the single text face; SVG `<pattern>` ids are namespaced per
variant (`pkb-<id>`) so designs coexist on one page; game DOM uses
`data-type="pk-*"` attributes, never bare classes (a `.back` class collision
already bit us once).

## Locked decisions (2026-07-09)

1. Table renders as **DOM** (the canvas renderer retires when the new table lands).
2. One look for **both** local hotseat/bots and online play.
3. **Live equity box on by default**, with a per-player toggle.
4. Seat avatars come from the built-in `avatarSvg` set (emoji upgrade later).
5. Profile stats sheet (VPIP/PFR/…) is **parked** — needs hand-history first.

Multiplayer architecture lives in [poker-multiplayer.md](./poker-multiplayer.md).
