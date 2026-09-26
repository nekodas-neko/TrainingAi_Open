import type { CollectionState } from '@trainingai/shared/collection/ladder'
import type { FaucetKey } from '@/components/home/collection-summary'

/** Pure half of `CollectionPen`: which cats it draws, and a stable seed for each one's wander. */

export const MAX_SHOWN = 12
const FAUCETS: FaucetKey[] = ['workout', 'steps', 'sleep']

export interface PenCat { id: string; faucet: FaucetKey; tier: number }

/** Small deterministic hash → [0, 1). Stable for a given cat across renders, and server = client. */
export function seeded(id: string, salt: number): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10_000) / 10_000
}

/** One cat per held item, biggest tiers first, capped at `MAX_SHOWN`; `total` counts them all. */
export function penCats(collections: Partial<Record<FaucetKey, CollectionState>>): { shown: PenCat[]; total: number } {
  const all: PenCat[] = []
  for (const faucet of FAUCETS) {
    const stock = collections[faucet]?.stock ?? []
    stock.forEach((n, tier) => { for (let k = 0; k < n; k++) all.push({ id: `${faucet}-${tier}-${k}`, faucet, tier }) })
  }
  all.sort((a, b) => b.tier - a.tier)
  return { shown: all.slice(0, MAX_SHOWN), total: all.length }
}
