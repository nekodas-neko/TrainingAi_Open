/**
 * TN-46 — put a recent medication dose beside a flagged day, so "resting HR and HRV are off your
 * baseline" reads with its likely cause instead of implying an infection.
 *
 * **Annotate, never correct.** The owner delegated the design and the decision is recorded on the
 * entry: the live baseline keeps adapting and no score is adjusted for the dose. This only adds the
 * context a reader needs. The pre-dose reference is already stored per night on
 * `oura_daily_summary`, so nothing here needs a snapshot.
 *
 * **The dose is `supplement_logs.amount` + `unit`, never `supplements.dose`.** The latter describes
 * the VIAL (10 mg), not the administration (0.5–1 mg), a 20× overstatement this entry's own first
 * draft made.
 */

export interface DoseEvent {
  supplementName: string
  /** The local day it was taken, YYYY-MM-DD. */
  date: string
  amount: number
  unit: string | null
}

export interface RecentDose extends DoseEvent {
  daysAgo: number
}

/**
 * How far back a dose still plausibly explains a vitals shift. The measured response peaked 2–4
 * days after a dose and had largely washed out by day 5. A same-day window would find nothing on
 * data that plainly shows an effect.
 */
export const DOSE_EFFECT_LOOKBACK_DAYS = 5

const dayNumber = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000

/** Doses taken on `date` or up to `lookbackDays` before it, newest first. */
export function recentDoses(doses: DoseEvent[], date: string, lookbackDays = DOSE_EFFECT_LOOKBACK_DAYS): RecentDose[] {
  const today = dayNumber(date)
  return doses
    .map(d => ({ ...d, daysAgo: today - dayNumber(d.date) }))
    .filter(d => d.daysAgo >= 0 && d.daysAgo <= lookbackDays)
    .sort((a, b) => a.daysAgo - b.daysAgo)
}

const ago = (n: number) => (n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`)
const amountText = (d: DoseEvent) => `${Number(d.amount.toFixed(3))}${d.unit ? ` ${d.unit}` : ''}`

/** "Retatrutide 1 mg, 3 days ago", naming each supplement's most recent dose, at most two. */
export function doseContextPhrase(recent: RecentDose[]): string | null {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const d of recent) {
    if (seen.has(d.supplementName)) continue
    seen.add(d.supplementName)
    parts.push(`${d.supplementName} ${amountText(d)}, ${ago(d.daysAgo)}`)
    if (parts.length === 2) break
  }
  return parts.length ? parts.join('; ') : null
}

/** The advisory with the recent dose beside it. Unchanged when there is no advisory or no dose. */
export function withDoseContext(advisory: string | null, recent: RecentDose[]): string | null {
  if (!advisory) return advisory
  const phrase = doseContextPhrase(recent)
  if (!phrase) return advisory
  return `${advisory} Recent dose: ${phrase}. Some medications move resting HR and HRV for several days, so this may be the dose rather than illness.`
}
