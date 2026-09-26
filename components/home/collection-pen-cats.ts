import type { CollectionState } from '@trainingai/shared/collection/ladder'
import type { FaucetKey } from '@/components/home/collection-summary'

/** Pure half of `CollectionPen`: which cats it draws, and a stable seed for each one's wander. */

/**
 * Ceiling on the drawn set. **The real number comes from the pen's measured width** — see
 * `shownForWidth` — and this only caps it, so a wide pen cannot turn into a wall of cats.
 */
export const MAX_SHOWN = 12

/**
 * Widest a sprite gets, plus a little air. Used to turn the pen's measured width into a cat count.
 *
 * BF-204: the pen drew a constant twelve into **348 px** (412 dp less the page and card padding),
 * which is 600 px of sprite at tier 3 — **1.72×** — with `348 / 12 = 29 px` slots against 34–50 px
 * sprites, so neighbours overlapped by ~13 px before the ±115 px wander even started.
 */
const SLOT_PX = 56

/** How many cats fit across a pen of this width. Never fewer than three — an empty pen is worse. */
export function shownForWidth(width: number): number {
  return Math.max(3, Math.min(MAX_SHOWN, Math.floor(width / SLOT_PX)))
}

/**
 * How many name tags to draw, rarest first.
 *
 * BF-204: every shown cat carried a `whitespace-nowrap` tag centred on it, so twelve six-character
 * names came to ~456 px against 348 px — **1.31×**, and 1.66× at eight characters. On the owner's
 * screenshot "Beaso" was occluded and "Har", "P" and "Xecom" were each clipped mid-word. The tags
 * collided worse than the sprites did, and they are the part that reads as broken.
 */
export function tagsForWidth(width: number): number {
  return Math.max(1, Math.min(4, Math.floor(width / 116)))
}
const FAUCETS: FaucetKey[] = ['workout', 'steps', 'sleep']

export interface PenCat { id: string; faucet: FaucetKey; tier: number; name?: string }

/** Small deterministic hash → [0, 1). Stable for a given cat across renders, and server = client. */
export function seeded(id: string, salt: number): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10_000) / 10_000
}

/**
 * One cat per held item; `shown` is a SPREAD ACROSS TIERS, `total` counts them all.
 *
 * **Sorting biggest-first and slicing was the defect (BF-204), not a detail of it.** It guaranteed
 * that every drawn cat came from one tier, and `BAND` gives a tier a 12 px vertical interval — so
 * the depth-by-tier design that is meant to separate them did nothing, and all twelve landed on one
 * line. The owner's collection is ≈ 22 cats of which ≈ 13 are top-tier, so that was the normal
 * case rather than an unlucky one.
 *
 * Round-robin from the rarest tier down keeps the rare cats in (which is what the sort was for)
 * while putting the drawn set across several bands, which is what spreads them out vertically.
 */
export function penCats(
  collections: Partial<Record<FaucetKey, CollectionState>>,
  maxShown: number = MAX_SHOWN,
): { shown: PenCat[]; total: number } {
  const all: PenCat[] = []
  for (const faucet of FAUCETS) {
    const state = collections[faucet]
    if (state?.cats) {
      // Named cats from the lineage replay: stable ids, so a cat keeps its place in the pen.
      for (const c of state.cats) all.push({ id: c.id, faucet, tier: c.tier, name: c.name })
      continue
    }
    // A cached response from before names existed: anonymous cats from the counts.
    const stock = state?.stock ?? []
    stock.forEach((n, tier) => { for (let k = 0; k < n; k++) all.push({ id: `${faucet}-${tier}-${k}`, faucet, tier }) })
  }
  const byTier = new Map<number, PenCat[]>()
  for (const cat of all) {
    const bucket = byTier.get(cat.tier)
    if (bucket) bucket.push(cat)
    else byTier.set(cat.tier, [cat])
  }
  const tiers = [...byTier.keys()].sort((a, b) => b - a)
  const shown: PenCat[] = []
  for (let round = 0; shown.length < maxShown; round += 1) {
    let drew = false
    for (const tier of tiers) {
      const bucket = byTier.get(tier)!
      if (round >= bucket.length) continue
      shown.push(bucket[round])
      drew = true
      if (shown.length >= maxShown) break
    }
    if (!drew) break
  }
  return { shown, total: all.length }
}
