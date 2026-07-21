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
    slug: 'list-forge',
    title: 'List Forge',
    description: 'Convert a column to a comma-separated list — and back again.',
    status: 'live',
    seoTitle: 'List Forge — Free Column to Comma-Separated List Converter (Comma Separator)',
    metaDescription: 'Paste a column of values and get a comma-separated list instantly — or paste a delimited list to get a column back. Choose the delimiter (comma, semicolon, pipe, space, tab, or a custom one), quote every item, add prefixes and suffixes, and clean the data up: trim, remove empty lines and extra whitespace, remove duplicates, lowercase, sort, or reverse. Live item count, one-click copy, optional auto-copy, and download as .csv or .txt — no login, no uploads.',
    keywords: 'column to comma separated list, comma separator, list to csv, convert column to csv, csv to list, comma separated list generator, delimiter converter, semicolon separated list, pipe separated list, remove duplicates from list, sort list online, add quotes to list, excel column to comma separated',
    intro: 'A two-pane converter that works in both directions: type or paste a column on the left (one item per line, straight out of a spreadsheet) and the delimited list appears on the right — or paste a delimited list on the right and get the column back. Whichever pane you edit is the source, so nothing is ever rewritten under your cursor. Pick the delimiter (comma, comma + space, semicolon, pipe, space, tab, new line, or your own), wrap each value in double or single quotes, and add a prefix and suffix to every item and to the list as a whole — enough to build an SQL IN clause, a JSON-ish array, or a plain CSV row. Clean the data on the way through: trim items, drop empty lines, collapse extra spaces or strip whitespace entirely, remove duplicates, lowercase, sort A→Z, and reverse. Quoted values are handled properly — a delimiter inside quotes never splits an item, and quotes inside a value are doubled the way CSV expects. A live item and character count sits under the panes; copy either side in one click (or turn on auto-copy), download the list as .csv or .txt, and reset when you are done. Your settings and both panes are remembered in your browser, and everything runs locally with nothing uploaded.',
  },
  {
    slug: 'epoch-wizard',
    title: 'Epoch Wizard',
    description: 'Convert Unix / epoch timestamps to human dates and back.',
    status: 'live',
    seoTitle: 'Epoch Wizard — Free Online Unix Timestamp / Epoch Converter',
    metaDescription: 'Convert Unix epoch timestamps to human-readable dates and back, right in your browser. A live current-epoch clock in seconds, milliseconds, microseconds and nanoseconds; automatic unit detection by digit count; local time and UTC; ISO-8601 and relative "x ago"; start and end-of-day/month/year epochs; a seconds-to-duration breakdown; and copy-ready get-and-convert code snippets in JavaScript, Python, Go, Java, PHP, Ruby, C#, Rust, SQL and shell. No login, no tracking, nothing uploaded.',
    keywords: 'unix timestamp converter, epoch converter, epoch time, unix time converter, timestamp to date, date to timestamp, epoch to human date, unix epoch, milliseconds to date, convert timestamp, current unix timestamp, epoch clock, utc timestamp, iso 8601 converter, seconds to duration, unix time now',
    intro: 'A complete epoch / Unix timestamp workbench that runs entirely in your browser. A live clock ticks the current epoch in seconds, milliseconds, microseconds and nanoseconds, each one copy-able. Paste any timestamp and it detects the unit from the digit count — 10 for seconds, 13 for milliseconds, 16 for microseconds, 19 for nanoseconds — or force a unit yourself, then read it as your local time, UTC, ISO-8601, and a relative "x ago". Go the other way too: type a date as ISO-8601, Y-M-D, M/D/Y, D-M-Y or RFC-2822, choose whether to read it in local time or UTC, and get the epoch back in seconds and milliseconds. Look up the start and end epochs of any day, month or year; break a raw number of seconds down into years, weeks, days, hours and minutes; and copy get-current-plus-convert code for eleven languages including JavaScript, Python, Go, Java, PHP, Ruby, C#, Rust, PostgreSQL, MySQL and shell. Preferences — 12- or 24-hour clock, whether to show UTC, the default unit and time zone — and your last inputs are remembered in your browser. Press C to clear every form. Nothing is uploaded.',
  },
  {
    slug: 'chroma-lab',
    title: 'Chroma Lab',
    description: 'Convert colours between HEX, RGB, HSL, HSV & CMYK — and check WCAG contrast.',
    status: 'live',
    seoTitle: 'Chroma Lab — Free Online Colour Converter & WCAG Contrast Checker',
    metaDescription: 'Convert a colour between HEX, RGB, HSL, HSV and CMYK with a live picker and editable fields that stay in sync, copy any format in one click, and explore complementary, analogous and triadic harmonies plus a tint-to-shade scale. Then check any text/background pair against the WCAG AA and AAA contrast ratios — with a live text preview and pass/fail badges for normal text, large text and UI components. Runs entirely in your browser: no login, no tracking, nothing uploaded.',
    keywords: 'color converter, colour converter, hex to rgb, rgb to hex, hex to hsl, rgb to hsl, hsl to rgb, hex to cmyk, color code converter, wcag contrast checker, color contrast checker, contrast ratio, accessibility contrast, aa aaa contrast, color harmonies, complementary color, color picker, hsv converter, cmyk converter',
    intro: 'A colour workbench with two halves that runs entirely in your browser. On top, a converter: pick a colour or type it as HEX, and its RGB, HSL, HSV and CMYK values all stay in sync — edit any field and the rest update, without the value ever being rewritten under your cursor. An alpha slider handles transparency, every format is one click to copy, and a strip of harmonies (complementary, analogous, triadic) plus a seven-step tint-to-shade scale are all clickable to load. Below, a WCAG contrast checker: choose a text colour and a background, see a live sample rendered at normal, large and display sizes, and read the exact contrast ratio with pass/fail badges for AA and AAA at each text size and for non-text UI components — swap the pair with one button, or pull the converter colour straight in. Press R for a random colour and S to swap the contrast pair. Your colours are remembered in your browser, and nothing is uploaded.',
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
