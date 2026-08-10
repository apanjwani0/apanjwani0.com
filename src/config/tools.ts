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
    description: 'Format, validate, repair, search, compare & convert JSON to YAML, CSV, or XML.',
    status: 'live',
    seoTitle: 'JSON Tidy — Free Online JSON Formatter, Validator, Repair, Viewer, Compare & Converter',
    metaDescription: 'Paste JSON to pretty-print, validate, minify, or repair broken JSON — fix single quotes, trailing commas, unquoted keys, comments, and Python True/False/None in one click. Explore it in a searchable collapsible tree viewer, or convert it to YAML, CSV, or XML. Compare two JSON documents to see every added, removed, or changed value, each pinpointed by its path. Search keys and values to jump straight to any node; parse errors are marked by line and column. Choose 2/3/4-space or tab indent, sort keys, upload a file, and copy or download the result — no login, no tracking, no uploads.',
    keywords: 'json formatter, json repair, repair json, fix json, json fixer, json cleaner, jsonlint, json viewer, json tree viewer, json tree view, search json, filter json, json search, collapsible json, json validator, json minifier, json compare, json diff, compare json, json diff online, json difference, json compare tool, json to yaml, json to csv, json to xml, json converter, pretty print json, format json online, json beautifier, sort json keys',
    intro: 'A fast, client-side JSON workbench with a two-pane layout: edit JSON on the left and see the result on the right. Format it with your choice of 2-, 3-, or 4-space or tab indentation, optionally sorting object keys for clean diffs; minify it to the smallest valid payload; stringify it to an escaped one-liner; or convert it straight to YAML, CSV, or XML. Pasted something broken? Hit Repair to fix the JSON people actually paste — single or smart quotes, unquoted keys, trailing and missing commas, // and /* */ comments, Python or JavaScript literals like True, False, None and undefined, a leading +, and even unclosed brackets — then review the fixed result and apply it to your input in one click. Switch the output to an interactive tree viewer to drill into nested objects and arrays — expand and collapse any node, see how many keys or items each holds, and click a key to copy its path. Search the tree to highlight every matching key or value: matches are counted, their parent nodes auto-expand so nothing stays hidden, and you can step between hits with the arrows or Enter and Shift+Enter. Flip to Compare mode to diff two JSON documents side by side: every difference is listed by its path and colour-coded as added, removed, or changed, with running counts, next/previous stepping, and one-click copy of the whole diff. Validation runs live as you type — a status line tells you whether the JSON is valid and, when it is not, points to the exact line and column of the error with a caret-marked excerpt. Load a .json file, turn on auto-format to beautify as you type, then copy or download the output in one click. Your last input, view, and settings are remembered in your browser, and everything runs locally with nothing uploaded.',
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
    slug: 'codec-forge',
    title: 'Codec Forge',
    description: 'Encode & decode Base64 and URLs, and pull query strings apart.',
    status: 'live',
    seoTitle: 'Codec Forge — Free Online Base64 & URL Encoder / Decoder + Query String Parser',
    metaDescription: 'Encode and decode Base64 and URLs right in your browser, and take query strings apart. Base64: two live panes with standard or URL-safe alphabet, MIME line-wrapping, forgiving decode, UTF-8 support, plus file → Base64 (with data URI and image preview) and Base64 → file download. URL: encodeURIComponent or encodeURI, a decoder that survives malformed input, and an optional "+ means space" toggle. Query string: parse a URL into decoded key = value pairs (repeated keys kept) and rebuild it. No login, no tracking, nothing uploaded.',
    keywords: 'base64 encode, base64 decode, base64 encoder, base64 decoder, url encode, url decode, percent encoding, encodeuricomponent, url safe base64, base64 to image, image to base64, file to base64, data uri generator, query string parser, parse query string, url parameter decoder, base64 online, url encoder online',
    intro: 'A Base64 and URL workbench with three tabs, all running entirely in your browser. On the Base64 tab, two live panes stay in sync — type text on the left to encode, or paste Base64 on the right to decode — with a standard or URL-safe alphabet, optional MIME line-wrapping, and a forgiving decoder that shrugs off whitespace, missing padding, and either alphabet. Text is treated as UTF-8, so accents and emoji round-trip cleanly. Drop in any file to Base64-encode it locally (images get a live preview and you get a ready-made data URI), or turn Base64 back into a downloadable file. The URL tab encodes with encodeURIComponent for single values or encodeURI for a whole address, and decodes without breaking on a stray percent sign, with an optional toggle to read + as a space the way HTML forms do. The Query string tab splits a URL or query string into decoded key = value pairs — repeated keys preserved, + read as space — shown as an editable list and a copyable table, and edits rebuild a properly encoded query string. Everything is copy-first (Ctrl/Cmd + Enter copies the current output), keyboard-friendly, and remembered in your browser; nothing is ever uploaded.',
  },
  {
    slug: 'hash-smith',
    title: 'Hash Smith',
    description: 'Hash text or files with SHA-256/1/384/512 & HMAC, and generate UUIDs.',
    status: 'live',
    seoTitle: 'Hash Smith — Free Online SHA-256 / SHA-1 / SHA-512 Hash, HMAC & UUID Generator',
    metaDescription: 'Hash text or a file with SHA-1, SHA-256, SHA-384 and SHA-512 all at once, right in your browser — read each digest as hex or Base64 and copy it in one click. Switch to HMAC to sign text with a secret key, verify a downloaded file against its published checksum, and generate v4 (random) or v7 (time-ordered) UUIDs in bulk. Powered by the built-in Web Crypto API: no login, no tracking, nothing uploaded.',
    keywords: 'sha256 hash, sha-256 generator, sha1 hash, sha512 hash, sha384, hash generator, online hash, hmac generator, hmac sha256, checksum calculator, verify checksum, file hash, file checksum, md5 alternative, uuid generator, guid generator, uuid v4, uuid v7, generate uuid, random uuid, base64 hash, crypto subtle',
    intro: 'A hashing and UUID workbench that runs entirely in your browser on the built-in Web Crypto API, so nothing is ever uploaded. On the Text tab, type or paste anything and get its SHA-1, SHA-256, SHA-384 and SHA-512 digests all at once, live as you type — read each one as hex (lower or UPPERCASE) or Base64, and copy any single digest in one click. Flip to HMAC mode to authenticate the text with a secret key using the same four algorithms, exactly how API requests and webhooks are signed. On the File tab, pick any file to hash it locally with the same algorithms, then paste a published checksum into the verify box: the matching row lights up, so you can confirm a download is intact — the comparison ignores spaces, colons and letter case and checks every algorithm, so you need not know which one was used. On the UUID tab, mint v4 (fully random) or v7 (time-ordered, ideal as a database key) identifiers, or the nil UUID, in bulk up to a hundred at a time, toggling UPPERCASE, hyphens and {braces}, then copy them all. Everything is copy-first, keyboard-friendly — Ctrl/⌘ + Enter copies the current output — and your non-secret inputs and settings are remembered in your browser.',
  },
  {
    slug: 'cron-whisperer',
    title: 'Cron Whisperer',
    description: 'Explain a cron expression in plain English and see its next run times.',
    status: 'live',
    seoTitle: 'Cron Whisperer — Free Online Cron Expression Explainer & Next-Run Schedule Preview',
    metaDescription: 'Paste a crontab expression and read it in plain English, then see the next run times in your local zone or UTC. Understands the standard 5-field syntax, ranges, lists and steps, month and weekday names (JAN–DEC, SUN–SAT), @nicknames like @daily and @reboot, and 6-field expressions with a leading seconds field. Get a field-by-field breakdown, a frequency read-out, and clickable common examples — with a note on the day-of-month / day-of-week OR gotcha. Runs entirely in your browser: no login, no tracking, nothing uploaded.',
    keywords: 'cron expression explainer, crontab explainer, cron parser, cron schedule, cron to english, explain cron, cron expression, crontab guru, cron next run, cron schedule preview, cron generator, cron builder, cron syntax, cron every 5 minutes, cron weekday, cron nickname, cron seconds, quartz cron, node-cron, cron validator',
    intro: 'A cron expression explainer that runs entirely in your browser. Type or paste a crontab schedule and read it back in plain English — in the same phrasing crontab.guru uses, like “At 22:00 on every day-of-week from Monday through Friday.” — then see the next run times computed in your local time zone or in UTC, each with a relative “in x”. It understands the full standard 5-field syntax: any value (*), single numbers, lists (1,15,30), ranges (9-17), and steps (*/5, 0-30/10), plus month and weekday names (JAN–DEC and SUN–SAT, with both 0 and 7 meaning Sunday). Shorthand @nicknames — @yearly, @monthly, @weekly, @daily, @hourly and @reboot — are expanded and explained, and a 6-field expression is read with a leading seconds field the way Quartz and node-cron do. A field-by-field breakdown shows each field’s raw token and the exact values it expands to, a frequency line tells you how often the job fires, and one click loads any of the common examples. It even flags the classic day-of-month / day-of-week gotcha — when both are set, cron runs when either matches. Copy the expression, the description, or the next-run list in one click; your last expression and preferences are remembered on your device, and nothing is ever uploaded.',
  },
  {
    slug: 'regex-lab',
    title: 'Regex Lab',
    description: 'Test a regular expression live — highlight matches, inspect capture groups, and preview a replace.',
    status: 'live',
    seoTitle: 'Regex Lab — Free Online Regular Expression Tester, Matcher & Replacer',
    metaDescription: 'Test a regular expression against your text and see every match highlighted live as you type. Toggle the g, i, m, s, u and y flags; inspect each match\'s position and capture groups (numbered and named); and preview a find-and-replace with $1, $<name> and $& support. Includes a quick-reference cheat-sheet and clickable example patterns, and copies the pattern, the /regex/flags literal, or a ready-to-paste JavaScript snippet. Uses your browser\'s native JavaScript (ECMAScript) engine: no login, no tracking, nothing uploaded.',
    keywords: 'regex tester, regular expression tester, regex online, test regex, regex match, regex101 alternative, regexr alternative, regex replace, regex capture groups, named groups, regex flags, javascript regex, regex highlighter, regex cheat sheet, regex examples, regex validator, pattern matcher, regex substitution, regex playground',
    intro: 'A live regular-expression tester that runs entirely in your browser on the native JavaScript (ECMAScript) engine, so what you see is exactly how the pattern behaves in JavaScript. Type a pattern between the slashes and every match lights up in the test string as you type, with alternating tints so back-to-back matches stay distinct and zero-width matches shown as a caret. Toggle the flags as chips — g to find every match, i to ignore case, m so ^ and $ hit each line break, s so . also matches newlines, u for full Unicode, y for a sticky anchor — and read a live status line telling you whether the pattern is valid and how many matches it found. The match list shows every match with its start–end position and every capture group, numbered and, when you use (?<name>…), labelled by name. Switch to the Replace tab to preview a full find-and-replace with $1–$9, $<name>, $& and the $` / $\' before-and-after tokens, along with a live replacement count. There is a built-in quick-reference cheat-sheet of character classes, anchors, quantifiers, groups, lookaround and escapes, plus clickable example patterns — email, URL, IPv4, hex colour, ISO dates with named groups, duplicate words with a backreference, and more — each loaded with sample text. Copy the raw pattern, the /regex/flags literal, the matches, the replaced text, or a ready-to-paste JavaScript snippet in one click. Press C to clear the pattern, or Ctrl/⌘ + Enter to copy the literal; your pattern, flags, text and settings are remembered on this device and never uploaded.',
  },
  {
    slug: 'wallpaper-forge',
    title: 'Wallpaper Forge',
    description: 'Make seeded wallpapers and patterns, then export a PNG or looping GIF.',
    status: 'live',
    seoTitle: 'Wallpaper Forge — Free Generative Wallpaper, Pattern & GIF Maker',
    metaDescription: 'Create seeded wallpapers and looping generative GIFs in your browser. Choose from nine pattern engines, device sizes and palettes, then export a full-resolution PNG or compact animated GIF — no login, no uploads.',
    keywords: 'wallpaper generator, gif generator, animated wallpaper maker, pattern generator, generative art, seeded art, procedural art, flow field, harmonograph, topographic pattern, truchet tiles, png wallpaper generator',
    intro: 'A browser-based generative art studio for stills and loops. Choose from Aurora, Waves, Topographic, Truchet, Terrazzo, Flow Field, Harmonograph, Mosaic, or Constellation; pick a device size and palette; then tune density, detail, and grain. Every result is driven by a seed, so the same settings reproduce the same piece. Export a full-resolution PNG or a compact two-second animated GIF, entirely in your browser with nothing uploaded.',
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
