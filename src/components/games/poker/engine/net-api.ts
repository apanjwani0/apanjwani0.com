/**
 * net-api.ts — thin PocketBase client seam for Poker Together.
 *
 * The backend is a *thin coordinator* (accounts now; room registry + durable
 * books later) — game state stays P2P (see docs/poker-backend.md). One base URL
 * (`PUBLIC_POKER_API`, default local) is the only deployment-specific knob, so
 * moving to the Raspberry Pi / a cloud host is a one-line change. Plain `fetch`,
 * no SDK.
 *
 * Everything degrades gracefully: if the server is unset or down, callers fall
 * back to local/P2P-only play. Accounts are play-money identity only — this file
 * never touches real money.
 */

import { LS } from './types'

/** Single deployment seam. Set PUBLIC_POKER_API to the Pi/cloud URL in prod. */
export const API_BASE = (
  (import.meta.env.PUBLIC_POKER_API as string | undefined) || 'http://127.0.0.1:8090'
).replace(/\/+$/, '')

export interface Account {
  id: string
  /** display name (what the player typed) */
  name: string
  token: string
}

/* ─────────────────────────  persisted session  ─────────────────────── */

function readAuth(): Account | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(LS.auth)
    if (!raw) return null
    const a = JSON.parse(raw)
    return a && typeof a.token === 'string' && typeof a.id === 'string' ? a as Account : null
  } catch {
    return null
  }
}

function writeAuth(a: Account | null): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (a) localStorage.setItem(LS.auth, JSON.stringify(a))
    else localStorage.removeItem(LS.auth)
  } catch {
    // ignore — best-effort
  }
}

/** The signed-in account, or null (guest). */
export function currentUser(): Account | null {
  return readAuth()
}

export function logout(): void {
  writeAuth(null)
}

/* ────────────────────────────  transport  ──────────────────────────── */

/** Map a typed display name to a deterministic hidden identity email. Default
 *  PocketBase auth rejects username-identity, so we key auth off a synthesized
 *  email the player never sees. */
function idEmail(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `${slug || 'player'}@poker.local`
}

async function pb(path: string, init: RequestInit, ms = 6000): Promise<any> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body?.message || `Request failed (${res.status})`)
    return body
  } finally {
    clearTimeout(timer)
  }
}

/** Is the coordinator reachable? Cheap, short timeout — drives graceful fallback. */
export async function apiHealth(): Promise<boolean> {
  try {
    const b = await pb('/api/health', { method: 'GET' }, 2500)
    return !!(b && (b.code === 200 || b.message))
  } catch {
    return false
  }
}

/* ────────────────────────────  accounts  ───────────────────────────── */

/** Create an account (name + password) and sign in. Throws with a friendly
 *  message on failure (name taken, offline, weak password…). */
export async function signup(name: string, password: string): Promise<Account> {
  const email = idEmail(name)
  await pb('/api/collections/users/records', {
    method: 'POST',
    body: JSON.stringify({ name: name.trim(), email, emailVisibility: false, password, passwordConfirm: password }),
  })
  return login(name, password)
}

/** Sign in with a previously created name + password. */
export async function login(name: string, password: string): Promise<Account> {
  const body = await pb('/api/collections/users/auth-with-password', {
    method: 'POST',
    body: JSON.stringify({ identity: idEmail(name), password }),
  })
  const acct: Account = { id: body.record?.id ?? '', name: body.record?.name || name.trim(), token: body.token ?? '' }
  if (!acct.id || !acct.token) throw new Error('Unexpected sign-in response.')
  writeAuth(acct)
  return acct
}
