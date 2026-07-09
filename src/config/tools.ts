export type ToolStatus = 'live' | 'wip' | 'external' | 'disabled'

export interface Tool {
  slug: string
  title: string
  description: string
  status: ToolStatus
  href?: string  // required when status === 'external'
  seoTitle?: string
  metaDescription?: string
  intro?: string
  /** Comma-separated search terms — feeds the page <meta name="keywords"> and the
      WebApplication JSON-LD, matching how games carry keywords. */
  keywords?: string
}

export const tools: Tool[] = [
  {
    slug: 'json-tidy',
    title: 'JSON Tidy',
    description: 'Format, validate, search, compare & convert JSON to YAML, CSV, or XML.',
    status: 'live',
    seoTitle: 'JSON Tidy — Free Online JSON Formatter, Viewer, Validator, Compare & Converter',
    metaDescription: 'Paste JSON to pretty-print, validate, minify, explore in a searchable collapsible tree viewer, or convert it to YAML, CSV, or XML — instantly in your browser. Compare two JSON documents to see every added, removed, or changed value, each pinpointed by its path. Search keys and values to jump straight to any node; parse errors are marked by line and column. Choose 2/3/4-space or tab indent, sort keys, upload a file, and copy or download the result — no login, no tracking, no uploads.',
    keywords: 'json formatter, json viewer, json tree viewer, json tree view, search json, filter json, json search, collapsible json, json validator, json minifier, json compare, json diff, compare json, json diff online, json difference, json compare tool, json to yaml, json to csv, json to xml, json converter, pretty print json, format json online, json beautifier, sort json keys',
    intro: 'A fast, client-side JSON workbench with a two-pane layout: edit JSON on the left and see the result on the right. Format it with your choice of 2-, 3-, or 4-space or tab indentation, optionally sorting object keys for clean diffs; minify it to the smallest valid payload; stringify it to an escaped one-liner; or convert it straight to YAML, CSV, or XML. Switch the output to an interactive tree viewer to drill into nested objects and arrays — expand and collapse any node, see how many keys or items each holds, and click a key to copy its path. Search the tree to highlight every matching key or value: matches are counted, their parent nodes auto-expand so nothing stays hidden, and you can step between hits with the arrows or Enter and Shift+Enter. Flip to Compare mode to diff two JSON documents side by side: every difference is listed by its path and colour-coded as added, removed, or changed, with running counts, next/previous stepping, and one-click copy of the whole diff. Validation runs live as you type — a status line tells you whether the JSON is valid and, when it is not, points to the exact line and column of the error with a caret-marked excerpt. Load a .json file, turn on auto-format to beautify as you type, then copy or download the output in one click. Your last input, view, and settings are remembered in your browser, and everything runs locally with nothing uploaded.',
  },
  {
    slug: 'pattern-forge',
    title: 'Pattern Forge',
    description: 'Seeded generative art — make and download unique wallpapers.',
    status: 'live',
    seoTitle: 'Pattern Forge — Free Generative Art & Wallpaper Maker',
    metaDescription: 'Create one-of-a-kind generative wallpapers in your browser. Pick a style and palette, tweak the density, and export a high-res PNG. Every result is seeded, reproducible, and shareable — no login, no uploads.',
    keywords: 'generative art, wallpaper maker, generative wallpaper, seeded art, procedural art, flow field, png wallpaper generator',
    intro: 'A browser-based generative art studio. Choose from flow fields, harmonographs, mosaics, waves, or constellations, pair them with a colour palette, and dial in the density. Each artwork is driven by a seed, so the same settings always produce the same image — copy the link to share an exact piece, or export it as a 1920×1080 PNG. Everything runs locally with no server uploads.',
  },
  {
    slug: 'md-enhanced',
    title: 'MD Enhanced',
    description: 'Markdown editor with live preview and multi-format export.',
    status: 'live',
    seoTitle: 'MD Enhanced — Free Online Markdown Editor with Live Preview',
    metaDescription: 'Write markdown with instant live preview, then export to PDF, image, or plain text. No login, no tracking — runs entirely in your browser.',
    keywords: 'markdown editor, markdown preview, markdown to pdf, online markdown editor, markdown export, live markdown preview',
    intro: 'A browser-based markdown editor with real-time preview. Write in markdown on the left, see the formatted result on the right. Export your work as PDF, PNG image, raw markdown, or plain text — all processed locally in your browser with no server uploads.',
  },
  {
    slug: 'audio-transcriber',
    title: 'Audio Transcriber',
    description: 'Real-time speech-to-text using your browser microphone.',
    status: 'disabled',
    seoTitle: 'Audio Transcriber — Free Browser Speech-to-Text',
    metaDescription: 'Transcribe speech to text in real time using your browser microphone. No uploads, no API keys — powered by the Web Speech API.',
    keywords: 'speech to text, audio transcription, browser transcription, web speech api, voice to text, real-time transcription',
    intro: 'Real-time speech-to-text transcription that runs entirely in your browser. Click the mic, speak, and watch your words appear. Supports multiple languages and lets you copy or download the transcript as a text file.',
  },
]
