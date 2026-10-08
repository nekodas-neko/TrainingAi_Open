'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { HeartPulse } from 'lucide-react'
import { driveHrBackfill, type BackfillPass } from '@/lib/admin/hr-backfill-driver'

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
    try {
      // Issue 2383: paced under the route's 6-a-minute limit, and a 429 that still arrives waits and
      // resumes rather than ending the run (lib/admin/hr-backfill-driver.ts).
      const outcome = await driveHrBackfill({
        sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
        now: () => Date.now(),
        onProgress: ({ processed, withData, waitingMs }) => {
          const base = `Backfilling… ${processed} sessions (${withData} with HR)`
          setMsg(waitingMs == null ? base : `${base}. Pausing ${Math.ceil(waitingMs / 1000)} s to stay under the rate limit.`)
        },
        runPass: async () => {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ maxRows }),
          })
          if (res.status === 429) return { kind: 'rate-limited' }
          if (!res.ok) return { kind: 'failed', message: `Backfill failed: HTTP ${res.status}` }
          return { kind: 'ok', pass: await res.json() as BackfillPass }
        },
      })
      setMsg(outcome.kind === 'done'
        ? `Done — ${outcome.processed} sessions processed, ${outcome.withData} had HR data.`
        : `${outcome.message} (${outcome.processed} sessions processed so far.)`)
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
