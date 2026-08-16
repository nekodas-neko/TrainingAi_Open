'use client'
import { useEffect, useRef, useState } from 'react'
import { HeartPulse, Play, Square, Activity } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getLiveHrManager } from '@/lib/live-hr/manager'
import { allBeatsFromFrames } from '@/lib/live-hr/decode-live-hr'
import { median } from '@trainingai/shared/health/hr-smoothing'
import type { LiveHrCurrent, LiveHrDiagnostics } from '@/lib/live-hr/types'

interface Reading {
  bpm: number
  at: number
  /** bpm change from the previous surfaced reading — a smooth feed keeps this small. */
  delta: number
}

const MAX_LOG = 24

function ageSec(at: number | null, now: number): string {
  if (at == null) return '—'
  return `${((now - at) / 1000).toFixed(1)}s ago`
}

// Admin-only console to verify the live-HR smoothing on-device. Surfaces the manager's
// diagnostics (frames/HR-frames/decodes), the current SMOOTHED bpm, the raw within-batch
// beat spread the median smooths over, and a rolling log of surfaced readings so a spiky
// feed is visible at a glance. Inert on web (no ring frames) — real signal is APK-only.
export function LiveHrTestConsole() {
  const [running, setRunning] = useState(false)
  const [current, setCurrent] = useState<LiveHrCurrent>({ bpm: null, at: null, sourceId: null })
  const [diag, setDiag] = useState<LiveHrDiagnostics | null>(null)
  const [log, setLog] = useState<Reading[]>([])
  const [now, setNow] = useState(() => 0)
  const startedByUs = useRef(false)
  const lastReading = useRef<{ bpm: number; at: number } | null>(null)

  // Poll the manager once running. 1 Hz is plenty for a diagnostics view and keeps this
  // off any hot render path. Delta is computed against a ref (not `log`) so the interval
  // isn't torn down and recreated on every appended reading.
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      const mgr = getLiveHrManager()
      const cur = mgr.getCurrent()
      setCurrent(cur)
      setDiag(mgr.getDiagnostics())
      setNow(Date.now())
      if (cur.bpm != null && cur.at != null && cur.at !== lastReading.current?.at) {
        const delta = lastReading.current ? cur.bpm - lastReading.current.bpm : 0
        lastReading.current = { bpm: cur.bpm, at: cur.at }
        setLog(l => [...l, { bpm: cur.bpm as number, at: cur.at as number, delta }].slice(-MAX_LOG))
      }
    }, 1000)
    return () => clearInterval(id)
  }, [running])

  async function start() {
    const mgr = getLiveHrManager()
    if (mgr.activeSourceId() == null) { startedByUs.current = true; await mgr.start().catch(() => {}) }
    mgr.setForced(true)
    setRunning(true)
  }

  async function stop() {
    setRunning(false)
    if (startedByUs.current) { await getLiveHrManager().stop().catch(() => {}); startedByUs.current = false }
    lastReading.current = null
  }

  // Cleanup if unmounted while running.
  useEffect(() => () => { if (startedByUs.current) getLiveHrManager().stop().catch(() => {}) }, [])

  const beats = diag ? allBeatsFromFrames(diag.sampleHexes) : []
  const spread = beats.length
    ? { count: beats.length, min: Math.min(...beats), max: Math.max(...beats), med: median(beats) }
    : null
  const surfaced = current.bpm
  const stale = current.at != null && now > 0 && now - current.at >= 8_000
  const noFrames = running && diag != null && diag.framesSeen === 0

  return (
    <section className="space-y-3 rounded-md border border-border p-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <HeartPulse className="h-4 w-4" /> Live HR test console
        </h2>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{
            color: current.sourceId ? 'var(--color-brand)' : 'var(--color-muted-foreground)',
            background: 'color-mix(in oklch, var(--color-brand) 12%, transparent)',
          }}
        >
          {diag?.connectionState ?? (running ? 'starting…' : 'stopped')}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        Verifies the beat-median smoothing: the big number is the <strong>surfaced median</strong>;
        the spread row shows the raw beats it was chosen from. A steady feed keeps the log deltas small.
      </p>

      <div className="flex flex-wrap gap-2">
        {!running ? (
          <Button size="sm" onClick={start}><Play className="mr-1 h-4 w-4" /> Start</Button>
        ) : (
          <Button size="sm" variant="outline" onClick={stop}><Square className="mr-1 h-4 w-4" /> Stop</Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={!running}
          onClick={() => getLiveHrManager().measureNow().catch(() => {})}
        >
          <Activity className="mr-1 h-4 w-4" /> Measure now
        </Button>
      </div>

      {noFrames && (
        <p className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          No ring frames in this environment. This console is live only on the APK with a connected
          ring — on web/dev the source is inert by design.
        </p>
      )}

      {/* Big surfaced value */}
      <div className="flex items-baseline gap-2">
        <span
          className={`text-4xl font-bold leading-none tabular-nums ${stale ? 'opacity-40' : ''}`}
          style={{ color: 'var(--color-brand)' }}
        >
          {surfaced ?? '—'}
        </span>
        <span className="text-xs font-medium text-muted-foreground">bpm surfaced (median)</span>
        {stale && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">stale</span>}
      </div>

      {/* Diagnostics counters */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Frames seen</dt>
        <dd className="tabular-nums">{diag?.framesSeen ?? '—'}</dd>
        <dt className="text-muted-foreground">HR frames</dt>
        <dd className="tabular-nums">{diag?.hrFramesSeen ?? '—'}</dd>
        <dt className="text-muted-foreground">Decode hits</dt>
        <dd className="tabular-nums">{diag?.decodeHits ?? '—'}</dd>
        <dt className="text-muted-foreground">Last decoded bpm</dt>
        <dd className="tabular-nums">{diag?.lastBpm ?? '—'} <span className="text-muted-foreground">({ageSec(diag?.lastBpmAt ?? null, now)})</span></dd>
      </dl>

      {/* Raw within-batch spread → the whole point of the fix */}
      <div className="rounded-md border border-border bg-muted/20 p-3 text-xs">
        <p className="mb-1 font-medium">Recent batch spread (raw beats)</p>
        {spread ? (
          <p className="tabular-nums text-muted-foreground">
            {spread.count} beats · min <span className="text-foreground">{spread.min}</span> · median{' '}
            <span className="text-foreground">{spread.med}</span> · max <span className="text-foreground">{spread.max}</span>
            <br />
            <span className="text-muted-foreground">
              range {spread.max - spread.min} bpm — surfaced value is the median, not the newest/outlier
            </span>
          </p>
        ) : (
          <p className="text-muted-foreground">No HR frames captured yet.</p>
        )}
      </div>

      {/* Tag histogram */}
      {diag && Object.keys(diag.tagCounts).length > 0 && (
        <div className="text-xs">
          <p className="mb-1 font-medium">Frame tags</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(diag.tagCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([tag, n]) => (
                <span key={tag} className="rounded bg-muted px-1.5 py-0.5 font-mono tabular-nums text-muted-foreground">
                  {tag}:{n}
                </span>
              ))}
          </div>
        </div>
      )}

      {/* Rolling surfaced-reading log — eyeball smoothness via the deltas */}
      {log.length > 0 && (
        <div className="text-xs">
          <p className="mb-1 font-medium">Surfaced readings (newest last)</p>
          <div className="max-h-40 overflow-y-auto rounded-md border border-border">
            <table className="w-full text-left tabular-nums">
              <tbody>
                {log.map((r, i) => (
                  <tr key={r.at} className={i % 2 ? 'bg-muted/20' : ''}>
                    <td className="px-2 py-0.5 font-semibold" style={{ color: 'var(--color-brand)' }}>{r.bpm}</td>
                    <td className="px-2 py-0.5 text-muted-foreground">
                      {r.delta === 0 ? '±0' : r.delta > 0 ? `+${r.delta}` : r.delta}
                    </td>
                    <td className="px-2 py-0.5 text-right text-muted-foreground">{ageSec(r.at, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}
