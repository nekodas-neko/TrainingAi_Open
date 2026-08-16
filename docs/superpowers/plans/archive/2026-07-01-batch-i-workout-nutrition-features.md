# Batch I — Workout & Nutrition UX Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the four carried feature items: dynamic TDEE adaptation from the weight trend, injury-aware in-workout exercise substitution, a year-in-review "Wrapped" page, and supersets/circuit support.

**Architecture:** Ordered by rising risk (TDEE → injury swap → Wrapped → supersets). Every feature's decision logic is a pure, unit-tested helper in `lib/`; UI layers are thin. TDEE adaptation needs **no migration** (acceptance writes through the existing nutrition-targets save path; re-prompt suppression is a date-stamped localStorage marker, same pattern as the rest-day marker). Supersets use Postgres migration **107** (`107_superset_groups.sql` — 108 is freed) + local SQLite **v15** (v13 = Batch A, v14 = Batch F; this migration is additive and independent, so batch ordering is safe) and v1 deliberately flattens groups for AI-dynamic programs.

**Tech Stack:** Drizzle/Postgres, Capacitor SQLite mirror (`lib/sqlite/migrations.ts` + RECONCILE lists — mandatory after bug #85), vitest (`pnpm test`), motion v12 for the Wrapped page.

**Ground rules:** pnpm only; dates via `todayInTz` (never `toISOString().slice`); no hardcoded session names; `pnpm lint && npx tsc --noEmit` before every commit; human-style commit messages (no AI attribution).

---

## Feature 1 — Dynamic TDEE adaptation from the weight trend

### Task 1: Pure trend/adjustment helper

**Files:**
- Create: `lib/nutrition/tdee-adaptation.ts`
- Test: `lib/nutrition/tdee-adaptation.test.ts`

- [ ] **Step 1: Write the failing tests** (arithmetic shown so expectations are checkable):

```ts
import { describe, it, expect } from "vitest";
import { weeklyWeightSlope, tdeeAdjustment, GOAL_RATE_KG_PER_WEEK } from "./tdee-adaptation";

describe("weeklyWeightSlope", () => {
  it("computes a perfect -0.5 kg/week linear loss", () => {
    // 14 daily points from 80.0 falling 0.5/7 per day → slope ≈ -0.5 kg/week
    const points = Array.from({ length: 14 }, (_, i) => ({
      date: `2026-06-${String(i + 1).padStart(2, "0")}`,
      weightKg: 80 - (0.5 / 7) * i,
    }));
    expect(weeklyWeightSlope(points)).toBeCloseTo(-0.5, 2);
  });
  it("returns null with fewer than 8 data points (too sparse to trust)", () => {
    expect(weeklyWeightSlope([{ date: "2026-06-01", weightKg: 80 }])).toBeNull();
  });
});

describe("tdeeAdjustment", () => {
  it("suggests eating less when losing slower than the lose_weight target", () => {
    // target -0.45 kg/wk (from -500 kcal/day: 500*7/7700), actual -0.1
    // gap = (-0.45) - (-0.1) = -0.35 kg/wk → -0.35 * 7700 / 7 = -385 kcal/day → clamped to -200, rounded to 50
    expect(tdeeAdjustment("lose_weight", -0.1)).toBe(-200);
  });
  it("suggests eating more when losing faster than intended", () => {
    // actual -0.8 vs target -0.45: gap = +0.35 → +385 → clamp +200
    expect(tdeeAdjustment("lose_weight", -0.8)).toBe(200);
  });
  it("returns 0 inside the ±0.1 kg/week deadband", () => {
    expect(tdeeAdjustment("lose_weight", -0.5)).toBe(0);
    expect(tdeeAdjustment("maintain", 0.05)).toBe(0);
  });
  it("rounds to the nearest 50 kcal", () => {
    // build_muscle target +0.27; actual 0.0 → gap 0.27*7700/7 = 297 → round 300... clamped 200
    expect(tdeeAdjustment("build_muscle", 0)).toBe(200);
    // small gap: maintain target 0, actual -0.15 → gap 0.15*1100 = 165 → 150
    expect(tdeeAdjustment("maintain", -0.15)).toBe(150);
  });
});
```

- [ ] **Step 2:** `pnpm test lib/nutrition/tdee-adaptation.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement:**

```ts
import type { FitnessGoal } from "../types/user";

// Weekly weight-change targets implied by CALORIE_ADJUSTMENT_BY_GOAL in
// goal-recommendation.ts (kcal/day * 7 / 7700 kcal-per-kg).
export const GOAL_RATE_KG_PER_WEEK: Record<FitnessGoal, number> = {
  lose_weight: -0.45,
  maintain: 0,
  build_muscle: 0.27,
  recomp: -0.18,
};

const KCAL_PER_KG = 7700;
const DEADBAND_KG_PER_WEEK = 0.1;
const MAX_ADJUST_KCAL = 200;
const MIN_POINTS = 8;

/** Least-squares slope over dated weigh-ins, in kg/week. Null when too sparse. */
export function weeklyWeightSlope(points: { date: string; weightKg: number }[]): number | null {
  if (points.length < MIN_POINTS) return null;
  const day0 = new Date(points[0].date + "T00:00:00Z").getTime();
  const xs = points.map(p => (new Date(p.date + "T00:00:00Z").getTime() - day0) / 86_400_000);
  const ys = points.map(p => p.weightKg);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0) return null;
  return (num / den) * 7; // per-day slope → per-week
}

/** Daily-calorie nudge (kcal, multiple of 50, clamped ±200; 0 inside the deadband). */
export function tdeeAdjustment(goal: FitnessGoal, actualKgPerWeek: number): number {
  const gap = GOAL_RATE_KG_PER_WEEK[goal] - actualKgPerWeek; // + → need more kcal? no:
  // gap < 0 → losing too slowly for a loss goal → eat less (negative adjustment)
  if (Math.abs(gap) < DEADBAND_KG_PER_WEEK) return 0;
  const raw = (gap * KCAL_PER_KG) / 7;
  const clamped = Math.max(-MAX_ADJUST_KCAL, Math.min(MAX_ADJUST_KCAL, raw));
  return Math.round(clamped / 50) * 50;
}
```

- [ ] **Step 4:** `pnpm test lib/nutrition/tdee-adaptation.test.ts` → PASS (fix sign conventions against the test cases if needed — the tests are the spec).

- [ ] **Step 5: Commit**

```bash
git add lib/nutrition/tdee-adaptation.ts lib/nutrition/tdee-adaptation.test.ts
git commit -m "Add weight-trend TDEE adjustment math"
```

### Task 2: Adaptation card on the nutrition screen

**Files:**
- Create: `components/nutrition/tdee-adaptation-card.tsx`
- Modify: `app/nutrition/nutrition-content.tsx` (render the card above the meal list)

- [ ] **Step 1: Locate the targets save path** — read `components/profile/macro-targets-pane.tsx`'s save handler and note the exact endpoint + payload it uses to persist calorie/macro targets (this is the established write path; the card reuses it verbatim). Record the endpoint in the component's comment.
- [ ] **Step 2: Build the card.** Inputs it already has access to on the nutrition screen: `targets` (current calorie goal), the user's `fitnessGoal` (from the profile payload — fetch the same way `goals-section.tsx` does), and 14 days of weigh-ins (`/api/body-metadata` recent rows already fetched for the weekly chart — reuse that state). Logic:

```tsx
const slope = weeklyWeightSlope(recentWeighIns);         // null → render nothing
const delta = slope === null ? 0 : tdeeAdjustment(goal, slope);
const suppressed = typeof window !== "undefined" &&
  localStorage.getItem(`ta_tdee_nudge:${isoWeek(todayInTz())}`) === "handled";
if (slope === null || delta === 0 || suppressed) return null;
```

Card copy: "You're trending {slope.toFixed(1)} kg/week vs a {target} goal — adjust calories {delta > 0 ? "+" : ""}{delta} to {targets.calories + delta} kcal?" with **Apply** (POST the discovered targets endpoint with `calories: targets.calories + delta`, keep macros' current values, then invalidate `nutrition-targets` + refetch, set the localStorage marker) and **Dismiss** (marker only). `isoWeek` is a 6-line helper in the same file (year-week string from a `YYYY-MM-DD` date).
- [ ] **Step 3: Verify** on `pnpm dev` against the local dev DB (seeded body metrics): card appears when the seeded trend diverges from goal; Apply updates the calorie ring immediately; Dismiss hides it for the week; neither reappears after reload within the same ISO week.
- [ ] **Step 4: Commit**

```bash
git add components/nutrition/tdee-adaptation-card.tsx app/nutrition/nutrition-content.tsx
git commit -m "Offer a weekly calorie nudge when the weight trend diverges from goal"
```

---

## Feature 2 — Injury-aware exercise substitution (in-workout)

### Task 3: Pure candidate filter

**Files:**
- Create: `lib/workout/injury-substitution.ts`
- Test: `lib/workout/injury-substitution.test.ts`

- [ ] **Step 1: Failing tests** (the rule: a candidate must share ≥1 *non-injured* main muscle with the original AND must not involve any injured muscle in main or secondary roles):

```ts
import { describe, it, expect } from "vitest";
import { injurySafeAlternatives } from "./injury-substitution";

const LIB = [
  { name: "Bench Press", muscles: [{ muscle: "chest", role: "main" }, { muscle: "triceps", role: "secondary" }], equipment: ["barbell"] },
  { name: "Machine Chest Press", muscles: [{ muscle: "chest", role: "main" }], equipment: ["machine"] },
  { name: "Overhead Press", muscles: [{ muscle: "shoulders", role: "main" }, { muscle: "triceps", role: "secondary" }], equipment: ["barbell"] },
  { name: "Push-Up", muscles: [{ muscle: "chest", role: "main" }, { muscle: "shoulders", role: "secondary" }], equipment: [] },
];

describe("injurySafeAlternatives", () => {
  it("offers same-main-muscle candidates that avoid the injured muscle", () => {
    const alts = injurySafeAlternatives(
      { name: "Bench Press", mainMuscles: ["chest"] },
      ["shoulders"],
      LIB,
    );
    // Push-Up hits shoulders (secondary) → excluded; the original excluded by name
    expect(alts.map(a => a.name)).toEqual(["Machine Chest Press"]);
  });
  it("returns empty when every main muscle of the original is injured", () => {
    const alts = injurySafeAlternatives({ name: "Bench Press", mainMuscles: ["chest"] }, ["chest"], LIB);
    expect(alts).toEqual([]);
  });
  it("is case-insensitive on muscle names", () => {
    const alts = injurySafeAlternatives({ name: "Bench Press", mainMuscles: ["Chest"] }, ["SHOULDERS"], LIB);
    expect(alts.map(a => a.name)).toEqual(["Machine Chest Press"]);
  });
});
```

- [ ] **Step 2:** `pnpm test lib/workout/injury-substitution.test.ts` → FAIL.

- [ ] **Step 3: Implement** (mirrors `getAlternatives` in `builder-review.tsx:183-198`, with the injury constraint added; the entry type matches `/api/exercise-library`'s response shape used by `add-exercise-sheet.tsx` — confirm field names there before typing):

```ts
export interface LibraryEntry {
  name: string;
  muscles: { muscle: string; role: string }[];
  equipment: string[];
}

export function injurySafeAlternatives(
  original: { name: string; mainMuscles: string[] },
  injuredMuscles: string[],
  library: LibraryEntry[],
  limit = 8,
): LibraryEntry[] {
  const injured = new Set(injuredMuscles.map(m => m.toLowerCase()));
  const safeMains = new Set(
    original.mainMuscles.map(m => m.toLowerCase()).filter(m => !injured.has(m)),
  );
  if (safeMains.size === 0) return [];
  return library
    .filter(ex => {
      if (ex.name === original.name) return false;
      const hitsInjured = ex.muscles.some(m => injured.has(m.muscle.toLowerCase()));
      if (hitsInjured) return false;
      return ex.muscles.some(m => m.role === "main" && safeMains.has(m.muscle.toLowerCase()));
    })
    .slice(0, limit);
}
```

- [ ] **Step 4:** `pnpm test` → PASS. **Step 5: Commit**

```bash
git add lib/workout/injury-substitution.ts lib/workout/injury-substitution.test.ts
git commit -m "Add injury-safe exercise alternative filter"
```

### Task 4: Swap sheet wired to the injury banner

**Files:**
- Create: `components/workout/injury-swap-sheet.tsx`
- Modify: `components/workout/active-workout-screen.tsx:463-476` (banner gains a "Swap exercise →" button), `components/workout-screen.tsx` (owns the swap state + handler)

- [ ] **Step 1: Sheet component** — props `{ open, onOpenChange, original, injuredMuscles, onSwap }`. On open it loads the library via `cachedFetch('exercise-library', '/api/exercise-library', TTL_LONG)` (the key `add-exercise-sheet.tsx` already uses — reuse it, don't refetch raw), runs `injurySafeAlternatives`, and lists candidates (name + equipment badges + muscle tags, same row style as the add-exercise sheet). Empty result renders: "No safe alternative targets {muscles} — consider skipping this exercise today." with a **Skip exercise** button that calls `onSwap(null)`.
- [ ] **Step 2: Swap handler in the orchestrator** (`workout-screen.tsx`) — this-session-only, never mutates the stored program:

```ts
function handleInjurySwap(exerciseIndex: number, alt: LibraryEntry | null) {
  setExercises(prev => {
    if (alt === null) return prev.filter((_, i) => i !== exerciseIndex); // skip
    return prev.map((ex, i) => i !== exerciseIndex ? ex : {
      ...ex,                                    // keep sets/reps/style/rest from the slot
      name: alt.name,
      mainMuscles: alt.muscles.filter(m => m.role === "main").map(m => m.muscle),
      secondaryMuscles: alt.muscles.filter(m => m.role === "secondary").map(m => m.muscle),
      targetWeights: ex.targetWeights.map(() => 0), // no 1RM basis yet → manual entry
    };
  });
}
```

Then attempt a weight seed: fetch `/api/exercise-history?name={alt.name}` (the endpoint `exercise-summary-screen.tsx:41` uses); if it returns an `estimated1rm`, set `targetWeights` to `mround125(pct × est1rm)` per set using the slot's existing per-set percentages. Field names must be confirmed against that route's response before coding. Logging needs no changes: `/api/log-exercise` keys off the exercise *name* and resolves `exercise_id` server-side, so the swapped exercise logs as itself.
- [ ] **Step 3: Banner button** — in `active-workout-screen.tsx` the existing injury banner (`:463-476`) gains a right-aligned "Swap →" button that calls a new `onRequestInjurySwap(exerciseIndex, injuredMuscles)` prop threaded from the orchestrator (which opens the sheet).
- [ ] **Step 4: Verify** against the local dev DB: add an active injury for a muscle in today's session (Health → injuries), start the workout → banner shows with Swap → sheet lists only safe alternatives → swapping updates the exercise card, warmup text, and heatmap; logging sets records under the new exercise name; the stored program is unchanged afterwards (check Config); Skip removes the exercise for this session only.
- [ ] **Step 5: Commit**

```bash
git add components lib
git commit -m "Offer injury-safe exercise swaps from the in-workout warning banner"
```

---

## Feature 3 — Year-in-review "Wrapped"

### Task 5: Aggregation route

**Files:**
- Create: `app/api/year-review/route.ts`
- Test: manual (SQL verified against the seeded local dev DB)

- [ ] **Step 1:** `GET /api/year-review` (auth via the same `auth()` guard every route uses; `tz = session.user?.timezone`). One repository round-trip per stat group, `Promise.all`'d, over the trailing 365 days (`since = formatInTimeZone(subDays(new Date(), 365), tz, 'yyyy-MM-dd')`):
  - totals: sessions count, total sets, total volume kg (`SUM(weight_kg * reps)` over `set_logs` joined through `exercise_logs`→`workout_sessions` filtered `user_id` + `started_at >= since`), total training minutes.
  - top 5 exercises by set count (+ each one's 1RM at window start vs now from `exercise_logs.estimated_1rm` first/last — reuse the strength-trend route's query shape).
  - PRs achieved in-window from `personal_records` (`achieved_at >= since`).
  - longest weekly streak: consecutive ISO weeks with ≥1 session (compute in TS from the session dates — a ~10-line reduce).
  - per-month session counts (12 buckets) for the bar strip.
  Return one JSON object; add `Cache-Control: private, max-age=3600` (it changes at most daily).
- [ ] **Step 2: Verify** with `curl` against `pnpm dev` + the seeded DB: totals match a hand-run SQL spot-check (`psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM workout_sessions WHERE ..."`).
- [ ] **Step 3: Commit**

```bash
git add app/api/year-review/route.ts
git commit -m "Aggregate a year-in-review stats payload"
```

### Task 6: Wrapped page + share

**Files:**
- Create: `app/year-review/page.tsx`, `app/year-review/year-review-content.tsx`
- Modify: `app/more/more-content.tsx` (entry link "Your Year →" in the profile tab)

- [ ] **Step 1:** Full-screen vertically-snapping sections (`snap-y snap-mandatory overflow-y-auto h-screen`), one stat per section, staggered `motion` fade/slide-ins gated by `whileInView` (reduced motion handled globally by Batch H's `MotionConfig`; if Batch H hasn't landed, wrap this page's transitions in `useReducedMotion` checks). Sections: total volume ("You moved X tonnes"), sessions + streak, top exercise with its 1RM delta, PR count with the biggest PR called out, per-month bar strip (plain divs, no chart.js). Data via `cachedFetch('year-review', '/api/year-review', TTL_LONG)`.
- [ ] **Step 2: Share** — reuse the done-screen's text-share pattern (`done-screen.tsx:124-129`): a Share button composing a summary line ("2026 so far: N sessions, X kg moved, Y PRs 🏋️") through `navigator.share` with clipboard fallback. (Image export is out of scope — the existing infra is text-based; noted in self-review.)
- [ ] **Step 3: Verify** — open from More → Your Year: sections animate in on scroll against seeded data; share sheet opens on device/emulator, clipboard fallback works on desktop.
- [ ] **Step 4: Commit**

```bash
git add app/year-review app/more/more-content.tsx
git commit -m "Add the year-in-review page with shareable summary"
```

---

## Feature 4 — Supersets / circuits

### Task 7: Schema — Postgres 107 + local v15

**Files:**
- Create: `lib/data/postgres/migrations/107_superset_groups.sql`
- Modify: `lib/data/postgres/schema.ts:113-123`, `lib/sqlite/migrations.ts` (v15 + RECONCILE lists), `lib/local-store/types.ts` + the pull-delta mapping for `session_exercises` (`sync-engine.ts` / `sqlite-backend.ts` applyDelta program branch)

- [ ] **Step 1: Migration**

```sql
-- 107_superset_groups.sql
-- Exercises sharing a non-null group value within a session alternate as a superset.
ALTER TABLE session_exercises ADD COLUMN IF NOT EXISTS superset_group SMALLINT;
```

- [ ] **Step 2:** Drizzle schema: add `supersetGroup: smallint('superset_group'),` to `sessionExercises` (import `smallint` from drizzle's pg-core alongside the existing imports).
- [ ] **Step 3:** Local mirror: v15 migration `ALTER TABLE session_exercises ADD COLUMN superset_group INTEGER;` in `lib/sqlite/migrations.ts`, **plus** the column added to `RECONCILE_COLUMNS` (hard rule), plus the field threaded through the `session_exercises` rows in `getSyncDelta` (server), the pull-delta mapping, `applyDelta`'s replace-children insert, and `lib/local-store/program-assembler.ts`.
- [ ] **Step 4:** `pnpm db:local` applies 107 cleanly; `pnpm test` (program-assembler tests still green — extend its fixture with a grouped pair asserting the field round-trips).
- [ ] **Step 5: Commit**

```bash
git add lib
git commit -m "Add superset_group to session exercises across Postgres and the local mirror"
```

### Task 8: Builder grouping UI

**Files:**
- Modify: `components/config/program-editor-sheet.tsx` (per-exercise row menu), plus the program save payload path (`app/api/workout-templates` / `saveProgram` in `slices/programs.ts` — the column must persist through save)

- [ ] **Step 1:** Read the editor's exercise-row rendering and its save payload construction first. Add a "Link with next ↓" action on each exercise row (except the last): sets `supersetGroup` on both rows to the lowest free positive integer in the session; linked rows render with a shared left border + "A1/A2" style badge; a linked row gets "Unlink" instead. Keep it pairs-or-more but contiguous-by-position only (enforce: linking re-sorts group members to adjacent positions).
- [ ] **Step 2:** Thread `supersetGroup` through the save payload → `saveProgram` insert columns → verify a saved program round-trips the value (`psql` check on `session_exercises`).
- [ ] **Step 3: Verify** in `pnpm dev`: link two exercises, save, reload the editor — grouping persists and badges render.
- [ ] **Step 4: Commit**

```bash
git add components lib app
git commit -m "Group exercises into supersets in the program editor"
```

### Task 9: Pure alternation order helper

**Files:**
- Create: `lib/workout/superset-order.ts`
- Test: `lib/workout/superset-order.test.ts`

- [ ] **Step 1: Failing tests** — the workout flow consumes a flat ordered list of `{exerciseIndex, setIndex}` steps; grouped exercises interleave per set, ungrouped stay sequential:

```ts
import { describe, it, expect } from "vitest";
import { buildSetSequence } from "./superset-order";

describe("buildSetSequence", () => {
  it("interleaves a 2-exercise superset per set index", () => {
    // A (group 1, 3 sets), B (group 1, 3 sets), C (ungrouped, 2 sets)
    const seq = buildSetSequence([
      { supersetGroup: 1, setCount: 3 },
      { supersetGroup: 1, setCount: 3 },
      { supersetGroup: null, setCount: 2 },
    ]);
    expect(seq).toEqual([
      { exerciseIndex: 0, setIndex: 0 }, { exerciseIndex: 1, setIndex: 0 },
      { exerciseIndex: 0, setIndex: 1 }, { exerciseIndex: 1, setIndex: 1 },
      { exerciseIndex: 0, setIndex: 2 }, { exerciseIndex: 1, setIndex: 2 },
      { exerciseIndex: 2, setIndex: 0 }, { exerciseIndex: 2, setIndex: 1 },
    ]);
  });
  it("handles uneven set counts by dropping the exhausted exercise from the rotation", () => {
    const seq = buildSetSequence([
      { supersetGroup: 1, setCount: 2 },
      { supersetGroup: 1, setCount: 3 },
    ]);
    expect(seq).toEqual([
      { exerciseIndex: 0, setIndex: 0 }, { exerciseIndex: 1, setIndex: 0 },
      { exerciseIndex: 0, setIndex: 1 }, { exerciseIndex: 1, setIndex: 1 },
      { exerciseIndex: 1, setIndex: 2 },
    ]);
  });
  it("passes an ungrouped program through in plain order", () => {
    const seq = buildSetSequence([
      { supersetGroup: null, setCount: 2 },
      { supersetGroup: null, setCount: 1 },
    ]);
    expect(seq).toEqual([
      { exerciseIndex: 0, setIndex: 0 }, { exerciseIndex: 0, setIndex: 1 },
      { exerciseIndex: 1, setIndex: 0 },
    ]);
  });
});
```

- [ ] **Step 2:** FAIL, then **Step 3: implement** (walk exercises in position order; when a group is encountered, emit round-robin over its members' remaining sets before moving past the group):

```ts
export interface SequenceInput { supersetGroup: number | null; setCount: number }
export interface SetStep { exerciseIndex: number; setIndex: number }

export function buildSetSequence(exercises: SequenceInput[]): SetStep[] {
  const steps: SetStep[] = [];
  let i = 0;
  while (i < exercises.length) {
    const g = exercises[i].supersetGroup;
    if (g === null) {
      for (let s = 0; s < exercises[i].setCount; s++) steps.push({ exerciseIndex: i, setIndex: s });
      i++;
      continue;
    }
    const members: number[] = [];
    let j = i;
    while (j < exercises.length && exercises[j].supersetGroup === g) members.push(j++);
    const emitted = members.map(() => 0);
    let remaining = members.reduce((a, m) => a + exercises[m].setCount, 0);
    while (remaining > 0) {
      for (let k = 0; k < members.length; k++) {
        const m = members[k];
        if (emitted[k] < exercises[m].setCount) {
          steps.push({ exerciseIndex: m, setIndex: emitted[k]++ });
          remaining--;
        }
      }
    }
    i = j;
  }
  return steps;
}
```

- [ ] **Step 4:** PASS. **Step 5: Commit**

```bash
git add lib/workout/superset-order.ts lib/workout/superset-order.test.ts
git commit -m "Add superset set-sequencing helper"
```

### Task 10: Orchestrator integration (smallest viable slice)

⚠️ Heaviest task in the batch — the orchestrator (`components/workout-screen.tsx`, ~1,000 lines) currently advances exercise-by-exercise with the exercise-summary screen between exercises. Read its `handleCompleteSet` / advance logic and `components/workout/types.ts` before coding. **v1 scope decisions (explicit):** AI-dynamic programs ignore groups entirely (the prescription override path flattens: treat `supersetGroup` as null when `aiDrivesLoad` is true); the exercise-summary screen shows once per exercise when its *last* set completes (unchanged component); rest runs between every step of a superset using the *current* step's exercise rest value (no new "shared rest" field in v1).

**Files:**
- Modify: `components/workout-screen.tsx`, `components/workout/pre-workout-screen.tsx` (grouped display), `components/workout/active-workout-screen.tsx` (next-up label shows the alternate exercise), `lib/stores/workout-store.ts` (persist the sequence cursor so refresh mid-superset resumes correctly)

- [ ] **Step 1:** Compute `const setSequence = useMemo(() => buildSetSequence(exercises.map(e => ({ supersetGroup: e.supersetGroup ?? null, setCount: e.targetReps.length }))), [exercises]);` and a persisted `sequenceCursor` in the workout store (Zustand persist, defaulting 0; reset with the session). Derive `exerciseIndex`/`setIndex` from `setSequence[sequenceCursor]` wherever the orchestrator currently tracks them independently — for ungrouped programs the derived values are identical to today's behaviour (assert this while migrating: the pure helper's plain-order test is the guarantee).
- [ ] **Step 2:** Advance on set completion = `sequenceCursor + 1`; fire the exercise-summary transition only when the completed step was that exercise's final set. Pre-workout list renders grouped exercises as one bracketed card ("Superset: A + B"); the active screen's next-up hint reads from `setSequence[cursor + 1]`.
- [ ] **Step 3:** Verify with the seeded local DB **and** a hand-grouped program: (a) ungrouped session behaves exactly as before (regression pass across pre → active → summary → done); (b) grouped pair alternates A1→B1→A2→B2…, rest timer runs between each, summary shows after each exercise's last set, logging attributes sets to the right exercises (check `set_logs` rows); (c) refresh mid-superset resumes at the same step (Zustand persist); (d) an AI-dynamic program ignores grouping.
- [ ] **Step 4: Commit**

```bash
git add components lib
git commit -m "Alternate superset exercises in the workout flow"
```

---

## Final checks (whole batch)

- [ ] `pnpm lint && npx tsc --noEmit && pnpm test && pnpm build` — all green.
- [ ] Local end-to-end pass per the standing instructions (`pnpm dev` + local DB): TDEE card apply/dismiss; injury swap + skip + logging attribution; year-review page + share; superset flow (grouped + ungrouped regression + AI-dynamic flatten).
- [ ] Device follow-ups to flag in the PR: superset timer flow feel on the S25; `navigator.share` on Android.
- [ ] Open the PR (title: "Workout & nutrition features: TDEE nudge, injury swap, year review, supersets") and **ask the user before merging** — deploys code. Version bump: minor, per the changelog rules.

## Self-review

- **Coverage:** all four Batch I items have tasks (TDEE → 1–2, injury swap → 3–4, Wrapped → 5–6, supersets → 7–10). ✔
- **Migrations:** 107 = superset_group only; 108 freed (TDEE needs no migration — decision recorded in the header); local v15 additive + RECONCILE-listed. ✔
- **Consistency:** `weeklyWeightSlope`/`tdeeAdjustment`, `injurySafeAlternatives(original, injuredMuscles, library, limit)`, `buildSetSequence(exercises) → SetStep[]`, `supersetGroup` — identical names at definition and every use. ✔
- **No placeholders:** every code step shows real code; the two "discover the exact endpoint/field first" steps (targets save path, exercise-history response) name the exact file to read and what to extract, with the consuming code shown. ✔
- **Deliberately out of scope:** shared-rest-per-group field (v1 uses the current step's rest); superset support inside AI-dynamic prescriptions (flattened); image-based share for Wrapped (existing infra is text-only); circuits of 3+ work via the same group mechanic but the builder UI only offers link-with-next chaining in v1.
