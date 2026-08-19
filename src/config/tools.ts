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
    seoContent: `## How to use Webhook Inspector

Copy your unique webhook URL from the top of the page and paste it into whatever service or client you want to test. As soon as it sends a request, it appears in the log below — click any entry to see the method, headers, query parameters and body. Use "Send test request" to fire a sample request and confirm everything works.

## What it is good for

- Seeing exactly what a webhook from Stripe, GitHub, Slack, Shopify, Discord or Zapier actually sends before you write code to handle it.
- Debugging an HTTP client: append \`?status=429\` or \`?status=500\` to test how your code handles error responses and retries.
- Simulating a slow endpoint with \`?delay=3000\` to test timeouts.
- Round-tripping a payload with \`?echo=1\`, which sends your request body straight back.

## Verify the signature, not just the payload

A webhook URL is public, so the signature header is the only thing separating a real delivery from anyone who guessed the URL. Paste your signing secret and every captured request gets checked here, in your browser, with Web Crypto — the secret is never saved and never uploaded.

The bug almost everyone hits first is the same one: they parse the JSON and HMAC the re-serialised object. The sender signed **the bytes it sent**, and re-serialising changes key order, spacing and unicode escapes, so the digest never matches and the secret gets blamed. This page hashes the captured raw body and shows the expected digest next to the one that arrived.

Four senders are recognised by their headers and checked with the payload each one actually signs:

- **Stripe** — \`stripe-signature\`, HMAC-SHA256 hex over \`timestamp.rawBody\`. The dot and the timestamp are part of the signed string; hashing the body alone fails against a perfectly valid header.
- **GitHub** — \`x-hub-signature-256\`, HMAC-SHA256 hex over the raw body. The deprecated SHA-1 \`x-hub-signature\` is checked too, and labelled as deprecated.
- **Slack** — \`x-slack-signature\`, HMAC-SHA256 hex over \`v0:timestamp:rawBody\`, with the timestamp from \`x-slack-request-timestamp\`.
- **Shopify** — \`x-shopify-hmac-sha256\`, HMAC-SHA256 **base64** over the raw body. Comparing a hex digest against a base64 header is why a correct Shopify secret so often looks wrong.

Anything else falls through to a search: the raw body is HMAC-ed with SHA-256, SHA-1 and SHA-512 and each result is looked for in every header. When one turns up, you have learnt which header is the signature and how it is encoded — the thing a sender's docs most often leave out.

### A valid signature and a fresh one are different answers

Stripe and Slack both fold a timestamp into the signed payload and both reject deliveries outside a five-minute window. A correctly signed request that arrived twenty minutes ago is a stale delivery, not a forgery, and this page says so as two separate statements. Collapsing them into one pass/fail is how people end up widening a replay window to make a red badge go green.

### The algorithm never comes from the message

The hash is chosen by which header the sender used, never by the \`sha256=\` label inside the value. A verifier that reads its algorithm out of the thing it is verifying lets whoever wrote the message choose how it gets checked — the webhook shape of JWT algorithm confusion. When the label and the header disagree, this page reports the disagreement instead of obeying it.

One thing to copy carefully: this page compares digests with \`===\`, which is fine when the secret is your own and the comparison runs in your own tab. A server comparing an attacker-supplied digest must use a constant-time comparison, or its response time leaks the correct signature one byte at a time.

## Privacy

Captured requests are stored on the server only long enough to inspect them — they are dropped after a few hours of inactivity — and are visible only to whoever holds the unguessable URL. There is no account, no public directory, and no long-term storage. Generate a fresh URL any time with the New URL button.

## FAQ

### Is this like RequestBin or webhook.site?

Yes — it gives you a throwaway URL that captures and displays incoming HTTP requests so you can inspect webhooks and API calls.

### Can I control the response it sends back?

Yes. Add \`?status=NNN\` to set the HTTP status, \`?delay=MS\` to slow the response down, and \`?echo=1\` to echo your request body back.

### Does my signing secret leave the browser?

No. The HMAC runs in your tab with Web Crypto, the secret is never written to browser storage, and closing the tab forgets it.

### How long are requests kept?

Requests are held in memory and dropped after a few hours of inactivity, and the most recent 50 per URL are kept. Treat it as a live inspection tool, not storage.`,
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
    seoContent: `## Start from text, finish by hand

Hand-placing thirty boxes is the reason most diagrams never get drawn. Flowmap takes structure you already have and does the placing, so the work you do is the thinking.

Paste either of two things — it detects which:

- **An indented outline.** Markdown lists work unmodified; each nested line becomes a child node. This is the fastest way to turn notes into a mind map.
- **A mermaid flowchart.** \`A[Start] --> B[Next]\`, edge labels, and the usual arrow variants. Round-trips with the Mermaid export, so a board can leave and come back.

Then move things. A generated layout is a starting point, never the finished thought.

## Layouts

- **Flow** — a directed, top-down tree. Right for hierarchies and processes.
- **Grid** — even rows and columns, for when you want to read everything at once.
- **Force** — a physics simulation that lets clusters find themselves. Right when you do not yet know the shape.

Switching layout re-runs it; dragging a node afterwards keeps your placement.

## Getting it out

- **Copy link.** The entire board is encoded into the URL fragment. Send it to someone and they open exactly what you were looking at — no account, no server, no stored document. A fragment is never transmitted to a server, so the board does not appear in anyone's access log.
- **Copy as Mermaid.** Paste it into a README, a GitHub comment, or any tool that renders Mermaid.
- **PNG.** A 2× export of the current board.

Your work is also saved to this browser as you go, so closing the tab does not lose it.

## FAQ

### Does anything get uploaded?

No. Parsing, layout, rendering and export all run in your browser, and the share link carries the board inside the URL itself rather than storing it anywhere.

### How large a board can a link hold?

Large enough for a normal diagram — the board is compacted into the fragment, and browsers accept long URLs — but a board with hundreds of long labels will produce an unwieldy link. Use the Mermaid export for those.

### Which mermaid features are supported?

The flowchart subset people actually write: node shapes, the common arrow types, and edge labels. Subgraphs, styling and other diagram types are skipped rather than rejected, so an unsupported line does not stop the rest from drawing.`,
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
    seoContent: `## Verify against a JWKS, by \`kid\`

Plenty of JWT tools verify a signature once you paste a key. What none of them make easy is the step before that: your identity provider publishes a **JWKS** — a set of keys — and the token names which one it was signed with in its \`kid\` header. Matching those up by hand is the fiddly part of the job.

Paste the whole JWKS from your provider's \`/.well-known/jwks.json\` and Token Bench picks the key the token names. If the set holds several keys and the token names none, it says so rather than guessing — verifying against the wrong key and reporting a pass is the worst thing a tool like this can do.

Verification runs on the browser's Web Crypto API over the exact \`header.payload\` bytes. No crypto is hand-rolled, and the token and key never leave the tab.

## What it accepts

- **HMAC** — HS256, HS384, HS512. Paste the shared secret as plain text, or as an \`oct\` JWK.
- **RSA** — RS256/384/512 (PKCS#1 v1.5) and PS256/384/512 (RSA-PSS). Paste the public key as a JWK.
- **ECDSA** — ES256 (P-256), ES384 (P-384), ES512 (P-521). Public key as a JWK.
- **A whole JWKS.** Paste the JSON from your provider's \`/.well-known/jwks.json\` and the key matching the token's \`kid\` is selected automatically.

## The two mistakes this is built around

### \`alg: none\`

A token can declare that it is not signed. Early JWT libraries honoured that and returned "valid", which meant anyone could mint an admin token by editing the payload and deleting the signature. Token Bench reports such a token as **UNSIGNED** and never as verified.

### Algorithm confusion

The more subtle one. If your verifier reads the algorithm from the token's own header, an attacker can take a token you expect to be RS256, re-sign it as HS256 using your **public** key as the HMAC secret, and your verifier will confirm it — because the attacker chose both the message and the method of checking it.

That is why the algorithm here is a control you set rather than something silently taken from the token. It defaults to the header's value because that is convenient while debugging, and it warns you whenever the two disagree. In production, the algorithm must come from your configuration.

## Signature and expiry are separate answers

A correctly signed token that expired last week is a normal, common state, and it is not the same as a forged one. Token Bench reports the signature result and the \`exp\`/\`nbf\` state separately, because collapsing them into a single "valid" light is how expired-token bugs ship.

## Privacy

Everything runs in your browser. The token and the key are never sent anywhere, and neither is stored — only your algorithm choice is remembered on this device, deliberately, since both of the other two are credentials.

## FAQ

### Can I verify a token from Auth0, Cognito, Firebase or Okta?

Yes. Fetch your provider's JWKS (usually \`https://<issuer>/.well-known/jwks.json\`), paste the whole JSON in, and the key matching the token's \`kid\` is picked for you.

### Why does it not fetch the JWKS for me?

Because that would mean this page making a request to your identity provider, and a browser tool that reaches out to an auth endpoint on your behalf is a worse default than one that does not. Fetch it yourself and paste it.

### Can it sign tokens too?

No, only verification. Signing needs a private key, and pasting production private keys into a web page is a habit worth not building.`,
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
    seoContent: `## How to use JSON Tidy

Paste JSON into the editor. Use Format when the JSON is valid but hard to read, Repair when pasted data has common mistakes, Compare when you have two versions, and Convert when you need YAML, CSV or XML output.

## Common jobs

- Pretty-print minified JSON from an API response or log line.
- Fix trailing commas, comments, single quotes and unquoted keys before pasting into code.
- Compare two JSON payloads and see exactly which paths changed.
- Open the tree view to search nested keys and copy object paths.
- Convert simple JSON arrays into CSV for a spreadsheet.

## Privacy

Everything runs in your browser. JSON Tidy does not upload your input, create public share links or store your data on a server.

## FAQ

### Can it repair invalid JSON?

It handles common paste mistakes like trailing commas, comments, single quotes, smart quotes, missing commas and JavaScript-style values such as undefined.

### Can I compare two JSON files?

Yes. Switch to Compare mode, paste the second document and JSON Tidy lists added, removed and changed paths.

### Is this a JSONLint alternative?

Yes for quick validation and formatting. JSON Tidy also adds repair, tree search, diff and conversion tools.`,
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
    seoContent: `## How to use List Forge

Paste a column from a spreadsheet into the left pane — one item per line — and the delimited list appears on the right. Paste a delimited list into the right pane instead and you get the column back. Whichever pane you type in is the source, so your text is never rewritten under the cursor.

## Common jobs

- Turn an Excel or Google Sheets column into a comma-separated list for an email, a form or a config file.
- Build an SQL \`IN\` clause: choose single quotes, set the list prefix to \`(\` and the list suffix to \`)\`.
- Switch a list between comma, comma + space, semicolon, pipe, space, tab or newline delimiters.
- Clean a messy paste — trim items, drop empty lines, collapse extra spaces, remove duplicates, lowercase, sort A→Z or reverse.
- Split a CSV row back into one item per line, with quoted values kept intact.

## Options worth knowing

Quotes are handled the way CSV expects: a delimiter inside a quoted value never splits an item, and a quote inside a value is doubled. Item prefix and suffix wrap every entry; list prefix and suffix wrap the whole result. A live item and character count sits under the panes, and either side can be copied in one click, auto-copied as you type, or downloaded as .csv or .txt.

## Privacy

Everything runs in your browser. Nothing is uploaded; your settings and both panes are remembered on this device only.

## FAQ

### How do I convert an Excel column to a comma-separated list?

Copy the column, paste it into the left pane and pick Comma or Comma + space as the delimiter. Then press Copy, or turn on auto-copy so the result is always on your clipboard.

### Can it convert a list back into a column?

Yes. Type or paste into the right pane and the column is rebuilt on the left using the same delimiter and quote settings.

### Can I dedupe and sort at the same time?

Yes. Remove duplicates, Lowercase, Sort A→Z and Reverse order are independent checkboxes and can all be on at once.`,
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
    seoContent: `## What Epoch Wizard does

A live clock ticks the current Unix epoch in seconds, milliseconds, microseconds and nanoseconds, each one a click to copy. Below it sit four converters for the jobs that actually come up when you are staring at a log line or a database column.

## Common jobs

- Read a timestamp out of a log: paste it and the unit is detected from the digit count — 10 digits for seconds, 13 for milliseconds, 16 for microseconds, 19 for nanoseconds — or force the unit yourself.
- Go the other way: type a date as ISO-8601, Y-M-D, M/D/Y, D-M-Y or RFC-2822, choose whether to read it as local time or UTC, and get seconds and milliseconds back.
- Look up the exact start and end epochs of a day, month or year for a range query.
- Break a raw number of seconds down into years, weeks, days, hours and minutes.
- Copy a get-current-and-convert snippet for JavaScript, Python, Go, Java, PHP, Ruby, C#, Rust, PostgreSQL, MySQL or shell.

Every result is shown as your local time, UTC, ISO-8601 and a relative "x ago", so you never have to do the offset arithmetic yourself.

## Privacy

Everything runs in your browser. No timestamp you paste leaves the page. Preferences — 12- or 24-hour clock, whether UTC is shown, the default unit and the input time zone — are stored on this device only.

## FAQ

### Is my timestamp in seconds or milliseconds?

Count the digits. A 10-digit number is seconds, 13 is milliseconds, 16 is microseconds and 19 is nanoseconds. Epoch Wizard applies that rule automatically and lets you override it.

### What is the Unix epoch?

It is 00:00:00 UTC on 1 January 1970 — the zero point nearly every system counts from. A Unix timestamp is simply the number of seconds elapsed since then, which is why it carries no time zone of its own.

### How do I clear everything quickly?

Press C while no field is focused and every form on the page resets.`,
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
    seoContent: `## Two tools on one page

The top half is a colour converter. Pick a colour or type a HEX code and the RGB, HSL, HSV and CMYK values all stay in sync — edit any field and the rest follow, without the value being rewritten under your cursor. Six formats are one click to copy: HEX, HEX with alpha, rgb()/rgba(), hsl()/hsla(), HSV and CMYK.

The bottom half is a WCAG contrast checker. Choose a text colour and a background, read the exact contrast ratio, and see pass or fail for AA and AAA at normal and large text sizes plus the separate threshold for non-text UI.

## Common jobs

- Convert HEX to RGB, HSL, HSV or CMYK — and back from any of them.
- Check that body text clears AA against its background before you ship it.
- Build a palette from the clickable harmonies: complementary, analogous and triadic.
- Pull a lighter or darker version from the seven-step tint-to-shade scale when a colour is nearly right.
- Swap the text and background pair to see whether the combination works both ways round.

Press R for a random colour and S to swap the contrast pair. The "use current" buttons load the converter colour straight into the checker.

## Privacy

Everything runs in your browser. No colour, sample or setting is uploaded; your last colours are remembered on this device only.

## FAQ

### What contrast ratio do I actually need?

AA — the level most organisations target — needs 4.5:1 for normal text and 3:1 for large text (24px, or 18.66px bold). AAA is stricter at 7:1 and 4.5:1. Non-text UI such as icons, input borders and focus rings needs 3:1 against whatever is next to it.

### Does the converter handle transparency?

Yes. The alpha slider feeds the HEX+alpha, rgba() and hsla() output. Contrast ratios are computed on the opaque colours, which is how WCAG defines them.

### What is the difference between HSL and HSV?

Both start from hue and saturation. HSL's third value is lightness, where 100% is always white; HSV's is value, where 100% is the most vivid form of that hue. HSL is what CSS uses.`,
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
    seoContent: `## Three tabs, one job each

The Base64 tab keeps two panes in sync — type text on the left to encode, paste Base64 on the right to decode. Choose the standard (+/) or URL-safe (-_) alphabet and optional MIME (76) or PEM (64) line wrapping. The decoder is deliberately forgiving: it ignores whitespace, tolerates missing padding and accepts either alphabet.

The URL tab encodes with encodeURIComponent for a single value or encodeURI for a whole address, and decodes without choking on a stray percent sign. Turn on "decode + as space" to match how HTML forms submit.

The Query string tab splits a URL or a bare query string into decoded key = value pairs — repeated keys preserved — as an editable list. Change a value and a properly encoded query string is rebuilt.

## Common jobs

- Decode a Base64 payload from a JWT header, a config file or an API response.
- Turn an image into a data URI you can paste straight into CSS or HTML, with a live preview.
- Base64-encode any file locally, or turn a Base64 blob back into a downloadable file.
- Work out why a URL parameter arrives mangled by decoding it field by field.
- Decide between encodeURIComponent and encodeURI when a generated link keeps breaking.

## Privacy

Everything runs in your browser, file encoding included — files are read locally and never uploaded. Your inputs and settings are remembered on this device only.

## FAQ

### What is the difference between encodeURIComponent and encodeURI?

encodeURIComponent escapes everything unsafe inside a single value, including / ? & and =. encodeURI leaves those alone because they are structural parts of an address. Use the first for a parameter value, the second for a whole URL.

### Does it handle emoji and accented characters?

Yes. Text is treated as UTF-8 on both sides, so accents and emoji round-trip cleanly instead of turning into mojibake.

### What is URL-safe Base64?

The same encoding with + and / swapped for - and _, so the result can sit in a URL or a filename without further escaping. Codec Forge encodes with either alphabet and decodes both automatically.`,
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
    seoContent: `## What Hash Smith does

Three tabs, all running on the browser's built-in Web Crypto API. Text hash gives you SHA-1, SHA-256, SHA-384 and SHA-512 digests of whatever you type, all four live at once, as hex (lower or UPPERCASE) or Base64. Switch it to HMAC and add a secret key to produce the keyed signature that API requests and webhooks are signed with. File hash does the same for a file you pick. UUID mints identifiers in bulk.

## Verifying a download

Pick the file, then paste the published checksum into the verify box. Hash Smith compares it against all four algorithms at once and lights up the row that matches, so you do not need to know which one the publisher used. The comparison ignores spaces, colons and letter case, so a checksum copied from anywhere usually works as-is.

## Which UUID version

- v4 is fully random — the safe default when you only need uniqueness.
- v7 is time-ordered, so sequential inserts keep a database index tidy instead of fragmenting it the way random keys do.
- nil is the all-zeros UUID, useful as a placeholder or sentinel.

Generate up to a hundred at a time and toggle UPPERCASE, hyphens and {braces} before copying them all.

## Privacy

Hashing happens entirely in your browser — text, keys and files never leave the page, and files are read locally rather than uploaded. The HMAC key is deliberately not restored from storage when you come back.

## FAQ

### Why is there no MD5?

The Web Crypto API does not implement MD5, by design: it is broken for anything security-related. For integrity checks and signatures use SHA-256 or stronger, which is what Hash Smith offers.

### What is HMAC and when do I need it?

HMAC mixes a message with a secret key to produce a signature only a holder of that key could have made. It is how Stripe, GitHub and most webhook senders let you prove a payload really came from them rather than a stranger.

### Should I use UUID v4 or v7?

Use v7 for database primary keys — the timestamp prefix keeps inserts roughly sequential. Use v4 when the identifier must leak nothing at all, including when it was created.`,
  },
  {
    slug: 'cron-whisperer',
    title: 'Cron Whisperer',
    description: 'Explain a cron expression in plain English, preview its next runs in any time zone, and see exactly what daylight saving does to it.',
    status: 'live',
    seoTitle: 'Cron Expression Explainer with DST — Cron Whisperer',
    metaDescription: 'Explain cron expressions in plain English and preview the next runs in any IANA time zone — including the runs daylight saving skips or repeats.',
    keywords: 'cron expression explainer, crontab explainer, cron parser, cron schedule, cron to english, explain cron, cron expression, crontab guru, cron next run, cron schedule preview, cron timezone, cron dst, cron daylight saving, cron skipped run, cron ran twice, crontab timezone, cron utc, cron generator, cron builder, cron syntax, cron every 5 minutes, cron weekday, cron nickname, cron seconds, quartz cron, node-cron, cron validator',
    intro: 'A cron expression explainer that runs entirely in your browser and is honest about time zones. Type or paste a crontab schedule and read it back in plain English — in the same phrasing crontab.guru uses, like “At 22:00 on every day-of-week from Monday through Friday.” — then see the next run times computed in whichever time zone the job actually runs in. Not just this browser and UTC: any IANA zone, picked from your own machine’s copy of the tz database, so you can check a crontab on a server in America/New_York while sitting in Asia/Kolkata. Then comes the part every other cron explainer skips. A crontab line names a wall clock, not a moment, and twice a year those stop being the same thing: when the clocks go forward an hour of readings never happens, and when they go back an hour of readings happens twice. Cron Whisperer marks every affected run in the list, and a daylight-saving card spells out each upcoming change in your chosen zone — what the clocks do, which of your runs land inside the missing or repeated hour, and what cron does about them. It applies the real rule from man 8 cron, the one almost nobody knows: a job counts as running “at a particular time” only when neither the hour nor the minute field contains a *, and only those jobs get made up after a forward jump or held to a single run after a backward one. Everything else follows the new wall clock, which is why a step schedule quietly loses two runs every spring. It understands the full standard 5-field syntax: any value (*), single numbers, lists (1,15,30), ranges (9-17), and steps (*/5, 0-30/10), plus month and weekday names (JAN–DEC and SUN–SAT, with both 0 and 7 meaning Sunday). Shorthand @nicknames — @yearly, @monthly, @weekly, @daily, @hourly and @reboot — are expanded and explained, and a 6-field expression is read with a leading seconds field the way Quartz and node-cron do. A field-by-field breakdown shows each field’s raw token and the exact values it expands to, a frequency line tells you how often the job fires, and one click loads any of the common examples. It also flags the classic day-of-month / day-of-week gotcha — when both are set, cron runs when either matches. Copy the expression, the description or the next-run list in one click, or copy a link that carries the expression and the zone to a colleague in the URL fragment — which browsers never send to a server. Your last expression and preferences are remembered on your device, and nothing is ever uploaded.',
    seoContent: `## How to read a cron expression

A standard crontab line has five fields: minute, hour, day-of-month, month and day-of-week. Paste one in and Cron Whisperer reads it back in plain English, then lists the next run times in whichever time zone you pick — this device, UTC, or any IANA zone such as \`America/New_York\`. A field-by-field breakdown shows every field's raw token next to the exact values it expands to, which is usually where a wrong schedule gives itself away.

## Daylight saving is the part that bites

A crontab names a **wall clock**, not a moment. Twice a year in most of the world those stop being the same thing:

- **Clocks go forward** and an hour of readings never happens. \`30 2 * * *\` has no 02:30 at all on the changeover day.
- **Clocks go back** and an hour of readings happens twice. 01:30 comes round in both the old offset and the new one.

What cron does about it is documented in \`man 8 cron\` and turns on a distinction almost nobody knows: a job counts as running "at a particular time" only when **neither** the hour nor the minute field contains a \`*\`. Those jobs are made up once, right after a forward jump, and are **not** repeated after a backward one. Every other schedule simply follows the new wall clock — so \`*/30 * * * *\` loses two runs in spring and gains two in autumn.

Cron Whisperer applies exactly that rule. Affected runs are marked in the next-run list, and the daylight-saving card names each upcoming change in your zone, what the clocks do, and which of your runs it moves, loses or repeats.

## What the parser understands

- Any value (\`*\`), single numbers, lists like \`1,15,30\`, ranges like \`9-17\`, and steps like \`*/5\` or \`0-30/10\`.
- Month and weekday names — JAN through DEC and SUN through SAT — with both 0 and 7 accepted for Sunday.
- Shorthand nicknames: \`@yearly\`, \`@annually\`, \`@monthly\`, \`@weekly\`, \`@daily\`, \`@midnight\`, \`@hourly\` and \`@reboot\`.
- Six-field expressions, read with a leading seconds field the way Quartz and node-cron do.

## The other gotcha it flags for you

When both day-of-month and day-of-week are restricted, cron fires when either one matches — not both. So \`0 0 13 * 5\` runs on the 13th of every month and on every Friday. Cron Whisperer calls this out on screen instead of letting you discover it in production.

## Privacy

The parser, the plain-English description, the zone maths and the next-run calculation all run in your browser. Nothing is uploaded; your last expression and preferences stay on this device. **Copy link** puts the expression and the zone in the URL fragment, which browsers never send to a server, so sharing a schedule does not put it on anyone's wire.

## FAQ

### How do I write "every 5 minutes" in cron?

\`*/5 * * * *\`. The step syntax means "every nth value", so \`*/5\` in the minute field fires at :00, :05, :10 and so on.

### How do I run a job only on weekdays?

Put \`1-5\` in the day-of-week field. \`0 9 * * 1-5\` runs at 09:00 Monday through Friday.

### Does cron support seconds?

Standard Unix crontab does not. Give Cron Whisperer six fields and it reads the first as seconds, matching Quartz, node-cron and Spring.

### Why did my 2:30am cron job not run?

Almost certainly daylight saving. If the clocks went forward that morning, 02:30 never existed. Vixie cron makes up a job whose hour and minute are both fixed, running it right at the jump — but if either field is a wildcard it just loses the run. Pick the zone here and the run is marked in the list with what happened to it.

### Why did my job run twice?

The clocks went back and your schedule has a wildcard hour or minute, so it followed the wall clock through the repeated hour. A job with a fixed hour and minute would have run once.

### Can I preview runs in another time zone?

Yes — that is the point. The zone picker offers this device, UTC, and every IANA zone your browser knows, so you can check a server's crontab from anywhere. The clock can be 12- or 24-hour, and you can show 5, 10 or 20 upcoming runs.

### How do I avoid daylight-saving problems entirely?

Run the job in UTC, or set \`CRON_TZ=UTC\` (or \`TZ=UTC\`) on the crontab. A zone with no offset changes cannot skip or repeat a run, and Cron Whisperer says so on the daylight-saving card when you pick one.`,
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
    seoContent: `## JavaScript regex testing, not every regex flavor

Regex Lab uses the browser's JavaScript regular expression engine. That keeps the result honest for code that will run in JavaScript, Node.js, Astro, React or a browser console.

## Common jobs

- Check whether a pattern matches one value or every value with the global flag.
- Inspect numbered and named capture groups.
- Preview replacements before using replace in code.
- Test multiline, unicode, dotAll and case-insensitive flags.
- Load examples for emails, URLs, hex colours, ISO dates and duplicate words.

## Quick reference

- Use parentheses to capture: (foo).
- Use a named group when the value has a meaning: (?<year>\\d{4}).
- Use ^ and $ for line starts and endings with the m flag.
- Use \\b for word boundaries.
- Use $1 or $<name> in replacements.

## FAQ

### Is Regex Lab the same as regex101?

No. regex101 supports multiple regex flavors and deep debugging. Regex Lab is smaller and focused on JavaScript behavior.

### Are my patterns uploaded?

No. Pattern testing, replacement preview and examples run locally in your browser.

### Why does my pattern behave differently from PCRE?

Different regex engines support different features. Regex Lab shows JavaScript behavior only, which is what you want for browser and Node.js code.`,
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
    seoContent: `## How Driftfield works

Pick one of nine pattern engines, choose the size you need, set a palette, then tune Density, Detail and Grain until the piece looks right. Everything is driven by a single seed number, so the same engine with the same settings and the same seed always reproduces exactly the same image. Copy the seed and you can come back to a result later.

## The nine engines

- Aurora — a glowing gradient mesh.
- Waves — layered flowing bands.
- Topographic — noise contour lines, like a map.
- Truchet — woven arc tiles.
- Terrazzo — scattered chips.
- Flow Field — seeded particle trails.
- Harmonograph — damped pendulum curves.
- Mosaic — geometric colour tiles.
- Constellation — connected star maps.

## Sizes and export

Four device sizes are built in: Phone at 1080×2340, Desktop at 2560×1440, Square at 2048×2048 and Tablet at 1668×2388. Export a full-resolution PNG at the size you picked, or export a two-second animated GIF loop. Seven palettes are available, including one that follows the site's own theme colours.

Shortcuts: R regenerates with a fresh seed, D exports the image, G exports the GIF.

## Privacy

The canvas, the render and both exports run entirely in your browser. Nothing is uploaded and no account is needed; your engine, palette, sliders and seed are remembered on this device only.

## FAQ

### Can I reproduce a wallpaper I made earlier?

Yes. Type the seed back into the seed box with the same engine, palette and slider values and you get the identical image — that is the whole point of seeding it.

### Why is the GIF smaller than the PNG?

A GIF holds 24 frames, so a full-resolution loop would be enormous. The GIF export is capped at 640px wide to stay usable on a phone; use PNG when you want the full device resolution.

### Do the sliders mean the same thing in every engine?

Not quite. Density and Detail map to whatever is meaningful for the engine you picked — particle count, contour spacing, tile size — and the readout under the slider tells you what Density currently controls.`,
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
    seoContent: `## The Map view

Long documents lose their shape while you are inside them. The **Map** view draws the document as a tree so you can see the shape rather than remember it, and clicking any node jumps the editor to that line.

Two things it can map, switchable:

- **Headings** — \`#\` / \`##\` / \`###\` become parent and child. This is the skeleton of the argument, and it is what a long piece is missing a view of.
- **Outline** — indented bullet lists become the tree, for brainstorming inside a document.

Fenced code blocks are excluded from both, so the \`#\` comments and \`-\` flags in a shell snippet do not turn into branches of your map.

The map is a navigator, not an editor: it never rewrites your markdown. It redraws as you type.

## A quick markdown editor for export

Draftboard is for short documents you want to write, preview and export without opening a full writing app. Paste markdown, check the rendered preview, then export the result.

## Common jobs

- Draft a README section and preview headings, lists, links and code blocks.
- Turn notes into a PDF or image for sharing.
- Convert markdown to plain text when formatting is not needed.
- Write prompt docs, changelogs, release notes or lightweight specs.

## Privacy

Your markdown stays in your browser. There is no login, no cloud sync and no server upload.

## FAQ

### Can I export markdown to PDF?

Yes. Use the export controls to download a PDF from the current preview.

### Is this a replacement for Dillinger?

Not fully. Dillinger is stronger for cloud sync. Draftboard is simpler: open, write, preview, export and leave.

### Does it work for code snippets?

Yes. Markdown code fences render in the preview, which makes it useful for README drafts and developer notes.`,
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
