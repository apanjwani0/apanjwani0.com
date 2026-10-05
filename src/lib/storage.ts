/**
 * localStorage that never throws — private mode, blocked site data and a full
 * quota all read as "nothing saved" and write as a no-op, so a tool still works
 * for the session. Keys are the caller's; this module never prefixes them.
 */

export function lsGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

export function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* quota or private mode */ }
}

export function lsRemove(key: string): void {
  try { localStorage.removeItem(key) } catch { /* storage unavailable */ }
}

/** A saved finite number, or `fallback` when missing, unreadable or not a number. */
export function lsGetNumber(key: string, fallback: number): number {
  const raw = lsGet(key)
  if (raw === null) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}
