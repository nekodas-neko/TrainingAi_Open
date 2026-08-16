# Review Round 2 — UI Polish Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship six small, independent, high-visibility UI fixes (findings U4, U7, U8, U9, U10, U13 from `docs/reviews/2026-07-04-user-review-round-2.md`) in one PR.

**Architecture:** All six are UI-layer changes in the Next.js 15 / React 19 / Tailwind v4 client tree. Each is isolated to 1–3 files with no shared blast radius: a CSS tap-target audit (U4), two static-import swaps on the Health page (U7), a shared dial-selector tweak used by both check-in sheets (U8), lifting two pure display helpers into the shared workout util + reusing them on the calendar day-detail (U9), a Nutrition capture-grid reorder + a sixth tile (U10), and a "recommended" badge on the workout carousel (U13). Only U9 introduces exported pure helpers (→ vitest); the rest are visual and verified in-browser at the S25 viewport.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS v4, Radix/shadcn, `motion` v12. Tests: vitest (`pnpm test`), `pnpm tsc --noEmit`, `pnpm lint`, `pnpm build`. Local dev DB via `pnpm db:local` + `pnpm dev`.

**House rules honoured:** Lucide icons never emojis (note: `app/workout-select/workout-select-content.tsx:305` already contains a literal `📅 ` — **leave it**, it belongs to a separate queued emoji sweep, do not touch it here); semantic colours from theme tokens where the surface already uses tokens (the check-in dials are a deliberate exception — see Task 3); `React.memo`/stable-prop discipline; reuse shared primitives over copy-paste.

---

### Task 1: U4 — Strength Trend pager renders as huge grey circles on mobile (tap-target audit)

**Problem:** A global rule `@media (max-width:640px) button { min-height:44px; min-width:44px }` (`app/globals.css:469-472`) floors **every** `<button>` to 44×44 on the phone. The `.tap-dense` opt-out (`app/globals.css:474-477`) exists but has **zero adopters** in the codebase, so intentionally-tiny controls (the Strength Trend pager dots) inflate to 44px grey circles. Desktop (>640px) is unaffected, which is why it was earlier mis-dismissed as a stale build.

**Chosen approach (justified):** **Surgical `tap-dense` opt-out on genuinely-dense controls; keep the global 44px floor.** The addendum floats the "better" idea of deleting the bare-`button` selector and moving the floor into the shared `<Button>` (`components/ui/button.tsx`). That is rejected for this PR: the shared `<Button>` (`buttonVariants`, `components/ui/button.tsx:7-37`) is used in only a fraction of the app — the overwhelming majority of interactive elements are raw `<button>` with padding-only sizing (e.g. the Health "Log" chips `px-3 py-1.5 text-xs` at ~28px tall, the scale-selector rungs, capture-grid tiles). Those raw buttons currently **rely on** the global floor to reach 44px. Deleting the selector would silently shrink dozens of legitimate targets below the tap minimum — a wide-blast-radius regression far larger than the bug it fixes, and not verifiable in the web sandbox (insets/viewport rule is device-gated). The `tap-dense` class was designed for exactly the dense-control case; adopting it is minimal, reversible, and leaves the safety net intact. (The full migration of tap-target sizing into `<Button>` variants is a legitimate follow-up refactor, but it is its own PR, not part of a low-risk polish batch.)

**Files:**
- Modify: `components/health/strength-trend-card.tsx:111-122` (pager dot buttons)
- Audit (add `tap-dense` only where a sub-44px control renders broken at ≤640px): `components/calendar-widget.tsx`, `components/health/oura-section.tsx`, `components/health/injury-card.tsx`, `components/health/achievements-grid.tsx`, `components/exercise-manager.tsx`, `components/goal-spectrum.tsx`, `components/workout/warmup-screen.tsx`, `components/nutrition/food-logger-sheet.tsx`, `components/nutrition/assign-step.tsx`, `components/nutrition/review-step.tsx`, `components/profile/profile-tab.tsx`, `components/health-metric-sheet.tsx`, `components/builder-wizard.tsx`, `components/health/ai-periodization-status-card.tsx`, `components/health/strength-trend-card.tsx`
- Reference (do **not** edit): `app/globals.css:469-477` (the floor + opt-out stay)

- [ ] **Step 1** — Fix the Strength Trend pager dots. In `components/health/strength-trend-card.tsx`, add `tap-dense` to the dot button's className (line 116). Replace:
```tsx
            <button
              key={i}
              type="button"
              onClick={() => setIdx(i)}
              aria-label={`Go to ${exercises[i].name}`}
              className="h-1.5 rounded-full transition-all"
              style={{
                width: i === idx ? "16px" : "6px",
                background: i === idx ? "var(--color-brand)" : "var(--color-muted-foreground)",
                opacity: i === idx ? 1 : 0.35,
              }}
            />
```
with:
```tsx
            <button
              key={i}
              type="button"
              onClick={() => setIdx(i)}
              aria-label={`Go to ${exercises[i].name}`}
              className="tap-dense h-1.5 rounded-full transition-all"
              style={{
                width: i === idx ? "16px" : "6px",
                background: i === idx ? "var(--color-brand)" : "var(--color-muted-foreground)",
                opacity: i === idx ? 1 : 0.35,
              }}
            />
```
(The prev/next chevron buttons on lines 55-63 / 89-97 are `p-1` around a 16px icon; at 44px they are acceptable, comfortable tap targets — leave them.)

- [ ] **Step 2** — Audit the 15 candidate files. For **each** file listed above, search for buttons whose intended rendered size is under 44px in a dimension AND whose visual is broken by inflation — i.e. buttons that set an explicit small height/width (`h-1`, `h-1.5`, `h-2`, `w-1.5`, `w-2`) or are `rounded-full` dot/pill indicators, thin progress-bar segments made tappable, or tiny fixed-size toggles. Add `tap-dense` to the className of only those controls. **Do not** add `tap-dense` to padding-only text/icon buttons (e.g. `px-3 py-1.5`, `p-2`, `p-2.5`) — those legitimately want the 44px floor and are not visually broken. Grep helper to locate candidates per file:
```bash
grep -nE '<button|className="[^"]*(h-1|h-1\.5|h-2|w-1\.5|w-2|rounded-full)' <file>
```

- [ ] **Step 3** — Verify no legitimate control was shrunk. For every button that received `tap-dense`, confirm it was already an indicator/dot/thin-bar (not a primary action). If a control is ambiguous, leave the floor (do not add `tap-dense`) — a slightly-large dot is a lesser bug than an un-tappable action.

- [ ] **Step 4** — Device-viewport check (see Task 7 for the harness). At a 412×915 viewport with `pnpm dev`, open Health and scroll to Strength Trend: the pager dots must render as ~6px/16px pills, not 44px circles. Then walk each audited file's screen at 412px and confirm no dot/indicator is a giant circle and no primary button is under 44px.

---

### Task 2: U7 — "AI Periodization" & "Muscle Volume This Week" flash a skeleton every Health visit

**Problem:** Both cards seed from cache, but they are wrapped in `next/dynamic({ ssr:false, loading:<skeleton> })` (`app/health/health-sections.tsx:35-42`), so the `loading:` skeleton paints before the JS chunk (and the seed) arrives on cold/relaunch loads. Both are lightweight (no chart.js/KaTeX), so the `dynamic` wrapper buys nothing and the skeleton structurally defeats instant-paint. The AI card additionally seeds in `useEffect` (`components/health/ai-periodization-status-card.tsx:55-60`), costing a one-frame skeleton even when warm.

**Files:**
- Modify: `app/health/health-sections.tsx:1-42` (static-import the two cards)
- Modify: `components/health/ai-periodization-status-card.tsx:3,55-60` (`useEffect` → `useLayoutEffect` for the seed)

- [ ] **Step 1** — Add static imports. In `app/health/health-sections.tsx`, add these two lines to the static import block (after line 12, `import { ActivityHistoryCard } ...`):
```tsx
import { AiPeriodizationStatusCard } from "@/components/health/ai-periodization-status-card";
import { WeeklyMuscleSetsCard } from "@/components/health/weekly-muscle-sets-card";
```

- [ ] **Step 2** — Remove the two `dynamic()` wrappers. Delete these blocks entirely (`app/health/health-sections.tsx:35-42`):
```tsx
const WeeklyMuscleSetsCard = dynamic(
  () => import("@/components/health/weekly-muscle-sets-card").then(m => ({ default: m.WeeklyMuscleSetsCard })),
  { ssr: false, loading: () => <div className="h-32 animate-pulse rounded-xl bg-muted" /> },
);
const AiPeriodizationStatusCard = dynamic(
  () => import("@/components/health/ai-periodization-status-card").then(m => ({ default: m.AiPeriodizationStatusCard })),
  { ssr: false, loading: () => <div className="h-24 animate-pulse rounded-xl bg-muted" /> },
);
```
(Leave the other `dynamic()` wrappers — `OuraSection`, `InjuryCard`, `AiWeeklyVolumeCard`, `WorkoutDensityCard`, `NutritionActivityTrendsCard`, `StrengthProgressCard`, `StrengthTrendCard`, `GoalsProgressCard`, `TrendsSection` — untouched. `import dynamic from "next/dynamic";` at line 4 is still used by them, keep it.)

- [ ] **Step 3** — Move the AI card seed to `useLayoutEffect` so the cached data paints before first commit. In `components/health/ai-periodization-status-card.tsx`, change the import on line 3 from:
```tsx
import { useEffect, useState, useCallback } from "react";
```
to:
```tsx
import { useLayoutEffect, useState, useCallback } from "react";
```
and change the seed effect (lines 55-60) from:
```tsx
  useEffect(() => {
    // Paint from cache synchronously so the card doesn't flash a skeleton on every open.
    const seed = readCacheSync<{ sessions: SessionOverview[] }>('ai-periodization-overview');
    if (seed?.sessions) { setSessions(seed.sessions); setLoading(false); }
    loadSessions();
  }, [loadSessions]);
```
to:
```tsx
  useLayoutEffect(() => {
    // Paint from cache synchronously so the card doesn't flash a skeleton on every open.
    const seed = readCacheSync<{ sessions: SessionOverview[] }>('ai-periodization-overview');
    if (seed?.sessions) { setSessions(seed.sessions); setLoading(false); }
    loadSessions();
  }, [loadSessions]);
```
(This mirrors the existing `useLayoutEffect` cache-seed pattern already used in `app/workout-select/workout-select-content.tsx:118`. `readCacheSync` returns null during SSR, so the seed is a client-only no-op there.)

- [ ] **Step 4** — `pnpm tsc --noEmit && pnpm lint && pnpm build` must pass (static imports pull the two cards into SSR; confirm neither touches `window`/`document` at module scope — both are `'use client'` with all browser access inside effects/handlers, so the build is safe).

- [ ] **Step 5** — Verify warm-revisit has zero skeleton frames. `pnpm dev`, 412×915: open Health, navigate away to Training tab and back to Health twice. On the second+ visit, the AI Periodization and Muscle Volume This Week cards must paint their content immediately with **no** `animate-pulse` skeleton frame. (Cold-chunk timing on the real APK is device-gated — see Task 7.)

---

### Task 3: U8 — Morning check-in dials should match the end-of-day dials (colour + per-rung labels)

**Problem:** The morning check-in already shares `ScaleSelector` with end-of-day, but (1) `MORNING_SCALES` (`lib/types/day-checkin.ts:42-48`) has no `color` field and `morning-checkin-sheet.tsx:135-144` passes no `color` prop, so morning dials fall back to grey while evening dials are coloured (`EVENING_SCALES` has `color`, passed at `wellness-section.tsx:31`); (2) `ScaleSelector` renders the digit `1–5` plus only floating low/high endpoint labels — no word aligned to a rung.

**Decision (per-rung label):** `ScaleSelector` only receives `low`/`high` endpoint strings (no per-scale 5-word arrays exist, and the constraint requires the label change to live in the one shared file so it benefits morning **and** evening at once). Inventing five semantic words per scale would require authoring word arrays on **both** `MORNING_SCALES` and `EVENING_SCALES` (more than one file, 25+ new strings) — out of scope. The faithful, non-inventing implementation: render the endpoint words as **per-rung captions aligned under the end rungs** (the `low` word sits under rung 1, the `high` word under rung 5) in a 5-column grid that matches the button row, replacing the current free-floating `justify-between` label row. This makes the words read as rung labels, stays correct for every scale in both sheets, and touches only `scale-selector.tsx`.

**Colour note (deliberate hex):** `ScaleSelector` composites the scale colour with alpha suffixes (`` `${color}44` ``, `` `${color}18` `` — `scale-selector.tsx:15-17`), which requires a concrete hex string, not a CSS token. `EVENING_SCALES` already uses hex literals for exactly this reason; adding hex `color`s to `MORNING_SCALES` **matches the established sibling pattern** (One Formula, One Place) rather than introducing new ad-hoc hardcoding.

**Files:**
- Modify: `lib/types/day-checkin.ts:42-48` (add `color` to each `MORNING_SCALES` entry)
- Modify: `components/nutrition/end-of-day/scale-selector.tsx:24` (per-rung caption row)
- Modify: `components/morning-checkin-sheet.tsx:135-144` (pass `color`)

- [ ] **Step 1** — Add a `color` to each morning scale. In `lib/types/day-checkin.ts`, replace the `MORNING_SCALES` block (lines 42-48):
```ts
export const MORNING_SCALES = [
  { key: 'wakeMood',          label: 'Wake mood',            low: 'Great',           high: 'Awful' },
  { key: 'perceivedRecovery', label: 'Recovery',             low: 'Fully recovered', high: 'Wrecked' },
  { key: 'motivation',        label: 'Motivation to train',  low: 'Fired up',        high: 'None' },
  { key: 'sleepQualityFeel',  label: 'Sleep quality (feel)', low: 'Slept great',     high: 'Terrible' },
  { key: 'restingSoreness',   label: 'Resting soreness',     low: 'None',            high: 'Very sore' },
] as const
```
with:
```ts
export const MORNING_SCALES = [
  { key: 'wakeMood',          label: 'Wake mood',            low: 'Great',           high: 'Awful',     color: '#f59e0b' },
  { key: 'perceivedRecovery', label: 'Recovery',             low: 'Fully recovered', high: 'Wrecked',   color: '#22c55e' },
  { key: 'motivation',        label: 'Motivation to train',  low: 'Fired up',        high: 'None',      color: '#f97316' },
  { key: 'sleepQualityFeel',  label: 'Sleep quality (feel)', low: 'Slept great',     high: 'Terrible',  color: '#8b5cf6' },
  { key: 'restingSoreness',   label: 'Resting soreness',     low: 'None',            high: 'Very sore', color: '#f43f5e' },
] as const
```

- [ ] **Step 2** — Pass the colour from the morning sheet. In `components/morning-checkin-sheet.tsx`, replace the `ScaleSelector` mapping (lines 135-144):
```tsx
          {MORNING_SCALES.map(scale => (
            <ScaleSelector
              key={scale.key}
              label={scale.label}
              low={scale.low}
              high={scale.high}
              value={scales[scale.key]}
              onChange={v => { editedRef.current = true; setScales(s => ({ ...s, [scale.key]: v })) }}
            />
          ))}
```
with:
```tsx
          {MORNING_SCALES.map(scale => (
            <ScaleSelector
              key={scale.key}
              label={scale.label}
              low={scale.low}
              high={scale.high}
              color={scale.color}
              value={scales[scale.key]}
              onChange={v => { editedRef.current = true; setScales(s => ({ ...s, [scale.key]: v })) }}
            />
          ))}
```

- [ ] **Step 3** — Render per-rung captions aligned under the rungs. In `components/nutrition/end-of-day/scale-selector.tsx`, replace the floating endpoint row (line 24):
```tsx
      <div className="flex justify-between text-[10px] text-muted-foreground"><span>{low}</span><span>{high}</span></div>
```
with a 5-column caption grid aligned to the button row (`low` under rung 1, `high` under rung 5):
```tsx
      <div className="grid grid-cols-5 gap-0.5 text-[10px] leading-tight text-muted-foreground">
        <span className="text-left">{low}</span>
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span className="text-right">{high}</span>
      </div>
```
(This preserves the exact same information the evening sheet relies on and renders identically for both `MORNING_SCALES` and `EVENING_SCALES` because both supply `low`/`high`; nothing scale-specific is hardcoded here.)

- [ ] **Step 4** — `pnpm tsc --noEmit && pnpm lint` (the `as const` widening on the new `color` fields must still satisfy any `MorningScaleKey`/consumers; confirm `prefillMorningScales` and `day-checkin-prefill` don't index on the tuple shape in a way the added field breaks — they key by `key`, so it's safe).

- [ ] **Step 5** — Verify both sheets. `pnpm dev`, 412×915:
  - Home → open the Morning Check-in sheet: each dial is coloured (gold/green/orange/violet/rose), not grey; the `low` word sits under the left rung and the `high` word under the right rung, aligned to the buttons.
  - Nutrition → End of Day review → Wellness section: the evening dials still render their colours and the same aligned low/high captions (no regression).

---

### Task 4: U9 — Calendar day-detail shows every set concatenated instead of one average line

**Problem:** `app/health/health-content.tsx:914-919` maps every set and joins with `" | "` → e.g. `6 × 55kg | 6 × 55kg | 6 × 55kg | 7 × 55kg`. Compact helpers already exist but are module-private in `components/workout/pre-workout-screen.tsx`: `modalWeight()` (lines 28-38) and `avgReps()` (lines 40-44), used to assemble the representative line at `pre-workout-screen.tsx:282-293`.

**Decision:** Lift `modalWeight`/`avgReps` into the shared `components/workout/utils.ts` (One Formula, One Place — that file already hosts `formatTime`, `mround125`, `setColor`, etc.), import them in both consumers, and render one representative line on the calendar day-detail. Add a real vitest test since these become exported pure helpers.

**Files:**
- Modify: `components/workout/utils.ts` (add exported `modalWeight`, `avgReps`)
- Modify: `components/workout/pre-workout-screen.tsx:11,27-44` (remove local copies, import from `./utils`)
- Modify: `app/health/health-content.tsx:914-919` (representative line) + import
- Test: `components/workout/utils.test.ts`

- [ ] **Step 1** — Add the two helpers to the shared util. In `components/workout/utils.ts`, append at the end of the file (after `plateBreakdown`, line 132):
```ts
// Most-frequent weight across a set's logged weights — the representative "bar load"
// for a compact per-exercise summary. Returns null for an empty list.
export function modalWeight(weights: number[]): number | null {
  if (weights.length === 0) return null;
  const counts = new Map<number, number>();
  for (const w of weights) counts.set(w, (counts.get(w) ?? 0) + 1);
  let best = weights[0], bestCount = 0;
  for (const w of weights) {
    const c = counts.get(w)!;
    if (c > bestCount) { best = w; bestCount = c; }
  }
  return best;
}

// Rounded mean of the non-null reps across a set list; null when there are no reps.
export function avgReps(reps: (number | null)[]): number | null {
  const valid = reps.filter((r): r is number => r != null);
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}
```

- [ ] **Step 2** — Remove the local copies from the pre-workout screen and import the shared ones. In `components/workout/pre-workout-screen.tsx`, change the util import (line 11) from:
```tsx
import { formatSheetDate, mround125 } from "./utils";
```
to:
```tsx
import { formatSheetDate, mround125, modalWeight, avgReps } from "./utils";
```
and delete the two local function definitions (lines 27-44):
```tsx
// Most-frequent weight across the last logged sets — the representative "bar load" for the card.
function modalWeight(weights: number[]): number | null {
  if (weights.length === 0) return null;
  const counts = new Map<number, number>();
  for (const w of weights) counts.set(w, (counts.get(w) ?? 0) + 1);
  let best = weights[0], bestCount = 0;
  for (const w of weights) {
    const c = counts.get(w)!;
    if (c > bestCount) { best = w; bestCount = c; }
  }
  return best;
}

function avgReps(reps: (number | null)[]): number | null {
  const valid = reps.filter((r): r is number => r != null);
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}
```
(The call site at `pre-workout-screen.tsx:283-290` is unchanged — it now references the imported helpers.)

- [ ] **Step 3** — Add the import to the calendar day-detail file. In `app/health/health-content.tsx`, add after the existing lucide import (line 31):
```tsx
import { modalWeight, avgReps } from "@/components/workout/utils";
```

- [ ] **Step 4** — Render one representative line. In `app/health/health-content.tsx`, replace the per-set concatenation (lines 914-919):
```tsx
                                  <span className="text-xs text-muted-foreground tabular-nums">
                                    {ex.reps.map((r, i) => {
                                      const w = ex.setWeights[i] ?? ex.setWeights[ex.setWeights.length - 1] ?? ex.weightKg;
                                      return w != null ? `${r} × ${w}kg` : `${r} reps`;
                                    }).map((s, i) => i === 0 ? ` · ${s}` : ` | ${s}`).join("")}
                                  </span>
```
with:
```tsx
                                  <span className="text-xs text-muted-foreground tabular-nums">
                                    {(() => {
                                      const reps = avgReps(ex.reps);
                                      const weight = modalWeight(ex.setWeights) ?? ex.weightKg;
                                      const setCount = ex.reps.length;
                                      if (reps == null) return `${setCount} set${setCount !== 1 ? "s" : ""}`;
                                      const load = weight != null ? `${reps} × ${weight}kg` : `${reps} reps`;
                                      return `${setCount} × ${load}`;
                                    })()}
                                  </span>
```
(`ex` is a `DayExercise` — `reps: number[]`, `setWeights: number[]`, `weightKg: number | null`, per `app/api/day-log/route.ts:10-21` — so `avgReps(ex.reps)`/`modalWeight(ex.setWeights)` typecheck directly. Output reads e.g. `4 × 6 × 55kg` = 4 sets of ~6 reps at the modal 55kg, instead of the long pipe list.)

- [ ] **Step 5** — Add a vitest test. Create `components/workout/utils.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { modalWeight, avgReps } from "./utils";

describe("modalWeight", () => {
  it("returns null for an empty list", () => {
    expect(modalWeight([])).toBeNull();
  });
  it("returns the most frequent weight", () => {
    expect(modalWeight([55, 55, 55, 60])).toBe(55);
  });
  it("returns the first-seen weight on a tie", () => {
    expect(modalWeight([60, 55, 60, 55])).toBe(60);
  });
  it("handles a single value", () => {
    expect(modalWeight([42.5])).toBe(42.5);
  });
});

describe("avgReps", () => {
  it("returns null when there are no reps", () => {
    expect(avgReps([])).toBeNull();
    expect(avgReps([null, null])).toBeNull();
  });
  it("rounds the mean of the non-null reps", () => {
    expect(avgReps([6, 6, 6, 7])).toBe(6);      // 25/4 = 6.25 → 6
    expect(avgReps([8, 8, 9, 9])).toBe(9);      // 34/4 = 8.5 → 9 (round-half-up)
  });
  it("ignores null entries", () => {
    expect(avgReps([10, null, 12])).toBe(11);
  });
});
```

- [ ] **Step 6** — `pnpm test components/workout/utils.test.ts` passes; `pnpm tsc --noEmit && pnpm lint` clean.

- [ ] **Step 7** — Verify in-app. `pnpm dev`, 412×915: Health → tap a calendar day that has a logged workout → expand the session. Each exercise shows one compact line (`<sets> × <avgReps> × <modalWeight>kg`), not a `|`-joined list. Confirm the pencil/trash per-exercise controls still open the edit/delete dialogs (they read `ex.setWeights`/`ex.reps` unchanged).

---

### Task 5: U10 — Nutrition "Log Food" sheet: reorder tiles and add Saved Meals as a grid button

**Problem:** The capture grid (`components/nutrition/capture-step.tsx:156-177`) shows five tiles in the order Scan Photo, Barcode, Describe it, History, Manual Entry. Saved Meals is only reachable via a `SegmentedTabs` Recent/Saved bar + a swipe carousel in `components/nutrition/food-logger-sheet.tsx:250-331`.

**Requested order:** Scan Photo, Barcode → Describe it, Manual Entry → History, Saved Meals (a sixth tile).

**Decision (SegmentedTabs / carousel):** Route Saved Meals through the new grid tile → the existing full `SavedMealsSheet` (`components/nutrition/saved-meals-sheet.tsx`, already imported at `food-logger-sheet.tsx:12` and rendered at `:359-363` but currently **dead code** — `setShowSavedMeals(true)` is never called). Then **remove** the now-redundant `SegmentedTabs` bar and the Saved-Meals carousel pane. Rationale: keeping both would create two competing saved-meal surfaces; the spec explicitly invited this call; `SavedMealsSheet` is the richer surface (list + build/edit + quick-log) and reusing it deletes ~60 lines of carousel scaffolding. **This is the largest single change in the batch — see Task 7 risk note.** (Minimal alternative, if the reviewer prefers zero deletions: wire `onSavedMeals` to `goToTab('saved')` and keep the carousel. Not chosen — leaves duplicate entry points.)

**Files:**
- Modify: `components/nutrition/capture-step.tsx:9-17,156-177` (new `onSavedMeals` prop + reorder + sixth tile)
- Modify: `components/nutrition/food-logger-sheet.tsx` (wire `onSavedMeals`, pass `userId` to `SavedMealsSheet`, remove SegmentedTabs + carousel pane + its state)

- [ ] **Step 1** — Add the `onSavedMeals` prop and reorder the tiles in `components/nutrition/capture-step.tsx`. Change the Props interface (lines 9-15) from:
```tsx
interface Props {
  onScanResult: (result: NutritionScanResult) => void
  onManual: () => void
  onMyFoods: () => void
  preselectedMealTypeId?: string | null
  onLibrarySelect?: (item: FoodItem) => void
}
```
to:
```tsx
interface Props {
  onScanResult: (result: NutritionScanResult) => void
  onManual: () => void
  onMyFoods: () => void
  onSavedMeals: () => void
  preselectedMealTypeId?: string | null
  onLibrarySelect?: (item: FoodItem) => void
}
```
and the destructure (line 17) from:
```tsx
export function CaptureStep({ onScanResult, onManual, onMyFoods, preselectedMealTypeId, onLibrarySelect }: Props) {
```
to:
```tsx
export function CaptureStep({ onScanResult, onManual, onMyFoods, onSavedMeals, preselectedMealTypeId, onLibrarySelect }: Props) {
```

- [ ] **Step 2** — Add the `BookmarkIcon` import (Lucide, no emoji) in `components/nutrition/capture-step.tsx`. Change line 4 from:
```tsx
import { Camera as CameraIcon, Hash, MessageSquare, PenLine, Loader2, Clock } from 'lucide-react'
```
to:
```tsx
import { Camera as CameraIcon, Hash, MessageSquare, PenLine, Loader2, Clock, Bookmark } from 'lucide-react'
```

- [ ] **Step 3** — Reorder the `tiles` array and add the sixth Saved Meals tile. Replace the array (`components/nutrition/capture-step.tsx:156-177`):
```tsx
  const tiles = [
    {
      icon: <CameraIcon className="w-6 h-6" />, label: 'Scan Photo',
      action: handleCapturePhoto,
    },
    {
      icon: <Hash className="w-6 h-6" />, label: 'Barcode',
      action: () => setShowBarcode(true),
    },
    {
      icon: <MessageSquare className="w-6 h-6" />, label: 'Describe it',
      action: () => setShowDescribe(true),
    },
    {
      icon: <Clock className="w-6 h-6" />, label: 'History',
      action: onMyFoods,
    },
    {
      icon: <PenLine className="w-6 h-6" />, label: 'Manual Entry',
      action: onManual,
    },
  ]
```
with (order: Scan Photo, Barcode, Describe it, Manual Entry, History, Saved Meals):
```tsx
  const tiles = [
    {
      icon: <CameraIcon className="w-6 h-6" />, label: 'Scan Photo',
      action: handleCapturePhoto,
    },
    {
      icon: <Hash className="w-6 h-6" />, label: 'Barcode',
      action: () => setShowBarcode(true),
    },
    {
      icon: <MessageSquare className="w-6 h-6" />, label: 'Describe it',
      action: () => setShowDescribe(true),
    },
    {
      icon: <PenLine className="w-6 h-6" />, label: 'Manual Entry',
      action: onManual,
    },
    {
      icon: <Clock className="w-6 h-6" />, label: 'History',
      action: onMyFoods,
    },
    {
      icon: <Bookmark className="w-6 h-6" />, label: 'Saved Meals',
      action: onSavedMeals,
    },
  ]
```
(Six tiles in a `grid-cols-2` → three rows; the render block at lines 246-256 is unchanged.)

- [ ] **Step 4** — In `components/nutrition/food-logger-sheet.tsx`, wire `onSavedMeals` and pass `userId` to the (now-live) `SavedMealsSheet`. Change the `CaptureStep` usage (lines 283-289) from:
```tsx
                <CaptureStep
                  onScanResult={handleScanResult}
                  onManual={handleManual}
                  onMyFoods={() => setShowLibrary(true)}
                  preselectedMealTypeId={preselectedMealTypeId}
                  onLibrarySelect={handleLibrarySelect}
                />
```
to:
```tsx
                <CaptureStep
                  onScanResult={handleScanResult}
                  onManual={handleManual}
                  onMyFoods={() => setShowLibrary(true)}
                  onSavedMeals={() => setShowSavedMeals(true)}
                  preselectedMealTypeId={preselectedMealTypeId}
                  onLibrarySelect={handleLibrarySelect}
                />
```
and the `SavedMealsSheet` render (lines 359-363) from:
```tsx
      <SavedMealsSheet
        open={showSavedMeals}
        onOpenChange={v => { if (!v) setShowSavedMeals(false) }}
        onLogged={() => { reset(); onClose(); onLogged() }}
      />
```
to:
```tsx
      <SavedMealsSheet
        open={showSavedMeals}
        onOpenChange={v => { if (!v) setShowSavedMeals(false) }}
        onLogged={() => { reset(); onClose(); onLogged() }}
        userId={userId}
      />
```
(`SavedMealsSheet` already accepts an optional `userId` — `saved-meals-sheet.tsx:24` — and threads it into `logMealItems` for the offline-first write path; the previous dead render omitted it.)

- [ ] **Step 5** — Remove the redundant carousel + SegmentedTabs. In `components/nutrition/food-logger-sheet.tsx`:
  - Delete the import on line 7: `import { SegmentedTabs } from '@/components/ui/segmented-tabs'`.
  - Delete the import on line 16: `import { logMealItems } from '@/lib/nutrition/log-meal'` (only used by the removed `quickLogSavedMeal`; `logFoodEntries`/`ingredientsToEntries` on line 17 stay).
  - Delete lines 29-30 (`type LoggerTab` + `LOGGER_TABS`).
  - Delete the carousel state on lines 90-91 (`loggerTab`, `carouselRef`) and lines 101-104 (`savedMeals`, `mealTypes`, `savedLoading`, `logging`).
  - Delete `goToTab`/`handleCarouselScroll` (lines 106-119) and the saved-meals fetch `useEffect` (lines 121-131).
  - Delete `quickLogSavedMeal` (lines 144-162).
  - In `reset()` (lines 133-142), delete the line `setLoggerTab('recent')`.
  - Delete the SegmentedTabs block (lines 250-259).
  - Replace the capture-vs-steps ternary body so the capture step renders a single pane (no carousel). Replace the whole `{step === 'capture' ? ( … carousel … ) : ( … steps … )}` block (lines 275-355) with:
```tsx
          {step === 'capture' ? (
            <div className="flex-1 overflow-y-auto pb-safe">
              <CaptureStep
                onScanResult={handleScanResult}
                onManual={handleManual}
                onMyFoods={() => setShowLibrary(true)}
                onSavedMeals={() => setShowSavedMeals(true)}
                preselectedMealTypeId={preselectedMealTypeId}
                onLibrarySelect={handleLibrarySelect}
              />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto pb-safe">
              {step === 'review' && (
                <ReviewStep
                  result={scanResult}
                  value={form}
                  ingredients={ingredients}
                  onIngredientsChange={setIngredients}
                  onChange={setForm}
                  onRefine={handleRefine}
                  onBack={() => popStep()}
                  onNext={() => pushStep('assign')}
                />
              )}
              {step === 'assign' && (
                <AssignStep
                  nutrition={form}
                  preselectedMealTypeId={preselectedMealTypeId}
                  onBack={() => popStep()}
                  onConfirm={handleConfirm}
                />
              )}
            </div>
          )}
```
(This folds the Step-3/Step-4 `CaptureStep` wiring into the single pane, so those earlier CaptureStep edits are subsumed here — the capture render now appears exactly once. `SavedMeal`, `MealType` imports on line 14 become unused after removing the saved-meals state; drop `SavedMeal, MealType` from that import if `pnpm lint` flags them. Keep `FoodLogWithItem` and the rest.)

- [ ] **Step 6** — `pnpm tsc --noEmit && pnpm lint && pnpm build` must be clean. Confirm no lingering reference to any removed symbol (`loggerTab`, `LOGGER_TABS`, `carouselRef`, `goToTab`, `handleCarouselScroll`, `savedMeals`, `mealTypes`, `savedLoading`, `quickLogSavedMeal`, `logMealItems`, `SegmentedTabs`).

- [ ] **Step 7** — Verify in-app. `pnpm dev`, 412×915: Nutrition → Log Food. The grid shows six tiles in exactly this order: **Scan Photo, Barcode, Describe it, Manual Entry, History, Saved Meals**. Tapping Saved Meals opens the `SavedMealsSheet` (list + New Meal); logging a saved meal from it fires the toast and closes back to Nutrition with the log applied. Confirm Scan/Barcode/Describe/Manual/History all still work and the old Recent/Saved tab bar is gone.

---

### Task 6: U13 — Workout carousel has no indicator of the day's recommended session

**Problem:** `app/workout-select/workout-select-content.tsx` already reads the recommendation (`readCacheSync('next-session')` at line 124; `cachedFetch('next-session', …)` at lines 147-157) but uses `rec.session.id` **only** to set the default carousel index — it never surfaces which card is recommended. The card header (lines 296-326) and the dot indicators (lines 367-377) don't mark it.

**Fix:** Track the recommended session id in state, set it wherever `next-session` is read, render a "Recommended today" pill on the matching card, and emphasise its dot.

**Files:**
- Modify: `app/workout-select/workout-select-content.tsx` (state + both read sites + card badge + dot highlight)

- [ ] **Step 1** — Add recommended-id state. In `app/workout-select/workout-select-content.tsx`, after line 82 (`const [hasSeeded, setHasSeeded] = useState(false);`) add:
```tsx
  const [recommendedId, setRecommendedId] = useState<string | null>(null);
```

- [ ] **Step 2** — Set it in the synchronous seed. In the `useLayoutEffect` seed (lines 124-128), replace:
```tsx
      const rec = readCacheSync<NextSessionRecommendation>('next-session');
      if (rec?.session) {
        const idx = loaded.findIndex(s => s.id === rec.session!.id);
        if (idx >= 0) { setCurrentIdx(idx); setHasSeeded(true); }
      }
```
with:
```tsx
      const rec = readCacheSync<NextSessionRecommendation>('next-session');
      if (rec?.session) {
        setRecommendedId(rec.session.id);
        const idx = loaded.findIndex(s => s.id === rec.session!.id);
        if (idx >= 0) { setCurrentIdx(idx); setHasSeeded(true); }
      }
```

- [ ] **Step 3** — Set it in the network fetch. In `fetchData`, inside the `next-session` `cachedFetch` callback (lines 149-157), replace:
```tsx
          (rec) => {
            setHasSeeded(prev => {
              if (!prev && rec?.session && loaded.length > 0) {
                const idx = loaded.findIndex(s => s.id === rec.session!.id);
                if (idx >= 0) setCurrentIdx(idx);
              }
              return true;
            });
          },
```
with:
```tsx
          (rec) => {
            setRecommendedId(rec?.session?.id ?? null);
            setHasSeeded(prev => {
              if (!prev && rec?.session && loaded.length > 0) {
                const idx = loaded.findIndex(s => s.id === rec.session!.id);
                if (idx >= 0) setCurrentIdx(idx);
              }
              return true;
            });
          },
```

- [ ] **Step 4** — Render the "Recommended today" pill on the matching card. In the header block, the session name is rendered at lines 299-301. Replace:
```tsx
                      <p className={cn("text-xl font-bold truncate", p.textClass)}>
                        {currentSession?.name}
                      </p>
```
with:
```tsx
                      <div className="flex items-center gap-2 min-w-0">
                        <p className={cn("text-xl font-bold truncate", p.textClass)}>
                          {currentSession?.name}
                        </p>
                        {currentSession?.id === recommendedId && (
                          <span
                            className="flex-none rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
                            style={{ background: "var(--color-brand)" }}
                          >
                            Recommended
                          </span>
                        )}
                      </div>
```
(Uses the brand theme token, not a hex literal. The pill sits inline with the name inside the existing `min-w-0` header column so the truncation still works.)

- [ ] **Step 5** — Emphasise the recommended dot. In the dot-indicators block (lines 367-377), replace:
```tsx
            {sessions.map((_, i) => (
              <div
                key={i}
                className="rounded-full transition-all duration-200"
                style={{
                  width: 6,
                  height: i === currentIdx ? 20 : 6,
                  background: i === currentIdx ? "var(--color-brand)" : "rgba(255,255,255,0.18)",
                }}
              />
            ))}
```
with:
```tsx
            {sessions.map((session, i) => {
              const isRecommended = session.id === recommendedId;
              return (
                <div
                  key={i}
                  className="rounded-full transition-all duration-200"
                  style={{
                    width: 6,
                    height: i === currentIdx ? 20 : 6,
                    background: i === currentIdx
                      ? "var(--color-brand)"
                      : isRecommended
                        ? "rgba(var(--brand-rgb, 255 255 255) / 0.5)"
                        : "rgba(255,255,255,0.18)",
                  }}
                />
              );
            })}
```
If `--brand-rgb` is not defined in the theme, use a simpler emphasis that needs no token plumbing — replace the `background` expression with:
```tsx
                    background: i === currentIdx
                      ? "var(--color-brand)"
                      : isRecommended
                        ? "rgba(255,255,255,0.45)"
                        : "rgba(255,255,255,0.18)",
```
(Confirm which form to keep by grepping `--brand-rgb` in `app/globals.css`; if absent, use the plain `rgba(255,255,255,0.45)` variant. Do **not** invent a token.)

- [ ] **Step 6** — `pnpm tsc --noEmit && pnpm lint` clean. Confirm no new fetch was added (recommendation data was already in scope) and the `📅 ` literal on line 305 remains untouched.

- [ ] **Step 7** — Verify in-app. `pnpm dev`, 412×915: open the Workout page. The carousel defaults to the recommended session and its card shows the "Recommended" pill next to the name; its dot is visibly brighter than the non-current dots. Swipe to a different session — the pill disappears (only the recommended card carries it), and swiping back to the recommended session restores it. Cross-check the recommended name matches Home's gold "RECOMMENDED TODAY" card.

---

### Task 7: Verification, acceptance criteria, and device-only notes

**Files:** none (verification only).

- [ ] **Step 1** — Full gate: `pnpm tsc --noEmit`, `pnpm lint`, `pnpm test` (includes the new `components/workout/utils.test.ts`), `pnpm build` all green.

- [ ] **Step 2** — Local dev-server pass at 412×915 with `pnpm db:local` + `pnpm dev` (test user `test@local.dev` / `testpass123`). Exercise, in one session, every changed surface:
  - **U4:** Health → Strength Trend pager dots are ~6/16px pills, not 44px circles. Walk each of the 15 audited screens at 412px — no dot/indicator is a giant circle; every primary button still ≥44px.
  - **U7:** Health → Training → Health twice: AI Periodization + Muscle Volume This Week paint instantly with zero skeleton frames on the warm revisit.
  - **U8:** Morning check-in dials are coloured with `low`/`high` words aligned under the end rungs; evening (End of Day → Wellness) dials render the same aligned captions with no regression.
  - **U9:** Calendar day-detail shows one representative line per exercise; per-exercise edit/delete still work.
  - **U10:** Log Food grid shows six tiles in order Scan Photo, Barcode, Describe it, Manual Entry, History, Saved Meals; Saved Meals opens `SavedMealsSheet` and logs correctly; old Recent/Saved tab bar removed; all other capture paths still work.
  - **U13:** Workout carousel defaults to and badges the recommended session; dot emphasised; badge follows only the recommended card on swipe.

- [ ] **Step 2b** — After presenting, explicitly state which surfaces were **not** exercised in the sandbox (per CLAUDE.md communication rule). These are device-gated and require `docs/device-smoke-checklist.md` on the S25 APK:
  - **U4 is device-only:** the `@media (max-width:640px)` floor renders as 0 insets/desktop metrics in the web sandbox; the 44px inflation only reproduces on the phone. The Playwright 412px context approximates it but the authoritative check is the APK.
  - **U7 cold-chunk timing** (Samsung WebView first-load, service-worker cache) only manifests on a real relaunch; the sandbox warm-revisit check is a proxy.
  - **U8/U10** involve the offline-first local store (`getLocalStore` returns null in web) — verify the Saved-Meal log and morning check-in persist on the APK, not just web.

- [ ] **Step 3** — Acceptance criteria (from the review addendum, entry #11/#12 territory):
  - **U4:** all 15 candidate files audited at 412px; Strength Trend pager pills ≤8px tall; no legitimate action shrunk below 44px.
  - **U7:** zero skeleton frames on a warm revisit of Health → Training → Health.
  - **U8:** morning dials coloured; every dial shows its `low`/`high` word aligned to the rungs, on both the morning and evening sheets.
  - **U9:** one representative line per exercise on the calendar day-detail (not a `|`-joined per-set list).
  - **U10:** six capture tiles in the specified order; Saved Meals reachable as a grid button.
  - **U13:** the recommended session's card is visibly badged and its dot emphasised; no new network fetch.

**Risk notes for review:**
- **U10 is the largest change** — it deletes the SegmentedTabs + Saved-Meals carousel and re-routes Saved Meals through the previously-dead `SavedMealsSheet`. Diff the removed `quickLogSavedMeal` against `SavedMealsSheet.quickLog` (`saved-meals-sheet.tsx:176-192`) to confirm behavioural parity (both call `logMealItems(meal, today, mealTypeId, userId)` and toast); the only functional difference is `SavedMealsSheet` also offers build/edit, which is additive. If parity is doubted, fall back to the minimal alternative (tile → `goToTab('saved')`, keep carousel).
- **U4** keeps the global floor deliberately; the alternative (moving the floor into `<Button>` variants) is a wider refactor deferred to its own PR.
- **U8** uses hex `color`s on `MORNING_SCALES` to match the existing `EVENING_SCALES` pattern (required for the `${color}44` alpha compositing in `ScaleSelector`); this is a deliberate match, not new ad-hoc hardcoding.
