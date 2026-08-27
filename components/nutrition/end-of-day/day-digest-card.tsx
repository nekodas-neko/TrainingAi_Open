'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { AlertTriangle, Sparkles } from 'lucide-react'

const Response = dynamic(() => import('@/components/ai/response').then(m => m.Response), { ssr: false })

interface Props {
  /** Fetch only while the review is open — this POSTs, and it costs a model call. */
  active: boolean
}

interface DailyDigestResponse {
  digest: string | null
  date: string
}

/**
 * The day's AI digest, at the top of the review (Q-112a).
 *
 * Moved here from `day-review-sheet.tsx`, which was the only consumer of `/api/daily-digest` and is
 * deleted with this change — Home's banner and Nutrition's End of Day button now reach one screen
 * rather than two different ones.
 *
 * **The fetch defects were carried across as fixes, not as code.** The sheet's version had a
 * `.finally()` and no `.catch()`, so a failed request left the card blank with no way to tell "the
 * day had nothing to say" from "the request died" — Q-499's class exactly, and the reason this has
 * an error state the original never had. A rejected POST also left `loading` false with `digest`
 * null, which renders as silence.
 */
export function DayDigestCard({ active }: Props) {
  const [digest, setDigest] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    setLoading(true)
    setFailed(false)
    fetch('/api/daily-digest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(res => { if (!res.ok) throw new Error(String(res.status)); return res.json() as Promise<DailyDigestResponse> })
      .then(data => { if (!cancelled) setDigest(data?.digest ?? null) })
      .catch(() => { if (!cancelled) setFailed(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [active])

  if (loading) return <div className="h-16 animate-pulse rounded-2xl bg-muted/60" />

  if (failed) {
    return (
      <p
        className="flex items-start gap-1.5 rounded-2xl border border-border/60 px-4 py-3 text-[11px] leading-snug"
        style={{ color: 'var(--accent-amber)' }}
      >
        <AlertTriangle className="mt-px h-3 w-3 flex-none" />
        <span>Today&rsquo;s summary could not be written. The rest of this review is unaffected.</span>
      </p>
    )
  }

  // A day with nothing to say is a legitimate answer, and it is not an error — say nothing rather
  // than render an empty card.
  if (!digest) return null

  return (
    <div className="rounded-2xl border border-border/60 px-4 py-3.5">
      <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-brand">
        <Sparkles className="h-3 w-3" /> Your day
      </p>
      <Response className="text-sm leading-relaxed">{digest}</Response>
    </div>
  )
}
