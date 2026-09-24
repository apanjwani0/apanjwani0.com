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
    "title": "Snap Call",
    "url": "https://github.com/apanjwani0/Snap-call",
    "description": "Texas Hold'em as a Kotlin Multiplatform app — Compose UI, a Ktor and Postgres server, and one shared rules engine.\n\nThe engine is a module with **zero dependencies**, and that is enforced by a test rather than by intention: `PurityScanTest` fails the build if anything reaches into it. It holds the evaluator, the deck, the reducer, side pots, rake, the per-viewer projection and the bots, and it compiles for Android, iOS and the JVM — so the same code decides a hand on the server and on the device.\n\nThat one engine is used two ways, and the split is the part worth explaining. Online, the server is the only rules authority: a `GameLoop` coroutine per table drives the hand over a single WebSocket, and the client renders the JSON it is sent and decides nothing. Offline, the identical engine runs on the phone and deals, settles and rakes whole hands against bots with no server at all. The wire types live in their own module so both ends encode and decode the same declarations instead of two copies that drift.\n\nAndroid is the only shippable target today. iOS is deliberately compile-target-only — the shared modules build for it and carry the three platform `actual`s common code needs, but there is no Xcode project, which is an honest way to keep the option open without pretending it ships.",
    "tags": [
      "kotlin",
      "kmp",
      "compose-multiplatform",
      "ktor",
      "postgres",
      "websockets"
    ],
    "keywords": "kotlin multiplatform poker, compose multiplatform, ktor websocket game server, shared game engine, texas holdem kotlin"
  },
  {
    "title": "sort",
    "url": "https://github.com/apanjwani0/sort",
    "description": "A macOS app that works out who is in your photos, then lets you browse by person. Point it at a folder or an external drive — cats and dogs get their own groups too.\n\nEverything runs on the machine. Face detection and grouping use Apple Vision with a bundled Core ML model, so there is no account, no upload and no network call; it ships as a single .dmg with no model download on first run.\n\nThe design rule is that it **does not reorganise anything**. Photos keep their names and folders and sort keeps its own index alongside them, so the tool is a better way to look through a messy library rather than another thing that rewrites it. Moving to Trash or exporting copies happens only when you ask.",
    "tags": [
      "swift",
      "macos",
      "core-ml",
      "vision",
      "on-device"
    ],
    "keywords": "macos photo organiser, browse photos by face, on-device face grouping, core ml vision app, offline photo library"
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
    "title": "Scrape-Instagram",
    "url": "https://github.com/apanjwani0/Scrape-Instagram",
    "description": "A Puppeteer tool that takes a public Instagram username and hands back every post on that profile as a single zip.\n\nIt checks for an existing archive for that username before launching a browser, so asking twice is a download rather than a second scrape. Each saved image is named with its date and the number of people Instagram's own model detected in it.\n\nThe most-starred thing I have put on GitHub, which is its own small lesson: it is a few hundred lines of automation, and it is useful to more people than anything more sophisticated I have written.",
    "tags": [
      "nodejs",
      "puppeteer",
      "javascript",
      "automation"
    ]
  },
  {
    "title": "Shopify HTML Emailer",
    "url": "https://github.com/apanjwani0/Shopify-HTML-Emailer",
    "description": "A Shopify app for building marketing emails: install through Shopify OAuth, compose a template in a visual editor, and export the HTML.\n\nTemplates are stored as design JSON in MongoDB Atlas rather than as rendered markup, so a saved email can be reopened and edited instead of only re-sent — the export step turns that JSON into HTML on demand.",
    "tags": [
      "shopify",
      "nodejs",
      "javascript",
      "mongodb"
    ]
  }
]
