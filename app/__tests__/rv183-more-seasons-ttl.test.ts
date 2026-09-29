import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { stripComments } from '../../scripts/lib/strip-comments.js'

/**
 * RV-183, third RV-67 key. `more-seasons` carries `freshWithinTtl: true`, so a More re-show inside the
 * 30-minute TTL does not touch `/api/seasons`. The proof that makes it safe:
 *
 *   - **Purity.** `listSeasonsWithResults` is two plain selects — every `seasons` row, then this
 *     user's `season_results` — mapped straight to the payload. No `now()`, no derivation, nothing
 *     that decays with the clock. That is what disqualified the other candidates on this screen:
 *     `body-battery` drains with the clock, `readiness-score` is fed by server-side rollup writes,
 *     and `more-user-profile` carries a `countWorkoutSessions()` derivation.
 *   - **Writers: none exist.** No insert, update or delete against either table anywhere in the repo,
 *     and `/api/seasons` is GET-only. So the "every writer's group holds the key" half is vacuous
 *     rather than unproven.
 *   - **A cleared entry still fetches.** `cachedFetchCore` short-circuits only when a cached value
 *     exists AND is fresh, so if a group ever starts clearing this key the flag needs no change.
 *
 * The fragile half is the second bullet: the day something starts writing seasons from the client
 * without clearing the key, a badge is 30 minutes stale with no crash. That is what this pins —
 * and it fails on the *appearance of a writer*, not on a forgotten invalidation, because there is no
 * group to forget yet.
 */

const ROOT = path.resolve(__dirname, '../..')

const sourceFiles = () =>
  execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('__tests__'))

describe('RV-183 — the more-seasons TTL gate stays safe', () => {
  it('the payload is still two stored-row reads, not a derivation', () => {
    const slice = readFileSync(path.join(ROOT, 'lib/data/postgres/slices/social.ts'), 'utf8')
    const at = slice.indexOf('export async function listSeasonsWithResults')
    expect(at, 'listSeasonsWithResults moved — re-do the RV-67 proof').toBeGreaterThan(-1)
    const body = slice.slice(at, slice.indexOf('\n}', at))
    expect(body).toMatch(/from\(s\.seasons\)/)
    expect(body).toMatch(/from\(s\.seasonResults\)/)
    // The disqualifiers, asserted as absences. A clock read or an aggregate here makes the payload
    // impure and every contributing write a writer of this key.
    expect(body, 'the payload now depends on the clock — re-do the RV-67 proof')
      .not.toMatch(/Date\.now\(|new Date\(|todayInTz|now\(\)/)
    expect(body, 'the payload now derives a figure — re-do the RV-67 proof')
      .not.toMatch(/\bcount\(|\bsum\(|reduce\(/)
  })

  it('still nothing writes seasons or season_results', () => {
    // The whole proof rests on this. A writer appearing without an invalidation group is exactly the
    // 30-minute-stale case, so this fails on the writer rather than waiting for the symptom.
    const offenders: string[] = []
    for (const f of sourceFiles()) {
      const src = readFileSync(path.join(ROOT, f), 'utf8')
      if (!/s\.seasons\b|s\.seasonResults\b/.test(src)) continue
      // Drizzle writes against either table.
      if (/\.(insert|update|delete)\(\s*s\.(seasons|seasonResults)\b/.test(src)) offenders.push(f)
    }
    expect(offenders, 'something now writes seasons — either give it a cache group holding '
      + '`more-seasons`, or drop `freshWithinTtl` from the More screen').toEqual([])
  })

  it('the route is still GET-only', () => {
    const route = readFileSync(path.join(ROOT, 'app/api/seasons/route.ts'), 'utf8')
    expect(route).toMatch(/export async function GET/)
    expect(route, 'a mutating handler appeared — re-do the RV-67 proof')
      .not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/)
  })

  it('the flag is on both More-screen keys', () => {
    // Comments STRIPPED first. The proof for this flag is written at its call site and names
    // `freshWithinTtl` several times, so a raw-source slice between the two calls matched the prose
    // rather than the code — the control run that flagged the profile key exposed it as a baseline
    // failure. Strip, then collapse whitespace so the assertions survive a reformat.
    const more = stripComments(readFileSync(path.join(ROOT, 'app/more/more-content.tsx'), 'utf8'))
      .replace(/\s+/g, ' ')
    const seasonsAt = more.indexOf("'more-seasons', '/api/seasons'")
    const profileAt = more.indexOf("'more-user-profile', '/api/user/profile'")
    expect(seasonsAt, 'the seasons call moved').toBeGreaterThan(-1)
    expect(profileAt, 'the profile call moved').toBeGreaterThan(-1)
    expect(more.slice(seasonsAt)).toMatch(/freshWithinTtl:\s*true/)
    // Bounded by the NEXT call, not by a character count. A fixed 260-char window looked right and
    // passed a control run that flagged this very key: four lines of RV-150 comment sit between the
    // key and its `opts`, so the window stopped short of the thing it was meant to check. The profile
    // call precedes the seasons call inside `refresh`, so this slice is exactly its region.
    expect(profileAt, 'the two calls swapped order — re-bound this slice').toBeLessThan(seasonsAt)
    // Was asserted ABSENT until LB-180 landed: the payload carried `countWorkoutSessions()`, a
    // derivation no completion-path group clears. That field is gone, the three remaining
    // un-invalidating writers are closed below, and the flag is on.
    expect(more.slice(profileAt, seasonsAt), 'more-user-profile lost its freshWithinTtl — if that was '
      + 'deliberate, the writer guards below are now dead weight')
      .toMatch(/freshWithinTtl:\s*true/)
  })

  it('the profile payload is still a pure read of one stored row', () => {
    // The RV-67 half. A derivation, a clock or a `today` in this handler re-disqualifies the key,
    // and the failure mode is 30 minutes of a wrong identity block rather than a flash.
    const route = readFileSync(path.join(ROOT, 'app/api/user/profile/route.ts'), 'utf8')
    const get = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function PATCH'))
    expect(get, 'the dead workoutCount derivation came back — see LB-180').not.toMatch(/countWorkoutSessions/)
    expect(get, 'a clock in the payload disqualifies freshWithinTtl').not.toMatch(/Date\.now\(\)|new Date\(|todayInTz/)
  })

  it('equipping a title clears the profile key', () => {
    // Found while proving this: the equip PATCH writes `users.equipped_title`, part of
    // `/api/user/profile`'s payload, and updated local state only. Harmless while that key always
    // revalidates; 30 minutes of a wrong title the moment it does not.
    const sheet = readFileSync(path.join(ROOT, 'components/more/title-picker-sheet.tsx'), 'utf8')
    expect(sheet).toMatch(/\/api\/user\/equipped-title/)
    expect(sheet, 'a writer of users.equipped_title must clear more-user-profile')
      .toMatch(/invalidateUserProfile\(\)/)
  })

  // The three writers found while proving the profile key. Each wrote a users column that is part of
  // `/api/user/profile`'s payload and updated local state only — invisible while the key always
  // revalidated, and 30 minutes of hard staleness the moment it stopped.
  it.each([
    ['app/session-select/session-select-content.tsx', /nutrition-goals\/touch-review/,
      'users.last_goal_review_at — and this screen reads it back to decide whether to re-prompt'],
    ['components/profile/edit-profile-sheet.tsx', /'\/api\/user\/password'/,
      'users.password_hash — reported as hasPassword, which this same sheet reads'],
    ['lib/user/preferences-sync.ts', /'\/api\/user\/preferences'/,
      'users.preferences — nothing reads it back through this key today, which is why it would be missed'],
  ])('%s invalidates the profile key after its users write', (file, writes, why) => {
    const src = readFileSync(path.join(ROOT, file), 'utf8')
    expect(src, `${file} no longer makes this write — re-check the proof`).toMatch(writes)
    expect(src, `a writer of ${why} must clear more-user-profile`).toMatch(/invalidateUserProfile\(\)/)
  })
})
