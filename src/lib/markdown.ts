import { Marked, Renderer } from 'marked'
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

const markdown = new Marked({ renderer })

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
