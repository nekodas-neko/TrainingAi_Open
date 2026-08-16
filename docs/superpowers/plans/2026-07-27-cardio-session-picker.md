# Cardio Session Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "how much time do you have?" flow to the `/cardio` hub that recommends Run,
Guided walk, or Other activity for the selected time budget — and, when it recommends Run,
surfaces the running program's already-computed recovery-gate reason at the moment of choosing
instead of only after the user has already opened `/running`.

**Architecture:** No new backend route. `/api/running-plan` (existing) already returns
`{ plan, prescription, gateAction, gateReasons, run, ... }`; `/api/cardio-week` (Phase 1)
already returns the zone quota. The client fetches both (reusing the existing `'running-plan'`
cache key — no new cache entry) and a new pure function, `recommendSession()`, combines them
into one of three recommendations. A new bottom sheet renders the minutes picker and the
recommendation; the existing `ModalityPicker` gets a "How much time do you have?" entry point
above it.

**Tech Stack:** TypeScript; pure logic in `lib/health/` (vitest); UI in `components/cardio/`
reusing the existing `Sheet` primitive, `cachedFetchToday`, and theme tokens.

---

## Spec reference

Implements cardio batch item 1 from
[`docs/implementation-backlog.md`](../../implementation-backlog.md) and spec
[`docs/superpowers/specs/2026-07-26-cardio-system-spec.md`](../specs/2026-07-26-cardio-system-spec.md):

| Decision | What this plan does with it |
|---|---|
| **D-9** — the week is a quota filled opportunistically; the picker is a suggestion, never an assignment | The recommendation is always overridable — all three Start buttons stay enabled regardless of which one is highlighted. |
| **D-1** — the hub owns no goal of its own; running owns its own gate | The hub reads running's *existing public API* (`/api/running-plan`) for the gate reason; it does not reimplement or reach into `recovery-gate.ts` internals. |
| Spec §4 "the recommendation is a suggestion, always overridable" | Same as D-9 — no forced navigation, no disabled options. |

**Scoping decision made in this plan (read before implementing):** the recovery-gate reason is
only ever shown for the **Run** option, because `applyRecoveryGate()` takes a running
`Prescription` (its branching depends on `p.type` being a hard/easy run type) — it has no
walk- or activity-equivalent today. Extending the gate to be modality-agnostic (e.g. "should I
push cardio at all today") is explicitly **out of scope** for this plan — it would be new
domain logic, not assembly, and belongs in a future item if the owner wants it. Walk and Other
activity never show a gate note in this version.

---

## Verified current state (2026-07-27 — re-confirm before implementing)

- `GET /api/running-plan` (`app/api/running-plan/route.ts:132`) returns
  `{ plan: {id, frameworkKey} | null, prescription: {type, durationMin, distanceKm, targets, rationale} | null, gateAction?: 'proceed'|'soften'|'rest', gateReasons?: string[], run?: {id, status: 'pending'|'completed'|'skipped'}, zoneTargets?, goal? }`.
  Cache key: `'running-plan'`, fetched via `cachedFetchToday`/`readTodayCacheSync`
  (`components/running/running-plan-content.tsx:44,50`), TTL `RUNNING_PLAN_TTL`
  (`lib/cache-ttl.ts`).
- `GET /api/cardio-week` (Phase 1, `app/api/cardio-week/route.ts`) returns
  `{ week, heart, quota: ZoneQuota, guideline, steps, hasRunningPlan }`. Cache key
  `'cardio-week'`, TTL `CARDIO_WEEK_TTL`.
- `ZoneQuota` / `ZoneQuotaRow` (`lib/health/zone-quota.ts`) — `zones: ZoneQuotaRow[]` where each
  row is `{ zoneId, targetMin, doneMin, remainingMin, pctComplete, status: 'open'|'complete'|'not-required' }`.
- `DEFAULT_WALK_CONFIG = { sets: 5, fastSec: 180, slowSec: 180, warmupSec: 0, cooldownSec: 0 }`
  (`lib/walk/interval-plan.ts:55`) — 5×(180+180) = 1800s = **30 min total**. The "Quick" preset
  referenced in `components/guided-walk/walk-config.tsx` is 3×3/3 = 18 min — read that file's
  preset list before hardcoding a second number here; only the default (30 min) is needed for
  this plan's estimate.
- `HR_ZONE_META` (`lib/health/hr-zones.ts`) — zone id → name/color, used already in
  `ZoneQuotaCard`.
- `Sheet`/`SheetContent`/`SheetHeader`/`SheetTitle`/`SheetFooter` (`components/ui/sheet.tsx`) —
  the primitive `plan-setup-sheet.tsx` already uses for a bottom sheet with a button-row picker.
  Follow that file's structure (`DISTANCES` button-row pattern) for the minutes picker.
- `hapticLight`/`hapticSuccess` (`lib/haptics.ts`).
- Version: check `package.json` (currently `1.212.0`); changelog `lib/changelog.ts` (prepend
  above the top entry, matching its existing shape — see Phase 1's entry for the pattern).

---

## File structure

**Create:**
- `lib/health/session-picker.ts` — the pure `recommendSession()` function.
- `lib/health/__tests__/session-picker.test.ts`
- `components/cardio/time-picker-sheet.tsx` — the bottom sheet: minutes buttons → recommendation
  card → three Start buttons (Run/Walk/Activity), one visually highlighted per the
  recommendation.

**Modify:**
- `components/cardio/modality-picker.tsx` — add a "How much time do you have?" entry above the
  three existing rows, opening `TimePickerSheet`.
- `components/cardio/cardio-content.tsx` — fetch `/api/running-plan` alongside `/api/cardio-week`
  (reusing the existing `'running-plan'` cache key), pass both payloads down to the sheet.
- `lib/changelog.ts` + `package.json` — version bump (final task).

---

## Task 1: The pure recommendation function

**Files:**
- Create: `lib/health/session-picker.ts`
- Test: `lib/health/__tests__/session-picker.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { recommendSession } from '../session-picker'
import type { ZoneQuota } from '../zone-quota'

function quotaWith(zones: Partial<Record<number, { remainingMin: number; status: 'open' | 'complete' | 'not-required' }>>): ZoneQuota {
  const base = [1, 2, 3, 4, 5].map((zoneId) => ({
    zoneId: zoneId as 1 | 2 | 3 | 4 | 5,
    targetMin: 100, doneMin: 0, remainingMin: 100, pctComplete: 0,
    status: 'open' as const,
    ...(zones[zoneId] ?? {}),
  }))
  return { zones: base, trainingTargetMin: 300, trainingDoneMin: 0, trainingRemainingMin: 300 }
}

describe('recommendSession', () => {
  it('recommends run when a pending prescription fits the time budget', () => {
    const rec = recommendSession({
      minutesAvailable: 30,
      runningPlan: {
        hasPlan: true, runPending: true, prescriptionDurationMin: 28,
        prescriptionType: 'easy', gateAction: 'proceed', gateReasons: [],
      },
      quota: quotaWith({}),
    })
    expect(rec.modality).toBe('run')
    expect(rec.reason).toContain('easy run')
  })

  it('does not recommend run when the time budget is too short', () => {
    const rec = recommendSession({
      minutesAvailable: 15,
      runningPlan: {
        hasPlan: true, runPending: true, prescriptionDurationMin: 40,
        prescriptionType: 'long', gateAction: 'proceed', gateReasons: [],
      },
      quota: quotaWith({ 2: { remainingMin: 40, status: 'open' } }),
    })
    expect(rec.modality).not.toBe('run')
  })

  it('does not recommend run when today\'s run is already done', () => {
    const rec = recommendSession({
      minutesAvailable: 30,
      runningPlan: {
        hasPlan: true, runPending: false, prescriptionDurationMin: 30,
        prescriptionType: 'easy', gateAction: 'proceed', gateReasons: [],
      },
      quota: quotaWith({ 2: { remainingMin: 40, status: 'open' } }),
    })
    expect(rec.modality).toBe('walk')
  })

  it('carries the gate reason when recommending a softened run', () => {
    const rec = recommendSession({
      minutesAvailable: 30,
      runningPlan: {
        hasPlan: true, runPending: true, prescriptionDurationMin: 25,
        prescriptionType: 'easy', gateAction: 'soften',
        gateReasons: ['You trained legs hard in the last day — this is an easy run.'],
      },
      quota: quotaWith({}),
    })
    expect(rec.modality).toBe('run')
    expect(rec.gate).toEqual({ action: 'soften', reasons: ['You trained legs hard in the last day — this is an easy run.'] })
  })

  it('recommends walk when there is an open zone gap and no fitting run', () => {
    const rec = recommendSession({
      minutesAvailable: 30,
      runningPlan: { hasPlan: false, runPending: false, prescriptionDurationMin: null, prescriptionType: null, gateAction: null, gateReasons: [] },
      quota: quotaWith({ 2: { remainingMin: 40, status: 'open' } }),
    })
    expect(rec.modality).toBe('walk')
    expect(rec.reason).toContain('Z2')
    expect(rec.estimateMin).toBe(30) // min(minutesAvailable, remainingMin)
  })

  it('recommends activity when the week is fully on track', () => {
    const rec = recommendSession({
      minutesAvailable: 30,
      runningPlan: { hasPlan: false, runPending: false, prescriptionDurationMin: null, prescriptionType: null, gateAction: null, gateReasons: [] },
      quota: quotaWith({
        1: { remainingMin: 0, status: 'complete' }, 2: { remainingMin: 0, status: 'complete' },
        3: { remainingMin: 0, status: 'not-required' }, 4: { remainingMin: 0, status: 'not-required' },
        5: { remainingMin: 0, status: 'not-required' },
      }),
    })
    expect(rec.modality).toBe('activity')
  })

  it('picks the zone with the most remaining minutes when several are open', () => {
    const rec = recommendSession({
      minutesAvailable: 30,
      runningPlan: { hasPlan: false, runPending: false, prescriptionDurationMin: null, prescriptionType: null, gateAction: null, gateReasons: [] },
      quota: quotaWith({ 2: { remainingMin: 10, status: 'open' }, 3: { remainingMin: 50, status: 'open' } }),
    })
    expect(rec.reason).toContain('Z3')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/health/__tests__/session-picker.test.ts`
Expected: FAIL — `Failed to resolve import "../session-picker"`

- [ ] **Step 3: Write the implementation**

```typescript
import type { ZoneQuota } from './zone-quota'
import type { HrZone } from './hr-zones'

// Recommends which cardio modality to open for a given time budget, combining the running
// program's own gate/prescription (read from its public API — never recomputed here, per
// spec D-1: the hub reads running's output, it doesn't reimplement recovery-gate.ts) with the
// hub's zone quota. A suggestion only — every modality stays choosable regardless of the
// result (spec D-9).
//
// SCOPE NOTE: the gate reason only ever attaches to 'run'. applyRecoveryGate() branches on a
// running Prescription's type (hard vs easy), so it has no walk/activity equivalent today —
// extending it to a modality-agnostic "should I push cardio" signal is a bigger, undesigned
// question left for a future item, not assembled here.

export type SessionModality = 'run' | 'walk' | 'activity'

export interface RunningPlanForRecommend {
  hasPlan: boolean
  runPending: boolean
  prescriptionDurationMin: number | null
  prescriptionType: string | null
  gateAction: 'proceed' | 'soften' | 'rest' | null
  gateReasons: string[]
}

export interface SessionRecommendation {
  modality: SessionModality
  reason: string
  /** Only set when modality is 'run' and the gate softened/rested it. */
  gate?: { action: 'soften' | 'rest'; reasons: string[] }
  /** Only set when modality is 'walk' — an estimate of minutes this walk would contribute to
   *  the named zone, never a promise (mirrors the "estimate" framing already used elsewhere). */
  estimateMin?: number
}

const RUN_FIT_SLACK_MIN = 5

export function recommendSession(input: {
  minutesAvailable: number
  runningPlan: RunningPlanForRecommend
  quota: ZoneQuota
}): SessionRecommendation {
  const { minutesAvailable, runningPlan, quota } = input

  const runFits =
    runningPlan.hasPlan &&
    runningPlan.runPending &&
    runningPlan.prescriptionDurationMin != null &&
    minutesAvailable >= runningPlan.prescriptionDurationMin - RUN_FIT_SLACK_MIN

  if (runFits) {
    const rec: SessionRecommendation = {
      modality: 'run',
      reason: `Today's prescribed ${runningPlan.prescriptionType} run fits your time.`,
    }
    if (runningPlan.gateAction === 'soften' || runningPlan.gateAction === 'rest') {
      rec.gate = { action: runningPlan.gateAction, reasons: runningPlan.gateReasons }
    }
    return rec
  }

  const openZones = quota.zones.filter((z) => z.status === 'open' && z.remainingMin > 0)
  if (openZones.length > 0) {
    const biggest = openZones.reduce((a, b) => (b.remainingMin > a.remainingMin ? b : a))
    const meta = ZONE_LABELS[biggest.zoneId]
    return {
      modality: 'walk',
      reason: `A walk would put a dent in your Z${biggest.zoneId} ${meta} minutes for the week.`,
      estimateMin: Math.min(minutesAvailable, biggest.remainingMin),
    }
  }

  return {
    modality: 'activity',
    reason: "You're on track this week — log whatever you feel like.",
  }
}

const ZONE_LABELS: Record<HrZone['id'], string> = {
  1: 'Recovery', 2: 'Light', 3: 'Aerobic', 4: 'Hard', 5: 'Peak',
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/health/__tests__/session-picker.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add lib/health/session-picker.ts lib/health/__tests__/session-picker.test.ts
git commit -m "Add pure session-recommendation function

Combines the running program's own gate/prescription (read from its public
API, never recomputed) with the hub's zone quota to suggest a modality for a
given time budget. The gate reason only ever attaches to the run
recommendation — the recovery gate has no walk/activity equivalent today,
and building one is out of scope for this change."
```

---

## Task 2: Wire `/api/running-plan` into the hub orchestrator

**Files:**
- Modify: `components/cardio/cardio-content.tsx`

- [ ] **Step 1: Read the current file**

Run: `sed -n '1,40p' components/cardio/cardio-content.tsx`

- [ ] **Step 2: Add the running-plan fetch alongside the existing cardio-week fetch**

Add these imports:

```typescript
import { RUNNING_PLAN_TTL } from '@/lib/cache-ttl'
```

Add a `RunningPlanPayload` type and a second piece of state, seeded and fetched the same way as
`data`:

```typescript
interface RunningPlanPayload {
  plan: { id: string; frameworkKey: string } | null
  prescription: { type: string; durationMin: number | null } | null
  gateAction?: 'proceed' | 'soften' | 'rest'
  gateReasons?: string[]
  run?: { id: string; status: 'pending' | 'completed' | 'skipped' }
}
```

Inside `CardioContent`, add:

```typescript
  const [runningPlan, setRunningPlan] = useState<RunningPlanPayload | null>(null)
```

In the `refresh` callback, add a second `cachedFetchToday` call for the **existing** `'running-plan'`
key (do not invent a new key — this is the same cache the `/running` screen already reads):

```typescript
    cachedFetchToday<RunningPlanPayload>('running-plan', '/api/running-plan', RUNNING_PLAN_TTL, (d) => setRunningPlan(d)).catch(() => {})
```

In the seeding `useEffect`, add the matching sync seed:

```typescript
    const runSeed = readTodayCacheSync<RunningPlanPayload>('running-plan')
    if (runSeed) setRunningPlan(runSeed)
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add components/cardio/cardio-content.tsx
git commit -m "Fetch the running plan alongside the cardio week payload

Reuses the existing 'running-plan' cache key the /running screen already
reads — no new cache entry, no new route. Feeds the session picker without
coupling the hub to running's internals."
```

---

## Task 3: The time-picker sheet

**Files:**
- Create: `components/cardio/time-picker-sheet.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { hapticLight } from '@/lib/haptics'
import { Info } from 'lucide-react'
import { recommendSession, type RunningPlanForRecommend, type SessionModality } from '@/lib/health/session-picker'
import type { ZoneQuota } from '@/lib/health/zone-quota'

const MINUTES_OPTIONS = [15, 30, 45, 60]

const MODALITY_LABEL: Record<SessionModality, string> = {
  run: 'Run', walk: 'Guided walk', activity: 'Other activity',
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  quota: ZoneQuota
  runningPlan: RunningPlanForRecommend
  onLogActivity: () => void
}

export function TimePickerSheet({ open, onOpenChange, quota, runningPlan, onLogActivity }: Props) {
  const router = useRouter()
  const [minutes, setMinutes] = useState(30)

  const rec = useMemo(
    () => recommendSession({ minutesAvailable: minutes, runningPlan, quota }),
    [minutes, runningPlan, quota],
  )

  function start(modality: SessionModality) {
    hapticLight()
    onOpenChange(false)
    if (modality === 'run') router.push('/running')
    else if (modality === 'walk') router.push('/activity/guided-walk')
    else onLogActivity()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>How much time do you have?</SheetTitle>
        </SheetHeader>

        <div className="space-y-3 px-4 py-2">
          <div className="flex flex-wrap gap-2">
            {MINUTES_OPTIONS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { hapticLight(); setMinutes(m) }}
                className="rounded-lg border px-3 py-1.5 text-sm transition-colors"
                style={
                  minutes === m
                    ? { borderColor: 'var(--accent-cyan)', background: 'color-mix(in oklch, var(--accent-cyan) 12%, transparent)', fontWeight: 600 }
                    : { borderColor: 'var(--border)', background: 'var(--card)' }
                }
              >
                {m} min
              </button>
            ))}
          </div>

          <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-3.5">
            <p className="text-sm font-semibold">{MODALITY_LABEL[rec.modality]}</p>
            <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">{rec.reason}</p>
            {rec.gate && (
              <div
                className="mt-2.5 flex gap-2 rounded-lg border p-2.5"
                style={{
                  borderColor: 'color-mix(in oklch, var(--accent-amber) 30%, transparent)',
                  background: 'color-mix(in oklch, var(--accent-amber) 10%, transparent)',
                }}
              >
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: 'var(--accent-amber)' }} aria-hidden />
                <p className="text-xs">{rec.gate.reasons.join(' ')}</p>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => start('run')}>Run</Button>
            <Button variant="outline" className="flex-1" onClick={() => start('walk')}>Walk</Button>
            <Button variant="outline" className="flex-1" onClick={() => start('activity')}>Activity</Button>
          </div>
        </div>

        <SheetFooter>
          <Button className="w-full" onClick={() => start(rec.modality)}>
            Start {MODALITY_LABEL[rec.modality]}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/cardio/time-picker-sheet.tsx
git commit -m "Add the time-available picker sheet

Every modality stays a plain button regardless of the recommendation — the
recommendation is a suggestion, never an assignment (spec D-9)."
```

---

## Task 4: Wire the sheet into the hub

**Files:**
- Modify: `components/cardio/cardio-content.tsx`
- Modify: `components/cardio/modality-picker.tsx`

- [ ] **Step 1: Add an entry point above the plain picker**

In `modality-picker.tsx`, add a new prop `onPickTime: () => void` to `Props`, and render a new
row above the existing three `Option`s:

```tsx
      <button
        type="button"
        onClick={onPickTime}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[color:var(--border)] bg-transparent p-3 text-sm font-semibold text-[color:var(--accent-cyan)] transition active:scale-[0.985]"
      >
        How much time do you have?
      </button>
```

Add `onPickTime` to the destructured props in `ModalityPickerImpl`.

- [ ] **Step 2: Render the sheet from `cardio-content.tsx`**

Add state and pass-through:

```typescript
  const [timePickerOpen, setTimePickerOpen] = useState(false)
```

Build the `RunningPlanForRecommend` shape the picker needs from `runningPlan`:

```typescript
  const runningPlanForRecommend = {
    hasPlan: runningPlan?.plan != null,
    runPending: runningPlan?.run?.status === 'pending',
    prescriptionDurationMin: runningPlan?.prescription?.durationMin ?? null,
    prescriptionType: runningPlan?.prescription?.type ?? null,
    gateAction: runningPlan?.gateAction ?? null,
    gateReasons: runningPlan?.gateReasons ?? [],
  }
```

Pass `onPickTime={() => setTimePickerOpen(true)}` to `<ModalityPicker ... />`, and render (only
once `data` has resolved, since the sheet needs the quota):

```tsx
      {data && (
        <TimePickerSheet
          open={timePickerOpen}
          onOpenChange={setTimePickerOpen}
          quota={data.quota}
          runningPlan={runningPlanForRecommend}
          onLogActivity={() => setLogOpen(true)}
        />
      )}
```

Import `TimePickerSheet` from `./time-picker-sheet`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Verify in the dev server**

```bash
pnpm dev
```

Sign in as `test@local.dev` / `testpass123`, open `/cardio`. Expected: a new "How much time do
you have?" row above the three modality options. Tapping it opens the sheet with 15/30/45/60
buttons, a recommendation card, and Run/Walk/Activity buttons all enabled. Since the seed has no
active running plan, the recommendation should be `walk` (an open zone exists) or `activity`
(if the seed's zones happen to show none open) — confirm it is never `run` (no plan exists).

- [ ] **Step 4: Commit**

```bash
git add components/cardio/cardio-content.tsx components/cardio/modality-picker.tsx
git commit -m "Wire the time picker into the cardio hub"
```

---

## Task 5: Full gate + version bump

**Files:**
- Modify: `package.json`, `lib/changelog.ts`

- [ ] **Step 1: Run the full gate**

```bash
npx tsc --noEmit
npm run lint
npx vitest run
node scripts/check-push-mutations.js
npm run build
```

Expected: all green. If `npm run build` collides with a concurrently-running `pnpm dev`
(`.next`-directory ENOENT errors), stop the dev server, `rm -rf .next`, rerun the build in
isolation, then restart the dev server for the manual pass — this is a known artifact from
Phase 1, not a code issue.

- [ ] **Step 2: Bump the version (minor — new user-visible feature)**

Check `package.json`'s current version first (`main` may have moved since this plan was
written) and bump the minor accordingly. Prepend to `CHANGELOG` in `lib/changelog.ts`, above
the current top entry:

```typescript
  {
    version: "<new minor>",
    date: "<today>",
    changes: [
      "The Cardiovascular screen now asks how much time you have and suggests a run, walk or activity to fit it — always your choice, never a lock-in.",
      "When it suggests a run, it shows the same reason your running plan already knows about — like easing off after a heavy leg day — right there in the picker.",
    ],
  },
```

- [ ] **Step 3: Commit and push**

```bash
git add package.json lib/changelog.ts
git commit -m "Bump version for the cardio session picker"
git push -u origin feat/cardio-session-picker
```

---

## Task 6: Session bookkeeping (same PR — CLAUDE.md requires it)

**Files:**
- Create: `docs/overview/entries/YYYY-MM-DD-cardio-session-picker.md`
- Modify: `projectOverview.md`, `docs/implementation-backlog.md`

- [ ] **Step 1: Write the journal entry** (per `docs/overview/entries/README.md` convention —
  a new file, never a prepend).

- [ ] **Step 2: Add a Known-Issues row to `projectOverview.md`** — state plainly that the
  recommendation heuristic is new and unvalidated against real usage (it has never seen a real
  running plan with a real pending prescription in the sandbox — the seed has none), and that
  the walk/activity path has no recovery-gate equivalent by design (see the scope note in
  Task 1).

- [ ] **Step 3: Remove this item's entry from the backlog queue**, renumbering the remaining
  items exactly as Phase 1's session did, and fixing any cross-references to the old numbers
  (grep the whole `docs/` tree for `cardio batch's item` before finishing — Phase 1 found and
  fixed several stale references after a similar renumber).

- [ ] **Step 4: Commit and push**

```bash
git add docs/overview/entries/*cardio-session-picker.md projectOverview.md docs/implementation-backlog.md
git commit -m "Record the cardio session picker session"
git push
```

---

## What this plan deliberately does not do

- **No cross-modality recovery gate.** Walk and Other activity never carry a gate reason —
  extending `recovery-gate.ts` to a modality-agnostic signal is new domain logic, not scoped here.
- **No new API route.** Both data sources the picker needs already exist.
- **No forced navigation.** All three options are always tappable, regardless of the
  recommendation (spec D-9).
- **No walk-duration customization from the picker.** Tapping "Walk" always opens the guided
  walk's own config screen (unchanged) — this plan does not pass the selected minutes through
  to pre-fill the walk's set count.

## Self-review notes

- **Spec coverage:** D-9 (Task 3's plain-button row + Task 4's "always enabled" verification),
  D-1 (Task 2's reuse of `/api/running-plan` rather than reimplementing gate logic).
- **Type consistency:** `SessionModality`/`SessionRecommendation`/`RunningPlanForRecommend`
  defined once in Task 1, imported unchanged in Tasks 3 and 4. `recommendSession(input)` takes
  `{ minutesAvailable, runningPlan, quota }` in both its definition and every call site.
- **Known soft spot flagged inline for the implementer to verify rather than assume:** the guided
  walk's exact preset list (Task "verified current state" note) — only the 30-min default is
  actually used by this plan's estimate, so confirm nothing else references a hardcoded second
  number before assuming this plan's numbers are the only ones in play.
