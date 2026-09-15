import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Two bugs, one shape: a link to the Program Builder that goes somewhere plausible and does not
 * work, with nothing failing.
 *
 * **Q-223** — `/config` redirected to `/more?tab=config`, but `more-content.tsx` parsed only
 * `profile | friends | workout`. The unrecognised value fell through to `profile`, so both links to
 * the Builder just opened More.
 *
 * **Q-256** — `/config` then redirected with a bare `redirect('/more?tab=workout')`, which drops the
 * query string. `?new=program` never arrived, so the AI prescription card's post-deload "New
 * program" action opened the Builder and silently failed to open the sheet.
 *
 * **PS-35a deleted `/config` itself** (owner, 2026-09-14: *"We only use the APK - delete them if not
 * needed"*), which is why this file moved out of `app/config/__tests__/` and was re-pointed rather
 * than deleted. **The invariant outlived every specific that named it, twice now** — first the
 * `tab=` value when Q-235 gave the Builder its own route, now the redirect hop itself. What must
 * still hold is that every entry point to the Builder lands on it and carries its parameters.
 *
 * The forwarding guard is the one that changed shape. There is no redirect left to forward a query
 * string, so the thing that can now silently drop `new=program` is the **call site**: the
 * prescription card has to pass it and `/program` has to read it. Both are asserted below.
 *
 * A source-text check is the honest shape here — the repo runs `environment: 'node'` with no jsdom,
 * so rendering these routes to assert where they land is not available without a dependency
 * decision this test should not make.
 */
/** Comments are not behaviour. The negative assertions below first failed on prose describing the
 *  very bugs they guard — the comment in `config-screen.tsx` explaining the old
 *  `window.location.search` read. Stripping comments keeps the assertions strict about code without
 *  making them unwritable-about. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

const root = process.cwd()
const MORE_CONTENT = readFileSync(join(root, 'app/more/more-content.tsx'), 'utf8')
const PROGRAM_CONTENT = readFileSync(join(root, 'app/program/program-content.tsx'), 'utf8')
const PROGRAM_PAGE = readFileSync(join(root, 'app/program/page.tsx'), 'utf8')
const PRESCRIPTION_CARD = readFileSync(join(root, 'components/workout/ai-prescription-card.tsx'), 'utf8')

describe('legacy entry points reach the Program Builder', () => {
  it('/program is where the Builder actually mounts', () => {
    // Everything below asserts a link *to* /program. If ConfigScreen ever stops being what
    // /program renders, those assertions would all still pass while pointing at nothing.
    expect(PROGRAM_CONTENT).toMatch(/import\(["']@\/components\/config-screen["']\)/)
    expect(PROGRAM_CONTENT).toMatch(/<ConfigScreen/)
  })

  it('the deleted /config alias has not come back', () => {
    // PS-35a removed it. A re-added redirect is not harmless: it reintroduces the hop whose
    // query-string handling is what Q-256 was.
    expect(() => readFileSync(join(root, 'app/config/page.tsx'), 'utf8')).toThrow()
  })

  it('the new-program deep link is passed by the caller and read by the route (Q-256)', () => {
    // With the redirect gone, this is the whole path: the card must send the param and the route
    // must consume it. Either half missing is the original silent failure in a new place.
    expect(PRESCRIPTION_CARD).toMatch(/['"`]\/program\?new=program['"`]/)
    expect(PROGRAM_PAGE).toMatch(/newParam === ["']program["']/)
  })

  it('no in-repo caller still points at a deleted alias route', () => {
    // The five PS-35a deleted: /config, /stats, /profile (bare), /session-select, /workout-select.
    // A missed call site is a 404 inside the APK, which is exactly what the owner's condition on
    // that entry was about.
    for (const [file, src] of [
      ['ai-prescription-card', PRESCRIPTION_CARD],
      ['more-content', MORE_CONTENT],
      ['program-content', PROGRAM_CONTENT],
    ] as const) {
      expect(code(src), `${file} still links to a deleted alias`)
        .not.toMatch(/["'`]\/(config|stats|session-select|workout-select)(["'`?])/)
    }
  })

  it('/more?tab=workout still resolves to the Builder instead of falling through (Q-223)', () => {
    // `workout` is no longer a tab More renders, so the danger is the original one exactly: an
    // unrecognised value silently defaulting to `profile`. It must be handled explicitly.
    expect(MORE_CONTENT).toMatch(/p === 'workout'/)
    expect(MORE_CONTENT).toMatch(/router\.replace\(['"]\/program['"]\)/)

    // And it must not be reachable as a tab value, which is what made it look handled before.
    const union = MORE_CONTENT.match(/type Tab\s*=\s*([^;]+);/)
    expect(union, 'could not find the Tab union in app/more/more-content.tsx').toBeTruthy()
    const accepted = [...union![1].matchAll(/"([a-z]+)"/g)].map(x => x[1])
    expect(accepted).not.toContain('workout')
  })

  it('the new-program deep link is a prop, not a window.location read (Q-256)', () => {
    // window.location.search is what let a dropped param fail silently: the component asked the URL
    // directly, so nothing between the link and the screen had to know the param existed. As a prop
    // resolved from /program's own searchParams, a caller that forgets it changes a call site.
    const CONFIG_SCREEN = readFileSync(join(root, 'components/config-screen.tsx'), 'utf8')
    expect(CONFIG_SCREEN).toMatch(/openNewProgram\?: boolean/)
    expect(code(CONFIG_SCREEN)).not.toMatch(/window\.location\.search/)
  })
})
