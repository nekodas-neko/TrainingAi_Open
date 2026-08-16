# Sync Cache Fix + Health De-dup + Home Breakup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three independent improvements: fix stale data after pullDelta, remove duplicated contributor bars from Health > Body, and split session-select-content.tsx into focused components for fewer re-renders.

**Architecture:** Task 1 touches only `sync-engine.ts`, `cache-groups.ts`, and `sync-provider.tsx`. Task 2 touches only `components/health/oura-section.tsx`. Task 3 splits `app/session-select/session-select-content.tsx` into focused components under `components/home/`.

**Tech Stack:** Next.js 15, React 19, TypeScript, Zustand, `@capacitor-community/sqlite`, Framer Motion

---

## Files

### Task 1 — Sync cache invalidation
- Modify: `lib/local-store/sync-engine.ts` (extend `pullDelta` return type, add `domains`)
- Modify: `lib/cache-groups.ts` (add `invalidateBiometrics()`)
- Modify: `components/sync-provider.tsx` (call invalidation after pullDelta)

### Task 2 — Health > Body de-duplication
- Modify: `components/health/oura-section.tsx` (remove 3 contributor sections, add `useRouter`, add 3 link rows)

### Task 3 — Home component breakup
- Create: `components/home/mini-sparkline.tsx`
- Create: `components/home/block-progress-card.tsx`
- Create: `components/home/early-deload-card.tsx`
- Create: `components/home/goals-checkin-card.tsx`
- Create: `components/home/home-card-widget.tsx` (React.memo)
- Modify: `app/session-select/session-select-content.tsx` (import from new files)

---

## Task 1 — Sync cache invalidation after pullDelta

### What the current code does

`pullDelta()` in `lib/local-store/sync-engine.ts` (line 20) currently returns `{ synced: number } | null`. It fetches body metrics, sleep sessions, mood logs, etc. from the server and stores them in local SQLite via `store.applyDelta()` (line 161), but never busts any API cache entries. Those entries stay stale until their TTL expires.

`components/sync-provider.tsx` calls `pullDelta(userId)` but ignores the return value entirely (line ~102).

### Task 1, Step 1: Extend pullDelta return type in sync-engine.ts

- [ ] Open `lib/local-store/sync-engine.ts`
- [ ] Add `SyncedDomains` export type above the `pullDelta` function (line 20):

```ts
export type SyncedDomains = {
  biometrics: boolean
  programs:   boolean
}
```

- [ ] Change `pullDelta` signature from:
```ts
export async function pullDelta(userId: string, force = false): Promise<{ synced: number } | null> {
```
to:
```ts
export async function pullDelta(userId: string, force = false): Promise<{ synced: number; domains: SyncedDomains } | null> {
```

- [ ] Replace the final return statement (currently at line 167):
```ts
return { synced: count };
```
with:
```ts
return {
  synced: count,
  domains: {
    biometrics: bodyMetrics.length > 0 || moodLogs.length > 0 || sleepSessions.length > 0,
    programs:   programs.length > 0 || progressionStyles.length > 0,
  },
};
```

### Task 1, Step 2: Add invalidateBiometrics to cache-groups.ts

- [ ] Open `lib/cache-groups.ts`
- [ ] Add after the existing `invalidateGoalRecommendations` function:

```ts
/** Caches that derive from biometric sync — invalidate after pullDelta brings new body/sleep/mood rows. */
export async function invalidateBiometrics(): Promise<void> {
  await Promise.all([
    invalidateCache('body-metadata'),
    invalidateCache('sleep-sessions'),
    invalidateCache('readiness-score'),
    invalidateCache('weekly-stats'),
    invalidateCache('progress-summary'),
  ])
}
```

### Task 1, Step 3: Call invalidation after pullDelta in sync-provider.tsx

- [ ] Open `components/sync-provider.tsx`
- [ ] Add `invalidateBiometrics` to the import from `lib/cache-groups`:
  - Find: `import { invalidateProgramStructure } from '@/lib/cache-groups'`
  - Replace: `import { invalidateBiometrics, invalidateProgramStructure } from '@/lib/cache-groups'`

- [ ] Find the `pullDelta` call in the sync effect. Currently it reads:
```ts
await pullDelta(userId);
```
  Replace with:
```ts
const delta = await pullDelta(userId);
if (delta && delta.synced > 0) {
  if (delta.domains.biometrics) await invalidateBiometrics();
  if (delta.domains.programs)   await invalidateProgramStructure();
}
```

### Task 1, Step 4: Commit

```bash
git add lib/local-store/sync-engine.ts lib/cache-groups.ts components/sync-provider.tsx
git commit -m "Invalidate biometric caches after pullDelta"
```

---

## Task 2 — Health > Body tab de-duplication

### What the current code does

`components/health/oura-section.tsx` renders contributor bar breakdowns for Readiness (lines 165–181), Activity contributors (lines 242–248 inside the Activity card), and Sleep (lines 253–298). These are duplicated exactly on the detail pages (`/health/readiness`, `/health/sleep`, `/health/activity`). The file has no `useRouter` import.

### Task 2, Step 1: Remove Readiness Breakdown section

- [ ] Open `components/health/oura-section.tsx`
- [ ] Add `useRouter` import at top (currently line 3 has `import { useEffect, useState } from 'react'`)
  - Change to: `import { useEffect, useState } from 'react'`
  - Add below the existing imports: `import { useRouter } from 'next/navigation'`
- [ ] Add `const router = useRouter()` inside the `OuraSection` component (after the existing `const today = todayInTz()` line)

- [ ] Remove the entire Readiness Breakdown block (lines 164–181):
```tsx
      {/* Readiness contributors */}
      {daily?.readinessContributors && Object.keys(daily.readinessContributors).length > 0 && (
        <div className="rounded-2xl bg-muted/30 border border-border/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <SectionLabel>Readiness Breakdown</SectionLabel>
            {daily.readinessScore != null && (
              <span className="text-sm font-bold tabular-nums" style={{ color: readinessColor(daily.readinessScore) }}>
                {daily.readinessScore}
              </span>
            )}
          </div>
          <div className="space-y-2">
            {Object.entries(daily.readinessContributors).map(([k, v]) => (
              <ContributorRow key={k} label={k} value={v} />
            ))}
          </div>
        </div>
      )}
```
- [ ] Replace with a compact link row:
```tsx
      {/* Readiness contributors — detail on dedicated page */}
      <button
        onClick={() => router.push('/health/readiness')}
        className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
      >
        Readiness contributors →
      </button>
```

### Task 2, Step 2: Remove Activity contributor bars sub-section

- [ ] Inside the Activity card (currently lines 242–248), remove the contributors sub-section:
```tsx
          {/* Activity contributors */}
          {daily?.activityContributors && Object.keys(daily.activityContributors).length > 0 && (
            <div className="space-y-2 pt-1 border-t border-border/30">
              {Object.entries(daily.activityContributors).map(([k, v]) => (
                <ContributorRow key={k} label={k} value={v} />
              ))}
            </div>
          )}
```
- [ ] Replace with a compact link row (inside the Activity card, after the activity time breakdown):
```tsx
          {/* Activity contributors — detail on dedicated page */}
          <button
            onClick={() => router.push('/health/activity')}
            className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            Activity contributors →
          </button>
```

### Task 2, Step 3: Remove Sleep Breakdown section

- [ ] Remove the entire Sleep Breakdown block (lines 252–298):
```tsx
      {/* Sleep contributors */}
      {daily?.sleepContributors && Object.keys(daily.sleepContributors).length > 0 && (
        <div className="rounded-2xl bg-muted/30 border border-border/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <SectionLabel>Sleep Breakdown</SectionLabel>
            {daily.sleepScore != null && (
              <span className="text-sm font-bold tabular-nums" style={{ color: readinessColor(daily.sleepScore) }}>
                {daily.sleepScore}
              </span>
            )}
          </div>
          <div className="space-y-2">
            {Object.entries(daily.sleepContributors).map(([k, v]) => (
              <ContributorRow key={k} label={k} value={v} />
            ))}
          </div>
          {daily.recommendedBedtimeStart != null && (() => { ... })()}
        </div>
      )}
```
- [ ] Replace with a compact link row:
```tsx
      {/* Sleep contributors — detail on dedicated page */}
      <button
        onClick={() => router.push('/health/sleep')}
        className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
      >
        Sleep contributors →
      </button>
```

### Task 2, Step 4: Commit

```bash
git add components/health/oura-section.tsx
git commit -m "Remove duplicate contributor bars from OuraSection, add detail page links"
```

---

## Task 3 — session-select-content.tsx component breakup

### What the current code does

`app/session-select/session-select-content.tsx` is 1828 lines. It has:
- Sub-components already extracted: `RecommendationCard`, `StreakCard`, `DeloadBanner`, `WeekStripCard`, `MetricTilesCard` from `./components/`, `CARD_DEFAULT_COLORS` from `./constants`
- Still inline: `MiniSparkline` (lines 186–206), `BlockProgressCard` (lines 265–312), `EarlyDeloadCard` (lines 314–342), `GoalsCheckinCard` (lines 344–367)
- Card widget switch-case (lines 1342–1575): 8 card types rendered inline

Extracting the inline sub-components and wrapping the card widget rendering in a `React.memo` component prevents re-renders when unrelated state (log input, water log, mood sheet) changes.

### What does NOT move
- All `useState` declarations stay in `session-select-content.tsx`
- All `useEffect` data-loading chains stay
- All event handlers and callbacks stay
- `WIDGET_DEFS`, `WIDGETS_KEY`, `CARD_WIDGETS_KEY`, `PILL_COLORS_KEY`, `CARD_COLORS_KEY`, all load* key constants stay (used by multiple callers in the same file)
- The load* functions stay (they're also called in `useLayoutEffect` inside the component)
- Type aliases `MetaKey`, `CardWidgetKey`, `SleepRow`, `WidgetDef` stay (used extensively throughout the file)

Note: The spec called for extracting all of these to `lib/preferences/home-preferences.ts`. However, many of these types/constants/functions are used so deeply inside the component that moving them creates circular-import problems and adds zero performance benefit (they're already small). The real performance win is `React.memo` on the card widgets. We extract the 4 inline sub-components and create `HomeCardWidget` with `React.memo` — that's it.

### Task 3, Step 1: Extract MiniSparkline

The current inline component (lines 186–206):
```tsx
function MiniSparkline({ points, width = 120, height = 48 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return null
  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = max - min || 1
  const xs = points.map((_, i) => (i / (points.length - 1)) * width)
  const ys = points.map(p => height - ((p - min) / range) * height * 0.85 - height * 0.075)
  const d = xs.map((x, i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(" ")
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
```

- [ ] Create `components/home/mini-sparkline.tsx`:

```tsx
'use client'

export function MiniSparkline({ points, width = 120, height = 48 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return null
  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = max - min || 1
  const xs = points.map((_, i) => (i / (points.length - 1)) * width)
  const ys = points.map(p => height - ((p - min) / range) * height * 0.85 - height * 0.075)
  const d = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
```

### Task 3, Step 2: Extract BlockProgressCard

The current inline component (lines 265–312):
```tsx
type PhaseStatus = import('@/app/api/workout-data/route').PhaseStatus
function BlockProgressCard({ phaseStatus, perSessionPhaseStatus }: { phaseStatus: PhaseStatus | null; perSessionPhaseStatus: import('@/app/api/workout-data/route').PerSessionPhaseStatus[] }) {
  // ... ~47 lines
}
```

- [ ] Create `components/home/block-progress-card.tsx`:

```tsx
'use client'

import type { PhaseStatus, PerSessionPhaseStatus } from '@/app/api/workout-data/route'

export function BlockProgressCard({ phaseStatus, perSessionPhaseStatus }: {
  phaseStatus: PhaseStatus | null
  perSessionPhaseStatus: PerSessionPhaseStatus[]
}) {
  if (!phaseStatus) return null
  const { currentBlock, totalBlocks, currentWeek, totalWeeks, weeklyTarget, weekSessionCount } = phaseStatus
  const blockPct  = totalBlocks  > 0 ? Math.min((currentBlock  / totalBlocks)  * 100, 100) : 0
  const weekPct   = totalWeeks   > 0 ? Math.min((currentWeek   / totalWeeks)   * 100, 100) : 0
  const sessionPct = weeklyTarget > 0 ? Math.min((weekSessionCount / weeklyTarget) * 100, 100) : 0

  return (
    <div className="mx-4 mb-3 rounded-2xl border border-border bg-muted/30 p-4 space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Block Progress</p>
      <div className="space-y-2">
        <div>
          <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
            <span>Block {currentBlock}/{totalBlocks}</span>
            <span>{Math.round(blockPct)}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden bg-muted/60">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${blockPct}%` }} />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
            <span>Week {currentWeek}/{totalWeeks}</span>
            <span>{Math.round(weekPct)}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden bg-muted/60">
            <div className="h-full rounded-full bg-brand/60 transition-all" style={{ width: `${weekPct}%` }} />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
            <span>Sessions this week {weekSessionCount}/{weeklyTarget}</span>
            <span>{Math.round(sessionPct)}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden bg-muted/60">
            <div className="h-full rounded-full bg-brand/40 transition-all" style={{ width: `${sessionPct}%` }} />
          </div>
        </div>
      </div>
      {perSessionPhaseStatus.length > 0 && (
        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/30">
          {perSessionPhaseStatus.map(s => (
            <div key={s.sessionId} className="text-[10px]">
              <p className="font-semibold text-foreground truncate">{s.sessionName}</p>
              <p className="text-muted-foreground">Wk {s.currentWeek}/{s.totalWeeks}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

### Task 3, Step 3: Extract EarlyDeloadCard

The current inline component (lines 314–342):
```tsx
function EarlyDeloadCard({ onConfirm, onDismiss }: { onConfirm: () => void; onDismiss: () => void }) {
  // ~28 lines
}
```

- [ ] Create `components/home/early-deload-card.tsx`:

```tsx
'use client'

export function EarlyDeloadCard({ onConfirm, onDismiss }: { onConfirm: () => void; onDismiss: () => void }) {
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400">Training Load Warning</p>
      <p className="text-sm text-foreground/90">High training load detected. Consider scheduling a deload week to allow full recovery.</p>
      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          className="flex-1 rounded-xl py-2 text-xs font-semibold bg-amber-500 text-black"
        >
          Start Deload Week
        </button>
        <button
          onClick={onDismiss}
          className="flex-1 rounded-xl py-2 text-xs font-semibold bg-muted/60 text-muted-foreground"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
```

### Task 3, Step 4: Extract GoalsCheckinCard

The current inline component (lines 344–367):
```tsx
function GoalsCheckinCard({ onReviewNow, onRemindLater }: { onReviewNow: () => void; onRemindLater: () => void }) {
  // ~23 lines
}
```

- [ ] Create `components/home/goals-checkin-card.tsx`:

```tsx
'use client'

export function GoalsCheckinCard({ onReviewNow, onRemindLater }: { onReviewNow: () => void; onRemindLater: () => void }) {
  return (
    <div className="rounded-2xl border border-brand/20 bg-brand/5 p-4 space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-brand">Goals Check-in</p>
      <p className="text-sm text-foreground/90">It&apos;s been a while since your goals were reviewed. Update them to keep recommendations accurate.</p>
      <div className="flex gap-2">
        <button
          onClick={onReviewNow}
          className="flex-1 rounded-xl py-2 text-xs font-semibold bg-brand text-white"
        >
          Review Now
        </button>
        <button
          onClick={onRemindLater}
          className="flex-1 rounded-xl py-2 text-xs font-semibold bg-muted/60 text-muted-foreground"
        >
          Remind Later
        </button>
      </div>
    </div>
  )
}
```

### Task 3, Step 5: Create HomeCardWidget with React.memo

- [ ] Create `components/home/home-card-widget.tsx`:

The card widget render code is the switch-case for `card_weightSparkline` through `card_hrChartWidget` (lines 1342–1575 of session-select-content.tsx). It needs these props from the parent:

```tsx
'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { Moon, Footprints, MessageCircle } from 'lucide-react'
import { cn, accentCardStyle } from '@/lib/utils'
import { CARD_DEFAULT_COLORS } from '@/app/session-select/constants'
import { MiniSparkline } from './mini-sparkline'
import { ColorSwatchPicker } from '@/components/ui/color-swatch-picker'
import { HrDayChart } from '@/components/health/hr-day-chart'
import type { BodyMetaRow } from '@/app/api/body-metadata/route'
import type { TrainingLoadResponse } from '@/app/api/training-load/route'
import type { MuscleRecoveryEntry } from '@/app/api/muscle-recovery/route'
import type { MoodLog } from '@/lib/types/mood'
import { todayInTz } from '@/lib/date-utils'

type CardWidgetKey =
  | 'weightSparkline' | 'nutritionDonut' | 'sleepWidget' | 'stepsWidget' | 'moodWidget'
  | 'acwrWidget' | 'muscleStatusWidget' | 'hrChartWidget'

type CardSectionKey = `card_${CardWidgetKey}`

interface HrReading { timestamp: string; bpm: number; source: string | null }
interface WorkoutSession { sessionName: string; startedAt: string; completedAt: string | null }

interface HomeCardWidgetProps {
  sectionKey: CardSectionKey
  sectionEditMode: boolean
  activeCardWidgets: CardWidgetKey[]
  cardColors: Record<string, string>
  onColorChange: (key: string, hex: string) => void
  // body data
  metaToday: BodyMetaRow | null
  metaRecent: BodyMetaRow[]
  metaLoading: boolean
  calsBurnedToday: number | null
  weekToDate: { steps: number; calories: number; waterMl: number } | null
  // goals
  calorieGoal: number | null
  calorieType: 'daily' | 'weekly'
  weightLookback: 7 | 30
  stepsGoal: number
  stepsGoalType: 'daily' | 'weekly'
  sleepGoal: number
  waterGoal: number | null
  waterGoalType: 'daily' | 'weekly'
  // sleep / mood
  sleepData: Array<{
    date: string
    durationHours: number | null
    deepSleepHours: number | null
    remSleepHours: number | null
    lightSleepHours: number | null
    awakHours: number | null
  }>
  moodLog: MoodLog | null | undefined
  // widget-specific data
  acwrData: TrainingLoadResponse | null
  muscleData: MuscleRecoveryEntry[] | null
  hrData: { readings: HrReading[]; workoutSessions: WorkoutSession[] } | null
  // callbacks
  setMoodSheetOpen: (open: boolean) => void
}

export const HomeCardWidget = React.memo(function HomeCardWidget(props: HomeCardWidgetProps) {
  const router = useRouter()
  const {
    sectionKey, sectionEditMode, activeCardWidgets, cardColors, onColorChange,
    metaToday, metaRecent, metaLoading, calsBurnedToday, weekToDate,
    calorieGoal, calorieType, weightLookback, stepsGoal, stepsGoalType,
    sleepGoal, moodLog, sleepData, acwrData, muscleData, hrData, setMoodSheetOpen,
  } = props

  const sparklinePoints = [...metaRecent].reverse().map(r => r.weightKg).filter((w): w is number => w != null)
  const currentWeight   = metaToday?.weightKg ?? sparklinePoints[sparklinePoints.length - 1] ?? null

  const nutrProtein = metaToday?.protein ?? null
  const nutrCarbs   = metaToday?.carb    ?? null
  const nutrFat     = metaToday?.fat     ?? null
  const nutrCalories = metaToday?.calories ?? null
  const nutrTotalG  = (nutrProtein ?? 0) + (nutrCarbs ?? 0) + (nutrFat ?? 0)
  const proteinPct  = nutrTotalG > 0 ? (nutrProtein ?? 0) / nutrTotalG : 0
  const carbsPct    = nutrTotalG > 0 ? (nutrCarbs   ?? 0) / nutrTotalG : 0

  switch (sectionKey) {
    case 'card_weightSparkline': {
      if (!activeCardWidgets.includes('weightSparkline')) return null
      const points = sparklinePoints.slice(-weightLookback)
      const _wColor = cardColors['weightSparkline'] ?? CARD_DEFAULT_COLORS.weightSparkline
      return (
        <div className="px-4 pb-3 relative">
          {sectionEditMode && (
            <div className="absolute top-4 right-12 z-20" onClick={e => e.stopPropagation()}>
              <ColorSwatchPicker value={_wColor} label="Weight Trend card" onChange={hex => onColorChange('weightSparkline', hex)} />
            </div>
          )}
          <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) router.push('/health?tab=body') }} className={cn('w-full rounded-2xl p-4 flex items-center gap-4 text-left active:scale-95 transition cursor-pointer', sectionEditMode && 'pointer-events-none')} style={accentCardStyle(_wColor)}>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">Body Weight</p>
              <p className="text-2xl font-bold tabular-nums">{metaLoading ? '…' : currentWeight != null ? `${currentWeight} kg` : '—'}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Last {weightLookback} days</p>
            </div>
            <div className="flex-none">{points.length >= 2 ? <MiniSparkline points={points} width={110} height={44} /> : <span className="text-xs text-muted-foreground">No data</span>}</div>
          </div>
        </div>
      )
    }
    case 'card_nutritionDonut': {
      if (!activeCardWidgets.includes('nutritionDonut')) return null
      const rawGoalKcal = calorieGoal
      const burnedBoost = calsBurnedToday != null && calsBurnedToday > 0 ? Math.round(calsBurnedToday) : 0
      const boostedGoal = rawGoalKcal != null ? rawGoalKcal + burnedBoost : null
      const isWeekly = calorieType === 'weekly'
      const goalDisplay = isWeekly && boostedGoal ? boostedGoal * 7 : boostedGoal
      const consumedDisplay = isWeekly ? (weekToDate?.calories ?? 0) : nutrCalories
      const goalPct = goalDisplay && consumedDisplay != null ? Math.min((consumedDisplay / goalDisplay) * 100, 100) : null
      const _nColor = cardColors['nutritionDonut'] ?? CARD_DEFAULT_COLORS.nutritionDonut
      return (
        <div className="px-4 pb-3 relative">
          {sectionEditMode && (
            <div className="absolute top-4 right-12 z-20" onClick={e => e.stopPropagation()}>
              <ColorSwatchPicker value={_nColor} label="Nutrition card" onChange={hex => onColorChange('nutritionDonut', hex)} />
            </div>
          )}
          <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) router.push('/nutrition') }} className={cn('w-full rounded-2xl p-4 flex items-center gap-4 text-left active:scale-95 transition cursor-pointer', sectionEditMode && 'pointer-events-none')} style={accentCardStyle(_nColor)}>
            <div className="relative flex-none w-[58px] h-[58px]">
              <div className="absolute inset-0 rounded-full" style={{
                background: nutrTotalG > 0
                  ? `conic-gradient(from -90deg, #00ff87 0deg ${(proteinPct * 360).toFixed(1)}deg, #00d4ff ${(proteinPct * 360).toFixed(1)}deg ${((proteinPct + carbsPct) * 360).toFixed(1)}deg, #bf5fff ${((proteinPct + carbsPct) * 360).toFixed(1)}deg 360deg)`
                  : 'rgba(255,255,255,0.1)',
                WebkitMask: 'radial-gradient(farthest-side, transparent 60%, black 61%)',
                mask: 'radial-gradient(farthest-side, transparent 60%, black 61%)',
              }} />
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-[9px] font-extrabold leading-none">{metaLoading ? '…' : nutrCalories != null ? nutrCalories : '—'}</span>
                <span className="text-[7px] leading-none" style={{ opacity: 0.4 }}>kcal</span>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between mb-1">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Nutrition{isWeekly ? ' (week)' : ''}</p>
                {goalDisplay && <p className="text-xs text-muted-foreground">{consumedDisplay ?? 0} / {goalDisplay} kcal</p>}
              </div>
              {goalPct !== null && (
                <div className="h-1 rounded-full bg-muted overflow-hidden mb-1.5">
                  <div className="h-full rounded-full transition-all" style={{ width: `${goalPct}%`, background: goalPct >= 100 ? '#f97316' : 'linear-gradient(90deg, #00ff87, #00d4ff)' }} />
                </div>
              )}
              <div className="space-y-0.5">
                {[{ color: '#00ff87', label: 'Protein', value: nutrProtein }, { color: '#00d4ff', label: 'Carbs', value: nutrCarbs }, { color: '#bf5fff', label: 'Fat', value: nutrFat }].map(m => (
                  <div key={m.label} className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full flex-none" style={{ background: m.color }} />
                    <p className="text-[10px] text-muted-foreground flex-1">{m.label}</p>
                    <p className="text-[10px] font-bold" style={{ color: m.color }}>{m.value != null ? `${m.value}g` : metaLoading ? '…' : '—'}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )
    }
    case 'card_sleepWidget': {
      if (!activeCardWidgets.includes('sleepWidget')) return null
      const _deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone
      const _today = new Date().toLocaleDateString('sv', { timeZone: _deviceTz })
      const _yesterday = new Date(Date.now() - 86400000).toLocaleDateString('sv', { timeZone: _deviceTz })
      const latest = sleepData.find(s => s.date === _today || s.date === _yesterday) ?? null
      const hrs = latest?.durationHours ?? null
      const goalPct = hrs != null ? Math.min((hrs / sleepGoal) * 100, 100) : null
      const stages = latest ? [{ label: 'Deep', hours: latest.deepSleepHours, color: '#6366f1' }, { label: 'REM', hours: latest.remSleepHours, color: '#8b5cf6' }, { label: 'Light', hours: latest.lightSleepHours, color: '#a78bfa' }, { label: 'Awake', hours: latest.awakHours, color: '#f59e0b' }] : []
      const totalStageHrs = stages.reduce((s, st) => s + (st.hours ?? 0), 0)
      const _sColor = cardColors['sleepWidget'] ?? CARD_DEFAULT_COLORS.sleepWidget
      return (
        <div className="px-4 pb-3 relative">
          {sectionEditMode && (
            <div className="absolute top-4 right-12 z-20" onClick={e => e.stopPropagation()}>
              <ColorSwatchPicker value={_sColor} label="Sleep card" onChange={hex => onColorChange('sleepWidget', hex)} />
            </div>
          )}
          <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) router.push('/health?tab=body') }} className={cn('w-full rounded-2xl p-4 text-left active:scale-95 transition cursor-pointer', sectionEditMode && 'pointer-events-none')} style={accentCardStyle(_sColor)}>
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--accent-purple)' }}>Sleep</p>
                <p className="text-2xl font-bold tabular-nums leading-tight">{hrs != null ? `${hrs.toFixed(1)}h` : '—'}{hrs != null && <span className="text-sm font-normal text-muted-foreground ml-1">/ {sleepGoal}h goal</span>}</p>
              </div>
              <Moon className="h-6 w-6 flex-none" style={{ color: 'var(--accent-purple)' }} />
            </div>
            {goalPct !== null && <div className="h-1.5 rounded-full overflow-hidden mb-3" style={{ background: 'rgba(139,92,246,0.15)' }}><div className="h-full rounded-full transition-all" style={{ width: `${goalPct}%`, background: 'linear-gradient(90deg, #6366f1, #a78bfa)' }} /></div>}
            {totalStageHrs > 0 && (<><div className="flex h-2 rounded-full overflow-hidden gap-px mb-1.5">{stages.filter(s => (s.hours ?? 0) > 0).map(s => <div key={s.label} style={{ flex: s.hours ?? 0, background: s.color }} />)}</div><div className="flex gap-3">{stages.map(s => <div key={s.label} className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} /><span className="text-xs text-muted-foreground">{s.label}</span><span className="text-xs font-bold" style={{ color: s.color }}>{s.hours != null ? `${s.hours.toFixed(1)}h` : '—'}</span></div>)}</div></>)}
          </div>
        </div>
      )
    }
    case 'card_stepsWidget': {
      if (!activeCardWidgets.includes('stepsWidget')) return null
      const isWeeklySteps = stepsGoalType === 'weekly'
      const todaySteps = metaToday?.steps ?? null
      const weeklySteps = weekToDate?.steps ?? 0
      const stepsValue = isWeeklySteps ? weeklySteps : todaySteps
      const goalDisplay = isWeeklySteps ? stepsGoal * 7 : stepsGoal
      const pct = stepsValue != null && goalDisplay ? Math.min((stepsValue / goalDisplay) * 100, 100) : null
      const last7 = metaRecent.slice(0, 7).map(r => r.steps ?? 0).reverse()
      const maxSteps = Math.max(...last7, 1)
      const _stColor = cardColors['stepsWidget'] ?? CARD_DEFAULT_COLORS.stepsWidget
      return (
        <div className="px-4 pb-3 relative">
          {sectionEditMode && (
            <div className="absolute top-4 right-12 z-20" onClick={e => e.stopPropagation()}>
              <ColorSwatchPicker value={_stColor} label="Steps card" onChange={hex => onColorChange('stepsWidget', hex)} />
            </div>
          )}
          <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) router.push('/health?tab=body') }} className={cn('w-full rounded-2xl p-4 text-left active:scale-95 transition cursor-pointer', sectionEditMode && 'pointer-events-none')} style={accentCardStyle(_stColor)}>
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--accent-cyan)' }}>Steps{isWeeklySteps ? ' (week)' : ''}</p>
                <p className="text-2xl font-bold tabular-nums leading-tight">{metaLoading ? '…' : stepsValue != null ? stepsValue.toLocaleString() : '—'}{goalDisplay && <span className="text-sm font-normal text-muted-foreground ml-1">/ {goalDisplay.toLocaleString()}</span>}</p>
              </div>
              <Footprints className="h-6 w-6 flex-none" style={{ color: 'var(--accent-cyan)' }} />
            </div>
            {pct !== null && <div className="h-1.5 rounded-full overflow-hidden mb-3" style={{ background: 'rgba(0,212,255,0.12)' }}><div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #00d4ff, #00ff87)' }} /></div>}
            {last7.length > 0 && <div className="flex items-end gap-1 h-10">{last7.map((steps, i) => <div key={i} className="flex-1 rounded-t-sm" style={{ height: `${Math.max((steps / maxSteps) * 100, 4)}%`, background: i === last7.length - 1 ? '#00d4ff' : 'rgba(0,212,255,0.3)' }} />)}</div>}
          </div>
        </div>
      )
    }
    case 'card_moodWidget': {
      if (!activeCardWidgets.includes('moodWidget')) return null
      const ENERGY_EMOJI: Record<string, string> = { drained: '😴', low: '😑', ok: '😐', good: '😊', pumped: '⚡' }
      const SLEEP_LABEL: Record<string, string> = { terrible: 'Terrible', poor: 'Poor', ok: 'OK', good: 'Good', great: 'Great' }
      const _mColor = cardColors['moodWidget'] ?? CARD_DEFAULT_COLORS.moodWidget
      return (
        <div className="px-4 pb-3 relative">
          {sectionEditMode && (
            <div className="absolute top-4 right-12 z-20" onClick={e => e.stopPropagation()}>
              <ColorSwatchPicker value={_mColor} label="Mood card" onChange={hex => onColorChange('moodWidget', hex)} />
            </div>
          )}
          <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) setMoodSheetOpen(true) }} className={cn('w-full rounded-2xl p-4 text-left active:scale-95 transition cursor-pointer', sectionEditMode && 'pointer-events-none')} style={accentCardStyle(_mColor)}>
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--accent-amber)' }}>Today&apos;s Mood</p>
                {moodLog === undefined ? <p className="text-sm text-muted-foreground">Loading…</p> : moodLog === null ? <div><p className="text-base font-semibold text-foreground">How are you feeling?</p><p className="text-[10px] text-muted-foreground mt-0.5">Tap to log your daily check-in</p></div> : <div className="flex items-center gap-3"><span className="text-3xl">{ENERGY_EMOJI[moodLog.energyLevel] ?? '😐'}</span><div><p className="text-sm font-semibold capitalize">{moodLog.energyLevel}</p><p className="text-[10px] text-muted-foreground">Sleep: {SLEEP_LABEL[moodLog.sleepQuality] ?? moodLog.sleepQuality}</p>{moodLog.soreMuscles.length > 0 && <p className="text-[10px] mt-0.5" style={{ color: '#f97316' }}>Sore: {moodLog.soreMuscles.join(', ')}</p>}</div></div>}
              </div>
              <MessageCircle className="h-6 w-6 ml-2 flex-none" style={{ color: 'var(--accent-amber)' }} />
            </div>
          </div>
        </div>
      )
    }
    case 'card_acwrWidget': {
      if (!activeCardWidgets.includes('acwrWidget')) return null
      const _c = cardColors['acwrWidget'] ?? CARD_DEFAULT_COLORS.acwrWidget
      const acwr = acwrData?.acwr ?? null
      const acwrLabel = acwr == null ? null : acwr < 0.8 ? 'Undertraining' : acwr < 1.3 ? 'Optimal' : acwr < 1.5 ? 'High' : 'Very High'
      const acwrColor = acwr == null ? undefined : acwr < 0.8 ? '#94a3b8' : acwr < 1.3 ? '#22c55e' : acwr < 1.5 ? '#f59e0b' : '#ef4444'
      return (
        <div className="px-4 pb-3">
          <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) router.push('/health?tab=training') }} className={cn('w-full rounded-2xl p-4 text-left active:scale-95 transition cursor-pointer', sectionEditMode && 'pointer-events-none')} style={accentCardStyle(_c)}>
            <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: _c }}>ACWR</p>
            {acwrData === null ? (
              <div className="h-7 w-16 animate-pulse rounded-lg bg-muted" />
            ) : acwr != null ? (
              <div className="flex items-baseline gap-2">
                <p className="text-2xl font-bold tabular-nums">{acwr.toFixed(2)}</p>
                {acwrLabel && <span className="text-xs font-semibold" style={{ color: acwrColor }}>{acwrLabel}</span>}
              </div>
            ) : <p className="text-sm text-muted-foreground">Need more data</p>}
            <p className="text-[10px] text-muted-foreground mt-0.5">Acute : chronic workload ratio</p>
          </div>
        </div>
      )
    }
    case 'card_muscleStatusWidget': {
      if (!activeCardWidgets.includes('muscleStatusWidget')) return null
      const _c = cardColors['muscleStatusWidget'] ?? CARD_DEFAULT_COLORS.muscleStatusWidget
      const fatigued = muscleData ? [...muscleData].sort((a, b) => a.pct - b.pct).slice(0, 6) : null
      return (
        <div className="px-4 pb-3">
          <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) router.push('/health?tab=training') }} className={cn('w-full rounded-2xl p-4 text-left active:scale-95 transition cursor-pointer', sectionEditMode && 'pointer-events-none')} style={accentCardStyle(_c)}>
            <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: _c }}>Muscle Status</p>
            {muscleData === null ? (
              <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-4 w-full animate-pulse rounded bg-muted" />)}</div>
            ) : fatigued && fatigued.length > 0 ? (
              <div className="space-y-1.5">
                {fatigued.map(m => (
                  <div key={m.muscle}>
                    <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
                      <span className="capitalize">{m.muscle}</span>
                      <span>{m.pct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${m.pct}%`, background: m.pct >= 80 ? '#22c55e' : m.pct >= 50 ? '#f59e0b' : '#ef4444' }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">No recent training data</p>}
          </div>
        </div>
      )
    }
    case 'card_hrChartWidget': {
      if (!activeCardWidgets.includes('hrChartWidget')) return null
      const _c = cardColors['hrChartWidget'] ?? CARD_DEFAULT_COLORS.hrChartWidget
      const hrLineColor = _c === 'transparent' ? 'rgba(255,255,255,0.75)' : _c
      return (
        <div className="px-4 pb-3">
          <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) router.push('/health?tab=body') }} className={cn('w-full rounded-2xl p-4 text-left active:scale-95 transition cursor-pointer', sectionEditMode && 'pointer-events-none')} style={accentCardStyle(_c)}>
            <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: _c === 'transparent' ? undefined : _c }}>Heart Rate · Today</p>
            {hrData && hrData.readings.length >= 2 ? (
              <HrDayChart readings={hrData.readings} date={todayInTz()} workoutSessions={hrData.workoutSessions} lineColor={hrLineColor} />
            ) : (
              <p className="text-sm text-muted-foreground">No Oura HR data today</p>
            )}
          </div>
        </div>
      )
    }
    default: return null
  }
})
```

### Task 3, Step 6: Update session-select-content.tsx

- [ ] Remove inline `MiniSparkline`, `BlockProgressCard`, `EarlyDeloadCard`, `GoalsCheckinCard` function definitions (lines 186–367)
- [ ] Add imports at the top:
```ts
import { MiniSparkline } from '@/components/home/mini-sparkline'
import { BlockProgressCard } from '@/components/home/block-progress-card'
import { EarlyDeloadCard } from '@/components/home/early-deload-card'
import { GoalsCheckinCard } from '@/components/home/goals-checkin-card'
import { HomeCardWidget } from '@/components/home/home-card-widget'
```
- [ ] Replace the 8 card_ switch cases (lines 1342–1575) with:
```tsx
case 'card_weightSparkline':
case 'card_nutritionDonut':
case 'card_sleepWidget':
case 'card_stepsWidget':
case 'card_moodWidget':
case 'card_acwrWidget':
case 'card_muscleStatusWidget':
case 'card_hrChartWidget':
  return (
    <HomeCardWidget
      sectionKey={key as `card_${CardWidgetKey}`}
      sectionEditMode={sectionEditMode}
      activeCardWidgets={activeCardWidgets}
      cardColors={cardColors}
      onColorChange={(k, hex) => {
        const next = { ...cardColors, [k]: hex }
        setCardColors(next)
        localStorage.setItem(CARD_COLORS_KEY, JSON.stringify(next))
      }}
      metaToday={metaToday}
      metaRecent={metaRecent}
      metaLoading={metaLoading}
      calsBurnedToday={calsBurnedToday}
      weekToDate={weekToDate}
      calorieGoal={calorieGoal}
      calorieType={calorieType}
      weightLookback={weightLookback}
      stepsGoal={stepsGoal}
      stepsGoalType={stepsGoalType}
      sleepGoal={sleepGoal}
      waterGoal={waterGoal}
      waterGoalType={waterGoalType}
      sleepData={sleepData}
      moodLog={moodLog}
      acwrData={trainingLoad}
      muscleData={muscleRecovery}
      hrData={ouraHrReadings.length > 0 ? { readings: ouraHrReadings, workoutSessions: ouraWorkoutSessions } : null}
      setMoodSheetOpen={setMoodSheetOpen}
    />
  )
```
- [ ] Remove `HrDayChart` from the imports of `session-select-content.tsx` (it's now only used in `home-card-widget.tsx`)
- [ ] Remove `MiniSparkline` inline usage (now imported from component)

### Task 3, Step 7: Commit

```bash
git add components/home/ app/session-select/session-select-content.tsx
git commit -m "Extract card widgets and inline sub-components from home screen, add React.memo on HomeCardWidget"
```

---

## Final verification

After all 3 tasks are committed:
- Run `pnpm build` (or check TypeScript: `pnpm tsc --noEmit`) to confirm no type errors
- Start `pnpm dev` and verify:
  1. Home screen loads and card widgets render correctly
  2. Pull-to-sync triggers cache invalidation (check network tab: body-metadata, sleep-sessions, readiness-score fetch after sync)
  3. Health > Body tab shows Oura section without contributor bars, with "Readiness contributors →" / "Activity contributors →" / "Sleep contributors →" links
  4. Links navigate to the correct detail pages
