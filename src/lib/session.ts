// Module-level in-memory store for dev (no KV available).
// Note: cleared on HMR restart of this module — log back in after a hot reload.
const devSessions = new Map<string, true>()

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function createSession(kv?: any): Promise<string> {
  const token = generateToken()
  if (kv) {
    await kv.put(`session:${token}`, '1', { expirationTtl: 604800 }) // 7 days
  } else {
    devSessions.set(token, true)
  }
  return token
}

export async function validateSession(token: string | undefined, kv?: any): Promise<boolean> {
  if (!token) return false
  if (kv) {
    const val = await kv.get(`session:${token}`)
    return val === '1'
  }
  return devSessions.has(token)
}

export async function deleteSession(token: string | undefined, kv?: any): Promise<void> {
  if (!token) return
  if (kv) {
    await kv.delete(`session:${token}`)
  } else {
    devSessions.delete(token)
  }
}
