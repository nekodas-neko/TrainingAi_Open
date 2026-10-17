'use client'

import { useEffect, useRef, useState } from 'react'
import { useTabVisibility } from '@/components/shell/tab-visibility'

/** The slice of `document` the resume listener needs; a plain object stands in for it in tests. */
export interface ResumeSource {
  visibilityState: string
  addEventListener(type: 'visibilitychange', cb: () => void): void
  removeEventListener(type: 'visibilitychange', cb: () => void): void
}

/**
 * Call `onResume` each time the app comes back to the foreground (the document turns visible).
 * Returns the unsubscribe. Going to the background does nothing.
 */
export function subscribeToAppResume(doc: ResumeSource, onResume: () => void): () => void {
  const listener = () => { if (doc.visibilityState === 'visible') onResume() }
  doc.addEventListener('visibilitychange', listener)
  return () => doc.removeEventListener('visibilitychange', listener)
}

/**
 * A number that goes up whenever the user comes back to this card: the app resumes, or the shell
 * re-shows this tab. Feed it to `useCachedValue`'s `reloadToken` so a card in the persistent tab
 * shell (which never unmounts) revalidates behind its cached value instead of holding the payload
 * it fetched at launch (issue 2906: the heart-rate card said "no heart rate recorded yet" while
 * Preview showed readings). It is 0 at mount, so the first paint costs no extra request.
 *
 * A revalidation, never a purge: the cached value stays on screen until the response lands, so a
 * repeat visit does not flash a skeleton.
 */
export function useRevalidateOnReturn(): number {
  const { epoch, visible } = useTabVisibility()
  const [resumes, setResumes] = useState(0)
  // A resume while the shell is showing another tab is not counted: the card is unseen, and the
  // epoch bump when the tab is re-shown revalidates it then.
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  useEffect(
    () => subscribeToAppResume(document, () => { if (visibleRef.current) setResumes(n => n + 1) }),
    [],
  )
  return epoch + resumes
}
