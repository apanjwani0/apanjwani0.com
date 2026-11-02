/**
 * Webhook Inspector — live arrival over Server-Sent Events.
 *
 * GET /api/hook/:bin/stream  → `text/event-stream`. Each new capture is pushed as
 *
 *   event: request
 *   id: <request id>
 *   data: <one captured request, the same JSON an element of the poll returns>
 *
 * plus `event: cleared` when the bin is cleared, a `: keep-alive` comment every
 * 20 s (an idle stream must not look dead to a proxy), and a final
 * `event: bye` with a reason before the server closes. The page uses this in
 * place of the 2 s poll and falls back to the poll if the stream fails.
 *
 * A held-open response is the most expensive thing a public route can offer on a
 * 1 GB host, so it is bounded in every dimension (AGENTS.md):
 *
 *  - OPENING: a per-client limiter, then a shared one (asked only after the
 *    client's says yes, so a refused client cannot drain the shared budget);
 *  - COUNT: one stream per client per bin, and WEBHOOK_MAX_STREAMS in the whole
 *    process; past that a 503 with a fixed sentence (the page polls instead);
 *  - TIME: a hard close after WEBHOOK_STREAM_MAX_MS, and a close when the bin
 *    expires or is evicted. An open stream never keeps a bin alive;
 *  - BYTES: a slow reader whose queue passes 256 KB is closed, not buffered for.
 *
 * Same auth model as every route here: knowing the bin id is the whole control.
 */
import type { APIRoute } from 'astro'
import { createRateLimiter, rateLimitKey } from '../../../../lib/security'
import {
  acquireStreamSlot,
  binLastActivity,
  isValidBinId,
  subscribeBin,
  WEBHOOK_BIN_TTL_MS,
  WEBHOOK_STREAM_KEEPALIVE_MS,
  WEBHOOK_STREAM_MAX_MS,
  type BinEvent,
} from '../../../../lib/webhook-store'

export const prerender = false

const JSON_NO_STORE = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }

// A tab opens one stream and keeps it; a reconnect after the hard close or a
// network blip is the other use. 12 a minute per client covers a few tabs
// reloading, 120 shared covers the site's whole audience at once.
const allowOpenClient = createRateLimiter(60_000, 12)
const allowOpenGlobal = createRateLimiter(60_000, 120)

/** Bytes a slow reader may have queued before the stream is closed on it. */
const STREAM_QUEUE_BYTES = 256 * 1024

const reply = (status: number, error: string, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error }), { status, headers: { ...JSON_NO_STORE, ...extra } })

export const GET: APIRoute = ({ params, request }) => {
  const client = rateLimitKey(request)
  // Per-client first; the shared bucket is asked only when the client's said yes.
  if (!(allowOpenClient(client) && allowOpenGlobal('global'))) {
    return reply(429, 'rate limited', { 'Retry-After': '60' })
  }
  const binId = params.bin
  if (!isValidBinId(binId)) return reply(404, 'not found')

  const slot = acquireStreamSlot(binId, client)
  if (!slot.ok) {
    return slot.reason === 'full'
      ? reply(503, 'Too many live streams are open right now, so this page will check for new requests every two seconds instead.', { 'Retry-After': '30' })
      : reply(409, 'This address already has a live stream open for this URL, so this page will check every two seconds instead.')
  }

  const encoder = new TextEncoder()
  let finish: (reason?: 'expired' | 'evicted' | 'max-age' | 'slow') => void = () => {}

  const body = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        const openedAt = Date.now()
        let closed = false

        const send = (text: string) => {
          if (closed) return
          // A queue past its mark means the reader stopped reading.
          if ((controller.desiredSize ?? 1) < 0) return finish('slow')
          try { controller.enqueue(encoder.encode(text)) } catch { finish() }
        }

        const unsubscribe = subscribeBin(binId, (event: BinEvent) => {
          if (event.type === 'request') {
            send(`event: request\nid: ${event.request.id}\ndata: ${JSON.stringify(event.request)}\n\n`)
          } else if (event.type === 'cleared') {
            send('event: cleared\ndata: {}\n\n')
          } else {
            finish(event.reason)
          }
        })

        // A bin that never existed has no activity to age, so it ages from the
        // moment the stream opened. A stream never refreshes the clock.
        const tick = setInterval(() => {
          const last = Math.max(openedAt, binLastActivity(binId) ?? 0)
          if (Date.now() - last > WEBHOOK_BIN_TTL_MS) finish('expired')
          else send(': keep-alive\n\n')
        }, WEBHOOK_STREAM_KEEPALIVE_MS)
        const hardStop = setTimeout(() => finish('max-age'), WEBHOOK_STREAM_MAX_MS)
        ;(tick as unknown as { unref?: () => void }).unref?.()
        ;(hardStop as unknown as { unref?: () => void }).unref?.()

        const onAbort = () => finish()
        request.signal.addEventListener('abort', onAbort, { once: true })

        finish = reason => {
          if (closed) return
          closed = true
          clearInterval(tick)
          clearTimeout(hardStop)
          unsubscribe()
          request.signal.removeEventListener('abort', onAbort)
          slot.release()
          try {
            if (reason) controller.enqueue(encoder.encode(`event: bye\ndata: ${JSON.stringify({ reason })}\n\n`))
            controller.close()
          } catch { /* already closed or cancelled */ }
        }

        // `retry` is the reconnect delay EventSource uses; `ready` tells the page
        // the stream is live so it can fetch anything that arrived in the gap.
        send(`retry: 3000\n\n: connected\n\nevent: ready\ndata: ${JSON.stringify({ maxAgeMs: WEBHOOK_STREAM_MAX_MS })}\n\n`)
      },
      cancel() {
        finish()
      },
    },
    new ByteLengthQueuingStrategy({ highWaterMark: STREAM_QUEUE_BYTES }),
  )

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      // nginx-style proxies buffer a response unless told not to; a buffered
      // event stream delivers nothing until the buffer fills.
      'X-Accel-Buffering': 'no',
    },
  })
}
