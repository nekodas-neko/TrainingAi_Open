'use client'
import { useEffect, useState } from 'react'
import { SparklesIcon } from 'lucide-react'
import { splitStreamError } from '@/lib/ai/stream'
import { readCacheSync, setCached } from '@/lib/sqlite/cache'
import { TTL_LONG } from '@trainingai/shared/cache-ttl'

function cacheKey(sessionId: string) {
  return `session-explain-insight:${sessionId}`
}

export function AiInsightCard({ sessionId }: { sessionId: string }) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)

  // Synchronous cache seed: paint last-known narrative before the stream lands.
  // Seeded in an effect (not a useState initializer) to avoid hydration drift.
  useEffect(() => {
    const seed = readCacheSync<string>(cacheKey(sessionId))
    if (seed) { setText(seed); setLoading(false) }
  }, [sessionId])

  useEffect(() => {
    let cancelled = false
    async function fetchInsight() {
      try {
        const res = await fetch(`/api/session-explain/insight?sessionId=${encodeURIComponent(sessionId)}`)
        if (!res.ok || !res.body) { setLoading(false); return }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let full = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done || cancelled) break
          full += decoder.decode(value, { stream: true })
          const { text: clean, errored: hasError } = splitStreamError(full)
          setText(clean)
          if (hasError) setErrored(true)
        }
        const { text: finalClean, errored: finalError } = splitStreamError(full)
        if (!cancelled && finalClean && !finalError) {
          void setCached(cacheKey(sessionId), finalClean, TTL_LONG)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchInsight()
    return () => { cancelled = true }
  }, [sessionId])

  return (
    <div
      className="rounded-xl border border-amber-500/30 p-4 space-y-2"
      style={{ background: 'color-mix(in oklch, rgba(245,158,11,0.08), transparent)' }}
    >
      <div className="flex items-center gap-2">
        <SparklesIcon className="h-4 w-4 text-amber-400" />
        <p className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Why this session</p>
      </div>
      {loading && !text ? (
        <div className="space-y-2 animate-pulse">
          <div className="h-3 rounded bg-amber-500/20 w-full" />
          <div className="h-3 rounded bg-amber-500/20 w-4/5" />
          <div className="h-3 rounded bg-amber-500/20 w-3/5" />
        </div>
      ) : (
        <p className="text-sm leading-relaxed">{text || 'No insight available.'}</p>
      )}
      {errored && (
        <p className="text-xs text-destructive">The insight was cut short — check your connection and reopen this page to retry.</p>
      )}
    </div>
  )
}
