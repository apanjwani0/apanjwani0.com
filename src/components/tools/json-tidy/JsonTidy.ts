/**
 * JSON Tidy — a client-side JSON workbench: format, validate, minify, convert.
 *
 * Two panes: an editable, live-validated JSON input on the left and a read-only
 * output panel on the right. Operations (Format / Minify / Stringify and the
 * JSON → YAML / CSV / XML converters) render into the output panel, which is
 * copy-first and downloadable. Validation runs live as you type: a status line
 * reports a parse error with its line and column plus a caret-marked excerpt of
 * the offending line. Indent (2 / 3 / 4 spaces or tab), key-sort, and an
 * auto-format-as-you-type toggle all persist in localStorage, as does the last
 * input, so the tool feels like a tab you can return to. Everything runs in the
 * browser; nothing is uploaded.
 *
 * Mounts as a WebComponent so it survives Astro's client-side View Transitions
 * (see the astro:page-load wiring in tools/[slug].astro).
 */

type Indent = '2' | '3' | '4' | 'tab'
type OutputKind = 'format' | 'minify' | 'stringify' | 'yaml' | 'csv' | 'xml' | 'repair'
type ViewMode = 'text' | 'tree'

const LS_INPUT = 'json-tidy:input:v1'
const LS_INDENT = 'json-tidy:indent:v1'
const LS_SORT = 'json-tidy:sort:v1'
const LS_AUTO = 'json-tidy:auto:v1'
const LS_VIEW = 'json-tidy:view:v1'
const LS_SEARCH = 'json-tidy:search:v1'
const LS_INPUT_A = 'json-tidy:input-a:v1' // Compare mode — the first (left) document
const LS_INPUT_B = 'json-tidy:input-b:v1' // Compare mode — the second (right) document
const LS_MODE = 'json-tidy:mode:v1' // 'format' | 'compare'
const MAX_PERSIST = 256 * 1024 // don't try to persist absurdly large blobs
const MAX_TREE_NODES = 15000 // above this, skip the interactive tree (DOM gets too heavy)
const MAX_DIFF_ROWS = 5000 // cap rendered diff rows so a huge document can't freeze the DOM

const SAMPLE = `{
  "tool": "JSON Tidy",
  "tidy": true,
  "indentOptions": [2, 3, 4, "tab"],
  "converters": ["yaml", "csv", "xml"],
  "nested": { "count": 3, "items": [1, 2, 3], "ok": null }
}`

// Two similar-but-different documents used by Compare's "Load example" — they show
// an added array item, a changed nested value, and an added top-level key.
const CMP_SAMPLE_A = `{
  "name": "Ada Lovelace",
  "born": 1815,
  "fields": ["mathematics", "computing"],
  "notes": { "pioneer": true, "engine": "Analytical Engine" }
}`
const CMP_SAMPLE_B = `{
  "name": "Ada Lovelace",
  "born": 1815,
  "fields": ["mathematics", "computing", "poetry"],
  "notes": { "pioneer": true, "engine": "Ada" },
  "honoured": "Ada Lovelace Day"
}`

const OUTPUT_META: Record<OutputKind, { title: string; ext: string; mime: string }> = {
  format: { title: 'Formatted JSON', ext: 'json', mime: 'application/json' },
  minify: { title: 'Minified JSON', ext: 'json', mime: 'application/json' },
  stringify: { title: 'Stringified JSON', ext: 'txt', mime: 'text/plain' },
  yaml: { title: 'YAML', ext: 'yaml', mime: 'text/yaml' },
  csv: { title: 'CSV', ext: 'csv', mime: 'text/csv' },
  xml: { title: 'XML', ext: 'xml', mime: 'application/xml' },
  repair: { title: 'Repaired JSON', ext: 'json', mime: 'application/json' },
}

function indentString(i: Indent): string {
  if (i === 'tab') return '\t'
  if (i === '4') return '    '
  if (i === '3') return '   '
  return '  '
}

function lineColFromOffset(src: string, offset: number): { line: number; col: number } {
  let line = 1
  let col = 1
  const stop = Math.min(offset, src.length)
  for (let i = 0; i < stop; i++) {
    if (src[i] === '\n') {
      line++
      col = 1
    } else {
      col++
    }
  }
  return { line, col }
}

/** Trim the engine-specific noise so the fallback message reads cleanly. */
function cleanMessage(msg: string): string {
  return msg
    .replace(/^JSON\.parse:\s*/i, '')
    .replace(/\s*in JSON at position \d+.*$/i, '')
    .replace(/\s*at line \d+ column \d+.*$/i, '')
    .replace(/\s*of the JSON data\.?$/i, '')
    .replace(/\.$/, '')
    .trim() || 'Invalid JSON'
}

interface ErrorLoc { index: number; message: string }

/**
 * Hand-rolled JSON scanner that returns the byte index of the first syntax
 * error (or null if valid). Modern V8 (Chrome/Node) reports most JSON errors
 * with a snippet but no position, and engines disagree on message format, so
 * we locate the error ourselves for a consistent line/column pointer. This is
 * only consulted when JSON.parse has already rejected the input — the parsed
 * value still comes from JSON.parse.
 */
function locateJsonError(src: string): ErrorLoc | null {
  let i = 0
  const n = src.length
  const err = (message: string, at: number = i): ErrorLoc => ({ index: at, message })
  const isDigit = (c: string) => c >= '0' && c <= '9'
  const ws = () => {
    while (i < n) {
      const c = src[i]
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') i++
      else break
    }
  }

  function value(): ErrorLoc | null {
    ws()
    if (i >= n) return err('Unexpected end of input')
    const c = src[i]
    if (c === '{') return object()
    if (c === '[') return array()
    if (c === '"') return string()
    if (c === '-' || isDigit(c)) return number()
    if (src.startsWith('true', i)) { i += 4; return null }
    if (src.startsWith('false', i)) { i += 5; return null }
    if (src.startsWith('null', i)) { i += 4; return null }
    return err(`Unexpected token ${JSON.stringify(c)}`)
  }

  function string(): ErrorLoc | null {
    i++ // opening quote
    while (i < n) {
      const c = src[i]
      if (c === '"') { i++; return null }
      if (c === '\\') {
        i++
        if (i >= n) return err('Unterminated string')
        const e = src[i]
        if ('"\\/bfnrt'.includes(e)) { i++ }
        else if (e === 'u') {
          i++
          for (let k = 0; k < 4; k++) {
            if (i >= n || !/[0-9a-fA-F]/.test(src[i])) return err('Invalid \\u escape', i)
            i++
          }
        } else return err(`Invalid escape \\${e}`, i)
      } else if (c === '\n') {
        return err('Unterminated string', i)
      } else i++
    }
    return err('Unterminated string')
  }

  function number(): ErrorLoc | null {
    const start = i
    if (src[i] === '-') i++
    if (src[i] === '0') i++
    else if (src[i] >= '1' && src[i] <= '9') { while (i < n && isDigit(src[i])) i++ }
    else return err('Invalid number', start)
    if (src[i] === '.') {
      i++
      if (!isDigit(src[i])) return err('Invalid number', i)
      while (i < n && isDigit(src[i])) i++
    }
    if (src[i] === 'e' || src[i] === 'E') {
      i++
      if (src[i] === '+' || src[i] === '-') i++
      if (!isDigit(src[i])) return err('Invalid number', i)
      while (i < n && isDigit(src[i])) i++
    }
    return null
  }

  function object(): ErrorLoc | null {
    i++ // {
    ws()
    if (src[i] === '}') { i++; return null }
    for (;;) {
      ws()
      if (i >= n) return err('Unexpected end of input')
      if (src[i] !== '"') return err('Expected string key')
      const e1 = string()
      if (e1) return e1
      ws()
      if (src[i] !== ':') return err("Expected ':' after key")
      i++
      const e2 = value()
      if (e2) return e2
      ws()
      if (src[i] === ',') { i++; continue }
      if (src[i] === '}') { i++; return null }
      return err("Expected ',' or '}'")
    }
  }

  function array(): ErrorLoc | null {
    i++ // [
    ws()
    if (src[i] === ']') { i++; return null }
    for (;;) {
      const e = value()
      if (e) return e
      ws()
      if (src[i] === ',') { i++; continue }
      if (src[i] === ']') { i++; return null }
      return err("Expected ',' or ']'")
    }
  }

  const top = value()
  if (top) return top
  ws()
  if (i < n) return err('Unexpected trailing content')
  return null
}

interface ParseResult {
  ok: boolean
  value?: unknown
  message?: string
  line?: number
  col?: number
}

function analyze(src: string): ParseResult {
  try {
    return { ok: true, value: JSON.parse(src) }
  } catch (err) {
    // Prefer our own scanner for a reliable, engine-independent line/column.
    const loc = locateJsonError(src)
    if (loc) {
      const { line, col } = lineColFromOffset(src, loc.index)
      return { ok: false, message: loc.message, line, col }
    }
    // Fallback: parse a position/line-column out of the native message.
    const raw = (err instanceof Error && err.message) ? err.message : 'Invalid JSON'
    let line: number | undefined
    let col: number | undefined
    const pos = raw.match(/position (\d+)/i)
    if (pos) {
      ;({ line, col } = lineColFromOffset(src, parseInt(pos[1], 10)))
    } else {
      const lc = raw.match(/line (\d+) column (\d+)/i)
      if (lc) {
        line = parseInt(lc[1], 10)
        col = parseInt(lc[2], 10)
      }
    }
    return { ok: false, message: cleanMessage(raw), line, col }
  }
}

// ── JSON repair (the "fixer") ────────────────────────────────
/**
 * A lenient, dependency-free JSON parser that accepts the malformed input
 * people actually paste — single-quoted or smart-quoted strings, unquoted
 * object keys, trailing/stray commas, missing commas, // and /* *\/ comments,
 * Python/JS literals (True/False/None/NaN/Infinity/undefined), a leading +,
 * hex numbers, and unterminated or unclosed structures — and reconstructs a
 * plain JS value. Re-serialising that value with JSON.stringify then yields
 * guaranteed-valid JSON, so the tool can repair rather than merely reject.
 * It never throws for ordinary breakage; the only failure is genuinely
 * unrecoverable input (empty, or nothing value-like at the top).
 */
interface RepairResult { ok: boolean; value?: unknown; fixes: string[]; error?: string }

const RP_QUOTE_CLOSE: Record<string, string> = {
  '"': '"', "'": "'", '`': '`',
  '“': '”', '”': '”', // “ ”
  '‘': '’', '’': '’', // ‘ ’
}
function rpIsQuote(c: string): boolean {
  return c === '"' || c === "'" || c === '`' || c === '“' || c === '”' || c === '‘' || c === '’'
}
function rpIsWs(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v' || c === ' ' || c === '﻿'
}

function repairJson(src: string): RepairResult {
  if (!src.trim()) return { ok: false, fixes: [], error: 'Nothing to repair.' }
  const fixes = new Set<string>()
  let i = 0
  const n = src.length
  let steps = 0
  const budget = n * 6 + 20000

  const tick = () => { if (++steps > budget) throw new Error('Too tangled to repair automatically.') }

  const skip = () => {
    for (;;) {
      tick()
      while (i < n && rpIsWs(src[i])) i++
      if (src[i] === '/' && src[i + 1] === '/') {
        fixes.add('removed comments')
        i += 2
        while (i < n && src[i] !== '\n') i++
      } else if (src[i] === '/' && src[i + 1] === '*') {
        fixes.add('removed comments')
        i += 2
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++
        i += 2
      } else break
    }
  }

  const parseString = (): string => {
    const open = src[i]
    const close = RP_QUOTE_CLOSE[open] ?? '"'
    if (open === "'" || open === '`') fixes.add('normalised single quotes')
    else if (open !== '"') fixes.add('normalised smart quotes')
    i++
    let out = ''
    while (i < n) {
      tick()
      const c = src[i]
      if (c === '\\') {
        const e = src[i + 1]
        i += 2
        switch (e) {
          case '"': out += '"'; break
          case "'": out += "'"; break
          case '\\': out += '\\'; break
          case '/': out += '/'; break
          case 'b': out += '\b'; break
          case 'f': out += '\f'; break
          case 'n': out += '\n'; break
          case 'r': out += '\r'; break
          case 't': out += '\t'; break
          case 'u': {
            const hex = src.slice(i, i + 4)
            if (/^[0-9a-fA-F]{4}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 4 }
            else out += 'u'
            break
          }
          default: out += e ?? ''
        }
        continue
      }
      if (c === close || c === open) { i++; return out }
      out += c
      i++
    }
    fixes.add('closed an unterminated string')
    return out
  }

  const literalOrBareword = (): unknown => {
    const start = i
    while (
      i < n && !',}]:'.includes(src[i]) && !rpIsWs(src[i]) &&
      !(src[i] === '/' && (src[i + 1] === '/' || src[i + 1] === '*'))
    ) i++
    const tok = src.slice(start, i)
    if (tok === '') return undefined // signals "no progress" to the caller
    if (tok === 'true') return true
    if (tok === 'false') return false
    if (tok === 'null') return null
    if (/^(true|false)$/i.test(tok)) { fixes.add('normalised literals'); return /^t/i.test(tok) }
    if (/^(null|none|nil|undefined)$/i.test(tok)) { fixes.add('normalised literals'); return null }
    if (/^nan$/i.test(tok) || /^[-+]?infinity$/i.test(tok)) { fixes.add('normalised literals'); return null }
    if (/^[-+]?0x[0-9a-fA-F]+$/.test(tok)) { fixes.add('converted hex numbers'); return parseInt(tok.replace('+', ''), 16) }
    if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(tok)) {
      const v = Number(tok)
      if (Number.isFinite(v)) { if (tok[0] === '+') fixes.add('removed leading +'); return v }
    }
    fixes.add('quoted unquoted values')
    return tok
  }

  const parseKey = (): string => {
    skip()
    if (rpIsQuote(src[i])) return parseString()
    const start = i
    while (i < n && !':,{}[]'.includes(src[i]) && !rpIsWs(src[i]) && !rpIsQuote(src[i])) i++
    const raw = src.slice(start, i)
    if (raw) fixes.add('quoted unquoted keys')
    return raw
  }

  const value = (): unknown => {
    skip()
    if (i >= n) return null
    const c = src[i]
    if (c === '{') return object()
    if (c === '[') return array()
    if (rpIsQuote(c)) return parseString()
    if (c === '}' || c === ']' || c === ',') return undefined // empty value slot
    return literalOrBareword()
  }

  const atDelim = (): boolean => i >= n || src[i] === ',' || src[i] === '}' || src[i] === ']'

  const object = (): Record<string, unknown> => {
    i++ // {
    const obj: Record<string, unknown> = {}
    for (;;) {
      tick()
      skip()
      if (i >= n) { fixes.add('auto-closed brackets'); break }
      if (src[i] === '}') { i++; break }
      if (src[i] === ',') { i++; fixes.add('removed stray commas'); continue }
      const key = parseKey()
      skip()
      if (src[i] === ':') i++
      else fixes.add('inserted missing colons')
      const before = i
      const v = value()
      obj[key] = v
      if (i === before && !atDelim()) i++ // guarantee forward progress on junk
      skip()
      if (src[i] === ',') {
        i++
        skip()
        if (src[i] === '}') { i++; fixes.add('removed trailing commas'); break }
        continue
      }
      if (src[i] === '}') { i++; break }
      if (i >= n) { fixes.add('auto-closed brackets'); break }
      fixes.add('inserted missing commas')
    }
    return obj
  }

  const array = (): unknown[] => {
    i++ // [
    const arr: unknown[] = []
    for (;;) {
      tick()
      skip()
      if (i >= n) { fixes.add('auto-closed brackets'); break }
      if (src[i] === ']') { i++; break }
      if (src[i] === ',') { i++; fixes.add('removed stray commas'); continue }
      const before = i
      const v = value()
      arr.push(v)
      if (i === before && !atDelim()) i++ // guarantee forward progress on junk
      skip()
      if (src[i] === ',') {
        i++
        skip()
        if (src[i] === ']') { i++; fixes.add('removed trailing commas'); break }
        continue
      }
      if (src[i] === ']') { i++; break }
      if (i >= n) { fixes.add('auto-closed brackets'); break }
      fixes.add('inserted missing commas')
    }
    return arr
  }

  try {
    skip()
    const v = value()
    skip()
    if (i < n) fixes.add('dropped trailing content')
    return { ok: true, value: v, fixes: [...fixes] }
  } catch (e) {
    return { ok: false, fixes: [...fixes], error: e instanceof Error ? e.message : 'Could not repair the input.' }
  }
}

function countKeys(v: unknown): number {
  if (Array.isArray(v)) return v.reduce<number>((n, x) => n + countKeys(x), 0)
  if (v && typeof v === 'object') {
    const keys = Object.keys(v as Record<string, unknown>)
    return keys.reduce<number>((n, k) => n + countKeys((v as Record<string, unknown>)[k]), keys.length)
  }
  return 0
}

/** Recursively sort object keys for a stable, diff-friendly output. */
function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortDeep((v as Record<string, unknown>)[k])
    }
    return out
  }
  return v
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function isPrimitive(v: unknown): boolean {
  return v === null || typeof v !== 'object'
}

// ── JSON → YAML ──────────────────────────────────────────────
const YAML_PLAIN = /^[A-Za-z0-9][\w .\-/@]*$/
function yamlNeedsQuote(s: string): boolean {
  if (s === '') return true
  if (/^\s|\s$/.test(s)) return true
  if (/[:#[\]{}&*!|>'"%@`,]/.test(s)) return true
  if (/[\n\t]/.test(s)) return true
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(s)) return true
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return true
  if (!YAML_PLAIN.test(s)) return true
  return false
}
function yamlScalar(v: unknown): string {
  if (v === null) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null'
  const s = String(v)
  return yamlNeedsQuote(s) ? JSON.stringify(s) : s
}
function yamlBlock(value: unknown, indent: number): string {
  const pad = '  '.repeat(indent)
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`
    return value.map((item) => {
      if (isPrimitive(item)) return `${pad}- ${yamlScalar(item)}`
      const inner = yamlBlock(item, indent + 1)
      const stripped = inner.replace('  '.repeat(indent + 1), '')
      return `${pad}- ${stripped}`
    }).join('\n')
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj)
    if (keys.length === 0) return `${pad}{}`
    return keys.map((k) => {
      const v = obj[k]
      const key = yamlNeedsQuote(k) ? JSON.stringify(k) : k
      if (isPrimitive(v)) return `${pad}${key}: ${yamlScalar(v)}`
      if (Array.isArray(v) && v.length === 0) return `${pad}${key}: []`
      if (!Array.isArray(v) && Object.keys(v as object).length === 0) return `${pad}${key}: {}`
      // arrays render block-style at the same indent as the key; objects indent +1
      const childIndent = Array.isArray(v) ? indent : indent + 1
      return `${pad}${key}:\n${yamlBlock(v, childIndent)}`
    }).join('\n')
  }
  return `${pad}${yamlScalar(value)}`
}
function toYaml(value: unknown): string {
  if (isPrimitive(value)) return yamlScalar(value)
  return yamlBlock(value, 0)
}

// ── JSON → CSV ───────────────────────────────────────────────
function flatten(obj: unknown, prefix: string, out: Record<string, unknown>): Record<string, unknown> {
  if (obj === null || typeof obj !== 'object') {
    out[prefix] = obj
    return out
  }
  if (Array.isArray(obj)) {
    out[prefix] = JSON.stringify(obj)
    return out
  }
  const rec = obj as Record<string, unknown>
  const keys = Object.keys(rec)
  if (keys.length === 0) { out[prefix] = ''; return out }
  for (const k of keys) flatten(rec[k], prefix ? `${prefix}.${k}` : k, out)
  return out
}
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}
function toCsv(value: unknown): string {
  const rows = Array.isArray(value) ? value : [value]
  if (rows.every(isPrimitive)) {
    const body = rows.map((r) => csvCell(r)).join('\n')
    return rows.length ? `value\n${body}` : 'value'
  }
  const flat = rows.map((r) => (isPrimitive(r) ? { value: r } : flatten(r, '', {})))
  const headers: string[] = []
  const seen = new Set<string>()
  for (const row of flat) for (const k of Object.keys(row)) if (!seen.has(k)) { seen.add(k); headers.push(k) }
  const head = headers.map(csvCell).join(',')
  const body = flat.map((row) => headers.map((h) => csvCell((row as Record<string, unknown>)[h])).join(',')).join('\n')
  return body ? `${head}\n${body}` : head
}

// ── JSON → XML ───────────────────────────────────────────────
function xmlEscape(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function xmlName(k: string): string {
  let n = String(k).replace(/[^A-Za-z0-9_.\-]/g, '_')
  if (!n || /^[^A-Za-z_]/.test(n)) n = '_' + n
  return n
}
function xmlNode(name: string, value: unknown, indent: number): string {
  const pad = '  '.repeat(indent)
  if (value === null || value === undefined) return `${pad}<${name}/>`
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}<${name}/>`
    return value.map((item) => xmlNode(name, item, indent)).join('\n')
  }
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>
    const keys = Object.keys(rec)
    if (keys.length === 0) return `${pad}<${name}/>`
    const inner = keys.map((k) => xmlNode(xmlName(k), rec[k], indent + 1)).join('\n')
    return `${pad}<${name}>\n${inner}\n${pad}</${name}>`
  }
  return `${pad}<${name}>${xmlEscape(value)}</${name}>`
}
function toXml(value: unknown, root = 'root'): string {
  const header = '<?xml version="1.0" encoding="UTF-8"?>'
  let body: string
  if (Array.isArray(value)) {
    const inner = value.map((item) => xmlNode('item', item, 1)).join('\n')
    body = value.length ? `<${root}>\n${inner}\n</${root}>` : `<${root}/>`
  } else {
    body = xmlNode(root, value, 0)
  }
  return `${header}\n${body}`
}

// ── Tree view helpers ────────────────────────────────────────
/** Build a JS-style path to a child (used for the "copy path" affordance). */
function childPath(parent: string, key: string | number): string {
  if (typeof key === 'number') return `${parent}[${key}]`
  if (/^[A-Za-z_$][\w$]*$/.test(key)) return `${parent}.${key}`
  return `${parent}[${JSON.stringify(key)}]`
}

/** Count nodes with an early bail so huge structures don't stall the walk. */
function exceedsNodeCap(v: unknown, cap: number): boolean {
  let count = 0
  const walk = (x: unknown): void => {
    if (count > cap) return
    count++
    if (Array.isArray(x)) {
      for (const item of x) { if (count > cap) return; walk(item) }
    } else if (x && typeof x === 'object') {
      for (const k of Object.keys(x as Record<string, unknown>)) {
        if (count > cap) return
        walk((x as Record<string, unknown>)[k])
      }
    }
  }
  walk(v)
  return count > cap
}

function makeSpan(dtype: string, text?: string): HTMLSpanElement {
  const s = document.createElement('span')
  s.dataset.type = dtype
  if (text !== undefined) s.textContent = text
  return s
}

// ── Compare / diff helpers ───────────────────────────────────
type JtMode = 'format' | 'compare'
type JtDiffKind = 'added' | 'removed' | 'changed'
interface JtDiffEntry { path: string; kind: JtDiffKind; before?: unknown; after?: unknown }

/** Structural deep-equality for parsed JSON values (order-sensitive for arrays). */
function jtDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return a === b
  if (typeof a !== 'object' || typeof b !== 'object') return a === b
  const aArr = Array.isArray(a)
  if (aArr !== Array.isArray(b)) return false
  if (aArr) {
    const x = a as unknown[], y = b as unknown[]
    if (x.length !== y.length) return false
    for (let i = 0; i < x.length; i++) if (!jtDeepEqual(x[i], y[i])) return false
    return true
  }
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>
  const xk = Object.keys(x), yk = Object.keys(y)
  if (xk.length !== yk.length) return false
  for (const k of xk) {
    if (!Object.prototype.hasOwnProperty.call(y, k)) return false
    if (!jtDeepEqual(x[k], y[k])) return false
  }
  return true
}

/** Compact, single-line rendering of a value for a diff row (truncated). */
function jtCompact(v: unknown): string {
  let s: string
  if (v === null) s = 'null'
  else if (typeof v === 'string') s = JSON.stringify(v)
  else if (typeof v === 'object') s = JSON.stringify(v)
  else s = String(v)
  return s.length > 140 ? s.slice(0, 139) + '…' : s
}

/**
 * Walk two parsed JSON values in parallel and collect the differences that turn
 * `a` (before) into `b` (after). Objects compare by key (union), arrays by index;
 * a shape/type mismatch or a differing primitive yields one `changed` entry at
 * that path. Equal subtrees produce nothing. Entries come out in document order.
 */
function jtDiff(a: unknown, b: unknown, path: string, out: JtDiffEntry[]): void {
  if (jtDeepEqual(a, b)) return
  const aObj = a !== null && typeof a === 'object'
  const bObj = b !== null && typeof b === 'object'
  const aArr = Array.isArray(a)
  const bArr = Array.isArray(b)
  if (aObj && bObj && aArr === bArr) {
    if (aArr) {
      const x = a as unknown[], y = b as unknown[]
      const len = Math.max(x.length, y.length)
      for (let i = 0; i < len; i++) {
        const p = childPath(path, i)
        if (i >= x.length) out.push({ path: p, kind: 'added', after: y[i] })
        else if (i >= y.length) out.push({ path: p, kind: 'removed', before: x[i] })
        else jtDiff(x[i], y[i], p, out)
      }
    } else {
      const x = a as Record<string, unknown>, y = b as Record<string, unknown>
      const seen = new Set<string>()
      for (const k of [...Object.keys(x), ...Object.keys(y)]) {
        if (seen.has(k)) continue
        seen.add(k)
        const p = childPath(path, k)
        const inA = Object.prototype.hasOwnProperty.call(x, k)
        const inB = Object.prototype.hasOwnProperty.call(y, k)
        if (!inA) out.push({ path: p, kind: 'added', after: y[k] })
        else if (!inB) out.push({ path: p, kind: 'removed', before: x[k] })
        else jtDiff(x[k], y[k], p, out)
      }
    }
  } else {
    // Differing primitive, or an object↔array↔primitive shape change.
    out.push({ path, kind: 'changed', before: a, after: b })
  }
}

class JsonTidyTool extends HTMLElement {
  private indent: Indent = '2'
  private sort = false
  private auto = false
  private debounce = 0

  private output = ''
  private outputKind: OutputKind | null = null

  private view: ViewMode = 'text'
  private collapsed = new Set<string>()
  private treeReady = false

  private query = ''
  private searchHits: HTMLElement[] = []
  private activeMatch = -1
  private searchDebounce = 0

  private input!: HTMLTextAreaElement
  private fileInput!: HTMLInputElement
  private statusEl!: HTMLElement
  private errorEl!: HTMLElement
  private repairBtn!: HTMLButtonElement
  private repairEl!: HTMLElement
  private repairMsgEl!: HTMLElement
  private repairApplyBtn!: HTMLButtonElement
  private metaEl!: HTMLElement
  private outEl!: HTMLElement
  private treeEl!: HTMLElement
  private outTitleEl!: HTMLElement
  private copyBtn!: HTMLButtonElement
  private downloadBtn!: HTMLButtonElement
  private expandAllBtn!: HTMLButtonElement
  private collapseAllBtn!: HTMLButtonElement
  private searchBar!: HTMLElement
  private searchInput!: HTMLInputElement
  private searchCountEl!: HTMLElement
  private searchPrevBtn!: HTMLButtonElement
  private searchNextBtn!: HTMLButtonElement
  private searchClearBtn!: HTMLButtonElement

  // Compare mode.
  private mode: JtMode = 'format'
  private cmpDebounce = 0
  private diffRows: HTMLElement[] = []
  private activeDiff = -1
  private root!: HTMLElement
  private modeFormatBtn!: HTMLButtonElement
  private modeCompareBtn!: HTMLButtonElement
  private cmpA!: HTMLTextAreaElement
  private cmpB!: HTMLTextAreaElement
  private cmpStatusA!: HTMLElement
  private cmpStatusB!: HTMLElement
  private diffSummaryEl!: HTMLElement
  private diffEl!: HTMLElement
  private diffPrevBtn!: HTMLButtonElement
  private diffNextBtn!: HTMLButtonElement
  private diffCopyBtn!: HTMLButtonElement

  connectedCallback() {
    this.indent = (this.readLS(LS_INDENT) as Indent) || '2'
    if (!['2', '3', '4', 'tab'].includes(this.indent)) this.indent = '2'
    this.sort = this.readLS(LS_SORT) === '1'
    this.auto = this.readLS(LS_AUTO) === '1'
    this.view = this.readLS(LS_VIEW) === 'tree' ? 'tree' : 'text'
    this.query = this.readLS(LS_SEARCH) || ''
    this.mode = this.readLS(LS_MODE) === 'compare' ? 'compare' : 'format'

    this.innerHTML = `
      <div data-type="tool-page" data-tool="json-tidy">
        <div data-type="tool-header">
          <h1>JSON Tidy</h1>
          <p>Paste JSON to format, validate, minify, repair broken JSON, explore in a searchable collapsible tree, convert it to YAML, CSV, or XML, or compare two documents to see exactly what changed — instantly, in your browser. Errors are pinpointed by line and column; nothing is uploaded.</p>
        </div>

        <div data-group="mode-toggle" role="group" aria-label="Tool mode">
          <button data-mode-btn="format" type="button" aria-pressed="true">Format &amp; view</button>
          <button data-mode-btn="compare" type="button" aria-pressed="false">Compare</button>
        </div>

        <div data-group="toolbar">
          <button data-action="format" type="button">Format</button>
          <button data-action="minify" type="button">Minify</button>
          <button data-action="stringify" type="button">Stringify</button>
          <button data-action="repair" type="button" title="Fix common JSON mistakes — single quotes, trailing commas, unquoted keys, comments, Python True/False/None…  (Ctrl/Cmd + Shift + Enter)">Repair</button>
          <span data-type="jt-sep" aria-hidden="true"></span>
          <button data-action="to-yaml" type="button">→ YAML</button>
          <button data-action="to-csv" type="button">→ CSV</button>
          <button data-action="to-xml" type="button">→ XML</button>
          <span data-type="jt-sep" aria-hidden="true"></span>
          <label data-type="jt-field">
            <span>Indent</span>
            <select data-control="indent" aria-label="Indent size">
              <option value="2">2 spaces</option>
              <option value="3">3 spaces</option>
              <option value="4">4 spaces</option>
              <option value="tab">Tab</option>
            </select>
          </label>
          <label data-type="jt-field" data-variant="check">
            <input data-control="sort" type="checkbox" />
            <span>Sort keys</span>
          </label>
          <label data-type="jt-field" data-variant="check">
            <input data-control="auto" type="checkbox" />
            <span>Auto-format</span>
          </label>
        </div>

        <div data-type="jt-panes">
          <section data-type="jt-pane" data-side="input">
            <div data-type="jt-pane-head">
              <span data-type="jt-pane-title">Input</span>
              <div data-group="pane-actions">
                <button data-action="upload" type="button">Upload</button>
                <button data-action="sample" type="button">Sample</button>
                <button data-action="clear" type="button">Clear</button>
              </div>
            </div>
            <textarea
              data-type="jt-input"
              spellcheck="false"
              autocomplete="off"
              autocapitalize="off"
              autocorrect="off"
              aria-label="JSON input"
              placeholder="Paste or type JSON here…  (Ctrl/Cmd + Enter to format)"
            ></textarea>
            <input data-control="file" type="file" accept=".json,.txt,application/json,text/plain" hidden aria-hidden="true" />
            <div data-type="jt-statusbar">
              <span data-type="jt-status" role="status" aria-live="polite"></span>
              <span data-type="jt-meta"></span>
            </div>
            <pre data-type="jt-error" hidden></pre>
            <div data-type="jt-repair" hidden>
              <span data-type="jt-repair-msg" role="status" aria-live="polite"></span>
              <button data-action="repair-apply" type="button" title="Replace the input on the left with the repaired JSON">Apply to input ↩</button>
            </div>
          </section>

          <section data-type="jt-pane" data-side="output">
            <div data-type="jt-pane-head">
              <div data-group="view-toggle" role="group" aria-label="Output view">
                <button data-view="text" type="button" aria-pressed="true">Text</button>
                <button data-view="tree" type="button" aria-pressed="false">Tree</button>
              </div>
              <span data-type="jt-pane-title" data-control="out-title">Output</span>
              <div data-group="pane-actions">
                <button data-action="expand-all" type="button" hidden>Expand all</button>
                <button data-action="collapse-all" type="button" hidden>Collapse all</button>
                <button data-action="copy" type="button">Copy</button>
                <button data-action="download" type="button">Download</button>
              </div>
            </div>
            <div data-type="jt-search" hidden>
              <input
                data-control="tree-search"
                type="search"
                spellcheck="false"
                autocomplete="off"
                autocapitalize="off"
                autocorrect="off"
                aria-label="Search keys and values in the tree"
                placeholder="Search keys &amp; values…  (Enter / Shift+Enter to step, Esc to clear)"
              />
              <span data-type="jt-search-count" role="status" aria-live="polite"></span>
              <div data-group="search-nav">
                <button data-action="search-prev" type="button" aria-label="Previous match" title="Previous match (Shift+Enter)" disabled>↑</button>
                <button data-action="search-next" type="button" aria-label="Next match" title="Next match (Enter)" disabled>↓</button>
                <button data-action="search-clear" type="button" aria-label="Clear search" title="Clear search (Esc)" disabled>✕</button>
              </div>
            </div>
            <pre data-type="jt-output" tabindex="0" aria-label="Conversion output"></pre>
            <div data-type="jt-tree" role="tree" aria-label="JSON tree view" hidden></div>
          </section>
        </div>

        <div data-type="jt-compare">
          <div data-type="jt-compare-inputs">
            <section data-type="jt-pane" data-side="a">
              <div data-type="jt-pane-head">
                <span data-type="jt-pane-title">Input A · original</span>
                <div data-group="pane-actions">
                  <button data-action="cmp-swap" type="button" title="Swap A and B">Swap ⇄</button>
                  <button data-action="cmp-clear" type="button">Clear both</button>
                </div>
              </div>
              <textarea
                data-type="jt-input"
                data-control="cmp-a"
                spellcheck="false"
                autocomplete="off"
                autocapitalize="off"
                autocorrect="off"
                aria-label="JSON input A (original)"
                placeholder="Paste the original JSON here…"
              ></textarea>
              <div data-type="jt-statusbar">
                <span data-type="jt-status" data-control="cmp-status-a" role="status" aria-live="polite"></span>
              </div>
            </section>

            <section data-type="jt-pane" data-side="b">
              <div data-type="jt-pane-head">
                <span data-type="jt-pane-title">Input B · changed</span>
                <div data-group="pane-actions">
                  <button data-action="cmp-example" type="button">Load example</button>
                </div>
              </div>
              <textarea
                data-type="jt-input"
                data-control="cmp-b"
                spellcheck="false"
                autocomplete="off"
                autocapitalize="off"
                autocorrect="off"
                aria-label="JSON input B (changed)"
                placeholder="Paste the JSON to compare against…"
              ></textarea>
              <div data-type="jt-statusbar">
                <span data-type="jt-status" data-control="cmp-status-b" role="status" aria-live="polite"></span>
              </div>
            </section>
          </div>

          <div data-type="jt-diff-head">
            <span data-type="jt-diff-summary" role="status" aria-live="polite"></span>
            <div data-group="pane-actions">
              <button data-action="diff-prev" type="button" aria-label="Previous difference" title="Previous difference" disabled>↑</button>
              <button data-action="diff-next" type="button" aria-label="Next difference" title="Next difference" disabled>↓</button>
              <button data-action="diff-copy" type="button" disabled>Copy diff</button>
            </div>
          </div>
          <div data-type="jt-diff" tabindex="0" role="list" aria-label="Differences between A and B"></div>
        </div>
      </div>
    `

    this.input = this.querySelector('[data-type="jt-input"]') as HTMLTextAreaElement
    this.fileInput = this.querySelector('[data-control="file"]') as HTMLInputElement
    this.statusEl = this.querySelector('[data-type="jt-status"]') as HTMLElement
    this.errorEl = this.querySelector('[data-type="jt-error"]') as HTMLElement
    this.repairBtn = this.querySelector('[data-action="repair"]') as HTMLButtonElement
    this.repairEl = this.querySelector('[data-type="jt-repair"]') as HTMLElement
    this.repairMsgEl = this.querySelector('[data-type="jt-repair-msg"]') as HTMLElement
    this.repairApplyBtn = this.querySelector('[data-action="repair-apply"]') as HTMLButtonElement
    this.metaEl = this.querySelector('[data-type="jt-meta"]') as HTMLElement
    this.outEl = this.querySelector('[data-type="jt-output"]') as HTMLElement
    this.treeEl = this.querySelector('[data-type="jt-tree"]') as HTMLElement
    this.outTitleEl = this.querySelector('[data-control="out-title"]') as HTMLElement
    this.copyBtn = this.querySelector('[data-action="copy"]') as HTMLButtonElement
    this.downloadBtn = this.querySelector('[data-action="download"]') as HTMLButtonElement
    this.expandAllBtn = this.querySelector('[data-action="expand-all"]') as HTMLButtonElement
    this.collapseAllBtn = this.querySelector('[data-action="collapse-all"]') as HTMLButtonElement
    this.searchBar = this.querySelector('[data-type="jt-search"]') as HTMLElement
    this.searchInput = this.querySelector('[data-control="tree-search"]') as HTMLInputElement
    this.searchCountEl = this.querySelector('[data-type="jt-search-count"]') as HTMLElement
    this.searchPrevBtn = this.querySelector('[data-action="search-prev"]') as HTMLButtonElement
    this.searchNextBtn = this.querySelector('[data-action="search-next"]') as HTMLButtonElement
    this.searchClearBtn = this.querySelector('[data-action="search-clear"]') as HTMLButtonElement
    this.root = this.querySelector('[data-type="tool-page"]') as HTMLElement
    this.modeFormatBtn = this.querySelector('[data-mode-btn="format"]') as HTMLButtonElement
    this.modeCompareBtn = this.querySelector('[data-mode-btn="compare"]') as HTMLButtonElement
    this.cmpA = this.querySelector('[data-control="cmp-a"]') as HTMLTextAreaElement
    this.cmpB = this.querySelector('[data-control="cmp-b"]') as HTMLTextAreaElement
    this.cmpStatusA = this.querySelector('[data-control="cmp-status-a"]') as HTMLElement
    this.cmpStatusB = this.querySelector('[data-control="cmp-status-b"]') as HTMLElement
    this.diffSummaryEl = this.querySelector('[data-type="jt-diff-summary"]') as HTMLElement
    this.diffEl = this.querySelector('[data-type="jt-diff"]') as HTMLElement
    this.diffPrevBtn = this.querySelector('[data-action="diff-prev"]') as HTMLButtonElement
    this.diffNextBtn = this.querySelector('[data-action="diff-next"]') as HTMLButtonElement
    this.diffCopyBtn = this.querySelector('[data-action="diff-copy"]') as HTMLButtonElement

    // Restore prior session.
    const saved = this.readLS(LS_INPUT)
    if (saved) this.input.value = saved
    const savedB = this.readLS(LS_INPUT_B)
    if (savedB) this.cmpB.value = savedB
    const savedA = this.readLS(LS_INPUT_A)
    if (savedA) this.cmpA.value = savedA
    this.searchInput.value = this.query
    ;(this.querySelector('[data-control="indent"]') as HTMLSelectElement).value = this.indent
    ;(this.querySelector('[data-control="sort"]') as HTMLInputElement).checked = this.sort
    ;(this.querySelector('[data-control="auto"]') as HTMLInputElement).checked = this.auto

    this.wire()
    this.renderOutput()
    this.validate()
    if (this.auto) this.maybeAutoFormat()
    this.setView(this.view)
    this.setMode(this.mode, false)
  }

  disconnectedCallback() {
    if (this.debounce) clearTimeout(this.debounce)
    if (this.searchDebounce) clearTimeout(this.searchDebounce)
    if (this.cmpDebounce) clearTimeout(this.cmpDebounce)
  }

  private wire() {
    this.input.addEventListener('input', () => this.scheduleUpdate())
    this.input.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && e.shiftKey) {
        e.preventDefault()
        this.repair()
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        this.produce('format')
      } else if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        this.insertAtCursor('\t')
      }
    })

    const op = (sel: string, kind: OutputKind) =>
      this.querySelector(sel)!.addEventListener('click', () => this.produce(kind))
    op('[data-action="format"]', 'format')
    op('[data-action="minify"]', 'minify')
    op('[data-action="stringify"]', 'stringify')
    op('[data-action="to-yaml"]', 'yaml')
    op('[data-action="to-csv"]', 'csv')
    op('[data-action="to-xml"]', 'xml')

    this.repairBtn.addEventListener('click', () => this.repair())
    this.repairApplyBtn.addEventListener('click', () => this.applyRepair())

    this.copyBtn.addEventListener('click', () => this.copy())
    this.downloadBtn.addEventListener('click', () => this.download())

    this.querySelector('[data-view="text"]')!.addEventListener('click', () => this.setView('text'))
    this.querySelector('[data-view="tree"]')!.addEventListener('click', () => this.setView('tree'))
    this.expandAllBtn.addEventListener('click', () => this.expandAll())
    this.collapseAllBtn.addEventListener('click', () => this.collapseAll())

    // Tree search: highlight matches, auto-expand ancestors, step through hits.
    this.searchInput.addEventListener('input', () => {
      if (this.searchDebounce) clearTimeout(this.searchDebounce)
      this.searchDebounce = window.setTimeout(() => {
        this.searchDebounce = 0
        this.applySearch(this.searchInput.value, true)
      }, 120)
    })
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        this.gotoMatch(e.shiftKey ? -1 : 1)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        this.clearSearch()
      }
    })
    this.searchPrevBtn.addEventListener('click', () => this.gotoMatch(-1))
    this.searchNextBtn.addEventListener('click', () => this.gotoMatch(1))
    this.searchClearBtn.addEventListener('click', () => { this.clearSearch(); this.searchInput.focus() })

    // Delegated tree interaction: toggles expand/collapse; key clicks copy the path.
    this.treeEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement
      const toggle = target.closest('[data-type="jt-toggle"]')
      if (toggle) {
        this.toggleNode(toggle.closest('[data-branch]') as HTMLElement | null)
        return
      }
      const key = target.closest('[data-type="jt-key"]') as HTMLElement | null
      if (key && key.dataset.path) this.copyPath(key)
    })
    this.treeEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      const target = e.target as HTMLElement
      if (target.dataset.type === 'jt-key' && target.dataset.path) {
        e.preventDefault()
        this.copyPath(target)
      }
    })

    this.querySelector('[data-action="upload"]')!.addEventListener('click', () => this.fileInput.click())
    this.fileInput.addEventListener('change', () => this.loadFile())

    this.querySelector('[data-action="sample"]')!.addEventListener('click', () => {
      this.input.value = SAMPLE
      this.hideRepair()
      this.persist()
      this.validate()
      this.input.focus()
      this.maybeAutoFormat()
      if (this.view === 'tree') this.renderTree()
    })
    this.querySelector('[data-action="clear"]')!.addEventListener('click', () => {
      this.input.value = ''
      this.collapsed.clear()
      this.hideRepair()
      this.persist()
      this.validate()
      this.setOutput('', null)
      this.input.focus()
      if (this.view === 'tree') this.renderTree()
    })

    const indentSel = this.querySelector('[data-control="indent"]') as HTMLSelectElement
    indentSel.addEventListener('change', () => {
      this.indent = indentSel.value as Indent
      this.writeLS(LS_INDENT, this.indent)
      this.reflowOutput()
    })
    const sortChk = this.querySelector('[data-control="sort"]') as HTMLInputElement
    sortChk.addEventListener('change', () => {
      this.sort = sortChk.checked
      this.writeLS(LS_SORT, this.sort ? '1' : '0')
      this.reflowOutput()
    })
    const autoChk = this.querySelector('[data-control="auto"]') as HTMLInputElement
    autoChk.addEventListener('change', () => {
      this.auto = autoChk.checked
      this.writeLS(LS_AUTO, this.auto ? '1' : '0')
      if (this.auto) this.produce('format', true)
    })

    // ── Compare mode ──
    this.modeFormatBtn.addEventListener('click', () => this.setMode('format'))
    this.modeCompareBtn.addEventListener('click', () => this.setMode('compare'))
    this.cmpA.addEventListener('input', () => this.scheduleCompare())
    this.cmpB.addEventListener('input', () => this.scheduleCompare())
    ;[this.cmpA, this.cmpB].forEach((ta) =>
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault()
          this.insertInto(ta, '\t')
        }
      }),
    )
    this.querySelector('[data-action="cmp-example"]')!.addEventListener('click', () => {
      this.cmpA.value = CMP_SAMPLE_A
      this.cmpB.value = CMP_SAMPLE_B
      this.persistCompare()
      this.computeDiff()
    })
    this.querySelector('[data-action="cmp-clear"]')!.addEventListener('click', () => {
      this.cmpA.value = ''
      this.cmpB.value = ''
      this.persistCompare()
      this.computeDiff()
      this.cmpA.focus()
    })
    this.querySelector('[data-action="cmp-swap"]')!.addEventListener('click', () => {
      const tmp = this.cmpA.value
      this.cmpA.value = this.cmpB.value
      this.cmpB.value = tmp
      this.persistCompare()
      this.computeDiff()
    })
    this.diffPrevBtn.addEventListener('click', () => this.gotoDiff(-1))
    this.diffNextBtn.addEventListener('click', () => this.gotoDiff(1))
    this.diffCopyBtn.addEventListener('click', () => this.copyDiff())
    this.diffEl.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); this.gotoDiff(1) }
      else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); this.gotoDiff(-1) }
    })
  }

  private insertAtCursor(text: string) {
    const el = this.input
    const start = el.selectionStart
    const end = el.selectionEnd
    el.value = el.value.slice(0, start) + text + el.value.slice(end)
    el.selectionStart = el.selectionEnd = start + text.length
    this.scheduleUpdate()
  }

  private insertInto(el: HTMLTextAreaElement, text: string) {
    const start = el.selectionStart
    const end = el.selectionEnd
    el.value = el.value.slice(0, start) + text + el.value.slice(end)
    el.selectionStart = el.selectionEnd = start + text.length
    this.scheduleCompare()
  }

  // ── Compare mode ─────────────────────────────────────────────
  private setMode(mode: JtMode, persist = true) {
    this.mode = mode
    this.root.dataset.mode = mode
    if (persist) this.writeLS(LS_MODE, mode)
    const compare = mode === 'compare'
    this.modeFormatBtn.setAttribute('aria-pressed', String(!compare))
    this.modeCompareBtn.setAttribute('aria-pressed', String(compare))
    if (compare) {
      // Continuity: on a fresh compare, seed side A with whatever you were formatting.
      if (!this.cmpA.value && !this.cmpB.value && this.input.value.trim()) {
        this.cmpA.value = this.input.value
        this.persistCompare()
      }
      this.computeDiff()
    }
  }

  private scheduleCompare() {
    if (this.cmpDebounce) clearTimeout(this.cmpDebounce)
    this.cmpDebounce = window.setTimeout(() => {
      this.cmpDebounce = 0
      this.persistCompare()
      this.computeDiff()
    }, 200)
  }

  /** Validate one compare side, reflect its status line, and return the parsed value. */
  private diffSide(src: string, statusEl: HTMLElement): { state: 'empty' | 'ok' | 'err'; value?: unknown } {
    if (!src.trim()) {
      statusEl.dataset.state = 'idle'
      statusEl.textContent = 'Empty'
      return { state: 'empty' }
    }
    const res = analyze(src)
    if (res.ok) {
      const keys = countKeys(res.value)
      statusEl.dataset.state = 'ok'
      statusEl.textContent = `Valid · ${keys} ${keys === 1 ? 'key' : 'keys'}`
      return { state: 'ok', value: res.value }
    }
    const where = res.line ? `line ${res.line}, col ${res.col}` : 'parse error'
    statusEl.dataset.state = 'err'
    statusEl.textContent = `Invalid · ${where}`
    return { state: 'err' }
  }

  private computeDiff() {
    const a = this.diffSide(this.cmpA.value, this.cmpStatusA)
    const b = this.diffSide(this.cmpB.value, this.cmpStatusB)
    this.diffRows = []
    this.activeDiff = -1

    if (a.state === 'empty' || b.state === 'empty') {
      this.diffNotice('Paste JSON into both panes to see what changed — or press “Load example”.')
      this.setDiffSummary('', null)
      this.updateDiffNav()
      return
    }
    if (a.state === 'err' || b.state === 'err') {
      const which =
        a.state === 'err' && b.state === 'err' ? 'Both inputs are' : a.state === 'err' ? 'Input A is' : 'Input B is'
      this.diffNotice(`${which} not valid JSON — fix it to compare. The line under each pane pinpoints the error.`)
      this.setDiffSummary('', null)
      this.updateDiffNav()
      return
    }

    const entries: JtDiffEntry[] = []
    jtDiff(a.value, b.value, '$', entries)
    if (entries.length === 0) {
      this.diffNotice('The two documents are identical — every key and value matches.')
      this.setDiffSummary('Identical — no differences', 'same')
      this.updateDiffNav()
      return
    }
    this.renderDiff(entries)
  }

  private renderDiff(entries: JtDiffEntry[]) {
    let added = 0, removed = 0, changed = 0
    for (const e of entries) {
      if (e.kind === 'added') added++
      else if (e.kind === 'removed') removed++
      else changed++
    }
    const total = entries.length
    const capped = entries.slice(0, MAX_DIFF_ROWS)
    const frag = document.createDocumentFragment()
    for (const e of capped) frag.append(this.buildDiffRow(e))
    this.diffEl.replaceChildren(frag)
    if (total > capped.length) {
      const more = document.createElement('div')
      more.dataset.type = 'jt-diff-more'
      more.textContent = `…and ${(total - capped.length).toLocaleString()} more (showing the first ${MAX_DIFF_ROWS.toLocaleString()}).`
      this.diffEl.append(more)
    }
    this.diffRows = Array.from(this.diffEl.querySelectorAll<HTMLElement>('[data-type="jt-diff-row"]'))
    this.activeDiff = this.diffRows.length ? 0 : -1
    this.markActiveDiff()
    this.setDiffSummary(
      `${total} ${total === 1 ? 'difference' : 'differences'} · ${added} added · ${removed} removed · ${changed} changed`,
      'diff',
    )
    this.updateDiffNav()
  }

  private buildDiffRow(e: JtDiffEntry): HTMLElement {
    const row = document.createElement('div')
    row.dataset.type = 'jt-diff-row'
    row.dataset.kind = e.kind
    row.setAttribute('role', 'listitem')
    const sign = e.kind === 'added' ? '+' : e.kind === 'removed' ? '−' : '~'
    row.append(makeSpan('jt-diff-sign', sign))
    row.append(makeSpan('jt-diff-path', e.path))
    const val = makeSpan('jt-diff-val')
    if (e.kind === 'added') val.textContent = jtCompact(e.after)
    else if (e.kind === 'removed') val.textContent = jtCompact(e.before)
    else {
      val.append(makeSpan('jt-diff-before', jtCompact(e.before)))
      val.append(makeSpan('jt-diff-arrow', ' → '))
      val.append(makeSpan('jt-diff-after', jtCompact(e.after)))
    }
    row.append(val)
    return row
  }

  private diffNotice(msg: string) {
    const div = document.createElement('div')
    div.dataset.type = 'jt-diff-empty'
    div.textContent = msg
    this.diffEl.replaceChildren(div)
    this.diffRows = []
    this.activeDiff = -1
  }

  private setDiffSummary(text: string, state: 'diff' | 'same' | null) {
    this.diffSummaryEl.textContent = text
    if (state) this.diffSummaryEl.dataset.state = state
    else this.diffSummaryEl.removeAttribute('data-state')
  }

  private markActiveDiff() {
    this.diffRows.forEach((r, i) => {
      if (i === this.activeDiff) r.dataset.active = ''
      else r.removeAttribute('data-active')
    })
  }

  private gotoDiff(dir: number) {
    if (!this.diffRows.length) return
    this.activeDiff = (this.activeDiff + dir + this.diffRows.length) % this.diffRows.length
    this.markActiveDiff()
    this.diffRows[this.activeDiff]?.scrollIntoView({ block: 'nearest' })
    this.updateDiffNav()
  }

  private updateDiffNav() {
    const has = this.diffRows.length > 0
    this.diffPrevBtn.disabled = !has
    this.diffNextBtn.disabled = !has
    this.diffCopyBtn.disabled = !has
  }

  private async copyDiff() {
    if (!this.diffRows.length) return
    const lines = this.diffRows.map((r) => {
      const sign = r.querySelector('[data-type="jt-diff-sign"]')?.textContent ?? ''
      const path = r.querySelector('[data-type="jt-diff-path"]')?.textContent ?? ''
      const val = r.querySelector('[data-type="jt-diff-val"]')?.textContent ?? ''
      const joiner = r.dataset.kind === 'changed' ? ':' : ' ='
      return `${sign} ${path}${joiner} ${val}`
    })
    const header = this.diffSummaryEl.textContent || 'JSON diff'
    const text = `JSON diff (A → B)\n${header}\n\n${lines.join('\n')}\n`
    try {
      await navigator.clipboard.writeText(text)
      this.flash(this.diffCopyBtn, 'Copied!')
    } catch {
      this.flash(this.diffCopyBtn, 'Copy failed')
    }
  }

  private persistCompare() {
    try {
      const a = this.cmpA.value
      const b = this.cmpB.value
      if (a.length <= MAX_PERSIST) localStorage.setItem(LS_INPUT_A, a)
      else localStorage.removeItem(LS_INPUT_A)
      if (b.length <= MAX_PERSIST) localStorage.setItem(LS_INPUT_B, b)
      else localStorage.removeItem(LS_INPUT_B)
    } catch { /* ignore quota/private-mode errors */ }
  }

  private scheduleUpdate() {
    // The repaired result is stale the moment the input changes.
    this.hideRepair()
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = window.setTimeout(() => {
      this.debounce = 0
      this.validate()
      this.persist()
      this.maybeAutoFormat()
      if (this.view === 'tree') this.renderTree()
    }, 180)
  }

  private maybeAutoFormat() {
    if (!this.auto) return
    if (!this.input.value.trim()) { this.setOutput('', null); return }
    this.produce('format', true)
  }

  /** Re-run the current output operation when indent/sort change. */
  private reflowOutput() {
    if (this.outputKind === 'repair' && this.repairEl && !this.repairEl.hidden) this.repair()
    else if (this.outputKind && this.input.value.trim()) this.produce(this.outputKind, true)
    if (this.view === 'tree') this.renderTree()
  }

  private validate() {
    const src = this.input.value
    if (!src.trim()) {
      this.setStatus('idle', 'Awaiting JSON…')
      this.metaEl.textContent = ''
      this.errorEl.hidden = true
      return
    }
    const res = analyze(src)
    if (res.ok) {
      const keys = countKeys(res.value)
      const bytes = byteLength(src)
      this.setStatus('ok', 'Valid JSON')
      this.metaEl.textContent = `${keys} ${keys === 1 ? 'key' : 'keys'} · ${formatBytes(bytes)}`
      this.errorEl.hidden = true
    } else {
      const where = res.line ? `Line ${res.line}, Column ${res.col}` : 'Parse error'
      this.setStatus('err', `Invalid · ${where}`)
      this.metaEl.textContent = res.message || ''
      this.renderError(src, res)
    }
  }

  private renderError(src: string, res: ParseResult) {
    if (!res.line) {
      this.errorEl.hidden = true
      return
    }
    const lines = src.split('\n')
    const lineText = lines[res.line - 1] ?? ''
    const col = Math.max(1, res.col ?? 1)
    const WINDOW = 80
    let start = 0
    let display = lineText
    let caretCol = col
    if (lineText.length > WINDOW) {
      start = Math.max(0, col - Math.floor(WINDOW / 2))
      display = (start > 0 ? '…' : '') + lineText.slice(start, start + WINDOW)
      caretCol = col - start + (start > 0 ? 1 : 0)
    }
    const gutter = String(res.line)
    const caretPad = ' '.repeat(gutter.length + 2 + Math.max(0, caretCol - 1))
    const html =
      `<span data-type="jt-err-line">${gutter} | </span>${escapeHtml(display)}\n` +
      `${caretPad}<span data-type="jt-caret">^</span>`
    this.errorEl.innerHTML = html
    this.errorEl.hidden = false
  }

  // ── Repair (the JSON "fixer") ─────────────────────────────────
  /**
   * Attempt to repair malformed JSON. Renders the fixed, formatted result into
   * the output pane (never destructively — the input is only replaced when the
   * user presses “Apply to input”). Valid JSON is simply formatted; genuinely
   * unrecoverable input falls back to the live error pointer on the left.
   */
  private repair() {
    const src = this.input.value
    if (!src.trim()) { this.input.focus(); return }
    const alreadyValid = analyze(src).ok
    const res = repairJson(src)
    if (!res.ok || res.value === undefined) {
      this.hideRepair()
      this.validate()
      if (this.view !== 'text') this.setView('text')
      this.flash(this.repairBtn, 'Can’t repair')
      return
    }
    const value = this.sort ? sortDeep(res.value) : res.value
    const out = JSON.stringify(value, null, indentString(this.indent))
    if (alreadyValid && res.fixes.length === 0) {
      // Nothing to fix — behave like Format so the button still does something useful.
      this.setOutput(out, 'format')
      if (this.view !== 'text') this.setView('text')
      this.hideRepair()
      this.flash(this.repairBtn, 'Already valid ✓')
      return
    }
    const count = res.fixes.length
    this.setOutput(out, 'repair', ` · ${count} ${count === 1 ? 'fix' : 'fixes'}`)
    if (this.view !== 'text') this.setView('text')
    this.showRepair(res.fixes)
  }

  private showRepair(fixes: string[]) {
    const label = fixes.length
      ? `Repaired — ${fixes.join(', ')}. Review the result on the right, then apply it.`
      : 'Repaired the JSON. Review the result on the right, then apply it.'
    this.repairMsgEl.textContent = label
    this.repairApplyBtn.disabled = false
    this.repairEl.hidden = false
  }

  private hideRepair() {
    if (this.repairEl) this.repairEl.hidden = true
  }

  private applyRepair() {
    if (this.outputKind !== 'repair' || !this.output) return
    this.input.value = this.output
    this.collapsed.clear()
    this.persist()
    this.validate() // input is now valid — the status line confirms it
    if (this.view === 'tree') this.renderTree()
    // Keep the banner as a confirmation; it clears on the next edit.
    this.repairMsgEl.textContent = 'Applied — the repaired JSON is now your input.'
    this.repairApplyBtn.disabled = true
    this.input.focus()
  }

  /**
   * Run an operation against the current input and render the result into the
   * output pane. `silent` skips the invalid-input flash (used for auto-format
   * and reflows, where surfacing the live status line is enough).
   */
  private produce(kind: OutputKind, silent = false) {
    this.hideRepair()
    const src = this.input.value
    if (!src.trim()) {
      if (!silent) this.input.focus()
      return
    }
    const res = analyze(src)
    if (!res.ok) {
      this.validate()
      if (!silent) {
        const btn = this.querySelector(`[data-action="${kind === 'format' ? 'format' : kind === 'minify' ? 'minify' : kind === 'stringify' ? 'stringify' : `to-${kind}`}"]`) as HTMLButtonElement
        if (btn) this.flash(btn, 'Invalid JSON')
      }
      return
    }
    const value = this.sort ? sortDeep(res.value) : res.value
    let out = ''
    switch (kind) {
      case 'format': out = JSON.stringify(value, null, indentString(this.indent)); break
      case 'minify': out = JSON.stringify(value); break
      case 'stringify': out = JSON.stringify(JSON.stringify(value)); break
      case 'yaml': out = toYaml(value); break
      case 'csv': out = toCsv(value); break
      case 'xml': out = toXml(value); break
    }
    let detail = ''
    if (kind === 'minify') {
      const saved = byteLength(src) - byteLength(out)
      if (saved > 0) detail = ` · saved ${formatBytes(saved)}`
    }
    this.setOutput(out, kind, detail)
    // Explicit ops produce text — surface the Text view so the result is visible.
    if (!silent && this.view !== 'text') this.setView('text')
  }

  private setOutput(text: string, kind: OutputKind | null, detail = '') {
    this.output = text
    this.outputKind = kind
    this.outTitleEl.textContent = kind ? OUTPUT_META[kind].title + detail : 'Output'
    this.renderOutput()
  }

  private renderOutput() {
    const has = this.output.length > 0
    if (has) {
      this.outEl.textContent = this.output
      this.outEl.removeAttribute('data-empty')
    } else {
      this.outEl.textContent = 'Run Format, Minify, Stringify, or a converter — the result appears here.'
      this.outEl.setAttribute('data-empty', '')
    }
    this.updateActionStates()
  }

  // ── View switching ───────────────────────────────────────────
  private setView(mode: ViewMode) {
    this.view = mode
    this.writeLS(LS_VIEW, mode)
    const tree = mode === 'tree'
    this.outEl.hidden = tree
    this.treeEl.hidden = !tree
    this.outTitleEl.hidden = tree
    this.expandAllBtn.hidden = !tree
    this.collapseAllBtn.hidden = !tree
    this.searchBar.hidden = !tree
    ;(this.querySelector('[data-view="text"]') as HTMLButtonElement).setAttribute('aria-pressed', String(!tree))
    ;(this.querySelector('[data-view="tree"]') as HTMLButtonElement).setAttribute('aria-pressed', String(tree))
    if (tree) this.renderTree()
    else this.updateActionStates()
  }

  private updateActionStates() {
    const enabled = this.view === 'tree' ? this.treeReady : this.output.length > 0
    this.copyBtn.disabled = !enabled
    this.downloadBtn.disabled = !enabled
  }

  // ── Tree view ────────────────────────────────────────────────
  /** The formatted-JSON snapshot the tree represents (for copy/download). */
  private treeText(): string {
    const res = analyze(this.input.value)
    if (!res.ok) return ''
    const value = this.sort ? sortDeep(res.value) : res.value
    return JSON.stringify(value, null, indentString(this.indent))
  }

  private renderTree() {
    this.treeEl.replaceChildren()
    this.treeReady = false
    const src = this.input.value
    if (!src.trim()) {
      this.treeNotice('Your JSON renders as an interactive, collapsible tree here.')
    } else {
      const res = analyze(src)
      if (!res.ok) {
        this.treeNotice('Can’t render the tree — the JSON is invalid. Fix the highlighted error on the left.')
      } else {
        const value = this.sort ? sortDeep(res.value) : res.value
        if (exceedsNodeCap(value, MAX_TREE_NODES)) {
          this.treeNotice(`This JSON is very large (over ${MAX_TREE_NODES.toLocaleString()} nodes) — switch to the Text view to format or convert it.`)
        } else {
          this.treeEl.append(this.buildNode(null, value, '$'))
          this.treeReady = true
        }
      }
    }
    this.updateActionStates()
    // Re-apply the active search against the freshly built tree (no auto-scroll
    // on rebuild — only user-driven search/steps move the viewport).
    this.searchInput.disabled = !this.treeReady
    this.applySearch(this.query, false)
  }

  private treeNotice(msg: string) {
    const div = document.createElement('div')
    div.dataset.type = 'jt-tree-empty'
    div.textContent = msg
    this.treeEl.append(div)
  }

  /** Recursively build one tree node. Uses textContent throughout (no HTML injection). */
  private buildNode(key: string | number | null, value: unknown, path: string): HTMLElement {
    const node = document.createElement('div')
    node.dataset.type = 'jt-node'
    const isArr = Array.isArray(value)
    const isObj = value !== null && typeof value === 'object'
    const entries: [string | number, unknown][] = isObj
      ? (isArr
          ? (value as unknown[]).map((v, i) => [i, v] as [number, unknown])
          : Object.entries(value as Record<string, unknown>))
      : []
    const n = entries.length
    const row = document.createElement('div')
    row.dataset.type = 'jt-node-row'

    if (isObj && n > 0) {
      node.dataset.branch = ''
      node.dataset.kind = isArr ? 'array' : 'object'
      node.dataset.path = path
      const collapsed = this.collapsed.has(path)
      if (collapsed) node.dataset.collapsed = ''

      const toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.dataset.type = 'jt-toggle'
      toggle.setAttribute('aria-expanded', String(!collapsed))
      toggle.setAttribute('aria-label', 'Toggle node')
      toggle.append(makeSpan('jt-arrow', '▸'))
      row.append(toggle)

      this.appendKey(row, key, path)
      row.append(makeSpan('jt-bracket', isArr ? '[' : '{'))
      row.append(makeSpan('jt-count', isArr ? `${n} ${n === 1 ? 'item' : 'items'}` : `${n} ${n === 1 ? 'key' : 'keys'}`))
      row.append(makeSpan('jt-preview', isArr ? '… ]' : '… }'))
      node.append(row)

      const kids = document.createElement('div')
      kids.dataset.type = 'jt-children'
      for (const [k, v] of entries) kids.append(this.buildNode(k, v, childPath(path, k)))
      node.append(kids)

      const closeRow = document.createElement('div')
      closeRow.dataset.type = 'jt-node-row'
      closeRow.dataset.kind = 'close'
      closeRow.append(makeSpan('jt-spacer'))
      closeRow.append(makeSpan('jt-bracket', isArr ? ']' : '}'))
      node.append(closeRow)
      return node
    }

    // Leaf, or an empty object/array.
    node.dataset.leaf = ''
    node.dataset.path = path
    row.append(makeSpan('jt-spacer'))
    this.appendKey(row, key, path)
    if (isObj) {
      row.append(makeSpan('jt-bracket', isArr ? '[]' : '{}'))
    } else {
      const display = value === null ? 'null' : typeof value === 'string' ? JSON.stringify(value) : String(value)
      const val = makeSpan('jt-val', display)
      val.dataset.vtype = value === null ? 'null' : typeof value
      row.append(val)
    }
    node.append(row)
    return node
  }

  private appendKey(row: HTMLElement, key: string | number | null, path: string) {
    if (key === null) return
    const k = makeSpan('jt-key', String(key))
    if (typeof key === 'number') k.dataset.kind = 'index'
    k.dataset.path = path
    k.title = `Copy path: ${path}`
    k.setAttribute('role', 'button')
    k.tabIndex = 0
    row.append(k, makeSpan('jt-colon', ': '))
  }

  private toggleNode(node: HTMLElement | null) {
    if (!node) return
    const path = node.dataset.path
    const toggle = node.querySelector(':scope > [data-type="jt-node-row"] > [data-type="jt-toggle"]') as HTMLButtonElement | null
    if (node.hasAttribute('data-collapsed')) {
      node.removeAttribute('data-collapsed')
      if (path) this.collapsed.delete(path)
      toggle?.setAttribute('aria-expanded', 'true')
    } else {
      node.setAttribute('data-collapsed', '')
      if (path) this.collapsed.add(path)
      toggle?.setAttribute('aria-expanded', 'false')
    }
  }

  private expandAll() {
    this.collapsed.clear()
    this.treeEl.querySelectorAll('[data-branch]').forEach((n) => {
      n.removeAttribute('data-collapsed')
      n.querySelector(':scope > [data-type="jt-node-row"] > [data-type="jt-toggle"]')?.setAttribute('aria-expanded', 'true')
    })
  }

  private collapseAll() {
    this.treeEl.querySelectorAll<HTMLElement>('[data-branch]').forEach((n) => {
      if (n.dataset.path) this.collapsed.add(n.dataset.path)
      n.setAttribute('data-collapsed', '')
      n.querySelector(':scope > [data-type="jt-node-row"] > [data-type="jt-toggle"]')?.setAttribute('aria-expanded', 'false')
    })
    // A manual collapse-all can bury search hits — re-expand ancestors of matches.
    if (this.query.trim() && this.searchHits.length) {
      this.searchHits.forEach((m) => this.expandAncestorsForSearch(m))
      this.scrollToActive()
    }
  }

  // ── Tree search ──────────────────────────────────────────────
  /**
   * Highlight every occurrence of the query across keys and leaf values, expand
   * the ancestors of each hit so it's visible, and collect the hit spans for
   * next/prev stepping. An empty query restores the tree to the user's own
   * collapse state. Never mutates the persistent `collapsed` Set, so clearing a
   * search returns the tree exactly to how the user had it.
   */
  private applySearch(raw: string, scroll = false) {
    this.query = raw
    this.writeLS(LS_SEARCH, raw)
    this.clearHighlights()
    this.syncCollapsedFromSet() // baseline: honour the user's manual collapses
    const q = raw.trim().toLowerCase()
    if (!q || !this.treeReady) {
      this.searchHits = []
      this.activeMatch = -1
      this.updateSearchUI()
      return
    }
    // Keys (skip array indices — searching "0" should hit values, not indices)
    // and leaf value spans are the searchable text.
    const targets = this.treeEl.querySelectorAll<HTMLElement>(
      '[data-type="jt-key"]:not([data-kind="index"]), [data-type="jt-val"]',
    )
    const matchedEls: HTMLElement[] = []
    targets.forEach((el) => { if (this.highlightInto(el, q)) matchedEls.push(el) })
    matchedEls.forEach((el) => this.expandAncestorsForSearch(el))
    // Collect the individual highlight marks in document order for stepping.
    this.searchHits = Array.from(this.treeEl.querySelectorAll<HTMLElement>('[data-type="jt-hl"]'))
    this.activeMatch = this.searchHits.length ? 0 : -1
    this.markActive()
    this.updateSearchUI()
    if (scroll && this.activeMatch >= 0) this.scrollToActive()
  }

  /** Collapse any highlight marks back into plain text on key/value spans. */
  private clearHighlights() {
    this.treeEl
      .querySelectorAll<HTMLElement>('[data-type="jt-key"], [data-type="jt-val"]')
      .forEach((el) => {
        if (el.querySelector('[data-type="jt-hl"]')) el.textContent = el.textContent
      })
  }

  /** Wrap each case-insensitive occurrence of `q` in `el` with a highlight span. */
  private highlightInto(el: HTMLElement, q: string): boolean {
    const text = el.textContent ?? ''
    const lower = text.toLowerCase()
    let i = lower.indexOf(q)
    if (i < 0) return false
    el.textContent = ''
    let pos = 0
    while (i >= 0) {
      if (i > pos) el.append(document.createTextNode(text.slice(pos, i)))
      const mk = document.createElement('span')
      mk.dataset.type = 'jt-hl'
      mk.textContent = text.slice(i, i + q.length)
      el.append(mk)
      pos = i + q.length
      i = lower.indexOf(q, pos)
    }
    if (pos < text.length) el.append(document.createTextNode(text.slice(pos)))
    return true
  }

  /** Expand (in the DOM only) every collapsed branch above `el`. */
  private expandAncestorsForSearch(el: HTMLElement) {
    let cur: HTMLElement | null = el.parentElement
    while (cur && cur !== this.treeEl) {
      if (cur.matches('[data-branch]') && cur.hasAttribute('data-collapsed')) {
        cur.removeAttribute('data-collapsed')
        cur
          .querySelector(':scope > [data-type="jt-node-row"] > [data-type="jt-toggle"]')
          ?.setAttribute('aria-expanded', 'true')
      }
      cur = cur.parentElement
    }
  }

  /** Restore each branch's DOM collapse state from the persistent `collapsed` Set. */
  private syncCollapsedFromSet() {
    this.treeEl.querySelectorAll<HTMLElement>('[data-branch]').forEach((n) => {
      const collapsed = !!n.dataset.path && this.collapsed.has(n.dataset.path)
      const toggle = n.querySelector(':scope > [data-type="jt-node-row"] > [data-type="jt-toggle"]')
      if (collapsed) {
        n.setAttribute('data-collapsed', '')
        toggle?.setAttribute('aria-expanded', 'false')
      } else {
        n.removeAttribute('data-collapsed')
        toggle?.setAttribute('aria-expanded', 'true')
      }
    })
  }

  private markActive() {
    this.searchHits.forEach((m, idx) => {
      if (idx === this.activeMatch) m.dataset.active = ''
      else m.removeAttribute('data-active')
    })
  }

  private scrollToActive() {
    this.searchHits[this.activeMatch]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  private gotoMatch(dir: number) {
    if (!this.searchHits.length) return
    this.activeMatch = (this.activeMatch + dir + this.searchHits.length) % this.searchHits.length
    this.markActive()
    this.scrollToActive()
    this.updateSearchUI()
  }

  private clearSearch() {
    this.searchInput.value = ''
    this.applySearch('', false)
  }

  private updateSearchUI() {
    const q = this.query.trim()
    const has = this.searchHits.length > 0
    if (!q || !this.treeReady) {
      this.searchCountEl.textContent = ''
      this.searchCountEl.removeAttribute('data-state')
    } else {
      this.searchCountEl.textContent = has ? `${this.activeMatch + 1} / ${this.searchHits.length}` : 'No matches'
      this.searchCountEl.dataset.state = has ? 'ok' : 'none'
    }
    this.searchPrevBtn.disabled = !has
    this.searchNextBtn.disabled = !has
    this.searchClearBtn.disabled = !q
  }

  private async copyPath(keyEl: HTMLElement) {
    const path = keyEl.dataset.path
    if (!path) return
    try {
      await navigator.clipboard.writeText(path)
      keyEl.dataset.copied = ''
      window.setTimeout(() => keyEl.removeAttribute('data-copied'), 900)
    } catch { /* clipboard unavailable */ }
  }

  private loadFile() {
    const file = this.fileInput.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      this.input.value = typeof reader.result === 'string' ? reader.result : ''
      this.collapsed.clear()
      this.hideRepair()
      this.persist()
      this.validate()
      this.maybeAutoFormat()
      this.input.focus()
      if (this.view === 'tree') this.renderTree()
    }
    reader.onerror = () => this.flash(this.querySelector('[data-action="upload"]') as HTMLButtonElement, 'Read failed')
    reader.readAsText(file)
    this.fileInput.value = '' // allow re-uploading the same file
  }

  private async copy() {
    const text = this.view === 'tree' ? this.treeText() : this.output
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      this.flash(this.copyBtn, 'Copied!')
    } catch {
      this.flash(this.copyBtn, 'Copy failed')
    }
  }

  private download() {
    const text = this.view === 'tree' ? this.treeText() : this.output
    const kind: OutputKind | null = this.view === 'tree' ? 'format' : this.outputKind
    if (!text || !kind) return
    const { ext, mime } = OUTPUT_META[kind]
    try {
      const blob = new Blob([text], { type: `${mime};charset=utf-8` })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `json-tidy.${ext}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      this.flash(this.downloadBtn, 'Saved!')
    } catch {
      this.flash(this.downloadBtn, 'Failed')
    }
  }

  private flash(btn: HTMLButtonElement, label: string) {
    if (!btn) return
    const original = btn.dataset.label ?? btn.textContent ?? ''
    if (!btn.dataset.label) btn.dataset.label = original
    btn.textContent = label
    window.setTimeout(() => { btn.textContent = btn.dataset.label ?? original }, 1400)
  }

  private setStatus(state: 'idle' | 'ok' | 'err', label: string) {
    this.statusEl.dataset.state = state
    this.statusEl.textContent = label
  }

  // ── localStorage helpers (all guarded; storage may be unavailable/full) ──
  private persist() {
    const v = this.input.value
    try {
      if (v.length <= MAX_PERSIST) localStorage.setItem(LS_INPUT, v)
      else localStorage.removeItem(LS_INPUT)
    } catch { /* ignore quota/private-mode errors */ }
  }

  private readLS(key: string): string | null {
    try { return localStorage.getItem(key) } catch { return null }
  }

  private writeLS(key: string, value: string) {
    try { localStorage.setItem(key, value) } catch { /* ignore */ }
  }
}

if (!customElements.get('json-tidy-tool')) {
  customElements.define('json-tidy-tool', JsonTidyTool)
}

export {}
