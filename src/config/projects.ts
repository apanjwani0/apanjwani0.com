export interface Project {
  title: string
  url: string
  description: string
  tags: string[]
  keywords?: string
}

export const projects: Project[] = [
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
