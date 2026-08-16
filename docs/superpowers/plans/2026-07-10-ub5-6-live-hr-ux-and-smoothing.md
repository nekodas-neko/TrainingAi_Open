# Live-HR UX Rework + HR-Graph Smoothing (UB5 + UB6)

**Source:** `docs/reviews/2026-07-09-user-reported-bugs.md` (UB5, UB6). **Branch:** `feat/live-hr-ux-rework`.
Grounded against `main`@`6264f16`. **Server/JS + client only** — ships via Railway into the
WebView, **no APK rebuild** (nothing here touches Kotlin/`lib/oura-ble/plugin` internals; the
live-HR service `lib/live-hr/*` is reused as-is). But the live-HR path is BLE, so **on-device is
the real gate** for anything that depends on real ring beats:

- **Device-only (APK, real ring):** the rest-phase "last-seen HR" hold behaviour (the ring's
  >8 s stale gaps only exist on-device), the Body/Health "Measure now" actually returning a
  number, and the live sparkline's smoothing over real bursty beats.
- **Dev-server / unit testable:** the stripped readout markup + the Measure-now affordance
  rendering & start/stop lifecycle (the manager is inert in the web sandbox — `getOuraBle()`
  returns null, so `start()` no-ops and no beats arrive), the smoothing helper (pure, unit-tested),
  and the done-screen HR-recovery chart (fed by seeded `oura_heartrate` readings via
  `/api/oura/hr-data`, so it renders in `pnpm dev`).

**Goal:** strip the interactive live-HR readout down to a minimal, non-interactive rest-phase chip
that holds the last-seen bpm instead of blanking to `—`, move the one-shot "Measure now" affordance
to Body/Health, and smooth both HR graphs (live sparkline + done-screen recovery chart) through a
shared display-only averaging helper — leaving raw archival samples untouched.

---

## Chunk 1 — Workout HR readout rework (UB5)

The workout screen renders the **full** interactive readout during rest (Measure button, a
diagnostics toggle, and a `DiagnosticsPanel`), and blanks to `—` whenever the last beat is older
than 8 s — which is normal ring behaviour, so it flickers constantly. Strip it to a minimal,
non-interactive chip that **holds the last-seen bpm** and only dims/annotates when stale.

### Task 1 — Hold last-seen bpm in the hook (`lib/live-hr/use-live-hr.ts`)

Root cause of the null-while-waiting flicker is `use-live-hr.ts:48-49`:

```ts
const live = bpm != null && at != null && now - at < STALE_MS
return { bpm: live ? bpm : null, at, sourceId, live, getDiagnostics, measureNow }
```

`bpm` is discarded (`live ? bpm : null`) the instant a sample crosses `STALE_MS` (8 s). Stop
discarding it — return the raw last-seen `bpm` always, and expose a `stale` flag so the UI can dim
it. The `live` boolean keeps its current meaning (fresh sample within 8 s).

Edit the interface (`:9-20`) and the return:

```ts
export interface UseLiveHr {
  /** Last-seen bpm — HELD across stale gaps (was: blanked to null once stale). null only
   *  before the first sample arrives. Use `live`/`stale` to decide how to present it. */
  bpm: number | null
  at: number | null
  sourceId: LiveHrSourceId | null
  /** True once we've received at least one sample and it isn't stale. */
  live: boolean
  /** True when we have a bpm but the last sample is older than STALE_MS (hold + dim it). */
  stale: boolean
  getDiagnostics: () => LiveHrDiagnostics | null
  measureNow: () => Promise<void>
}
```

```ts
const live = bpm != null && at != null && now - at < STALE_MS
const stale = bpm != null && !live
return { bpm, at, sourceId, live, stale, getDiagnostics, measureNow }
```

**Consumer check (do in this task):** `useLiveHr` is currently consumed by exactly one component —
`components/workout/live-hr-readout.tsx` (grep confirms; the interval-walk plan that also consumes
it is unbuilt). The semantics of `bpm` change from "null when stale" to "last-seen, held", so the
readout (Task 2) must switch its blank test from `bpm`/`live && bpm != null` to `!live`. No other
shipped consumer relies on the old blanking.

### Task 2 — Strip the workout readout to a minimal chip (`components/workout/live-hr-readout.tsx`)

Delete the Measure button (`:65-75`, handler `handleMeasure` `:33-39`), the diagnostics toggle
(`:76-86`), the entire `DiagnosticsPanel` (`:94-164`), and the now-unused imports
(`ActivityIcon`, `CheckIcon`, `CopyIcon`, `hapticLight`, `LiveHrDiagnostics`, the `measureNow`/
`getDiagnostics`/`measuring`/`showDiag` state). Keep the leaf-scoped subscription + rolling buffer
(the render-discipline reason it owns its own `useLiveHr()` — never lift into `workout-screen.tsx`).

Replace the component body with a minimal, non-interactive chip that reads `bpm`/`live`/`stale` and
holds the last value (dimming when stale) instead of showing `—`. Apply Chunk 3's smoothing to the
sparkline buffer:

```ts
'use client'
import { memo, useEffect, useRef, useState } from 'react'
import { HeartPulseIcon } from 'lucide-react'
import { Sparkline } from '@/components/ui/sparkline'
import { useLiveHr } from '@/lib/live-hr/use-live-hr'
import { rollingMedian } from '@/lib/health/hr-smoothing'

const MAX_POINTS = 40

// Leaf-scoped: owns the live-HR subscription + its own rolling buffer, so new beats
// re-render only this chip, never the ~1,000-line workout screen (render-discipline rule).
function LiveHrReadoutInner({ className }: { className?: string }) {
  const { bpm, live, stale } = useLiveHr()
  const [points, setPoints] = useState<number[]>([])
  const lastAt = useRef(0)

  useEffect(() => {
    if (bpm == null) return
    const now = Date.now()
    if (now - lastAt.current < 500) return // cap buffer growth on bursty frames
    lastAt.current = now
    setPoints(prev => [...prev, bpm].slice(-MAX_POINTS))
  }, [bpm])

  // Display-only smoothing (UB6) — raw beats are never mutated; archival is elsewhere.
  const smoothed = rollingMedian(points, 5)

  return (
    <div className={`rounded-2xl border border-border bg-muted/40 px-4 py-3 ${className ?? ''}`}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          <HeartPulseIcon className="h-3.5 w-3.5" /> Live HR
        </span>
        <span className="flex items-baseline gap-1">
          <span
            className={`text-2xl font-bold leading-none tabular-nums transition-opacity ${stale ? 'opacity-40' : ''}`}
            style={{ color: 'var(--color-brand)' }}
          >
            {bpm ?? '—'}
          </span>
          <span className="text-[10px] font-medium text-muted-foreground">bpm</span>
        </span>
      </div>

      <div className="mt-2 h-9">
        {smoothed.length >= 2 ? (
          <Sparkline values={smoothed} color="var(--color-brand)" fill responsive height={36} />
        ) : (
          <p className="pt-1 text-[11px] text-muted-foreground">
            {live ? 'Reading…' : bpm != null ? 'Holding last reading…' : 'Waiting for your ring…'}
          </p>
        )}
      </div>
    </div>
  )
}

export const LiveHrReadout = memo(LiveHrReadoutInner)
```

Notes:
- `bpm ?? '—'` shows `—` only before the first-ever sample; after that the last value is held and
  merely dimmed while `stale` (colour-only-state is fine here — the `stale` opacity is a redundant
  cue, and the number itself is the primary signal, not a band label).
- No `<button>` remains → no tap-target / nested-control concerns; the chip is pure display.
- The mount sites are unchanged: `active-workout-screen.tsx:649` (rest-phase block, `workoutPhase
  === "rest" && !allSetsLogged`) and `exercise-summary-screen.tsx:116`. Both keep the same minimal
  chip. `workout-screen.tsx:394-411` still owns the manager `start`/`stop` + `setForced` lifecycle
  — untouched.

**Verify (device):** during rest with the ring worn, the number appears within a couple of seconds
and then **stays put** (dimming, not blanking) through the ring's >8 s recording gaps; no Measure
button or diagnostics anywhere on the workout/exercise-summary screens. **Verify (dev):** the chip
renders with the waiting copy and no buttons; typecheck/lint clean (all removed imports gone).

---

## Chunk 2 — "Measure now" relocation to Body/Health (UB5)

The one-off "see my HR right now" belongs next to the Oura/HR card in Body/Health, not on the
workout screen. Reuse `measureNow()` (`manager.ts:41-43` → `oura-ring-source.ts:145-148`). Because
nothing on the health screen owns the live-HR lifecycle (unlike `workout-screen.tsx`), the affordance
must **start the manager on demand**, fire `measureNow()`, show incoming beats for a short window,
then **stop the manager if it was the one that started it** (spare the ring; never tear down a
concurrent workout's session — though the single-screen app can't be on both at once, guard anyway).

### Task 1 — `components/health/measure-hr-now.tsx` (new leaf component)

```ts
'use client'
import { useEffect, useRef, useState } from 'react'
import { HeartPulseIcon } from 'lucide-react'
import { getLiveHrManager } from '@/lib/live-hr/manager'
import { useLiveHr } from '@/lib/live-hr/use-live-hr'
import { hapticLight } from '@/lib/haptics'

const MEASURE_MS = 30_000 // hold the burst engaged for one reading window, then release the ring

// One-shot "see my HR right now". Starts the live-HR manager on demand (inert in the web
// sandbox / on an APK without the ring plugin), fires a burst, shows the last-seen bpm, and
// stops the manager after the window — only if THIS component started it.
export function MeasureHrNow() {
  const { bpm, live, stale } = useLiveHr()
  const [measuring, setMeasuring] = useState(false)
  const startedByUs = useRef(false)
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (stopTimer.current) clearTimeout(stopTimer.current)
    if (startedByUs.current) getLiveHrManager().stop().catch(() => {})
  }, [])

  async function handleMeasure() {
    void hapticLight()
    const mgr = getLiveHrManager()
    setMeasuring(true)
    if (mgr.activeSourceId() == null) { startedByUs.current = true; await mgr.start().catch(() => {}) }
    mgr.setForced(true)
    await mgr.measureNow().catch(() => {})
    if (stopTimer.current) clearTimeout(stopTimer.current)
    stopTimer.current = setTimeout(() => {
      setMeasuring(false)
      if (startedByUs.current) { getLiveHrManager().stop().catch(() => {}); startedByUs.current = false }
    }, MEASURE_MS)
  }

  return (
    <div className="rounded-2xl bg-muted/30 border border-border/50 p-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Live HR</p>
        <p className="flex items-baseline gap-1">
          <span
            className={`text-2xl font-bold leading-none tabular-nums transition-opacity ${stale ? 'opacity-40' : ''}`}
            style={{ color: 'var(--color-brand)' }}
          >
            {bpm ?? '—'}
          </span>
          <span className="text-[10px] font-medium text-muted-foreground">bpm</span>
          {measuring && !live && bpm == null && (
            <span className="text-[10px] text-muted-foreground">· reading…</span>
          )}
        </p>
      </div>
      <button
        type="button"
        onClick={handleMeasure}
        disabled={measuring}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-xs font-semibold text-white transition-opacity disabled:opacity-60"
        style={{ backgroundColor: 'var(--color-brand)' }}
      >
        <HeartPulseIcon className={`h-4 w-4 ${measuring ? 'animate-pulse' : ''}`} />
        {measuring ? 'Measuring…' : 'Measure now'}
      </button>
    </div>
  )
}
```

Notes:
- `min-h-[44px]` clears the tap-target floor; single real `<button>`, no nested controls.
- `manager.activeSourceId()` (`manager.ts:29-33`) is the "is a source already connected" probe used
  to decide ownership — if a source is already connected (e.g. hypothetically an in-progress
  workout), we don't start/stop it.
- No diagnostics, no hex-copy — this is the user-facing one-off, not the debug panel (the debug
  panel that was removed from the workout readout lives on `/admin/oura-ble` for protocol work).

### Task 2 — Mount it in `components/health/oura-section.tsx`

Add `import { MeasureHrNow } from './measure-hr-now'` and render it directly above the 24 h HR chart
card (`oura-section.tsx:149-155`), inside the existing `space-y-3` wrapper:

```tsx
      {/* One-off live HR reading (direct-BLE ring) */}
      <MeasureHrNow />

      {/* 24h Heart Rate chart */}
      {hrReadings.length > 0 && (
        ...
```

Keep it unconditional (it self-describes when no ring/beat is available), placed under the "Oura
Ring" section header so it reads as part of the ring surface.

**Verify (device):** on Body/Health, tap "Measure now" → a bpm appears within a few seconds and
holds; after ~30 s the ring is released (no persistent burst). **Verify (dev):** the card renders,
the button is tappable and flips to "Measuring…"/disabled, and no reading arrives (manager inert) —
i.e. the lifecycle runs without error; typecheck/lint clean. Removing Measure from the workout
readout (Chunk 1) plus adding it here is the full relocation.

---

## Chunk 3 — HR smoothing helper + application (UB6)

Two HR graphs plot **raw per-sample bpm** with no averaging, so single noisy near-live beats show as
big swings:
- Live workout sparkline — `live-hr-readout.tsx` pushes each surfaced beat into a 40-point buffer
  and plots it raw (addressed in Chunk 1 Task 2 by applying `rollingMedian`).
- Done-screen HR-recovery chart — `hr-recovery-chart.tsx:41` (`readings.map(r => ({ x, y: r.bpm }))`)
  plots raw points (only cosmetic `tension: 0.3`).

The smooth-line pattern already exists — `hr-day-chart.tsx:46-56` (`toBuckets`) averages into 5-min
buckets, which is why the Oura 24 h chart is smooth. Per **One Formula, One Place**, extract a shared
display-only helper and route all three call sites through it rather than growing a second copy.
**Raw archival samples stay untouched** — smoothing is display-only (mirrors the Oura-BLE archival
rule: `body_hex`/raw readings are never mutated; presentation derives).

### Task 1 — `lib/health/hr-smoothing.ts` (new shared helper, pure + unit-tested)

```ts
// Display-only HR smoothing. Raw/archival samples are NEVER mutated (smoothing happens at
// render time only). One Formula, One Place: hr-day-chart's toBuckets, the done-screen
// recovery chart, and the live workout sparkline all import from here.

/**
 * Average points into fixed-width buckets along a numeric axis (minutes-of-day, minutes
 * from a session origin, etc.). Generalises hr-day-chart's toBuckets. `bucketSize` is in
 * the same unit as `x`. Returns bucket-start x + rounded mean bpm, sorted by x.
 */
export function bucketAverage(
  points: { x: number; bpm: number }[],
  bucketSize: number,
): { x: number; y: number }[] {
  const acc: Record<number, number[]> = {}
  for (const p of points) {
    const bucket = Math.floor(p.x / bucketSize) * bucketSize
    ;(acc[bucket] ??= []).push(p.bpm)
  }
  return Object.entries(acc)
    .map(([k, vals]) => ({ x: Number(k), y: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) }))
    .sort((a, b) => a.x - b.x)
}

/**
 * Rolling median over a small centred window — robust to single-beat outliers (a spurious
 * near-live decode doesn't move the line, unlike a mean). For the live sparkline's plain
 * bpm buffer, where there's no timestamp axis to bucket on.
 */
export function rollingMedian(values: number[], window = 5): number[] {
  if (values.length === 0) return values
  const half = Math.floor(window / 2)
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - half), Math.min(values.length, i + half + 1))
      .slice().sort((a, b) => a - b)
    return slice[Math.floor(slice.length / 2)]
  })
}
```

Rationale for two functions: the two charts have a timestamp axis (bucket by time → mean), the live
sparkline is a bare `number[]` with no reliable per-point time (bucket-by-time would need a parallel
timestamp buffer) — a small rolling median is the right tool there and additionally rejects single
outliers. `rollingMedian` is the same algorithm already living privately in
`lib/health/recovery-index.ts:26-34`; this extraction is the canonical home. **In the same PR**,
refactor `recovery-index.ts` to import `rollingMedian` from here and delete its private copy (One
Formula, One Place — don't leave two).

Add `lib/health/__tests__/hr-smoothing.test.ts`: `bucketAverage` groups/means/rounds correctly and
sorts; `rollingMedian` flattens a single spike (`[60,60,140,60,60]` → centre stays ~60) and is
identity on a flat series; both handle empty/short input.

### Task 2 — Route `hr-day-chart.tsx`'s `toBuckets` through the shared helper

Keep behaviour identical (5-min buckets, rounded mean, `{x,y}` in minutes-of-day). Replace the body
of `toBuckets` (`:46-56`) with a thin adapter so there's one averaging implementation:

```ts
import { bucketAverage } from '@/lib/health/hr-smoothing'

// Average readings into N-minute buckets for a smooth line
function toBuckets(readings: Reading[], midnightMs: number, bucketMin = 5): { x: number; y: number }[] {
  return bucketAverage(readings.map(r => ({ x: toMinutes(r.timestamp, midnightMs), bpm: r.bpm })), bucketMin)
}
```

Output is identical to today's, so the working 24 h chart is unchanged — this is purely deduplication
mandated by touching the pattern.

### Task 3 — Smooth the done-screen recovery chart (`hr-recovery-chart.tsx`)

Replace the raw map at `:41`:

```ts
const xyData = readings.map(r => ({ x: toMinutes(r.timestamp), y: r.bpm }))
```

with a 30-second time-bucketed average (dense live-workout HR → 30 s bins keep the recovery shape but
kill single-beat swings):

```ts
import { bucketAverage } from '@/lib/health/hr-smoothing'

const BUCKET_MIN = 0.5 // 30-second buckets: smooth without hiding the post-set recovery curve
const xyData = bucketAverage(readings.map(r => ({ x: toMinutes(r.timestamp), bpm: r.bpm })), BUCKET_MIN)
```

The set-band shading (`setBands`/`setBandsPlugin`) and set-marker lines (`setLinesPlugin`) are
computed from `sets`, not from `xyData`, so they're unaffected. `tension: 0.3` stays. The
`readings.length === 0` empty-state guard (`:130`) still works (bucketing empty → empty; keep the
guard on `readings`, not `xyData`).

### Task 4 — Outlier rejection (decision: display-side only, no decode change)

Do **not** add outlier logic to `lib/live-hr/decode-live-hr.ts` or `oura-ring-source.ts`. Decoders
are contractually infallible/pure and the raw sample store is the archival source of truth (Oura-BLE
rules) — filtering at that layer would either mutate what gets archived or complicate the
never-throw contract. The 30–220 bpm sanity band already in `decode-live-hr.ts:6-16`
(`latestValidBpm`) is the only source-layer guard; keep it. The `rollingMedian` on the sparkline and
the 30 s `bucketAverage` on the recovery chart are the display-side outlier rejection — a single
spurious near-live decode no longer moves either line. Note this decision in the PR so it isn't
"fixed" again at the decode layer later.

**Verify (dev, seeded):** with seeded `oura_heartrate` readings, load a completed workout's done
screen (or the Body/Health HR-recovery card via `/api/oura/hr-data`) and confirm the recovery trace
is visibly smoother than raw (no single-sample spikes) while the post-set recovery dips are still
readable; the 24 h chart is unchanged. Unit tests for `hr-smoothing.ts` pass. **Verify (device):**
during a real workout, the rest-phase sparkline reads as a smooth line, not a jagged saw.

---

## Governing CLAUDE.md rules

- **One Formula, One Place** — `bucketAverage`/`rollingMedian` are extracted once in `lib/health/`
  and imported by all three chart/readout sites; `recovery-index.ts`'s private `rollingMedian` copy
  is deleted in the same PR. No second smoothing implementation may ship.
- **Render discipline — leaf timers.** `LiveHrReadout` and `MeasureHrNow` keep their own
  `useLiveHr()` subscription (the hook IS the leaf's only timer) — never lift the hook into
  `workout-screen.tsx`/`oura-section.tsx` and thread `bpm` down, or every beat re-renders the parent.
- **Oura-BLE archival rule / raw samples untouched** — smoothing is display-only; no change to
  `decode-live-hr.ts`, `oura-ring-source.ts`, or the raw store.
- **Android WebView / tap targets** — the relocated Measure button is a single real `<button>` at
  `min-h-[44px]` with no nested interactive content; the stripped workout chip has no controls at all.
- **Canonical Runtime — device wins, green `pnpm dev` is necessary not sufficient.** The BLE-dependent
  behaviour (last-seen hold across stale gaps, a real Measure-now number, smoothed real beats) is
  device-only; if no S25 is available in-session, add a `projectOverview.md` Known-Issues row marking
  these NOT verified on device.
- **Semantic colours / chart tokens** — the chips use `var(--color-brand)` (an existing token, not a
  hex literal); the recovery chart's canvas colours are unchanged (already `rgb()` literals passed to
  chart.js, not `var()` — do not introduce `var()` into canvas paint).
- **Component size** — new work lands in `components/health/measure-hr-now.tsx` (new file) and shrinks
  `live-hr-readout.tsx`; no host file grows toward the 800-line ceiling.

## Post-merge (end-of-session, same PR)

User-visible change → bump `package.json` (patch: UX polish + smoothing) and add a `lib/changelog.ts`
entry ("Live workout HR now holds your last reading instead of blanking, the graphs are averaged for a
smoother line, and 'Measure now' moved to the Body/Health screen"). Append the journal +
`projectOverview.md` lean-index update. Strike/adjust the UB5/UB6 rows.
