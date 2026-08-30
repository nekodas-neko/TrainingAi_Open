// BF-53's sibling sweep, frozen — because the way this shipped was a sweep.
//
// `invalidUuidResponse` was applied across the 30 dynamic `[id]` routes to close Q-482. Two of them
// key on a `bigserial`, and a decimal id can never match a UUID regex, so those two returned
// `400 Invalid id` to every real request and the pending weigh-in triage was dead in production.
//
// The rule this pins is the one that sweep needed: **a route whose id reaches a repository method
// taking `id: number` must not guard it as a UUID.** Checked from source rather than at runtime,
// because the failure is total — such a route can never reach its repository at all, so a test that
// exercises it is a test of a route that never runs.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) routeFiles(p, out)
    else if (name === 'route.ts') out.push(p)
  }
  return out
}

/** Repository methods whose id parameter is a number — read from the interface, never hand-listed. */
const numericIdMethods = (() => {
  const src = readFileSync(join(root, 'lib/data/repository.ts'), 'utf8')
  const found = new Set<string>()
  for (const line of src.split('\n')) {
    const m = /^\s{2}(\w+)\(.*\bid[A-Za-z]*: number\b/.exec(line)
    if (m) found.add(m[1])
  }
  return found
})()

describe('a numeric route key is never guarded as a UUID (BF-53)', () => {
  const files = routeFiles(join(root, 'app/api'))

  it('finds the repository methods keyed by a number', () => {
    // If this ever reads zero the check below passes vacuously, which is the failure mode a
    // source-derived list has.
    expect(numericIdMethods.size).toBeGreaterThan(0)
    expect(numericIdMethods.has('dismissScaleSample')).toBe(true)
    expect(numericIdMethods.has('confirmScaleSample')).toBe(true)
  })

  it('no route calls a number-keyed method behind invalidUuidResponse', () => {
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      if (!src.includes('invalidUuidResponse')) continue
      for (const m of numericIdMethods) {
        if (src.includes(`.${m}(`)) offenders.push(`${file.slice(root.length + 1)} → ${m}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the two routes that shipped broken use the numeric guard', () => {
    for (const p of [
      'app/api/scale-ble/pending/[id]/dismiss/route.ts',
      'app/api/scale-ble/pending/[id]/confirm/route.ts',
    ]) {
      const src = readFileSync(join(root, p), 'utf8')
      expect(src, `${p} still guards a bigserial as a UUID`).not.toContain('invalidUuidResponse')
      expect(src, `${p} has no id guard at all`).toContain('numericRouteId(')
    }
  })

  // …and each still does its own job. The DB-backed test next door proves this properly, but it
  // skips in CI, so nothing there would notice these two files becoming the same file. That is not
  // hypothetical: every Next route file is named `route.ts`, and a backup keyed on the basename
  // overwrote one with the other while this fix was being written. The symptom was "Not me"
  // CONFIRMING the reading — strictly worse than the bug being fixed.
  it('dismiss dismisses and confirm confirms', () => {
    const read = (p: string) => readFileSync(join(root, 'app/api/scale-ble/pending/[id]', p, 'route.ts'), 'utf8')
    const dismissSrc = read('dismiss')
    const confirmSrc = read('confirm')
    expect(dismissSrc).toContain('dismissScaleSample(')
    expect(dismissSrc).not.toContain('confirmScaleSample(')
    expect(confirmSrc).toContain('confirmScaleSample(')
    expect(dismissSrc).not.toBe(confirmSrc)
  })
})

describe('numericRouteId', () => {
  it('accepts what a bigserial produces and nothing else', async () => {
    const { numericRouteId } = await import('@/lib/api/route-errors')
    for (const good of ['1', '41', '9007199254740991']) {
      expect(numericRouteId(good), good).toMatchObject({ ok: true, id: Number(good) })
    }
    // `Number.isInteger(Number(x))` — the guard that sat unreachable underneath the UUID one —
    // accepts every one of these. A bigserial column produces none of them.
    for (const bad of ['0', '-1', '1e3', '0x10', ' 41 ', '', '1.0', 'abc', '9007199254740993']) {
      expect(numericRouteId(bad), bad).toMatchObject({ ok: false })
    }
  })

  it('answers 400, matching invalidUuidResponse rather than inventing a status', async () => {
    const { numericRouteId } = await import('@/lib/api/route-errors')
    const r = numericRouteId('nope')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.response.status).toBe(400)
    expect(await r.response.json()).toEqual({ error: 'Invalid id' })
  })
})


// The half that made a 400 survive as *"doesn't do anything"*. Asserted at source because both
// vitest projects run in `node` with no @testing-library/react — the established substitute here
// (`local-store-write-fallback.test.ts` scans a file for a shape for the same reason).
describe('the pending-reading buttons surface a failure (BF-53)', () => {
  const src = readFileSync(join(root, 'components/settings/scale-pairing.tsx'), 'utf8')

  it('no longer treats a non-ok response as a no-op', () => {
    // The exact shape that shipped: `if (res.ok) setPending(...)` with nothing on the other branch,
    // so a route answering 400 to every press was indistinguishable from a button doing nothing.
    for (const handler of ['confirmReading', 'dismissReading']) {
      const body = src.slice(src.indexOf(`async function ${handler}(`))
      const fn = body.slice(0, body.indexOf('\n  }\n'))
      expect(fn, `${handler} still ignores a failed response`).toContain('if (!res.ok)')
      expect(fn, `${handler} does not report the failure`).toContain('pendingActionFailed')
    }
  })

  it('renders the error it sets', () => {
    expect(src).toContain('{error && ')
  })
})
