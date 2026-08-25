import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { generateText } from 'ai'
import { aiModel, loggedGenerateText } from '@/lib/ai/instrument'
import { hashInsightContext, readFreshInsight } from '@/lib/ai/insight-cache'
import { formatInTimeZone } from 'date-fns-tz'
import { DEFAULT_TZ, todayMidnightUtc, todayDayOfWeek } from '@trainingai/shared/date-utils'
import { rateLimit } from '@/lib/rate-limit'
import { normalizeMuscle, roleWeight } from '@trainingai/shared/muscles'
import { liveReadinessByDay } from '@trainingai/shared/health/live-readiness'
import { resilienceLevelToBand } from '@/lib/health/stress-resilience'
import { latestIllnessFromDerived } from '@trainingai/shared/health/illness-radar'
import { computeSleepScoreSeries } from '@trainingai/shared/health/sleep-score'
import { nightSessions } from '@trainingai/shared/health/sleep-night'
import { describePersonalRecord } from '@trainingai/shared/1rm'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { PROSE_GUARDS } from '@/lib/ai/prompt-guards'

// An optional force flag.
const MAX_BODY_BYTES = 4 * 1024

const CACHE_SECTION = 'weekly-digest'

// Recaps the last completed Mon–Sun week (the week that just ended), compared against
// the week before it. Reviewing a completed week — rather than "this week so far" —
// keeps the recap meaningful and the volume comparison fair no matter which day the
// user opens it: on a Monday morning "this week so far" is near-empty and reads as a
// misleading ~100% drop vs the prior full week. The recap week here always matches the
// banner's cache key (startOfWeek − 7).
export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Optional body: an absent or unreadable one keeps the default, only an oversized one is refused.
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok && read.reason === 'too_large') {
    return NextResponse.json({ error: 'Request too large' }, { status: 413 })
  }
  const force = Boolean((read.ok ? (read.body as { force?: unknown } | null) : null)?.force)

  const tz = session.user?.timezone ?? DEFAULT_TZ

  // The last completed Mon–Sun week in the user's timezone. currentWeekStart is this
  // week's Monday (00:00); the recap week is the full 7 days before it, and the prior
  // week is the 7 days before that — so every comparison is full-week vs full-week.
  const currentWeekStart = new Date(todayMidnightUtc(tz).getTime() - todayDayOfWeek(tz) * 86_400_000)
  const recapWeekStart = new Date(currentWeekStart.getTime() - 7 * 86_400_000)
  const recapWeekEnd   = currentWeekStart // exclusive — start of the current, in-progress week
  const priorWeekStart = new Date(recapWeekStart.getTime() - 7 * 86_400_000)
  const isoWeekKey = formatInTimeZone(recapWeekStart, tz, 'yyyy-MM-dd')

  const repo = await getRepository()

  // Q-293: the cache check used to sit here and serve the first digest written for the week for
  // the rest of it. The recap week is closed, so its inputs mostly are too — but a late ring
  // back-fill or a corrected weigh-in still changes them, and there was no way to notice.

  // Last day of the recap week = the Sunday just gone (recapWeekEnd is the exclusive
  // start of the current week, so step back 1 ms to land on that Sunday's date).
  const recapWeekEndIso = formatInTimeZone(new Date(recapWeekEnd.getTime() - 1), tz, 'yyyy-MM-dd')
  const priorWeekEndIso = formatInTimeZone(new Date(recapWeekStart.getTime() - 1), tz, 'yyyy-MM-dd')
  const from14dIso = formatInTimeZone(priorWeekStart, tz, 'yyyy-MM-dd')

  const [sessions, bodyMetrics, sleepSessions, ouraRows, weekPrs, derivedRows, exerciseLibrary] = await Promise.all([
    repo.getWorkoutSessionsFrom(userId, priorWeekStart),
    repo.listBodyMetrics(userId, from14dIso, recapWeekEndIso),
    repo.listSleepSessions(userId, from14dIso, recapWeekEndIso),
    repo.getOuraDaily(userId, from14dIso, recapWeekEndIso),
    repo.listRecentPersonalRecords(userId, recapWeekStart, recapWeekEnd),
    repo.getOuraDailyDerived(userId, from14dIso, recapWeekEndIso),
    repo.listExerciseLibrary(),
  ])
  // A bodyweight PR is BW_REF-relative — never announce it as a weight (finding Q-19).
  const exerciseTypeByName = new Map(exerciseLibrary.map(e => [e.name, e.exerciseType]))

  const recapWeekSessions = sessions.filter(ws => ws.startedAt >= recapWeekStart && ws.startedAt < recapWeekEnd && ws.exercises.length > 0)
  const priorWeekSessions = sessions.filter(ws => ws.startedAt >= priorWeekStart && ws.startedAt < recapWeekStart && ws.exercises.length > 0)

  const sumVol = (arr: typeof sessions) =>
    arr.reduce((s, ws) => s + ws.exercises.reduce((e, ex) => e + (ex.volume ?? 0), 0), 0)

  const recapWeekVol = Math.round(sumVol(recapWeekSessions))
  const priorWeekVol = Math.round(sumVol(priorWeekSessions))
  const volChange   = priorWeekVol > 0
    ? `${recapWeekVol > priorWeekVol ? '+' : ''}${Math.round((recapWeekVol - priorWeekVol) / priorWeekVol * 100)}% vs the week before`
    : 'first week of data'

  // Per-muscle weighted set volume for the recap week (main = 1.0, secondary = 0.5 —
  // same weighting as the periodization engine)
  const exerciseNames = [...new Set(recapWeekSessions.flatMap(ws => ws.exercises.map(ex => ex.exerciseName)))]
  const muscleAssignments = exerciseNames.length > 0
    ? await repo.getExerciseMuscleAssignments(exerciseNames)
    : {}
  const muscleSets: Record<string, number> = {}
  for (const ws of recapWeekSessions) {
    for (const ex of ws.exercises) {
      for (const ma of muscleAssignments[ex.exerciseName] ?? []) {
        const weight = roleWeight(ma.role)
        const muscle = normalizeMuscle(ma.muscle)
        muscleSets[muscle] = (muscleSets[muscle] ?? 0) + ex.sets.length * weight
      }
    }
  }
  const muscleVolumeLine = Object.keys(muscleSets).length > 0
    ? `Sets per muscle that week (weighted): ${Object.entries(muscleSets)
        .sort((a, b) => b[1] - a[1])
        .map(([m, s]) => `${m} ${s.toFixed(1)}`)
        .join(', ')}`
    : null

  const recentWeights = bodyMetrics.filter(m => m.weightKg != null).sort((a, b) => b.date.localeCompare(a.date))
  const weightChange  = recentWeights.length >= 2
    ? `${(recentWeights[0].weightKg! - recentWeights[recentWeights.length - 1].weightKg!).toFixed(1)} kg over 2 weeks`
    : null

  const recapSleep = sleepSessions.filter(s => s.date >= isoWeekKey && s.date <= recapWeekEndIso)
  const durVals = recapSleep.filter(s => s.durationHours != null)
  const avgSleep = durVals.length
    ? (durVals.reduce((s, r) => s + r.durationHours!, 0) / durVals.length).toFixed(1) + 'h avg sleep'
    : null

  // Quality, not just hours: our own 0-100 sleep score per night (efficiency/stages/
  // latency/restfulness — computeSleepScore, the same formula the readiness route uses).
  // Scored once over the whole fetched history so every night is judged against its own prior
  // nights' baselines (computeSleepScoreSeries), then windowed — scoring the window in isolation
  // would strip the HRV/HR/schedule contributors off the earliest nights in it.
  // Nights only — `computeSleepScore` has no minimum-duration guard, so a nap fed straight in
  // scores ~5 and drags the weekly average (the F-1 bug class, in a caller the original fix missed).
  const scoredSleep = computeSleepScoreSeries(nightSessions(sleepSessions, tz), tz)
  const sleepScoreOf = (from: string, to: string) => {
    const vals = scoredSleep
      .filter(r => r.session.date >= from && r.session.date <= to)
      .map(r => r.result?.score)
      .filter((v): v is number => v != null)
    return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
  }
  const scoreRecapWeek = sleepScoreOf(isoWeekKey, recapWeekEndIso)
  const scorePriorWeek = sleepScoreOf(from14dIso, priorWeekEndIso)
  const sleepQualityLine = scoreRecapWeek != null
    ? `Sleep quality: ${scoreRecapWeek}/100 avg nightly sleep score that week${scorePriorWeek != null ? ` (week before ${scorePriorWeek}/100)` : ''}`
    : null

  // HRV: overnight average for the recap week vs the week before (sleep_sessions.averageHrvMs, falling back to body_metrics.hrvMs)
  const hrvOf = (from: string, to: string) => {
    const sleepVals = sleepSessions.filter(s => s.date >= from && s.date <= to && s.averageHrvMs != null).map(s => s.averageHrvMs!)
    const bmVals = bodyMetrics.filter(m => m.date >= from && m.date <= to && m.hrvMs != null).map(m => m.hrvMs!)
    const vals = sleepVals.length > 0 ? sleepVals : bmVals
    return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
  }
  const hrvRecapWeek = hrvOf(isoWeekKey, recapWeekEndIso)
  const hrvPriorWeek = hrvOf(from14dIso, priorWeekEndIso)
  const hrvLine = hrvRecapWeek != null
    ? `Overnight HRV: ${hrvRecapWeek} ms avg that week${hrvPriorWeek != null ? ` (week before ${hrvPriorWeek} ms)` : ''}`
    : null

  // Readiness: the app's own BLE-derived composite (the frozen Cloud column is dead since the
  // 2026-07-07 re-key, so the digest's readiness line silently vanished — F8). Recap-week avg vs
  // the week before.
  const readinessByDay = liveReadinessByDay(derivedRows, ouraRows)
  const readinessOf = (from: string, to: string) => {
    const vals = [...readinessByDay.entries()].filter(([d]) => d >= from && d <= to).map(([, v]) => v)
    return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
  }
  const readyRecapWeek = readinessOf(isoWeekKey, recapWeekEndIso)
  const readyPriorWeek = readinessOf(from14dIso, priorWeekEndIso)
  const readinessLine = readyRecapWeek != null
    ? `Oura readiness: ${readyRecapWeek}/100 avg that week${readyPriorWeek != null ? ` (week before ${readyPriorWeek}/100)` : ''}`
    : null

  // One line: latest flag, with the biomarker z's when ≥ watch (normal stays a bare "normal").
  const latestIllness = latestIllnessFromDerived(derivedRows)
  const illnessZs = latestIllness?.biomarkers && latestIllness.flag !== 'normal'
    ? Object.entries(latestIllness.biomarkers)
        .map(([k, v]) => `${k} z ${v.z > 0 ? '+' : ''}${v.z}`)
        .join(', ')
    : null
  const illnessLine = latestIllness
    ? `Illness radar (vs personal baseline): ${latestIllness.flag}${illnessZs ? ` — ${illnessZs}` : ''}`
    : null

  // Daytime stress (derived, dHRV): avg minutes of high stress per measured day
  const stressOf = (from: string, to: string) => {
    const vals = derivedRows.filter(r => r.day >= from && r.day <= to && r.stressHighMinutes != null).map(r => r.stressHighMinutes!)
    return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
  }
  const stressRecapWeek = stressOf(isoWeekKey, recapWeekEndIso)
  const stressPriorWeek = stressOf(from14dIso, priorWeekEndIso)
  const stressLine = stressRecapWeek != null
    ? `Daytime stress: high for ~${stressRecapWeek} min/day avg that week${stressPriorWeek != null ? ` (week before ~${stressPriorWeek} min/day)` : ''}`
    : null

  // F9: the own stress-resilience level + whole-day training-stress (OTS) — computed and stored,
  // but never previously surfaced in the digest.
  const latestResilience = [...derivedRows].reverse().find(r => r.day <= recapWeekEndIso && r.resilienceLevel != null)
  const resilienceLine = latestResilience?.resilienceLevel != null
    ? `Stress resilience: ${resilienceLevelToBand(latestResilience.resilienceLevel)} (level ${latestResilience.resilienceLevel}/5, as of ${latestResilience.day})`
    : null
  const otsVals = derivedRows.filter(r => r.day >= isoWeekKey && r.day <= recapWeekEndIso && r.trainingLoadOts != null).map(r => r.trainingLoadOts!)
  const otsHigh = derivedRows.some(r => r.day >= isoWeekKey && r.day <= recapWeekEndIso && r.trainingLoadHigh)
  const otsLine = otsVals.length > 0
    ? `Training stress (own OTS model): avg ${(otsVals.reduce((a, b) => a + b, 0) / otsVals.length).toFixed(1)} that week${otsHigh ? ', with high-load day(s)' : ''}`
    : null

  const prLine = weekPrs.length > 0
    ? `PRs that week: ${weekPrs.map(pr => describePersonalRecord(pr.exerciseName, pr.estimated1rm, exerciseTypeByName.get(pr.exerciseName))).join(', ')}`
    : 'PRs that week: none'

  let friendsContext: string | null = null
  try {
    const friendIds = await repo.getFriendIds(userId)
    if (friendIds.length > 0) friendsContext = `Friends training that week: ${friendIds.length} friends connected`
  } catch { /* non-fatal */ }

  const context = [
    `Last week (the completed Mon–Sun week being reviewed): ${recapWeekSessions.length} sessions, ${recapWeekVol} kg volume (${volChange})`,
    `The week before that: ${priorWeekSessions.length} sessions, ${priorWeekVol} kg volume`,
    muscleVolumeLine,
    prLine,
    hrvLine,
    readinessLine,
    illnessLine,
    stressLine,
    resilienceLine,
    otsLine,
    weightChange ? `Body weight change: ${weightChange}` : null,
    avgSleep,
    sleepQualityLine,
    friendsContext,
  ].filter(Boolean).join('\n')

  const contextHash = hashInsightContext(context)

  if (!force) {
    const cached = await readFreshInsight(repo, userId, CACHE_SECTION, isoWeekKey, contextHash)
    if (cached) return NextResponse.json({ digest: cached, weekStart: isoWeekKey, generatedAt: null, cached: true })
  }

  if (!rateLimit(`${userId}:weekly-digest`, 3, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let text: string
  try {
    ;({ text } = await loggedGenerateText(
      { section: 'weekly-digest', userId, fingerprint: { isoWeekKey, contextHash } },
      () => generateText({
        model: aiModel(),
        prompt: `You are a personal training coach. Write a concise recap of the user's last completed training week (Monday to Sunday, the week that just ended). 4–6 bullet points, max 180 words total. Cover training load, any PRs, recovery (HRV/readiness/sleep), and one specific recommendation for the week ahead. Be specific, encouraging, and actionable. Use the data below — quote its numbers, never invent or recompute any.\n\n${PROSE_GUARDS}\n\n${context}`,
        maxRetries: 0,
      }),
    ))
  } catch (err) {
    console.error('[weekly-digest] generateText failed:', err)
    return NextResponse.json({ error: 'AI generation failed' }, { status: 502 })
  }

  const digest = text.trim()
  await repo.upsertAiHealthInsight(userId, CACHE_SECTION, isoWeekKey, digest, contextHash)

  return NextResponse.json({ digest, weekStart: isoWeekKey, generatedAt: new Date().toISOString(), cached: false })
}
