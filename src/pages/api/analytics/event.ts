import type { APIRoute } from 'astro'
import { getGames, getTools } from '../../../lib/config'
import { normalizeAnalyticsEvent, recordAnalyticsEvent } from '../../../lib/analytics'
import {
  BodyTooLargeError,
  readLimitedJson,
} from '../../../lib/security'

export const prerender = false

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true
  try {
    return new URL(origin).origin === new URL(request.url).origin
  } catch {
    return false
  }
}

export const POST: APIRoute = async ({ request, locals }) => {
  if (!isSameOrigin(request)) return new Response(null, { status: 403 })

  let event
  try {
    event = normalizeAnalyticsEvent(await readLimitedJson(request, 8_192))
  } catch (error) {
    return new Response(null, { status: error instanceof BodyTooLargeError ? 413 : 400 })
  }

  if (!event) return new Response(null, { status: 400 })

  const knownItems = event.kind === 'tool' ? await getTools(locals) : await getGames(locals)
  if (!knownItems.some(item => item.slug === event.slug)) return new Response(null, { status: 400 })

  await recordAnalyticsEvent(locals, event)
  return new Response(null, { status: 204 })
}
