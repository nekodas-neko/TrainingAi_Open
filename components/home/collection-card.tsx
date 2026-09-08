'use client'

import { useState } from 'react'
import { useCachedValue } from '@/lib/hooks/use-cached-value'
import { COLLECTION_TTL } from '@trainingai/shared/cache-ttl'
import { LADDERS, type CollectionState } from '@trainingai/shared/collection/ladder'
import { nearestMerge, mergeCountLine, totalHeld, type FaucetKey } from '@/components/home/collection-summary'
import { tierGlyph } from '@/components/home/collection-sprites'

export interface CollectionResponse {
  collections: Record<FaucetKey, CollectionState>
  rulesVersion: number
  today: string
}

/**
 * BF-122b — one line of the collection, on Home.
 *
 * Three ladders do not fit a card that sits under the nutrition donut, so this shows **the ladder
 * whose next merge is fewest faucet days away** and rotates itself as that changes. It answers
 * "what do I do today" in a glance, which a three-column grid does not, and it needs no interaction
 * to be useful — the tap goes to the full collection, matching every other card here.
 *
 * Off by default: `DEFAULT_CARD_WIDGETS` is empty, so this is a slot the owner turns on.
 */
export function CollectionCard() {
  const [failed, setFailed] = useState(false)
  const data = useCachedValue<CollectionResponse>(
    'collection', '/api/collection', COLLECTION_TTL,
    // `cachedFetch` swallows `!res.ok`, so without this the card would simply vanish on a failure
    // and read as "you have nothing" — which for a collection is the worst possible wrong answer.
    { onError: () => setFailed(true) },
  )

  if (failed) {
    return (
      <div className="p-4">
        <Heading />
        <p className="text-sm text-muted-foreground">Couldn&rsquo;t load your collection.</p>
      </div>
    )
  }

  if (data == null) {
    return (
      <div className="p-4">
        <Heading />
        <div className="h-10 rounded-lg bg-muted/50 animate-pulse" aria-label="Loading collection" aria-busy="true" />
      </div>
    )
  }

  const next = nearestMerge(data.collections, LADDERS)
  const held = (Object.values(data.collections) as CollectionState[]).reduce((sum, s) => sum + totalHeld(s), 0)

  if (next == null) {
    return (
      <div className="p-4">
        <Heading />
        <p className="text-sm text-muted-foreground">
          {held > 0 ? `${held} in your collection.` : 'Train, walk or sleep and your first cat turns up.'}
        </p>
      </div>
    )
  }

  // Scoped to the ladder on screen, not summed across all three: the sum is a number about rows the
  // card is not showing. It is still a LIFETIME count — the fold reports how many decays fired over
  // all history and carries no recency — so the wording says "have" rather than implying it just
  // happened, which would be a claim the engine cannot support.
  const decayed = data.collections[next.faucet]?.decayEvents ?? 0

  return (
    <div className="p-4">
      <Heading />
      <div className="flex items-center gap-3">
        <span className="text-3xl leading-none" aria-hidden="true">{tierGlyph(next.faucet, next.fromTier + 1)}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold first-letter:uppercase truncate">{next.towardName}</p>
          <p className="text-xs text-muted-foreground">{mergeCountLine(next)}</p>
        </div>
        <Pips have={next.have} need={next.need} />
      </div>
      {decayed > 0 && (
        // Stated rather than left to be inferred from a smaller number, which reads as a bug — the
        // reason `decayEvents` is on the state at all.
        <p className="mt-2 text-[11px] text-muted-foreground">
          {decayed === 1 ? 'One has' : `${decayed} have`} wandered off over long gaps — the days underneath them still count.
        </p>
      )}
    </div>
  )
}

function Heading() {
  return <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Collection</p>
}

/**
 * `●●●●○` as elements rather than text, so a screen reader gets the count once instead of five
 * bullet characters. Capped so a seven-cost ladder still fits beside the label at 412 dp.
 */
function Pips({ have, need }: { have: number; need: number }) {
  const shown = Math.min(need, 7)
  return (
    <span className="flex flex-none items-center gap-0.5" role="img" aria-label={`${have} of ${need}`}>
      {Array.from({ length: shown }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full ${i < have ? 'bg-brand' : 'bg-muted-foreground/30'}`}
        />
      ))}
    </span>
  )
}
