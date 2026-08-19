export interface Project {
  title: string
  url: string
  description: string
  tags: string[]
  keywords?: string
}

export const projects: Project[] = [
  {
    "title": "apanjwani0.com",
    "url": "https://apanjwani0.com",
    "description": "This site, and the largest thing here. Astro in full SSR on a standalone Node adapter, in Docker on an Oracle Cloud VM, behind Cloudflare.\n\nThe interesting parts are operational: HTML is edge-cached with `s-maxage` while `max-age=0` keeps it out of browser caches so an edit is always purgeable; the origin only answers requests carrying a shared secret injected by a Cloudflare Transform Rule; analytics are aggregate-only and store no IPs, so there is no consent banner to show. Deploys build an image on `main` and restart the container from a self-hosted runner.\n\nThe security and cache invariants are asserted rather than documented — `security:smoke` covers the code, `origin:check` makes unauthenticated requests to production and asserts what a stranger actually sees.\n\n[Source](https://github.com/apanjwani0/portfolio-apanjwani0)",
    "tags": [
      "astro",
      "typescript",
      "docker",
      "cloudflare",
      "oci",
      "ssr"
    ],
    "keywords": "astro ssr, cloudflare edge caching, docker deploy, oracle cloud, self-hosted runner"
  },
  {
    "title": "Webhook Inspector",
    "url": "https://apanjwani0.com/tools/webhook-inspector",
    "description": "Get a URL, point anything at it, watch the requests arrive — headers, body, timing. Useful when you are wiring up a provider callback and need to see what it actually sends rather than what the docs claim.\n\nBounded in every dimension on purpose: body size, requests per bin, total bytes, retention, and how long a request may hold a socket. Bin ids are long enough that knowing one is the access control, and that length is enforced server-side.",
    "tags": [
      "typescript",
      "api",
      "webhooks",
      "rate-limiting"
    ],
    "keywords": "webhook tester, request bin, webhook debugger, http inspector"
  },
  {
    "title": "Cron Whisperer",
    "url": "https://apanjwani0.com/tools/cron-whisperer",
    "description": "Paste a crontab line, read it back in plain English, and see the next runs in the time zone the server actually runs in rather than the one your browser happens to be in. It exists to answer the question every other cron explainer skips: what happens to this job when the clocks change.\n\nA crontab line names a wall-clock reading, not an instant, and twice a year those stop being the same thing — an hour of readings never happens in spring, and an hour happens twice in autumn. So the engine walks wall-clock readings with plain calendar arithmetic and only then asks the zone which instants each reading maps to: zero, one, or two. That ordering is why the daylight-saving cases fall out rather than being special-cased. Then it applies the rule from `man 8 cron`: a job counts as running \"at a particular time\" only when neither the hour nor the minute field contains a `*`, and only those get made up after a forward jump or held to one run after a backward one. Everything else follows the new wall clock, which is why a `*/30` schedule quietly loses two runs every spring and gains two every autumn.\n\nThe part that took the longest is that the walk decides in wall order and returns instants, and across a fall-back those two orders disagree. Every termination decision taken in wall order is therefore wrong, and the final sort by instant hides the hole instead of showing it.\n\nEverything computes in the browser, and the shareable link carries the expression and the zone in the URL fragment, which browsers never send to a server. The time claims are asserted against the real tz database in CI — a wrong answer here renders perfectly and stays green otherwise.",
    "tags": [
      "typescript",
      "cron",
      "timezones",
      "dst"
    ],
    "keywords": "cron expression explainer, crontab parser, cron dst, cron timezone, cron next run"
  },
  {
    "title": "Type Trial",
    "url": "https://apanjwani0.com/games/type-trial",
    "description": "One shared passage per UTC day, and a leaderboard the server validates rather than trusts.\n\nThe validation is the point. The server re-derives the day and its passage from the same module the browser bundle uses, then checks the submitted run against that. A finish means the whole passage was typed, which makes wpm a *function* of elapsed time — so the gate pins the two to each other. A one-sided \"not faster than a perfect run\" check reads as real and is vacuous, because its ceiling grows without limit as the claimed time shrinks.\n\nNo accounts, no cookie, no per-visitor identity — a display name and the numbers are the whole record.",
    "tags": [
      "typescript",
      "game",
      "leaderboard",
      "anti-cheat"
    ],
    "keywords": "typing test, daily typing challenge, server validated leaderboard, wpm test"
  },
  {
    "title": "Driftfield",
    "url": "https://apanjwani0.com/tools/driftfield",
    "description": "A generative art studio: nine seeded pattern engines exporting full-resolution PNG or a looping GIF, plus six live simulations — flow fields, boids, reaction-diffusion, L-systems, falling sand, starfields — each on its own page with the story of where it came from.\n\nEverything renders in the browser; nothing is uploaded. Seeded throughout, so the same settings always reproduce the same piece.",
    "tags": [
      "typescript",
      "canvas",
      "generative-art",
      "webcomponents"
    ],
    "keywords": "generative art generator, wallpaper generator, flow field, reaction diffusion, boids"
  },
  {
    "title": "Clock-Screen-Saver for macOS",
    "url": "https://github.com/apanjwani0/Clock-Screen-Saver",
    "description": "A macOS screen saver that displays the time **to the second**, with two display styles, adjustable fonts, and a live-preview settings sheet.",
    "tags": [
      "swift",
      "macos",
      "appkit",
      "screen-saver"
    ]
  },
  {
    "title": "Shopify HTML Emailer",
    "url": "https://github.com/apanjwani0/Shopify-HTML-Emailer",
    "description": "Shopify app with a visual HTML email editor and sender, built with Next.js, Koa, and Polaris.",
    "tags": [
      "shopify",
      "nextjs",
      "nodejs",
      "react"
    ]
  },
  {
    "title": "Scrape-Instagram",
    "url": "https://github.com/apanjwani0/Scrape-Instagram",
    "description": "Scalable web-scraping pipeline for automated Instagram data extraction and ZIP bundling of media assets.",
    "tags": [
      "open-source",
      "nodejs",
      "puppeteer",
      "javascript"
    ]
  },
  {
    "title": "Node.js Benchmarking",
    "url": "https://github.com/apanjwani0/Node.js-Benchmarking",
    "description": "Benchmark comparing server-side calculation performance against MongoDB aggregate queries in Node.js.",
    "tags": [
      "nodejs",
      "mongodb",
      "performance",
      "javascript"
    ]
  }
]
