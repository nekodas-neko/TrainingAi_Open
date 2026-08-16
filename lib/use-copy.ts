'use client'

import { useCallback, useRef, useState } from 'react'

/**
 * Copy-to-clipboard for the Android WebView, where `navigator.clipboard` is
 * blocked in many configs. Pass the source `<textarea>`/`<input>` element and it
 * tries the legacy `execCommand('copy')` path first — that runs synchronously
 * inside the tap gesture and is the most WebView-compatible — then falls back to
 * the async Clipboard API, then returns false so the caller can leave the text
 * selected for a manual long-press copy.
 *
 * Replaces the copy logic that was hand-duplicated across every oura-ble tester
 * card (live-step-test, step-calibration, battery-soak, continuous-capture).
 */
export function useCopy(resetMs = 1500) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flag = useCallback(() => {
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), resetMs)
  }, [resetMs])

  const copy = useCallback(
    async (text: string, el?: HTMLTextAreaElement | HTMLInputElement | null): Promise<boolean> => {
      if (el) {
        el.focus()
        el.select()
        el.setSelectionRange(0, el.value.length)
        try {
          if (document.execCommand('copy')) { flag(); return true }
        } catch { /* fall through to the Clipboard API */ }
      }
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text)
          flag()
          return true
        }
      } catch { /* fall through — caller leaves the source selected for manual copy */ }
      return false
    },
    [flag],
  )

  return { copied, copy }
}
