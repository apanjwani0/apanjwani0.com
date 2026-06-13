import { marked } from 'marked'

/**
 * Renders full markdown (creates <p>, <ul>, etc.).
 * Use inside <div> elements.
 */
export function render(text: string): string {
  return marked.parse(text) as string
}

/**
 * Renders inline markdown (bold, italic, code, links).
 * Does NOT wrap in <p> — safe to use inside existing block elements.
 */
export function renderInline(text: string): string {
  // marked.parseInline returns string when async is false (default)
  return marked.parseInline(text) as string
}
