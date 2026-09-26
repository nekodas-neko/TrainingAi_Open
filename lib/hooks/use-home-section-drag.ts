'use client'

import { useCallback } from 'react'
import type { MutableRefObject } from 'react'
import type { DragOverEvent } from '@dnd-kit/react'
import { moveSection } from '@/components/home/section-order'
import { savePreference } from '@/lib/user/preferences-sync'
import type { SectionKey } from '@/lib/home/home-prefs'

/**
 * The gesture the Home "Reorder sections" button never had (BF-205).
 *
 * The owner: *"when I click the grid button on the home screen I cannot move widgets and
 * re-arrange them."* Every part of the feature was already built — the button with its
 * `aria-pressed`, the order in state, `loadSectionOrder`/`saveSectionOrder`, and a ref kept in
 * sync by a layout effect whose comment reads *"so drag/sync handlers can read it
 * synchronously"* — but `setSectionOrder` had four call sites and not one of them was a user
 * gesture. This is the missing half, in a hook rather than in
 * `session-select-content.tsx` because that file is a size-ratcheted hotspot.
 */
export function useHomeSectionDrag(
  orderRef: MutableRefObject<SectionKey[]>,
  setOrder: (next: SectionKey[]) => void,
) {
  /**
   * `orderRef` is written here as well as by the layout effect, deliberately: `dragover` fires
   * repeatedly within one drag and the effect only runs after the render commits, so two events
   * in quick succession would both compute from the same stale order and the second would undo
   * the first.
   */
  const onDragOver = useCallback(({ operation }: DragOverEvent) => {
    const { source, target } = operation
    if (!source || !target || source.id === target.id) return
    const next = moveSection(orderRef.current, source.id as SectionKey, target.id as SectionKey)
    if (next === orderRef.current) return
    orderRef.current = next
    setOrder(next)
  }, [orderRef, setOrder])

  /**
   * Persisted ONCE, when the thumb lifts. `savePreference` is not a `localStorage` write — it
   * also PATCHes the server, so saving per `dragover` would put a request behind every position
   * the thumb passes.
   */
  const onDragEnd = useCallback(() => {
    savePreference('homeSectionOrder', orderRef.current)
  }, [orderRef])

  return { onDragOver, onDragEnd }
}
