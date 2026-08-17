'use client'

import { useEffect, useRef } from 'react'

/**
 * Keep a scrollable panel pinned to its newest content, without moving the page.
 *
 * Deliberately **not** `endRef.current.scrollIntoView()` on a sentinel element. `scrollIntoView`
 * scrolls every scrollable ancestor up to the document, not just the panel the sentinel sits in —
 * so a panel that appends a line drags the whole page with it. That is Q-532: during a BLE drain
 * the admin screen re-centred on every log line, moving controls out from under the tap on the one
 * screen where a mistimed press can hit "Clear key".
 *
 * Assigning `scrollTop` cannot escape the element, which is the whole point.
 *
 * The ref goes on the scrolling container itself — the element carrying `overflow-y-auto` — not on
 * a child.
 */
export function useScrollToBottom<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [dep])
  return ref
}
