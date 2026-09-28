import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { stripComments } from '../../../scripts/lib/strip-comments.js'

/**
 * LB-176 — a failed read on Health must not render as a fact about the account.
 *
 * Cold at 412 px with every `GET /api/*` down, this screen printed BURNED / BMI / BALANCE / DIST /
 * RESTING HR / HRV / SPO₂ as **"No data"**, told the owner there were *"No activities this week"*, and
 * asked him to *"Add your height, age and sex in Profile"* — details he set months ago. Every one of
 * those is a statement about a request, printed as a statement about him.
 *
 * `e2e/rv150-failed-read-says-so.spec.ts` owns the rendered proof, including the healthy-cold control
 * that stops an always-rendered line from passing. This file is the fast half: it pins the *source*
 * property the render depends on, because E2E is advisory here and takes 36 minutes.
 *
 * **Comments stripped before matching.** Each fix is explained at its call site and those comments
 * quote the copy they replaced, so a raw-source assertion would pass on the explanation.
 */

const ROOT = path.resolve(__dirname, '../../..')
const code = (rel: string) => stripComments(readFileSync(path.join(ROOT, rel), 'utf8')).replace(/\s+/g, ' ')

/** Index just past the `)` that closes the call containing `at`, by paren depth. */
function closeOfCall(src: string, at: number): number {
  const open = src.lastIndexOf('(', at)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') { depth--; if (depth === 0) return i + 1 }
  }
  return src.length
}

describe('LB-176 — every read behind an empty state reports its failures', () => {
  /**
   * The reads whose payload feeds a cell or card that says something about the account when empty.
   * A read here without `onError` cannot tell "nothing stored" from "the request failed", because
   * `cachedFetch` and `useCachedValue` both swallow `!res.ok` (RV-150/Q-499).
   */
  const READS: [file: string, key: string][] = [
    ['app/health/health-content.tsx', 'body-metadata'],
    ['app/health/health-content.tsx', 'training-load'],
    ['app/health/health-content.tsx', 'sleep-performance-correlation'],
    ['app/health/health-content.tsx', 'progress-summary'],
    ['app/health/health-content.tsx', 'user-goals'],
    ['components/health/hr-day-card.tsx', 'oura-hr-day'],
    ['components/health/activity-history-card.tsx', 'activity-logs'],
    ['components/health/nutrition-activity-trends-card.tsx', 'health-trends-summary'],
    ['app/health/heart-rate/page.tsx', 'oura-hr-day'],
  ]

  for (const [file, key] of READS) {
    it(`${key} in ${path.basename(file)} passes onError`, () => {
      const src = code(file)
      // Anchored on the FETCH, not on the first mention of the key. Several of these keys are also
      // `readCacheSync`-seeded in the same file, and a plain indexOf found that seed — which has no
      // `opts` argument, so the guard failed against correct code. Walk each occurrence back a short
      // way and keep the one whose call is a cachedFetch-family read.
      const sites = [...src.matchAll(new RegExp(`['"\`]${key}['":\`]`, 'g'))]
        .map(m => m.index!)
        .filter(i => /cachedFetch(Today)?<|useCachedValue</.test(src.slice(Math.max(0, i - 200), i)))
      expect(sites.length, `no cachedFetch of ${key} in ${file} — this guard has gone stale`)
        .toBeGreaterThan(0)
      for (const at of sites) {
        // Bounded by the call's OWN closing paren, matched by depth. A character count is wrong (a
        // fixed window stopped short of `opts` on a sibling guard and let a control pass, RV-183) and
        // so is "the next `),`" — after whitespace collapse several of these calls end `) }, )`, so
        // that sentinel never appears and the slice came back empty, failing against correct code.
        const call = src.slice(at, closeOfCall(src, at))
        expect(call, `${key} swallows its failures — the empty state below it will read as a fact `
          + 'about the account').toMatch(/onError:/)
      }
    })
  }

  it('the energy-balance hook lets its caller see a failure', () => {
    // The Health screen is the caller that needs it: `null` there meant loading, failed, and
    // "nothing stored" alike, and the fallback for all three told him to redo his profile.
    const hook = code('app/health/hooks/use-health-calcs.ts')
    expect(hook).toMatch(/export function useEnergyBalanceToday\(\s*opts\?:/)
    expect(hook, 'the hook must forward opts or the caller cannot hear the failure').toMatch(/ENERGY_BALANCE_TTL,\s*opts,/)
  })

  it('a failed energy-balance read does not render the profile prompt', () => {
    // The whole point of the entry's worst case: EnergyBudgetPrompt must be reachable only with a
    // payload in hand, never from the null branch.
    const src = code('app/health/health-sections.tsx')
    // There are TWO `case "energyBudget"` arms in this file — one in `isSectionVisible`, which just
    // `return true`s, and one in the renderer. A plain indexOf found the first and failed against
    // correct code; this is the third time in this file that the first occurrence was the wrong one
    // (the others were a `readCacheSync` seed sharing a cache key, and a double-quoted key).
    const arms = [...src.matchAll(/case "energyBudget"/g)].map(m => m.index!)
    const at = arms.find(i => src.slice(i, i + 900).includes('CalorieBalanceBar'))
    expect(at, 'the energyBudget render arm moved — this guard has gone stale').toBeDefined()
    // A fixed slice here, not `closeOfCall`: that matches PARENS and this arm is a `{}` block, so it
    // walked backwards past `at` and returned an empty string. 900 is the same span the selector
    // above already confirmed contains the arm.
    const arm = src.slice(at!, at! + 900)
    expect(arm).toMatch(/if \(energyBalance != null\)/)
    expect(arm).toMatch(/energyBalanceFailed/)
    expect(arm, 'the prompt must sit inside the non-null branch').toMatch(
      /if \(energyBalance != null\)[\s\S]*EnergyBudgetPrompt/)
  })

  it('the Goals card says it could not load rather than leaving the screen', () => {
    const card = code('components/health/goals-progress-card.tsx')
    expect(card).toMatch(/visibleRows\.length === 0/)
    expect(card, 'an empty Goals card must distinguish "no goals set" from a failed read')
      .toMatch(/failed\s*\?\s*<EmptyState/)
  })

  it('the copy is the one the repo already uses, not a new phrasing', () => {
    // `movement-balance-card.tsx` and `weekly-stats-hub.tsx` said "Couldn't load your …" through
    // EmptyState before this entry existed. Settling the copy meant adopting that, not inventing one.
    expect(code('components/health/movement-balance-card.tsx')).toMatch(/Couldn&apos;t load|Couldn't load/)
    const sections = code('app/health/health-sections.tsx')
    expect(sections).toMatch(/Couldn't load/)
    expect(sections, 'a competing phrasing crept in').not.toMatch(/Unable to load|Failed to load|Error loading/)
  })
})
