import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * LB-40 — a user who already had a password could not change it.
 *
 * `EditProfileSheet` held `useState(false)` for `hasPassword` and **nothing ever fetched it**; the
 * only thing that set it true was a successful save later in the same session. The *Current
 * password* field renders behind that flag, so it never appeared, the PATCH went up without
 * `currentPassword`, and `app/api/user/password` answered *"Current password is required."* —
 * an error with no field on screen to satisfy it. Reproduced against the running route before the
 * fix, and all four paths re-checked after it.
 *
 * **Source guards, because both vitest projects run `environment: 'node'`** — nothing renders here.
 * What can be checked is the shape the defect lived in: the initialiser, the fetch, and the
 * comparison that decides whether the field is drawn.
 *
 * Comments are stripped before matching. Three guards in this repo have shipped satisfied by the
 * prose documenting their own fix, and the block above names every symbol below.
 */

const ROOT = join(__dirname, '..', '..', '..')
const SHEET = 'components/profile/edit-profile-sheet.tsx'

/** Comments gone, imports kept — one assertion below is about an import. */
const code = readFileSync(join(ROOT, SHEET), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*/g, '')

describe('LB-40 — the current-password field can actually appear', () => {
  it('does not initialise the flag to a value that hides the field', () => {
    // `useState(false)` is the defect, exactly.
    expect(code).not.toMatch(/useState\s*(<[^>]*>)?\s*\(\s*false\s*\)[^\n]*hasPassword/)
    expect(code).not.toMatch(/hasPassword[^\n]*useState\s*(<[^>]*>)?\s*\(\s*false\s*\)/)
  })

  it('starts unknown rather than false', () => {
    expect(code).toMatch(/setHasPassword\]\s*=\s*useState<boolean \| null>\(null\)/)
  })

  it('actually fetches the flag', () => {
    expect(code).toMatch(/cachedFetch<\{\s*hasPassword\?:\s*boolean\s*\}>/)
    expect(code).toMatch(/setHasPassword\(!!d\.hasPassword\)/)
  })

  it('reuses the profile key and its canonical TTL rather than minting a new one', () => {
    // A second key for the same endpoint is the duplicate-key/stale-paint class; a second TTL for
    // one key makes freshness last-writer-wins.
    expect(code).toMatch(/'more-user-profile',\s*'\/api\/user\/profile',\s*TTL_MEDIUM/)
  })

  it('renders the field unless the flag is known false', () => {
    // The fail-safe direction: unknown shows it. `cachedFetch` swallows a failed request, so a
    // cold cache plus a dead network must not land back on "hidden", which is the bug.
    expect(code).toMatch(/hasPassword !== false && \(/)
    expect(code).not.toMatch(/\{hasPassword && \(/)
  })

  it('only blocks submit when a password is known to exist', () => {
    expect(code).toMatch(/hasPassword === true && !currentPassword/)
  })
})
