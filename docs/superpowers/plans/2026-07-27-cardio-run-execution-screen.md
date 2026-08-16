# Dedicated Run Execution Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic `ActiveActivityScreen` specifically for runs with a run-aware live
screen — HR + zone hero, GPS distance/pace/splits-so-far/elevation, a live map, and cadence — per
spec `docs/superpowers/specs/2026-07-26-cardio-system-spec.md` phase 5 ("Dedicated run execution
screen") and decisions D-6 (visualisation) and D-12 (cadence is a tracked metric, displayed live).

**Architecture:** `app/activity`'s mode-router (`components/activity/activity-screen.tsx`) already
switches on `mode` (`'pre' | 'active' | 'done'`); this plan adds one more branch — when
`mode === 'active' && activityType === 'run'`, render a new `RunActiveScreen` instead of the
existing generic `ActiveActivityScreen`. `RunActiveScreen` reuses everything already proven to
work (the zustand `activity-store`, `startGpsWatcher`, `ActivityRouteMap`, `CadenceReadout`,
`computeSplits`/`computeElevationChange`) and adds exactly one new capability: a live HR+zone
reading, via the existing `lib/live-hr/` manager (already used by the workout screen, never wired
into the activity flow). Two small pieces of genuinely shared logic (the elapsed-time clock leaf
and the cadence-tracker lifecycle) are extracted out of `ActiveActivityScreen` into their own
files so both screens use the identical code, not a copy.

**No new stored data, no new API route, no sync-chain changes.** Today's prescription target
(zone ids) is read from the `running-plan` client cache key that `RunningPlanContent` already
warms before the user taps "Start run" — a passive read, not a new fetch path.

**Tech Stack:** Existing `lib/live-hr/` (live HR manager + `useLiveHr` hook), `lib/health/hr-zones.ts`
(Karvonen zone math), `lib/activity/activity-metrics.ts` (splits/elevation), `lib/activity/gps-tracking.ts`,
`components/activity/activity-route-map.tsx`, `components/activity/cadence-readout.tsx`,
`lib/activity/cadence-tracker.ts`, `lib/sqlite/cache.ts` (`cachedFetchToday`/`readTodayCacheSync`).

---

### Task 1: Extract the shared elapsed-time clock leaf

**Files:**
- Create: `components/activity/activity-elapsed-clock.tsx`
- Modify: `components/activity/active-activity-screen.tsx`

`ActiveActivityScreen` currently defines `ActivityElapsedClock` inline (lines 19-42) — the new run
screen needs the exact same leaf. Extract it once so both screens import the same code instead of
a duplicate copy (a duplicated formula/component is the recurring bug class this project's own
conventions warn against).

- [ ] **Step 1: Create the extracted file**

```tsx
// components/activity/activity-elapsed-clock.tsx
'use client'

import { useEffect, useState } from 'react'
import { formatTime } from '@/components/workout/utils'

// Leaf 1 Hz ticker (PERF-8) — owns its own setInterval so the whole screen
// (distance/pace/map) doesn't re-render every second; accounts for accumulated
// pause time the same way the orchestrator's tick used to.
export function ActivityElapsedClock({ startMs, accumulatedPauseMs, isPaused, pauseStartMs }: {
  startMs: number | null
  accumulatedPauseMs: number
  isPaused: boolean
  pauseStartMs: number | null
}) {
  const [elapsedSec, setElapsedSec] = useState(0)

  useEffect(() => {
    if (!startMs) return
    const tick = () => {
      const pauseMs = accumulatedPauseMs + (isPaused && pauseStartMs ? Date.now() - pauseStartMs : 0)
      setElapsedSec(Math.floor((Date.now() - startMs - pauseMs) / 1000))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startMs, accumulatedPauseMs, isPaused, pauseStartMs])

  return <span className="text-6xl font-bold tabular-nums">{formatTime(elapsedSec)}</span>
}
```

- [ ] **Step 2: Update `active-activity-screen.tsx` to import it instead of defining it inline**

Remove the inline `ActivityElapsedClock` function definition (the whole block from the comment
`// Leaf 1 Hz ticker (PERF-8)...` through its closing `}`), and remove the now-unused `formatTime`
import if `active-activity-screen.tsx` no longer uses it directly (check: it doesn't, once the
clock body moves out). Add:

```tsx
import { ActivityElapsedClock } from './activity-elapsed-clock'
```

The rest of `active-activity-screen.tsx` (the `<ActivityElapsedClock .../>` call site) is
unchanged — it already calls it with the same four props.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors, no unused-import warnings for `formatTime` in `active-activity-screen.tsx`.

- [ ] **Step 4: Manual verification**

`pnpm dev`, start any non-run activity (e.g. "Other" from the workout-select flow), confirm the
elapsed clock still counts up and pauses correctly exactly as before — this step is a pure
extraction, zero behavior change.

- [ ] **Step 5: Commit**

```bash
git add components/activity/activity-elapsed-clock.tsx components/activity/active-activity-screen.tsx
git commit -m "refactor: extract the activity elapsed-clock leaf so the run screen can share it"
```

---

### Task 2: Extract the shared cadence-tracking lifecycle hook

**Files:**
- Create: `lib/activity/use-cadence-tracking.ts`
- Modify: `components/activity/active-activity-screen.tsx`

`ActiveActivityScreen` currently owns the `CadenceTracker` lifecycle inline (creating it, starting
it against `startMs`, tearing it down on unmount). The run screen needs the identical lifecycle —
extract it into a hook rather than duplicating the effect.

- [ ] **Step 1: Create the hook**

```typescript
// lib/activity/use-cadence-tracking.ts
'use client'

import { useEffect, useState } from 'react'
import { CadenceTracker } from './cadence-tracker'
import { supportsCadence } from '@/lib/health/cadence'

/** Owns a CadenceTracker's lifecycle for foot-based activities: creates it on mount,
 *  starts it against the activity's startMs, and stops/tears it down on unmount (must
 *  not be skipped — the strap's accelerometer stream would otherwise keep running and
 *  drain it for the rest of the day). Shared between the generic activity screen and
 *  the dedicated run screen so the lifecycle isn't duplicated. */
export function useCadenceTracking(activityType: string | null, startMs: number | null): {
  tracker: CadenceTracker | null
  enabled: boolean
} {
  const enabled = supportsCadence(activityType)
  const [tracker, setTracker] = useState<CadenceTracker | null>(null)

  useEffect(() => {
    if (!enabled) return
    const t = new CadenceTracker()
    setTracker(t)
    void t.start(startMs ?? Date.now())
    return () => {
      setTracker(null)
      void t.stop()
    }
    // Deliberately not keyed on isPaused — a pause is a standing rest, which simply
    // produces no cadence readings. Tearing the BLE stream down and back up would
    // cost more than it saves.
  }, [enabled, startMs])

  return { tracker, enabled }
}
```

- [ ] **Step 2: Update `active-activity-screen.tsx` to use the hook**

Replace the inline `cadenceTracker`/`cadenceEnabled` state and effect (the block from
`const [cadenceTracker, setCadenceTracker] = useState...` through the effect's closing `}, [cadenceEnabled, startMs])`)
with:

```tsx
const { tracker: cadenceTracker, enabled: cadenceEnabled } = useCadenceTracking(activityType, startMs)
```

Add the import:

```tsx
import { useCadenceTracking } from '@/lib/activity/use-cadence-tracking'
```

Remove the now-unused direct imports of `CadenceTracker` and `supportsCadence` from
`active-activity-screen.tsx` (both are used only inside the new hook now). The rest of the file —
`onFinish` reading `cadenceTracker?.summary()`, the `<CadenceReadout tracker={cadenceTracker} />`
call site — is unchanged.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Manual verification**

`pnpm dev`, start a walk/run activity from the generic flow, confirm the cadence readout still
shows `--` (no strap/ring connected in the sandbox) without erroring, and that finishing the
activity still calls `cadenceTracker?.summary()` without throwing (check `onFinish` still wires
through — no visible regression, since this is a pure lifecycle extraction).

- [ ] **Step 5: Commit**

```bash
git add lib/activity/use-cadence-tracking.ts components/activity/active-activity-screen.tsx
git commit -m "refactor: extract cadence-tracking lifecycle into a shared hook"
```

---

### Task 3: `RunHrZoneHero` — live HR + zone display

**Files:**
- Create: `components/activity/run-hr-zone-hero.tsx`

A live bpm + HR-zone reading, reusing the exact same `useLiveHr()` hook and `hr-profile` cache
pattern the workout screen's `LiveHrChart` already uses (`components/workout/live-hr-chart.tsx:39-47`) —
without that component's exercise-trace/set-boundary coupling, since a run has no sets. When the
run has a prescription with target zone ids, the badge shows whether the current zone is on target.

- [ ] **Step 1: Create the component**

```tsx
// components/activity/run-hr-zone-hero.tsx
'use client'

import { memo, useEffect, useState } from 'react'
import { HeartPulseIcon } from 'lucide-react'
import { useLiveHr } from '@/lib/live-hr/use-live-hr'
import { computeHrZones, zoneForBpm } from '@/lib/health/hr-zones'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { HR_PROFILE_TTL } from '@/lib/cache-ttl'
import type { HrProfileResponse } from '@/app/api/hr-profile/route'

interface Props {
  /** Target zone ids from today's prescription, if this run has one — highlights the
   *  reading when the current zone is one of these; shows the target otherwise. */
  targetZoneIds?: number[]
}

function RunHrZoneHeroImpl({ targetZoneIds }: Props) {
  const { bpm, live, stale } = useLiveHr()
  const [profile, setProfile] = useState<HrProfileResponse | null>(null)

  useEffect(() => {
    const seed = readCacheSync<HrProfileResponse>('hr-profile')
    if (seed) setProfile(seed)
    cachedFetch<HrProfileResponse>('hr-profile', '/api/hr-profile', HR_PROFILE_TTL, setProfile).catch(() => {})
  }, [])

  const zones = profile ? computeHrZones(profile) : null
  const zone = zones && bpm != null ? zoneForBpm(bpm, zones) : null
  const onTarget = zone != null && targetZoneIds != null && targetZoneIds.includes(zone.id)
  const accent = zone?.color ?? 'var(--color-brand)'

  return (
    <div
      className={`flex w-full max-w-xs flex-col items-center gap-1 rounded-2xl border border-border bg-muted/40 px-4 py-3 transition-opacity ${stale ? 'opacity-70' : ''}`}
    >
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        <HeartPulseIcon className={`h-3.5 w-3.5 ${live ? 'animate-pulse' : ''}`} style={{ color: accent }} /> Heart rate
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className="text-4xl font-bold leading-none tabular-nums" style={{ color: accent }}>
          {bpm ?? '—'}
        </span>
        <span className="text-xs font-medium text-muted-foreground">bpm</span>
      </span>
      {zone && (
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
          style={{ color: accent, background: `color-mix(in oklch, ${accent} ${onTarget ? 20 : 12}%, transparent)` }}
        >
          Zone {zone.id} · {zone.name}
          {targetZoneIds != null && (onTarget ? ' · on target' : ` · target Z${targetZoneIds.join('-')}`)}
        </span>
      )}
    </div>
  )
}

export const RunHrZoneHero = memo(RunHrZoneHeroImpl)
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/activity/run-hr-zone-hero.tsx
git commit -m "feat: add the live HR + zone hero for the run execution screen"
```

(No unit test for this file — it is a pure display leaf composing already-tested primitives
(`computeHrZones`/`zoneForBpm` are covered by `lib/health/__tests__/hr-zones.test.ts` if present,
and `useLiveHr` has no branching logic of its own to re-test here); this matches the project's
existing convention of not unit-testing leaf UI components like `CadenceReadout` or
`PrescribedRunCard`, neither of which has a test file.)

---

### Task 4: `RunActiveScreen` — the dedicated run screen

**Files:**
- Create: `components/activity/run-active-screen.tsx`

Composes the elapsed clock (Task 1), the HR/zone hero (Task 3), distance/pace, splits-so-far,
elevation-so-far, the cadence readout, and the live map, plus pause/resume/finish controls — the
same control shape as `ActiveActivityScreen`, so `DoneActivityScreen`'s expectations (reading
`draftSummary` after `finish()`) are unaffected.

- [ ] **Step 1: Create the component**

```tsx
// components/activity/run-active-screen.tsx
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { PauseIcon, PlayIcon, StopIcon } from '@phosphor-icons/react'
import { useActivityStore } from '@/lib/stores/activity-store'
import { useShallow } from 'zustand/react/shallow'
import { startGpsWatcher, type GpsWatcher } from '@/lib/activity/gps-tracking'
import { computeSplits, computeElevationChange } from '@/lib/activity/activity-metrics'
import { useCadenceTracking } from '@/lib/activity/use-cadence-tracking'
import { getLiveHrManager } from '@/lib/live-hr/manager'
import { readTodayCacheSync, cachedFetchToday } from '@/lib/sqlite/cache'
import { RUNNING_PLAN_TTL } from '@/lib/cache-ttl'
import type { RunPrescription } from '@/components/running/prescribed-run-card'
import { ActivityElapsedClock } from './activity-elapsed-clock'
import { CadenceReadout } from './cadence-readout'
import { RunHrZoneHero } from './run-hr-zone-hero'

const ActivityRouteMap = dynamic(
  () => import('./activity-route-map').then(m => m.ActivityRouteMap),
  { ssr: false },
)

interface RunningPlanTodayResponse {
  prescription: RunPrescription | null
}

export function RunActiveScreen() {
  const {
    title, isPaused, startMs, accumulatedPauseMs, pauseStartMs,
    rawPoints, distanceKm, currentPaceSecPerKm, activityType,
    pause, resume, finish,
  } = useActivityStore(useShallow(s => ({
    title: s.title, isPaused: s.isPaused, startMs: s.startMs,
    accumulatedPauseMs: s.accumulatedPauseMs, pauseStartMs: s.pauseStartMs,
    rawPoints: s.rawPoints, distanceKm: s.distanceKm, currentPaceSecPerKm: s.currentPaceSecPerKm,
    activityType: s.activityType, pause: s.pause, resume: s.resume, finish: s.finish,
  })))

  const { tracker: cadenceTracker, enabled: cadenceEnabled } = useCadenceTracking(activityType, startMs)

  // Today's prescription target, if this run was started from the running-plan card — seeded
  // from the same 'running-plan' cache RunningPlanContent already warmed. No new fetch/endpoint;
  // a run started without a plan simply never resolves a prescription and the hero shows no target.
  const [plan, setPlan] = useState<RunningPlanTodayResponse | null>(null)
  useEffect(() => {
    const seed = readTodayCacheSync<RunningPlanTodayResponse>('running-plan')
    if (seed) setPlan(seed)
    cachedFetchToday<RunningPlanTodayResponse>('running-plan', '/api/running-plan', RUNNING_PLAN_TTL, setPlan).catch(() => {})
  }, [])

  // Live HR runs for the whole run — unlike lifting there's no rest/set split to lever
  // battery against, so it's simply forced on for the run's duration.
  useEffect(() => {
    const mgr = getLiveHrManager()
    mgr.start().catch(() => {})
    mgr.setForced(true)
    return () => { mgr.stop().catch(() => {}) }
  }, [])

  const onFinish = useCallback(() => {
    finish(cadenceTracker?.summary() ?? null)
  }, [finish, cadenceTracker])

  // GPS watcher — a run is always distance-based (set at startActivity('run', ...)).
  useEffect(() => {
    if (isPaused) return
    let watcher: GpsWatcher | null = null
    let cancelled = false
    startGpsWatcher((point) => useActivityStore.getState().appendPoint(point)).then(w => {
      if (cancelled) w.stop(); else watcher = w
    })
    return () => {
      cancelled = true
      watcher?.stop()
    }
  }, [isPaused])

  const splitsSoFar = useMemo(() => computeSplits(rawPoints), [rawPoints])
  const elevationSoFar = useMemo(() => computeElevationChange(rawPoints), [rawPoints])

  const paceLabel = currentPaceSecPerKm
    ? `${Math.floor(currentPaceSecPerKm / 60)}:${String(Math.round(currentPaceSecPerKm % 60)).padStart(2, '0')} /km`
    : '--:-- /km'

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex flex-1 flex-col items-center gap-4 px-6 pt-4">
        <span className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">{title || 'Run'}</span>
        <ActivityElapsedClock
          startMs={startMs}
          accumulatedPauseMs={accumulatedPauseMs}
          isPaused={isPaused}
          pauseStartMs={pauseStartMs}
        />

        <div className="flex w-full max-w-xs justify-around text-center">
          <div>
            <p className="text-2xl font-bold tabular-nums">{distanceKm.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">km</p>
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums">{paceLabel}</p>
            <p className="text-xs text-muted-foreground">pace</p>
          </div>
          {cadenceEnabled && <CadenceReadout tracker={cadenceTracker} />}
        </div>

        <RunHrZoneHero targetZoneIds={plan?.prescription?.targets.zoneIds} />

        {rawPoints.length > 1 && <ActivityRouteMap points={rawPoints} className="h-56 w-full" />}

        {(splitsSoFar.length > 0 || elevationSoFar.gainM > 0 || elevationSoFar.lossM > 0) && (
          <div className="w-full rounded-2xl border border-border bg-muted/40 px-4 py-3">
            {splitsSoFar.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {splitsSoFar.map(s => (
                  <span key={s.km} className="tabular-nums text-muted-foreground">
                    km {s.km}: {Math.floor(s.paceSec / 60)}:{String(s.paceSec % 60).padStart(2, '0')}
                  </span>
                ))}
              </div>
            )}
            {(elevationSoFar.gainM > 0 || elevationSoFar.lossM > 0) && (
              <p className="mt-1 text-xs text-muted-foreground">
                ↑ {elevationSoFar.gainM}m · ↓ {elevationSoFar.lossM}m
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-3 px-6 pb-safe-action">
        <button
          type="button"
          onClick={isPaused ? resume : pause}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border py-3.5 text-sm font-bold transition active:scale-95"
        >
          {isPaused ? <PlayIcon size={18} weight="fill" /> : <PauseIcon size={18} weight="fill" />}
          {isPaused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          onClick={onFinish}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold transition active:scale-95"
          style={{ background: 'var(--color-brand)', color: '#000' }}
        >
          <StopIcon size={18} weight="fill" />
          Finish
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/activity/run-active-screen.tsx
git commit -m "feat: add the dedicated run execution screen"
```

---

### Task 5: Wire the branch into the activity mode-router

**Files:**
- Modify: `components/activity/activity-screen.tsx`

- [ ] **Step 1: Branch on `activityType` when `mode === 'active'`**

Replace the file's contents with:

```tsx
'use client'

import { useActivityStore } from '@/lib/stores/activity-store'
import { PreActivityScreen } from './pre-activity-screen'
import { ActiveActivityScreen } from './active-activity-screen'
import { RunActiveScreen } from './run-active-screen'
import { DoneActivityScreen } from './done-activity-screen'

export function ActivityScreen({ userId }: { userId?: string }) {
  const mode = useActivityStore(s => s.mode)
  const activityType = useActivityStore(s => s.activityType)

  if (mode === 'active') return activityType === 'run' ? <RunActiveScreen /> : <ActiveActivityScreen />
  if (mode === 'done') return <DoneActivityScreen userId={userId} />
  return <PreActivityScreen />
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Manual verification (dev server + Playwright)**

`pnpm dev`. Sign in, go to `/running`, tap "Start run" — confirm the new `RunActiveScreen` renders
(elapsed clock, distance/pace, HR/zone hero showing "Waiting"/`—` since no strap/ring is connected
in the sandbox, cadence readout, and — once at least 2 GPS points are simulated or the browser
grants location — the live map). Confirm Pause/Resume and Finish still work, landing on the
existing `DoneActivityScreen` exactly as before (this plan does not touch the done/save path).
Separately, start a **non-run** activity (e.g. "Other") from the generic flow and confirm it still
renders the unmodified `ActiveActivityScreen` — the branch must not regress any other activity type.

- [ ] **Step 4: Commit**

```bash
git add components/activity/activity-screen.tsx
git commit -m "feat: route run activities to the dedicated run execution screen"
```

---

### Task 6: Full gate, version bump, session bookkeeping

**Files:**
- Modify: `package.json`, `lib/changelog.ts`, `projectOverview.md`
- Create: `docs/overview/entries/2026-07-27-cardio-run-execution-screen.md`
- Modify: `docs/implementation-backlog.md`

- [ ] **Step 1: Run the full local gate**

```bash
pnpm lint
node scripts/check-reconcile.js
node scripts/check-push-mutations.js
pnpm typecheck
pnpm test
```

- [ ] **Step 2: Isolated production build**

```bash
rm -rf .next
npm run build
```
(Stop any running `pnpm dev` first.)

- [ ] **Step 3: Version bump + changelog**

Minor bump; changelog entry describing the new live run screen in plain language.

- [ ] **Step 4: Journal entry**

`docs/overview/entries/2026-07-27-cardio-run-execution-screen.md` — what shipped, and explicitly
flag **not verified**: on-device (APK) — live HR requires a real Polar strap or Oura ring, and the
map/GPS path needs a real device fix, neither reachable in the sandbox. Also note the inherited,
pre-existing `ActivityRouteMap` limitation that the map's viewport does not auto-recenter as new
GPS points stream in (react-leaflet's `bounds` prop is effectively mount-time-only) — this is not a
regression introduced by this plan, and fixing it is out of scope here.

- [ ] **Step 5: `projectOverview.md`**

Update the Current Status chain; add a Known Issues row for the on-device-not-verified item above.

- [ ] **Step 6: Backlog update**

In `docs/implementation-backlog.md`'s cardio batch: mark the "Dedicated run execution screen" item
shipped with a pointer note, matching the style of prior items in this batch.

- [ ] **Step 7: Commit and push**

```bash
git add -A
git commit -m "chore: version bump, journal entry and backlog update for the run execution screen"
git push -u origin feat/cardio-run-screen
```

---

## Self-Review Notes

- **Spec coverage:** HR + zone hero ✅ Task 3; GPS distance/pace (already existed in the store) +
  splits-so-far/elevation-so-far ✅ Task 4; live map ✅ Task 4 (reuses `ActivityRouteMap` unchanged);
  cadence ✅ Task 4 (reuses `CadenceReadout` via the extracted hook, Task 2); "shared shape with
  walk/activity, filling whatever each records" ✅ — the branch in Task 5 means non-run activities
  are completely untouched, and the run screen itself reuses every primitive the generic screen
  already used (clock, GPS watcher, map, cadence) rather than reimplementing them.
- **No new stored data, no sync-chain changes:** confirmed — this plan reads the existing
  `running-plan` cache key and the existing `activity-store`; it does not add a repository method,
  a migration, or a `pushMutations` branch. The done/save path (`DoneActivityScreen`,
  `linkPrescribedRun`) is untouched.
- **DRY:** the elapsed-clock leaf (Task 1) and the cadence-tracking lifecycle (Task 2) are
  extracted rather than duplicated into the new screen — both are used unchanged by the existing
  `ActiveActivityScreen` and the new `RunActiveScreen`.
- **Out of scope, by design:** the `ActivityRouteMap` viewport auto-recenter limitation (inherited,
  pre-existing, not introduced here — flagged in Task 6's journal entry per the project's
  no-orphaned-findings convention, not filed as a new backlog row since it's a minor polish item on
  an already-shipped component, not a functional gap in this plan's scope).
- **Type consistency:** `RunPrescription` (Task 4) is the same exported type
  `components/running/prescribed-run-card.tsx` already defines and `RunningPlanContent` already
  imports — no second/drifting shape introduced. `useCadenceTracking`'s return shape
  (`{ tracker, enabled }`) is used identically in both Task 2's edit to `active-activity-screen.tsx`
  and Task 4's `run-active-screen.tsx`.
