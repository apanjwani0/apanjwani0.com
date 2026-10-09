# Home hero

The home page has one hero, `src/components/home/hero/network.ts`. It replays
**this** page load, slowed down, as a metro line of stations over a drifting
starfield: your device, your network, the ISP, DNS on a branch, Cloudflare's
data centre (by city) and the server. A frame at the top left says what it
shows, and a chat-like log at the bottom right tells each step with its real
timing. The owner picked it on 2026-09-30 and retired the dev switch, the
classic hero and the "how the internet works" story, whose topic is now a
learnings article. The frame, the name block and the log are the keepers; the
line itself may be swapped later through the same contract.

- **Real data only, never a sample** (owner, 2026-09-28). The replay reads
  Navigation Timing, `/cdn-cgi/trace` (country, data centre, TLS) and one HEAD
  of `/` (whether Cloudflare's copy predates the visit, from its `age`). The
  click-to-ping times a GET of `/cdn-cgi/trace`, which the data centre answers
  itself, so a ping is the edge round trip and never an origin render. A fact
  it cannot measure is left out: the ISP station carries no number, because
  nothing times that hop apart from the rest. On the dev server the page comes
  from localhost, so `/__hero-probe` (dev-server middleware in
  `astro.config.mjs`, loopback only) measures one real request to the live
  site instead.
- **Never the host**: no provider, runtime or anything else about the origin,
  which is what helps someone reach it around Cloudflare. The visitor's own
  address appears only as its first two groups, and is never kept.
- **Every stop explains itself** on hover, focus or tap, for someone who has
  never heard of DNS: a card says what the stop is and what it did on this
  visit (measured, or nothing), the stop is spotlit, and it acts out its own
  leg of the trip. A pointer must rest on a stop briefly, so one crossing the
  line opens nothing. Acting out waits for the replay and pings to finish and
  never runs under reduced motion.
- **Plain, explanatory copy** (owner, 2026-09-30): full, simple sentences a
  beginner can follow, in the frame, the log and the cards alike. No clipped
  one-liners or clever phrasing.
- **Nothing blinks or pulses.** The status lights stay lit, the spotlight's glow
  is steady and its veil eases in and out. The stars' slow twinkle is the only
  brightness driven by the clock (asserted in the script and the stylesheets);
  they drift at 14 px/s, and there are 115% as many, 15% brighter, as the first
  sky (`SKY_INTENSITY`, owner 2026-10-01).
- **A short screen scrolls**, at any width: a phone either way up, or a short
  laptop window. When the frame, the line and the text block cannot share one
  screen, the hero grows taller rather than squeezing the line into the name;
  a line still too short drops its sub-lines before any label.
- **It reads line, log, name** (owner, 2026-10-02). On a laptop the log sits at
  the bottom right. On a phone, or when the name needs the width, it joins the
  text block and shows above the name through CSS `order`, so the markup keeps
  the h1 first.
- **Text is server-rendered.** The page renders the h1, tagline and social
  links; the hero reads them through `env.text` and never draws its own copy.
  The section carries `data-theme="dark"` because the canvas is dark, and the
  page passes `starfield={false}` because the hero draws its own stars.
- **The contract** is `src/components/home/hero/types.ts`: `create(host, env)`
  returns `{ start, stop, resize, destroy }`. `mount.ts` is the only caller. It
  loads the hero as its own chunk, mounts on `astro:page-load`, destroys on
  `astro:before-swap`, and runs the hero only while the tab is visible and the
  stage is on screen. Every document or window listener the hero adds takes
  `env.signal`. Styles: `home.css` plus `hero-network.css`.
- **No tools or games in the hero** (the owner's rule): not in the copy, not as
  a link or a hover affordance, not even by name. The site nav keeps "tools"
  and "games" for search reach, and the meta description still lists them.
  The nav drops its wordmark on `/` (owner, 2026-10-02): it links home.
- **Looping motion is allowed here and in the hubs' sky, nowhere else.** It
  still stops when the hero is hidden or off screen, and renders the finished
  replay as one still frame under `prefers-reduced-motion`.

`security:smoke` holds the page to one hero with no switch and no query string,
every child of the hero's text block above the scrim (read from the markup),
no clock-driven oscillation outside the stars' twinkle and no endless CSS
animation, a resize that redraws at once, the hero to no tools or
games (the tagline, the section markup, and every string
literal and stylesheet the hero ships), `network.ts`'s strings to no host or
runtime name, the dev hooks (`location.search`, `/__hero-probe`) to the DEV
gate, the probe to loopback-only dev middleware, and the hero to its own chunk.
