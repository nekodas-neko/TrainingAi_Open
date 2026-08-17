'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, Sparkles } from 'lucide-react'
import { getCached, setCached, readCacheSync } from '@/lib/sqlite/cache'

interface Props {
  section: 'readiness' | 'sleep' | 'heart-rate' | 'activity'
  date: string
  /**
   * Does this section actually have something to be insightful about? (Q-452)
   *
   * Required rather than defaulted, so a new call site has to answer it. The route substitutes the
   * literal string `"no data"` for every absent field and calls the model anyway — and handed
   * `Steps: no data` the model does not report absence, it asserts **zero** and editorialises. A
   * day-one account was told *"your activity tracker currently shows zero movement… this inactivity
   * creates a significant gap"* on its first ever visit.
   *
   * Gating here rather than server-side is deliberate: it costs no request at all, where returning
   * `{ insight: null }` would still pay one. It does **not** fix the partial case — a section with
   * a score but a missing field still feeds the model a `"no data"` line — because that lives in
   * the prompt, which this component cannot reach. Filed as Q-353.
   */
  hasData: boolean
}

export function AiInsightCard({ section, date, hasData }: Props) {
  const [insight, setInsight] = useState<string | null>(null)
  const [error, setError] = useState(false)

  async function fetchInsight(force = false) {
    const key = `ai-health-insight:${section}:${date}`
    if (!force) {
      const cached = await getCached<string>(key)
      if (cached) { setInsight(cached); return }
    }
    setError(false)
    try {
      const res = await fetch('/api/ai/health-insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section, date, force }),
      })
      if (res.status === 429) return // rate limited — hide silently
      if (!res.ok) throw new Error()
      const data = await res.json()
      setInsight(data.insight ?? null)
      if (data.insight) await setCached(key, data.insight, 6 * 60 * 60) // one insight per section per day-ish
    } catch {
      setError(true)
    }
  }

  // Seed synchronously from cache so a repeat open paints the insight instantly
  // (async getCached always misses the first frame → the old full-card spinner
  // flashed on every Health detail open). Then revalidate. No skeleton: while a
  // first-ever insight loads, render nothing (the card returns null below) rather
  // than a full-card Loader2 — an insight is supplementary, not load-bearing.
  useEffect(() => {
    if (!hasData) return
    const seed = readCacheSync<string>(`ai-health-insight:${section}:${date}`)
    if (seed) setInsight(seed)
    fetchInsight()
  }, [section, date, hasData]) // eslint-disable-line react-hooks/exhaustive-deps

  // Nothing to be insightful about, so render nothing — not an error line and not an empty card.
  // Checked before the error branch: with no fetch there can be no failure to report.
  if (!hasData) return null

  // Distinguish a genuine fetch failure (show an error line) from "nothing to show" —
  // no insight generated (AI declined / insufficient data) or rate-limited (hide silently,
  // by design: a 429 isn't a failure worth alarming the user about).
  if (error && !insight) {
    return (
      <div className="rounded-xl border border-border bg-muted/20 p-4">
        <p className="text-xs text-muted-foreground">Couldn&apos;t load the AI insight.</p>
      </div>
    )
  }
  if (!insight) return null

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-violet-400" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">AI Insight</span>
        </div>
        <button
          onClick={() => fetchInsight(true)}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/40"
          aria-label="Refresh insight"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>
      <p className="text-sm text-foreground/80 leading-relaxed">{insight}</p>
    </div>
  )
}
