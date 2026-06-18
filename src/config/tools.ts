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
}

export const tools: Tool[] = [
  {
    slug: 'json-tidy',
    title: 'JSON Tidy',
    description: 'Format, validate, and minify JSON — with pinpoint error locations.',
    status: 'live',
    seoTitle: 'JSON Tidy — Free Online JSON Formatter, Validator & Minifier',
    metaDescription: 'Paste JSON to pretty-print, validate, or minify it instantly in your browser. Parse errors are pinpointed by line and column with a marked excerpt. Choose 2/4-space or tab indent, optionally sort keys, and copy in one click — no login, no tracking, no uploads.',
    intro: 'A fast, client-side JSON workbench. Paste JSON and format it with your choice of 2-space, 4-space, or tab indentation, optionally sorting object keys for clean diffs — or minify it down to the smallest valid payload. Validation runs live as you type: a status line tells you whether the JSON is valid and, when it is not, points to the exact line and column of the error with a caret-marked excerpt. Output is copy-first, and your last input and settings are remembered in your browser. Everything runs locally with nothing uploaded.',
  },
  {
    slug: 'type-trial',
    title: 'Type Trial',
    description: 'A typing speed test — chase your best WPM, right in the browser.',
    status: 'live',
    seoTitle: 'Type Trial — Free Online Typing Speed Test (WPM & Accuracy)',
    metaDescription: 'Test your typing speed in seconds. Pick quotes, code, or numbers, then track your words-per-minute and accuracy live as you type. Your personal best is saved locally — no login, no tracking, no uploads.',
    intro: 'A clean, distraction-free typing speed test. Choose a category — handwritten quotes, real code snippets, or numbers and symbols — and start typing; the timer begins on your first keystroke. Watch your words-per-minute and accuracy update live, see each character highlighted as you go, and get a ranked result card when you finish. Your personal best is remembered in your browser and never uploaded.',
  },
  {
    slug: 'pattern-forge',
    title: 'Pattern Forge',
    description: 'Seeded generative art — make and download unique wallpapers.',
    status: 'live',
    seoTitle: 'Pattern Forge — Free Generative Art & Wallpaper Maker',
    metaDescription: 'Create one-of-a-kind generative wallpapers in your browser. Pick a style and palette, tweak the density, and export a high-res PNG. Every result is seeded, reproducible, and shareable — no login, no uploads.',
    intro: 'A browser-based generative art studio. Choose from flow fields, harmonographs, mosaics, waves, or constellations, pair them with a colour palette, and dial in the density. Each artwork is driven by a seed, so the same settings always produce the same image — copy the link to share an exact piece, or export it as a 1920×1080 PNG. Everything runs locally with no server uploads.',
  },
  {
    slug: 'md-enhanced',
    title: 'MD Enhanced',
    description: 'Markdown editor with live preview and multi-format export.',
    status: 'live',
    seoTitle: 'MD Enhanced — Free Online Markdown Editor with Live Preview',
    metaDescription: 'Write markdown with instant live preview, then export to PDF, image, or plain text. No login, no tracking — runs entirely in your browser.',
    intro: 'A browser-based markdown editor with real-time preview. Write in markdown on the left, see the formatted result on the right. Export your work as PDF, PNG image, raw markdown, or plain text — all processed locally in your browser with no server uploads.',
  },
  {
    slug: 'audio-transcriber',
    title: 'Audio Transcriber',
    description: 'Real-time speech-to-text using your browser microphone.',
    status: 'disabled',
    seoTitle: 'Audio Transcriber — Free Browser Speech-to-Text',
    metaDescription: 'Transcribe speech to text in real time using your browser microphone. No uploads, no API keys — powered by the Web Speech API.',
    intro: 'Real-time speech-to-text transcription that runs entirely in your browser. Click the mic, speak, and watch your words appear. Supports multiple languages and lets you copy or download the transcript as a text file.',
  },
]
