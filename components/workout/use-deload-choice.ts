'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { readTodayCacheSync } from '@/lib/sqlite/cache'
import { isFullOverride } from './utils'
import type { SessionPeriodization } from '@trainingai/shared/types/ai-periodization'

/**
 * Today's intensity choice (Q-109-followup).
 *
 * Deload used to be a third button on Home that navigated to `?aiDeload=1`, so the flag was a fixed
 * URL param for the life of the screen. It now lives on the pre-workout screen, which means it has
 * to be live state — flipping it re-keys the workout-data cache and refetches, exactly as the old
 * navigation did, but without leaving the screen.
 *
 * **It also has to REFLECT the prescription, which it did not (BF-8).** The state was seeded from
 * the URL param and nothing else, so with no `?aiDeload=1` it read "Full · As prescribed" while the
 * card directly below it said "Deload session · Auto-applied". The owner trained one of those
 * believing it was a full session: *"I was under the assumption I was doing my full session but it
 * looks like it has been deload... its too hidden."* "As prescribed" is a claim about the
 * prescription, so it has to come from the prescription.
 *
 * **A later choice still wins.** Adoption stops the first time the user touches the toggle,
 * including via the URL param, which is itself a choice — otherwise a prescription arriving a moment
 * after a tap would quietly undo it, and the toggle is live: what it says is what will run.
 *
 * `recommended` only labels the toggle; it never gates the choice. It is read from the same
 * `next-session` seed Home paints from rather than fetched, so a cache miss means no label, never
 * a wrong one.
 */
export function useDeloadChoice(seedFromUrl: boolean, periodization?: SessionPeriodization | null) {
  // Only a prescription that still governs the session: once it is `consumed` its deload flag
  // describes a session that has already run, and adopting it would relabel the next one.
  const prescribedDeload = periodization && periodization.prescriptionStatus !== 'consumed'
    ? periodization.prescription?.deload
    : undefined

  const [deload, setDeloadState] = useState(seedFromUrl)
  const [recommended, setRecommended] = useState(false)
  // A ref, not state: adopting must not re-run the effect that adopts.
  const chosenRef = useRef(seedFromUrl)
  // The same fact as `chosenRef`, in state, because the SESSION-LEVEL revert has to re-render when
  // it flips (BF-64). The ref stays because it is the effect's guard and must not be a dependency;
  // the effect below reads the ref, so adding this state does not re-run it.
  const [chosen, setChosen] = useState(seedFromUrl)

  useEffect(() => {
    const rec = readTodayCacheSync<{ deloadOrRestRecommended?: boolean }>('next-session')
    if (rec?.deloadOrRestRecommended) setRecommended(true)
  }, [])

  useEffect(() => {
    if (chosenRef.current || prescribedDeload == null) return
    setDeloadState(prescribedDeload)
  }, [prescribedDeload])

  const setDeload = useCallback((next: boolean) => {
    chosenRef.current = true
    setChosen(true)
    setDeloadState(next)
  }, [])

  /**
   * The user has explicitly chosen Full while the prescription says deload — the case where the
   * toggle's own word, **Override**, has to mean something (BF-64).
   *
   * **It must key on the explicit choice, never on `deload === false`.** `deload` seeds false and
   * only adopts the prescription in an effect, so on first render it is false while the prescription
   * is a deload and the user has chosen nothing. A revert keyed on `!deload` would paint full
   * weights for a frame and then snap back to deloaded ones.
   */
  const overrideFull = isFullOverride(chosen, prescribedDeload, deload)

  return { deload, setDeload, recommended, prescribedDeload: !!prescribedDeload, overrideFull }
}
