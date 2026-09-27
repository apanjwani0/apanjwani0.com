import { safeExternalUrl, safeInternalPath } from './security'

export const CONFIG_TYPES = ['site', 'projects', 'experience', 'blogs', 'games', 'tools', 'learnings'] as const
export type ConfigType = typeof CONFIG_TYPES[number]

const TOOL_STATUSES = new Set(['live', 'wip', 'external', 'disabled'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString)
}

function optionalString(value: unknown): boolean {
  return value === undefined || isString(value)
}

function optionalSafeExternalUrl(value: unknown): boolean {
  return value === undefined || value === '' || safeExternalUrl(value) !== null
}

function safeSlug(value: unknown): boolean {
  return typeof value === 'string' && /^[a-z0-9-]+$/.test(value)
}

function safeBlogHref(value: unknown): boolean {
  if (typeof value !== 'string') return false
  if (safeExternalUrl(value) || safeInternalPath(value)) return true
  return /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?$/i.test(value)
}

function validNavItem(value: unknown): boolean {
  if (!isRecord(value)) return false
  const href = safeInternalPath(value.href) ?? safeExternalUrl(value.href)
  return isString(value.label)
    && href !== null
    && (value.children === undefined || (Array.isArray(value.children) && value.children.every(validNavItem)))
}

function validSite(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.social)) return false
  return isString(value.name)
    && isString(value.handle)
    && isString(value.tagline)
    && isString(value.bio)
    && safeInternalPath(value.avatar) !== null
    && (value.theme === 'light' || value.theme === 'dark')
    && safeExternalUrl(value.url) !== null
    && optionalSafeExternalUrl(value.social.github)
    && optionalSafeExternalUrl(value.social.linkedin)
    && Array.isArray(value.nav)
    && value.nav.every(validNavItem)
    && isRecord(value.sections)
}

function validProjects(value: unknown): boolean {
  return Array.isArray(value) && value.every(project =>
    isRecord(project)
    && isString(project.title)
    && safeExternalUrl(project.url) !== null
    && isString(project.description)
    && isStringArray(project.tags)
    && optionalString(project.keywords)
  )
}

function validExperience(value: unknown): boolean {
  return Array.isArray(value) && value.every(company =>
    isRecord(company)
    && isString(company.name)
    && Array.isArray(company.roles)
    && company.roles.every(role =>
      isRecord(role)
      && isString(role.title)
      && optionalString(role.team)
      && isString(role.period)
      && isStringArray(role.bullets)
    )
  )
}

function validBlogs(value: unknown): boolean {
  return Array.isArray(value) && value.every(post =>
    isRecord(post)
    && isString(post.title)
    && safeBlogHref(post.href)
    && isString(post.date)
    && isString(post.summary)
    && optionalString(post.content)
    && optionalString(post.keywords)
  )
}

function validGames(value: unknown): boolean {
  return Array.isArray(value) && value.every(game =>
    isRecord(game)
    && safeSlug(game.slug)
    && isString(game.title)
    && isString(game.description)
    && typeof game.enabled === 'boolean'
    && optionalString(game.seoTitle)
    && optionalString(game.metaDescription)
    && optionalString(game.intro)
    && optionalString(game.seoContent)
    && optionalString(game.keywords)
    && (game.interactive === undefined || typeof game.interactive === 'boolean')
  )
}

function validTools(value: unknown): boolean {
  return Array.isArray(value) && value.every(tool =>
    isRecord(tool)
    && safeSlug(tool.slug)
    && isString(tool.title)
    && isString(tool.description)
    && typeof tool.status === 'string'
    && TOOL_STATUSES.has(tool.status)
    && (tool.status !== 'external' || safeExternalUrl(tool.href) !== null)
    && (tool.href === undefined || tool.status === 'external' || safeExternalUrl(tool.href) !== null)
    && optionalString(tool.seoTitle)
    && optionalString(tool.metaDescription)
    && optionalString(tool.intro)
    && optionalString(tool.seoContent)
    && optionalString(tool.keywords)
  )
}

function validLearnings(value: unknown): boolean {
  return Array.isArray(value) && value.every(learning =>
    isRecord(learning)
    && safeSlug(learning.slug)
    && isString(learning.title)
    && isString(learning.summary)
    && isString(learning.date)
    && isString(learning.content)
    && typeof learning.published === 'boolean'
    // `embed` is only ever compared against GAME_TAGS keys, which are slugs, so
    // constrain it to the same shape here rather than letting arbitrary strings
    // reach learningEmbedTag() and rely on its Object.hasOwn guard alone.
    && (learning.embed === undefined || safeSlug(learning.embed))
    && optionalString(learning.embedCaption)
    && optionalString(learning.seoTitle)
    && optionalString(learning.metaDescription)
    && optionalString(learning.keywords)
  )
}

export function isConfigType(value: string): value is ConfigType {
  return CONFIG_TYPES.includes(value as ConfigType)
}

export function validateConfigData(type: string, data: unknown): boolean {
  switch (type) {
    case 'site': return validSite(data)
    case 'projects': return validProjects(data)
    case 'experience': return validExperience(data)
    case 'blogs': return validBlogs(data)
    case 'games': return validGames(data)
    case 'tools': return validTools(data)
    case 'learnings': return validLearnings(data)
    default: return false
  }
}
