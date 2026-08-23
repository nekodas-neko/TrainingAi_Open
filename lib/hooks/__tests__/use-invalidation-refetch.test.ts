import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../..')
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '__tests__'].includes(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

function sourceFiles(): Array<{ rel: string; src: string }> {
  return ['app', 'components'].flatMap(d => walk(path.join(root, d))).map(abs => ({
    rel: path.relative(root, abs).replace(/\\/g, '/'),
    src: fs.readFileSync(abs, 'utf8'),
  }))
}

/**
 * Three screens hand-rolled `window.addEventListener('ta:oura-ble-synced', … refetch …)` because
 * nothing refetched their cache keys on invalidation (Q-91, then Q-402). `useInvalidationRefetch`
 * replaced all three, and subscribing to the invalidation is strictly wider than listening for the
 * one event — `sleep-sessions` is cleared by `invalidateBiometrics` too.
 *
 * The React behaviour is not unit-testable here (both vitest projects are `environment: 'node'`
 * with no `@testing-library/react`), so this guards the part that is: that the pattern does not
 * come back, and that the coalescing which makes the multi-key call site correct is still present.
 */
describe('useInvalidationRefetch adoption', () => {
  it('no screen refetches a cache key from the BLE event listener any more', () => {
    // The event itself is still legitimate for non-cache work — session-select bumps `refreshTick`
    // on it — so this asserts the narrower thing: no `cachedFetch` inside such a listener.
    const offenders: string[] = []
    for (const { rel, src } of sourceFiles()) {
      for (const m of src.matchAll(/['"]ta:oura-ble-synced['"]/g)) {
        // The handler is defined just above its addEventListener call, so a short look-back covers
        // it without reaching into unrelated code.
        if (src.slice(Math.max(0, m.index - 400), m.index).includes('cachedFetch')) offenders.push(rel)
      }
    }
    expect([...new Set(offenders)]).toEqual([])
  })

  it('is adopted by the three screens that carried the hand-rolled listener', () => {
    for (const rel of [
      'app/session-select/session-select-content.tsx',
      'app/health/sleep/sleep-content.tsx',
      'app/health/health-content.tsx',
    ]) {
      expect(read(rel), rel).toContain('useInvalidationRefetch')
    }
  })

  it('coalesces, because invalidateCache fires once per key', () => {
    // health-content passes three keys and reloads all of them in one function. Without the
    // coalescing window a single group clearing all three runs that load three times.
    const src = read('lib/hooks/use-invalidation-refetch.ts')
    expect(src).toMatch(/pending/)
    expect(src).toMatch(/setTimeout/)
    expect(read('app/health/health-content.tsx')).toMatch(/useInvalidationRefetch\(\[/)
  })

  it('matches prefixes in both directions, like useCachedValue', () => {
    // A group clears a broader prefix than the key it holds, or the exact key. Only checking one
    // direction silently misses every prefix-group invalidation.
    const src = read('lib/hooks/use-invalidation-refetch.ts')
    expect(src).toMatch(/k\.startsWith\(prefix\)/)
    expect(src).toMatch(/prefix\.startsWith\(k\)/)
  })
})
