// LB-48 — a saved RMR test evicts the key the Recommended calories are computed from.
//
// `POST /api/measured-rmr` invalidated nothing and `measured-rmr` was in no group, so after saving
// an RMR test the Profile goals section painted the previous resting rate from cache before the
// revalidation corrected it.
//
// **The entry's severity claim was measured and is wrong, which is worth recording because it is
// the reason this fix is small.** It said the stale value survived "until the app is restarted",
// reasoning that `goals-section.tsx` fetches inside a `useEffect(…, [user?.id])` in the persistent
// tab shell. The tab shell does keep all five tabs mounted — but the RMR form lives at
// `/more/clinical`, which is a plain page OUTSIDE the shell, reached by `router.push`. Driving
// `/more` → `/more/clinical` → back in Chromium logged the effect 3 times and then 3 more: the
// section remounts, so the stale value is a first-paint flash, not hours of hard staleness.
//
// The eviction is still the right fix — it turns "stale then correct" into "correct" — and it is
// what the standing rule asks for. What it is not is a fix for a symptom that lasts a session.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const form = read('components/more/clinical/measured-rmr-form.tsx')
const groups = read('lib/cache-groups.ts')

describe('a saved RMR test evicts the goal caches (LB-48)', () => {
  it('the RMR form invalidates through the named group, not a hand-rolled key list', () => {
    expect(form).toContain('invalidateGoalRecommendations')
    // The standing rule: no ad-hoc `invalidateCache(...)` at a write site.
    expect(form).not.toMatch(/invalidateCache\(/)
  })

  it('the group carries the key the goals screen reads', () => {
    const body = groups.slice(
      groups.indexOf('export async function invalidateGoalRecommendations'),
      groups.indexOf('export async function invalidateOuraSync'))
    expect(body).toContain("invalidateCache('measured-rmr')")
  })
})
