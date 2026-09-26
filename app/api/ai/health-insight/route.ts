import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { liveReadinessByDay } from '@trainingai/shared/health/live-readiness'
import { DEFAULT_TZ, todayInTz, ageFromDob, normalizeDateParamIso } from '@trainingai/shared/date-utils'
import { subDays } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { z } from 'zod'
import { formatContributors, weakestContributor } from '@/lib/oura/contributors'
import { scoreBand } from '@trainingai/shared/health/score-band'
import { latestIllnessFromDerived } from '@trainingai/shared/health/illness-radar'
import { computeActivityScore } from '@trainingai/shared/health/activity-score'
import { getDailyGoals } from '@trainingai/shared/health/daily-goals'
import { computeVolumeAcwr } from '@trainingai/shared/ai-periodization/acwr'
import { nightSessions, canonicalNightForDate, canonicalLatestNight } from '@trainingai/shared/health/sleep-night'
import { metric, splitMeasured, type MetricLine } from './metrics'
import { buildInsightText, type RecentComparison } from './insight-text'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// An enum, a date and a boolean.
const MAX_BODY_BYTES = 4 * 1024

const bodySchema = z.object({
  section: z.enum(['readiness', 'sleep', 'heart-rate', 'activity']),
  // Both separators: the client fills date params from localDateString(), which emits
  // slashes — a dash-only regex rejects every real request before the handler runs (Q-130).
  date: z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/).optional(),
  force: z.boolean().optional(),
// `.strict()` (Q-464): the one client, `components/health/ai-insight-card.tsx`, sends exactly
// `{ section, date, force }`. Date-bearing, so a dropped key would silently answer for today.
}).strict()

function bandLabel(score: number | null): string {
  return score == null ? 'unknown' : scoreBand(score).label.toLowerCase()
}

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: z.infer<typeof bodySchema>
  try {
    const read = await readJsonLimited(req, MAX_BODY_BYTES)
    if (!read.ok) {
      return read.reason === 'too_large'
        ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
        : NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }
    body = bodySchema.parse(read.body)
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const tz = session.user.timezone ?? DEFAULT_TZ
  // The schema bounds the SHAPE and nothing else, so `2026-02-31` reaches here, and it accepts the
  // slash form the client's `localDateString()` emits. Both then go Invalid at the three
  // `new Date(\`${date}T00:00:00.000Z\`)` sites below and surface as a bodiless 500 (RV-177).
  const date = body.date ? normalizeDateParamIso(body.date) : todayInTz(tz)
  if (date === null) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  // `force` stays in the schema and is deliberately unread: the card still sends it on a manual
  // refresh, and `.strict()` would reject the request outright if the key were dropped. With no
  // cache left there is nothing for it to bypass (RV-201).
  const { section } = body

  const repo = await getRepository()

  // Q-293: the cache check used to sit here, before the reads, and served whatever was written
  // first that day — so an insight generated before the ring synced was the one the user read all
  // afternoon. It now runs against a hash of the assembled prompt, which means paying for the
  // deterministic reads below on every request. They are cheap next to the model call they avoid.

  // The health metrics below are a 7-day read; the workout list is 28 (see Q-512 at the fetch).
  const ACWR_WINDOW_DAYS = 28
  const since7 = formatInTimeZone(subDays(new Date(), 7), tz, 'yyyy-MM-dd')
  const [ouraRows, sleepRows, bodyMetrics, derivedRows, summaries, recentSessions, userProfile] = await Promise.all([
    repo.getOuraDaily(userId, since7, date),
    repo.listSleepSessions(userId, since7, date),
    repo.listBodyMetrics(userId, since7, date),
    repo.getOuraDailyDerived(userId, since7, date),
    repo.getOuraDailySummary(userId, since7, date),
    // Q-512: 28 days, not 7 — matching `readiness-payload.ts`. `computeVolumeAcwr` measures its
    // span from the EARLIEST session in the list it is handed, so a 7-day list can never clear the
    // helper's 21-day gate: ACWR was structurally null here on 110 of 110 days. The gate is right
    // and must not be lowered to rescue one mis-wired caller — the window was wrong.
    repo.getWorkoutSessionsFrom(userId, subDays(new Date(), ACWR_WINDOW_DAYS)),
    repo.getUserById(userId),
  ])

  const todayOura = ouraRows.find(r => r.date === date) ?? ouraRows[ouraRows.length - 1] ?? null
  const latestSummary = summaries[summaries.length - 1] ?? null
  // todayOura can fall back to an older row — annotate so the model never reads a stale
  // day's Cloud scores as "today" (ring Cloud data is frozen since the 2026-07-07 re-key).
  const staleNote = todayOura && todayOura.date !== date
    ? `NOTE: Oura daily fields below are from ${todayOura.date} (latest available — ring Cloud data is frozen since the 2026-07-07 re-key).`
    : null

  let entries: (MetricLine | string)[]
  // The three things the prompt used to ask the model to pick out. Computing them here rather
  // than describing them in English is the whole of RV-201.
  let headline: { label: string; value: string; band?: string | null } | null = null
  let weakest: { label: string; value: number } | null = null
  let recent: RecentComparison | null = null
  if (section === 'readiness') {
    const latestIllness = latestIllnessFromDerived(derivedRows)
    // Readiness is the own BLE-derived composite (contributors still come from the derived row),
    // never the frozen Cloud score the Health screen no longer shows (F8).
    const readinessMap = liveReadinessByDay(derivedRows, ouraRows)
    const todayReadiness = readinessMap.get(date) ?? (todayOura ? readinessMap.get(todayOura.date) ?? null : null)
    const todayDerived = derivedRows.find(r => r.day === date) ?? derivedRows[derivedRows.length - 1] ?? null
    // No cast. The derived row's contributors are `{score, input, gap, provisional}` objects and
    // the Cloud row's are plain numbers; asserting the latter is what let `[object Object]` reach
    // the model for every readiness insight. `formatContributors` reads both shapes now.
    const contributors = todayDerived?.readinessContributors ?? todayOura?.readinessContributors
    if (todayReadiness != null) headline = { label: 'Readiness', value: `${todayReadiness}/100`, band: bandLabel(todayReadiness) }
    weakest = weakestContributor(contributors)
    // Today is excluded from its own baseline, so "above the past week" cannot be satisfied by
    // today's own value sitting in the series it is compared against.
    recent = {
      noun: "the past week's scores",
      values: ouraRows.filter(r => r.date !== date).map(r => readinessMap.get(r.date)).filter((v): v is number => v != null),
      today: todayReadiness,
    }
    entries = [
      ...(todayReadiness == null ? [metric('Readiness score', null)] : []),
      `Contributors: ${formatContributors(contributors)}`,
      latestSummary?.tempDevC != null
        ? metric('Body temp deviation (vs personal ring baseline)', `${latestSummary.tempDevC > 0 ? '+' : ''}${latestSummary.tempDevC.toFixed(1)}°C`)
        : metric('Body temp deviation', todayOura?.temperatureDeviation != null
          ? `${todayOura.temperatureDeviation > 0 ? '+' : ''}${todayOura.temperatureDeviation.toFixed(1)}°C (pre-re-key Cloud value — not current)`
          : null),
      metric('Illness radar', latestIllness ? `${latestIllness.flag} (score ${latestIllness.score}/100, vs personal baseline)` : null),
    ]
  } else if (section === 'sleep') {
    // Nights, not rows (Q-76): `find(date === …)` returns whichever row for the day came back first,
    // so an evening nap could be handed to the model as last night's sleep — and the fallback to the
    // last row has the same exposure.
    const nights = nightSessions(sleepRows, tz)
    const todaySleep = canonicalNightForDate(nights, date) ?? canonicalLatestNight(nights)
    if (todayOura?.sleepScore != null) {
      headline = { label: 'Sleep score', value: `${todayOura.sleepScore}/100`, band: bandLabel(todayOura.sleepScore) }
    } else if (todaySleep?.durationHours != null) {
      // No score tonight, so duration leads rather than the card opening on an absence.
      headline = { label: 'Sleep duration', value: `${Math.round(todaySleep.durationHours * 60)} min`, band: null }
    }
    weakest = weakestContributor(todayOura?.sleepContributors as Record<string, number | null> | null | undefined)
    entries = [
      ...(todayOura?.sleepScore == null ? [metric('Sleep score', null)] : []),
      ...(todayOura?.sleepScore != null
        ? [metric('Duration', todaySleep?.durationHours != null ? `${Math.round(todaySleep.durationHours * 60)} min` : null)]
        : []),
      metric('Efficiency', todaySleep?.efficiency != null ? `${todaySleep.efficiency}%` : null),
      metric('Overnight HRV', todaySleep?.averageHrvMs != null ? `${Math.round(todaySleep.averageHrvMs)} ms` : null),
      metric('Avg sleeping HR', todaySleep?.avgHeartRate != null ? `${Math.round(todaySleep.avgHeartRate)} bpm` : null),
      `Contributors: ${formatContributors(todayOura?.sleepContributors)}`,
    ]
  } else if (section === 'heart-rate') {
    const todayBm = bodyMetrics.find(r => r.date === date) ?? bodyMetrics[bodyMetrics.length - 1] ?? null
    if (todayBm?.restingHeartRate != null) {
      // No band: `scoreBand` reads a 0-100 score, and a resting heart rate is not one. Calling
      // 52 bpm "excellent" is precisely the invented judgement Q-292 caught the model making.
      headline = { label: 'Resting heart rate', value: `${todayBm.restingHeartRate} bpm`, band: null }
    }
    // A lower resting heart rate is the better one, so the comparison's wording flips.
    recent = {
      noun: 'the recent readings',
      values: bodyMetrics.filter(r => r.date !== date && r.restingHeartRate != null).map(r => r.restingHeartRate as number),
      today: todayBm?.restingHeartRate ?? null,
      lowerIsBetter: true,
    }
    entries = [
      ...(todayBm?.restingHeartRate == null ? [metric('Resting heart rate', null)] : []),
      metric('Overnight HRV (daily record, same metric as above)', todayBm?.hrvMs != null ? `${todayBm.hrvMs} ms` : null),
    ]
  } else {
    // The Oura Cloud activity fields are frozen since the 2026-07-07 re-key (always null), so this
    // reads our own goal-anchored Activity Score v2 (lib/health/activity-score.ts) — the same
    // computation /api/readiness-score uses — rather than always reporting "no data".
    const todayBmForActivity = bodyMetrics.find(r => r.date === date) ?? null
    const goals = getDailyGoals({
      weightKg: [...bodyMetrics].reverse().find(m => m.weightKg != null && m.weightKg > 0)?.weightKg ?? null,
      heightCm: userProfile?.heightCm ?? null,
      ageYears: ageFromDob(userProfile?.dateOfBirth, new Date(`${date}T00:00:00.000Z`)),
      sex: userProfile?.sex ?? null,
      activityLevel: userProfile?.activityLevel ?? null,
    })
    // `recentSessions` spans 28 days for the ACWR helper (Q-512), so these two — which are read by
    // the model as "this week" and feed the activity score's 7-day lanes — filter back down rather
    // than silently becoming 28-day figures. Widening the fetch without this would have turned a
    // structurally-null ACWR into a wrong session count, which is the worse failure.
    const from7dMs = new Date(`${date}T00:00:00.000Z`).getTime() - 7 * 86_400_000
    const sessions7dRows = recentSessions.filter(ws => ws.startedAt.getTime() >= from7dMs)
    const sessions7d = sessions7dRows.length
    const volume7dKg = sessions7dRows.reduce((s, ws) => s + ws.exercises.reduce((s2, ex) => s2 + (ex.volume ?? 0), 0), 0)
    const load = computeVolumeAcwr(
      recentSessions.map(ws => ({ startedAt: ws.startedAt, volumeKg: ws.exercises.reduce((s2, ex) => s2 + (ex.volume ?? 0), 0) })),
      new Date(`${date}T00:00:00.000Z`),
    )
    const activityResult = computeActivityScore({
      steps: todayBmForActivity?.steps ?? null,
      activeCalories: todayBmForActivity?.activeCalories ?? null,
      sessions7d,
      volume7dKg,
      typicalSessionVolumeKg: load.typicalSessionVolumeKg,
      goals,
    })
    if (activityResult?.score != null) {
      headline = { label: 'Activity', value: `${activityResult.score}/100`, band: bandLabel(activityResult.score) }
    }
    entries = [
      ...(activityResult?.score == null ? [metric('Activity score', null)] : []),
      metric('Steps', todayBmForActivity?.steps != null ? `${todayBmForActivity.steps} (goal ${goals.stepGoal})` : null),
      metric('Active calories', todayBmForActivity?.activeCalories != null ? `${todayBmForActivity.activeCalories} kcal (goal ${goals.activeEnergyGoal} kcal)` : null),
      // Session count is a real count from our own history — zero sessions IS a measurement, not an
      // absent reading, so it stays a line rather than becoming "not measured".
      `Strength training this week: ${sessions7d} session(s) (goal ${goals.strengthFreqGoal}/week), ${Math.round(volume7dKg)} kg total volume`,
      ...(activityResult?.taperApplied ? ['Note: score is eased back today — recent training load is above the optimal range (over-exertion taper).'] : []),
    ]
  }

  const { lines: dataLines, absent } = splitMeasured(entries)

  // Nothing was measured at all. Q-452 gates the card on a section having data so this should not be
  // reachable from the UI, but the route is callable directly and `force` bypasses the cache — and
  // omitting absent metrics (Q-353) is what makes it reachable at all, since heart-rate no longer
  // has an unconditional line. Answer deterministically rather than paying for a model call whose
  // only honest output is "there are no readings", which is the exact prompt shape that produced
  // the invented-zero sentence in the first place.
  // Not cached, and the reason changed with Q-293: it used to be that the (user, section, date) key
  // would keep serving this after the ring synced. The context hash handles that now — a later sync
  // changes the prompt and misses. It stays uncached because recomputing it is free; it never calls
  // the model.
  if (dataLines.length === 0) {
    const insight = `No ${section.replace('-', ' ')} readings were recorded for ${date}, so there is nothing to interpret yet.`
    return NextResponse.json({ insight })
  }

  // No model, no cache, no rate limit (RV-201). The text is a pure function of numbers this
  // handler has already computed, so recomputing it is cheaper than the round-trip that would
  // read it back — and it works with the network off, which the model never did.
  //
  // What went with the model: `hashInsightContext`/`readFreshInsight` (a cache exists to avoid a
  // paid call), the 10/hour limit (nothing to rate-limit), and the `degradedFromFacts` catch path
  // (there is no failure left to degrade from). `upsertAiHealthInsight` is no longer written here;
  // the stored rows stay for history and nothing reads them on this path.
  const insight = buildInsightText({ headline, lines: dataLines, absent, weakest, recent, staleNote })

  return NextResponse.json({ insight })
}
