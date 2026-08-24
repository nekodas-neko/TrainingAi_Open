'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity, Battery, Bluetooth, BluetoothOff, Cloud, Droplet, Footprints,
  HeartPulse, History, KeyRound, Moon, Play, RefreshCw, ScrollText, Square,
  Thermometer, Waves, Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { getOuraBle, type OuraBlePlugin, type OuraBleStatus, type OuraFrameEvent } from '@/lib/oura-ble/plugin'
import { invalidateOuraSync } from '@/lib/cache-groups'
import { frameLabel, historyEventFromHex } from '@/lib/oura-ble/decode'
import { LogConsole } from './log-console'
import { SampleInspector, type LatestSample } from './sample-inspector'
import { StepCalibration } from './step-calibration'
import { LiveStepTest } from './live-step-test'
import { BatterySoakTest } from './battery-soak-test'
import { ContinuousCaptureCard } from './continuous-capture-card'
import { DbFootprintCard } from './db-footprint-card'
import { DeviceMetricsPanel } from './device-metrics-panel'

type Availability = 'checking' | 'unavailable' | 'ready'

type DebugNight = {
  date: string; windowStart: string; windowEnd: string; settleHr: number | null; onsetEpoch: number
  epochs: { epoch: number; time: string; hr: number | null; beats: number; movement: number | null; hrv: number | null; hrVar: number | null; breathVar: number | null; lfhf: number | null; spo2Var: number | null; stage: string }[]
}

interface MetricTiming {
  latestAt: string | null
  cadenceSec: number | null
  count: number
}

interface RecordedSummary {
  totalEvents: number
  byEventName: { tag: number; eventName: string; count: number }[]
  latestHrBpm: number | null
  latestTempC: number | null
  latestHrvRmssd: number | null
  latestSpo2: { pct: number; calibrated: boolean } | null
  latestByTag: LatestSample[]
  newestRecordedAt: string | null
  clockAnchorDs: number | null
  clockAnchorUtc: string | null
  oldestMeasuredAt: string | null
  newestMeasuredAt: string | null
  hrTiming: MetricTiming
  tempTiming: MetricTiming
}

function eventLabel(tag: number, eventName: string): string {
  return eventName === 'unknown' ? `unknown_0x${tag.toString(16).padStart(2, '0')}` : eventName.replace(/_event$/, '')
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtCadence(sec: number | null): string {
  if (sec == null) return '—'
  if (sec < 90) return `~${sec}s`
  if (sec < 5400) return `~${Math.round(sec / 60)}m`
  return `~${(sec / 3600).toFixed(1)}h`
}

const HISTORY_EVENT_PREFIX = 0x41
const SERVER_FLUSH_MS = 2500

function statusTone(state: string | undefined): string {
  if (state === 'ready') return 'bg-primary/15 text-primary'
  if (state === 'disconnected' || state === 'closed') return 'bg-destructive/15 text-destructive'
  if (!state || state === 'idle' || state === 'stopped') return 'bg-muted text-muted-foreground'
  return 'bg-muted text-foreground' // scanning / connecting / preparing / authenticating
}

export function OuraBleDebug() {
  const pluginRef = useRef<OuraBlePlugin | null>(null)
  const [availability, setAvailability] = useState<Availability>('checking')
  const [hasKey, setHasKey] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  // The revealed key, held only while the section is open. Never persisted, never seeded from
  // cache, and cleared on hide — a credential that survives a re-render is one more copy to lose
  // track of, and the point of this affordance is to make the copy the owner keeps deliberate.
  const [revealedKey, setRevealedKey] = useState<string | null>(null)
  const [keyCopied, setKeyCopied] = useState(false)
  const [status, setStatus] = useState<OuraBleStatus | null>(null)
  const [lines, setLines] = useState<string[]>([])
  // Q-357: `LogConsole` is `memo()`, and this console appends a line per BLE frame — so an inline
  // arrow here re-rendered the whole log on every frame, which is the one screen where that is
  // measurable.
  const clearLines = useCallback(() => setLines([]), [])
  const [tagCounts, setTagCounts] = useState<Record<string, number>>({})
  const [summary, setSummary] = useState<RecordedSummary | null>(null)
  const [sent, setSent] = useState({ frames: 0, stored: 0 })
  const [pendingCount, setPendingCount] = useState(0)
  const [showAllEvents, setShowAllEvents] = useState(false)
  const [batteryExempt, setBatteryExempt] = useState<boolean | null>(null)
  const pendingLines = useRef<string[]>([])
  // History-event frames awaiting a confirmed POST. Each carries its ring
  // deciseconds timestamp so we can advance the durable resume cursor only after
  // the server stores them (confirmStored), and re-queue on failure.
  const pendingFrames = useRef<{ hex: string; ds: number }[]>([])
  const flushing = useRef(false)
  // True when the APK's service ingests natively (POSTs + confirms the cursor
  // itself — detected by the native-ingest status fields). The JS forwarding loop
  // below then stays OFF: it exists only as the legacy path for older APKs.
  const nativeIngest = useRef(false)

  const refreshSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/oura-ble/samples/summary')
      if (res.ok) setSummary(await res.json())
    } catch { /* tester screen — ignore transient errors */ }
  }, [])

  useEffect(() => {
    let cancelled = false
    const handles: Array<{ remove: () => Promise<void> }> = []
    ;(async () => {
      const ref = await getOuraBle()
      if (cancelled) return
      if (!ref) { setAvailability('unavailable'); return }
      const plugin = ref.plugin
      pluginRef.current = plugin
      setAvailability('ready')
      setHasKey((await plugin.hasKey()).hasKey)
      const s = await plugin.getStatus()
      if ('battery' in s) { setStatus(s); nativeIngest.current = s.ingestPosted != null }
      const { lines: existing } = await plugin.getLog()
      setLines(existing)
      try { setBatteryExempt((await plugin.isBatteryExempt()).exempt) }
      catch { /* older APK without the method — leave null (hidden) */ }
      handles.push(await plugin.addListener('ouraLog', ({ line }) => { pendingLines.current.push(line) }))
      handles.push(await plugin.addListener('ouraStatus', (st) => {
        setStatus(st)
        nativeIngest.current = st.ingestPosted != null
      }))
      const applyFrames = (frames: OuraFrameEvent[]) => {
        // One state update per batch (not per frame — review BLE-7).
        setTagCounts((prev) => {
          const next = { ...prev }
          for (const f of frames) {
            const key = frameLabel(f.tag, f.subOp)
            next[key] = (next[key] ?? 0) + 1
          }
          return next
        })
        // Legacy path only (older APKs without native ingest): buffer history-event
        // frames (tag >= 0x41) for the JS forwarding loop. On native-ingest APKs the
        // service uploads + confirms itself and these events are display-only.
        if (!nativeIngest.current) {
          for (const f of frames) {
            if (f.tag >= HISTORY_EVENT_PREFIX && f.hex) {
              const ev = historyEventFromHex(f.hex)
              pendingFrames.current.push({ hex: f.hex, ds: ev?.timestampDs ?? 0 })
            }
          }
        }
      }
      // Older APKs emit one ouraFrame per frame; native-ingest APKs batch into ouraFrames.
      handles.push(await plugin.addListener('ouraFrame', (f: OuraFrameEvent) => applyFrames([f])))
      handles.push(await plugin.addListener('ouraFrames', ({ frames }) => applyFrames(frames)))
      void refreshSummary()
    })()

    const logFlush = setInterval(() => {
      if (pendingLines.current.length === 0) return
      const batch = pendingLines.current
      pendingLines.current = []
      setLines((prev) => [...prev, ...batch].slice(-500))
    }, 250)

    // Forward buffered history-event frames to the server, oldest ring-timestamp
    // first, and only advance the ring's durable resume cursor (confirmStored)
    // AFTER the server persists them. Frames are removed from the buffer only on a
    // confirmed 2xx — a failed/interrupted POST leaves them queued to retry, so the
    // resume cursor never outruns what's actually stored (the data-loss bug). The
    // flushing guard prevents overlapping posts from double-sending the same slice.
    const serverFlush = setInterval(async () => {
      if (nativeIngest.current || flushing.current || pendingFrames.current.length === 0) return
      flushing.current = true
      try {
        // Sort ascending by ring timestamp so we POST — and confirm — contiguously.
        pendingFrames.current.sort((a, b) => a.ds - b.ds)
        const batch = pendingFrames.current.slice(0, 500) // copy; not yet removed
        const res = await fetch('/api/oura-ble/samples', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ frames: batch.map(({ hex }) => ({ hex })) }),
        })
        if (res.ok) {
          const j = await res.json()
          pendingFrames.current.splice(0, batch.length) // drop only what's now stored
          const maxDs = batch.reduce((m, f) => Math.max(m, f.ds), 0)
          if (maxDs > 0) await pluginRef.current?.confirmStored({ ds: maxDs })
          setSent((p) => ({ frames: p.frames + batch.length, stored: p.stored + (j.stored ?? 0) }))
          void refreshSummary()
        }
      } catch { /* leave the batch queued — next tick retries; cursor stays put */ }
      finally {
        setPendingCount(pendingFrames.current.length)
        flushing.current = false
      }
    }, SERVER_FLUSH_MS)

    return () => {
      cancelled = true
      clearInterval(logFlush)
      clearInterval(serverFlush)
      handles.forEach((h) => { void h.remove() })
    }
  }, [refreshSummary])

  const withPlugin = useCallback(async (fn: (p: OuraBlePlugin) => Promise<unknown>) => {
    const p = pluginRef.current
    if (!p) return
    try { await fn(p) } catch (err) {
      setLines((prev) => [...prev, `ui error: ${err instanceof Error ? err.message : String(err)}`])
    }
  }, [])

  const revealKey = useCallback(() => withPlugin(async (p) => {
    // An APK built before `revealKey` existed rejects with a Capacitor "not implemented" error
    // rather than something recognisable, so the message says what to do about it. This console
    // is the one screen where an older APK is a plausible thing to be holding.
    try {
      setRevealedKey((await p.revealKey()).hex)
      setKeyCopied(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setLines((prev) => [...prev, msg.includes('no key stored')
        ? 'reveal key: no key stored on this device'
        : `reveal key: unavailable (${msg}) — this needs an APK built after 2026-08-23`])
    }
  }), [withPlugin])

  const copyKey = useCallback(async () => {
    if (!revealedKey) return
    try {
      await navigator.clipboard.writeText(revealedKey)
      setKeyCopied(true)
    } catch {
      // Clipboard can be refused outright in a WebView; the key is on screen either way, which
      // is what actually makes the backup possible.
      setLines((prev) => [...prev, 'copy key: clipboard refused — select the text above instead'])
    }
  }, [revealedKey])

  const hideKey = useCallback(() => { setRevealedKey(null); setKeyCopied(false) }, [])

  const syncNow = useCallback(() => withPlugin(async (p) => {
    if ((status?.state ?? 'stopped') === 'stopped') {
      const { granted } = await p.ensurePermissions()
      if (granted) await p.startService()
    }
    await p.drainHistory()
  }), [withPlugin, status?.state])

  const requestBatteryOpt = useCallback(() => withPlugin(async (p) => {
    await p.requestBatteryExemption()
    // The system dialog is async/out-of-process; re-read shortly after.
    setTimeout(async () => { try { setBatteryExempt((await p.isBatteryExempt()).exempt) } catch { /* ignore */ } }, 800)
  }), [withPlugin])

  // Full re-sync: re-pull the ring's entire buffer from cursor 0 (recovery after
  // dropped data). Safe to repeat — the server dedups. Keep the screen open until
  // "pending" reaches 0 so every frame is forwarded + confirmed.
  const fullResync = useCallback(() => withPlugin(async (p) => {
    if ((status?.state ?? 'stopped') === 'stopped') {
      const { granted } = await p.ensurePermissions()
      if (granted) await p.startService()
    }
    await p.drainHistory({ fromZero: true })
  }), [withPlugin, status?.state])

  // Redecode: re-run the server decoders + rollup over all stored raw samples. This is what
  // applies server-side changes (decoders, sleep staging, rollup) to existing data.
  const redecode = useCallback(async () => {
    // Redecode is a full-table rewrite (decode every stored row + re-aggregate). On a large
    // table it can outlast the response, so the body may come back empty/truncated even though
    // the server committed the work — parse defensively and always refresh.
    try {
      const res = await fetch('/api/oura-ble/samples/redecode', { method: 'POST' })
      const text = await res.text().catch(() => '')
      let j: { scanned?: number; updated?: number; error?: string; redecodeError?: string | null; aggregateError?: string | null; aggregated?: { sleepSessions?: number; bodyMetricDays?: number; daysWritten?: string[]; stepErrors?: string[] } } = {}
      try { j = text ? JSON.parse(text) : {} } catch { /* empty/truncated slow response */ }
      const next: string[] = []
      if (res.ok && j.scanned != null) {
        next.push(`redecode: scanned=${j.scanned} updated=${j.updated} · sleep=${j.aggregated?.sleepSessions ?? 0} days=${j.aggregated?.bodyMetricDays ?? 0}`)
        if (j.aggregated?.daysWritten?.length) next.push(`  wrote: ${j.aggregated.daysWritten.join(', ')}`)
        if (j.redecodeError) next.push(`  ⚠ redecode error: ${j.redecodeError}`)
        if (j.aggregateError) next.push(`  ⚠ aggregate error: ${j.aggregateError}`)
        for (const e of j.aggregated?.stepErrors ?? []) next.push(`  ⚠ ${e}`)
      } else if (res.ok) {
        next.push('redecode ran (response was slow to return) — data refreshed')
      } else {
        next.push(`redecode failed: ${j.aggregateError ?? j.redecodeError ?? j.error ?? res.status}`)
      }
      setLines((prev) => [...prev, ...next])
      void refreshSummary()
      void invalidateOuraSync()
    } catch (err) {
      setLines((prev) => [...prev, `redecode: response not received (it may still have run) — ${err instanceof Error ? err.message : String(err)}`])
      void refreshSummary()
      void invalidateOuraSync()
    }
  }, [refreshSummary])

  // HR recording coverage: fetch the newest raw HR events (IBI 0x80/0x60 + always-on 0x86,
  // the same tags the HR rollup consumes), sort by wall clock, and report every gap > 3 min
  // with times. Built to answer "did the ring keep recording HR while accel was streaming?" —
  // a 10–15 min hole is invisible on the small day chart but obvious here. Data reaches the
  // server on drain, so tap Sync now first.
  const hrCoverage = useCallback(async () => {
    try {
      const res = await fetch('/api/oura-ble/samples/raw?tags=80,60,86&limit=1000')
      if (!res.ok) { setLines((prev) => [...prev, `hr coverage failed: ${res.status}`]); return }
      const { rows } = (await res.json()) as { rows: { measuredAt: string | null }[] }
      const times = rows
        .map((r) => (r.measuredAt ? Date.parse(r.measuredAt) : NaN))
        .filter((t) => Number.isFinite(t))
        .sort((a, b) => a - b)
      if (times.length < 2) { setLines((prev) => [...prev, 'hr coverage: not enough HR samples on server — Sync now first?']); return }
      const fmt = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      const spanMin = Math.round((times[times.length - 1] - times[0]) / 60_000)
      const gaps: string[] = []
      for (let i = 1; i < times.length; i++) {
        const gapMin = (times[i] - times[i - 1]) / 60_000
        if (gapMin > 3) gaps.push(`  gap ${gapMin.toFixed(1)}min: ${fmt(times[i - 1])} → ${fmt(times[i])}`)
      }
      setLines((prev) => [
        ...prev,
        `— HR coverage: ${times.length} samples spanning ${fmt(times[0])} → ${fmt(times[times.length - 1])} (${spanMin}min) —`,
        ...(gaps.length > 0 ? [`${gaps.length} gap(s) > 3min:`, ...gaps.slice(-20)] : ['no gaps > 3min — HR recorded continuously ✓']),
      ])
    } catch (err) {
      setLines((prev) => [...prev, `hr coverage error: ${err instanceof Error ? err.message : String(err)}`])
    }
  }, [])

  // Dump all recent step/activity-family frames (0x7e/0x7f/0x50/0x51/0x52) to the log,
  // newest-first, as `<name> ds=<ds> <hex>` lines — the copyable capture for cracking the
  // step count (the inspector only shows the newest frame per tag). Frame dump, not a fetch
  // the card renders, so a bare failure line is fine (no silent card-vanish concern).
  const dumpStepFrames = useCallback(async () => {
    try {
      const res = await fetch('/api/oura-ble/samples/raw?tags=7e,7f,50,51,52&limit=120')
      if (!res.ok) { setLines((prev) => [...prev, `dump failed: ${res.status}`]); return }
      const { rows } = (await res.json()) as {
        rows: { ringTimestampDs: number; tag: number; eventName: string; measuredAt: string | null; bodyHex: string }[]
      }
      const header = `— frame dump: ${rows.length} rows (0x7e/0x7f/0x50/0x51/0x52), newest first —`
      const body = rows.map((r) => {
        const t = r.measuredAt ? new Date(r.measuredAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'
        return `${r.eventName} ds=${r.ringTimestampDs} ${t} ${r.bodyHex}`
      })
      setLines((prev) => [...prev, header, ...body])
    } catch (err) {
      setLines((prev) => [...prev, `dump error: ${err instanceof Error ? err.message : String(err)}`])
    }
  }, [])

  // Dump all recent sleep-family frames to the log, newest-first. Answers the Phase-0
  // question: does this ring emit ring-computed sleep data over BLE? Tags: sleep summaries
  // 0x49/0x4c/0x4f/0x58
  // (open_health says these carry bedtime/stage-durations/lowest-HR — we decode them but have
  // never confirmed they arrive), the per-epoch hypnogram 0x4b/0x4e/0x5a (session 238 saw zero
  // — re-check on a fresh worn-overnight night), and bedtime_period 0x76. If the summaries are
  // present, their decoded ÷8 fields can be validated against the pre-re-key Oura history and
  // rolled into real stage durations, closing the cycles gap with no model.
  const dumpSleepFrames = useCallback(async () => {
    try {
      const res = await fetch('/api/oura-ble/samples/raw?tags=49,4c,4f,58,4b,4e,5a,76&limit=200')
      if (!res.ok) { setLines((prev) => [...prev, `sleep dump failed: ${res.status}`]); return }
      const { rows } = (await res.json()) as {
        rows: { ringTimestampDs: number; tag: number; eventName: string; measuredAt: string | null; bodyHex: string }[]
      }
      const counts = rows.reduce<Record<string, number>>((acc, r) => { acc[r.eventName] = (acc[r.eventName] ?? 0) + 1; return acc }, {})
      const summary = Object.entries(counts).map(([n, c]) => `${n}×${c}`).join(', ') || 'none'
      const header = `— sleep-frame dump: ${rows.length} rows (${summary}), newest first —`
      const body = rows.map((r) => {
        const t = r.measuredAt ? new Date(r.measuredAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'
        return `${r.eventName} ds=${r.ringTimestampDs} ${t} ${r.bodyHex}`
      })
      setLines((prev) => [...prev, header, ...body])
    } catch (err) {
      setLines((prev) => [...prev, `sleep dump error: ${err instanceof Error ? err.message : String(err)}`])
    }
  }, [])

  // One-tap: drain new events, give them a moment to ingest, then redecode/re-roll. Saves
  // pressing Sync then Redecode separately.
  const syncAndRedecode = useCallback(async () => {
    setLines((prev) => [...prev, 'sync + redecode…'])
    await syncNow()
    await new Promise((r) => setTimeout(r, 4000)) // let the drained frames POST + store
    await redecode()
  }, [syncNow, redecode])

  // Per-epoch staging diagnostic for one BLE night — dumps what the stager saw (HR, beats,
  // movement, HRV, within-epoch spread) and decided per 5-min block, so onset/wake/REM can be
  // tuned against real data (which only exists on-device).
  const [debugDate, setDebugDate] = useState('')
  const sleepEpochs = useCallback(async () => {
    const d = debugDate.trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { setLines((p) => [...p, 'sleep-epochs: enter a date as YYYY-MM-DD']); return }
    setLines((p) => [...p, `sleep-epochs ${d}: computing…`])
    try {
      const res = await fetch(`/api/oura-ble/samples/redecode?date=${encodeURIComponent(d)}&dump=1`, { method: 'POST' })
      const text = await res.text().catch(() => '')
      let j: { aggregated?: { debugNight?: DebugNight | null } } = {}
      try { j = text ? JSON.parse(text) : {} } catch { /* slow/truncated response */ }
      const n = j.aggregated?.debugNight
      if (!n) { setLines((p) => [...p, `sleep-epochs ${d}: no BLE night for that date (Cloud night or no data)`]); return }
      const c = (v: number | null, w: number) => (v == null ? '—' : String(v)).padStart(w)
      setLines((p) => [...p,
        `sleep-epochs ${n.date} · window ${n.windowStart}–${n.windowEnd} · settleHr=${n.settleHr ?? '—'} · onsetEpoch=${n.onsetEpoch}`,
        '   t     hr beats  mv  hrv hrVar brVar  lfhf spo2V stage',
        ...n.epochs.map((e) => `  ${e.time} ${c(e.hr, 3)} ${c(e.beats, 5)} ${c(e.movement, 4)} ${c(e.hrv, 4)} ${c(e.hrVar, 5)} ${c(e.breathVar, 5)} ${c(e.lfhf, 5)} ${c(e.spo2Var, 5)} ${e.stage}`),
      ])
    } catch (err) { setLines((p) => [...p, `sleep-epochs failed: ${err instanceof Error ? err.message : String(err)}`]) }
  }, [debugDate])

  if (availability === 'checking') return <p className="text-sm text-muted-foreground">Checking native plugin…</p>
  if (availability === 'unavailable') {
    return (
      <div className="flex items-start gap-3 rounded-md border border-border bg-muted/30 p-4">
        <BluetoothOff className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Native OuraBle plugin unavailable. This screen only works in the APK — and only an APK
          built after the plugin was added (rebuild with <code>npx cap sync android</code> +{' '}
          <code>./gradlew assembleDebug</code>).
        </p>
      </div>
    )
  }

  const state = status?.state ?? 'stopped'
  const connected = state === 'ready'

  return (
    <div className="space-y-4">
      {/* Key setup — entry until a key is stored, backup once it is */}
      <section className="space-y-2 rounded-md border border-border p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium"><KeyRound className="h-4 w-4" /> Ring key</h2>
        {!hasKey ? (
          <div className="flex gap-2">
            <input
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="32-hex key from key.hex"
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
            />
            <Button size="sm" onClick={() => withPlugin(async (p) => { await p.setKey({ hex: keyInput }); setKeyInput(''); setHasKey(true) })}>Save</Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              This key exists only on this phone. Uninstalling the app destroys it, and the ring
              becomes unreachable — recovering it through the official Oura app re-keys the ring and
              risks a firmware update that breaks this integration. Copy it somewhere durable before
              any uninstall or device change.
            </p>
            {revealedKey === null ? (
              <Button size="sm" variant="outline" onClick={revealKey}>Show key for backup</Button>
            ) : (
              <div className="space-y-2">
                <p className="break-all rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs">{revealedKey}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={copyKey}>{keyCopied ? 'Copied' : 'Copy'}</Button>
                  <Button size="sm" variant="ghost" onClick={hideKey}>Hide</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Connection status + primary actions */}
      <section className="space-y-3 rounded-md border border-border p-4">
        <div className="flex items-center justify-between">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${statusTone(state)}`}>
            <Bluetooth className="h-3.5 w-3.5" />
            {connected ? 'Connected' : state === 'stopped' ? 'Stopped' : state[0].toUpperCase() + state.slice(1)}
          </span>
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <Battery className="h-4 w-4" />{status?.battery != null ? `${status.battery}%` : '—'}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!hasKey} onClick={syncAndRedecode}>
            <RefreshCw className="mr-1 h-4 w-4" /> Sync &amp; Redecode
          </Button>
          <Button size="sm" variant="outline" disabled={!hasKey} onClick={syncNow}>
            <RefreshCw className="mr-1 h-4 w-4" /> Sync now
          </Button>
          {state === 'stopped' ? (
            <Button size="sm" variant="outline" disabled={!hasKey} onClick={() => withPlugin(async (p) => {
              const { granted } = await p.ensurePermissions()
              if (granted) await p.startService()
            })}><Play className="mr-1 h-4 w-4" /> Start</Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => withPlugin((p) => p.stopService())}><Square className="mr-1 h-4 w-4" /> Stop</Button>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Connects / drops</dt><dd>{status ? `${status.connectCount} / ${status.dropCount}` : '—'}</dd>
          <dt className="text-muted-foreground">Last time-to-connect</dt><dd>{status ? `${(status.lastTimeToConnectMs / 1000).toFixed(1)}s` : '—'}</dd>
          <dt className="text-muted-foreground">Uptime</dt><dd>{status ? `${Math.round(status.serviceUptimeMs / 60000)}m` : '—'}</dd>
        </dl>

        {/* Battery-optimization exemption — Samsung kills unexempted background
            services, which stops overnight sync. One-time setup. */}
        {batteryExempt === false && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs">
            <Zap className="h-4 w-4 shrink-0 text-amber-500" />
            <span className="text-muted-foreground">Background running is restricted — sync may stop when the app is closed.</span>
            <Button size="sm" variant="outline" className="ml-auto shrink-0" onClick={requestBatteryOpt}>Allow</Button>
          </div>
        )}
        {batteryExempt === true && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Zap className="h-3.5 w-3.5 text-primary" /> Background running allowed
          </p>
        )}
      </section>

      {/* Recorded data — the point of the tester */}
      <section className="space-y-2 rounded-md border border-border p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Activity className="h-4 w-4" /> Recorded to server
          <button onClick={() => void refreshSummary()} className="ml-auto text-muted-foreground hover:text-foreground" aria-label="Refresh">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </h2>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat icon={<HeartPulse className="h-4 w-4" />} label="Heart rate" value={summary?.latestHrBpm != null ? `${summary.latestHrBpm}` : '—'} unit="bpm" />
          <Stat icon={<Thermometer className="h-4 w-4" />} label="Temp" value={summary?.latestTempC != null ? summary.latestTempC.toFixed(2) : '—'} unit="°C" />
          <Stat icon={<Waves className="h-4 w-4" />} label="HRV" value={summary?.latestHrvRmssd != null ? `${summary.latestHrvRmssd}` : '—'} unit="ms" />
          <Stat
            icon={<Droplet className="h-4 w-4" />}
            label={summary?.latestSpo2 && !summary.latestSpo2.calibrated ? 'SpO₂ (est.)' : 'SpO₂'}
            value={summary?.latestSpo2 != null ? `${summary.latestSpo2.pct}` : '—'}
            unit="%"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {summary ? `${summary.totalEvents.toLocaleString()} events stored` : 'No data yet'}
          {status?.draining && ' · draining…'}
          {(status?.ingestPosted ?? 0) > 0 &&
            ` · service uploaded ${status?.ingestPosted} (${status?.ingestStored} new) · cursor ${status?.cursorDs}`}
          {sent.frames > 0 && ` · ${sent.frames} forwarded this session (${sent.stored} new)`}
          {pendingCount > 0 && ` · ${pendingCount} pending upload`}
        </p>
        {status?.lastIngestError && (
          <p className="text-xs text-destructive">
            Upload error: {status.lastIngestError} — cursor held, the span re-drains automatically.
          </p>
        )}
        {summary && summary.byEventName.length > 0 && (
          <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs">
            {(showAllEvents ? summary.byEventName : summary.byEventName.slice(0, 8)).map((b) => (
              <span key={`${b.tag}-${b.eventName}`} className={b.eventName === 'unknown' ? 'text-amber-500' : 'text-muted-foreground'}>
                {eventLabel(b.tag, b.eventName)}×{b.count}
              </span>
            ))}
            {summary.byEventName.length > 8 && (
              <button onClick={() => setShowAllEvents((v) => !v)} className="text-primary hover:underline">
                {showAllEvents ? 'show less' : `+${summary.byEventName.length - 8} more`}
              </button>
            )}
          </div>
        )}
        {summary?.clockAnchorUtc && (
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-t border-border/60 pt-2 text-xs">
            <dt className="text-muted-foreground">HR sampled</dt>
            <dd>every {fmtCadence(summary.hrTiming.cadenceSec)} · last {fmtTime(summary.hrTiming.latestAt)}</dd>
            <dt className="text-muted-foreground">Temp sampled</dt>
            <dd>every {fmtCadence(summary.tempTiming.cadenceSec)} · last {fmtTime(summary.tempTiming.latestAt)}</dd>
            <dt className="text-muted-foreground">Data spans</dt>
            <dd>{fmtTime(summary.oldestMeasuredAt)} → {fmtTime(summary.newestMeasuredAt)}</dd>
            <dt className="text-muted-foreground">Clock anchor</dt>
            <dd>{summary.clockAnchorDs} ds @ {fmtTime(summary.clockAnchorUtc)}</dd>
            {status?.cursorDs != null && (
              <>
                <dt className="text-muted-foreground">Resume cursor</dt>
                <dd className="tabular-nums">{status.cursorDs}{status.draining ? ' · draining…' : ''}</dd>
              </>
            )}
          </dl>
        )}
      </section>

      {/* Decoded-field inspector — one newest sample per event type */}
      {summary && <SampleInspector samples={summary.latestByTag} />}

      <DeviceMetricsPanel />

      {/* Domain sections (Sub-plan G-1) — the console is sliced by DATA DOMAIN (one chevron per
          program area) rather than by tool type, so each program feature PR drops its device-test
          card into the right section. Every lever keeps the handler defined above; only the grouping
          changed. Placeholder domains (Recovery, Cloud) carry a note until their test cards land. */}

      {/* ① Data / Ingestion / Retention */}
      <CollapsibleSection title="Data · Ingestion · Retention" icon={<History className="h-4 w-4" />}>
        <div className="space-y-3">
          <DbFootprintCard />
          <div className="space-y-3 border-t border-border/60 pt-3">
            <BtnGroup label="History & sync">
              <Button size="sm" variant="outline" onClick={() => withPlugin((p) => p.drainHistory())}><History className="mr-1 h-4 w-4" /> Drain history</Button>
              <Button size="sm" variant="outline" onClick={fullResync}><History className="mr-1 h-4 w-4" /> Full re-sync</Button>
              <Button size="sm" variant="outline" onClick={redecode}>Redecode</Button>
            </BtnGroup>
            {hasKey && (
              <BtnGroup label="Danger zone">
                <Button size="sm" variant="ghost" onClick={() => withPlugin(async (p) => { await p.clearKey(); setHasKey(false) })}>Clear key</Button>
              </BtnGroup>
            )}
          </div>
        </div>
      </CollapsibleSection>

      {/* ② Sleep */}
      <CollapsibleSection title="Sleep" icon={<Moon className="h-4 w-4" />}>
        <div className="space-y-3">
          <BtnGroup label="Frames">
            <Button size="sm" variant="outline" onClick={dumpSleepFrames}>Dump sleep frames</Button>
          </BtnGroup>
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Sleep epochs (debug)</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                placeholder="YYYY-MM-DD"
                value={debugDate}
                onChange={(e) => setDebugDate(e.target.value)}
                className="h-8 w-36 rounded-md border border-input bg-transparent px-2 text-sm"
              />
              <Button size="sm" variant="outline" onClick={sleepEpochs}>Compute</Button>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* ③ Steps / Activity / Energy */}
      <CollapsibleSection title="Steps · Activity · Energy" icon={<Footprints className="h-4 w-4" />}>
        <div className="space-y-3">
          <BtnGroup label="Accelerometer">
            <Button size="sm" variant="outline" onClick={() => withPlugin((p) => p.startAccel())}>Accel</Button>
            <Button size="sm" variant="outline" onClick={() => withPlugin((p) => p.stopAccel())}>Stop accel</Button>
          </BtnGroup>

          {/* Steps investigation (plan 2026-07-09-oura-ble-steps): REAL_STEPS (0x0b) is
              server-gated off, so the ring emits no 0x7e/0x7f step events until enabled.
              "Enable steps" fires REAL_STEPS→AUTOMATIC in isolation; then walk a counted
              distance and watch real_step_event_feature_1/2 climb in the Frames counts.
              "Measure OFF" turns DAYTIME_HR+SPO2+REAL_STEPS off (mode 0x00) — a
              non-destructive probe; they re-enable on the next reconnect via Enable measure. */}
          <BtnGroup label="Measurements">
            <Button size="sm" variant="outline" onClick={() => withPlugin((p) => p.enableMeasurement())}>Enable measure</Button>
            <Button size="sm" variant="outline" onClick={() => withPlugin((p) => p.setFeatureMode({ feature: 0x0b, mode: 0x01 }))}>Enable steps</Button>
            <Button size="sm" variant="outline" onClick={() => withPlugin((p) => p.featureStatus())}>Feature status</Button>
            <Button size="sm" variant="outline" onClick={() => withPlugin((p) => p.setFeatureMode({ feature: 0x0b, mode: 0x00 }))}>Steps OFF</Button>
            <Button size="sm" variant="outline" onClick={() => withPlugin(async (p) => {
              await p.setFeatureMode({ feature: 0x02, mode: 0x00 }) // DAYTIME_HR off
              await p.setFeatureMode({ feature: 0x04, mode: 0x00 }) // SPO2 off
              await p.setFeatureMode({ feature: 0x0b, mode: 0x00 }) // REAL_STEPS off
            })}>Measure OFF</Button>
          </BtnGroup>

          <BtnGroup label="Frames">
            <Button size="sm" variant="outline" onClick={dumpStepFrames}>Dump step frames</Button>
          </BtnGroup>

          {/* Step testing modules, nested so each keeps its own chevron within the domain */}
          <div className="space-y-2 border-t border-border/60 pt-3">
            <CollapsibleSection title="Step calibration" icon={<Footprints className="h-4 w-4" />}>
              <StepCalibration onSync={syncNow} />
            </CollapsibleSection>
            <CollapsibleSection title="Live step test (accel spike)" icon={<Footprints className="h-4 w-4" />}>
              <LiveStepTest />
            </CollapsibleSection>
            <CollapsibleSection title="Continuous step capture (production)" icon={<Activity className="h-4 w-4" />}>
              <ContinuousCaptureCard />
            </CollapsibleSection>
          </div>
        </div>
      </CollapsibleSection>

      {/* ④ Recovery / Readiness / Illness — server-derived from the rollup; test cards land here (G-3+) */}
      <CollapsibleSection title="Recovery · Readiness · Illness" icon={<Waves className="h-4 w-4" />}>
        <p className="text-xs text-muted-foreground">
          Recovery, readiness and illness are derived server-side from the nightly rollup (HRV/RHR
          medians, readiness contributors, the illness radar). Their inspection cards drop in here as
          those features ship — no raw ring levers for this domain.
        </p>
      </CollapsibleSection>

      {/* ⑤ Cardio / Body-comp */}
      <CollapsibleSection title="Cardio · Body-comp" icon={<HeartPulse className="h-4 w-4" />}>
        <div className="space-y-3">
          <BtnGroup label="Connection">
            <Button size="sm" variant="outline" onClick={() => withPlugin((p) => p.readBattery())}>Battery</Button>
            <Button size="sm" variant="outline" onClick={() => withPlugin((p) => p.readInfo())}>Info</Button>
            <Button size="sm" variant="outline" onClick={() => withPlugin((p) => p.syncTime())}>SyncTime</Button>
          </BtnGroup>

          {/* Live-HR investigation levers — fire one at a time, then watch the frame-tag
              counts in the Log section for HR events (aohr 0x86, IBI 0x80/0x60). */}
          <BtnGroup label="Heart rate">
            <Button size="sm" variant="outline" onClick={() => withPlugin((p) => p.startLiveHr())}><HeartPulse className="mr-1 h-4 w-4" /> Live HR</Button>
            <Button size="sm" variant="outline" onClick={() => withPlugin((p) => p.stopLiveHr())}>Stop HR</Button>
            <Button size="sm" variant="outline" onClick={() => withPlugin((p) => p.fastHr({ on: true }))}>Fast-HR on</Button>
            <Button size="sm" variant="outline" onClick={() => withPlugin((p) => p.fastHr({ on: false }))}>Fast-HR off</Button>
            <Button size="sm" variant="outline" onClick={() => withPlugin((p) => p.setFeatureMode({ feature: 0x03, mode: 0x03 }))}>Exercise-HR live</Button>
            <Button size="sm" variant="outline" onClick={() => withPlugin((p) => p.setFeatureMode({ feature: 0x02, mode: 0x03 }))}>Daytime-HR live</Button>
            <Button size="sm" variant="outline" onClick={() => withPlugin((p) => p.triggerHrBurst())}><HeartPulse className="mr-1 h-4 w-4" /> HR burst</Button>
          </BtnGroup>

          <BtnGroup label="Diagnostics">
            <Button size="sm" variant="outline" onClick={hrCoverage}>HR coverage</Button>
          </BtnGroup>

          {/* Battery soak nests its own chevron within the domain */}
          <div className="border-t border-border/60 pt-3">
            <CollapsibleSection title="Battery soak (streaming drain test)" icon={<Battery className="h-4 w-4" />}>
              <BatterySoakTest />
            </CollapsibleSection>
          </div>
        </div>
      </CollapsibleSection>

      {/* ⑥ Cloud (legacy, frozen) */}
      <CollapsibleSection title="Cloud (legacy · frozen)" icon={<Cloud className="h-4 w-4" />}>
        <p className="text-xs text-muted-foreground">
          The Oura Cloud stopped receiving data at the 2026-07-07 re-key — everything above comes
          direct over BLE. Kept for reference only; no new data flows through the Cloud path.
        </p>
      </CollapsibleSection>

      {/* Log & frame counts — the copyable output (no more screenshots). Open by default. */}
      <CollapsibleSection
        title="Log & frames"
        icon={<ScrollText className="h-4 w-4" />}
        defaultOpen
        right={lines.length > 0 ? `${lines.length} lines` : undefined}
      >
        <div className="space-y-2">
          {Object.keys(tagCounts).length > 0 && (
            <div className="text-xs text-muted-foreground">
              Frames:{' '}
              {Object.entries(tagCounts).sort(([, a], [, b]) => b - a).map(([name, n]) => `${name}×${n}`).join(' · ')}
            </div>
          )}
          <LogConsole lines={lines} onClear={clearLines} />
        </div>
      </CollapsibleSection>
    </div>
  )
}

function BtnGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

function Stat({ icon, label, value, unit }: { icon: React.ReactNode; label: string; value: string; unit: string }) {
  return (
    <div className="rounded-md bg-muted/40 p-2">
      <div className="flex items-center justify-center gap-1 text-muted-foreground">{icon}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}<span className="ml-0.5 text-xs font-normal text-muted-foreground">{unit}</span></div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  )
}
