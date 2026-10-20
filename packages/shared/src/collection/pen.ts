import type { CollectionState } from './ladder'
import { FAUCET_ORDER, type FaucetKey } from './summary'

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
const FAUCETS = FAUCET_ORDER

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

/** The pen's height in px. */
export const PEN_HEIGHT = 176
/** The pen's width before it has been measured: 412 dp less the page's 32 and the card's 32. */
export const ASSUMED_PEN_W = 348
/** Sprite size per engine tier, T1 first. */
export const SIZE = [34, 42, 50, 58, 64, 72]
/** Lowest and highest walking line per tier, in px up from the pen's floor. T5 and T6 are in the air;
 *  the front row starts 14px up so its name tags stay inside the pen. */
export const BAND: [number, number][] = [[14, 24], [22, 34], [32, 44], [42, 54], [70, 86], [80, 94]]
export const FLYING_FROM_TIER = 4

export const spriteSizeOf = (tier: number) => SIZE[Math.min(tier, SIZE.length - 1)]

/** Interleaves slots so the biggest cats (listed first) land spread out, not all at the left. */
export function slotOf(i: number, n: number): number {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
  const step = [7, 5, 3, 1].find(k => gcd(k, n) === 1) ?? 1
  return (i * step) % n
}

export interface PenMotion {
  size: number
  flying: boolean
  /** Where the walk starts and ends, as fractions of the free width (pen width less the sprite). */
  from: number
  to: number
  /** Seconds for one leg of the walk. */
  dur: number
  /** The negative of a CSS delay: how far into its walk the cat starts, in seconds (0 to dur). */
  offset: number
  /** Heights up from the pen's floor at each end of the walk, in px. */
  y0: number
  y1: number
  /** Smaller tiers are nearer, so they draw over the ones behind; tier is the depth. */
  zIndex: number
}

/**
 * Where one cat walks, seeded from its identity so a re-render (or a revalidation that returns the
 * same stock) does not reshuffle the pen. Each cat starts in its own slice of the width, then
 * wanders up to a third of the pen either way. Both apps animate these same numbers.
 */
export function penCatMotion(cat: PenCat, slot: number, slots: number): PenMotion {
  const size = spriteSizeOf(cat.tier)
  const [lo, hi] = BAND[Math.min(cat.tier, BAND.length - 1)]
  const from = (slot + seeded(cat.id, 1)) / slots
  const to = Math.min(1, Math.max(0, from + (seeded(cat.id, 2) - 0.5) * 0.66))
  const dur = 10 + seeded(cat.id, 3) * 9
  return {
    size,
    flying: cat.tier >= FLYING_FROM_TIER,
    from,
    to,
    dur,
    offset: seeded(cat.id, 5) * dur,
    y0: Math.round(lo + seeded(cat.id, 4) * (hi - lo)),
    y1: Math.round(lo + seeded(cat.id, 7) * (hi - lo)),
    zIndex: 100 - cat.tier * 10,
  }
}
