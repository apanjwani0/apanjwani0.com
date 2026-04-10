export interface Project {
  title: string
  url: string
  description: string
  tags: string[]
  keywords?: string
}

export const projects: Project[] = [
  {
    "title": "Clock-Screen-Saver for MacOS",
    "url": "https://github.com/apanjwani0/Clock-Screen-Saver",
    "description": "A simple macOS screen saver that displays the time **in seconds**. \nIt features two display styles, adjustable fonts, and a live-preview settings sheet.",
    "tags": [
      "macOs",
      "tahoe",
      "clock",
      "screen-saver"
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
    "title": "excalidraw-cli",
    "url": "https://github.com/apanjwani0/excalidraw-cli",
    "description": "Forked repo from [swiftlysingh/excalidraw-cli](https://github.com/swiftlysingh/excalidraw-cli).\n\nAdded functionalities: \n- Bidirectional Arrows\n- Edge labels support both single `'` and double `\"` quotes\n",
    "tags": [
      "typescript",
      "DSL"
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
