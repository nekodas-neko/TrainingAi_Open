import { shiftDateStr } from '@trainingai/shared/date-utils'
import { spawnName, blendName, nameHash } from './names'

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

/** One held cat, as the client sees it. Top level only: `from` names its parts rather than nesting them. */
export interface CatSummary {
  /** Stable across replays of the same history, so a client can key on it. */
  id: string
  tier: number
  name: string
  /** The day it spawned, or the day its merge completed. */
  born: string
  /** The names of the cats it was merged from; empty for a spawned one. */
  from: string[]
}

export interface CollectionState {
  stock: Stock
  /** Days the input listed more than once. A faucet day spawns once however many rows it has. */
  duplicateDays: number
  /** How many decay events fired. Surfaced so a widget can say "you lost one" rather than only
   *  showing a smaller number, which reads as a bug. */
  decayEvents: number
  /** Every held cat, biggest tier first. `stock[i]` always equals the number of tier-`i` cats here. */
  cats?: CatSummary[]
  /** True when skipping today would cost a cat: tomorrow is past the rest allowance. */
  restless?: boolean
  /** The most recent cat lost to decay, so a widget can name it rather than show a smaller number. */
  lastLost?: { name: string; day: string } | null
}

/**
 * A cat inside the fold. The replay holds real cats rather than counts so each one keeps a stable
 * identity and name, and so a breakdown gives back the SAME cats that were merged, names and all.
 * Counts are derived from these lists, so there is still exactly one rule set, not two.
 */
interface Cat { id: string; tier: number; name: string; born: string; parts: Cat[] }
type Held = Cat[][]

const byBorn = (a: Cat, b: Cat) => (a.born === b.born ? (a.id < b.id ? -1 : 1) : a.born < b.born ? -1 : 1)

/**
 * Merge upward as far as the stock allows, oldest cats first.
 *
 * Repeated to a fixed point rather than one pass: five slimes making one tier-2 can complete a
 * tier-3 in the same step, and a single pass would leave the collection one merge behind its own
 * rule until the next spawn happened to trigger it.
 */
function settle(held: Held, ladder: Ladder, day: string): void {
  let moved = true
  while (moved) {
    moved = false
    for (let i = 0; i < ladder.tiers.length - 1; i++) {
      const cost = ladder.tiers[i + 1].mergeCost
      while (cost > 0 && held[i].length >= cost) {
        const parts = held[i].splice(0, cost)
        const id = `${ladder.faucet}-t${i + 1}-${nameHash(parts.map(p => p.id).join('.')).toString(36)}`
        held[i + 1].push({ id, tier: i + 1, name: blendName(parts[0].name, parts[parts.length - 1].name), born: day, parts })
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
 * The newest loose cat is the one that leaves; a breakdown hands back the exact cats that were
 * merged, so they return under their own names.
 *
 * Returns the cat lost, or null when the collection is already empty, so the caller can stop
 * counting events for a loss that did not happen.
 */
function decayOnce(held: Held): Cat | null {
  const lowest = held.findIndex(t => t.length > 0)
  if (lowest === -1) return null
  if (lowest === 0) return held[0].pop()!

  // Nothing loose: break the smallest held item down one rung, then take from what that produced.
  const broken = held[lowest].pop()!
  held[lowest - 1].push(...broken.parts)
  held[lowest - 1].sort(byBorn)
  return decayOnce(held)
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
  const held: Held = ladder.tiers.map(() => [])
  let lastLost: CollectionState['lastLost'] = null

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

  /** The n-th day after `from` that the clock was running (not paused). */
  const nthChargeableDay = (from: string, n: number): string => {
    let day = from
    for (let seen = 0; seen < n;) { day = addDays(day, 1); if (!paused.has(day)) seen++ }
    return day
  }

  const applyGap = (from: string, to: string) => {
    const over = chargeableGap(from, to) - maxRestGap
    for (let k = 0; k < over; k++) {
      // The k-th decay of a gap lands on the k-th day past the allowance, which is the day to name.
      const lost = decayOnce(held)
      if (lost) { decayEvents++; lastLost = { name: lost.name, day: nthChargeableDay(from, maxRestGap + k + 1) } }
    }
  }

  let previous: string | null = null
  for (const day of distinct) {
    if (previous) applyGap(previous, day)
    const id = `${ladder.faucet}-${day}`
    held[0].push({ id, tier: 0, name: spawnName(id), born: day, parts: [] })
    settle(held, ladder, day)
    previous = day
  }
  if (previous) applyGap(previous, today)

  const stock: Stock = held.map(t => t.length)
  const total = stock.reduce((a, b) => a + b, 0)
  // Skipping today means tomorrow's gap counts today; if that is past the allowance, a cat leaves.
  const restless = previous != null && total > 0 && chargeableGap(previous, addDays(today, 1)) > maxRestGap
  const cats: CatSummary[] = [...held].reverse().flat().map(c => ({
    id: c.id, tier: c.tier, name: c.name, born: c.born, from: c.parts.map(p => p.name),
  }))

  return { stock, duplicateDays, decayEvents, cats, restless, lastLost }
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

/*
 * What counts as a steps or sleep faucet day: **that one was recorded at all.**
 *
 * There is no threshold and adding one would break the design the two constants above were
 * calibrated against — the comment there chose them because *"steps logged 129 of 129 days and
 * sleep lands nightly"*, which is a statement about days with data, not days above a bar.
 *
 * Measured on the owner's production rows before wiring the route (LB-60, 2026-09-07): **130 days
 * carry steps and only 35 of them reach 8,000** — an average of 5,646. An 8k faucet with a 2-day
 * allowance would decay the steps ladder most weeks, which is exactly the tension this file's own
 * comment says not to manufacture. Sleep is less extreme and points the same way: 107 nights
 * recorded, 79 at six hours or more.
 *
 * A per-user goal is worse still, not better: the goal is editable, so replaying against it
 * un-spawns past days the moment someone raises their target — the retroactive rewrite the
 * versioning note at the top of this file exists to prevent, arriving without anyone editing a
 * constant.
 */

/**
 * Bumped whenever any threshold in this file changes.
 *
 * Returned with the state so a client can tell a cached collection from a live one: the state is
 * replayed on every read, so a response cached before a change and one computed after it straddle
 * that change silently — the cache half of the versioning note above.
 */
export const COLLECTION_RULES_VERSION = 1
