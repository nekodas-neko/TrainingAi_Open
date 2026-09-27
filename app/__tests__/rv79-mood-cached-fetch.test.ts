import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** RV-79. Home read today's mood with a bare `fetch`, against the standing rule that client GETs of
 *  `/api/*` go through `cachedFetch`.
 *
 *  The conversion is only safe with `shouldCache`, and that is the whole point of this file.
 *  `cachedFetchCore` writes the response after any 2xx, outside every null check — measured on this
 *  entry — so a server `null` would overwrite an optimistic local mood log. `readCacheSync` then
 *  parses the stored "null" back as a value rather than a miss, the seeds in this screen paint it,
 *  and the check-in card re-prompts. That is the session-167 bug, and a conversion done "properly"
 *  without the predicate reintroduces it while satisfying the rule. */

const ROOT = path.resolve(__dirname, '../..')
const SRC = readFileSync(path.join(ROOT, 'app/session-select/session-select-content.tsx'), 'utf8')

/** The whole brace-balanced call, so an assertion cannot be defeated by a comment pushing an
 *  argument past a fixed character window. */
function callAt(src: string, needle: string): string | null {
  const at = src.indexOf(needle)
  if (at < 0) return null
  const open = src.lastIndexOf('(', at)
  let d = 1, j = open + 1
  while (j < src.length && d > 0) { const c = src[j]; if (c === '(') d++; else if (c === ')') d--; j++ }
  return src.slice(open, j)
}

describe('RV-79 — the mood read goes through the cache, without clobbering an optimistic log', () => {
  it('no bare fetch of /api/mood remains', () => {
    expect(SRC, 'a bare fetch here cannot join the in-flight dedup the mood sheet already uses')
      .not.toMatch(/(?<![.\w])fetch\(\s*[`'"][^`'"]*\/api\/mood/)
  })

  it('the mood read passes shouldCache, which is what keeps the conversion safe', () => {
    const call = callAt(SRC, '`/api/mood?date=${today}`')
    expect(call, 'the mood read is gone — this test would pass vacuously').not.toBeNull()
    expect(call!, 'without shouldCache a server null overwrites an optimistic log (session-167)')
      .toMatch(/shouldCache:\s*d\s*=>\s*d\s*!=\s*null/)
  })

  it('a null response still cannot clobber a value already on screen', () => {
    const call = callAt(SRC, '`/api/mood?date=${today}`')
    // The onData null branch reads the cache and only ever sets null when there was nothing there.
    expect(call!).toMatch(/if\s*\(d\s*!==\s*null\)/)
    expect(call!).toMatch(/setMoodLog\(prev\s*=>\s*\(prev\s*==\s*null\s*\?\s*null\s*:\s*prev\)\)/)
  })
})
