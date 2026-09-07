'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { useCachedValue } from '@/lib/hooks/use-cached-value'
import { COLLECTION_TTL } from '@trainingai/shared/cache-ttl'
import { LADDERS, STEPS_MAX_REST_GAP, SLEEP_MAX_REST_GAP, type CollectionState, type Ladder } from '@trainingai/shared/collection/ladder'
import { nextMerge, mergeLine, totalHeld, restGapSentence, FAUCET_TITLE, type FaucetKey } from '@/components/home/collection-summary'
import { tierGlyph } from '@/components/home/collection-sprites'
import type { CollectionResponse } from '@/components/home/collection-card'

/**
 * BF-122b — the whole collection, and the page that explains it.
 *
 * **The explanation is the point of this screen, not a footnote.** A decay nobody explained reads as
 * a bug: the owner will lose a Tank and, without this, there is nothing in the app that says why, or
 * that the workouts underneath it still count. The entry named this the deliverable most likely to
 * be dropped, so it is written first and sits above the fold of the rules section.
 */
export function CollectionContent() {
  const router = useRouter()
  const [failed, setFailed] = useState(false)
  const data = useCachedValue<CollectionResponse>(
    'collection', '/api/collection', COLLECTION_TTL, { onError: () => setFailed(true) },
  )

  return (
    <div className="min-h-dvh pb-safe-action">
      <header className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          aria-label="Go back"
          onClick={() => router.back()}
          className="tap-dense tap-target-44 rounded-lg p-2.5 text-muted-foreground hover:bg-muted transition"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold">Collection</h1>
      </header>

      {failed && (
        <p className="px-4 pb-4 text-sm text-muted-foreground">Couldn&rsquo;t load your collection.</p>
      )}

      {!failed && data == null && (
        <div className="space-y-3 px-4" aria-busy="true" aria-label="Loading collection">
          {[0, 1, 2].map(i => <div key={i} className="h-28 rounded-2xl bg-muted/50 animate-pulse" />)}
        </div>
      )}

      {!failed && data != null && (
        <div className="space-y-3 px-4">
          {(Object.keys(LADDERS) as FaucetKey[]).map(faucet => (
            <LadderCard key={faucet} faucet={faucet} ladder={LADDERS[faucet]} state={data.collections[faucet]} />
          ))}
          <Rules />
        </div>
      )}
    </div>
  )
}

function LadderCard({ faucet, ladder, state }: { faucet: FaucetKey; ladder: Ladder; state: CollectionState | undefined }) {
  if (!state) return null
  const next = nextMerge(state, ladder)
  const held = totalHeld(state)

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{FAUCET_TITLE[faucet]}</h2>
        <p className="text-xs text-muted-foreground">{held === 1 ? '1 held' : `${held} held`}</p>
      </div>

      <ul className="mt-3 flex items-center gap-4">
        {ladder.tiers.map((tier, i) => (
          <li key={tier.name} className="flex items-center gap-1.5">
            <span className="text-2xl leading-none" aria-hidden="true">{tierGlyph(faucet, i)}</span>
            <span className="text-xs">
              <span className="font-semibold tabular-nums">{state.stock[i] ?? 0}</span>
              {/* `first-letter:uppercase`, not `capitalize`: the engine capitalises only the top
                  tier's own word ("cat Tank" vs "cat scout"), and that distinction is deliberate. */}
              <span className="block text-[10px] text-muted-foreground first-letter:uppercase">{tier.name}</span>
            </span>
          </li>
        ))}
      </ul>

      {next && <p className="mt-3 text-xs text-muted-foreground">{mergeLine(next)}</p>}

      {state.decayEvents > 0 && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {state.decayEvents === 1 ? 'One has' : `${state.decayEvents} have`} wandered off during long gaps.
        </p>
      )}
    </section>
  )
}

/**
 * The rules, in plain words. Every number here is read from the engine's own constants rather than
 * typed out, so the page cannot drift from the fold that produces it — the failure mode that makes
 * an explanation worse than none.
 */
function Rules() {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-3 text-xs leading-relaxed text-muted-foreground">
      <h2 className="text-sm font-semibold text-foreground">How this works</h2>

      <p>
        <span className="font-medium text-foreground">One a day, per row.</span> Every day you train
        gives you a {LADDERS.workout.tiers[0].name}. So does every day with steps recorded, and every
        night you sleep. Twice in a day still counts once.
      </p>

      <p>
        <span className="font-medium text-foreground">They merge upward.</span>{' '}
        {LADDERS.workout.tiers[1].mergeCost} {LADDERS.workout.tiers[0].name}s become a{' '}
        {LADDERS.workout.tiers[1].name}, and {LADDERS.workout.tiers[2].mergeCost} of those become a{' '}
        {LADDERS.workout.tiers[2].name}. The step and sleep rows work the same way with their own
        creatures.
      </p>

      <p>
        <span className="font-medium text-foreground">Gaps cost you one at a time.</span> Leave it too
        long between days and the row loses its smallest creature — and a big one breaks back down
        into smaller ones rather than vanishing, so a long gap costs you progress, never the lot.
      </p>

      <p>
        <span className="font-medium text-foreground">Your own rest days are free.</span> How long a
        gap can be for the training row comes from{' '}
        <span className="text-foreground">your schedule</span>, not a fixed number — and a rest day
        you chose, or a deload the app asked you to take, does not count against it at all. Following
        your own plan never costs you anything. The steps and sleep rows allow{' '}
        {restGapSentence(STEPS_MAX_REST_GAP, SLEEP_MAX_REST_GAP)}, since neither has a schedule to
        read.
      </p>
    </section>
  )
}
