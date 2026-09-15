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
import {
  buildWeeklyDigestContext,
  weekDays,
  type DailyPoint,
  type WeeklyDigestMetrics,
} from '@trainingai/shared/health/weekly-digest-metrics'

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
  const volumeChangePct = priorWeekVol > 0
    ? Math.round((recapWeekVol - priorWeekVol) / priorWeekVol * 100)
    : null

  const recapDays = weekDays(isoWeekKey)
  const meanOrNull = (vals: number[]) => vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  const seriesFrom = (pairs: [string, number][]): DailyPoint[] =>
    recapDays.map(date => ({ date, value: meanOrNull(pairs.filter(([d]) => d === date).map(([, v]) => v)) }))
  const rounded = (s: DailyPoint[]): DailyPoint[] =>
    s.map(p => ({ date: p.date, value: p.value == null ? null : Math.round(p.value) }))

  // Bucketed by the user's LOCAL day: a session started 08:00 Brisbane is 22:00 UTC the day
  // before, so a UTC bucket draws it on the wrong bar and, at a week edge, outside the week.
  const trainingByDay = recapDays.map(date => {
    const onDay = recapWeekSessions.filter(ws => formatInTimeZone(ws.startedAt, tz, 'yyyy-MM-dd') === date)
    return { date, volumeKg: Math.round(sumVol(onDay)), sessions: onDay.length }
  })

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
  const muscleSetsSorted = Object.entries(muscleSets)
    .sort((a, b) => b[1] - a[1])
    .map(([muscle, sets]) => ({ muscle, sets }))

  const recentWeights = bodyMetrics.filter(m => m.weightKg != null).sort((a, b) => b.date.localeCompare(a.date))
  const weightChangeKg = recentWeights.length >= 2
    ? recentWeights[0].weightKg! - recentWeights[recentWeights.length - 1].weightKg!
    : null

  // Hours from every sleep session including naps — deliberately NOT nightSessions, which is what
  // the score below uses. That asymmetry predates this and is left alone here.
  const sleepHoursOf = (from: string, to: string) =>
    meanOrNull(sleepSessions.filter(s => s.date >= from && s.date <= to && s.durationHours != null).map(s => s.durationHours!))

  // Quality, not just hours: our own 0-100 sleep score per night (efficiency/stages/
  // latency/restfulness — computeSleepScore, the same formula the readiness route uses).
  // Scored once over the whole fetched history so every night is judged against its own prior
  // nights' baselines (computeSleepScoreSeries), then windowed — scoring the window in isolation
  // would strip the HRV/HR/schedule contributors off the earliest nights in it.
  // Nights only — `computeSleepScore` has no minimum-duration guard, so a nap fed straight in
  // scores ~5 and drags the weekly average (the F-1 bug class, in a caller the original fix missed).
  const scoredSleep = computeSleepScoreSeries(nightSessions(sleepSessions, tz), tz)
  const scoredPairs = scoredSleep
    .map(r => [r.session.date, r.result?.score] as [string, number | undefined])
    .filter((p): p is [string, number] => p[1] != null)
  const sleepScoreOf = (from: string, to: string) =>
    meanOrNull(scoredPairs.filter(([d]) => d >= from && d <= to).map(([, v]) => v))

  // HRV: overnight average (sleep_sessions.averageHrvMs), falling back to body_metrics.hrvMs. The
  // fallback is chosen for the WHOLE window, never per day — a series mixing the two would draw
  // points from two instruments on one line with nothing marking where it changed.
  const hrvOf = (from: string, to: string) => {
    const sleepVals = sleepSessions.filter(s => s.date >= from && s.date <= to && s.averageHrvMs != null).map(s => s.averageHrvMs!)
    const bmVals = bodyMetrics.filter(m => m.date >= from && m.date <= to && m.hrvMs != null).map(m => m.hrvMs!)
    return meanOrNull(sleepVals.length > 0 ? sleepVals : bmVals)
  }
  const hrvSleepRecap = sleepSessions.filter(s => s.date >= isoWeekKey && s.date <= recapWeekEndIso && s.averageHrvMs != null)
  const hrvBmRecap = bodyMetrics.filter(m => m.date >= isoWeekKey && m.date <= recapWeekEndIso && m.hrvMs != null)
  const hrvSource: 'overnight' | 'body-metrics' | null =
    hrvSleepRecap.length > 0 ? 'overnight' : hrvBmRecap.length > 0 ? 'body-metrics' : null
  const hrvPairs: [string, number][] =
    hrvSource === 'overnight'   ? hrvSleepRecap.map(s => [s.date, s.averageHrvMs!]) :
    hrvSource === 'body-metrics' ? hrvBmRecap.map(m => [m.date, m.hrvMs!]) : []

  // Readiness: the app's own BLE-derived composite (the frozen Cloud column is dead since the
  // 2026-07-07 re-key, so the digest's readiness line silently vanished — F8). Recap-week avg vs
  // the week before.
  const readinessByDay = liveReadinessByDay(derivedRows, ouraRows)
  const readinessEntries = [...readinessByDay.entries()]
  const readinessOf = (from: string, to: string) =>
    meanOrNull(readinessEntries.filter(([d]) => d >= from && d <= to).map(([, v]) => v))

  const latestIllness = latestIllnessFromDerived(derivedRows)

  // Daytime stress (derived, dHRV): avg minutes of high stress per measured day
  const stressPairs = derivedRows
    .filter(r => r.stressHighMinutes != null)
    .map(r => [r.day, r.stressHighMinutes!] as [string, number])
  const stressOf = (from: string, to: string) =>
    meanOrNull(stressPairs.filter(([d]) => d >= from && d <= to).map(([, v]) => v))

  // F9: the own stress-resilience level + whole-day training-stress (OTS) — computed and stored,
  // but never previously surfaced in the digest.
  const latestResilience = [...derivedRows].reverse().find(r => r.day <= recapWeekEndIso && r.resilienceLevel != null)
  const otsVals = derivedRows.filter(r => r.day >= isoWeekKey && r.day <= recapWeekEndIso && r.trainingLoadOts != null).map(r => r.trainingLoadOts!)
  const otsHigh = derivedRows.some(r => r.day >= isoWeekKey && r.day <= recapWeekEndIso && r.trainingLoadHigh)

  let friendCount: number | null = null
  try {
    const friendIds = await repo.getFriendIds(userId)
    if (friendIds.length > 0) friendCount = friendIds.length
  } catch { /* non-fatal */ }

  const roundOrNull = (v: number | null) => v == null ? null : Math.round(v)

  const metrics: WeeklyDigestMetrics = {
    weekStart: isoWeekKey,
    weekEnd: recapWeekEndIso,
    priorWeekStart: from14dIso,
    training: {
      sessions: recapWeekSessions.length,
      priorSessions: priorWeekSessions.length,
      volumeKg: recapWeekVol,
      priorVolumeKg: priorWeekVol,
      volumeChangePct,
      byDay: trainingByDay,
    },
    muscleSets: muscleSetsSorted,
    prs: weekPrs.map(pr => ({
      exerciseName: pr.exerciseName,
      estimated1rm: pr.estimated1rm,
      description: describePersonalRecord(pr.exerciseName, pr.estimated1rm, exerciseTypeByName.get(pr.exerciseName)),
    })),
    hrv: {
      week: roundOrNull(hrvOf(isoWeekKey, recapWeekEndIso)),
      priorWeek: roundOrNull(hrvOf(from14dIso, priorWeekEndIso)),
      byDay: rounded(seriesFrom(hrvPairs)),
      source: hrvSource,
    },
    readiness: {
      week: roundOrNull(readinessOf(isoWeekKey, recapWeekEndIso)),
      priorWeek: roundOrNull(readinessOf(from14dIso, priorWeekEndIso)),
      byDay: rounded(seriesFrom(readinessEntries.filter(([d]) => d >= isoWeekKey && d <= recapWeekEndIso))),
    },
    sleepScore: {
      week: roundOrNull(sleepScoreOf(isoWeekKey, recapWeekEndIso)),
      priorWeek: roundOrNull(sleepScoreOf(from14dIso, priorWeekEndIso)),
      byDay: rounded(seriesFrom(scoredPairs.filter(([d]) => d >= isoWeekKey && d <= recapWeekEndIso))),
    },
    sleepHours: {
      week: sleepHoursOf(isoWeekKey, recapWeekEndIso),
      priorWeek: sleepHoursOf(from14dIso, priorWeekEndIso),
      byDay: seriesFrom(sleepSessions
        .filter(s => s.durationHours != null)
        .map(s => [s.date, s.durationHours!] as [string, number])),
    },
    stressHighMinutes: {
      week: roundOrNull(stressOf(isoWeekKey, recapWeekEndIso)),
      priorWeek: roundOrNull(stressOf(from14dIso, priorWeekEndIso)),
      byDay: rounded(seriesFrom(stressPairs.filter(([d]) => d >= isoWeekKey && d <= recapWeekEndIso))),
    },
    illness: latestIllness
      ? { flag: latestIllness.flag, biomarkers: (latestIllness.biomarkers ?? null) as Record<string, { z: number }> | null }
      : null,
    resilience: latestResilience?.resilienceLevel != null
      ? {
          level: latestResilience.resilienceLevel,
          band: resilienceLevelToBand(latestResilience.resilienceLevel),
          asOf: latestResilience.day,
        }
      : null,
    ots: otsVals.length > 0
      ? { avg: otsVals.reduce((a, b) => a + b, 0) / otsVals.length, hasHighLoadDay: otsHigh }
      : null,
    weightChangeKg,
    friendCount,
  }

  const context = buildWeeklyDigestContext(metrics)

  const contextHash = hashInsightContext(context)

  // The metrics ride on the CACHED path too, and that is the point: the banner fetches once per
  // week, so a page that only got them on a cache miss would be blank almost every time. They
  // are already computed above — the cache only ever covered the prose.
  if (!force) {
    const cached = await readFreshInsight(repo, userId, CACHE_SECTION, isoWeekKey, contextHash)
    if (cached) return NextResponse.json({ digest: cached, weekStart: isoWeekKey, generatedAt: null, cached: true, metrics })
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

  return NextResponse.json({ digest, weekStart: isoWeekKey, generatedAt: new Date().toISOString(), cached: false, metrics })
}
