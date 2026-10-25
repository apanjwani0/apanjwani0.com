/**
 * One-click starting points on the /tools hub cards: a "try" link that opens a
 * tool with a real input already filled in. Only tools that read their input
 * from the URL get one, and the link only fills the input: a server tool still
 * waits for the visitor to press its button, so a link costs no server budget.
 *
 * Every target is real, never sample data (AGENTS.md):
 *  - Chainsaw and DNS Sightline open on github.com, a large public host whose
 *    answer is always worth reading. Nothing here claims what the result is.
 *  - Cron Whisperer opens on 01:30 every day in Europe/London, a time that does
 *    not exist on the spring-forward night and happens twice on the fall-back
 *    night (checked against the engine in scripts/tools-hub-smoke.mjs).
 *  - Flowmap opens on a board built from a short outline, through the tool's own
 *    encoder, so the link can never drift from the format the tool reads.
 */
import { encodeGraph, parseOutline } from './graph-text'

export interface ToolTry {
  /** What the link shows after "try:", in the card's mono meta line. */
  label: string
  href: string
}

/** The Cron Whisperer demo, exported so the smoke can run it through the engine. */
export const CRON_TRY = { expr: '30 1 * * *', zone: 'Europe/London' } as const

/** The outline behind the Flowmap demo: what happens when a page loads. */
export const FLOWMAP_TRY_OUTLINE = [
  'Opening a web page',
  '  DNS lookup',
  '    Ask a resolver for the address',
  '  Connect',
  '    TCP handshake',
  '    TLS handshake',
  '  HTTP request',
  '    Edge cache',
  '    Origin server',
  '  Render the page',
].join('\n')

export function toolTries(): Record<string, ToolTry> {
  const cron = new URLSearchParams({ e: CRON_TRY.expr, tz: CRON_TRY.zone })
  return {
    chainsaw: { label: 'github.com', href: '/tools/chainsaw?host=github.com' },
    'dns-sightline': { label: 'github.com', href: '/tools/dns-sightline?name=github.com' },
    'cron-whisperer': { label: `${CRON_TRY.expr} in London`, href: `/tools/cron-whisperer#${cron.toString()}` },
    flowmap: { label: 'an outline of a page load', href: `/tools/flowmap#g=${encodeGraph(parseOutline(FLOWMAP_TRY_OUTLINE))}` },
  }
}
