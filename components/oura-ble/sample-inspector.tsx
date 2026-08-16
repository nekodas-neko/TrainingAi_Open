'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'

export interface LatestSample {
  tag: number
  eventName: string
  measuredAt: string | null
  decoded: Record<string, unknown> | null
  bodyHex: string
}

function tagHex(tag: number): string {
  return `0x${tag.toString(16).padStart(2, '0')}`
}

function fmt(iso: string | null): string {
  if (!iso) return 'no timestamp'
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// One expandable row per event type showing the decoded JSON — the "what exactly
// are we pulling off the ring" view. Undecoded tags (decoded === null) are the
// visible decoder TODOs.
function Row({ s }: { s: LatestSample }) {
  const [open, setOpen] = useState(false)
  const undecoded = s.decoded === null
  const label = s.eventName === 'unknown' ? `unknown_${tagHex(s.tag)}` : s.eventName
  return (
    <div className={`rounded-md border ${undecoded ? 'border-amber-500/40 bg-amber-500/5' : 'border-border'}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        {undecoded && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
        <span className="font-mono">{label}</span>
        <span className="ml-auto shrink-0 text-muted-foreground">{fmt(s.measuredAt)}</span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-border/60 px-3 py-2">
          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-foreground">
            {s.decoded ? JSON.stringify(s.decoded, null, 2) : '(no decoder — raw hex archived, add a decoder + Redecode)'}
          </pre>
          <div className="overflow-x-auto break-all font-mono text-[10px] text-muted-foreground">
            {tagHex(s.tag)} · {s.bodyHex.slice(0, 96)}{s.bodyHex.length > 96 ? '…' : ''}
          </div>
        </div>
      )}
    </div>
  )
}

export function SampleInspector({ samples }: { samples: LatestSample[] }) {
  const [expanded, setExpanded] = useState(false)
  if (samples.length === 0) return null

  // Undecoded tags first (they're the actionable ones), then by tag.
  const sorted = [...samples].sort((a, b) => {
    const au = a.decoded === null ? 0 : 1
    const bu = b.decoded === null ? 0 : 1
    return au - bu || a.tag - b.tag
  })
  const undecodedCount = sorted.filter((s) => s.decoded === null).length

  return (
    <section className="space-y-2 rounded-md border border-border p-4">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 text-sm font-medium"
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Decoded fields
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          {sorted.length} types{undecodedCount > 0 ? ` · ${undecodedCount} undecoded` : ''}
        </span>
      </button>
      {expanded && (
        <div className="space-y-1.5">
          {sorted.map((s) => <Row key={s.tag} s={s} />)}
        </div>
      )}
    </section>
  )
}
