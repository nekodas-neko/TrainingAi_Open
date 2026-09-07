import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ, todayInTz } from '@trainingai/shared/date-utils'
import { maxCompliantRestGap } from '@trainingai/shared/schedule-utils'
import {
  replayCollection, LADDERS, STEPS_MAX_REST_GAP, SLEEP_MAX_REST_GAP, COLLECTION_RULES_VERSION,
  type CollectionState,
} from '@trainingai/shared/collection/ladder'

/**
 * LB-60 — the collection engine had no way to be fed.
 *
 * BF-122a shipped `replayCollection` as a pure fold and deliberately no route, which left the fold
 * with no caller anywhere in the repo and BF-122b's widget unstartable: of the four things a
 * `ReplayInput` needs, the client could reach one, over a fixed window, for one of the three
 * ladders.
 *
 * **This returns the three finished `CollectionState`s, not the inputs.** The entry called that
 * preferable and it is: the fold is a shared pure function, and shipping its inputs to the client
 * means two places can disagree about which days paused — which for `pausedDays` is the difference
 * between a rest day the app itself asked for and a missed one.
 */

/** The collection is a replay over ALL history, so there is no window to bound the reads with. */
const HISTORY_START = '2000-01-01'

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const today = todayInTz(tz)
  const repo = await getRepository()

  const [trainedDays, restDays, program, bodyMetrics, sleepSessions] = await Promise.all([
    repo.listTrainedDayKeys(userId, tz),
    repo.listRestDays(userId, HISTORY_START, today),
    repo.getActiveProgram(userId),
    repo.listBodyMetrics(userId, HISTORY_START, today),
    repo.listSleepSessions(userId, HISTORY_START, today),
  ])

  // `pausedDays` is the rest days the user actually chose, which is the app's own record of a
  // compliant rest rather than a guess at one.
  //
  // **Deload days are NOT in here yet and that is a known gap**, named because the entry's own
  // argument is that decaying compliance turns the mechanic against the user. `isDeloadActive`
  // answers for one day given its resolved phase, so covering a deload week means resolving the
  // phase engine per day across all history — too much for a read route to do on every call, and
  // too easy to get quietly wrong. A rest day is weekly and a deload week is occasional, so this
  // covers the common case; the remainder is filed rather than pretended away.
  const pausedDays = restDays

  // A faucet day for these two is a day that was RECORDED, not one above a bar — see the note in
  // `ladder.ts`. Measured before wiring this up: only 35 of the owner's 130 step-days reach 8,000,
  // so a threshold would decay the steps ladder most weeks, against the engine's own instruction
  // not to manufacture tension there.
  const stepDays = bodyMetrics.filter(m => (m.steps ?? 0) > 0).map(m => m.date)
  const sleepDays = sleepSessions.filter(sl => (sl.durationHours ?? 0) > 0).map(sl => sl.date)

  const collections: Record<'workout' | 'steps' | 'sleep', CollectionState> = {
    workout: replayCollection({
      days: trainedDays,
      ladder: LADDERS.workout,
      // The one ladder with a schedule to derive an allowance from. `maxCompliantRestGap` falls
      // back to one rest day when there is no schedule, which is the same answer the streak already
      // assumed for an unscheduled user.
      maxRestGap: maxCompliantRestGap(program),
      pausedDays,
      today,
    }),
    steps: replayCollection({
      days: stepDays, ladder: LADDERS.steps, maxRestGap: STEPS_MAX_REST_GAP, pausedDays, today,
    }),
    sleep: replayCollection({
      days: sleepDays, ladder: LADDERS.sleep, maxRestGap: SLEEP_MAX_REST_GAP, pausedDays, today,
    }),
  }

  return NextResponse.json(
    // `rulesVersion` rides along so a cached collection and a live one cannot straddle a threshold
    // change unnoticed — the cache half of `ladder.ts`'s versioning note. `no-store` is the other
    // half: this route is replayed from history on every read and must never be served stale.
    { collections, rulesVersion: COLLECTION_RULES_VERSION, today },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
