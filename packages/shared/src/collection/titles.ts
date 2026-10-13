// #2189 (PS-51). Titles that unlock the collection pen's backdrop scenes.
//
// The owner's mapping (approved 2026-09-27): forest ← first Ranger T4 · house ← first Health-cat T3 ·
// castle ← first Tank T4. Each scene hangs off a different ladder, so no single line of play unlocks
// all three.
//
// **Derived, never stored.** A title is a fact about the replay — "this ladder has reached tier N" —
// read from its high-water mark (`CollectionState.reached`). Storing it would be the game-state table
// `ladder.ts` exists to avoid, and the high-water mark keeps a title earned once from vanishing when
// a decay breaks the cat that earned it back down.
//
// **Written to survive a tier-count change** (the note PS-49 left on this entry): a title names its
// ladder by faucet and its tier by NUMBER, and reads the tier's display name from the ladder at the
// time it is asked. A tier the ladder no longer has is simply not earned, never an error. It is a
// lookup table, so the mapping is one line each to change.

import { V2_LADDERS, type V2Ladder, type CollectionState } from './ladder'

/** The pen's backdrops (`public/cats/scene-*.svg`). Meadow is the default and needs no title. */
export type PenScene = 'meadow' | 'forest' | 'house' | 'castle'

export interface SceneTitleRule {
  scene: Exclude<PenScene, 'meadow'>
  faucet: V2Ladder['faucet']
  /** 1-based, as the owner says it: "T4" is the fourth rung, index 3. */
  tier: number
}

export const SCENE_TITLE_RULES: readonly SceneTitleRule[] = [
  { scene: 'forest', faucet: 'steps', tier: 4 },
  { scene: 'house', faucet: 'health', tier: 3 },
  { scene: 'castle', faucet: 'workout', tier: 4 },
]

export interface CollectionTitle {
  scene: SceneTitleRule['scene']
  faucet: SceneTitleRule['faucet']
  tier: number
  /** "First Ranger IV" — the tier's own name, read from the ladder now. */
  title: string
  earned: boolean
  /** The day the tier was first held; null while not earned. */
  earnedOn: string | null
}

/** Every scene title, earned or not, from the v2 collections the route already replays. */
export function collectionTitles(
  collections: Partial<Record<V2Ladder['faucet'], Pick<CollectionState, 'reached'>>>,
  ladders: Record<V2Ladder['faucet'], V2Ladder> = V2_LADDERS,
): CollectionTitle[] {
  return SCENE_TITLE_RULES.map(rule => {
    const tierDef = ladders[rule.faucet]?.tiers[rule.tier - 1]
    const earnedOn = tierDef ? collections[rule.faucet]?.reached?.[rule.tier - 1] ?? null : null
    return {
      scene: rule.scene,
      faucet: rule.faucet,
      tier: rule.tier,
      title: tierDef ? `First ${tierDef.name}` : `First tier ${rule.tier}`,
      earned: earnedOn != null,
      earnedOn,
    }
  })
}

/** The scenes a user may pick: meadow always, plus each one whose title is earned. */
export function unlockedScenes(titles: readonly CollectionTitle[]): PenScene[] {
  return ['meadow', ...titles.filter(t => t.earned).map(t => t.scene)]
}
