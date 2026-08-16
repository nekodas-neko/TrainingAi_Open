# AI Signal Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every AI decision layer sees the recovery signals the app already computes: skin-temperature deviation (live BLE baseline-z, not the frozen Cloud column) reaches the periodization prescription prompt and its rest-day rule; sleep *quality* (our `computeSleepScore`) joins the duration-only sleep trend in periodization and the weekly digest; SpO₂ becomes visible to the AI chat's recovery tool.

**Architecture:** One new pure module `lib/health/sleep-trend.ts` (One Formula, One Place) owns the recent-3-vs-baseline ratio for both the duration trend (deduping the copy in `adapter.ts:getNextSession`) and the new score-based trend. `PrescriptionSignals` gains `sleepScoreTrend` and `tempZ`; `tempZ` comes from `oura_daily_summary` via the same `illnessZScores` helper the readiness route and nightly rollup already share, so the prescription layer can never disagree with the readiness/illness surfaces. Prompt changes are additive lines plus one edited rest-day rule. Chat tool and weekly digest changes are payload/context additions — no schema, no migration, no new route.

**Tech Stack:** TypeScript, `lib/ai-periodization/*`, `lib/health/*` (`computeSleepScore`, `illnessZScores`, `FEVER_TEMP_Z`), Drizzle repository (`getOuraDailySummary`, `listSleepSessions` — both already exist), vitest.

---

## Why now

Source: **`docs/reviews/2026-07-16-data-efficiency-review.md` finding S7 (§2.4, "AI periodization inconsistencies", Medium/S)** — temperature deviation gates the next-session deload and appears in chat context + health-insight but is absent from the layer that actually prescribes load; the periodization/digest sleep signal is duration-only while the richer `computeSleepScore` runs daily elsewhere; SpO₂ feeds periodization but is invisible to chat. Queued as part of Batch S (`docs/planned_upgrades.md`).

**Branch:** `fix/ai-signal-consistency`

Deliberately **out of scope** (tracked by their own review findings, don't creep into them here): the illness radar → decision layers wiring (§2.1, separate plan), daytime stress (§2.2, P-E), and `ai-dynamic.ts`'s own frozen-Cloud `temperatureDeviation`/`daySummary` inputs (§3.3/§2.2 — the next-session engine keeps its current inputs; this plan only dedupes its duplicated sleep-trend *formula*). The mood-vs-readiness-composite question (§2.4 last bullet) is a decide-and-document item, not code.

## Verification-against-main notes (checked 2026-07-16, post Polar-H10/#570/#571/#575)

- `PrescriptionSignals` is `lib/ai-periodization/signals.ts:17-82` ✓; duration-only `sleepTrend` at `signals.ts:340-354` ✓; prompt rest-day rule at `lib/ai-periodization/prompt.ts:148-151` ✓; `getRecoveryData` at `lib/ai-chat/tools.ts:46-74` ✓; digest sleep/HRV context at `app/api/weekly-digest/route.ts:99-114` ✓.
- **Discrepancy vs the task brief:** `lib/ai-periodization/__tests__/signals*.test.ts` does not exist — the only test there is `secondary-zone.test.ts`. The full `PrescriptionSignals` fixture lives in **`lib/__tests__/prompt-deload-awareness.test.ts:6-29`** (the file that breaks when the interface grows) and `AiDynamicInput` fixtures in `lib/__tests__/ai-dynamic.test.ts` (unaffected — `AiDynamicInput` is unchanged).
- The duplicate duration-only sleep-trend is `lib/data/postgres/adapter.ts:1533-1544` inside `getNextSession`'s ai_dynamic branch; it feeds `computeAiDynamicNextSession` (`lowSleep < 0.85` weighting) and the `signals` explain payload. Same formula, so it dedupes into the shared helper with **zero behaviour change**.
- `listSleepSessions` returns full `SleepSession` rows (`lib/types/body.ts:60-84`) — `durationHours`, `efficiency`, `deepSleepHours`, `remSleepHours`, `onsetLatencySec`, `restlessPeriods`, `awakHours`, `sleepStart/End` — everything `computeSleepScore(session, tz)` consumes, at **both** call sites (signals.ts and weekly-digest). No repo change needed.
- `illnessZScores(prior, current)` (`lib/health/illness-radar.ts:148-156`) is structurally satisfied by `OuraDailySummaryRow` (its doc comment says so; the readiness route passes those rows at `app/api/readiness-score/route.ts:255-257`). `FEVER_TEMP_Z = 2.5` is the exported fever threshold — reuse it, never a new magic number.
- Bonus discrepancy found while verifying the digest: the existing `avgSleep` line (`route.ts:99-101`) averages over the **full 14-day fetch window** (prior week included) while labelled as this week's average — fixed in the same PR (bug fix for a feature on `main`; no-orphaned-findings).
- The workout-review sibling prompt (`lib/workout/review/prompt.ts`) renders only soreness/injuries/volume from `PrescriptionSignals` — no trend lines, so no sibling change there. `emergency-deload.ts` `Pick`s only unaffected fields.

## Runtime reality / verification note

- Everything here is server/JS — **no native plugin, offline-first write path, safe-area, gesture, or notification surface**, so the on-device gate is not triggered; `pnpm dev` + unit tests are the full verification surface. Failure surfaces NOT exercised: real BLE-fed `oura_daily_summary` rows with mature baselines (the local seed has none, so `tempZ` rides the null path locally — the non-null path is covered by unit tests + `illness-radar.test.ts`), and live Gemini output quality (prompt changes are asserted structurally, not on model behaviour).
- All LLM calls stay as-is: prescribe uses `generateObject` (untouched), digest stays prose `generateText` (context-only change). All new time windows derive from the already-computed `todayMidnightUtc(tz)` — no `Date.now() − N×86400000`.

## File structure

**Create:**
- `lib/health/sleep-trend.ts` — shared recent-3-vs-baseline trend (duration + score variants).
- `lib/health/__tests__/sleep-trend.test.ts`
- `lib/__tests__/prompt-recovery-signals.test.ts` — tempZ/sleep-quality prompt rendering + rest-day rule.
- `lib/ai-chat/__tests__/tools-recovery.test.ts` — chat tool payload includes SpO₂.

**Modify:**
- `lib/ai-periodization/signals.ts` — `sleepScoreTrend` + `tempZ` fields, summaries fetch, use shared trend helpers.
- `lib/ai-periodization/prompt.ts` — render both new signals; rest-day rule folds in `temp_z` and prefers the score trend.
- `lib/data/postgres/adapter.ts` — `getNextSession` sleep-trend dedupe (`~1533`).
- `lib/ai-chat/tools.ts` — `getRecoveryData` emits `spo2Pct`.
- `app/api/weekly-digest/route.ts` — avg nightly sleep-score line; recap-week scoping fix for `avgSleep`.
- `lib/__tests__/prompt-deload-awareness.test.ts` — fixture gains the two new fields.
- Final task: `package.json` (patch), `lib/changelog.ts`, `docs/module-map.md` row, journal + `projectOverview.md`, remove the backlog entry.

---

### Task 1: Shared sleep-trend module (One Formula, One Place)

**Files:**
- Create: `lib/health/sleep-trend.ts`
- Test: `lib/health/__tests__/sleep-trend.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/health/__tests__/sleep-trend.test.ts
import { describe, it, expect } from 'vitest'
import { sleepDurationTrend, sleepScoreTrend } from '@/lib/health/sleep-trend'
import type { SleepSession } from '@/lib/types/body'

// daysAgo 0 = last night. sleepEnd 21:00 UTC = 07:00 AEST wake (timing contributor ~ideal).
const night = (daysAgo: number, over: Partial<SleepSession> = {}): SleepSession => {
  const end = new Date(Date.UTC(2026, 6, 16 - daysAgo, 21, 0, 0))
  return {
    id: `s${daysAgo}`, userId: 'u1',
    date: `2026-07-${String(16 - daysAgo).padStart(2, '0')}`,
    sleepStart: new Date(end.getTime() - 8 * 3_600_000), sleepEnd: end,
    durationHours: 8, createdAt: end,
    ...over,
  }
}

describe('sleepDurationTrend', () => {
  it('is recent-3 avg hours over older-window avg hours', () => {
    const sessions = [
      ...[0, 1, 2].map(d => night(d, { durationHours: 6 })),
      ...[3, 4, 5, 6, 7, 8, 9].map(d => night(d, { durationHours: 8 })),
    ]
    expect(sleepDurationTrend(sessions)).toBeCloseTo(0.75, 5)
  })

  it('returns null with fewer than 4 sessions', () => {
    expect(sleepDurationTrend([0, 1, 2].map(d => night(d)))).toBeNull()
  })

  it('sorts by sleepEnd itself (input order must not matter)', () => {
    const sessions = [
      ...[3, 4, 5].map(d => night(d, { durationHours: 8 })),
      ...[0, 1, 2].map(d => night(d, { durationHours: 4 })),
    ]
    expect(sleepDurationTrend(sessions)).toBeCloseTo(0.5, 5)
  })

  it('counts a missing durationHours as 0 (legacy parity with signals.ts)', () => {
    const sessions = [
      night(0, { durationHours: undefined }),
      night(1, { durationHours: 8 }), night(2, { durationHours: 8 }),
      night(3, { durationHours: 8 }), night(4, { durationHours: 8 }),
    ]
    // recent3 avg = (0+8+8)/3, older avg = 8
    expect(sleepDurationTrend(sessions)).toBeCloseTo((16 / 3) / 8, 5)
  })
})

describe('sleepScoreTrend', () => {
  it('is ~1.0 across identical nights', () => {
    const sessions = [0, 1, 2, 3, 4, 5].map(d => night(d, { efficiency: 92 }))
    expect(sleepScoreTrend(sessions, 'Australia/Brisbane')).toBeCloseTo(1, 5)
  })

  it('drops below 1 when recent nights are worse than baseline', () => {
    const sessions = [
      ...[0, 1, 2].map(d => night(d, {
        durationHours: 4.5, efficiency: 70,
        sleepStart: new Date(Date.UTC(2026, 6, 16 - d, 16, 30, 0)),
      })),
      ...[3, 4, 5, 6, 7, 8, 9].map(d => night(d, { efficiency: 93 })),
    ]
    const trend = sleepScoreTrend(sessions, 'Australia/Brisbane')!
    expect(trend).toBeLessThan(0.85)
  })

  it('skips unscorable nights (no duration) instead of zeroing them', () => {
    const sessions = [
      night(0, { durationHours: undefined }), // computeSleepScore → null, skipped
      night(1), night(2), night(3), night(4),
    ]
    expect(sleepScoreTrend(sessions, 'Australia/Brisbane')).toBeCloseTo(1, 5)
  })

  it('returns null with fewer than 4 scorable nights', () => {
    expect(sleepScoreTrend([0, 1, 2].map(d => night(d)), 'Australia/Brisbane')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/health/__tests__/sleep-trend.test.ts`
Expected: FAIL — `Cannot find module '@/lib/health/sleep-trend'`

- [ ] **Step 3: Implement**

```typescript
// lib/health/sleep-trend.ts
// Recent-3-vs-older-baseline sleep trends. THE only implementation of this ratio —
// lib/ai-periodization/signals.ts and adapter.ts:getNextSession previously carried
// duplicate inline copies of the duration variant (One Formula, One Place).
import type { SleepSession } from '@/lib/types/body'
import { computeSleepScore } from '@/lib/health/sleep-score'
import { DEFAULT_TZ } from '@/lib/date-utils'

// Ratio of the newest-3 values to the mean of the next-up-to-7 older values.
// null when there aren't ≥4 values or the baseline is 0 — callers treat null
// as "no data, omit from reasoning".
function ratioTrend(newestFirstValues: number[]): number | null {
  if (newestFirstValues.length < 4) return null
  const recent3 = newestFirstValues.slice(0, 3)
  const older = newestFirstValues.slice(3, 10)
  const recentAvg = recent3.reduce((s, v) => s + v, 0) / recent3.length
  const olderAvg = older.reduce((s, v) => s + v, 0) / older.length
  return olderAvg > 0 ? recentAvg / olderAvg : null
}

function newestFirst(sessions: SleepSession[]): SleepSession[] {
  return [...sessions].sort((a, b) => b.sleepEnd.getTime() - a.sleepEnd.getTime())
}

/** Duration-only trend (hours). Missing durations count as 0 — parity with the
 *  historical inline computation this module replaced. */
export function sleepDurationTrend(sessions: SleepSession[]): number | null {
  return ratioTrend(newestFirst(sessions).map(s => s.durationHours ?? 0))
}

/** Quality trend over our own 0–100 sleep score (efficiency/stages/latency/
 *  restfulness/timing). Unscorable nights are skipped before windowing, so one
 *  bad row never reads as a 0-quality night. */
export function sleepScoreTrend(sessions: SleepSession[], tz: string = DEFAULT_TZ): number | null {
  const scores = newestFirst(sessions)
    .map(s => computeSleepScore(s, tz)?.score)
    .filter((v): v is number => v != null)
  return ratioTrend(scores)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/health/__tests__/sleep-trend.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/health/sleep-trend.ts lib/health/__tests__/sleep-trend.test.ts
git commit -m "Add shared sleep duration/quality trend helpers"
```

---

### Task 2: Wire the shared trends into periodization signals + dedupe the adapter copy

**Files:**
- Modify: `lib/ai-periodization/signals.ts`
- Modify: `lib/data/postgres/adapter.ts` (`getNextSession`, ~1533)
- Modify: `lib/__tests__/prompt-deload-awareness.test.ts` (fixture)

- [ ] **Step 1: Add the field to `PrescriptionSignals`**

In `lib/ai-periodization/signals.ts`, replace the line `sleepTrend: number | null` (~72) with:

```typescript
  sleepTrend: number | null
  // Quality trend over the same recent-3-vs-baseline windows, from our own
  // computeSleepScore (efficiency/stages/latency/restfulness) — null until ≥4 scored nights.
  // The rest-day rule prefers this over the duration-only sleepTrend when available.
  sleepScoreTrend: number | null
```

- [ ] **Step 2: Replace the inline duration computation with the shared helpers**

Add to the imports at the top of `signals.ts`:

```typescript
import { sleepDurationTrend, sleepScoreTrend } from '@/lib/health/sleep-trend'
```

Replace the whole `sleepTrend` block (lines ~340-354, from the `// Sleep trend — ratio of recent 3 nights…` comment through the closing brace of `if (sleepSessions.length >= 4) { … }`) with:

```typescript
  // Sleep trends — duration ratio + our-own-sleep-score quality ratio over the same
  // recent-3-vs-baseline windows (lib/health/sleep-trend.ts — One Formula, One Place).
  const from14d = toAestDay(new Date(todayMid.getTime() - 14 * 86_400_000), tz)
  const sleepSessions = await repo.listSleepSessions(userId, from14d, today)
  const sleepTrend = sleepDurationTrend(sleepSessions)
  const sleepScoreTrendVal = sleepScoreTrend(sleepSessions, tz)
```

And in the returned object, directly under `sleepTrend,` add:

```typescript
    sleepScoreTrend: sleepScoreTrendVal,
```

(Confidence scoring is deliberately untouched: `hasSleepOrHrvTrend` keys off `sleepTrend`, and a non-null score trend implies a non-null duration trend — ≥4 scored nights is a superset condition.)

- [ ] **Step 3: Dedupe the adapter's copy (behaviour-preserving)**

In `lib/data/postgres/adapter.ts`, add to the imports:

```typescript
import { sleepDurationTrend } from '@/lib/health/sleep-trend'
```

In `getNextSession`'s ai_dynamic branch, replace the inline block (~1533-1544):

```typescript
      // Sleep trend: ratio of recent 3 nights vs older baseline
      let sleepTrend: number | null = null
      if (sleepSessions.length >= 4) {
        const sorted = [...sleepSessions].sort((a, b) => b.sleepEnd.getTime() - a.sleepEnd.getTime())
        const recent3 = sorted.slice(0, 3)
        const older = sorted.slice(3, 10)
        if (older.length > 0) {
          const recentAvg = recent3.reduce((s, sl) => s + (sl.durationHours ?? 0), 0) / recent3.length
          const olderAvg = older.reduce((s, sl) => s + (sl.durationHours ?? 0), 0) / older.length
          sleepTrend = olderAvg > 0 ? recentAvg / olderAvg : null
        }
      }
```

with:

```typescript
      // Sleep trend: recent-3-vs-baseline duration ratio — shared helper, same formula
      // signals.ts uses (One Formula, One Place). AI-dynamic keeps duration semantics:
      // its 0.85 low-sleep threshold was tuned on hours, not score.
      const sleepTrend = sleepDurationTrend(sleepSessions)
```

(The neighbouring inline `hrvTrend` copy is NOT touched — its `signals.ts` sibling filters the baseline through `excludeLowWearDays`, so they are intentionally different formulas today; unifying them is review-§2.4-adjacent but out of this plan's scope.)

- [ ] **Step 4: Fix the fixture compile break**

In `lib/__tests__/prompt-deload-awareness.test.ts` (line ~26), replace:

```typescript
  acwr: null, sleepTrend: null, hrvTrend: null, spo2Trend: null, externalReadiness: null,
```

with:

```typescript
  acwr: null, sleepTrend: null, sleepScoreTrend: null, hrvTrend: null, spo2Trend: null,
  tempZ: null, externalReadiness: null,
```

(`tempZ` lands in Task 3 — adding both fixture fields now avoids touching this file twice; the intermediate `tsc` state after this task will flag `tempZ` as unknown, which Step 5 tolerates by running tests only. If working strictly task-by-task, add only `sleepScoreTrend: null` here and `tempZ: null` in Task 3.)

- [ ] **Step 5: Verify**

Run: `npx vitest run lib/__tests__ lib/health/__tests__/sleep-trend.test.ts`
Expected: PASS (ai-dynamic tests prove the adapter dedupe changed nothing).

- [ ] **Step 6: Commit**

```bash
git add lib/ai-periodization/signals.ts lib/data/postgres/adapter.ts lib/__tests__/prompt-deload-awareness.test.ts
git commit -m "Add sleep-quality trend to prescription signals; dedupe duration trend"
```

---

### Task 3: `tempZ` into `PrescriptionSignals` from the live BLE baselines

**Files:**
- Modify: `lib/ai-periodization/signals.ts`

The correct live source is `oura_daily_summary` via `illnessZScores` — exactly what `app/api/readiness-score/route.ts:255-257` does. **Never** `oura_daily.temperature_deviation` (frozen Cloud, dead since the 2026-07-07 re-key).

- [ ] **Step 1: Add the interface field**

In `PrescriptionSignals`, after `spo2Trend: number | null`:

```typescript
  spo2Trend: number | null
  // Last night's skin-temperature baseline z-score (oura_daily_summary via the shared
  // illnessZScores — the live BLE source; oura_daily.temperature_deviation is frozen
  // Cloud data and must never feed this). Positive = fever-consistent. null until a
  // temperature baseline exists.
  tempZ: number | null
```

- [ ] **Step 2: Fetch the summaries and compute**

Add to the imports:

```typescript
import { illnessZScores } from '@/lib/health/illness-radar'
```

After `const yesterday = toAestDay(new Date(Date.now() - 24 * 3_600_000), tz)` (~line 108) add:

```typescript
  const from7d = toAestDay(new Date(todayMid.getTime() - 7 * 86_400_000), tz)
```

Extend the second `Promise.all` (~line 110): append `dailySummaries` to the destructuring list and add as the final fetch:

```typescript
    repo.getOuraDailySummary(userId, from7d, today),
```

Before the `return {` at the bottom of `aggregateSignals`, add:

```typescript
  // Skin-temp z vs the PRIOR night's baseline — the identical pre-update relationship
  // the readiness route and nightly rollup use, so prescription/readiness/illness can
  // never disagree about last night's temperature.
  const latestSummary = dailySummaries.length > 0 ? dailySummaries[dailySummaries.length - 1] : null
  const priorSummary = dailySummaries.length > 1 ? dailySummaries[dailySummaries.length - 2] : null
  const tempZ = latestSummary ? illnessZScores(priorSummary, latestSummary).tempZ : null
```

And in the returned object, after `spo2Trend,`:

```typescript
    tempZ,
```

- [ ] **Step 3: Typecheck + tests**

Run: `npx tsc --noEmit && npx vitest run lib/__tests__`
Expected: clean (the Task-2 fixture already carries `tempZ: null`).

- [ ] **Step 4: Commit**

```bash
git add lib/ai-periodization/signals.ts
git commit -m "Feed live BLE skin-temp baseline z into prescription signals"
```

---

### Task 4: Render both signals in the prescription prompt; fold into the rest-day rule

**Files:**
- Modify: `lib/ai-periodization/prompt.ts`
- Test: `lib/__tests__/prompt-recovery-signals.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// lib/__tests__/prompt-recovery-signals.test.ts
import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, buildUserPrompt } from '@/lib/ai-periodization/prompt'
import type { PrescriptionSignals } from '@/lib/ai-periodization/signals'
import type { SessionPeriodization } from '@/lib/types/ai-periodization'

const signals = (over: Partial<PrescriptionSignals> = {}): PrescriptionSignals => ({
  trainingGoal: 'powerbuilding',
  autoApplyPrescriptions: false,
  effectiveTimeBudgetMin: 60,
  exercises: [
    {
      sessionExerciseId: 'ex-1', name: 'Hip Thrust', role: 'primary',
      muscleGroups: ['glutes'], muscleAssignments: [{ muscle: 'glutes', role: 'main' }],
      baseline1rm: 100, current1rm: 120, rm1Trend: 'flat', rm1ChangeKg: 0,
      avgSetDurationSec: 40, timeProfile: null, equipment: ['barbell'], transitionSec: 240,
      plateau: false, rpeDelta: null, repCompletionRate: null,
    },
  ],
  phase: 'accumulation', sessionsInPhase: 2,
  hoursSinceLastSession: 72, consecutiveSessionDaysOfThisType: 1,
  soreMusclesInSession: [], soreMusclesOutOfSession: [], sorenessLogDate: 'none',
  activeInjuredMusclesInSession: [],
  morningCheckin: null,
  rpeTrend: null, repCompletionRate: null,
  weeklyTargets: {}, weeklyLogged: {}, volumeBudgetPerMuscleGroup: {},
  acwr: null, sleepTrend: null, sleepScoreTrend: null, hrvTrend: null, spo2Trend: null,
  tempZ: null, externalReadiness: null,
  confidenceTier: 2, confidence: 0.7, confidenceReasons: [],
  ...over,
})

const state = { phase: 'accumulation', sessionsInPhase: 2 } as unknown as SessionPeriodization

describe('buildUserPrompt — temp + sleep-quality signals', () => {
  it('renders temp_z with a sign when present', () => {
    const p = buildUserPrompt(signals({ tempZ: 2.7 }), state, '2026-07-16')
    expect(p).toContain('Skin temp deviation')
    expect(p).toContain('+2.7')
  })

  it('renders temp_z "no data" when null', () => {
    const p = buildUserPrompt(signals(), state, '2026-07-16')
    expect(p).toContain('Skin temp deviation (temp_z): no data')
  })

  it('renders the sleep quality trend when present, alongside the duration trend', () => {
    const p = buildUserPrompt(signals({ sleepTrend: 0.95, sleepScoreTrend: 0.72 }), state, '2026-07-16')
    expect(p).toContain('Sleep trend (recent/baseline ratio): 0.95')
    expect(p).toContain('Sleep quality trend')
    expect(p).toContain('0.72')
  })

  it('renders sleep quality "no data" when null', () => {
    expect(buildUserPrompt(signals(), state, '2026-07-16')).toContain('Sleep quality trend: no data')
  })
})

describe('buildSystemPrompt — rest-day rule covers temperature + sleep quality', () => {
  const p = buildSystemPrompt('powerbuilding')
  it('folds temp_z into rest_day_recommended at the shared fever threshold', () => {
    expect(p).toContain('temp_z >= 2.5')
  })
  it('prefers sleep_score_trend, keeping sleep_trend as the fallback', () => {
    expect(p).toContain('sleep_score_trend')
    expect(p).toContain('sleep_trend')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/__tests__/prompt-recovery-signals.test.ts`
Expected: FAIL on the new assertions (fixture compiles — fields exist since Tasks 2-3).

- [ ] **Step 3: Implement in `lib/ai-periodization/prompt.ts`**

Add the import (shared constant — never re-declare 2.5):

```typescript
import { FEVER_TEMP_Z } from '@/lib/health/illness-radar'
```

In `buildSystemPrompt`, replace the rest-day rule (lines ~148-151):

```
- "rest_day_recommended": multiple systemic stress indicators simultaneously poor
  (sleep_trend < 0.75 AND hrv_trend < 0.75, OR external_readiness < 40, OR spo2_trend < 0.97);
  recommend skipping training entirely today.
  If no sleep/HRV/SpO2 data, do NOT output rest_day_recommended from those signals alone.
```

with (inside the template literal, so `${FEVER_TEMP_Z}` interpolates):

```
- "rest_day_recommended": multiple systemic stress indicators simultaneously poor
  (sleep_score_trend < 0.75 AND hrv_trend < 0.75 — use sleep_trend in place of
  sleep_score_trend when the quality trend is not given; OR external_readiness < 40,
  OR spo2_trend < 0.97, OR temp_z >= ${FEVER_TEMP_Z} [skin temperature fever-consistent
  vs personal baseline]); recommend skipping training entirely today.
  If no sleep/HRV/SpO2/temperature data, do NOT output rest_day_recommended from those signals alone.
```

In `buildUserPrompt`'s `recoveryLines`, directly after the existing `sleepTrend` entry (~line 210-212), add:

```typescript
    signals.sleepScoreTrend != null
      ? `  Sleep quality trend (recent/baseline ratio, our 0-100 sleep score): ${signals.sleepScoreTrend.toFixed(2)}`
      : `  Sleep quality trend: no data`,
```

And directly after the existing `spo2Trend` entry (~line 216-218), add:

```typescript
    signals.tempZ != null
      ? `  Skin temp deviation (temp_z, z-score vs personal baseline; >=${FEVER_TEMP_Z} fever-consistent): ${signals.tempZ > 0 ? '+' : ''}${signals.tempZ.toFixed(1)}`
      : `  Skin temp deviation (temp_z): no data`,
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/__tests__/prompt-recovery-signals.test.ts lib/__tests__/prompt-deload-awareness.test.ts`
Expected: PASS (deload-awareness proves the additive lines broke nothing).

- [ ] **Step 5: Commit**

```bash
git add lib/ai-periodization/prompt.ts lib/__tests__/prompt-recovery-signals.test.ts
git commit -m "Prescription prompt sees skin-temp z and sleep quality; rest-day rule updated"
```

---

### Task 5: SpO₂ into the AI chat's recovery tool

**Files:**
- Modify: `lib/ai-chat/tools.ts` (`getRecoveryData`, ~46-74)
- Test: `lib/ai-chat/__tests__/tools-recovery.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// lib/ai-chat/__tests__/tools-recovery.test.ts
import { describe, it, expect } from 'vitest'
import { buildChatTools } from '@/lib/ai-chat/tools'
import type { WorkoutRepository } from '@/lib/data/repository'

// Stub only what getRecoveryData touches — the tool must surface spo2Pct, which
// body_metrics has carried all along while the chat payload silently dropped it.
const repo = {
  getOuraDaily: async () => [],
  listSleepSessions: async () => [],
  listBodyMetrics: async () => [
    { date: '2026-07-15', hrvMs: 52, restingHeartRate: 48, steps: 9000, weightKg: 82.5, spo2Pct: 96.4 },
  ],
} as unknown as WorkoutRepository

describe('getRecoveryData chat tool', () => {
  it('includes SpO2 in the body-metrics payload', async () => {
    const tools = buildChatTools(repo, 'u1', 'Australia/Brisbane', '2026-07-16')
    const out = await tools.getRecoveryData.execute!(
      { fromDate: '2026-07-10', toDate: '2026-07-16' },
      { toolCallId: 't1', messages: [] },
    )
    expect(out.bodyMetrics[0]).toMatchObject({ hrvMs: 52, spo2Pct: 96.4 })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/ai-chat/__tests__/tools-recovery.test.ts`
Expected: FAIL — `bodyMetrics[0]` has no `spo2Pct`.

- [ ] **Step 3: Implement**

In `lib/ai-chat/tools.ts` `getRecoveryData`, update the description string to:

```typescript
      description: 'Oura daily scores (readiness/sleep/activity, temp deviation, resilience), sleep sessions (duration, efficiency, overnight HRV, lowest HR) and body metrics (HRV, resting HR, SpO2, steps, weight) for a date range. Use for recovery, sleep, HRV, SpO2 and readiness questions.',
```

and extend the `bodyMetrics` mapping (~line 68-71):

```typescript
          bodyMetrics: metrics.map(m => ({
            date: m.date, hrvMs: m.hrvMs ?? null, restingHrBpm: m.restingHeartRate ?? null,
            spo2Pct: m.spo2Pct ?? null,
            steps: m.steps ?? null, weightKg: m.weightKg ?? null,
          })),
```

- [ ] **Step 4: Run to verify it passes + commit**

Run: `npx vitest run lib/ai-chat/__tests__/tools-recovery.test.ts`
Expected: PASS.

```bash
git add lib/ai-chat/tools.ts lib/ai-chat/__tests__/tools-recovery.test.ts
git commit -m "Expose SpO2 to the AI chat recovery tool"
```

---

### Task 6: Weekly digest — average nightly sleep score (quality, not just hours)

**Files:**
- Modify: `app/api/weekly-digest/route.ts`

- [ ] **Step 1: Implement**

Add the import:

```typescript
import { computeSleepScore } from '@/lib/health/sleep-score'
```

Replace the `avgSleep` block (~lines 99-101) — which today averages over the **entire 14-day fetch window** while labelled as this week's average (bug found verifying this plan) — with recap-week-scoped duration *and* a quality line:

```typescript
  const recapSleep = sleepSessions.filter(s => s.date >= isoWeekKey && s.date <= recapWeekEndIso)
  const durVals = recapSleep.filter(s => s.durationHours != null)
  const avgSleep = durVals.length
    ? (durVals.reduce((s, r) => s + r.durationHours!, 0) / durVals.length).toFixed(1) + 'h avg sleep'
    : null

  // Quality, not just hours: our own 0-100 sleep score per night (efficiency/stages/
  // latency/restfulness — computeSleepScore, the same formula the readiness route uses).
  const sleepScoreOf = (from: string, to: string) => {
    const vals = sleepSessions
      .filter(s => s.date >= from && s.date <= to)
      .map(s => computeSleepScore(s, tz)?.score)
      .filter((v): v is number => v != null)
    return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
  }
  const scoreRecapWeek = sleepScoreOf(isoWeekKey, recapWeekEndIso)
  const scorePriorWeek = sleepScoreOf(from14dIso, priorWeekEndIso)
  const sleepQualityLine = scoreRecapWeek != null
    ? `Sleep quality: ${scoreRecapWeek}/100 avg nightly sleep score that week${scorePriorWeek != null ? ` (week before ${scorePriorWeek}/100)` : ''}`
    : null
```

In the `context` array (~lines 137-147), after `avgSleep,` add:

```typescript
    sleepQualityLine,
```

(The route stays prose `generateText` — context-only change, no `JSON.parse` of model text, existing try-catch and rate limit untouched.)

- [ ] **Step 2: Typecheck + lint + commit**

Run: `npx tsc --noEmit && npx eslint app/api/weekly-digest/route.ts`
Expected: clean.

```bash
git add app/api/weekly-digest/route.ts
git commit -m "Weekly digest reports sleep quality, not just hours; scope avg sleep to the recap week"
```

---

### Task Final: Gate + dev-server smoke + version/docs

- [ ] **Step 1: Full gate**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`
Expected: all green.

- [ ] **Step 2: Dev-server smoke (local DB, `test@local.dev` / `testpass123`)**

Run `pnpm dev`, log in, then:

1. **Prescription signal aggregation:** find a program session id — `psql "postgresql://postgres:postgres@localhost:5433/trainingai_dev" -tAc "SELECT id, name FROM program_sessions LIMIT 3"` — and `GET /api/ai-periodization/session/<id>` with the session cookie. Confirm 200 and the JSON `signals` object contains the keys `sleepTrend`, `sleepScoreTrend`, and `tempZ` (`sleepScoreTrend` numeric — the seed has 1-2 weeks of sleep rows; `tempZ` null — the seed has no `oura_daily_summary` rows, which exercises exactly the null-render path; the non-null path is unit-covered by Task 4 + `illness-radar.test.ts`).
2. **Next-session engine unchanged:** `GET /api/next-session` (or the home screen) still returns a recommendation with a `signals.sleepTrend` value — proves the adapter dedupe.
3. **Chat tool payload:** covered deterministically by the Task 5 unit test; additionally, if `GOOGLE_GENERATIVE_AI_API_KEY` is present locally, ask the AI chat "what was my SpO2 this week" and confirm it quotes a value rather than claiming no data.
4. **Weekly digest:** `curl -X POST /api/weekly-digest -H 'Content-Type: application/json' -d '{"force":true}'` with the cookie. With an AI key: 200 and the digest may mention sleep quality. Without one: the request must fail **only** at the `generateText` step (502 `AI generation failed`, `[weekly-digest] generateText failed` in the log) — proving the new context assembly ran without crashing. Either outcome passes; a crash before the AI call fails.

- [ ] **Step 3: Version + changelog + docs (before merge — same PR)**

- Bump `package.json` **patch** (justification: internal AI-signal-quality fix — no new screen, route, or interaction; the only user-visible delta is richer digest wording and better-informed prescriptions). Expect a re-bump on rebase if parallel PRs land.
- `lib/changelog.ts`: **yes, add an entry** — digest wording is user-visible (explicit decision): "Weekly digest now reports sleep quality (nightly sleep score), and the AI coach sees skin-temperature deviation, sleep quality and SpO₂ when prescribing sessions."
- `docs/module-map.md`: add a one-line row for `lib/health/sleep-trend.ts` next to the sleep-score entry (new shared helper — same-PR rule).
- Remove this plan's entry from `docs/implementation-backlog.md`; append the session note to the current `docs/overview/history-*.md`; update `projectOverview.md` (tick the Batch-S §2.4 item; no Known-Issues row needed — no device-gated surface).

- [ ] **Step 4: Push + PR**

```bash
git push -u origin fix/ai-signal-consistency
```

Open the PR, watch CI, merge when green per the standing workflow (standard change — no destructive carve-out applies).

---

## Verification summary

- **Automated:** 9 sleep-trend unit tests, 6 prompt tests, 1 chat-tool payload test, plus the existing `prompt-deload-awareness` / `ai-dynamic` suites guarding regressions; full gate.
- **Dev-server:** prescription signals route (new keys, null-safe `tempZ` path), next-session route (adapter dedupe), weekly digest (context assembly).
- **Not exercised (state in the PR):** real `oura_daily_summary` rows with mature temp baselines (prod-only — the non-null `tempZ` path is unit-covered, and `illnessZScores` itself is already prod-proven via the readiness route); live Gemini behaviour on the updated prompts.

## Notes for the implementer

- **Re-verify against `main` before starting** (plans go stale): the load-bearing anchors are `PrescriptionSignals` (`signals.ts:17-82`), the rest-day rule (`prompt.ts:148-151`), `getNextSession`'s inline sleep trend (`adapter.ts:~1533`), `getRecoveryData` (`tools.ts:46-74`), and the digest context block (`weekly-digest/route.ts:99-147`). If any moved, adjust line references — the shapes were all confirmed 2026-07-16 after Polar H10/#570/#571/#575 landed.
- Never re-derive: `computeSleepScore` (`lib/health/sleep-score.ts`), `illnessZScores`/`FEVER_TEMP_Z` (`lib/health/illness-radar.ts`) are imports, not copies. If `tsc` reveals another `PrescriptionSignals` constructor beyond `lib/__tests__/prompt-deload-awareness.test.ts`, add the two null fields there too — do not loosen the type.
- Do NOT touch `ai-dynamic.ts`'s inputs (frozen-Cloud `temperatureDeviation`/`daySummary`) or the adapter's inline `hrvTrend` — both are other findings' scope (§3.3/§2.2 and the wear-filter divergence respectively).
- `workout-review`'s prompt intentionally stays trend-free (it reviews structure/fit, not readiness) — no sibling change.
