// Issue 2435 — characterization of TODAY's live Activity score.
//
// The Activity score used to be computed inline in `buildReadinessPayload` from "today" inputs.
// It is now `scoreActivityForDay`, so the same formula can score a COMPLETED day. These snapshots
// were captured from the inline code BEFORE the extraction, on fixtures that exercise every lane
// (HR-derived zone minutes and moved hours, the strength window, the over-exertion taper, a day
// with no movement data). The extraction must reproduce them exactly: the live ring for the
// in-progress day is not meant to change at all.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { appendFileSync } from 'fs'
import { monthFixture, fixtureRepo, type ActivityFixture } from './fixtures/activity-day-fixtures'
import captured from './fixtures/activity-day-characterization-2435.json'

let fx: ActivityFixture
let repo: ReturnType<typeof fixtureRepo>
vi.mock('@/lib/data', () => ({ getRepository: async () => repo, getRepositoryAsync: async () => repo }))

import { buildReadinessPayload } from '@/lib/health/readiness-payload'

const TZ = 'Australia/Brisbane'
const TODAY = '2026-10-08'
const NOW = new Date('2026-10-08T05:00:00Z') // 15:00 in Brisbane

function liveActivity(p: Awaited<ReturnType<typeof buildReadinessPayload>>) {
  const persisted = repo.upsertOuraDailyDerived.mock.calls
    .filter(c => c[1] === TODAY && (c[2] as Record<string, unknown>).activityScore !== undefined)
    .map(c => {
      const patch = c[2] as { activityScore: number; activityContributors: Record<string, unknown> }
      return { activityScore: patch.activityScore, activityContributors: patch.activityContributors }
    })
  return {
    activityScore: p.activityScore,
    activityBlend: p.activityBlend,
    activityContributors: p.activityContributors,
    activityGoals: p.activityGoals,
    activitySignals: p.activitySignals,
    activityTaperApplied: p.activityTaperApplied,
    persisted,
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

async function run(f: ActivityFixture) {
  fx = f
  repo = fixtureRepo(fx)
  return liveActivity(await buildReadinessPayload('u1', TZ))
}

/** The captured value for a scenario. `CAPTURE_2435=<file>` appends the current outputs to a file instead, which is
 *  how the JSON was produced from the pre-extraction code. */
function expectCaptured(key: keyof typeof captured, actual: unknown) {
  if (process.env.CAPTURE_2435) {
    appendFileSync(process.env.CAPTURE_2435, `${JSON.stringify({ [key]: actual })}
`)
    return
  }
  expect(JSON.parse(JSON.stringify(actual))).toEqual(captured[key])
}

describe('the live Activity score for today (characterization, issue 2435)', () => {
  it('a normal training month: HR lanes, strength window, ACWR in band', async () => {
    expectCaptured('normal', await run(monthFixture(TODAY, TZ)))
  })

  it('a heavy last week: the over-exertion taper bites', async () => {
    expectCaptured('heavyWeek', await run(monthFixture(TODAY, TZ, { heavyWeek: true })))
  })

  it('no steps, no energy and no HR today: strength lane only', async () => {
    const f = monthFixture(TODAY, TZ, { todaySteps: null, todayKcal: null })
    f.hr = f.hr.filter(r => r.timestamp.getTime() < new Date('2026-10-07T14:00:00Z').getTime())
    expectCaptured('strengthOnly', await run(f))
  })

  it('nothing at all to score', async () => {
    expectCaptured('nothing', await run({ metrics: [], hr: [], sessions: [], derived: [], program: null }))
  })
})
