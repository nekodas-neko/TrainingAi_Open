# Sync Cache Fix + Health De-dup + Home Breakup — Design Spec

> **For agentic workers:** Use `superpowers:writing-plans` then `superpowers:executing-plans` to implement this spec.

**Goal:** Three independent improvements: (1) fix stale data after pullDelta, (2) remove duplicated contributor bars from Health > Body, (3) split session-select-content.tsx into focused components for fewer re-renders.

**Architecture:**
- Task 1 touches only `sync-engine.ts` and `sync-provider.tsx` (+ a small cache-groups addition).
- Task 2 touches only `components/health/oura-section.tsx`.
- Task 3 is a pure file-split: no logic changes, just extraction + `React.memo` on card sections.

**Tech Stack:** Next.js 15, React 19, TypeScript, Zustand, `@capacitor-community/sqlite`, Framer Motion

---

## Task 1 — Sync cache invalidation after pullDelta

### Problem

`pullDelta()` in `lib/local-store/sync-engine.ts` fetches body metrics, sleep sessions, mood logs, etc. from the server and stores them in local SQLite. However, it never invalidates the API cache entries that the UI reads from (`readiness-score`, `sleep-sessions`, `body-metadata`). Those entries stay stale until their TTL expires (5–30 min), so data that just arrived from the server isn't visible until the next TTL cycle or app restart.

### Solution

1. **`lib/local-store/sync-engine.ts`** — Extend `pullDelta`'s return type to include which domain groups received rows:

   ```ts
   export type SyncedDomains = {
     biometrics: boolean  // bodyMetrics, sleepSessions, moodLogs
     programs:   boolean  // programs, progressionStyles
   }
   
   // pullDelta returns:
   { synced: number; domains: SyncedDomains } | null
   ```

   After the `applyDelta` call, populate `domains` based on whether each array was non-empty.

2. **`lib/cache-groups.ts`** — Add `invalidateBiometrics()`:

   ```ts
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

3. **`components/sync-provider.tsx`** — After the `pullDelta()` call, inspect the returned domains and invalidate:

   ```ts
   const delta = await pullDelta(userId);
   if (delta && delta.synced > 0) {
     if (delta.domains.biometrics) await invalidateBiometrics();
     if (delta.domains.programs)   await invalidateProgramStructure();
   }
   ```

   Import `invalidateBiometrics` and `invalidateProgramStructure` from `lib/cache-groups`.

### Files

- Modify: `lib/local-store/sync-engine.ts` — extend return type, populate domains
- Modify: `lib/cache-groups.ts` — add `invalidateBiometrics()`
- Modify: `components/sync-provider.tsx` — call invalidation after pullDelta

### What does NOT change

- No changes to `SyncDelta` interface in `repository.ts`
- No new SQLite tables or migrations
- No changes to the Oura or HC sync paths (they already call `invalidateCache('')` via more-content's handlePullSync, which is a full cache nuke — that's fine as-is)

---

## Task 2 — Health > Body tab de-duplication (OuraSection)

### Problem

`components/health/oura-section.tsx` renders full contributor bar breakdowns for Readiness, Sleep, and Activity directly inline in the Health > Body tab. These are duplicated exactly on the detail pages (`/health/readiness`, `/health/sleep`, `/health/activity`). The component is 379 lines; contributor sections add ~120 lines of visual noise with no unique value.

### Solution

Modify `components/health/oura-section.tsx`:

**Remove these sections entirely:**
- "Readiness Breakdown" block (lines ~165–181) — contributor bars for readiness
- "Sleep Breakdown" block (lines ~252–298) — sleep contributor bars + recommended bedtime
- Activity contributor bars sub-section within the "Activity" card (lines ~241–248)

**Keep unchanged:**
- 24h HR chart
- Ring status card (battery, time worn, firmware, size)
- Activity section: score + TDEE + walk equiv + activity time breakdown (stacked bar) — this is NOT on the activity detail page, so keep it
- Stress & Recovery card
- Advanced biometrics card (VO₂ max, vascular age, etc.)

**Add three compact navigation links** after the relevant sections:

```tsx
// After ring status card, before activity card:
<button
  onClick={() => router.push('/health/readiness')}
  className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
>
  Readiness contributors →
</button>

// After the activity card (replacing the removed contributor sub-section):
<button
  onClick={() => router.push('/health/activity')}
  className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
>
  Activity contributors →
</button>

// New compact sleep link card to replace Sleep Breakdown:
<button
  onClick={() => router.push('/health/sleep')}
  className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
>
  Sleep contributors →
</button>
```

Add `useRouter` from `next/navigation` to `oura-section.tsx`.

### Files

- Modify: `components/health/oura-section.tsx` — remove 3 sections, add 3 link rows, add `useRouter`

### What does NOT change

- Detail pages (`/health/readiness`, `/health/sleep`, `/health/activity`) — unchanged
- `components/readiness-card.tsx` — unchanged (home screen uses chip row, not this)
- `app/health/health-content.tsx` — unchanged

---

## Task 3 — session-select-content.tsx component breakup

### Problem

`app/session-select/session-select-content.tsx` is 1828 lines. It contains:
- 8 `load*` preference functions + constants (localStorage read helpers)
- 4 small one-off sub-components (MiniSparkline, BlockProgressCard, EarlyDeloadCard, GoalsCheckinCard)
- 1 large main component with 40+ `useState` calls
- Card widget rendering via a switch-case in a `.map()` loop

Every state update — including minor ones like typing in the weight log input or opening a bottom sheet — re-renders the full 1828 lines including all card widgets. Extracting the card widget section as a `React.memo` component prevents these unnecessary re-renders.

### Extracted files

**`lib/preferences/home-preferences.ts`** — preference loaders and constants:
- `WIDGETS_KEY`, `CARD_WIDGETS_KEY`, `DEFAULT_WIDGETS`, `DEFAULT_CARD_WIDGETS`, `CARD_DEFAULT_COLORS`, `CARD_WIDGET_DEFS`, `NON_CARD_SECTIONS`
- All `load*` functions: `loadPillColors`, `loadCardColors`, `loadWidgets`, `loadCardWidgets`, `loadCalorieGoal`, `loadCalorieType`, `loadWeightLookback`, `loadStepsGoal`, `loadStepsGoalType`, `loadSleepGoal`, `loadWaterGoal`, `loadWaterGoalType`
- `buildDefaultOrder`, `loadSectionOrder`, `loadHiddenSections`
- `aestDateString`, `formatOverlayDate` helper functions
- Type aliases: `MetaKey`, `CardWidgetKey`, `CardSectionKey`, `SectionKey`, `WidgetDef`

**`components/home/mini-sparkline.tsx`** — `MiniSparkline` component

**`components/home/block-progress-card.tsx`** — `BlockProgressCard` component (needs `PhaseStatus` type import from route)

**`components/home/early-deload-card.tsx`** — `EarlyDeloadCard` component

**`components/home/goals-checkin-card.tsx`** — `GoalsCheckinCard` component

**`components/home/home-card-widget.tsx`** — `HomeCardWidget` wrapped in `React.memo`:

```tsx
interface HomeCardWidgetProps {
  sectionKey: CardSectionKey
  activeCardWidgets: CardWidgetKey[]
  cardColors: Record<string, string>
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
  sleepData: SleepRow[]
  moodLog: MoodLog | null | undefined
  // widget-specific data
  acwrData: TrainingLoadResponse | null
  muscleData: { muscles: MuscleRecoveryEntry[] } | null
  hrData: { readings: HrReading[]; workoutSessions: WorkoutSession[] } | null
  // callbacks
  openLog: (key: string, label: string, unit: string, step: number) => void
  setMoodSheetOpen: (open: boolean) => void
  setHistoryEx: (name: string | null) => void
}

export const HomeCardWidget = React.memo(function HomeCardWidget(props: HomeCardWidgetProps) {
  // the existing switch-case for card_* sections moved here verbatim
})
```

### What stays in session-select-content.tsx

- All `useState` declarations
- All `useEffect` data-loading chains
- All event handlers and callbacks
- The drag-sort section order logic
- The top-level JSX render, which now calls `<HomeCardWidget ... />` for card sections
- Imports for all the extracted files

### Performance impact

With `React.memo` on `HomeCardWidget`, the card widgets only re-render when their specific props change (data or callbacks). Minor state changes like `logValue`, `waterLogOpen`, `moodSheetOpen`, `weekOverlay` won't trigger card re-renders — currently they do.

### Files

- Create: `lib/preferences/home-preferences.ts`
- Create: `components/home/mini-sparkline.tsx`
- Create: `components/home/block-progress-card.tsx`
- Create: `components/home/early-deload-card.tsx`
- Create: `components/home/goals-checkin-card.tsx`
- Create: `components/home/home-card-widget.tsx`
- Modify: `app/session-select/session-select-content.tsx` — import from new files, replace inline code

---

## Execution order

Tasks are independent and can be done in any order, but recommended sequence:
1. Task 1 (sync fix) — highest user-facing impact, smallest change
2. Task 2 (health dedup) — UI-only, zero logic change
3. Task 3 (home breakup) — pure refactor, most files touched

Each task should be committed separately.
