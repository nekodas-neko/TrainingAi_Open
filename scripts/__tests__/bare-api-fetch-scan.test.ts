import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { bareApiGets } = require('../check-bare-api-fetch.js') as {
  bareApiGets: (src: string) => { url: string; line: number }[]
}

/** LB-155. The rule "client GETs of /api/* use cachedFetch, never bare fetch" had no enforcement and
 *  68 live violations, so both entries citing it (RV-79, LB-154) read as one-offs.
 *
 *  This pins the SCAN, not the count — because the count is what went wrong twice. A first pass
 *  reported 7 sites where there were 191 (a sibling scan whose regex demanded `(` right after the
 *  name, missing `cachedFetch<T>(…)`), and this one reported 69 where there were 68, because a
 *  mutation declared its method as the shorthand `{ method, headers }` with no colon and was counted
 *  as a GET. A figure from an unpinned scanner is a guess with a number attached. */

const ROOT = path.resolve(__dirname, '../..')

describe('LB-155 — the bare-/api/-GET scan counts what it claims to', () => {
  it('finds a plain GET, and reads a URL that spans lines', () => {
    expect(bareApiGets(`fetch('/api/mood?date=x')`).map(h => h.url)).toEqual(['/api/mood?date=x'])
    // The multi-line shape is the common one in this repo and defeats any line-based scan.
    const multi = bareApiGets(`await fetch(\n  \`/api/oura/hr-window?start=\${a}\`,\n)`)
    expect(multi).toHaveLength(1)
  })

  it('ignores a mutation, whether the method has a colon, a ternary, or is SHORTHAND', () => {
    expect(bareApiGets(`fetch('/api/x', { method: 'POST' })`)).toEqual([])
    expect(bareApiGets(`fetch('/api/x', { method: d ? 'POST' : 'DELETE' })`)).toEqual([])
    // The trap that put a wrong figure into three merged documents.
    expect(bareApiGets(`const method = 'POST'; fetch('/api/x', { method, headers: h })`)).toEqual([])
    expect(bareApiGets(`fetch('/api/x', { method })`)).toEqual([])
  })

  it('ignores a cachedFetch, and anything that merely ends in fetch', () => {
    expect(bareApiGets(`cachedFetch('k', '/api/x', TTL, d => d)`)).toEqual([])
    expect(bareApiGets(`this.fetch('/api/x')`)).toEqual([])
    expect(bareApiGets(`fetch('/not-api/x')`)).toEqual([])
  })

  it('the check passes and states the split it measured', () => {
    // Guards the vacuous case: a scan that stopped matching would report a clean rule. The script
    // also refuses to pass if it finds no /api/ fetch at all, for the same reason.
    const out = execFileSync('node', ['scripts/check-bare-api-fetch.js'], { cwd: ROOT, encoding: 'utf8' })
    expect(out).toMatch(/\d+ bare \/api\/ GET\(s\) — \d+ in debug consoles, \d+ on exempt endpoints, \d+ tracked/)
  })
})
