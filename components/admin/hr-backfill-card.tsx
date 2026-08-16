'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { HeartPulse } from 'lucide-react'

// Shared driver for the two HR-snapshot backfills. Both routes have the same contract — admin-only,
// bounded, oldest-first, `{ processed, withData, remaining }` — so they get one component rather
// than a second copy of the pass loop.
//
// Both are additive and idempotent: they read the same live HR series the recap reads and persist
// the rows (fuller-wins upsert gated on readings_count), mutating no source data.
export function HrBackfillCard({
  endpoint,
  maxRows,
  title,
  description,
}: {
  endpoint: string
  maxRows: number
  title: string
  description: React.ReactNode
}) {
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function run() {
    setRunning(true)
    setMsg('Backfilling…')
    let totalProcessed = 0
    let totalWithData = 0
    try {
      // Drain oldest-first across bounded passes; cap iterations as a runaway backstop.
      for (let pass = 0; pass < 100; pass++) {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ maxRows }),
        })
        if (!res.ok) { setMsg(`Backfill failed: HTTP ${res.status}`); return }
        const j = await res.json() as { processed: number; withData: number; remaining: boolean }
        totalProcessed += j.processed
        totalWithData += j.withData
        setMsg(`Backfilling… ${totalProcessed} sessions (${totalWithData} with HR)`)
        if (!j.remaining) break
      }
      setMsg(`Done — ${totalProcessed} sessions processed, ${totalWithData} had HR data.`)
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <HeartPulse className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{title}</span>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
      <Button size="sm" variant="outline" disabled={running} onClick={() => void run()}>
        {running ? 'Backfilling…' : 'Run backfill'}
      </Button>
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </div>
  )
}
