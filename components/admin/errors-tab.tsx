'use client'

import { useEffect, useState } from 'react'
import { EmptyState } from '@/components/ui/empty-state'

interface ErrorEvent {
  id: string
  source: string
  message: string
  stack: string | null
  url: string | null
  userAgent: string | null
  createdAt: string
  userEmail: string | null
}

export default function ErrorsTab() {
  const [events, setEvents] = useState<ErrorEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  // #3951: error events are the owner's to read. Another admin is refused (403), and a failed load is
  // a failure: neither may read as "No errors recorded".
  const [failure, setFailure] = useState<'owner-only' | 'failed' | null>(null)

  useEffect(() => {
    fetch('/api/admin/errors')
      .then(async r => {
        if (r.status === 403) { setFailure('owner-only'); return }
        if (!r.ok) { setFailure('failed'); return }
        const d = await r.json()
        setEvents(Array.isArray(d) ? d : [])
      })
      .catch(() => setFailure('failed'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2].map(i => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
      </div>
    )
  }

  if (failure === 'owner-only') return <EmptyState title="Only the owner can see error events." />
  if (failure === 'failed') return <EmptyState title="Could not load error events." />

  if (events.length === 0) {
    return <p className="text-center text-muted-foreground py-8">No errors recorded — nice.</p>
  }

  return (
    <div className="space-y-3">
      {events.map(e => {
        const isExpanded = expanded === e.id
        return (
          <div key={e.id} className="rounded-xl border border-border bg-muted/40 overflow-hidden">
            <button
              type="button"
              aria-expanded={isExpanded}
              className="w-full text-left px-4 py-3 flex items-start gap-3"
              onClick={() => setExpanded(isExpanded ? null : e.id)}
            >
              <span
                className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                style={e.source === 'server'
                  ? { background: "color-mix(in oklch, var(--destructive) 15%, transparent)", color: "var(--destructive)" }
                  : { background: "color-mix(in oklch, var(--accent-amber) 15%, transparent)", color: "var(--accent-amber)" }}
              >
                {e.source}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{e.message}</p>
                <p className="text-[10px] text-muted-foreground">
                  {new Date(e.createdAt).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' })}
                  {e.userEmail && <> · {e.userEmail}</>}
                </p>
              </div>
            </button>
            {isExpanded && (e.stack || e.url) && (
              <div className="px-4 pb-4 space-y-2 border-t border-border/50 pt-3">
                {e.url && <p className="text-xs text-muted-foreground break-all">{e.url}</p>}
                {e.stack && (
                  <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
                    {e.stack}
                  </pre>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
