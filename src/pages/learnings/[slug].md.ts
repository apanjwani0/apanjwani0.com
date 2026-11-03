export const prerender = false

import type { APIRoute } from 'astro'
import { getLearnings, getSite } from '../../lib/config'
import { isPublishedLearning, retiredLearningTarget } from '../../lib/learnings'
import { learningMarkdown } from '../../lib/reach'

// /learnings/<slug>.md: an article's Markdown source, for agents and for anyone
// who wants the text. The middleware also answers the HTML address with this
// when the request's Accept header prefers text/markdown.
//
// The same two questions the HTML route asks, in the same order: is the slug
// retired (301 to where the HTML route sends it), and is the article published
// (isPublishedLearning). Anything else is a bodyless 404 that never repeats the
// slug it was asked for. Unlike the HTML route it does not serve drafts in dev:
// a draft has no address anywhere, and nothing previews Markdown.
export const GET: APIRoute = async ({ params, locals }) => {
  const slug = params.slug

  const retiredTo = retiredLearningTarget(slug)
  if (retiredTo) {
    return new Response(null, {
      status: 301,
      headers: { Location: retiredTo, 'Cache-Control': 'public, max-age=0, s-maxage=3600' },
    })
  }

  const [site, learnings] = await Promise.all([getSite(locals), getLearnings(locals)])
  const learning = learnings.find(l => l.slug === slug)
  if (!learning || !isPublishedLearning(learning)) return new Response(null, { status: 404, statusText: 'Not Found' })

  const canonical = `${site.url.replace(/\/$/, '')}/learnings/${learning.slug}`
  const body = `# ${learning.title.replace(/\s+/g, ' ').trim()}\n\nCanonical URL: ${canonical}\n\n${learningMarkdown(learning).trim()}\n`
  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      // The HTML page is the one to index; this is its twin.
      Link: `<${canonical}>; rel="canonical"`,
    },
  })
}
