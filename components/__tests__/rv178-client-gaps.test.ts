import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')

/**
 * Source with comments stripped.
 *
 * Every fix below is explained in a comment that names the thing it removed, so a scanner run
 * against the raw text finds `setHours`-style ghosts of its own documentation and passes or fails
 * for the wrong reason.
 */
const code = (rel: string) =>
  readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')

/**
 * RV-178 — six client-side gaps from review sweep 58.
 *
 * These are scanners rather than render tests because the vitest config has no jsdom project, so
 * nothing here can mount a component. Each one therefore asserts the narrowest mechanical fact that
 * distinguishes the fixed code from the broken code, not "the fix looks right".
 */
describe('RV-178 — a self-fetching card must not vanish on failure', () => {
  it("home's timeline passes onError, so a failed load is not an empty day", () => {
    const src = code('components/home-day-timeline.tsx')
    expect(src).toMatch(/useCachedValue[\s\S]{0,300}?onError:/)
  })
})

describe('RV-178 — a write button taken twice must fire once', () => {
  // Both go through the shared `useGuardedAction`, whose latch is unit-tested in
  // lib/hooks/__tests__/use-guarded-action.test.ts. What is asserted here is only that these two
  // call sites are wrapped — a hand-rolled ref at either would drift from the tested one.
  it('clonePhaseSet is guarded — a double tap made a second copy', () => {
    const src = code('components/config-screen.tsx')
    expect(src).toMatch(/const\s+clonePhaseSet\s*=\s*useGuardedAction\(/)
    expect(src, 'clonePhaseSet is still an unguarded declaration')
      .not.toMatch(/function\s+clonePhaseSet\s*\(/)
  })

  it("the AI insight card guards the TAP, and leaves its effect's load alone", () => {
    const src = code('components/health/ai-insight-card.tsx')
    expect(src).toMatch(/const\s+refreshInsight\s*=\s*useGuardedAction\(/)
    // The Refresh button must go through the guarded one.
    const onClick = /onClick=\{[^}]*\}/.exec(src)?.[0] ?? ''
    expect(onClick).toContain('refreshInsight')
    expect(onClick, 'the tap still calls the unguarded loader').not.toMatch(/fetchInsight/)
    // …and the mount effect must NOT, or switching section mid-flight drops the new load and
    // strands the previous section's insight with no retry.
    const effect = /useEffect\(\(\) => \{[\s\S]*?hasData\]\)/.exec(src)?.[0] ?? ''
    expect(effect, 'the effect was not found — this test is guarding nothing').toContain('fetchInsight')
    expect(effect, 'the effect is behind the tap guard').not.toContain('refreshInsight')
  })
})

describe('RV-178 — a memo() child needs stable handlers', () => {
  // Both children are wrapped in memo(), so a handler re-created each render defeats it silently
  // while the component still reads as optimised. The existing Custom Rules check catches an inline
  // arrow at the call site and not a function passed by name, which is how these two survived.
  it.each([
    ['components/mood-checkin-sheet.tsx', 'toggleSoreMuscle', 'components/checkin/sore-muscle-picker.tsx'],
    ['components/nutrition/saved-meals-sheet.tsx', 'backToMeals', 'components/nutrition/meal-builder-header.tsx'],
  ])('%s: %s is a useCallback', (parent, handler, child) => {
    expect(code(child), `${child} is not memo()'d — this test guards the wrong thing`).toMatch(/memo\(/)
    const src = code(parent)
    expect(src).toMatch(new RegExp(`const\\s+${handler}\\s*=\\s*useCallback\\(`))
    expect(src, `${handler} is still a plain declaration`).not.toMatch(new RegExp(`function\\s+${handler}\\s*\\(`))
  })
})

describe('RV-178 — a client GET of /api/* is cached and seeded', () => {
  it.each([
    // oura-section keeps a hand-rolled read: it is one of several loaders behind a shared
    // `loading` flag and a tab-show refresh, not a component whose whole body is one key.
    ['components/more/oura-section.tsx', 'oura-ble-freshness', /readCacheSync[\s\S]*cachedFetch|cachedFetch[\s\S]*readCacheSync/],
    // the profile page is one key, so it takes the hook — which also refetches on invalidation and
    // is what the fetch-once ratchet requires.
    ['app/profile/[userId]/page.tsx', 'public-profile:', /useCachedValue</],
  ])('%s reads through the cache, not a bare fetch', (file, key, shape) => {
    const src = code(file)
    expect(src).toMatch(shape)
    expect(src).toContain(key)
    // A bare `fetch('/api/…')` with no method is a GET, and that is the shape being retired here.
    // Writes keep theirs: the ones left in these files declare a method.
    for (const m of src.matchAll(/[^.\w]fetch\(\s*[`'"]\/api\/[\s\S]{0,400}?\)/g)) {
      expect(m[0], `bare GET still in ${file}: ${m[0].slice(0, 70)}`).toMatch(/method:/)
    }
  })

  it('the two new keys are registered in an invalidation group', () => {
    const groups = code('lib/cache-groups.ts')
    expect(groups).toContain("invalidateCache('oura-ble-freshness')")
    expect(groups).toContain("invalidateCache('public-profile:')")
  })
})
