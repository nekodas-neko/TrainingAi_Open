import { shiftDateStr } from '@trainingai/shared/date-utils'

/**
 * The cat collection (BF-122a) — a pure fold over day series the app already stores.
 *
 * **There is no game-state table and that is a design decision, not an omission.** Merges are
 * automatic and the inputs are immutable day series, so the collection is a replay: a back-dated
 * workout landing next week produces the right answer with nothing to migrate or repair.
 *
 * It is only true while two things hold, and both are load-bearing:
 *   1. No merge ever needs a user decision.
 *   2. The thresholds are constants. Because the state is REPLAYED on every read, changing `N` or a
 *      decay window retroactively rewrites history — a Tank earned last month silently un-merges.
 *      If a threshold is ever exposed, it must be versioned with an effective-from date and each
 *      span replayed under the rule that was live then.
 */

/** One rung. The bottom tier is what a faucet day spawns; each higher one costs `mergeCost` below. */
export interface Tier {
  name: string
  /** How many of the PREVIOUS tier merge into one of this one. Ignored on the bottom rung. */
  mergeCost: number
}

export interface Ladder {
  faucet: 'workout' | 'steps' | 'sleep'
  /** Bottom rung first. */
  tiers: Tier[]
}

/** How many of each tier are held, indexed to match `Ladder.tiers`. */
export type Stock = number[]

export interface CollectionState {
  stock: Stock
  /** Days the input listed more than once. A faucet day spawns once however many rows it has. */
  duplicateDays: number
  /** How many decay events fired. Surfaced so a widget can say "you lost one" rather than only
   *  showing a smaller number, which reads as a bug. */
  decayEvents: number
}

/**
 * Merge upward as far as the stock allows.
 *
 * Repeated to a fixed point rather than one pass: five slimes making one tier-2 can complete a
 * tier-3 in the same step, and a single pass would leave the collection one merge behind its own
 * rule until the next spawn happened to trigger it.
 */
function settle(stock: Stock, ladder: Ladder): void {
  let moved = true
  while (moved) {
    moved = false
    for (let i = 0; i < ladder.tiers.length - 1; i++) {
      const cost = ladder.tiers[i + 1].mergeCost
      if (cost > 0 && stock[i] >= cost) {
        const merges = Math.floor(stock[i] / cost)
        stock[i] -= merges * cost
        stock[i + 1] += merges
        moved = true
      }
    }
  }
}

/**
 * Remove one item, smallest first — breaking a bigger one down rather than deleting it.
 *
 * Both halves are the owner's rules and both matter:
 *   · **Smallest first.** Loose stock is the buffer, so a missed day costs the thing you were about
 *     to merge. That is where the pull to log comes from.
 *   · **A big item breaks into its components, never vanishes.** Losing a Tank costs the merge, not
 *     the workouts underneath it. Progress is recoverable; the top of the ladder is not free.
 *
 * Returns false when the collection is already empty, so the caller can stop counting events for a
 * loss that did not happen.
 */
function decayOnce(stock: Stock, ladder: Ladder): boolean {
  const lowest = stock.findIndex(n => n > 0)
  if (lowest === -1) return false
  if (lowest === 0) { stock[0] -= 1; return true }

  // Nothing loose: break the smallest held item down one rung, then take from what that produced.
  stock[lowest] -= 1
  stock[lowest - 1] += ladder.tiers[lowest].mergeCost
  return decayOnce(stock, ladder)
}

export interface ReplayInput {
  /** `YYYY-MM-DD`, any order, duplicates tolerated — one spawn per distinct day. */
  days: string[]
  ladder: Ladder
  /** Rest days allowed between faucet days before decay fires. From `maxCompliantRestGap` for the
   *  workout ladder; a constant for steps and sleep, which have no schedule. */
  maxRestGap: number
  /** Days on which the clock is PAUSED — the app's own recommended rest days and deload days.
   *  Compliance is not neglect, and decaying it turns the mechanic against the user. */
  pausedDays?: string[]
  /** The day the replay runs to, so the gap since the last faucet day counts. `YYYY-MM-DD`. */
  today: string
}

const DAY_MS = 86_400_000
/** Parsed as UTC midnight deliberately: these are calendar-day strings already resolved in the
 *  user's timezone upstream, so re-interpreting them in any zone would shift the day. */
const toDay = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))
const daysBetween = (a: string, b: string) => Math.round((toDay(b) - toDay(a)) / DAY_MS)
// Walking days goes through `shiftDateStr` rather than re-deriving a date string from an epoch.
// The arithmetic here happens to be UTC-anchored and would have been right either way, which is
// exactly why that habit keeps coming back: it is correct until someone reuses it on a local-time
// date. (This comment does not spell the banned expression out — the Custom Rules grep reads prose
// and flagged an earlier draft of this very line.)
const addDays = (d: string, n: number) => shiftDateStr(d, n)

/**
 * Replay the whole series into a collection.
 *
 * Walks distinct days in order: each spawns a bottom-tier item, and each gap wider than the
 * allowance decays once per day beyond it. The trailing gap to `today` counts too — otherwise the
 * collection only decays when you finally come back, which is the wrong moment to tell someone.
 */
export function replayCollection(input: ReplayInput): CollectionState {
  const { ladder, maxRestGap, today } = input
  const paused = new Set(input.pausedDays ?? [])
  const stock: Stock = ladder.tiers.map(() => 0)

  const distinct = [...new Set(input.days)].sort()
  const duplicateDays = input.days.length - distinct.length
  let decayEvents = 0

  /** Rest days strictly between two faucet days, minus the ones the app itself asked for. */
  const chargeableGap = (from: string, to: string): number => {
    const span = daysBetween(from, to)
    if (span <= 1) return 0
    let excused = 0
    for (let k = 1; k < span; k++) {
      const day = addDays(from, k)
      if (paused.has(day)) excused++
    }
    return Math.max(0, span - 1 - excused)
  }

  const applyGap = (from: string, to: string) => {
    const over = chargeableGap(from, to) - maxRestGap
    for (let k = 0; k < over; k++) {
      if (decayOnce(stock, ladder)) decayEvents++
    }
  }

  let previous: string | null = null
  for (const day of distinct) {
    if (previous) applyGap(previous, day)
    stock[0] += 1
    settle(stock, ladder)
    previous = day
  }
  if (previous) applyGap(previous, today)

  return { stock, duplicateDays, decayEvents }
}

/** The three ladders, one per faucet. Constants, per the versioning note at the top of this file. */
export const LADDERS: Record<Ladder['faucet'], Ladder> = {
  workout: { faucet: 'workout', tiers: [
    { name: 'cat slime', mergeCost: 0 },
    { name: 'cat scout', mergeCost: 5 },
    { name: 'cat Tank',  mergeCost: 4 },
  ] },
  steps: { faucet: 'steps', tiers: [
    { name: 'cat slime',  mergeCost: 0 },
    { name: 'cat ranger', mergeCost: 7 },
    { name: 'cat Archer', mergeCost: 4 },
  ] },
  sleep: { faucet: 'sleep', tiers: [
    { name: 'cat slime',   mergeCost: 0 },
    { name: 'cat acolyte', mergeCost: 7 },
    { name: 'cat Cleric',  mergeCost: 4 },
  ] },
}

/**
 * Steps and sleep have no schedule, so their windows are constants.
 *
 * Measured when this was written: steps logged 129 of 129 days and sleep lands nightly, so these
 * two ladders will essentially never decay — they are the calm half of the widget BY CONSTRUCTION.
 * Do not tighten them to manufacture tension; the workout ladder is where the tension is.
 */
export const STEPS_MAX_REST_GAP = 2
export const SLEEP_MAX_REST_GAP = 2
