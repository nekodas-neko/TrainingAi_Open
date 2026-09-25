import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../..')
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
/** Comments state the intent; these assertions are about what runs. */
const code = (rel: string) =>
  src(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

/**
 * BF-177 — "kcal left" held a pre-log number on the S25 until the user left the tab and came back.
 *
 * **Three earlier fixes all added another one-shot refetch, and the device kept failing, because
 * the race is not losable by timing.** The write is local-first + outbox: the refetch fires at the
 * LOCAL write and reaches the server ~60-70 ms before `POST /api/sync/push` does, so it re-caches
 * the pre-log figures. Traced on the S25 at v1.465.16 — the card's own GET answered
 * `remainingKcal=857`, the push landed, and a GET 440 ms later answered 846, which was correct and
 * was somebody else's request. On the web the write is an awaited POST, which is why
 * `e2e/bf177-kcal-left-updates-after-log.spec.ts` stayed green throughout.
 *
 * So this file pins a CHAIN of four links rather than one call site, because the fix is only alive
 * while all four hold and three of them live in files nobody editing the card would open:
 *
 *   log-food.ts fires a post-push invalidation → it clears `energy-balance:`
 *     → the hook subscribes to that prefix → and refetches the day on screen.
 *
 * Break any one and the card silently returns to the owner's report. The React half is not
 * unit-testable here — both vitest projects are `environment: 'node'` with no
 * `@testing-library/react` — so these are source assertions, and the device look is what confirms
 * the behaviour.
 */
describe('BF-177 — the balance refetch listens for the post-push invalidation', () => {
  it('log-food.ts still invalidates AFTER the outbox push, not only at the local write', () => {
    // The link the card cannot see. Its own comment: "again once the server has the write —
    // otherwise the refetch this triggers re-caches the pre-log figures". That second invalidation
    // was always arriving; until this entry, nothing on the Nutrition tab was listening for it.
    expect(code('packages/shared/src/nutrition/log-food.ts'))
      .toMatch(/pushThenRevalidate\(userId!, invalidateNutritionWrite\)/)
  })

  it('invalidateNutritionWrite clears the prefix the hook subscribes to', () => {
    const groups = code('lib/cache-groups.ts')
    const body = groups.slice(groups.indexOf('export async function invalidateNutritionWrite'))
    expect(body.slice(0, body.indexOf('\n}'))).toMatch(/invalidateCache\('energy-balance:'\)/)
  })

  it('the hook subscribes to energy-balance: rather than relying on its caller to re-ask', () => {
    expect(code('app/nutrition/use-energy-balance-refetch.ts'))
      .toMatch(/useInvalidationRefetch\('energy-balance:'/)
  })

  it('the subscription refetches the day ON SCREEN, not the last day it happened to fetch', () => {
    // `lastDateRef` is only ever set by `refetch`, so a subscription reading it does nothing until
    // the hook has already fetched once — which excludes the case subscribing exists for: a write
    // made somewhere else (Home's quick-add, the wrap-up sheet) while the Nutrition tab sits
    // mounted in the persistent shell and has fetched nothing this session.
    const hook = code('app/nutrition/use-energy-balance-refetch.ts')
    const sub = hook.slice(hook.indexOf("useInvalidationRefetch('energy-balance:'"))
    expect(sub.slice(0, sub.indexOf('\n\n'))).toMatch(/refetch\(dateRef\.current\)/)
    expect(sub.slice(0, sub.indexOf('\n\n')), 'lastDateRef is null before the first fetch')
      .not.toMatch(/lastDateRef/)
  })

  it('the Nutrition screen hands the hook the date it is rendering', () => {
    // `selectedDateRef` and not `selectedDate`: the hook holds the callback across renders, and a
    // captured string would pin the subscription to whichever day was on screen at mount.
    expect(code('app/nutrition/nutrition-content.tsx'))
      .toMatch(/useEnergyBalanceRefetch\(setEnergyBalance, selectedDateRef\)/)
  })
})
