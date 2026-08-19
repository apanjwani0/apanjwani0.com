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
  seoContent?: string
  /** Comma-separated search terms — feeds the page <meta name="keywords"> and the
      WebApplication JSON-LD, matching how games carry keywords. */
  keywords?: string
}

export const tools: Tool[] = [
  {
    slug: 'webhook-inspector',
    title: 'Webhook Inspector',
    description: 'Get a unique URL, send any webhook to it, and inspect the requests live.',
    status: 'live',
    seoTitle: 'Webhook Tester & Inspector — Webhook Inspector',
    metaDescription: 'Free webhook tester: get an instant URL, watch requests arrive with headers and body, then verify the Stripe, GitHub or Slack signature against your secret.',
    keywords: 'webhook tester, webhook inspector, test webhook, webhook debugger, request bin, requestbin, http request inspector, capture webhook, inspect webhook, webhook url, receive webhook, webhook.site alternative, test http request, mock http endpoint, webhook testing tool, online webhook, debug webhook, http echo, request catcher, verify webhook signature, webhook signature checker, stripe signature verification, x-hub-signature-256, slack signing secret, shopify hmac, webhook hmac, signature mismatch, raw body hmac',
    intro: 'A live webhook and HTTP request tester that uses a real server, not just your browser. You get a unique capture URL that is saved on this device so you can reuse and share it; point any webhook sender or HTTP client at it — Stripe, GitHub, Slack, Shopify, Zapier, a cron job, or your own code — and every request it makes appears here within a couple of seconds, complete with the method, query string, every header, and the raw or pretty-printed body. Expand any request to read the full details, copy the body in one click, and clear the log when you are done. The capture URL doubles as a controllable HTTP target for debugging clients: append ?status=500 to make it return that status and exercise your retry logic, ?delay=2000 to simulate a slow upstream (2s is the cap), or ?echo=1 to have it send your request body straight back. Send a sample request with one button to see it work immediately. Paste the signing secret and every captured request is checked against it: Stripe, GitHub, Slack and Shopify are recognised from their headers and verified with the exact payload each one signs, and for any other sender the raw body is HMAC-ed with SHA-256, SHA-1 and SHA-512 and matched against every header, which tells you which header is the signature and how it is encoded. It keeps "correctly signed" and "still inside the replay window" as separate answers, and it never takes the algorithm from a label inside the message. The secret is used in your browser with Web Crypto and is never saved or uploaded. Captured requests live on the server only long enough to inspect — a few hours of inactivity — and are visible only to whoever holds the unguessable URL: there is no account and no public listing. Press R to refresh, C to clear, N for a fresh URL, and P to pause the live feed.',
  },
  {
    slug: 'flowmap',
    title: 'Flowmap',
    description: 'Paste an outline or a mermaid flowchart and it draws itself, then rearrange by hand. Share the whole board as a link.',
    status: 'live',
    seoTitle: 'Mind Map & Flowchart Maker from Text — Flowmap',
    metaDescription: 'Turn an indented outline or mermaid flowchart into a diagram instantly, then drag it into shape. Export Mermaid or PNG, or share the board as a single link.',
    keywords: 'mind map maker, text to diagram, mermaid editor, outline to mind map, flowchart from text, node graph editor, ideation canvas, concept map tool',
    intro: 'A canvas for thinking on. Paste an indented outline or a mermaid flowchart and it lays itself out; then add, connect and drag nodes into the shape you actually meant. Three layouts, a searchable node list, and export as Mermaid, PNG, or a link that carries the whole board.',
  },
  {
    slug: 'token-bench',
    title: 'Token Bench',
    description: 'Decode a JWT and actually verify its signature against a JWK, JWKS or HMAC secret.',
    status: 'live',
    seoTitle: 'JWT Verifier — Decode and Verify a JWT Signature Online',
    metaDescription: 'Most JWT tools only decode. Token Bench verifies the signature against a key you paste — HS, RS, PS and ES algorithms — entirely in your browser.',
    keywords: 'jwt verifier, verify jwt signature, jwt decoder, jwk, jwks, hs256, rs256, es256, jwt signature validation, alg none attack, algorithm confusion',
    intro: 'Paste a JWT to read its header, payload and claims. Paste a key — an HMAC secret, a JWK, or a whole JWKS — to find out whether the signature actually holds. HS, RS, PS and ES algorithms, checked with the browser\'s own Web Crypto. Nothing is uploaded.',
  },
  {
    slug: 'json-tidy',
    title: 'JSON Tidy',
    description: 'Format, validate, repair, search, compare & convert JSON to YAML, CSV, or XML.',
    status: 'live',
    seoTitle: 'JSON Formatter, Repair & Viewer — JSON Tidy',
    metaDescription: 'Format, validate, repair and compare JSON in your browser. Fix trailing commas, bad quotes and comments, view a tree, convert to YAML/CSV/XML. No upload.',
    keywords: 'json formatter, json repair, repair json, fix json, json fixer, json cleaner, jsonlint, json viewer, json tree viewer, json tree view, search json, filter json, json search, collapsible json, json validator, json minifier, json compare, json diff, compare json, json diff online, json difference, json compare tool, json to yaml, json to csv, json to xml, json converter, pretty print json, format json online, json beautifier, sort json keys',
    intro: 'A fast, client-side JSON workbench with a two-pane layout: edit JSON on the left and see the result on the right. Format it with your choice of 2-, 3-, or 4-space or tab indentation, optionally sorting object keys for clean diffs; minify it to the smallest valid payload; stringify it to an escaped one-liner; or convert it straight to YAML, CSV, or XML. Pasted something broken? Hit Repair to fix the JSON people actually paste — single or smart quotes, unquoted keys, trailing and missing commas, // and /* */ comments, Python or JavaScript literals like True, False, None and undefined, a leading +, and even unclosed brackets — then review the fixed result and apply it to your input in one click. Switch the output to an interactive tree viewer to drill into nested objects and arrays — expand and collapse any node, see how many keys or items each holds, and click a key to copy its path. Search the tree to highlight every matching key or value: matches are counted, their parent nodes auto-expand so nothing stays hidden, and you can step between hits with the arrows or Enter and Shift+Enter. Flip to Compare mode to diff two JSON documents side by side: every difference is listed by its path and colour-coded as added, removed, or changed, with running counts, next/previous stepping, and one-click copy of the whole diff. Validation runs live as you type — a status line tells you whether the JSON is valid and, when it is not, points to the exact line and column of the error with a caret-marked excerpt. Load a .json file, turn on auto-format to beautify as you type, then copy or download the output in one click. Your last input, view, and settings are remembered in your browser, and everything runs locally with nothing uploaded.',
  },
  {
    slug: 'list-forge',
    title: 'List Forge',
    description: 'Convert a column to a comma-separated list — and back again.',
    status: 'live',
    seoTitle: 'Column to Comma List Converter — List Forge',
    metaDescription: 'Turn a column into a comma-separated list, CSV row or SQL-ready list, then convert it back. Trim, dedupe, quote and sort in your browser.',
    keywords: 'column to comma separated list, comma separator, list to csv, convert column to csv, csv to list, comma separated list generator, delimiter converter, semicolon separated list, pipe separated list, remove duplicates from list, sort list online, add quotes to list, excel column to comma separated',
    intro: 'A two-pane converter that works in both directions: type or paste a column on the left (one item per line, straight out of a spreadsheet) and the delimited list appears on the right — or paste a delimited list on the right and get the column back. Whichever pane you edit is the source, so nothing is ever rewritten under your cursor. Pick the delimiter (comma, comma + space, semicolon, pipe, space, tab, new line, or your own), wrap each value in double or single quotes, and add a prefix and suffix to every item and to the list as a whole — enough to build an SQL IN clause, a JSON-ish array, or a plain CSV row. Clean the data on the way through: trim items, drop empty lines, collapse extra spaces or strip whitespace entirely, remove duplicates, lowercase, sort A→Z, and reverse. Quoted values are handled properly — a delimiter inside quotes never splits an item, and quotes inside a value are doubled the way CSV expects. A live item and character count sits under the panes; copy either side in one click (or turn on auto-copy), download the list as .csv or .txt, and reset when you are done. Your settings and both panes are remembered in your browser, and everything runs locally with nothing uploaded.',
  },
  {
    slug: 'epoch-wizard',
    title: 'Epoch Wizard',
    description: 'Convert Unix / epoch timestamps to human dates and back.',
    status: 'live',
    seoTitle: 'Unix Timestamp Converter — Epoch Wizard',
    metaDescription: 'Convert Unix timestamps to readable dates and back. See seconds, milliseconds, UTC, local time, ISO output and code snippets. No upload.',
    keywords: 'unix timestamp converter, epoch converter, epoch time, unix time converter, timestamp to date, date to timestamp, epoch to human date, unix epoch, milliseconds to date, convert timestamp, current unix timestamp, epoch clock, utc timestamp, iso 8601 converter, seconds to duration, unix time now',
    intro: 'A complete epoch / Unix timestamp workbench that runs entirely in your browser. A live clock ticks the current epoch in seconds, milliseconds, microseconds and nanoseconds, each one copy-able. Paste any timestamp and it detects the unit from the digit count — 10 for seconds, 13 for milliseconds, 16 for microseconds, 19 for nanoseconds — or force a unit yourself, then read it as your local time, UTC, ISO-8601, and a relative "x ago". Go the other way too: type a date as ISO-8601, Y-M-D, M/D/Y, D-M-Y or RFC-2822, choose whether to read it in local time or UTC, and get the epoch back in seconds and milliseconds. Look up the start and end epochs of any day, month or year; break a raw number of seconds down into years, weeks, days, hours and minutes; and copy get-current-plus-convert code for eleven languages including JavaScript, Python, Go, Java, PHP, Ruby, C#, Rust, PostgreSQL, MySQL and shell. Preferences — 12- or 24-hour clock, whether to show UTC, the default unit and time zone — and your last inputs are remembered in your browser. Press C to clear every form. Nothing is uploaded.',
  },
  {
    slug: 'chroma-lab',
    title: 'Chroma Lab',
    description: 'Convert colours between HEX, RGB, HSL, HSV & CMYK — and check WCAG contrast.',
    status: 'live',
    seoTitle: 'Color Converter & Contrast Checker — Chroma Lab',
    metaDescription: 'Convert HEX, RGB, HSL, HSV and CMYK, pick colour harmonies, and check WCAG contrast ratios with a live preview. Runs in your browser.',
    keywords: 'color converter, colour converter, hex to rgb, rgb to hex, hex to hsl, rgb to hsl, hsl to rgb, hex to cmyk, color code converter, wcag contrast checker, color contrast checker, contrast ratio, accessibility contrast, aa aaa contrast, color harmonies, complementary color, color picker, hsv converter, cmyk converter',
    intro: 'A colour workbench with two halves that runs entirely in your browser. On top, a converter: pick a colour or type it as HEX, and its RGB, HSL, HSV and CMYK values all stay in sync — edit any field and the rest update, without the value ever being rewritten under your cursor. An alpha slider handles transparency, every format is one click to copy, and a strip of harmonies (complementary, analogous, triadic) plus a seven-step tint-to-shade scale are all clickable to load. Below, a WCAG contrast checker: choose a text colour and a background, see a live sample rendered at normal, large and display sizes, and read the exact contrast ratio with pass/fail badges for AA and AAA at each text size and for non-text UI components — swap the pair with one button, or pull the converter colour straight in. Press R for a random colour and S to swap the contrast pair. Your colours are remembered in your browser, and nothing is uploaded.',
  },
  {
    slug: 'codec-forge',
    title: 'Codec Forge',
    description: 'Encode & decode Base64 and URLs, and pull query strings apart.',
    status: 'live',
    seoTitle: 'Base64 & URL Encoder/Decoder — Codec Forge',
    metaDescription: 'Encode and decode Base64 and URLs, parse query strings, and handle files locally. Fast browser tool, no signup and no upload.',
    keywords: 'base64 encode, base64 decode, base64 encoder, base64 decoder, url encode, url decode, percent encoding, encodeuricomponent, url safe base64, base64 to image, image to base64, file to base64, data uri generator, query string parser, parse query string, url parameter decoder, base64 online, url encoder online',
    intro: 'A Base64 and URL workbench with three tabs, all running entirely in your browser. On the Base64 tab, two live panes stay in sync — type text on the left to encode, or paste Base64 on the right to decode — with a standard or URL-safe alphabet, optional MIME line-wrapping, and a forgiving decoder that shrugs off whitespace, missing padding, and either alphabet. Text is treated as UTF-8, so accents and emoji round-trip cleanly. Drop in any file to Base64-encode it locally (images get a live preview and you get a ready-made data URI), or turn Base64 back into a downloadable file. The URL tab encodes with encodeURIComponent for single values or encodeURI for a whole address, and decodes without breaking on a stray percent sign, with an optional toggle to read + as a space the way HTML forms do. The Query string tab splits a URL or query string into decoded key = value pairs — repeated keys preserved, + read as space — shown as an editable list and a copyable table, and edits rebuild a properly encoded query string. Everything is copy-first (Ctrl/Cmd + Enter copies the current output), keyboard-friendly, and remembered in your browser; nothing is ever uploaded.',
  },
  {
    slug: 'hash-smith',
    title: 'Hash Smith',
    description: 'Hash text or files with SHA-256/1/384/512 & HMAC, and generate UUIDs.',
    status: 'live',
    seoTitle: 'SHA Hash, HMAC & UUID Generator — Hash Smith',
    metaDescription: 'Generate SHA hashes, HMAC signatures and UUIDs from text or files in your browser. Verify checksums locally, without uploads.',
    keywords: 'sha256 hash, sha-256 generator, sha1 hash, sha512 hash, sha384, hash generator, online hash, hmac generator, hmac sha256, checksum calculator, verify checksum, file hash, file checksum, md5 alternative, uuid generator, guid generator, uuid v4, uuid v7, generate uuid, random uuid, base64 hash, crypto subtle',
    intro: 'A hashing and UUID workbench that runs entirely in your browser on the built-in Web Crypto API, so nothing is ever uploaded. On the Text tab, type or paste anything and get its SHA-1, SHA-256, SHA-384 and SHA-512 digests all at once, live as you type — read each one as hex (lower or UPPERCASE) or Base64, and copy any single digest in one click. Flip to HMAC mode to authenticate the text with a secret key using the same four algorithms, exactly how API requests and webhooks are signed. On the File tab, pick any file to hash it locally with the same algorithms, then paste a published checksum into the verify box: the matching row lights up, so you can confirm a download is intact — the comparison ignores spaces, colons and letter case and checks every algorithm, so you need not know which one was used. On the UUID tab, mint v4 (fully random) or v7 (time-ordered, ideal as a database key) identifiers, or the nil UUID, in bulk up to a hundred at a time, toggling UPPERCASE, hyphens and {braces}, then copy them all. Everything is copy-first, keyboard-friendly — Ctrl/⌘ + Enter copies the current output — and your non-secret inputs and settings are remembered in your browser.',
  },
  {
    slug: 'cron-whisperer',
    title: 'Cron Whisperer',
    description: 'Explain a whole crontab, or one expression, in plain English — next runs in any zone, and every daylight-saving trap.',
    status: 'live',
    seoTitle: 'Crontab & Cron Expression Explainer with DST — Cron Whisperer',
    metaDescription: 'Paste a cron expression or a whole crontab and read it in plain English. CRON_TZ-aware next runs in any IANA time zone, the runs daylight saving skips or repeats, and the jobs that start at the same instant.',
    keywords: 'cron expression explainer, crontab explainer, cron parser, cron schedule, cron to english, explain cron, cron expression, crontab guru, cron next run, cron schedule preview, cron timezone, cron dst, cron daylight saving, cron skipped run, cron ran twice, crontab timezone, cron utc, cron generator, cron builder, cron syntax, cron every 5 minutes, cron weekday, cron nickname, cron seconds, quartz cron, node-cron, cron validator, crontab reader, read a crontab, crontab parser, parse crontab file, cron_tz, cron_tz vs tz, crontab timezone variable, etc cron.d, system crontab, cron user column, cron percent sign, cron percent stdin, crontab comment, cron jobs at the same time, cron job overlap',
    intro: 'A cron expression explainer that runs entirely in your browser and is honest about time zones. Type or paste a crontab schedule and read it back in plain English — in the same phrasing crontab.guru uses, like “At 22:00 on every day-of-week from Monday through Friday.” — then see the next run times computed in whichever time zone the job actually runs in. Not just this browser and UTC: any IANA zone, picked from your own machine’s copy of the tz database, so you can check a crontab on a server in America/New_York while sitting in Asia/Kolkata. Then comes the part every other cron explainer skips. A crontab line names a wall clock, not a moment, and twice a year those stop being the same thing: when the clocks go forward an hour of readings never happens, and when they go back an hour of readings happens twice. Cron Whisperer marks every affected run in the list, and a daylight-saving card spells out each upcoming change in your chosen zone — what the clocks do, which of your runs land inside the missing or repeated hour, and what cron does about them. It applies the real rule from man 8 cron, the one almost nobody knows: a job counts as running “at a particular time” only when neither the hour nor the minute field contains a *, and only those jobs get made up after a forward jump or held to a single run after a backward one. Everything else follows the new wall clock, which is why a step schedule quietly loses two runs every spring. It understands the full standard 5-field syntax: any value (*), single numbers, lists (1,15,30), ranges (9-17), and steps (*/5, 0-30/10), plus month and weekday names (JAN–DEC and SUN–SAT, with both 0 and 7 meaning Sunday). Shorthand @nicknames — @yearly, @monthly, @weekly, @daily, @hourly and @reboot — are expanded and explained, and a 6-field expression is read with a leading seconds field the way Quartz and node-cron do. A field-by-field breakdown shows each field’s raw token and the exact values it expands to, a frequency line tells you how often the job fires, and one click loads any of the common examples. It also flags the classic day-of-month / day-of-week gotcha — when both are set, cron runs when either matches. Paste more than one line and it stops reading an expression and starts reading a crontab — the loop the tool was missing, because nobody debugs one cron line, they debug a crontab. Comments, blank lines and NAME=value assignments are recognised the way cron itself recognises them, and every entry is previewed together: the schedule in plain English, the command cron would really run, and its own next run. A CRON_TZ= or TZ= line applies to the entries below it and stays in force until it is reassigned, so each entry is resolved on the clock that line puts it on — the entry above the assignment is not in that zone, which is the most common way a crontab gets misread. TZ= is flagged rather than trusted, because implementations disagree about whether it moves the schedule or only sets the job’s environment. One merged timeline then shows what fires next across the whole file, in order, marking the instants where more than one job starts at once — the usual reason a box stalls on the hour — and the daylight-saving panel names the lines that break at the next clock change instead of making you check them one at a time. It also reads what cron reads: a # opens a comment only at the start of a line, so a trailing one is part of the command, and an unescaped % ends the command and sends the rest to the job on standard input, which is why date +%Y%m%d in a crontab does not do what it looks like. Files from /etc/cron.d with a user column are read that way on request. Copy the expression, the description, the next-run list or the merged timeline in one click, or copy a link that carries the whole crontab and the zone to a colleague in the URL fragment — which browsers never send to a server. Your last expression and preferences are remembered on your device, and nothing is ever uploaded.',
  },
  {
    slug: 'regex-lab',
    title: 'Regex Lab',
    description: 'Test a regular expression live — highlight matches, inspect capture groups, and preview a replace.',
    status: 'live',
    seoTitle: 'JavaScript Regex Tester — Regex Lab',
    metaDescription: 'Test JavaScript regex live, highlight matches, inspect capture groups and preview replacements. Includes examples and a quick reference.',
    keywords: 'regex tester, regular expression tester, regex online, test regex, regex match, regex101 alternative, regexr alternative, regex replace, regex capture groups, named groups, regex flags, javascript regex, regex highlighter, regex cheat sheet, regex examples, regex validator, pattern matcher, regex substitution, regex playground',
    intro: 'A live regular-expression tester that runs entirely in your browser on the native JavaScript (ECMAScript) engine, so what you see is exactly how the pattern behaves in JavaScript. Type a pattern between the slashes and every match lights up in the test string as you type, with alternating tints so back-to-back matches stay distinct and zero-width matches shown as a caret. Toggle the flags as chips — g to find every match, i to ignore case, m so ^ and $ hit each line break, s so . also matches newlines, u for full Unicode, y for a sticky anchor — and read a live status line telling you whether the pattern is valid and how many matches it found. The match list shows every match with its start–end position and every capture group, numbered and, when you use (?<name>…), labelled by name. Switch to the Replace tab to preview a full find-and-replace with $1–$9, $<name>, $& and the $` / $\' before-and-after tokens, along with a live replacement count. There is a built-in quick-reference cheat-sheet of character classes, anchors, quantifiers, groups, lookaround and escapes, plus clickable example patterns — email, URL, IPv4, hex colour, ISO dates with named groups, duplicate words with a backreference, and more — each loaded with sample text. Copy the raw pattern, the /regex/flags literal, the matches, the replaced text, or a ready-to-paste JavaScript snippet in one click. Press C to clear the pattern, or Ctrl/⌘ + Enter to copy the literal; your pattern, flags, text and settings are remembered on this device and never uploaded.',
  },
  {
    slug: 'driftfield',
    title: 'Driftfield',
    description: 'A generative art studio: nine seeded pattern engines plus six live simulations, exported as PNG or looping GIF.',
    status: 'live',
    seoTitle: 'Generative Art & Wallpaper Generator — Driftfield',
    metaDescription: 'Create seeded wallpapers, patterns and looping GIFs in your browser, or run six live simulations — flow fields, boids, reaction-diffusion, L-systems and more.',
    keywords: 'wallpaper generator, gif generator, animated wallpaper maker, pattern generator, generative art, seeded art, procedural art, flow field, harmonograph, topographic pattern, truchet tiles, png wallpaper generator, reaction diffusion, boids simulation, l-system generator',
    intro: 'A browser-based generative art studio for stills and loops. Choose from Aurora, Waves, Topographic, Truchet, Terrazzo, Flow Field, Harmonograph, Mosaic, or Constellation; pick a device size and palette; then tune density, detail, and grain. Every result is driven by a seed, so the same settings reproduce the same piece. Export a full-resolution PNG or a compact two-second animated GIF, entirely in your browser with nothing uploaded. Six live simulations sit alongside the studio, each on its own page.',
  },
  {
    slug: 'draftboard',
    title: 'Draftboard',
    description: 'Markdown editor with live preview, a structure map of the document, and multi-format export.',
    status: 'live',
    seoTitle: 'Markdown Editor with Live Preview & Mind Map — Draftboard',
    metaDescription: 'Write Markdown with a live preview and see your document as a mind map of its own headings — click a node to jump there. Export to MD, TXT, PDF or image.',
    keywords: 'markdown editor, markdown preview, markdown to pdf, online markdown editor, markdown export, live markdown preview, markdown mind map, document outline map, markdown structure view',
    intro: 'A browser-based markdown editor with real-time preview. Write in markdown on the left, see the formatted result on the right — or switch to Map and see the document as a tree of its own headings, where clicking a node jumps you straight to that section. Export as PDF, PNG image, raw markdown, or plain text, all locally with no server uploads.',
  },
  {
    slug: 'audio-transcriber',
    title: 'Audio Transcriber',
    description: 'Real-time speech-to-text using your browser microphone.',
    status: 'disabled',
    seoTitle: 'Browser Speech-to-Text — Audio Transcriber',
    metaDescription: 'Transcribe speech in your browser with the microphone and copy or download the text. No upload and no API key.',
    keywords: 'speech to text, audio transcription, browser transcription, web speech api, voice to text, real-time transcription',
    intro: 'Real-time speech-to-text transcription that runs entirely in your browser. Click the mic, speak, and watch your words appear. Supports multiple languages and lets you copy or download the transcript as a text file.',
  },
]
