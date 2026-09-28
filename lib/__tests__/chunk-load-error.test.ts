import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isChunkLoadError } from '@/lib/chunk-load-error'

/**
 * LB-178's third cause — a chunk that did not arrive must be told apart from a broken screen.
 *
 * The root boundary retries the first kind once and shows the error screen for the second, so a
 * false positive silently reloads a genuinely broken screen and hides a defect. The strings come
 * from three different producers, which is why they are asserted rather than eyeballed.
 */
describe('isChunkLoadError', () => {
  it('recognises the exact message that failed CI', () => {
    // Verbatim from the retained screenshot of run 36450249635, the failure that identified this
    // cause: Home crashed to the boundary and `tn82`'s assertions never ran.
    expect(isChunkLoadError({
      message: 'Failed to load chunk /_next/static/chunks/components_activity_exercise-detected-card_tsx_844f6f61._.js '
        + 'from module [project]/components/activity/exercise-detected-card.tsx [app-client] '
        + '(ecmascript, next/dynamic entry, async loader)',
    })).toBe(true)
  })

  it('recognises the other producers of the same failure', () => {
    for (const message of [
      'Loading chunk 42 failed.',
      'Loading CSS chunk 7 failed.',
      'error loading dynamically imported module: https://example.test/a.js',
    ]) {
      expect(isChunkLoadError({ message }), message).toBe(true)
    }
    expect(isChunkLoadError({ name: 'ChunkLoadError', message: 'unrelated text' })).toBe(true)
  })

  it('does NOT swallow an ordinary application error', () => {
    // Each of these would be silently reloaded if the match were loose — which hides the defect
    // instead of showing it, and is strictly worse than the dead end this fix removes.
    for (const message of [
      "Cannot read properties of undefined (reading 'map')",
      'Hydration failed because the server rendered HTML didn’t match the client',
      'Failed to fetch',
      'NetworkError when attempting to fetch resource.',
      'chunk',
      '',
    ]) {
      expect(isChunkLoadError({ message }), message).toBe(false)
    }
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
  })
})

describe('the boundary wires it safely', () => {
  const SRC = readFileSync(join(process.cwd(), 'app/error.tsx'), 'utf8')

  it('retries at most once per page life, from a guard that survives the remount', () => {
    // `reset()` re-renders the errored segment, so a failing retry remounts this component. A state
    // or ref guard would be reset with it and the page would reload forever.
    expect(SRC).toMatch(/^let chunkRetryUsed = false/m)
    expect(SRC.includes('chunkRetryUsed = true'), 'the guard is never set, so the retry can loop').toBe(true)
  })

  it('never retries while offline — that path already has its own recovery', () => {
    expect(SRC).toMatch(/if \(!isOffline && !chunkRetryUsed && isChunkLoadError\(error\)\)/)
  })
})
