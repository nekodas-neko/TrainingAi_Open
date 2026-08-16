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
 * **Q-235** made the Builder its own route, `/program`, which is why this file was rewritten rather
 * than deleted when its original assertions stopped compiling against reality: the *invariant*
 * survives the restructure even though every specific it named is gone. There is no `tab=` value to
 * agree on any more; what must still hold is that every legacy entry point lands on the Builder and
 * carries its parameters.
 *
 * A source-text check is the honest shape here — the repo runs `environment: 'node'` with no jsdom,
 * so rendering these routes to assert where they land is not available without a dependency
 * decision this test should not make.
 */
/** Comments are not behaviour. Both negative assertions below first failed on prose describing the
 *  very bugs they guard — the comment in `config/page.tsx` explaining the old `/more?tab=` target,
 *  and the one in `config-screen.tsx` explaining the old `window.location.search` read. Stripping
 *  comments keeps the assertions strict about code without making them unwritable-about. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

const root = process.cwd()
const CONFIG_PAGE = readFileSync(join(root, 'app/config/page.tsx'), 'utf8')
const MORE_CONTENT = readFileSync(join(root, 'app/more/more-content.tsx'), 'utf8')
const PROGRAM_CONTENT = readFileSync(join(root, 'app/program/program-content.tsx'), 'utf8')

describe('legacy entry points reach the Program Builder', () => {
  it('/program is where the Builder actually mounts', () => {
    // Everything below asserts a redirect *to* /program. If ConfigScreen ever stops being what
    // /program renders, those assertions would all still pass while pointing at nothing.
    expect(PROGRAM_CONTENT).toMatch(/import\(["']@\/components\/config-screen["']\)/)
    expect(PROGRAM_CONTENT).toMatch(/<ConfigScreen/)
  })

  it('/config redirects to /program', () => {
    expect(CONFIG_PAGE).toMatch(/redirect\([^)]*['"`]\/program/)
    // The pre-Q-235 target. A redirect back into a More sub-tab would resurrect both bugs at once.
    expect(code(CONFIG_PAGE)).not.toMatch(/\/more\?tab=/)
  })

  // The other assertions here read source text, which is enough for "does this file still say the
  // right thing". It is NOT enough for forwarding: a first version of this test asserted that
  // `searchParams` and `URLSearchParams` appear in the file, and a mutation that kept both and set
  // the suffix to `''` passed it while dropping every param — a guard recognising the shape of the
  // fix rather than its effect. So this one calls the route. `redirect()` throws a NEXT_REDIRECT
  // whose digest carries the target, which is the observable behaviour and cannot be faked by
  // mentioning the right identifiers.
  async function redirectTargetOf(params: Record<string, string>): Promise<string> {
    const mod = await import('@/app/config/page')
    try {
      await mod.default({ searchParams: Promise.resolve(params) })
    } catch (err) {
      const digest = (err as { digest?: string }).digest ?? ''
      const m = digest.match(/NEXT_REDIRECT;[^;]*;([^;]*)/)
      if (m) return m[1]
      throw err
    }
    throw new Error('/config did not redirect')
  }

  it('/config forwards its query string rather than dropping it (Q-256)', async () => {
    expect(await redirectTargetOf({ new: 'program' })).toBe('/program?new=program')
  })

  it('/config with no params redirects cleanly, without a trailing ?', async () => {
    expect(await redirectTargetOf({})).toBe('/program')
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
    // resolved from /program's own searchParams, a redirect that forgets it changes a call site.
    const CONFIG_SCREEN = readFileSync(join(root, 'components/config-screen.tsx'), 'utf8')
    expect(CONFIG_SCREEN).toMatch(/openNewProgram\?: boolean/)
    expect(code(CONFIG_SCREEN)).not.toMatch(/window\.location\.search/)
  })
})
