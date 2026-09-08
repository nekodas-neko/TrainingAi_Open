import type { CollectionState, Ladder } from '@trainingai/shared/collection/ladder'

/**
 * BF-122b — what the home widget says, decided in one place because the card has room for one line.
 *
 * Three ladders do not fit under the nutrition donut, so the card shows **the one nearest its next
 * merge** and rotates itself as that changes. Nothing here fetches or renders; the widget and the
 * collection screen both read these, and the tests can run them (this project's vitest is
 * `environment: 'node'`, so a `.tsx` cannot be imported).
 */

export type FaucetKey = Ladder['faucet']

/**
 * The heading for a faucet's row. Written out rather than derived from `FAUCET_NOUN` with a CSS
 * `capitalize`, which title-cases every word — "Days With Steps", "Nights Of Sleep".
 */
export const FAUCET_TITLE: Record<FaucetKey, string> = {
  workout: 'Workouts',
  steps: 'Days with steps',
  sleep: 'Nights of sleep',
}

/** What a faucet day IS, in the user's words. The engine counts days, not thresholds. */
export const FAUCET_NOUN: Record<FaucetKey, { one: string; many: string }> = {
  workout: { one: 'workout', many: 'workouts' },
  steps: { one: 'day with steps', many: 'days with steps' },
  sleep: { one: 'night of sleep', many: 'nights of sleep' },
}

export interface MergeProgress {
  faucet: FaucetKey
  /** Index into `ladder.tiers` of the tier being accumulated. */
  fromTier: number
  /** The tier those merge into — what the user is working toward. */
  towardName: string
  have: number
  need: number
  /**
   * Faucet days still required for this merge — `(need - have)` multiplied up through every rung
   * below. This is what "nearest" is ranked on, and it is the only quantity the user can act on.
   */
  daysNeeded: number
}

/** What one item of tier `i` costs in faucet days: 1 at the bottom, times each merge cost above. */
function unitCostInDays(ladder: Ladder, tier: number): number {
  let cost = 1
  for (let i = 1; i <= tier; i++) cost *= ladder.tiers[i].mergeCost
  return cost
}

/**
 * The merge this ladder will reach soonest, measured in faucet days.
 *
 * **Days, not fraction, and the difference is not cosmetic.** A ladder holding 3 of the 4 scouts a
 * Tank costs is 75% of the way there, but each remaining scout is another 5 workouts — while 3 of
 * the 5 slimes a scout costs is 2 workouts. Ranking on fraction puts the Tank first and then tells
 * the user "1 more cat scout", which is a unit they cannot spend a day earning. Ranking on days
 * gives a number that is always a count of the thing they actually do.
 *
 * A tie goes to the HIGHER tier: same effort, better prize, and it is the case the entry's own
 * example line describes. On these three ladders a tie is the ONLY way a higher rung ever wins —
 * one more of tier N costs a full merge of tier N-1, which is never cheaper than finishing the
 * bottom rung — so that rule is load-bearing rather than a courtesy.
 *
 * **A ladder is never "finished".** Owning a Tank does not stop slimes spawning, so there is always
 * a next merge; null means the ladder has no rung above the bottom at all, or every rung is
 * momentarily at its cost, which `settle` resolves on the next spawn.
 */
export function nextMerge(state: CollectionState, ladder: Ladder): MergeProgress | null {
  let best: MergeProgress | null = null
  for (let i = 0; i < ladder.tiers.length - 1; i++) {
    const need = ladder.tiers[i + 1].mergeCost
    if (need <= 0) continue
    const have = state.stock[i] ?? 0
    if (have >= need) continue
    const daysNeeded = (need - have) * unitCostInDays(ladder, i)
    if (best === null || daysNeeded <= best.daysNeeded) {
      best = { faucet: ladder.faucet, fromTier: i, towardName: ladder.tiers[i + 1].name, have, need, daysNeeded }
    }
  }
  return best
}

/**
 * The ladder the card shows: the one whose next merge is fewest faucet days away.
 *
 * Ties break on the faucet order given, which is stable across renders — a card that swapped
 * ladders between two equal answers on every refresh would read as broken.
 */
export function nearestMerge(
  collections: Partial<Record<FaucetKey, CollectionState>>,
  ladders: Record<FaucetKey, Ladder>,
  order: readonly FaucetKey[] = ['workout', 'steps', 'sleep'],
): MergeProgress | null {
  let best: MergeProgress | null = null
  for (const faucet of order) {
    const state = collections[faucet]
    if (!state) continue
    const progress = nextMerge(state, ladders[faucet])
    if (progress && (best === null || progress.daysNeeded < best.daysNeeded)) best = progress
  }
  return best
}

/**
 * The sentence under the sprite.
 *
 * Always a count of faucet days, because `daysNeeded` already resolved the tiers into them — so the
 * line stays actionable whichever rung the merge is on.
 */
export function mergeLine(progress: MergeProgress): string {
  const noun = FAUCET_NOUN[progress.faucet]
  const n = progress.daysNeeded
  return `${n} more ${n === 1 ? noun.one : noun.many} for a ${progress.towardName}`
}

/**
 * The same count without naming the target — for the card, where the target is the line above it.
 *
 * Split rather than parameterised: the collection screen has no title over its line and needs the
 * full sentence, and a boolean argument at two call sites reads worse than two named functions.
 */
export function mergeCountLine(progress: MergeProgress): string {
  const noun = FAUCET_NOUN[progress.faucet]
  const n = progress.daysNeeded
  return `${n} more ${n === 1 ? noun.one : noun.many}`
}

/** How many items the collection holds in total, across every tier. */
export function totalHeld(state: CollectionState): number {
  return state.stock.reduce((sum, n) => sum + n, 0)
}

/**
 * How the collection screen describes the step and sleep allowances.
 *
 * A function rather than inline copy because the two constants are equal today and need not stay
 * that way — written inline, TypeScript narrows them to literals and the "if they differ" branch is
 * dead code the compiler rejects, which is how a page ends up quietly asserting they are the same.
 */
export function restGapSentence(stepsGap: number, sleepGap: number): string {
  const days = (n: number) => `${n} missed ${n === 1 ? 'day' : 'days'}`
  return stepsGap === sleepGap ? days(stepsGap) : `${days(stepsGap)} for steps and ${days(sleepGap)} for sleep`
}
