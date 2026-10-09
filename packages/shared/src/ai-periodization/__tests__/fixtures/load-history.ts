// A synthetic training history for replaying training-load ratios (issue 2194, issue 2340).
//
// Synthetic on purpose: the owner's production history is not loaded locally (PII). It is shaped
// like a real lifter's year so the replay crosses every band: an every-third-day base, a denser
// build block, a deload week, a two-week break, and a return. A seeded generator keeps it identical
// on every run, so the days-moved figure pinned against it is a fact about the code, not the dice.
import { dateStrMidnightInTz, shiftDateStr } from '@trainingai/shared/date-utils'

export const FIXTURE_TZ = 'Australia/Brisbane'
export const FIXTURE_FIRST_DAY = '2026-03-01'
export const FIXTURE_LAST_DAY = '2026-09-30'

export interface FixtureSession { startedAt: Date; volumeKg: number }

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/** Day index → whether it is a training day, by phase. */
function trains(i: number, rand: () => number): boolean {
  if (i < 60) return i % 3 === 0                         // base: every third day
  if (i < 88) return i % 2 === 0 || rand() < 0.2         // build block: every other day, some extras
  if (i < 95) return i % 3 === 0                         // deload week (lighter, below)
  if (i < 110) return i % 3 === 0
  if (i < 124) return false                              // two-week break
  if (i < 150) return i % 4 === 0                        // return, sparse
  return i % 3 === 0 || rand() < 0.15                    // back to base
}

export function fixtureLoadHistory(): FixtureSession[] {
  const rand = lcg(2194)
  const out: FixtureSession[] = []
  for (let i = 0; ; i++) {
    const day = shiftDateStr(FIXTURE_FIRST_DAY, i)
    if (day > FIXTURE_LAST_DAY) break
    if (!trains(i, rand)) continue
    const base = i >= 88 && i < 95 ? 3500 : 6000
    const volumeKg = Math.round(base * (0.7 + rand() * 0.7))
    // Morning or evening, local. Midday-anchored fixtures stay clear of the midnight boundary.
    const hour = rand() < 0.5 ? 7 : 18
    out.push({ startedAt: new Date(dateStrMidnightInTz(day, FIXTURE_TZ).getTime() + hour * 3_600_000), volumeKg })
  }
  return out
}

/** Every day of the fixture, oldest first. */
export function fixtureDays(): string[] {
  const days: string[] = []
  for (let i = 0; ; i++) {
    const d = shiftDateStr(FIXTURE_FIRST_DAY, i)
    if (d > FIXTURE_LAST_DAY) return days
    days.push(d)
  }
}
