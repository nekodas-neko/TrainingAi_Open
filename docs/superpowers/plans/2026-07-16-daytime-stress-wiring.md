# Daytime Stress Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the daytime-stress engine from feeding nothing but Body Battery drain — persist today's stress into `oura_daily_derived`, replace the frozen Cloud `daySummary === 'very_stressful'` deload proxy with the live derived signal, surface stress in the readiness response, expose it to AI chat + the weekly digest, and show the intraday stress strip on the expanded Body Battery card.

**Architecture:** The Body Battery route already computes the full intraday `StressPoint[]` series on every read (`buildDaytimeStressSeries`, 30-min dHRV buckets scored through Oura's ported `stress_daytime_sensing` rule → `stressLevel ∈ [−1,+1]`, negative = stressed). This plan adds one pure day-summary helper (`summarizeStressDay`, One Formula One Place) and makes the route both **persist** the summary (best-effort COALESCE upsert into the existing, never-written `oura_daily_derived.daytime_stress_scaled / stress_high_minutes / recovery_high_minutes` columns — same pattern as the readiness route's persist) and **return** the series + high-minutes in its response. Every other consumer then reads the *persisted* derived row — next-session deload override, readiness-route `stressHigh`, chat's `getRecoveryData`, weekly digest — never recomputing the model.

**Tech Stack:** TypeScript, Next.js 15 route handlers, Drizzle/Postgres (`oura_daily_derived`, migration 123 — columns already exist, **no new migration**), the existing `lib/health/daytime-stress.ts` engine + golden-tested ONNX dHRV inference, vitest, pure-SVG `components/ui/sparkline.tsx` (NOT the chart.js `sparkline-chart.tsx` — the card sits on the home screen and must not drag chart.js into that bundle).

---

## Why now

Source finding: **S5** in [`docs/reviews/2026-07-16-data-efficiency-review.md`](../../reviews/2026-07-16-data-efficiency-review.md) (§1.4 + §2.2): the strongest live "life stress" signal in the app is modelled daily and then reduced to one drain number; readiness, periodization, chat and digests either see nothing or run on the **frozen** Oura Cloud fields (`oura_daily.stress_high`, `day_summary`) that stopped updating at the 2026-07-07 BLE re-key.

**Branch:** `feat/daytime-stress-wiring` (start from freshly-fetched `main`: `git fetch origin main && git remote prune origin && git checkout -B feat/daytime-stress-wiring origin/main`).

## Reconciliation with PRs #570 / #571 / #575 (same-day changes — the review is partly stale)

The review was written against the pre-#575 code. Re-read of current `main` (`15c5b15`):

- **#570** added the engine + `getOuraDaytimeSignals` (temp tag `0x46`/`0x69`, MET tag `0x50` from `oura_raw_samples`) and the `STRESS_DRAIN_RATE` extra drain in the battery walk.
- **#571** added the "Daytime stress drained −X" text line to the expanded card (renders only when `extraDrained > 0`).
- **#575** replaced the review's `relStress` (raw dhrv − day-median, ms) with **Oura's real ported stress rule**: `StressPoint` now carries `stressLevel ∈ [−1,+1]` from `daytimeStressLevel()` (night-HRV-baseline-scaled saturation curves + equalize band), drain scales by `|stressLevel|`, and the response's `stress.current` is the latest bucket's scaled level. `MODEL_VERSION` bumped to `v3:…:oura-rule`.

**Still true post-#575 (the review's wiring gaps all stand):** the series is computed then discarded after the walk — it is **NOT in the response** (only `{current, draining, extraDrained}` survive at `app/api/body-battery/route.ts:238-244`), nothing writes the `daytime_stress_*` derived columns, readiness's `stressHigh` (`app/api/readiness-score/route.ts:377`) is the frozen Cloud passthrough, the deload override (`lib/ai-periodization/ai-dynamic.ts:156`) is `daySummary === 'very_stressful'` (frozen), and no chat tool or digest mentions stress. **What #575 changed for this plan:** the `[−1,+1]` scaled level now maps 1:1 onto the `daytime_stress_scaled` column semantics (migration 123 comments it `-- [-1, 1]`), so the persist is a direct aggregation, and Task 7 must **add** the series to the response — it isn't already there.

## Scope decisions (encode once, don't re-litigate)

1. **Persist daily, from the route that already computes it.** The body-battery route best-effort-upserts today's `daytimeStressScaled` (day-mean level), `stressHighMinutes`, and `recoveryHighMinutes` — `recoveryHighMinutes` rides along because the identical helper produces it and the activity page + readiness route display `recoveryHigh` beside `stressHigh` (sibling-surface rule: refreshing one tile while its twin stays frozen is half a fix). Write only stress columns; a persist failure never fails the read (copy `readiness-score/route.ts:342-352`).
2. **Chronic stress / resilience stay OUT.** Cumulative stress, `chronic_stress_score`, and `resilience_level` remain queued as **Oura program P-E P2/P3** (`docs/implementation-backlog.md`) — this plan wires the *daytime* signal only. Task 9 annotates P-E's entry.
3. **Derived-first, frozen-Cloud fallback for the deload override.** When a derived row exists for today, it decides (`stressHighMinutes ≥ 120`); only when no derived stress exists does the frozen `daySummary` string still count. Rationale: a non-null derived row means the ring measured today — letting a pre-re-key `very_stressful` also fire would mix eras.
4. **Stress is display in readiness, NOT a new weighted contributor.** The dHRV inputs (HRV/RHR/temp) already feed the readiness composite — adding a stress contributor would double-count, the same reasoning the illness radar documented when it chose bounded suppression over a contributor. We only replace the frozen `stressHigh`/`recoveryHigh` passthroughs with derived-when-available values (same field names/units — seconds — so `activity-content.tsx:34`'s `/60` display keeps working).
5. **Unit trap, stated once:** Oura Cloud's `oura_daily.stress_high` is **seconds** (`lib/oura/types.ts:154`; the activity page divides by 60 — the `schema.ts:649` "minutes" comment is wrong). Our derived column `stress_high_minutes` is **minutes** (name is explicit). The readiness/route contract stays seconds: coalesce as `stressHighMinutes * 60`.
6. **No new endpoint, no new cache keys.** The body-battery response gains additive fields; clients already read it via `cachedFetchToday('body-battery', '/api/body-battery', TTL_SHORT, …)` (`app/session-select/session-select-content.tsx:684`, `components/nutrition/end-of-day/end-of-day-review.tsx:75`). Additive shape ⇒ no invalidation-group change; the card must optional-chain the new fields because a pre-deploy cached seed won't have them. SWR headers unchanged.

## Sandbox limits — stated honestly

- **The dHRV series needs real daytime ring signal** (skin-temp + MET raw samples with a clock anchor, HR rows, and an overnight-HRV baseline). The fresh local dev DB has none of this, so `/api/body-battery` returns `stress: null` out of the box. Task 10 seeds synthetic daytime data (a clock anchor + `decoded`-JSON raw samples + `oura_heartrate` rows — `getOuraDaytimeSignals` reads `decoded` first, so no valid `body_hex` is needed) to exercise the full pipeline against the local Postgres on 5433.
- **The engine's own device caveat stands:** whether the ring actually captures enough worn-idle daytime temp/MET/HR for real buckets is **not yet device-verified** (the radio power-gates at a desk — see the Oura BLE section of `CLAUDE.md`). This plan's wiring is correct against seeded data either way; if the owner's real days produce empty series, everything degrades to today's behaviour (nulls, frozen fallbacks). Keep/extend the existing Known-Issues caveat rather than claiming device verification.
- **Chat tool + weekly digest AI calls** need `GOOGLE_GENERATIVE_AI_API_KEY`; if absent in-session, those two are verified by unit-level shape + `tsc` + code review, and said so in the PR.
- Not exercised in the sandbox: Samsung WebView rendering of the new strip (verify at ≤640px viewport in dev; it's pure SVG in the existing card, no native/safe-area/gesture surface, so an APK smoke is not gating — note it in the PR).

## File structure

**Create:**
- `components/body-battery/stress-strip.tsx` — intraday stress strip + stress text lines (extracted component; keeps `body-battery-card.tsx` lean).

**Modify:**
- `lib/health/daytime-stress.ts` — add `summarizeStressDay` + threshold constants (One Formula One Place).
- `lib/health/__tests__/daytime-stress.test.ts` — tests for the summary helper.
- `app/api/body-battery/route.ts` — persist stress summary; add `stress.series` + `stress.highMinutes` to the response.
- `lib/ai-periodization/ai-dynamic.ts` — `stressHighMinutes` input; derived-first deload override.
- `lib/__tests__/ai-dynamic.test.ts` — override tests.
- `lib/data/postgres/adapter.ts` (~line 1514, ai_dynamic branch) — fetch today's derived row, pass `stressHighMinutes`.
- `app/api/readiness-score/route.ts` — derived-first `stressHigh`/`recoveryHigh`.
- `lib/ai-chat/tools.ts` — `getRecoveryData` gains `daytimeStress`.
- `app/api/weekly-digest/route.ts` — one stress context line.
- `components/body-battery-card.tsx` — mount `<StressStrip/>` (replaces the inline #571 drain line).
- `docs/implementation-backlog.md` + `docs/planned_upgrades.md` — P-E annotation + S5 tick (Task 9).
- `package.json` + `lib/changelog.ts` + `projectOverview.md` + `docs/overview/history-newest.md` (final task).

**No migration.** Columns exist since `123_oura_daily_derived.sql`; `upsertOuraDailyDerived`'s `DERIVED_COLS` map (`lib/data/postgres/slices/oura.ts:630-641`) already includes all three keys. No repository interface change anywhere.

---

### Task 1: `summarizeStressDay` — the one place day-level stress numbers come from

**Files:**
- Modify: `lib/health/daytime-stress.ts` (append after `buildDaytimeStressSeries`)
- Test: `lib/health/__tests__/daytime-stress.test.ts`

- [ ] **Step 1: Write the failing test** (append to the existing test file)

```typescript
// append to lib/health/__tests__/daytime-stress.test.ts
import { summarizeStressDay, STRESS_HIGH_LEVEL, STRESS_HIGH_DAY_THRESHOLD_MIN, type StressPoint } from '../daytime-stress'

describe('summarizeStressDay — day-level aggregation of the stress series', () => {
  const pt = (t: number, stressLevel: number): StressPoint => ({ t, dhrv: 40, stressLevel })

  it('returns null on an empty series (no signal → nothing persisted)', () => {
    expect(summarizeStressDay([])).toBeNull()
  })

  it('aggregates mean level and high/recovery minutes from 30-min buckets', () => {
    // 4 buckets: two high-stress (−0.8, −0.6), one neutral (0.1), one high-recovery (0.7)
    const series = [pt(0, -0.8), pt(1, -0.6), pt(2, 0.1), pt(3, 0.7)]
    const s = summarizeStressDay(series)
    expect(s).not.toBeNull()
    expect(s!.daytimeStressScaled).toBeCloseTo(-0.15, 2)  // mean of levels, 2dp
    expect(s!.stressHighMinutes).toBe(60)                 // 2 buckets ≤ STRESS_HIGH_LEVEL × 30 min
    expect(s!.recoveryHighMinutes).toBe(30)               // 1 bucket ≥ +0.5 × 30 min
  })

  it('boundary buckets count (level exactly at the threshold is "high")', () => {
    const s = summarizeStressDay([pt(0, STRESS_HIGH_LEVEL)])
    expect(s!.stressHighMinutes).toBe(30)
  })

  it('respects a custom bucket size', () => {
    const s = summarizeStressDay([pt(0, -0.9)], 15 * 60_000)
    expect(s!.stressHighMinutes).toBe(15)
  })

  it('exports a sane deload-override day threshold', () => {
    expect(STRESS_HIGH_DAY_THRESHOLD_MIN).toBe(120)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/health/__tests__/daytime-stress.test.ts`
Expected: FAIL — `summarizeStressDay` / `STRESS_HIGH_LEVEL` have no exported member.

- [ ] **Step 3: Implement** (append to `lib/health/daytime-stress.ts`; also lift the bucket default into the new shared constant)

```typescript
// ── Day-level aggregation (One Formula, One Place) ─────────────────────────────
// Thresholds on the scaled level: |level| crosses 0.5 exactly when the raw pre-equalize
// value crosses 0.4 — i.e. the moment's dHRV deviation is ≥40% of the personal
// stress/recovery saturation. That is our "high stress" / "high recovery" bucket.
export const STRESS_BUCKET_MS = 30 * 60_000
export const STRESS_HIGH_LEVEL = -0.5
export const RECOVERY_HIGH_LEVEL = 0.5
/** Minutes of high stress in a day at/over which the next-session engine treats the day
 *  as stress-deload-worthy (the derived replacement for Cloud's `very_stressful`). ~2 h,
 *  a documented judgement call — tune here, nowhere else. */
export const STRESS_HIGH_DAY_THRESHOLD_MIN = 120

export interface StressDaySummary {
  /** day-mean scaled level, [−1,+1], 2dp (maps onto oura_daily_derived.daytime_stress_scaled) */
  daytimeStressScaled: number
  stressHighMinutes: number
  recoveryHighMinutes: number
}

/** Collapse an intraday stress series into the persisted day summary. null on empty —
 *  a day with no scored buckets writes nothing (COALESCE keeps any earlier value). */
export function summarizeStressDay(series: StressPoint[], bucketMs = STRESS_BUCKET_MS): StressDaySummary | null {
  if (series.length === 0) return null
  const bucketMin = bucketMs / 60_000
  const meanLevel = series.reduce((s, p) => s + p.stressLevel, 0) / series.length
  return {
    daytimeStressScaled: Math.round(meanLevel * 100) / 100,
    stressHighMinutes: Math.round(series.filter(p => p.stressLevel <= STRESS_HIGH_LEVEL).length * bucketMin),
    recoveryHighMinutes: Math.round(series.filter(p => p.stressLevel >= RECOVERY_HIGH_LEVEL).length * bucketMin),
  }
}
```

Also change `buildDaytimeStressSeries`'s signature default from `bucketMs = 30 * 60_000` to `bucketMs = STRESS_BUCKET_MS` (move the constant declaration above the function) so the bucket size lives once.

- [ ] **Step 4: Run to verify it passes** (the pre-existing golden tests must stay green too)

Run: `npx vitest run lib/health/__tests__/daytime-stress.test.ts`
Expected: PASS, all suites including the pinned `.pt` goldens.

- [ ] **Step 5: Commit**

```bash
git add lib/health/daytime-stress.ts lib/health/__tests__/daytime-stress.test.ts
git commit -m "Add day-level stress summary so consumers stop re-deriving thresholds"
```

---

### Task 2: Body Battery route — persist the summary, return the series

**Files:**
- Modify: `app/api/body-battery/route.ts`

- [ ] **Step 1: Extend the response type and imports**

```typescript
// line 7 — extend the import:
import { buildDaytimeStressSeries, summarizeStressDay, type StressPoint, type DhrvBaselines } from '@/lib/health/daytime-stress'
```

```typescript
// in BodyBatteryResponse, replace the stress field (lines 26-30) with:
  // Daytime-stress contribution (dHRV-based). null when there wasn't enough daytime signal to run it.
  stress: {
    current: number | null  // latest bucket's stress level, [−1,+1] (negative = stressed)
    draining: boolean       // stress is currently adding drain
    extraDrained: number    // battery points drained by stress since wake
    series: { t: number; level: number }[]  // 30-min bucket midpoints, level ∈ [−1,+1]
    highMinutes: number | null              // minutes at level ≤ STRESS_HIGH_LEVEL today
  } | null
```

- [ ] **Step 2: Persist + respond.** Immediately BEFORE the write-through snapshot `try` block (line ~207, after `const current = Math.round(battery)`), add:

```typescript
  // ── Persist today's stress summary (completed-form, review S5) ─────────────
  // Same posture as the snapshot below and the readiness route's persist: writes ONLY the
  // three stress columns (COALESCE upsert — never touches source/model_versions or any
  // sibling metric's provenance on the row), and a failure never fails the read.
  const stressSummary = summarizeStressDay(stressSeries)
  if (stressSummary) {
    try {
      await repo.upsertOuraDailyDerived(userId, todayIso, {
        daytimeStressScaled: stressSummary.daytimeStressScaled,
        stressHighMinutes: stressSummary.stressHighMinutes,
        recoveryHighMinutes: stressSummary.recoveryHighMinutes,
      })
    } catch (err) {
      console.error('[body-battery] stress persist failed (read still served):', err)
    }
  }
```

Then replace the `stress:` field of the final `NextResponse.json` (lines 238-244) with:

```typescript
    stress: stressSeries.length
      ? {
          current: Math.round(stressSeries[stressSeries.length - 1].stressLevel * 100) / 100,
          draining: (stressAt(now.getTime()) ?? 0) < 0,
          extraDrained: Math.round(stressDrained * 10) / 10,
          series: stressSeries.map(p => ({ t: p.t, level: Math.round(p.stressLevel * 100) / 100 })),
          highMinutes: stressSummary?.stressHighMinutes ?? null,
        }
      : null,
```

Leave the `Cache-Control` header, rate limit, anchor logic and `MODEL_VERSION` untouched.

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean (the response change is additive; `satisfies BodyBatteryResponse` enforces the new fields).

- [ ] **Step 4: Commit**

```bash
git add app/api/body-battery/route.ts
git commit -m "Persist daytime stress to oura_daily_derived and expose the intraday series"
```

---

### Task 3: Deload override — derived stress replaces the frozen `daySummary` proxy

**Files:**
- Modify: `lib/ai-periodization/ai-dynamic.ts`
- Test: `lib/__tests__/ai-dynamic.test.ts`

- [ ] **Step 1: Write the failing tests** (append inside the existing `describe('computeAiDynamicNextSession')`; also add `stressHighMinutes: null,` to `baseInput` at line ~45 so the type stays satisfied)

```typescript
  it('flags recommended deload when derived stress-high minutes cross the threshold', () => {
    const history = makeHistory(['Push'], [1])
    const result = computeAiDynamicNextSession({ ...baseInput, history, stressHighMinutes: 150 })
    expect(result.deloadOrRestRecommended).toBe(true)
    expect(result.deloadStrength).toBe('recommended')
  })

  it('derived stress below threshold suppresses the frozen very_stressful fallback', () => {
    // A present derived row means the ring measured TODAY — the frozen pre-re-key
    // Cloud string must not override it.
    const history = makeHistory(['Push'], [1])
    const result = computeAiDynamicNextSession({
      ...baseInput, history, stressHighMinutes: 30, daySummary: 'very_stressful',
    })
    expect(result.deloadOrRestRecommended).toBe(false)
  })

  it('falls back to very_stressful only when no derived stress exists', () => {
    const history = makeHistory(['Push'], [1])
    const result = computeAiDynamicNextSession({
      ...baseInput, history, stressHighMinutes: null, daySummary: 'very_stressful',
    })
    expect(result.deloadOrRestRecommended).toBe(true)
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/__tests__/ai-dynamic.test.ts`
Expected: FAIL — `stressHighMinutes` is not in `AiDynamicInput` (TS error) / assertions fail.

- [ ] **Step 3: Implement** in `lib/ai-periodization/ai-dynamic.ts`:

```typescript
// top of file:
import { STRESS_HIGH_DAY_THRESHOLD_MIN } from '@/lib/health/daytime-stress'

// AiDynamicInput (line ~24) — add below daySummary:
  daySummary: string | null
  /** today's derived stress-high minutes (oura_daily_derived) — null when not computed yet */
  stressHighMinutes: number | null
```

```typescript
// computeDeloadStrength (line ~149) — full replacement, new param + derived-first override
// (only the signature and the stressOverride line change; the rest is today's logic):
function computeDeloadStrength(
  consecutiveTrainingDays: number,
  readinessScore: number | null,
  temperatureDeviation: number | null,
  daySummary: string | null,
  stressHighMinutes: number | null,
): { recommended: boolean; strength: 'soft' | 'recommended' | 'strong'; temperatureAlert: boolean } {
  const tempAlert = temperatureDeviation != null && temperatureDeviation > 0.5
  // Derived-first: a non-null derived value means the ring measured today, and it decides.
  // Only with no derived stress at all does the frozen Cloud day_summary still count.
  const stressOverride = stressHighMinutes != null
    ? stressHighMinutes >= STRESS_HIGH_DAY_THRESHOLD_MIN
    : daySummary === 'very_stressful'

  if (tempAlert || stressOverride) {
    return { recommended: true, strength: 'recommended', temperatureAlert: tempAlert }
  }

  if (consecutiveTrainingDays < 3) {   // was < 4
    return { recommended: false, strength: 'soft', temperatureAlert: false }
  }

  const r = readinessScore ?? 70
  if (r >= 70) return { recommended: true, strength: 'soft', temperatureAlert: false }
  if (r >= 50) return { recommended: true, strength: 'recommended', temperatureAlert: false }
  return { recommended: true, strength: 'strong', temperatureAlert: false }
}
```

Update the destructuring in `computeAiDynamicNextSession` (line ~177: add `stressHighMinutes` after `daySummary`) and its `computeDeloadStrength` call (line ~225: append `stressHighMinutes` as the new last argument).

- [ ] **Step 4: Run to verify it passes** (all pre-existing ai-dynamic tests too)

Run: `npx vitest run lib/__tests__/ai-dynamic.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the caller.** In `lib/data/postgres/adapter.ts`, ai_dynamic branch (line ~1514), add the derived read to the `Promise.all`:

```typescript
      const [muscleAssignmentsMap, ouraRows, moodLog, recentWorkouts, exerciseLibrary, sleepSessions, bodyMetrics, derivedRows] = await Promise.all([
        this.getExerciseMuscleAssignments(
          sessions.flatMap(s => s.exercises.map(e => e.exerciseName)),
        ),
        this.getOuraDaily(userId, todayIso, todayIso),
        this.getMoodLog(userId, todayIso),
        this.getWorkoutSessionsFrom(userId, from7d),
        this.listExerciseLibrary(),
        this.listSleepSessions(userId, from14dStr, todayIso),
        this.listBodyMetrics(userId, from14dStr, todayIso),
        this.getOuraDailyDerived(userId, todayIso, todayIso),
      ])
```

and pass it in the `computeAiDynamicNextSession` call (line ~1570):

```typescript
        daySummary: ouraToday?.daySummary ?? null,
        stressHighMinutes: derivedRows[0]?.stressHighMinutes ?? null,
```

- [ ] **Step 6: Full unit run + typecheck**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: clean / PASS (no other `AiDynamicInput` constructors exist — the grep is `computeAiDynamicNextSession(` → only `adapter.ts` and the test file).

- [ ] **Step 7: Commit**

```bash
git add lib/ai-periodization/ai-dynamic.ts lib/__tests__/ai-dynamic.test.ts lib/data/postgres/adapter.ts
git commit -m "Deload override reads live derived stress instead of the frozen Cloud day_summary"
```

---

### Task 4: Readiness route — derived-first stress display

**Files:**
- Modify: `app/api/readiness-score/route.ts`

- [ ] **Step 1: Fetch the derived row.** Extend the `Promise.all` (line ~121):

```typescript
  const [bodyMetrics, sleepSessions, recentSessions, ouraRows, program, todayHrRows, dailySummaries, derivedTodayRows] = await Promise.all([
    repo.listBodyMetrics(userId, from28dIso, todayIso),
    repo.listSleepSessions(userId, from28dIso, todayIso),
    repo.getWorkoutSessionsFrom(userId, from28dDate),
    repo.getOuraDaily(userId, from28dIso, todayIso),
    repo.getActiveProgram(userId),
    repo.getHrForWindow(userId, todayMid, new Date(todayMid.getTime() + 86_400_000)),
    repo.getOuraDailySummary(userId, from28dIso, todayIso),
    repo.getOuraDailyDerived(userId, todayIso, todayIso),
  ])

  const derivedToday = derivedTodayRows[0] ?? null
```

- [ ] **Step 2: Coalesce the passthroughs** (lines 377-378). Derived stores **minutes**; the response contract is **seconds** (`activity-content.tsx:34` divides by 60 — do not change the field name, type, or units):

```typescript
    // Derived-when-available (fresh, written by the body-battery read today), frozen Cloud
    // seconds as fallback. Derived is minutes → convert; response stays seconds.
    stressHigh:              derivedToday?.stressHighMinutes   != null ? derivedToday.stressHighMinutes   * 60 : ouraToday?.stressHigh   ?? null,
    recoveryHigh:            derivedToday?.recoveryHighMinutes != null ? derivedToday.recoveryHighMinutes * 60 : ouraToday?.recoveryHigh ?? null,
```

No new weighted contributor, no composite change — see Scope decision 4.

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

```bash
git add app/api/readiness-score/route.ts
git commit -m "Readiness stress/recovery tiles read today's derived values over frozen Cloud"
```

---

### Task 5: Chat — `getRecoveryData` exposes daytime stress

**Files:**
- Modify: `lib/ai-chat/tools.ts` (lines 46-74)

- [ ] **Step 1: Implement.** Add the derived fetch and a `daytimeStress` array; update the description so the model knows to use it:

```typescript
    getRecoveryData: tool({
      description: 'Oura daily scores (readiness/sleep/activity, temp deviation, resilience), sleep sessions (duration, efficiency, overnight HRV, lowest HR), body metrics (HRV, resting HR, steps, weight) and daytime stress (dHRV level −1..+1, negative = stressed; minutes in high stress per day) for a date range. Use for recovery, sleep, HRV, readiness and stress questions.',
      inputSchema: z.object({
        fromDate: z.string().describe('YYYY-MM-DD inclusive'),
        toDate: z.string().describe('YYYY-MM-DD inclusive'),
      }),
      execute: async ({ fromDate, toDate }) => {
        const [oura, sleep, metrics, derived] = await Promise.all([
          repo.getOuraDaily(userId, fromDate, toDate),
          repo.listSleepSessions(userId, fromDate, toDate),
          repo.listBodyMetrics(userId, fromDate, toDate),
          repo.getOuraDailyDerived(userId, fromDate, toDate),
        ])
        return {
          ouraDaily: oura.map(r => ({
            date: r.date, readiness: r.readinessScore ?? null, sleepScore: r.sleepScore ?? null,
            activityScore: r.activityScore ?? null, tempDeviationC: r.temperatureDeviation ?? null,
            resilience: r.resilienceLevel ?? null,
          })),
          sleepSessions: sleep.map(s => ({
            date: s.date, durationHours: s.durationHours ?? null, efficiencyPct: s.efficiency ?? null,
            overnightHrvMs: s.averageHrvMs ?? null, lowestHrBpm: s.lowestHeartRate ?? null,
          })),
          bodyMetrics: metrics.map(m => ({
            date: m.date, hrvMs: m.hrvMs ?? null, restingHrBpm: m.restingHeartRate ?? null,
            steps: m.steps ?? null, weightKg: m.weightKg ?? null,
          })),
          daytimeStress: derived
            .filter(d => d.daytimeStressScaled != null || d.stressHighMinutes != null)
            .map(d => ({
              date: d.day,
              level: d.daytimeStressScaled ?? null,
              highMinutes: d.stressHighMinutes ?? null,
            })),
        }
      },
    }),
```

(The `ouraDaily`/`sleepSessions`/`bodyMetrics` maps are today's bodies unchanged — only the `Promise.all`, the `daytimeStress` key and the description change.)

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

```bash
git add lib/ai-chat/tools.ts
git commit -m "Expose daytime stress to the AI chat recovery tool"
```

---

### Task 6: Weekly digest — one stress line

**Files:**
- Modify: `app/api/weekly-digest/route.ts`

- [ ] **Step 1: Implement.** Extend the `Promise.all` (line ~51):

```typescript
  const [sessions, bodyMetrics, sleepSessions, ouraRows, weekPrs, derivedRows] = await Promise.all([
    repo.getWorkoutSessionsFrom(userId, priorWeekStart),
    repo.listBodyMetrics(userId, from14dIso, recapWeekEndIso),
    repo.listSleepSessions(userId, from14dIso, recapWeekEndIso),
    repo.getOuraDaily(userId, from14dIso, recapWeekEndIso),
    repo.listRecentPersonalRecords(userId, recapWeekStart, recapWeekEnd),
    repo.getOuraDailyDerived(userId, from14dIso, recapWeekEndIso),
  ])
```

After the `readinessLine` block (line ~125), mirror its window pattern:

```typescript
  // Daytime stress (derived, dHRV): avg minutes of high stress per measured day
  const stressOf = (from: string, to: string) => {
    const vals = derivedRows.filter(r => r.day >= from && r.day <= to && r.stressHighMinutes != null).map(r => r.stressHighMinutes!)
    return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
  }
  const stressRecapWeek = stressOf(isoWeekKey, recapWeekEndIso)
  const stressPriorWeek = stressOf(from14dIso, priorWeekEndIso)
  const stressLine = stressRecapWeek != null
    ? `Daytime stress: high for ~${stressRecapWeek} min/day avg that week${stressPriorWeek != null ? ` (week before ~${stressPriorWeek} min/day)` : ''}`
    : null
```

and add `stressLine,` to the `context` array (line ~137) right after `readinessLine,`. The prompt already instructs "quote its numbers, never invent" — no prompt change needed.

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

```bash
git add app/api/weekly-digest/route.ts
git commit -m "Weekly digest recaps daytime stress alongside HRV and readiness"
```

---

### Task 7: StressStrip component + card wiring

**Files:**
- Create: `components/body-battery/stress-strip.tsx`
- Modify: `components/body-battery-card.tsx` (lines 151-162 — the #571 inline block moves into the new component)

- [ ] **Step 1: Create the component.** Pure-SVG `Sparkline` (never the chart.js `sparkline-chart.tsx` — home-screen bundle), theme tokens only, and every state paired with text (never colour-alone):

```tsx
// components/body-battery/stress-strip.tsx
'use client'

import { ActivityIcon } from 'lucide-react'
import { Sparkline } from '@/components/ui/sparkline'
import { fmtAest } from '@/lib/date-utils'
import type { BodyBatteryResponse } from '@/app/api/body-battery/route'

function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// Intraday daytime-stress readout inside the expanded Body Battery card: the dHRV stress
// level per 30-min bucket ([−1,+1], dips = stressed) as a sparkline, plus "stress high for
// Xh today" and the stress-drain summary as text. `series`/`highMinutes` are optional-chained:
// a cachedFetchToday seed written before this deploy won't carry them.
export function StressStrip({ stress }: { stress: NonNullable<BodyBatteryResponse['stress']> }) {
  const series = stress.series ?? []
  const highMinutes = stress.highMinutes ?? null
  return (
    <div className="space-y-1.5">
      {series.length >= 2 && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground leading-none">
              Daytime stress
            </span>
            <span className="text-[9px] text-muted-foreground leading-none">dips = stressed</span>
          </div>
          <Sparkline values={series.map(p => p.level)} height={28} responsive fill color="var(--accent-amber)" />
          <div className="flex justify-between text-[9px] text-muted-foreground">
            <span>{fmtAest(series[0].t)}</span>
            <span>{fmtAest(series[series.length - 1].t)}</span>
          </div>
        </>
      )}
      {highMinutes != null && highMinutes > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Stress high for{' '}
          <span className="font-semibold tabular-nums text-foreground">{fmtMinutes(highMinutes)}</span> today
        </p>
      )}
      {stress.extraDrained > 0 && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <ActivityIcon className="h-3 w-3 flex-none" style={{ color: 'var(--accent-amber)' }} />
          <span>
            Daytime stress drained{' '}
            <span className="font-semibold tabular-nums" style={{ color: 'var(--accent-amber)' }}>
              −{stress.extraDrained}
            </span>
            {stress.draining && ' · elevated right now'}
          </span>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire the card.** In `components/body-battery-card.tsx`: add `import { StressStrip } from '@/components/body-battery/stress-strip'`, remove the now-unused `ActivityIcon` from the lucide import (it moved into the strip), and replace the whole inline stress block (lines 151-162, `{battery.stress && battery.stress.extraDrained > 0 && ( … )}`) with:

```tsx
                  {battery.stress && <StressStrip stress={battery.stress} />}
```

Note the condition intentionally widens: the strip now renders whenever a stress series exists, not only once drain has accrued — the series/high-time is informative before the first drained point.

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: clean (lint would flag the unused `ActivityIcon` import if missed).

- [ ] **Step 4: Commit**

```bash
git add components/body-battery/stress-strip.tsx components/body-battery-card.tsx
git commit -m "Show the intraday stress strip and stress-high time on the Body Battery card"
```

---

### Task 8: Docs reconciliation — P-E annotation + Batch S tick

**Files:**
- Modify: `docs/implementation-backlog.md` (P-E entry, lines ~256-257)
- Modify: `docs/planned_upgrades.md` (Batch S, S5 bullet, line ~139)

- [ ] **Step 1: Annotate P-E.** In the P-E entry, extend the closing `**P2/P3:**` sentence to:

```markdown
  **P2/P3:** ✅ *daytime* stress persist + wiring landed via
  [`2026-07-16-daytime-stress-wiring.md`](superpowers/plans/2026-07-16-daytime-stress-wiring.md)
  (body-battery route persists `daytime_stress_scaled`/`stress_high_minutes`/`recovery_high_minutes`;
  deload override, readiness display, chat tool, digest, card strip all read it) — P-E keeps
  **baseline reconcile, cumulative/chronic stress + resilience** (`chronic_stress_score`,
  `resilience_level` still unwritten).
```

- [ ] **Step 2: Tick S5.** In `docs/planned_upgrades.md` Batch S, mark the S5 bullet:

```markdown
- **S5 (High/M):** ✅ done 2026-07-16 — daytime stress persisted + wired (deload override,
  readiness display, chat, digest, intraday card strip) via
  `docs/superpowers/plans/2026-07-16-daytime-stress-wiring.md`; chronic/resilience stay P-E P3.
```

Also remove this plan's own entry from the `docs/implementation-backlog.md` queue (per the protocol at the top of that file — a finished item never lingers).

> Re-verify both files' current text at implementation time — other Batch S items may have landed since this plan was written; edit surgically, don't restore stale surrounding text.

- [ ] **Step 3: Commit**

```bash
git add docs/implementation-backlog.md docs/planned_upgrades.md
git commit -m "Reconcile backlog: daytime-stress wiring done, chronic stress stays P-E P3"
```

---

### Task 9: Full gate, dev-server smoke against local Postgres, version + journal

**Files:**
- Modify: `package.json` (version), `lib/changelog.ts`, `projectOverview.md`, `docs/overview/history-newest.md`
- Scratch (not committed): seed SQL in the session scratchpad

- [ ] **Step 1: Full gate**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`
Expected: all clean/PASS. (`pnpm test` includes the DB-gated `oura-daily-derived.test.ts` suite when the local Postgres is up — run `pnpm db:local` first if needed.)

- [ ] **Step 2: Seed daytime signal into the local dev DB.** Write this to `<scratchpad>/seed-daytime-stress.sql` and apply with `psql postgresql://postgres:postgres@localhost:5433/trainingai_dev -f <scratchpad>/seed-daytime-stress.sql`. It fabricates ~4 h of ring daytime data ending now: a clock anchor, temp (`tag 70` = 0x46, `decoded.temps_c`) every 5 min, MET (`tag 80` = 0x50, `decoded.met`) every minute, and HR every 2 min — calm (≈60 bpm) for the first 2 h, elevated (≈90 bpm) for the last 2 h so the later buckets impute a lower dHRV and score stressed. `getOuraDaytimeSignals` reads `decoded` first, so `body_hex` can be a dummy (`'00'`; the dedup key stays unique via distinct `ring_timestamp_ds`). 1 ds = 100 ms → 1 min = 600 ds.

```sql
-- Synthetic daytime ring signal for test@local.dev (dev DB only — port 5433)
WITH u AS (SELECT id FROM users WHERE email = 'test@local.dev')
INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc)
SELECT id, 10000000, now() FROM u;

WITH u AS (SELECT id FROM users WHERE email = 'test@local.dev')
INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded)
SELECT u.id, 10000000 - m * 600, 70, 'temperature', '00',
       jsonb_build_object('temps_c', jsonb_build_array(33.5 + (m % 3) * 0.05))
FROM u, generate_series(0, 240, 5) AS m
ON CONFLICT DO NOTHING;

WITH u AS (SELECT id FROM users WHERE email = 'test@local.dev')
INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded)
SELECT u.id, 10000000 - m * 600, 80, 'met', '00',
       jsonb_build_object('met', jsonb_build_array(1.0 + (m % 4) * 0.1))
FROM u, generate_series(0, 240, 1) AS m
ON CONFLICT DO NOTHING;

WITH u AS (SELECT id FROM users WHERE email = 'test@local.dev')
INSERT INTO oura_heartrate (user_id, "timestamp", bpm, source)
SELECT u.id, now() - (m || ' minutes')::interval,
       CASE WHEN m > 120 THEN 58 + (m % 5) ELSE 86 + (m % 8) END,  -- older = calm, recent 2 h = elevated
       'awake'
FROM u, generate_series(0, 240, 2) AS m
ON CONFLICT DO NOTHING;

-- dHRV baseline needs recent overnight HRV in body_metrics
WITH u AS (SELECT id FROM users WHERE email = 'test@local.dev')
UPDATE body_metrics SET hrv_ms = 45
WHERE user_id = (SELECT id FROM u) AND hrv_ms IS NULL
  AND date >= to_char(now() - interval '28 days', 'YYYY-MM-DD');
```

- [ ] **Step 3: Dev-server smoke** (`pnpm dev`, log in as `test@local.dev` / `testpass123`; DevTools at ≤640px / S25 viewport). Exact checks:

1. **Battery route + persist:** open the home screen (session-select) — the Body Battery card populates. In the Network tab, `/api/body-battery` response has `stress.series` with ≥2 points (levels in [−1,+1], recent points negative), `stress.highMinutes ≥ 30`, `stress.current < 0`. Then:
   `psql postgresql://postgres:postgres@localhost:5433/trainingai_dev -c "SELECT day, daytime_stress_scaled, stress_high_minutes, recovery_high_minutes FROM oura_daily_derived ORDER BY day DESC LIMIT 3;"`
   → today's row shows a non-null scaled level and `stress_high_minutes > 0`. Hit the route twice — the row updates in place, no duplicate (COALESCE upsert).
2. **Card strip:** expand the card — the amber "Daytime stress" sparkline renders under the battery curve with time labels + "dips = stressed", the "Stress high for Xh Ym today" line matches `highMinutes`, and the drain line still appears once `extraDrained > 0`. Check both dark and light themes (the strip is token-coloured — `var(--accent-amber)` resolves in both).
3. **Readiness route:** `GET /api/readiness-score` (Health tab) → `stressHigh` equals `stress_high_minutes × 60` (seconds), and `/health/activity`'s "Stress" tile shows the matching minutes.
4. **Next-session override:** with the seeded row, bump it past the threshold — `psql … -c "UPDATE oura_daily_derived SET stress_high_minutes = 150 WHERE day = to_char(now() AT TIME ZONE 'Australia/Brisbane','YYYY-MM-DD');"` — then (with the test program in `ai_dynamic` phase mode) reload the home screen: the recommendation flags a deload. Reset to `30` → no stress-driven deload even though `daySummary` seeding may say otherwise. (If the seeded program isn't ai_dynamic, verify via the unit tests + a temporary phase-mode flip in the Config screen, then flip back.)
5. **Chat + digest:** if `GOOGLE_GENERATIVE_AI_API_KEY` is set locally, ask the chat "how stressed was I today?" → the tool call returns `daytimeStress` with today's row; trigger the weekly digest and confirm the stress line quotes the seeded minutes. If no key: state in the PR that these two paths were verified by types/shape only.

If anything breaks, fix before proceeding — do not merge on a broken smoke.

- [ ] **Step 4: Version + changelog + journal.** Bump `package.json` to the next **minor** (1.155.0 as of writing — re-check against the fresh base and re-bump if parallel PRs landed). Add to `lib/changelog.ts`:

```typescript
  {
    version: "1.155.0",
    date: "2026-07-16",
    changes: [
      "Your daytime stress now works for you everywhere, not just Body Battery drain: the expanded Body Battery card shows an intraday stress strip with how long stress ran high today, the readiness screen's stress/recovery tiles use today's live ring measurement instead of frozen pre-July data, a high-stress day can now trigger a deload recommendation on its own, and the AI chat and weekly digest can see and discuss your stress.",
    ],
  },
```

Append the session journal entry to `docs/overview/history-newest.md` and update `projectOverview.md` (tick the roadmap/backlog reference, keep/extend the existing daytime-capture device-verification caveat as a Known-Issues note: "stress wiring verified against seeded data; real-world daytime ring capture still unconfirmed on device").

- [ ] **Step 5: Commit, push, PR**

```bash
git add package.json lib/changelog.ts projectOverview.md docs/overview/history-newest.md
git commit -m "Bump to 1.155.0 with daytime-stress wiring journal"
git push -u origin feat/daytime-stress-wiring
```

Open the PR, subscribe to CI, merge per the standard workflow once green (standard change — no destructive carve-out applies: no migration, no auth/secret surface). State in the PR body which failure surfaces were not exercised (real ring daytime capture, Samsung WebView render, AI-key paths if skipped).

---

## Self-review checklist (run before handing off)

- Spec coverage: persist (T1/T2) ✓, frozen-proxy replacement (T3) ✓, readiness display not contributor (T4) ✓, chat + digest (T5/T6) ✓, intraday display + high-time text (T7) ✓, P-E reconcile (T8) ✓, gate/smoke/version (T9) ✓. Chronic/resilience explicitly out (Scope 2).
- No new cache keys, no endpoint, no migration, no repo-interface change; response changes additive and optional-chained on the client.
- Type consistency: `StressDaySummary` fields = `OuraDailyDerivedPatch` keys (`daytimeStressScaled`/`stressHighMinutes`/`recoveryHighMinutes` — all present in `DERIVED_COLS`); `stress.series[].level` naming used in both route and strip; `STRESS_HIGH_DAY_THRESHOLD_MIN` imported, never re-declared.
- Units: derived minutes ↔ response seconds conversion appears exactly once (readiness route), documented at both ends.
