import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ, todayInTz, shiftDateStr, normalizeDateParam } from '@trainingai/shared/date-utils'
import { formatInTimeZone } from 'date-fns-tz'
import { startOfDay, endOfDay } from 'date-fns'
import { fromZonedTime } from 'date-fns-tz'
import {
  MIN_DISTANCE_M, MIN_AVG_SPEED_KMH, MIN_DURATION_SEC, MAX_DURATION_SEC,
} from '@/lib/activity/detection-thresholds'
import type { SleepSession } from '@trainingai/shared/types/body'
import type { OuraDailyRow } from '@/lib/data/repository'
import { pickPrimarySleep } from '@/lib/sleep/primary-sleep'

export type TimelineEventType = 'wakeup' | 'sleep' | 'workout' | 'meal' | 'walk' | 'bedtime' | 'tag'

export interface TimelineEvent {
  type: TimelineEventType
  time: string          // "h:mm a"
  timeMs: number        // for sorting
  title: string
  subtitle?: string
  icon: string
  day: 'today' | 'yesterday'  // which day group the event belongs to
  /** YYYY-MM-DD the event's day-group resolves to (mirrors `day`) — lets a tappable card
   *  navigate to a date-scoped detail screen without re-deriving it from timeMs client-side. */
  date?: string
  // rich card fields
  endTime?: string       // walk "12:21 - 12:27 PM"
  durationMin?: number
  distanceKm?: number
  calories?: number
  sets?: number
  exerciseCount?: number
  exerciseNames?: string[]
  sleepDurationH?: number
  readinessScore?: number
  sleepScore?: number
  latencyMin?: number
  tagSource?: string
}

function fmtTime(d: Date, tz: string): string {
  return formatInTimeZone(d, tz, 'h:mm a')
}

interface WalkLike {
  day: string
  startDatetime: Date
  endDatetime: Date
  distanceM: number | null
  calories: number | null
  activity: string
}

function isQualityWalk(w: WalkLike): boolean {
  const durationSec = (w.endDatetime.getTime() - w.startDatetime.getTime()) / 1000
  if (durationSec < MIN_DURATION_SEC || durationSec > MAX_DURATION_SEC) return false
  if ((w.distanceM ?? 0) < MIN_DISTANCE_M) return false
  const avgSpeedKmh = ((w.distanceM ?? 0) / 1000) / (durationSec / 3600)
  return avgSpeedKmh >= MIN_AVG_SPEED_KMH
}

export async function GET(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tz = session.user.timezone ?? DEFAULT_TZ
  const { searchParams } = new URL(req.url)
  const raw = searchParams.get('date')
  const date = raw ? normalizeDateParam(raw)?.replace(/\//g, '-') ?? null : todayInTz(tz)
  if (!date) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  const yesterday = shiftDateStr(date, -1)

  const dayStart = fromZonedTime(startOfDay(new Date(`${date}T00:00:00`)), tz)
  const dayEnd   = fromZonedTime(endOfDay(new Date(`${date}T23:59:59`)), tz)
  const yDayStart = fromZonedTime(startOfDay(new Date(`${yesterday}T00:00:00`)), tz)
  const yDayEnd   = fromZonedTime(endOfDay(new Date(`${yesterday}T23:59:59`)), tz)

  const repo = await getRepository()

  const [sleepRows, ySleepRows, workoutSessions, foodLogs, mealTypes, ouraWorkouts, ouraDaily, activityLogs, ouraTags, derivedRows] = await Promise.all([
    repo.listSleepSessions(userId, date, date),
    repo.listSleepSessions(userId, yesterday, yesterday),
    repo.getWorkoutSessionsFrom(userId, yDayStart),
    repo.listFoodLogs(userId, date),
    repo.listMealTypes(userId),
    repo.getOuraWorkouts(userId, { from: yesterday, to: date }),
    repo.getOuraDaily(userId, yesterday, date),
    repo.listActivityLogs(userId, yesterday, date),
    repo.listOuraTags(userId, yesterday, date),
    repo.getOuraDailyDerived(userId, yesterday, date),
  ])

  const events: TimelineEvent[] = []
  const ouraByDate = new Map<string, OuraDailyRow>(ouraDaily.map(d => [d.date, d]))
  // Our own persisted readiness, preferred over the Cloud column — the same derived-first order
  // /api/health/trends uses. Without this the wake-up event's readiness was Cloud-only, so it was
  // null for every user who isn't on Oura Cloud (Q-43) and for the owner since the BLE re-key.
  const derivedByDate = new Map(derivedRows.map(r => [r.day, r]))

  // ── Wakeups (today + yesterday) ──────────────────────────────────────────
  // listSleepSessions filters by wake-up date, so any returned row belongs on that day.
  const todaySleep = pickPrimarySleep(sleepRows)
  const yesterdaySleep = pickPrimarySleep(ySleepRows)

  function pushWakeup(sleep: SleepSession | null, dayStr: string) {
    if (!sleep?.sleepEnd) return
    const oura = ouraByDate.get(dayStr) ?? null
    events.push({
      type: 'wakeup',
      time: fmtTime(new Date(sleep.sleepEnd), tz),
      timeMs: new Date(sleep.sleepEnd).getTime(),
      title: 'Woke up',
      icon: 'Sunrise',
      day: 'today',  // recomputed below from timeMs
      date: dayStr,
      sleepDurationH: sleep.durationHours ?? undefined,
      readinessScore: derivedByDate.get(dayStr)?.readinessScore ?? oura?.readinessScore ?? undefined,
      sleepScore: sleep.sleepScore ?? derivedByDate.get(dayStr)?.sleepScore ?? oura?.sleepScore ?? undefined,
    })
  }
  pushWakeup(todaySleep, date)
  pushWakeup(yesterdaySleep, yesterday)

  // ── "Fell asleep" — the onset of today's night (yesterday-evening wall-clock) ────
  // Mirrors the Oura timeline's "Fell asleep · N min latency" entry under the Yesterday
  // header. Anchored on today's primary sleep session's start time + onset latency.
  if (todaySleep?.sleepStart) {
    const latencyMin = todaySleep.onsetLatencySec != null
      ? Math.round(todaySleep.onsetLatencySec / 60)
      : undefined
    events.push({
      type: 'sleep',
      time: fmtTime(new Date(todaySleep.sleepStart), tz),
      timeMs: new Date(todaySleep.sleepStart).getTime(),
      title: 'Fell asleep',
      icon: 'Moon',
      day: 'today',  // recomputed below from timeMs
      date: todaySleep.date,
      subtitle: latencyMin != null ? `${latencyMin} min latency` : undefined,
      latencyMin,
    })
  }

  // ── Workout sessions (today + yesterday) ─────────────────────────────────
  for (const ws of workoutSessions) {
    const t = ws.startedAt.getTime()
    const inToday = t >= dayStart.getTime() && t <= dayEnd.getTime()
    const inYesterday = t >= yDayStart.getTime() && t <= yDayEnd.getTime()
    if (!inToday && !inYesterday) continue
    // Skip phantom sessions — a started-but-abandoned (or post-delete leftover) row
    // with no logged exercises has nothing to show.
    if (ws.exercises.length === 0) continue
    const sets = ws.exercises.reduce((n, ex) => n + ex.sets.length, 0)
    const durationMin = ws.completedAt
      ? Math.round((ws.completedAt.getTime() - t) / 60_000)
      : undefined
    events.push({
      type: 'workout',
      time: fmtTime(ws.startedAt, tz),
      endTime: ws.completedAt ? fmtTime(ws.completedAt, tz) : undefined,
      timeMs: t,
      title: ws.sessionName ?? 'Workout',
      icon: 'Dumbbell',
      day: 'today',  // recomputed below from timeMs
      sets,
      exerciseCount: ws.exercises.length,
      durationMin,
      exerciseNames: ws.exercises.map(ex => ex.exerciseName),
    })
  }

  // ── Meals (today only) ───────────────────────────────────────────────────
  const mealTypeMap = new Map(mealTypes.map(mt => [mt.id, mt]))
  const byMeal = new Map<string, typeof foodLogs>()
  for (const log of foodLogs) {
    if (!byMeal.has(log.mealTypeId)) byMeal.set(log.mealTypeId, [])
    byMeal.get(log.mealTypeId)!.push(log)
  }
  for (const [mealTypeId, logs] of byMeal) {
    const mt = mealTypeMap.get(mealTypeId)
    const startHour = mt?.timeStartHour ?? 0
    const endHour   = mt?.timeEndHour   ?? 24
    const pad = (n: number) => String(n).padStart(2, '0')
    const windowStart = fromZonedTime(new Date(`${date}T${pad(startHour)}:00:00`), tz)
    const endIsMidnight = endHour >= 24
    const windowEnd = fromZonedTime(
      new Date(`${date}T${pad(endIsMidnight ? 23 : endHour)}:${endIsMidnight ? '59' : '00'}:00`),
      tz,
    )
    // Position the meal at the *actual* logged time when at least one item was logged
    // inside its window (use the latest such item); otherwise fall back to the window
    // END (latest) rather than the window start, so a meal logged outside its window
    // still sorts late instead of jumping to the window's earliest minute.
    const inWindow = logs
      .map(l => new Date(l.loggedAt).getTime())
      .filter(t => Number.isFinite(t) && t >= windowStart.getTime() && t <= windowEnd.getTime())
    const eventMs = inWindow.length > 0 ? Math.max(...inWindow) : windowEnd.getTime()
    const totalCal = Math.round(logs.reduce((s, l) => s + l.calories, 0))
    const windowLabel = `${fmtTime(windowStart, tz)} – ${fmtTime(windowEnd, tz)}`
    events.push({
      type: 'meal',
      time: fmtTime(new Date(eventMs), tz),
      timeMs: eventMs,
      title: mt ? `${mt.emoji} ${mt.name}` : 'Meal',
      subtitle: totalCal ? `${totalCal} kcal · ${windowLabel}` : windowLabel,
      icon: 'Utensils',
      day: 'today',  // recomputed below from timeMs
    })
  }

  // ── Saved activity logs (walks/runs the user has actually recorded) ──────
  // These are the user's confirmed activities (distinct from raw Oura detections).
  // Track their time windows so we can dedup an Oura walk that backs the same activity.
  const activityWindows: Array<[number, number]> = []
  for (const log of activityLogs) {
    // start_time / end_time come back as "HH:MM:SS" (or "HH:MM") — normalise to HH:MM.
    const hhmm = (log.startTime ?? '12:00').slice(0, 5)
    const start = fromZonedTime(new Date(`${log.date}T${hhmm}:00`), tz)
    const startMs = start.getTime()
    if (!Number.isFinite(startMs)) continue
    let endMs: number | undefined
    if (log.endTime) {
      const e = fromZonedTime(new Date(`${log.date}T${log.endTime.slice(0, 5)}:00`), tz).getTime()
      if (Number.isFinite(e)) endMs = e
    } else if (log.durationMin != null) {
      endMs = startMs + log.durationMin * 60_000
    }
    activityWindows.push([startMs, endMs ?? startMs])

    // A guided interval walk is the only writer of `segments` (lib/walk/segment-stats.ts) — check
    // it before the generic run/walk keyword collapse below, which would otherwise flatten a
    // Guided Walk to the same bare "Walk" label as a manual or auto-detected one.
    const kindStr = `${log.title} ${log.activityType}`.toLowerCase()
    const title = log.segments != null
      ? 'Guided Walk'
      : kindStr.includes('run') ? 'Run' : kindStr.includes('walk') ? 'Walk' : log.title
    events.push({
      type: 'walk',
      time: fmtTime(start, tz),
      endTime: endMs != null ? fmtTime(new Date(endMs), tz) : undefined,
      timeMs: startMs,
      title,
      icon: 'Footprints',
      day: 'today',  // recomputed below from timeMs
      durationMin: log.durationMin != null ? Math.round(log.durationMin) : undefined,
      distanceKm: log.distanceKm != null ? parseFloat(Number(log.distanceKm).toFixed(2)) : undefined,
      calories: log.caloriesBurned != null ? Math.round(log.caloriesBurned) : undefined,
    })
  }

  // ── Oura walks/runs (today + yesterday) — skip any that overlap a saved log ──
  const walks = ouraWorkouts.filter(w =>
    (w.day === date || w.day === yesterday) && isQualityWalk(w) &&
    !activityWindows.some(([s, e]) => w.startDatetime.getTime() < e && w.endDatetime.getTime() > s),
  )
  for (const w of walks) {
    const t = w.startDatetime.getTime()
    const durationSec = (w.endDatetime.getTime() - t) / 1000
    events.push({
      type: 'walk',
      time: fmtTime(w.startDatetime, tz),
      endTime: fmtTime(w.endDatetime, tz),
      timeMs: t,
      title: w.activity === 'running' ? 'Run' : 'Walk',
      icon: 'Footprints',
      day: 'today',  // recomputed below from timeMs
      durationMin: Math.round(durationSec / 60),
      distanceKm: w.distanceM ? parseFloat((w.distanceM / 1000).toFixed(2)) : undefined,
      calories: w.calories ? Math.round(w.calories) : undefined,
    })
  }

  // ── Oura tags / sessions / rest-mode ─────────────────────────────────────
  const TAG_LABEL: Record<string, string> = { rest_mode: 'Rest mode', nap: 'Nap', meditation: 'Meditation', breathing: 'Breathing' }
  for (const t of ouraTags) {
    const startMs = t.startTime?.getTime()
    if (startMs == null || !Number.isFinite(startMs)) continue
    const label = t.customName
      ?? TAG_LABEL[t.tagType ?? '']
      ?? (t.tagType ? t.tagType.replace(/^tag_(generic_)?/, '').replace(/_/g, ' ') : 'Tag')
    events.push({
      type: 'tag',
      time: fmtTime(new Date(startMs), tz),
      endTime: t.endTime ? fmtTime(t.endTime, tz) : undefined,
      timeMs: startMs,
      title: label.charAt(0).toUpperCase() + label.slice(1),
      subtitle: t.comment ?? (t.mood ? `mood: ${t.mood}` : undefined),
      icon: 'Tag',
      day: 'today',  // recomputed below from timeMs
      tagSource: t.source,
    })
  }

  // Assign the day group from each event's timestamp (handles a "fell asleep" after
  // midnight correctly) and sort newest-first.
  const dayStartMs = dayStart.getTime()
  for (const e of events) {
    e.day = e.timeMs >= dayStartMs ? 'today' : 'yesterday'
    e.date = e.day === 'today' ? date : yesterday
  }
  events.sort((a, b) => b.timeMs - a.timeMs)

  return NextResponse.json({ date, events }, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
