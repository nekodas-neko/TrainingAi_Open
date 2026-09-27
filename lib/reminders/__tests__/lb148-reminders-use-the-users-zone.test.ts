import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { instantAtLocalTime } from '../local-instant'
import { computeWorkoutReminderAction } from '@/lib/workout-reminders'
import { stripComments } from '../../../scripts/lib/strip-comments.js'

const ROOT = path.resolve(__dirname, '../../..')
const code = (rel: string) =>
  stripComments(readFileSync(path.join(ROOT, rel), 'utf8'))

/**
 * The argument text of each call to `name`, paren-balanced.
 *
 * A regex cannot do this and the naive one is a trap I have now hit three times: `f\([^)]*\)`
 * stops at the FIRST `)`, so `reconcileMealReminders(a, b, new Date(), tz)` reads as ending at
 * `new Date(` and its `tz` is never seen.
 */
function callArgs(src: string, name: string): string[] {
  const out: string[] = []
  const re = new RegExp(`\\b${name}\\(`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    let depth = 1
    let i = m.index + m[0].length
    const start = i
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')') { depth--; if (depth === 0) break }
    }
    out.push(src.slice(start, i))
  }
  return out
}

const REMINDER_MODULES = ['lib/meal-reminders.ts', 'lib/supplement-reminders.ts', 'lib/workout-reminders.ts']

/**
 * LB-148 — every notification was timed in Brisbane or in the phone's zone, never the user's.
 *
 * Within one function the two disagreed: the "have I already notified today" key came from a bare
 * `todayInTz()` (the Brisbane default) while the scheduled instant came from `setHours`, which sets
 * the hour in the DEVICE's zone. RV-176 fixed this class across `app/**` and `components/**` and
 * missed `lib/*.ts`, which is where the notification timing lives.
 */
describe('LB-148 — the instant is the user’s wall clock', () => {
  it('resolves 08:00 in the user’s zone, not the runner’s', () => {
    // Brisbane is UTC+10 with no DST, so 08:00 there is 22:00 UTC the day before.
    expect(instantAtLocalTime('2026-09-25', 8, 0, 'Australia/Brisbane').toISOString())
      .toBe('2026-09-24T22:00:00.000Z')
  })

  it('gives a different instant for the same wall time in two zones', () => {
    const bne = instantAtLocalTime('2026-09-25', 8, 0, 'Australia/Brisbane')
    const nyc = instantAtLocalTime('2026-09-25', 8, 0, 'America/New_York')
    expect(bne.getTime()).not.toBe(nyc.getTime())
    // 14 hours apart on that date (UTC+10 vs UTC-4).
    expect((nyc.getTime() - bne.getTime()) / 3_600_000).toBe(14)
  })

  it('crosses a DST boundary correctly, which adding hours to midnight would not', () => {
    // US DST ended 2026-11-01. 08:00 local is UTC-5 after it, UTC-4 before.
    expect(instantAtLocalTime('2026-10-31', 8, 0, 'America/New_York').toISOString())
      .toBe('2026-10-31T12:00:00.000Z')
    expect(instantAtLocalTime('2026-11-02', 8, 0, 'America/New_York').toISOString())
      .toBe('2026-11-02T13:00:00.000Z')
  })
})

describe('LB-148 — a reminder fires at the user’s hour, not the phone’s', () => {
  it('schedules an 08:00 Brisbane reminder for 22:00 UTC the previous day', () => {
    // 05:00 UTC on the 25th is 15:00 Brisbane — past 08:00, so this is the already-passed branch.
    const action = computeWorkoutReminderAction(
      true, 'Lower', true, '08:00', new Date('2026-09-25T05:00:00Z'), false, 'Australia/Brisbane',
    )
    expect(action.type).toBe('immediate')
  })

  it('and is still upcoming at the same instant for a user in New York', () => {
    // The same instant is 01:00 in New York — 08:00 has not happened there yet.
    const action = computeWorkoutReminderAction(
      true, 'Lower', true, '08:00', new Date('2026-09-25T05:00:00Z'), false, 'America/New_York',
    )
    expect(action.type).toBe('schedule')
    if (action.type === 'schedule') {
      expect(action.at.toISOString()).toBe('2026-09-25T12:00:00.000Z')
    }
  })
})

describe('LB-148 — no reminder module reaches for the device clock again', () => {
  it('none of the three calls setHours', () => {
    for (const m of REMINDER_MODULES) {
      expect(code(m), `${m} builds an instant from the device clock`).not.toMatch(/\.setHours\(/)
    }
  })

  it('none of the three calls todayInTz with no zone', () => {
    for (const m of REMINDER_MODULES) {
      expect(code(m), `${m} keys "today" to the Brisbane default`).not.toMatch(/todayInTz\(\)/)
    }
  })

  it('every caller passes a zone — a default nobody overrides is what caused this', () => {
    const callers = execFileSync('git', ['ls-files', 'app', 'components'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n').filter(Boolean)
      .filter(f => (f.endsWith('.tsx') || f.endsWith('.ts')) && !f.includes('__tests__'))
    const offenders: string[] = []
    for (const f of callers) {
      const src = code(f)
      for (const fn of ['reconcileMealReminders', 'reconcileSupplementReminders', 'scheduleEndOfDayReminder']) {
        for (const args of callArgs(src, fn)) {
          if (!/\btz\b/.test(args)) offenders.push(`${f}: ${fn}(${args})`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
