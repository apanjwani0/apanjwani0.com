import {
  Marked,
  Renderer,
  type RendererThis,
  type TokenizerAndRendererExtension,
  type TokenizerThis,
  type Tokens,
} from 'marked'
import { escapeHtml, safeMarkdownUrl } from './security'

const renderer = new Renderer()

renderer.html = ({ text }) => escapeHtml(text)

renderer.link = function ({ href, title, tokens }) {
  const label = this.parser.parseInline(tokens)
  const safeHref = safeMarkdownUrl(href)
  if (!safeHref) return label
  const safeTitle = title ? ` title="${escapeHtml(title)}"` : ''
  return `<a href="${escapeHtml(safeHref)}"${safeTitle}>${label}</a>`
}

renderer.image = ({ href, title, text }) => {
  const safeHref = safeMarkdownUrl(href)
  if (!safeHref) return escapeHtml(text)
  const safeTitle = title ? ` title="${escapeHtml(title)}"` : ''
  return `<img src="${escapeHtml(safeHref)}" alt="${escapeHtml(text)}"${safeTitle}>`
}

/* ───────────────────────  editorial extensions  ───────────────────────
 *
 * Long-form articles were rendering as an undifferentiated slab: heading,
 * paragraph, paragraph, list, paragraph. Nothing on the page said "this
 * sentence is the one that matters", so a reader skimming had no purchase and a
 * reader reading had no rhythm. These four constructs are the smallest set that
 * fixes it, and each one earns its place by doing something a plain paragraph
 * cannot:
 *
 *   ==text==            a highlight, for the clause the whole section turns on
 *   :::note … :::       an aside — context that would derail the main line
 *   :::key … :::        the takeaway, pulled out so a skimmer can't miss it
 *   >> pull quote       a display-size line that breaks the column
 *
 * They are deliberately NOT raw HTML in the source: content comes from /admin
 * and from config files, and the whole markdown pipeline exists so that a
 * content author can never introduce markup. Each extension parses its own body
 * back through marked, so escaping and URL-safety hold inside them too.
 */

/** ==highlighted== → <mark>. Inline, so it composes with bold/links/code. */
const highlight: TokenizerAndRendererExtension = {
  name: 'highlight',
  level: 'inline',
  start: (src: string) => src.indexOf('=='),
  tokenizer(this: TokenizerThis, src: string) {
    const match = /^==(?=\S)([\s\S]*?\S)==/.exec(src)
    if (!match) return undefined
    return {
      type: 'highlight',
      raw: match[0],
      tokens: this.lexer.inlineTokens(match[1]),
    }
  },
  renderer(this: RendererThis, token: Tokens.Generic) {
    return `<mark>${this.parser.parseInline(token.tokens ?? [])}</mark>`
  },
}

/**
 * :::note / :::key fenced callouts, with an optional label on the opening line:
 *
 *   :::key The takeaway
 *   Body markdown, which may be several paragraphs.
 *   :::
 *
 * `kind` is matched against a fixed list rather than interpolated from the
 * source — otherwise a content author could write `:::" onmouseover=` and put an
 * attribute in the output. Same reason the label goes through inline parsing
 * instead of being dropped into the HTML as-is.
 */
const CALLOUT_KINDS = ['note', 'key', 'aside', 'warn'] as const
type CalloutKind = (typeof CALLOUT_KINDS)[number]

const callout: TokenizerAndRendererExtension = {
  name: 'callout',
  level: 'block',
  start: (src: string) => src.indexOf('\n:::'),
  tokenizer(this: TokenizerThis, src: string) {
    const match = /^:::(\w+)([^\n]*)\n([\s\S]*?)\n:::(?:\n|$)/.exec(src)
    if (!match) return undefined
    const kind = match[1].toLowerCase()
    if (!CALLOUT_KINDS.includes(kind as CalloutKind)) return undefined
    return {
      type: 'callout',
      raw: match[0],
      kind,
      labelTokens: this.lexer.inlineTokens(match[2].trim()),
      tokens: this.lexer.blockTokens(match[3], []),
    }
  },
  renderer(this: RendererThis, token: Tokens.Generic) {
    const labelTokens = (token.labelTokens ?? []) as Tokens.Generic[]
    const label = labelTokens.length
      ? `<p data-type="callout-label">${this.parser.parseInline(labelTokens)}</p>`
      : ''
    const body = this.parser.parse(token.tokens ?? [])
    return `<aside data-type="callout" data-kind="${token.kind}">${label}${body}</aside>`
  },
}

/**
 * `>> line` — a pull quote: one display-size sentence that breaks the column.
 *
 * Deliberately not `>` (blockquote): a blockquote means "someone else said
 * this", and using it for emphasis makes real quotations unreadable as
 * quotations. Two different jobs, two different marks.
 */
const pullQuote: TokenizerAndRendererExtension = {
  name: 'pullQuote',
  level: 'block',
  start: (src: string) => src.indexOf('\n>>'),
  tokenizer(this: TokenizerThis, src: string) {
    const match = /^>>[ \t]+([^\n]+)(?:\n|$)/.exec(src)
    if (!match) return undefined
    return {
      type: 'pullQuote',
      raw: match[0],
      tokens: this.lexer.inlineTokens(match[1].trim()),
    }
  },
  renderer(this: RendererThis, token: Tokens.Generic) {
    return `<p data-type="pull-quote">${this.parser.parseInline(token.tokens ?? [])}</p>`
  },
}

const markdown = new Marked({
  renderer,
  extensions: [highlight, callout, pullQuote],
})

/**
 * Renders full markdown (creates <p>, <ul>, etc.).
 * Use inside <div> elements.
 */
export function render(text: string): string {
  return markdown.parse(text, { async: false }) as string
}

/**
 * Renders inline markdown (bold, italic, code, links).
 * Does NOT wrap in <p> — safe to use inside existing block elements.
 */
export function renderInline(text: string): string {
  return markdown.parseInline(text, { async: false }) as string
}

/**
 * Where an article wants its figures — plural, and optionally pinned.
 *
 * Every learnings article used to open with its embed, because the route
 * hardcoded the position: summary, component, then all the prose. That is the
 * worst possible place for it. The reader meets a simulation before being told
 * what it is or why they should care, and every article then had to open by
 * referring to "the thing above" — which is why they all read the same.
 *
 * `{{embed}}` on its own line moves it to the moment the writing has earned it.
 * `{{embed:some-view}}` places the SAME component pinned to one of its views,
 * which is what lets an article carry a figure every few lines instead of one
 * big one in the middle — the house format (docs/plans/learnings-voice.md)
 * wants the prose to be connective tissue between figures, and one embed per
 * article cannot express that. A component that does not understand the view
 * name simply renders its default: a typo costs the pinning, never the page.
 *
 * Returns the article as alternating segments. Every segment carries the
 * markdown that precedes its figure; the last one carries the trailing prose
 * and no figure. No marker at all yields a single segment, and the caller falls
 * back to placing the figure after the prose.
 */
export interface EmbedSegment {
  /** The markdown that comes before this segment's figure. */
  markdown: string
  /**
   * The figure that follows `markdown`, when there is one. `''` is the full
   * component; a non-empty string pins it to that view. Absent on the final
   * segment, which is the prose after the last figure.
   */
  view?: string
}

export function splitOnEmbeds(content: string): EmbedSegment[] {
  const marker = /^[ \t]*\{\{embed(?::([a-z0-9-]+))?\}\}[ \t]*$/gm
  const out: EmbedSegment[] = []
  let last = 0
  for (const m of content.matchAll(marker)) {
    out.push({ markdown: content.slice(last, m.index), view: m[1] ?? '' })
    last = m.index + m[0].length
  }
  out.push({ markdown: content.slice(last) })
  return out
}
