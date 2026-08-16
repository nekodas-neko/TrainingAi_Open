import type { SleepSession } from '@trainingai/shared/types/body'

// Pick the *primary* night sleep from a day's rows: restrict to rows ≥3h so a short nap
// can't be chosen, then prefer the Oura row (actual sleep onset) over Samsung (in-bed time).
export const MIN_MAIN_SLEEP_H = 3

export function pickPrimarySleep(rows: SleepSession[]): SleepSession | null {
  const mainSleeps = rows.filter(r => (r.durationHours ?? 0) >= MIN_MAIN_SLEEP_H)
  const pool = mainSleeps.length > 0 ? mainSleeps : rows
  const longest = [...pool].sort((a, b) => (b.durationHours ?? 0) - (a.durationHours ?? 0))[0] ?? null
  return pool.find(r => r.ouraId) ?? longest
}
