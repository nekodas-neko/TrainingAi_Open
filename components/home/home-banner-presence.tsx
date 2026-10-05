'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { type CollapsingBanner } from '@/components/home/home-banner-keys'

export { COLLAPSING_BANNERS, type CollapsingBanner } from '@/components/home/home-banner-keys'

interface Registry {
  present: ReadonlySet<CollapsingBanner>
  report: (key: CollapsingBanner, present: boolean) => void
}

const BannerPresenceContext = createContext<Registry | null>(null)

/**
 * RV-119 — who is actually waiting, asked of the banners themselves.
 *
 * **Why a registry rather than lifting the data.** The strip says *"4 ready"* and draws one icon per
 * waiting banner, so it has to know **which** are showing — and two of the four decide that
 * internally and `return null`: `ExerciseDetectedCard` reads its own pending sessions, and
 * `WeeklyRecapBanner` its own recap and dismissal. Hoisting those reads into the parent would
 * duplicate two non-trivial conditions and give them a second place to drift; the entry does not
 * mention the problem at all, because from the outside all four look parent-controlled.
 *
 * So each banner keeps deciding for itself and simply says so. The strip counts.
 *
 * **They stay MOUNTED while collapsed, hidden rather than unrendered** — that is what makes the
 * registry work, and it is also what keeps each banner's own dismiss affordance alive, which the
 * entry lists as the accepted cost of option A. It is not accepted here: expanding the strip shows
 * the real banners, with the controls they already have.
 */
export function HomeBannerPresenceProvider({ children }: { children: React.ReactNode }) {
  const [present, setPresent] = useState<ReadonlySet<CollapsingBanner>>(() => new Set())

  // ⛔ `report` MUST be stable, and this is not a micro-optimisation — an unstable one crashes Home.
  //
  // It lived inside the `useMemo` below, so it was rebuilt every time `present` changed. The
  // reporting effect lists it as a dependency (it must: a stale `report` would write into a dead
  // provider), so every presence change re-ran EVERY banner's effect, each of which calls `report`
  // again. With a banner whose presence legitimately changes after mount — a weekly recap going
  // loading → error is the case that found this — that is an unbounded cycle, and Home dies with
  // **"Maximum update depth exceeded"** on the root error boundary.
  //
  // The `prev.has(key) === isPresent` bail-out does not save it: it prevents a state WRITE, but the
  // effects have already been re-scheduled by the identity change before any of them runs.
  //
  // `useState`'s setter is itself stable, so an empty dependency list here is correct rather than a
  // lint appeasement.
  const report = useCallback<Registry['report']>((key, isPresent) => {
    setPresent(prev => {
      if (prev.has(key) === isPresent) return prev   // no state write, so no extra render
      const next = new Set(prev)
      if (isPresent) next.add(key); else next.delete(key)
      return next
    })
  }, [])

  const value = useMemo<Registry>(() => ({ present, report }), [present, report])

  return <BannerPresenceContext.Provider value={value}>{children}</BannerPresenceContext.Provider>
}

/**
 * Called by a collapsing banner with whether it has anything to show.
 *
 * Safe outside the provider — it returns without reporting, so each of these components still works
 * anywhere else it is rendered rather than requiring Home's context to exist.
 */
export function useReportBannerPresence(key: CollapsingBanner, present: boolean) {
  const ctx = useContext(BannerPresenceContext)
  const report = ctx?.report
  useEffect(() => {
    if (!report) return
    report(key, present)
    // Unmounting is not "nothing to show" for the others, but it IS for this one — a banner that
    // leaves the tree must not keep a slot in the strip counting it.
    return () => report(key, false)
  }, [report, key, present])
}

/** What the strip renders from. Empty outside the provider. */
export function useBannersPresent(): ReadonlySet<CollapsingBanner> {
  return useContext(BannerPresenceContext)?.present ?? new Set<CollapsingBanner>()
}
