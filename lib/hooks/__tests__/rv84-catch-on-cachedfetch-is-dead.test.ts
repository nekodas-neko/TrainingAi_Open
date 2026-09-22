import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../..')

function sourceFiles(): Array<{ rel: string; src: string }> {
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', '.next', '__tests__'].includes(e.name)) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(e.name)) out.push(p)
    }
  }
  for (const d of ['app', 'components', 'lib']) walk(path.join(root, d))
  return out.map(abs => ({
    rel: path.relative(root, abs).replace(/\\/g, '/'),
    src: fs.readFileSync(abs, 'utf8'),
  }))
}

/** Every `.catch(...)` chained directly onto a `cachedFetch`/`cachedFetchToday` call. */
function chainedCatches(src: string) {
  const found: Array<{ line: number; body: string; hasOnError: boolean }> = []
  const re = /cachedFetch(Today)?(<[^>]*>)?\s*\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length
    let i = start, depth = 1
    while (i < src.length && depth > 0) { const c = src[i]; if (c === '(') depth++; else if (c === ')') depth--; i++ }
    const args = src.slice(start, i - 1)
    const rest = src.slice(i)
    const cm = /^\s*\.catch\s*\(/.exec(rest)
    if (!cm) continue
    let j = cm[0].length, d2 = 1
    while (j < rest.length && d2 > 0) { const c = rest[j]; if (c === '(') d2++; else if (c === ')') d2--; j++ }
    found.push({
      line: src.slice(0, m.index).split('\n').length,
      body: rest.slice(cm[0].length, j - 1).trim().replace(/\s+/g, ' '),
      hasOnError: /onError\s*:/.test(args),
    })
  }
  return found
}

const isNoop = (body: string) => /^\(?\s*\)?\s*=>\s*\{\s*\}$/.test(body)

/**
 * RV-84 — a `.catch()` on `cachedFetch` can never run, so an error state behind one is unreachable.
 *
 * `cachedFetchCore` wraps its whole network section in `try/catch/finally` and resolves a **boolean**:
 * a `!res.ok` returns after calling `onError`, a network throw is caught. The promise cannot reject.
 * So `.catch(() => setFailed(true))` is dead code and the state is never set — the Coach option
 * picker sat on "Loading your options…" forever, and the Profile achievements grid spun forever.
 *
 * **The entry's count was wrong three ways and this test encodes the real shape.** It said 16 sites.
 * Measured: **81** chained `.catch`es, of which **68** are `.catch(() => {})` — dead but harmless,
 * and deliberately not swept — **4** are redundant because `onError` is already wired beside them
 * (including `oura-section`, which the entry names as its own reference), and **9** were genuinely
 * broken. Those 9 are fixed; this pins that no tenth appears.
 */
describe('RV-84 — no unreachable error state behind a .catch on cachedFetch', () => {
  it('no site has a real .catch handler without an onError beside it', () => {
    const broken: string[] = []
    for (const { rel, src } of sourceFiles()) {
      for (const c of chainedCatches(src)) {
        if (isNoop(c.body) || c.hasOnError) continue
        broken.push(`${rel}:${c.line}  .catch(${c.body.slice(0, 60)})`)
      }
    }
    expect(
      broken,
      'a .catch on cachedFetch never runs — move the handler to the onError option, as ' +
      'components/health/oura-section.tsx does',
    ).toEqual([])
  })

  it('the no-op catches stay frozen, so the class cannot grow back quietly', () => {
    // Shrink-only. These are harmless — a `.catch(() => {})` satisfies a floating-promise lint and
    // hides nothing — so they are not worth a sweep. The count is pinned because a NEW one is a
    // fair signal that somebody still believes this promise can reject.
    const noops = sourceFiles().flatMap(({ src }) =>
      chainedCatches(src).filter(c => isNoop(c.body)))
    expect(noops.length, 'a new no-op .catch on cachedFetch appeared — it cannot fire; delete it')
      .toBeLessThanOrEqual(68)
  })
})
