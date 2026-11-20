/**
 * The public repo never names the origin's address.
 *
 * The repo is public, so a committed origin IP tells every scanner where to go
 * around Cloudflare. Scripts read it from the env (`ORIGIN_IP`, a repo secret in
 * CI). This check knows the address only through that same env, so it never
 * names it either; without the env it says it skipped. A pattern scan for any
 * IPv4 literal was tried and dropped: the tools' test fixtures hold hundreds.
 *
 * Mutation that must fail: with ORIGIN_IP set, put its value into any tracked file.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const ip = process.env.ORIGIN_IP?.trim()
if (!ip) {
  console.log('exposure: skipped, ORIGIN_IP is not set')
} else {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf-8' }).split('\0').filter(Boolean)
  const found = files.filter(file => {
    try { return readFileSync(file, 'utf-8').includes(ip) } catch { return false }
  })
  // File names only: never echo the address into a public CI log.
  assert.deepEqual(found, [], `the origin address is committed in: ${found.join(', ')}`)
  console.log(`exposure: the origin address is in none of ${files.length} tracked files`)
}
