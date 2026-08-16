'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Play, Copy, CheckCircle2, XCircle, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { CHANGELOG } from '@trainingai/shared/changelog'
import { getOuraBle, type OuraBlePlugin } from '@/lib/oura-ble/plugin'
import { clearNavSamples, getNavTimingSummary } from '@/lib/perf/nav-timing-recorder'

// Admin data-capture panel. Runs a set of named "probes" — each a self-contained read of
// a server route or a native plugin — wrapped in its OWN try/catch so one failure never
// hides the rest and the exact cause is recorded. The combined result is a copyable JSON
// snapshot the owner can paste back. Probes that need the APK (native BLE) fail gracefully
// off-device with a clear message rather than an empty state.
//
// Extend by adding a probe to PROBES — that's the whole contract.

type ProbeKind = 'server' | 'native' | 'client'
interface Probe {
  id: string
  label: string
  kind: ProbeKind
  run: () => Promise<unknown>
}

interface ProbeResult {
  id: string
  label: string
  kind: ProbeKind
  ok: boolean
  ms: number
  data?: unknown
  error?: string
}

// GET a server route, surfacing the exact failure (status + a body snippet) on !ok.
async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 300)}`)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 200)}`)
  }
}

// Run a native BLE plugin read, or fail with a clear "APK only" message off-device.
async function nativeBle<T>(fn: (p: OuraBlePlugin) => Promise<T>): Promise<T> {
  const got = await getOuraBle()
  if (!got) throw new Error('Native OuraBle plugin unavailable — this capture only works in the APK.')
  return fn(got.plugin)
}

const PROBES: Probe[] = [
  { id: 'version', label: 'App + native APK version (why the update card says what it says)', kind: 'server', run: () => getJson('/api/version') },
  { id: 'hr-profile', label: 'HR profile (observed + estimated max)', kind: 'server', run: () => getJson('/api/hr-profile') },
  { id: 'health-trends', label: 'Health trends (RHR / HRR1 / HRV series)', kind: 'server', run: () => getJson('/api/health/trends') },
  { id: 'readiness', label: 'Readiness score', kind: 'server', run: () => getJson('/api/readiness-score') },
  { id: 'running-plan', label: 'Running plan + zone targets', kind: 'server', run: () => getJson('/api/running-plan') },
  { id: 'ble-freshness', label: 'Oura BLE freshness', kind: 'server', run: () => getJson('/api/oura-ble/freshness') },
  { id: 'ble-device-metrics', label: 'Oura BLE device metrics (admin)', kind: 'server', run: () => getJson('/api/oura-ble/device-metrics') },
  { id: 'ble-status', label: 'BLE plugin status (native)', kind: 'native', run: () => nativeBle((p) => p.getStatus()) },
  { id: 'ble-has-key', label: 'BLE key present (native)', kind: 'native', run: () => nativeBle((p) => p.hasKey()) },
  { id: 'ble-log', label: 'BLE service log tail (native)', kind: 'native', run: () => nativeBle((p) => p.getLog()) },
  { id: 'nav-timing', label: 'Navigation timing (this device, since last clear)', kind: 'client', run: async () => getNavTimingSummary() },
]

async function runProbe(probe: Probe): Promise<ProbeResult> {
  const start = Date.now()
  try {
    const data = await probe.run()
    return { id: probe.id, label: probe.label, kind: probe.kind, ok: true, ms: Date.now() - start, data }
  } catch (e) {
    return {
      id: probe.id, label: probe.label, kind: probe.kind, ok: false, ms: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export function DataCaptureConsole() {
  const [results, setResults] = useState<Record<string, ProbeResult | 'running'>>({})
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const runOne = useCallback(async (probe: Probe) => {
    setResults((r) => ({ ...r, [probe.id]: 'running' }))
    const res = await runProbe(probe)
    setResults((r) => ({ ...r, [probe.id]: res }))
    return res
  }, [])

  const runAll = useCallback(async () => {
    setRunning(true)
    setSnapshot(null)
    try {
      const out: ProbeResult[] = []
      for (const probe of PROBES) out.push(await runOne(probe))
      const snap = {
        capturedAt: new Date().toISOString(),
        appVersion: CHANGELOG[0]?.version ?? 'unknown',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a',
        results: out,
      }
      setSnapshot(JSON.stringify(snap, null, 2))
    } finally {
      setRunning(false)
    }
  }, [runOne])

  // Navigation timings accumulate across app versions, so a before/after comparison
  // needs an explicit zero point — hence a reset that is separate from Run all.
  const clearNav = useCallback(() => {
    clearNavSamples()
    setResults((r) => {
      const next = { ...r }
      delete next['nav-timing']
      return next
    })
    toast.success('Navigation timings cleared — navigate around, then Run all')
  }, [])

  const copy = useCallback(async () => {
    if (!snapshot) return
    try {
      await navigator.clipboard.writeText(snapshot)
      toast.success('Capture JSON copied')
    } catch {
      toast.error('Clipboard unavailable — select the JSON and copy manually')
    }
  }, [snapshot])

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--card)' }}>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold">Device data capture</h2>
        <Button size="sm" variant="ghost" className="ml-auto h-7 px-2 text-[11px]" onClick={clearNav}>
          <Trash2 className="mr-1 h-3.5 w-3.5" /> Reset nav timings
        </Button>
        <Button size="sm" onClick={runAll} disabled={running}>
          {running ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
          Run all
        </Button>
      </div>
      <p className="mb-3 text-xs text-[color:var(--muted-foreground)]">
        Each probe reads a route or the native BLE plugin independently — one failure never hides the
        rest, and the exact error is recorded. Native probes only return data inside the APK.
      </p>

      <ul className="space-y-1.5">
        {PROBES.map((probe) => {
          const r = results[probe.id]
          return (
            <li key={probe.id} className="flex items-center gap-2 text-[13px]">
              <StatusIcon r={r} />
              <span className="min-w-0 flex-1 truncate">
                {probe.label}
                {probe.kind === 'native' && <span className="ml-1 text-[10px] text-[color:var(--muted-foreground)]">APK</span>}
                {probe.kind === 'client' && <span className="ml-1 text-[10px] text-[color:var(--muted-foreground)]">on-device</span>}
              </span>
              {r && r !== 'running' && !r.ok && (
                <span className="max-w-[45%] truncate text-[11px] text-red-600 dark:text-red-400" title={r.error}>{r.error}</span>
              )}
              {r && r !== 'running' && (
                <span className="shrink-0 text-[10px] tabular-nums text-[color:var(--muted-foreground)]">{r.ms}ms</span>
              )}
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => runOne(probe)} disabled={r === 'running'}>
                run
              </Button>
            </li>
          )
        })}
      </ul>

      {snapshot && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-xs font-medium">Capture JSON</span>
            <Button size="sm" variant="outline" className="ml-auto h-7" onClick={copy}>
              <Copy className="mr-1 h-3.5 w-3.5" /> Copy
            </Button>
          </div>
          <pre className="max-h-72 overflow-auto rounded-lg border p-2 text-[10px] leading-tight" style={{ borderColor: 'var(--border)', background: 'var(--muted)' }}>
            {snapshot}
          </pre>
        </div>
      )}
    </div>
  )
}

function StatusIcon({ r }: { r: ProbeResult | 'running' | undefined }) {
  const cls = 'h-4 w-4 shrink-0'
  if (r === 'running') return <Loader2 className={`${cls} animate-spin text-[color:var(--muted-foreground)]`} aria-label="running" />
  if (!r) return <span className={`${cls} rounded-full border`} style={{ borderColor: 'var(--border)' }} aria-label="not run" />
  if (r.ok) return <CheckCircle2 className={`${cls} text-emerald-600 dark:text-emerald-400`} aria-label="ok" />
  return <XCircle className={`${cls} text-red-600 dark:text-red-400`} aria-label="failed" />
}
