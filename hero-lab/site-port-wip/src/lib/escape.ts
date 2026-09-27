/**
 * HTML escaping for anything interpolated into markup — including `'`, because
 * attribute quoting is a property of the call site and will eventually change.
 * Lives in its own module so client-side tool components and build scripts can
 * import it without dragging in the server-only helpers in security.ts.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
