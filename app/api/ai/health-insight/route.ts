import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { generateText } from 'ai'
import { aiModel, loggedGenerateText } from '@/lib/ai/instrument'
import { liveReadinessByDay } from '@trainingai/shared/health/live-readiness'
import { hashInsightContext, readFreshInsight } from '@/lib/ai/insight-cache'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ, todayInTz, ageFromDob } from '@trainingai/shared/date-utils'
import { subDays } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { z } from 'zod'
import { formatContributors } from '@/lib/oura/contributors'
import { scoreBand } from '@trainingai/shared/health/score-band'
import { latestIllnessFromDerived } from '@trainingai/shared/health/illness-radar'
import { computeActivityScore } from '@trainingai/shared/health/activity-score'
import { getDailyGoals } from '@trainingai/shared/health/daily-goals'
import { computeVolumeAcwr } from '@trainingai/shared/ai-periodization/acwr'
import { nightSessions } from '@trainingai/shared/health/sleep-night'
import { metric, splitMeasured, buildPrompt, type MetricLine } from './prompt'
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
  const date = body.date ?? todayInTz(tz)
  const { section, force } = body

  const repo = await getRepository()

  // Q-293: the cache check used to sit here, before the reads, and served whatever was written
  // first that day — so an insight generated before the ring synced was the one the user read all
  // afternoon. It now runs against a hash of the assembled prompt, which means paying for the
  // deterministic reads below on every request. They are cheap next to the model call they avoid.

  const since7 = formatInTimeZone(subDays(new Date(), 7), tz, 'yyyy-MM-dd')
  const [ouraRows, sleepRows, bodyMetrics, derivedRows, summaries, recentSessions, userProfile] = await Promise.all([
    repo.getOuraDaily(userId, since7, date),
    repo.listSleepSessions(userId, since7, date),
    repo.listBodyMetrics(userId, since7, date),
    repo.getOuraDailyDerived(userId, since7, date),
    repo.getOuraDailySummary(userId, since7, date),
    repo.getWorkoutSessionsFrom(userId, subDays(new Date(), 7)),
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
  if (section === 'readiness') {
    const latestIllness = latestIllnessFromDerived(derivedRows)
    // Readiness is the own BLE-derived composite (contributors still come from the derived row),
    // never the frozen Cloud score the Health screen no longer shows (F8).
    const readinessMap = liveReadinessByDay(derivedRows, ouraRows)
    const todayReadiness = readinessMap.get(date) ?? (todayOura ? readinessMap.get(todayOura.date) ?? null : null)
    const todayDerived = derivedRows.find(r => r.day === date) ?? derivedRows[derivedRows.length - 1] ?? null
    entries = [
      metric('Readiness score', todayReadiness != null ? `${todayReadiness}/100 (${bandLabel(todayReadiness)})` : null),
      `Contributors: ${formatContributors((todayDerived?.readinessContributors ?? todayOura?.readinessContributors) as Record<string, number | null> | null | undefined)}`,
      latestSummary?.tempDevC != null
        ? metric('Body temp deviation (vs personal ring baseline)', `${latestSummary.tempDevC > 0 ? '+' : ''}${latestSummary.tempDevC.toFixed(1)}°C`)
        : metric('Body temp deviation', todayOura?.temperatureDeviation != null
          ? `${todayOura.temperatureDeviation > 0 ? '+' : ''}${todayOura.temperatureDeviation.toFixed(1)}°C (pre-re-key Cloud value — not current)`
          : null),
      metric('Illness radar', latestIllness ? `${latestIllness.flag} (score ${latestIllness.score}/100, vs personal baseline)` : null),
      `Past week scores: ${ouraRows.map(r => `${r.date} ${readinessMap.get(r.date) ?? '—'}`).join(', ')}`,
    ]
  } else if (section === 'sleep') {
    // Nights, not rows (Q-76): `find(date === …)` returns whichever row for the day came back first,
    // so an evening nap could be handed to the model as last night's sleep — and the fallback to the
    // last row has the same exposure.
    const nights = nightSessions(sleepRows, tz)
    const todaySleep = nights.find(r => r.date === date) ?? nights.at(-1) ?? null
    entries = [
      metric('Sleep score', todayOura?.sleepScore != null ? `${todayOura.sleepScore}/100` : null),
      metric('Duration', todaySleep?.durationHours != null ? `${Math.round(todaySleep.durationHours * 60)} min` : null),
      metric('Efficiency', todaySleep?.efficiency != null ? `${todaySleep.efficiency}%` : null),
      metric('Overnight HRV', todaySleep?.averageHrvMs != null ? `${Math.round(todaySleep.averageHrvMs)} ms` : null),
      metric('Avg sleeping HR', todaySleep?.avgHeartRate != null ? `${Math.round(todaySleep.avgHeartRate)} bpm` : null),
      `Contributors: ${formatContributors(todayOura?.sleepContributors)}`,
    ]
  } else if (section === 'heart-rate') {
    const todayBm = bodyMetrics.find(r => r.date === date) ?? bodyMetrics[bodyMetrics.length - 1] ?? null
    const rhr7d = bodyMetrics.filter(r => r.restingHeartRate).map(r => `${r.restingHeartRate}`)
    entries = [
      metric('Resting heart rate', todayBm?.restingHeartRate != null ? `${todayBm.restingHeartRate} bpm` : null),
      metric('Overnight HRV (daily record, same metric as above)', todayBm?.hrvMs != null ? `${todayBm.hrvMs} ms` : null),
      metric('7-day RHR readings', rhr7d.length > 0 ? rhr7d.join(', ') : null),
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
    const sessions7d = recentSessions.length
    const volume7dKg = recentSessions.reduce((s, ws) => s + ws.exercises.reduce((s2, ex) => s2 + (ex.volume ?? 0), 0), 0)
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
    entries = [
      metric('Activity score', activityResult?.score != null ? `${activityResult.score}/100 (${bandLabel(activityResult.score)})` : null),
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

  if (staleNote) dataLines.unshift(staleNote)

  const prompt = buildPrompt(section, dataLines, absent)
  const contextHash = hashInsightContext(prompt)

  if (!force) {
    const cached = await readFreshInsight(repo, userId, section, date, contextHash)
    if (cached) return NextResponse.json({ insight: cached })
  }

  // Rate limit only applies when we actually need to call the AI
  if (!rateLimit(`ai-insight:${userId}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let text: string
  try {
    // F7: route retries through the shared helper (maxRetries: 0 on the SDK call) like every other
    // AI route, so backoff + reportServerError live in one place instead of the SDK's default retry.
    ;({ text } = await loggedGenerateText(
      { section: 'health-insight', userId, fingerprint: { section, date, contextHash } },
      () => generateText({
        model: aiModel(),
        prompt,
        maxRetries: 0,
      }),
    ))
  } catch (err) {
    console.error('[ai/health-insight] generateText failed:', err)
    return NextResponse.json({ error: 'AI generation failed' }, { status: 502 })
  }

  const insight = text.trim()
  await repo.upsertAiHealthInsight(userId, section, date, insight, contextHash)

  return NextResponse.json({ insight })
}
