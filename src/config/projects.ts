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
