# Learnings: how the internet works

Approved by the owner on 2026-09-30: the hop-by-hop shape and the eight
figures below. The topic grows out of the retired "internet" story of the home
hero (its code is in git history, `e3317b4`). The owner's message cut off at
"how the internet works and or…", so the title is not final.

Binding: `docs/plans/learnings-voice.md` (350–550 words of prose, short lines,
a visual beat every one to three lines, no LLM tics), plus the 2026-09-30 rule
for all site copy: plain, simple, explanatory sentences a beginner can follow.
No clipped or clever one-liners.

## Shape

Second person: follow one click from pressing Enter to the page appearing, one
stop at a time. Each stop is a short section with its own pinned figure view.
The reader should finish able to name the parts: packet, IP address, router,
ISP, DNS resolver, root and TLD servers, BGP, data centre, TCP, TLS, HTTP.

Opener, a person doing something specific: Charley Kline at UCLA on 29
October 1969, typing "login" to a computer at SRI, which crashed after "lo".
Verify the details (the time, Leonard Kleinrock's lab, Bill Duvall at SRI)
before writing it.

## Figures

All eight are views of one article-only figure, `internet-atlas`: inline SVG
like `diagram-atlas`, so its labels are selectable, and every view has a full
legend. A view that shows movement animates (and stops under reduced motion);
a view that shows structure does not.

1. `packets`: the page cut into numbered packets, each with an address label.
2. `addresses`: your devices behind one router, sharing one public IP address.
3. `dns`: resolver → root → `.com` → the site's own name servers, with the
   answer cached on the way back.
4. `routes`: your ISP handing packets across other networks, and a new route
   when a link is cut.
5. `edge`: one address answered by many data centres, including the owner's
   own request from India landing in Marseille.
6. `handshakes`: TCP's three-way hello, then TLS agreeing on a key.
7. `http`: the browser's request (`GET /`) and the server's answer
   (`200 OK` plus the HTML).
8. `reassembly`: packets arriving out of order, a lost one sent again, and the
   page drawn.

## Wiring checklist (from AGENTS.md)

- `src/components/games/internet-atlas/`: `atlas.ts` holds the claims (views,
  elements, beats, legends), `InternetAtlas.ts` the custom element, and
  `internet-atlas.css` its styles.
- `EMBED_TAGS` in `src/lib/embeds.ts`, `EMBED_NO_CHROME` if it writes no
  chrome, a `mountGame()` branch in `src/lib/game-mount.ts`, and an `@import`
  in `src/styles/games-embed.css`.
- A learnings entry in `src/config/learnings.ts` (slug, title, summary, date,
  content, embed, embedCaption, published, seoTitle, metaDescription,
  keywords), with `{{embed:view}}` markers where each figure belongs.
- `security:smoke`: mirror the `diagram-atlas` assertions (every view has a
  legend, every beat lights an element that exists, tokens stay inside the
  viewBox), check every shipped marker against the view list, and recompute
  any number the article quotes, in every field that repeats it.
- `npm run og` for the share card. The read time is derived.
- Check facts before they go in; where the record is contested, say so.
