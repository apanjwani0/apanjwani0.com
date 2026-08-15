/**
 * Social-share (Open Graph / Twitter) preview-image metadata, shared by both page
 * shells (Base.astro + ToolBase.astro) so the share image and its dimensions live
 * in ONE place instead of a byte-identical block duplicated across the two layouts.
 *
 * The share image is the portrait avatar. Its intrinsic dimensions (320×468,
 * matching public/avatar.webp and the <Avatar> component) are handed to scrapers
 * as og:image:width / og:image:height so link cards reserve the right aspect ratio
 * without a fetch. The URL is resolved to an ABSOLUTE href against the site origin
 * because og:image must be absolute for cross-site unfurlers (Slack, X, iMessage…).
 */
export function ogImageMeta(site: { url: string; avatar: string }): {
  src: string
  width: number
  height: number
} {
  return {
    src: new URL(site.avatar, site.url).href,
    width: 320,
    height: 468,
  }
}
