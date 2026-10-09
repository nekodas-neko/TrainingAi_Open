'use client'

import { useState } from 'react'
import { useTransitionRouter } from '@/lib/view-transition'
import { ChevronLeft } from 'lucide-react'
import { useCachedValue } from '@/lib/hooks/use-cached-value'
import { COLLECTION_TTL } from '@trainingai/shared/cache-ttl'
import {
  V2_LADDERS, STEPS_UNITS_PER_T1, STEPS_DRAIN_PER_DAY, HEALTH_POINTS_PER_T1, HEALTH_DRAIN_PER_DAY,
  CARDIO_UNITS_PER_SESSION, CARDIO_UNITS_PER_T1, CARDIO_DRAIN_PER_DAY, type CollectionState, type V2Ladder,
} from '@trainingai/shared/collection/ladder'
import { nextMerge, mergeLine, totalHeld, FAUCET_TITLE, FAUCET_ORDER, type FaucetKey } from '@/components/home/collection-summary'
import { CatSprite } from '@/components/home/cat-sprite'
import { CatRoster } from './cat-roster'
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
  const router = useTransitionRouter()
  const [failed, setFailed] = useState(false)
  const data = useCachedValue<CollectionResponse>(
    'collection', '/api/collection', COLLECTION_TTL, { onError: () => setFailed(true) },
  )
  // Collection rules v2 (#2187): the only block this screen reads.
  const collections = data?.v2?.collections

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

      {!failed && collections == null && (
        <div className="space-y-3 px-4" aria-busy="true" aria-label="Loading collection">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-28 rounded-2xl bg-muted/50 animate-pulse" />)}
        </div>
      )}

      {!failed && collections != null && (
        <div className="space-y-3 px-4">
          {FAUCET_ORDER.map(faucet => (
            <LadderCard key={faucet} faucet={faucet} ladder={V2_LADDERS[faucet]} state={collections[faucet]} />
          ))}
          <Rules />
        </div>
      )}
    </div>
  )
}

function LadderCard({ faucet, ladder, state }: { faucet: FaucetKey; ladder: V2Ladder; state: CollectionState | undefined }) {
  if (!state) return null
  const next = nextMerge(state, ladder)
  const held = totalHeld(state)

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {FAUCET_TITLE[faucet]}
          {/* The owner marked the Rogue's numbers provisional (#2085): say so on the row itself. */}
          {faucet === 'cardio' && <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">provisional</span>}
        </h2>
        <p className="text-xs text-muted-foreground">{held === 1 ? '1 held' : `${held} held`}</p>
      </div>

      <ul className="mt-3 flex items-end justify-around gap-2">
        {ladder.tiers.map((tier, i) => (
          <li key={tier.name} className="flex flex-col items-center gap-1 text-center">
            <CatSprite faucet={faucet} tier={i} size={48} />
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

      <CatRoster faucet={faucet} ladder={ladder} cats={state.cats} />

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
  const { workout, steps, health, cardio } = V2_LADDERS
  const tiers = workout.tiers.length
  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-3 text-xs leading-relaxed text-muted-foreground">
      <h2 className="text-sm font-semibold text-foreground">How this works</h2>

      <p>
        <span className="font-medium text-foreground">Four rows, {tiers} tiers each.</span> Every
        workout you do gives the Tank row a {workout.tiers[0].name}. Steps, health logging and
        cardio sessions fill a bank that turns into {steps.tiers[0].name}, {health.tiers[0].name} and{' '}
        {cardio.tiers[0].name} cats.
      </p>

      <p>
        <span className="font-medium text-foreground">They merge upward.</span>{' '}
        {workout.tiers.slice(1).map(t => t.mergeCost).join(' · ')} cats of one tier make the next on
        the Tank row. On the other three rows it is {steps.tiers[1].mergeCost} of one tier for one of
        the next, all the way up.
      </p>

      <p>
        <span className="font-medium text-foreground">Steps.</span> {STEPS_UNITS_PER_T1.toLocaleString('en-AU')}{' '}
        steps in a day make a {steps.tiers[0].name}. Each day the bank drains{' '}
        {STEPS_DRAIN_PER_DAY.toLocaleString('en-AU')} steps, so a day of {STEPS_UNITS_PER_T1.toLocaleString('en-AU')}{' '}
        banks {(STEPS_UNITS_PER_T1 - STEPS_DRAIN_PER_DAY).toLocaleString('en-AU')} net.
      </p>

      <p>
        <span className="font-medium text-foreground">Health.</span> One point each for sleep
        recorded, any food logged and a weight, per day. {HEALTH_POINTS_PER_T1} points make a{' '}
        {health.tiers[0].name}; the bank drains {HEALTH_DRAIN_PER_DAY} a day, so logging two of the
        three holds it level.
      </p>

      <p>
        <span className="font-medium text-foreground">Cardio.</span> One walk, run, treadmill, hike,
        cycle, swim or HIIT session makes a {cardio.tiers[0].name}
        {CARDIO_UNITS_PER_SESSION === CARDIO_UNITS_PER_T1 ? '' : ' (part of one)'}; the bank drains{' '}
        {CARDIO_DRAIN_PER_DAY}/{CARDIO_UNITS_PER_SESSION} of a session a day. These numbers are
        provisional and may be retuned.
      </p>

      <p>
        <span className="font-medium text-foreground">Gaps cost you one at a time.</span> When a bank
        runs down, the row loses its smallest creature — and a big one breaks back down into smaller
        ones rather than vanishing, so a long gap costs you progress, never the lot. The days
        underneath still count.
      </p>

      <p>
        <span className="font-medium text-foreground">Your own rest days are free.</span> How long a
        gap can be for the Tank row comes from <span className="text-foreground">your schedule</span>,
        not a fixed number — and a rest day you chose, or a deload the app asked you to take, does not
        count against it at all. Following your own plan never costs you anything.
      </p>
    </section>
  )
}
