import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { mround, displayOneRm, isBodyweightType, repMaxFromOneRm } from '@trainingai/shared/1rm'
import type { Program, WorkoutSession } from "@trainingai/shared/types";
import type { SleepSession } from '@trainingai/shared/types'
import type { OuraDailyRow, OuraDailyDerivedRow } from '@/lib/data/repository'
import type { DayCheckin } from '@trainingai/shared/types/day-checkin'
import { illnessAdvisory, type LatestIllness } from '@trainingai/shared/health/illness-radar'
import { liveReadinessByDay } from '@trainingai/shared/health/live-readiness'

export function buildProgramSummary(program: Program | null): string {
  if (!program) return "(no active program)";
  const lines: string[] = [`## Active Program: ${program.name}`];
  for (const sess of program.sessions) {
    const names = sess.exercises.map(e => e.exerciseName);
    lines.push(`${sess.name}: ${names.join(", ") || "(no exercises)"}`);
  }
  return lines.join("\n");
}

// Builds an explicit Mon–today schedule so the AI doesn't have to infer rest days from gaps.
export function buildWeekSchedule(sessions: WorkoutSession[], tz: string, todayIso: string): string {
  const todayMidUTC = fromZonedTime(todayIso + 'T00:00:00', tz);
  // 'i' in date-fns = ISO day of week: 1=Mon … 7=Sun, locale-independent.
  // ('e' is locale-dependent — en-US's default locale starts the week on Sunday,
  // which made daysSinceMon collapse to 0 every Sunday and silently dropped the
  // rest of the week from the AI's context.)
  const daysSinceMon = parseInt(formatInTimeZone(todayMidUTC, tz, 'i')) - 1;

  const lines: string[] = ['## This Week (Mon–today) — a session listed for a day means it was ALREADY COMPLETED that day, including today'];
  for (let i = 0; i <= daysSinceMon; i++) {
    const dayUTC = new Date(todayMidUTC.getTime() - (daysSinceMon - i) * 86_400_000);
    const dayIso = formatInTimeZone(dayUTC, tz, 'yyyy-MM-dd');
    const dayLabel = formatInTimeZone(dayUTC, tz, 'yyyy/MM/dd EEE');
    const isToday = i === daysSinceMon;
    const daySessions = sessions.filter(ws => formatInTimeZone(ws.startedAt, tz, 'yyyy-MM-dd') === dayIso);
    const suffix = isToday ? ' (today)' : '';
    lines.push(daySessions.length
      ? `${dayLabel}${suffix}: ${daySessions.map(s => s.sessionName).join(' + ')} — COMPLETED`
      : `${dayLabel}${suffix}: rest (nothing logged)`
    );
  }
  return lines.join('\n');
}

// Precomputed per-exercise est-1RM + target working weight. The model quotes
// these; it must never run Epley/Brzycki itself (it gets them wrong).
//
// Bodyweight exercises are emitted as a REP MAX, never kilograms: their stored estimate is
// BW_REF-relative and is not a weight anyone lifted (finding Q-19). Because the system prompt tells
// the model to quote these verbatim, a kg figure here reaches the user as a claim that their
// Pull-Up 1RM is 118 kg — the exact misreading Q-12 removed from the UI.
export function build1RmTargets(
  sessions: WorkoutSession[],
  exerciseTypeByName?: Map<string, string>,
): string {
  const latest = new Map<string, { orm: number; date: Date }>()
  for (const ws of sessions) {
    for (const el of ws.exercises) {
      if (el.estimated1rm == null || el.estimated1rm <= 0) continue
      const cur = latest.get(el.exerciseName)
      if (!cur || ws.startedAt > cur.date) latest.set(el.exerciseName, { orm: el.estimated1rm, date: ws.startedAt })
    }
  }
  if (latest.size === 0) return '## Estimated 1RMs\n(no 1RM estimates yet)'
  const lines = ['## Estimated 1RMs & target working weights (precomputed — quote, never recompute)']
  for (const [name, { orm }] of [...latest.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (isBodyweightType(exerciseTypeByName?.get(name))) {
      lines.push(
        `${name}: ${displayOneRm(orm, 'bodyweight').text} (bodyweight — measured in reps, NOT kilograms; ` +
        `target working set ${repMaxFromOneRm(orm * 0.8)} reps)`,
      )
    } else {
      lines.push(`${name}: est 1RM ${mround(orm, 0.25)}kg → target working weight ${mround(orm * 0.8, 0.25)}kg`)
    }
  }
  return lines.join('\n')
}

function checkinLine(label: string, c: DayCheckin | null): string | null {
  if (!c) return null
  const parts: string[] = []
  if (c.physicalTiredness != null) parts.push(`physical tiredness ${c.physicalTiredness}/5`)
  if (c.mentalDrain != null) parts.push(`mental drain ${c.mentalDrain}/5`)
  if (c.barelyMoved != null) parts.push(`movement ${c.barelyMoved}/5 (5 = sat all day)`)
  if (c.hydration != null) parts.push(`hydration ${c.hydration}/5 (5 = barely drank)`)
  if (c.lateHeavyMeal != null) parts.push(`late/heavy meal ${c.lateHeavyMeal}/5`)
  if (c.soreMuscles.length > 0) parts.push(`sore: ${c.soreMuscles.join(', ')}`)
  return parts.length > 0 ? `${label}: ${parts.join(', ')}` : null
}

// Mirrors morning-briefing's Oura context format (labels + units).
export function buildRecoverySummary(
  ouraRows: OuraDailyRow[],
  sleepSessions: SleepSession[],
  morningCheckin: DayCheckin | null,
  eveningCheckin: DayCheckin | null,
  todayIso: string,
  illness: LatestIllness | null,
  /** Last rolled-up night's BLE temperature deviation (°C, oura_daily_summary.temp_dev_c). */
  bleTempDevC: number | null = null,
  /** oura_daily_derived rows — the live BLE composite readiness (F8), not the frozen Cloud column. */
  derived: OuraDailyDerivedRow[] = [],
): string {
  const lines: string[] = ['## Recovery & Wellness']

  // Readiness is the own BLE-derived composite; the frozen Cloud readinessScore is never narrated.
  const readinessMap = liveReadinessByDay(derived, ouraRows)
  const ouraToday = ouraRows.find(r => r.date === todayIso) ?? null
  const todayReadiness = readinessMap.get(todayIso) ?? null
  // BLE-first temp deviation, appended even when today has no Oura row. The frozen Cloud value
  // survives only as an explicitly-annotated fallback (dead since the 2026-07-07 re-key).
  const tempLine = bleTempDevC != null && Math.abs(bleTempDevC) > 0.3
    ? `body temp deviation ${bleTempDevC > 0 ? '+' : ''}${bleTempDevC.toFixed(1)}°C (vs ring baseline)`
    : ouraToday?.temperatureDeviation != null && Math.abs(ouraToday.temperatureDeviation) > 0.3
      ? `body temp deviation ${ouraToday.temperatureDeviation > 0 ? '+' : ''}${ouraToday.temperatureDeviation.toFixed(1)}°C (pre-re-key Cloud value — not current)`
      : null
  const ouraParts: string[] = ([
    todayReadiness != null ? `readiness ${todayReadiness}/100` : null,
    ouraToday?.sleepScore != null ? `sleep score ${ouraToday.sleepScore}/100` : null,
    ouraToday?.activityScore != null ? `activity score ${ouraToday.activityScore}/100` : null,
  ]).filter((x): x is string => x != null)
  if (tempLine) ouraParts.push(tempLine)
  lines.push(ouraParts.length > 0 ? `Today: ${ouraParts.join(', ')}` : 'Today: no Oura data')

  const sorted = [...sleepSessions].sort((a, b) => b.date.localeCompare(a.date))
  const lastSleep = sorted[0] ?? null
  if (lastSleep) {
    const sleepParts = [
      lastSleep.durationHours != null ? `${lastSleep.durationHours.toFixed(1)}h sleep` : null,
      lastSleep.efficiency != null ? `efficiency ${lastSleep.efficiency}%` : null,
      lastSleep.averageHrvMs != null ? `overnight HRV ${Math.round(lastSleep.averageHrvMs)} ms` : null,
      lastSleep.lowestHeartRate != null ? `lowest HR ${lastSleep.lowestHeartRate} bpm` : null,
    ].filter(Boolean)
    if (sleepParts.length > 0) lines.push(`Last night: ${sleepParts.join(', ')}`)
  }

  if (illness) {
    const advisory = illnessAdvisory(illness.flag)
    // illnessAdvisory is non-null exactly when flag ≥ watch — normal nights stay silent.
    if (advisory) lines.push(`Illness radar (${illness.day}): ${illness.flag}, score ${illness.score}/100 — ${advisory}`)
  }

  const weekReadiness = [...readinessMap.values()]
  if (weekReadiness.length >= 3) {
    const avg = Math.round(weekReadiness.reduce((s, v) => s + v, 0) / weekReadiness.length)
    lines.push(`7-day readiness avg: ${avg}/100`)
  }
  const hrvWeek = sleepSessions.filter(s => s.averageHrvMs != null)
  if (hrvWeek.length >= 3) {
    const avg = Math.round(hrvWeek.reduce((s, r) => s + r.averageHrvMs!, 0) / hrvWeek.length)
    lines.push(`7-day overnight HRV avg: ${avg} ms`)
  }

  const morning = checkinLine('Morning check-in (today)', morningCheckin)
  const evening = checkinLine('Evening check-in (yesterday)', eveningCheckin)
  if (morning) lines.push(morning)
  if (evening) lines.push(evening)
  if (!morning && !evening) lines.push('No check-ins logged.')

  return lines.join('\n')
}
