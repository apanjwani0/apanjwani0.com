import { defineMiddleware } from 'astro:middleware'
import { isFromCloudflare } from './lib/security'
import { looksAutomated, recordVisit, referrerHost } from './lib/visits'

function createNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}

function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

export const onRequest = defineMiddleware(async (context, next) => {
  // Origin lock — see isFromCloudflare. No-op until ORIGIN_SHARED_SECRET is set.
  if (!(await isFromCloudflare(context.request))) {
    // 404, not 403: a bypass attempt learns nothing about why it failed.
    // no-store: if the Transform Rule is ever broken, Cloudflare would forward
    // header-less requests — a cacheable lock-out 404 would outlive the fix.
    return new Response(null, {
      status: 404,
      statusText: 'Not Found',
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const cspNonce = createNonce()
  const locals = context.locals as any
  locals.cspNonce = cspNonce

  const response = await next()
  const { pathname } = context.url

  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  response.headers.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)')
  response.headers.set('Content-Security-Policy', buildCsp(cspNonce))

  // Caching policy. Cloudflare's edge sits in front (a Cache Rule makes HTML
  // eligible for caching); these headers tell it *how long* and *what to skip*.
  // Only on-demand (SSR) responses are cached here — prerendered routes are
  // static files at runtime, and reading request data during prerender warns.
  if (!context.isPrerendered) {
    // Never cache the admin editor, the admin API, or any response carrying an
    // admin session — gated pages (e.g. disabled tools) render differently for
    // admins and must not be stored and served to the public.
    const isAdminSurface = pathname === '/admin' || pathname.startsWith('/api/admin/')
    const hasAdminSession = context.request.headers.get('cookie')?.includes('__admin_session') ?? false
    const isGet = context.request.method === 'GET' || context.request.method === 'HEAD'

    if (isAdminSurface) {
      response.headers.set('Cache-Control', 'no-store')
      response.headers.set('X-Robots-Tag', 'noindex, nofollow')
    } else if (hasAdminSession) {
      response.headers.set('Cache-Control', 'no-store')
    } else if (response.headers.has('Cache-Control')) {
      // A route that set its own policy knows better (the webhook endpoints all
      // send no-store) — the fallbacks below are for routes that didn't.
    } else if (isGet && response.status === 404) {
      // Vulnerability scanners generate the bulk of this site's origin traffic,
      // and every one of them requests a path that does not exist — /api/*
      // probes (wp-login, .env, graphql) most of all, which is why this ranks
      // above the blanket API no-store. An uncached 404 wakes the origin every
      // time; a cached one is absorbed at the edge. Short TTL so a genuinely
      // new route still appears quickly.
      response.headers.set('Cache-Control', 'public, max-age=0, s-maxage=300')
    } else if (pathname.startsWith('/api/')) {
      // API routes are dynamic by definition (analytics writes, the webhook
      // capture/playback endpoints) — never let the edge cache their responses,
      // or a GET to a capture URL could be served stale and stop recording.
      response.headers.set('Cache-Control', 'no-store')
    } else if (isGet && response.status === 200) {
      // Public, successful page → cacheable. s-maxage drives the CDN edge;
      // stale-while-revalidate lets it refresh in the background so no visitor
      // ever blocks on the origin. The sitemap changes far less often than page
      // content, so it gets a longer fresh window (1 h vs 10 m) to cut origin
      // hits from crawlers while still refreshing within the day.
      //
      // max-age=0 keeps *browsers* from pinning stale HTML: without it an edit
      // stays invisible to anyone who already loaded the page until their own
      // cache expires, which is not something a purge can fix.
      const isSitemap = pathname === '/sitemap.xml'
      response.headers.set(
        'Cache-Control',
        `public, max-age=0, ${isSitemap ? 's-maxage=3600' : 's-maxage=600'}, stale-while-revalidate=86400`,
      )
    }

    // Count real page views only: successful HTML GETs. Content-Type decides —
    // path lists rot (the SSR /sitemap.xml was being counted as a page) — and
    // HEAD probes are not views.
    const isHtml = (response.headers.get('Content-Type') ?? '').includes('text/html')
    if (context.request.method === 'GET' && response.status === 200 && isHtml && !isAdminSurface) {
      const headers = context.request.headers
      recordVisit({
        path: pathname,
        country: headers.get('cf-ipcountry') ?? 'XX',
        referrer: referrerHost(headers.get('referer'), context.url.host),
        bot: looksAutomated(headers.get('user-agent')),
      })
    }
  }

  return response
})
