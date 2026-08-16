# Live HR — Plan 2: Guided Interval Walk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A guided "Japanese interval walking" activity — alternating 3-min fast / 3-min slow blocks (default 5 sets, fully configurable) with live HR-reserve effort zones, background-surviving interval cues, and a saved walk activity with a post-walk zone summary.

**Architecture:** JS/server only. The interval timer runs in JS and **resyncs from a stored start timestamp** (so backgrounding/reload never desyncs it), while **`@capacitor/local-notifications` (already installed) fires the fast/slow transition cues even when the app is backgrounded or the screen is off** — the same mechanism the workout rest-timer already uses (`lib/notifications.ts`). Live HR + zone feedback reuse the Plan-1 `lib/live-hr/*` layer. Effort zones use a new shared Karvonen helper. On finish it writes a `walk` `activity_log` via the existing offline-first path.

**Tech Stack:** TypeScript, React 19, Next.js 15, Zustand (+persist), `@capacitor/local-notifications`, `@capacitor/haptics`, the Plan-1 `lib/live-hr/*` layer, vitest.

> **Correction to the spec (§8.1):** the design spec assumed a **native** `GuidedSessionService` (Kotlin foreground service) for the timer + cues, requiring an APK rebuild. Investigation found `@capacitor/local-notifications` is already installed and already used for background rest-timer cues, and a JS timer can resync from a stored start time — so Plan 2 needs **no native code and no APK rebuild**; it ships via Railway. The tradeoff vs a native service: interval cues fire via scheduled OS notifications (sound + vibration) rather than a live ongoing notification, and the live HR display only updates while the app is foregrounded (the cues still fire backgrounded). This meets the owner's stated need ("tab out and scroll while walking — cues keep firing"). A richer native ongoing-notification version remains a future option if wanted.

---

## Runtime reality / verification note

- **JS/server only — ships via Railway, no APK rebuild.**
- **On-device (authoritative):** background cue timing (scheduled notifications firing at each transition with sound/vibration while backgrounded/screen-off), live HR + zone display, and the walk saving to history. Local-notification exact timing under Android Doze can drift by seconds — acceptable for interval cues; verify on-device. Live HR is on-device-only (sandbox `getOuraBle()` is null → readout shows "—").
- The interval math, zone math, and save-payload shaping are unit-tested in the sandbox.

## File structure

**Create:**
- `lib/health/hr-zones.ts` — shared Karvonen HR-zone helper (the app's only current copy is inline in `app/api/body-battery/route.ts`; this extracts it — One-Formula rule).
- `lib/walk/interval-plan.ts` — pure interval-schedule builder + "where am I now" resolver.
- `lib/walk/walk-cues.ts` — schedule/cancel the interval-transition local notifications (mirrors `lib/notifications.ts`).
- `lib/stores/guided-walk-store.ts` — Zustand store (config, `startedAtMs`, mode; transient-state reset on rehydrate).
- `app/activity/guided-walk/page.tsx` + `components/guided-walk/guided-walk-content.tsx` — the screen (config → active → summary).
- `components/guided-walk/walk-config.tsx`, `walk-active.tsx`, `walk-summary.tsx` — the three sub-screens.
- Tests: `lib/health/__tests__/hr-zones.test.ts`, `lib/walk/__tests__/interval-plan.test.ts`.

**Modify:**
- `app/api/body-battery/route.ts` — replace the inline `hrMax`/`reserve`/`hrr` math with imports from `lib/health/hr-zones.ts` (One-Formula; keep outputs identical).
- `components/workout/log-activity-sheet.tsx` — add an "Interval walk" launcher tile → `router.push('/activity/guided-walk')`.
- `lib/changelog.ts` + `package.json` version, journal + index, backlog (final task).

---

### Task 1: Shared HR-zone (Karvonen) helper

**Files:**
- Create: `lib/health/hr-zones.ts`
- Test: `lib/health/__tests__/hr-zones.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/health/__tests__/hr-zones.test.ts
import { describe, it, expect } from 'vitest'
import { estimateHrMax, hrReserveTarget, classifyZone } from '@/lib/health/hr-zones'

describe('hr-zones', () => {
  it('prefers an observed max, else 220 - age, else a default', () => {
    expect(estimateHrMax({ age: 30, observed: 191 })).toBe(191)
    expect(estimateHrMax({ age: 30, observed: null })).toBe(190) // 220 - 30
    expect(estimateHrMax({ age: null, observed: null })).toBe(190) // default
  })

  it('computes a Karvonen HR-reserve target', () => {
    // resting 60, max 190 → reserve 130. 70% → 60 + 91 = 151. 40% → 60 + 52 = 112.
    expect(hrReserveTarget(0.70, 60, 190)).toBe(151)
    expect(hrReserveTarget(0.40, 60, 190)).toBe(112)
  })

  it('classifies a fast block: in-zone at/above the fast target, else push', () => {
    expect(classifyZone(155, 'fast', { fast: 151, slow: 112 })).toBe('in')
    expect(classifyZone(140, 'fast', { fast: 151, slow: 112 })).toBe('push')
  })

  it('classifies a slow block: in-zone at/below the slow target, else ease', () => {
    expect(classifyZone(108, 'slow', { fast: 151, slow: 112 })).toBe('in')
    expect(classifyZone(130, 'slow', { fast: 151, slow: 112 })).toBe('ease')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/health/__tests__/hr-zones.test.ts`
Expected: FAIL — `Cannot find module '@/lib/health/hr-zones'`

- [ ] **Step 3: Implement**

```typescript
// lib/health/hr-zones.ts
// Canonical HR-zone math (Karvonen / heart-rate reserve). This is the single source
// of truth — app/api/body-battery/route.ts imports from here (One-Formula rule).
// Max HR uses the app's existing 220-age convention (observed max preferred); the
// interval-walk spec noted Tanaka (208-0.7*age) as more accurate, but standardising on
// the app's existing formula avoids drifting body-battery outputs — switch both together
// in a separate change if desired.
export type ZoneSegmentKind = 'fast' | 'slow'
export type ZoneVerdict = 'in' | 'push' | 'ease'
export interface ZoneTargets { fast: number; slow: number }

export function estimateHrMax({ age, observed }: { age: number | null; observed: number | null }): number {
  if (observed != null && observed > 0) return observed
  if (age != null && age > 0) return 220 - age
  return 190
}

/** Karvonen: resting + pct*(max - resting), rounded. reserve floored at 30 for safety. */
export function hrReserveTarget(pct: number, restingHr: number, hrMax: number): number {
  const reserve = Math.max(30, hrMax - restingHr)
  return Math.round(restingHr + pct * reserve)
}

/** HR-reserve fraction for a live bpm (0..1) — same as the body-battery inline math. */
export function hrReserveFraction(bpm: number, restingHr: number, hrMax: number): number {
  const reserve = Math.max(30, hrMax - restingHr)
  return Math.min(1, Math.max(0, (bpm - restingHr) / reserve))
}

export function classifyZone(bpm: number, kind: ZoneSegmentKind, targets: ZoneTargets): ZoneVerdict {
  if (kind === 'fast') return bpm >= targets.fast ? 'in' : 'push'
  return bpm <= targets.slow ? 'in' : 'ease'
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/health/__tests__/hr-zones.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Refactor body-battery to use the helper (One-Formula)**

In `app/api/body-battery/route.ts`, replace the inline `hrMax = age != null ? 220 - age : 190` with `estimateHrMax({ age, observed: hrMaxObserved ?? null })` and the inline `(bpm - restingHr)/reserve` clamp with `hrReserveFraction(bpm, restingHr, hrMax)` (import both from `@/lib/health/hr-zones`). Keep the persisted `hrMax`/`reserve` values numerically identical. Run the body-battery tests if any exist (`grep -rl body-battery lib/**/__tests__ app/**/__tests__`); otherwise `npx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add lib/health/hr-zones.ts lib/health/__tests__/hr-zones.test.ts app/api/body-battery/route.ts
git commit -m "Extract shared Karvonen HR-zone helper; use it in body-battery"
```

---

### Task 2: Interval-plan pure module

**Files:**
- Create: `lib/walk/interval-plan.ts`
- Test: `lib/walk/__tests__/interval-plan.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/walk/__tests__/interval-plan.test.ts
import { describe, it, expect } from 'vitest'
import { buildIntervalPlan, segmentAt, type WalkConfig } from '@/lib/walk/interval-plan'

const base: WalkConfig = { sets: 5, fastSec: 180, slowSec: 180, warmupSec: 0, cooldownSec: 0 }

describe('interval-plan', () => {
  it('builds 2 segments per set (default 5×3/3 = 10 segments, 30 min)', () => {
    const plan = buildIntervalPlan(base)
    expect(plan.segments.length).toBe(10)
    expect(plan.totalSec).toBe(1800)
    expect(plan.segments[0]).toMatchObject({ kind: 'slow', index: 0, startSec: 0, endSec: 180 })
    expect(plan.segments[1]).toMatchObject({ kind: 'fast', startSec: 180, endSec: 360 })
  })

  it('adds warmup and cooldown when configured', () => {
    const plan = buildIntervalPlan({ ...base, sets: 1, warmupSec: 120, cooldownSec: 60 })
    expect(plan.segments.map(s => s.kind)).toEqual(['warmup', 'slow', 'fast', 'cooldown'])
    expect(plan.totalSec).toBe(120 + 180 + 180 + 60)
  })

  it('resolves the active segment and time remaining for an elapsed time', () => {
    const plan = buildIntervalPlan(base)
    const at = segmentAt(plan, 200) // 200s → 2nd segment (fast, 180..360)
    expect(at?.segment.kind).toBe('fast')
    expect(at?.remainingSec).toBe(160)
    expect(segmentAt(plan, 1800)).toBeNull() // finished
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/walk/__tests__/interval-plan.test.ts`
Expected: FAIL — `Cannot find module '@/lib/walk/interval-plan'`

- [ ] **Step 3: Implement**

```typescript
// lib/walk/interval-plan.ts
// Pure interval-schedule builder for guided interval walking. The classic protocol is
// 3-min fast / 3-min slow × 5 sets; block lengths and set count are configurable. Each
// set is slow-then-fast so the first block eases you in (a warmup, if enabled, precedes).
export type SegmentKind = 'warmup' | 'fast' | 'slow' | 'cooldown'

export interface WalkConfig {
  sets: number
  fastSec: number
  slowSec: number
  warmupSec: number
  cooldownSec: number
}

export interface Segment {
  kind: SegmentKind
  index: number      // 0-based position in the segment list
  setNumber: number  // 1-based set this belongs to (0 for warmup/cooldown)
  startSec: number
  endSec: number
}

export interface IntervalPlan { segments: Segment[]; totalSec: number }

export function buildIntervalPlan(cfg: WalkConfig): IntervalPlan {
  const segments: Segment[] = []
  let t = 0
  let index = 0
  const push = (kind: SegmentKind, dur: number, setNumber: number) => {
    if (dur <= 0) return
    segments.push({ kind, index: index++, setNumber, startSec: t, endSec: t + dur })
    t += dur
  }
  push('warmup', cfg.warmupSec, 0)
  for (let s = 1; s <= cfg.sets; s++) {
    push('slow', cfg.slowSec, s)
    push('fast', cfg.fastSec, s)
  }
  push('cooldown', cfg.cooldownSec, 0)
  return { segments, totalSec: t }
}

export interface ActiveSegment { segment: Segment; remainingSec: number }

/** The segment active at `elapsedSec`, or null once the plan is complete. */
export function segmentAt(plan: IntervalPlan, elapsedSec: number): ActiveSegment | null {
  if (elapsedSec >= plan.totalSec) return null
  for (const segment of plan.segments) {
    if (elapsedSec >= segment.startSec && elapsedSec < segment.endSec) {
      return { segment, remainingSec: Math.ceil(segment.endSec - elapsedSec) }
    }
  }
  return null
}

export const DEFAULT_WALK_CONFIG: WalkConfig = { sets: 5, fastSec: 180, slowSec: 180, warmupSec: 0, cooldownSec: 0 }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/walk/__tests__/interval-plan.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/walk/interval-plan.ts lib/walk/__tests__/interval-plan.test.ts
git commit -m "Add pure interval-walk schedule builder"
```

---

### Task 3: Guided-walk store

**Files:**
- Create: `lib/stores/guided-walk-store.ts`

- [ ] **Step 1: Implement (Zustand + persist, transient state reset on rehydrate)**

```typescript
// lib/stores/guided-walk-store.ts
'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_WALK_CONFIG, buildIntervalPlan, type WalkConfig } from '@/lib/walk/interval-plan'

export type WalkMode = 'config' | 'active' | 'done'

interface GuidedWalkState {
  mode: WalkMode
  config: WalkConfig
  startedAtMs: number | null   // wall-clock start; the timer resyncs from this
  setConfig: (c: Partial<WalkConfig>) => void
  start: (nowMs: number) => void
  finish: () => void
  reset: () => void
}

export const useGuidedWalkStore = create<GuidedWalkState>()(
  persist(
    (set, get) => ({
      mode: 'config',
      config: DEFAULT_WALK_CONFIG,
      startedAtMs: null,
      setConfig: (c) => set(s => ({ config: { ...s.config, ...c } })),
      start: (nowMs) => set({ mode: 'active', startedAtMs: nowMs }),
      finish: () => set({ mode: 'done' }),
      reset: () => set({ mode: 'config', startedAtMs: null }),
    }),
    {
      name: 'ta_guided_walk_v1',
      onRehydrateStorage: () => (state) => {
        // Never auto-resume a stale active session (e.g. from a previous day). If the
        // stored start is older than the planned duration + a grace margin, reset to config.
        if (!state || state.mode !== 'active' || state.startedAtMs == null) return
        const totalMs = buildIntervalPlan(state.config).totalSec * 1000
        if (Date.now() - state.startedAtMs > totalMs + 60_000) {
          state.mode = 'config'
          state.startedAtMs = null
        }
      },
    },
  ),
)
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | grep "guided-walk-store" || echo clean`
Expected: `clean`

```bash
git add lib/stores/guided-walk-store.ts
git commit -m "Add guided-walk store with stale-session reset"
```

---

### Task 4: Interval-transition cues (local notifications)

**Files:**
- Create: `lib/walk/walk-cues.ts`

- [ ] **Step 1: Implement (mirror lib/notifications.ts pattern)**

```typescript
// lib/walk/walk-cues.ts
// Schedules one local notification per interval transition so cues fire (sound +
// vibration) even when the app is backgrounded or the screen is off — the same
// mechanism as the workout rest-timer (lib/notifications.ts). Guarded dynamic import:
// a no-op on web/older APKs.
import type { IntervalPlan } from '@/lib/walk/interval-plan'

const BASE_ID = 71000 // reserve 71000..71999 for walk cues

export async function scheduleWalkCues(plan: IntervalPlan, startedAtMs: number): Promise<void> {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const now = Date.now()
    const notifications = plan.segments
      .filter(seg => startedAtMs + seg.startSec * 1000 > now + 500) // only future transitions
      .map(seg => ({
        id: BASE_ID + seg.index,
        title: seg.kind === 'fast' ? 'Fast — push the pace' : seg.kind === 'slow' ? 'Slow — ease off' : seg.kind === 'cooldown' ? 'Cool down' : 'Warm up',
        body: `${Math.round((seg.endSec - seg.startSec) / 60)} min`,
        schedule: { at: new Date(startedAtMs + seg.startSec * 1000), allowWhileIdle: true },
      }))
    // A final "done" cue at the end of the plan.
    notifications.push({
      id: BASE_ID + 999,
      title: 'Walk complete',
      body: 'Nice work.',
      schedule: { at: new Date(startedAtMs + plan.totalSec * 1000), allowWhileIdle: true },
    })
    if (notifications.length) await LocalNotifications.schedule({ notifications })
  } catch { /* not native / plugin missing — the in-app timer still drives cues when foregrounded */ }
}

export async function cancelWalkCues(plan: IntervalPlan): Promise<void> {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const ids = plan.segments.map(seg => ({ id: BASE_ID + seg.index }))
    ids.push({ id: BASE_ID + 999 })
    await LocalNotifications.cancel({ notifications: ids })
  } catch { /* nothing scheduled */ }
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | grep "walk-cues" || echo clean`
Expected: `clean` (if `LocalNotifications.schedule`'s type rejects the shape, match the exact options used in `lib/notifications.ts:30`)

```bash
git add lib/walk/walk-cues.ts
git commit -m "Add guided-walk interval cues via local notifications"
```

---

### Task 5: Config sub-screen

**Files:**
- Create: `components/guided-walk/walk-config.tsx`

- [ ] **Step 1: Implement**

```tsx
// components/guided-walk/walk-config.tsx
'use client'
import { Button } from '@/components/ui/button'
import { useGuidedWalkStore } from '@/lib/stores/guided-walk-store'
import { buildIntervalPlan } from '@/lib/walk/interval-plan'

const PRESETS = [
  { label: 'Standard (5×3/3, 30 min)', sets: 5, fastSec: 180, slowSec: 180 },
  { label: 'Quick (3×3/3, 18 min)', sets: 3, fastSec: 180, slowSec: 180 },
]

export function WalkConfig({ onStart }: { onStart: () => void }) {
  const config = useGuidedWalkStore(s => s.config)
  const setConfig = useGuidedWalkStore(s => s.setConfig)
  const totalMin = Math.round(buildIntervalPlan(config).totalSec / 60)

  return (
    <div className="flex flex-col gap-4 px-6 pt-safe pb-safe-action">
      <h2 className="text-2xl font-bold">Interval walk</h2>
      <p className="text-sm text-muted-foreground">
        Alternate fast and slow blocks. The classic method is 3 min fast / 3 min slow, repeated.
      </p>

      <div className="flex flex-col gap-2">
        {PRESETS.map(p => (
          <Button key={p.label} variant="outline" className="justify-start"
            onClick={() => setConfig({ sets: p.sets, fastSec: p.fastSec, slowSec: p.slowSec })}>
            {p.label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <NumberField label="Sets" value={config.sets} min={1} max={12} onChange={v => setConfig({ sets: v })} />
        <NumberField label="Fast (min)" value={config.fastSec / 60} min={1} max={10} onChange={v => setConfig({ fastSec: v * 60 })} />
        <NumberField label="Slow (min)" value={config.slowSec / 60} min={1} max={10} onChange={v => setConfig({ slowSec: v * 60 })} />
        <NumberField label="Warm-up (min)" value={config.warmupSec / 60} min={0} max={10} onChange={v => setConfig({ warmupSec: v * 60 })} />
        <NumberField label="Cool-down (min)" value={config.cooldownSec / 60} min={0} max={10} onChange={v => setConfig({ cooldownSec: v * 60 })} />
      </div>

      <p className="text-sm text-muted-foreground">Total: ~{totalMin} min</p>
      <Button className="h-12" onClick={onStart}>Start walk</Button>
    </div>
  )
}

function NumberField({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void
}) {
  return (
    <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {label}
      <div className="flex items-center gap-1">
        <button type="button" aria-label={`decrease ${label}`} className="h-9 w-9 rounded-lg border border-border text-lg"
          onClick={() => onChange(Math.max(min, value - 1))}>−</button>
        <span className="flex-1 text-center text-base font-bold tabular-nums text-foreground">{value}</span>
        <button type="button" aria-label={`increase ${label}`} className="h-9 w-9 rounded-lg border border-border text-lg"
          onClick={() => onChange(Math.min(max, value + 1))}>+</button>
      </div>
    </label>
  )
}
```

- [ ] **Step 2: Typecheck + lint + commit**

Run: `npx tsc --noEmit 2>&1 | grep "walk-config" || echo clean` ; `npx eslint components/guided-walk/walk-config.tsx`
Expected: clean

```bash
git add components/guided-walk/walk-config.tsx
git commit -m "Add guided-walk config screen"
```

---

### Task 6: Active sub-screen (timer, zones, live HR, cues)

**Files:**
- Create: `components/guided-walk/walk-active.tsx`

**Behaviour:** owns the live-HR lifecycle (`getLiveHrManager().start()` on mount, `.stop()` on unmount), schedules the cues on mount, ticks a 1 Hz timer that resyncs from `startedAtMs`, shows the current phase + countdown + `LiveHrReadout` + a zone verdict, collects HR samples for the summary, and calls `finish()` when the plan completes.

- [ ] **Step 1: Implement**

```tsx
// components/guided-walk/walk-active.tsx
'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { LiveHrReadout } from '@/components/workout/live-hr-readout'
import { useGuidedWalkStore } from '@/lib/stores/guided-walk-store'
import { buildIntervalPlan, segmentAt } from '@/lib/walk/interval-plan'
import { scheduleWalkCues, cancelWalkCues } from '@/lib/walk/walk-cues'
import { getLiveHrManager } from '@/lib/live-hr/manager'
import { estimateHrMax, hrReserveTarget, classifyZone } from '@/lib/health/hr-zones'
import { hapticSuccess } from '@/lib/haptics'
import type { LiveHrSample } from '@/lib/live-hr/types'

export interface WalkHrSample { at: number; bpm: number }

export function WalkActive({ userProfile, onFinish }: {
  userProfile: { age: number | null; restingHr: number; hrMaxObserved: number | null }
  onFinish: (samples: WalkHrSample[]) => void
}) {
  const config = useGuidedWalkStore(s => s.config)
  const startedAtMs = useGuidedWalkStore(s => s.startedAtMs)
  const plan = useMemo(() => buildIntervalPlan(config), [config])
  const samplesRef = useRef<WalkHrSample[]>([])
  const [elapsedSec, setElapsedSec] = useState(0)
  const [liveBpm, setLiveBpm] = useState<number | null>(null)

  const hrMax = estimateHrMax({ age: userProfile.age, observed: userProfile.hrMaxObserved })
  const targets = useMemo(() => ({
    fast: hrReserveTarget(0.70, userProfile.restingHr, hrMax),
    slow: hrReserveTarget(0.40, userProfile.restingHr, hrMax),
  }), [userProfile.restingHr, hrMax])

  // Live-HR lifecycle + sample collection.
  useEffect(() => {
    const mgr = getLiveHrManager()
    mgr.start().catch(() => {})
    const unsub = mgr.subscribe((s: LiveHrSample) => {
      samplesRef.current.push({ at: s.at, bpm: s.bpm })
      setLiveBpm(s.bpm)
    })
    return () => { unsub(); mgr.stop().catch(() => {}) }
  }, [])

  // Schedule background cues once on mount; cancel on unmount.
  useEffect(() => {
    if (startedAtMs != null) scheduleWalkCues(plan, startedAtMs)
    return () => { cancelWalkCues(plan) }
  }, [plan, startedAtMs])

  // 1 Hz tick resyncing from wall-clock so backgrounding never desyncs the timer.
  useEffect(() => {
    if (startedAtMs == null) return
    const tick = () => {
      const e = Math.floor((Date.now() - startedAtMs) / 1000)
      setElapsedSec(e)
      if (e >= plan.totalSec) { hapticSuccess(); onFinish(samplesRef.current) }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAtMs, plan, onFinish])

  const active = segmentAt(plan, elapsedSec)
  const kind = active?.segment.kind
  const isWork = kind === 'fast' || kind === 'slow'
  const verdict = liveBpm != null && isWork ? classifyZone(liveBpm, kind as 'fast' | 'slow', targets) : null
  const phaseColor = kind === 'fast' ? 'var(--color-brand)' : 'var(--color-muted-foreground)'
  const mm = active ? Math.floor(active.remainingSec / 60) : 0
  const ss = active ? active.remainingSec % 60 : 0

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6 pt-safe pb-safe-action text-center">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {active ? `Set ${active.segment.setNumber || '—'} · ${plan.segments.filter(s => s.kind === 'fast').length} total` : 'Finishing…'}
      </p>
      <p className="text-5xl font-black uppercase" style={{ color: phaseColor }}>
        {kind === 'fast' ? 'Fast' : kind === 'slow' ? 'Slow' : kind === 'warmup' ? 'Warm up' : kind === 'cooldown' ? 'Cool down' : '—'}
      </p>
      <p className="text-6xl font-bold tabular-nums">{mm}:{String(ss).padStart(2, '0')}</p>

      <LiveHrReadout className="w-full max-w-xs" />
      {isWork && (
        <p className="text-sm font-semibold" style={{
          color: verdict === 'in' ? 'var(--color-brand)' : verdict ? '#eab308' : 'var(--color-muted-foreground)',
        }}>
          {verdict === 'in' ? `In zone (target ${kind === 'fast' ? `≥${targets.fast}` : `≤${targets.slow}`} bpm)`
            : verdict === 'push' ? `Push harder (aim ≥${targets.fast} bpm)`
            : verdict === 'ease' ? `Ease off (aim ≤${targets.slow} bpm)`
            : `Target ${kind === 'fast' ? `≥${targets.fast}` : `≤${targets.slow}`} bpm`}
        </p>
      )}

      <Button variant="outline" className="mt-2 h-12 w-full max-w-xs" onClick={() => onFinish(samplesRef.current)}>
        End walk
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck + lint + commit**

Run: `npx tsc --noEmit 2>&1 | grep "walk-active" || echo clean` ; `npx eslint components/guided-walk/walk-active.tsx`
Expected: clean

```bash
git add components/guided-walk/walk-active.tsx
git commit -m "Add guided-walk active screen with zones, cues and live HR"
```

---

### Task 7: Summary sub-screen + save the walk

**Files:**
- Create: `components/guided-walk/walk-summary.tsx`

**Behaviour:** given the collected `WalkHrSample[]` and the plan, compute duration + avg/max HR + per-interval avg HR + time-in-zone, render a fast/slow-shaded HR trace (reuse the shading idea from `HrRecoveryChart` or a simple shaded sparkline), and save a `walk` `activity_log` via the offline-first path (copying `components/activity/done-activity-screen.tsx`'s two-step write). Historical review shows a standard walk (avg/max HR, duration) — the per-interval breakdown is shown here immediately from the in-memory samples; persisting it to history is a deliberate v1 omission.

- [ ] **Step 1: Implement**

```tsx
// components/guided-walk/walk-summary.tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { getLocalStore } from '@/lib/local-store'
import { pushMutations } from '@/lib/local-store/sync-engine'
import { invalidateActivityWrites } from '@/lib/cache-groups'
import { todayInTz } from '@/lib/date-utils'
import { buildIntervalPlan, type WalkConfig } from '@/lib/walk/interval-plan'
import type { WalkHrSample } from './walk-active'

function avg(nums: number[]) { return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null }

export function WalkSummary({ config, samples, startedAtMs, userId, onDone }: {
  config: WalkConfig; samples: WalkHrSample[]; startedAtMs: number; userId?: string; onDone: () => void
}) {
  const router = useRouter()
  const plan = buildIntervalPlan(config)
  const durationMin = Math.round(plan.totalSec / 60)
  const bpms = samples.map(s => s.bpm)
  const avgHr = avg(bpms)
  const maxHr = bpms.length ? Math.max(...bpms) : null
  const savedRef = useRef(false)

  // Per-interval average HR from the sample timestamps vs plan offsets.
  const perSegment = plan.segments.map(seg => {
    const from = startedAtMs + seg.startSec * 1000
    const to = startedAtMs + seg.endSec * 1000
    return { seg, avg: avg(samples.filter(s => s.at >= from && s.at < to).map(s => s.bpm)) }
  })

  const [saved, setSaved] = useState(false)
  useEffect(() => {
    if (savedRef.current) return
    savedRef.current = true
    void saveWalk()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function saveWalk() {
    const date = todayInTz()
    const startDate = new Date(startedAtMs)
    const pad = (n: number) => String(n).padStart(2, '0')
    const startTime = `${pad(startDate.getHours())}:${pad(startDate.getMinutes())}`
    const payload = {
      date, activityType: 'walk', title: 'Interval walk',
      startTime, durationMin, avgHr: avgHr ?? undefined, maxHr: maxHr ?? undefined,
    }
    try {
      const store = userId ? getLocalStore(userId) : null
      if (store) {
        await store.upsertActivityLog({
          userId: userId!, date, activityType: 'walk', title: 'Interval walk',
          startTime, endTime: null, durationMin, distanceKm: null, caloriesBurned: null,
          avgHr: avgHr ?? null, maxHr: maxHr ?? null, steps: null, notes: null,
          routePolyline: null, splits: null, bestEfforts: null, paceSeries: null,
          avgPaceSecPerKm: null, elevationGainM: null, elevationLossM: null,
        } as Parameters<typeof store.upsertActivityLog>[0])
        await store.queueMutation({ userId: userId!, domain: 'activity_logs', date, payload })
        pushMutations(userId!).catch(() => {})
      } else {
        await fetch('/api/activity-logs', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        })
      }
      await invalidateActivityWrites()
      setSaved(true)
    } catch { setSaved(true) /* optimistic; outbox retries on device */ }
  }

  return (
    <div className="flex flex-col gap-4 px-6 pt-safe pb-safe-action">
      <h2 className="text-2xl font-bold">Walk complete</h2>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Duration" value={`${durationMin}m`} />
        <Stat label="Avg HR" value={avgHr != null ? `${avgHr}` : '—'} />
        <Stat label="Max HR" value={maxHr != null ? `${maxHr}` : '—'} />
      </div>

      <div className="rounded-2xl bg-muted/40 border border-border p-4 space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Per interval</p>
        {perSegment.filter(p => p.seg.kind === 'fast' || p.seg.kind === 'slow').map(p => (
          <div key={p.seg.index} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Set {p.seg.setNumber} · {p.seg.kind === 'fast' ? 'Fast' : 'Slow'}
            </span>
            <span className="tabular-nums" style={{ color: p.seg.kind === 'fast' ? 'var(--color-brand)' : undefined }}>
              {p.avg != null ? `${p.avg} bpm` : '—'}
            </span>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground">
        {saved ? 'Saved to your activity history.' : 'Saving…'}
      </p>
      <Button className="h-12" onClick={() => { onDone(); router.push('/activity') }}>Done</Button>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-muted/60 border border-border px-2 py-3">
      <p className="text-lg font-bold tabular-nums">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck + lint + commit**

Run: `npx tsc --noEmit 2>&1 | grep "walk-summary" || echo clean` ; `npx eslint components/guided-walk/walk-summary.tsx`
Expected: clean. **If the `upsertActivityLog` argument shape differs from the cast above**, match it exactly to `LocalActivityLog` in `lib/local-store/types.ts` and the `done-activity-screen.tsx` caller — do not guess field names.

```bash
git add components/guided-walk/walk-summary.tsx
git commit -m "Add guided-walk summary and save the walk activity"
```

---

### Task 8: Screen shell + route + launcher tile

**Files:**
- Create: `app/activity/guided-walk/page.tsx`, `components/guided-walk/guided-walk-content.tsx`
- Modify: `components/workout/log-activity-sheet.tsx`

- [ ] **Step 1: Content orchestrator**

```tsx
// components/guided-walk/guided-walk-content.tsx
'use client'
import { useEffect, useState } from 'react'
import { useGuidedWalkStore } from '@/lib/stores/guided-walk-store'
import { WalkConfig } from './walk-config'
import { WalkActive, type WalkHrSample } from './walk-active'
import { WalkSummary } from './walk-summary'

interface UserProfile { age: number | null; restingHr: number; hrMaxObserved: number | null }

export function GuidedWalkContent({ userId, profile }: { userId?: string; profile: UserProfile }) {
  const mode = useGuidedWalkStore(s => s.mode)
  const config = useGuidedWalkStore(s => s.config)
  const startedAtMs = useGuidedWalkStore(s => s.startedAtMs)
  const start = useGuidedWalkStore(s => s.start)
  const finish = useGuidedWalkStore(s => s.finish)
  const reset = useGuidedWalkStore(s => s.reset)
  const [samples, setSamples] = useState<WalkHrSample[]>([])
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, []) // avoid persisted-store hydration mismatch

  if (!mounted) return null

  if (mode === 'active' && startedAtMs != null) {
    return <WalkActive userProfile={profile} onFinish={(s) => { setSamples(s); finish() }} />
  }
  if (mode === 'done' && startedAtMs != null) {
    return <WalkSummary config={config} samples={samples} startedAtMs={startedAtMs} userId={userId} onDone={reset} />
  }
  return <WalkConfig onStart={() => start(Date.now())} />
}
```

- [ ] **Step 2: Route page (server component: fetch the Karvonen inputs)**

```tsx
// app/activity/guided-walk/page.tsx
import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { getRepositoryAsync } from '@/lib/data'
import { GuidedWalkContent } from '@/components/guided-walk/guided-walk-content'

function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null
  const d = new Date(dob)
  if (isNaN(d.getTime())) return null
  const now = new Date()
  let a = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--
  return a
}

export default async function GuidedWalkPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')
  const repo = await getRepositoryAsync()
  const user = await repo.getUserById(session.user.id)
  const metrics = await repo.listBodyMetrics(session.user.id, 30) // recent, for a resting-HR mean
  const restingVals = metrics.map(m => m.restingHeartRate).filter((n): n is number => typeof n === 'number')
  const restingHr = restingVals.length ? Math.round(restingVals.reduce((a, b) => a + b, 0) / restingVals.length) : 60
  const profile = { age: ageFromDob(user?.dateOfBirth), restingHr, hrMaxObserved: null as number | null }
  return <GuidedWalkContent userId={session.user.id} profile={profile} />
}
```

> Confirm `repo.getUserById` and `repo.listBodyMetrics(userId, days)` signatures before writing (see `lib/data/repository.ts` / `adapter.ts:1624`). If `listBodyMetrics` takes a date range instead of a day count, pass the equivalent 30-day range. `hrMaxObserved` can stay `null` for v1 (falls back to 220−age); wire it from `body_battery_daily` later if desired.

- [ ] **Step 3: Add the launcher tile**

In `components/workout/log-activity-sheet.tsx`, add a tile/button (matching the existing activity-type grid styling) labelled "Interval walk" that calls `router.push('/activity/guided-walk')` instead of the generic `startActivity(...)` flow. Place it first in the grid.

- [ ] **Step 4: Typecheck + lint + commit**

Run: `npx tsc --noEmit && npx eslint app/activity/guided-walk components/guided-walk components/workout/log-activity-sheet.tsx`
Expected: clean

```bash
git add app/activity/guided-walk components/guided-walk/guided-walk-content.tsx components/workout/log-activity-sheet.tsx
git commit -m "Wire guided-walk route, orchestrator and launcher tile"
```

---

### Task 9: Full gate + dev smoke + docs + version

- [ ] **Step 1: Full gate**

Run: `npx tsc --noEmit && npx eslint lib/walk lib/health/hr-zones.ts components/guided-walk && npx vitest run lib/walk lib/health`
Expected: typecheck clean, lint clean, `hr-zones` (4) + `interval-plan` (3) tests pass.

- [ ] **Step 2: Dev-server smoke**

Run `pnpm dev` (unset `DATABASE_URL`/`DATABASE_SSL` first, then `export DATABASE_URL='postgresql://postgres:postgres@localhost:5433/trainingai_dev'`). Log in as `test@local.dev` / `testpass123`, open `/activity/guided-walk`: the config screen renders, presets adjust the total, "Start walk" moves to the active screen with a counting-down timer and phase label, "Live HR" shows "—" (no ring in sandbox), and "End walk" reaches the summary which saves a walk to `/activity`. Fix anything that throws.

- [ ] **Step 3: Version + changelog + journal + backlog**

Bump `package.json` a minor. Add a `lib/changelog.ts` entry ("New guided **interval walk** — a timed fast/slow walking workout with live heart-rate effort zones and audio cues that keep going when your phone's in your pocket"). Prepend the session note to `docs/overview/history-current.md`; update `projectOverview.md` Current Status; remove this plan's backlog entry.

- [ ] **Step 4: Commit + push**

```bash
git add -A && git commit -m "Guided interval walk: version bump + journal"
git push -u origin feat/guided-interval-walk
```

---

## Verification summary

- **Automated (sandbox):** `hr-zones` + `interval-plan` unit tests; typecheck + lint; dev-server smoke of the config→active→summary flow (live HR "—" in sandbox).
- **On-device (authoritative — required):** background cue timing (notifications firing with sound/vibration at each transition while the app is backgrounded / screen off), live HR + zone verdicts updating in the active screen, and the walk landing in activity history. Run `docs/device-smoke-checklist.md`. Note the local-notification Doze-timing caveat.

## Notes for the implementer

- **No native code / no APK rebuild** — do not add a Kotlin service. Background cues come entirely from `@capacitor/local-notifications`.
- The timer is **wall-clock resynced** from `startedAtMs` every tick — never accumulate elapsed in state, or backgrounding will desync it.
- Reuse, don't re-implement: `useLiveHr`/`LiveHrReadout` (Plan 1), the `done-activity-screen.tsx` save pattern, `lib/notifications.ts` for the notification shape, and the shared `hr-zones` helper (never re-derive Karvonen at a call site).
- The guided-walk store persists `config` but must not auto-resume a stale `active` session (handled in `onRehydrateStorage`).
- v1 saves a standard `walk` activity (avg/max HR, duration); the per-interval breakdown is shown on the summary from in-memory samples but not persisted to history — a deliberate scope cut, noted for a future enhancement.
