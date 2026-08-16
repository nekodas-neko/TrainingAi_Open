# Illness Signal Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the illness radar — the app's strongest "don't train hard today" signal — into every decision layer that should see it: the AI periodization signals + prompt rules, the deterministic next-session deload strength, the consumption-day prescription re-evaluation, the AI chat (tool + context), the weekly digest, the readiness health-insight, and a Home advisory — so a `fever`/`elevated` night changes what the app actually tells the user to do, not just one buried line on `/health/readiness`.

**Architecture:** The radar already computes and persists per-night `illness_flag/score/biomarkers` to `oura_daily_derived` (rollup, `lib/data/postgres/adapter.ts:4362-4377`, via the shared `illnessFromSummaries`), and `/api/readiness-score` already returns `illnessFlag/illnessScore/illnessBiomarkers/illnessSuppression/illnessAdvisory` live (`route.ts:388-392`). This plan adds **read paths only** — no new formula, no migration, no new fetch on Home. One new pure helper, `latestIllnessFromDerived()` in `lib/health/illness-radar.ts`, becomes the single "latest persisted illness" accessor (One Formula, One Place) used by signals aggregation, the next-session engine, the consumption-day re-eval, chat, and the digest. This is also the **first production read path for `oura_daily_derived`** (review §1.1 called it write-only).

**Tech Stack:** TypeScript, `lib/health/illness-radar.ts`, `lib/ai-periodization/*`, `lib/ai-chat/*`, Drizzle repo (`getOuraDailyDerived`, already implemented at `lib/data/postgres/slices/oura.ts:660` / `repository.ts:729`), vitest.

---

## Why now

Data-efficiency review finding **S3** (`docs/planned_upgrades.md` Batch S; full write-up `docs/reviews/2026-07-16-data-efficiency-review.md` §2.1, High/M): *"illness radar reaches ZERO decision layers"* — it is consumed by exactly one advisory on `/health/readiness` (`components/health/health-score-detail.tsx:181-192`) plus a bounded readiness suppression, and is absent from `PrescriptionSignals`, the rest-day/deload gates, the emergency/per-exercise deload, chat, digests, and Home. A fever-graded night today changes nothing about the prescribed session.

**Branch:** `feat/illness-signal-wiring`

## Design decisions (made in the planning session — encode, don't re-litigate)

1. **Source = the persisted `oura_daily_derived` row (today or yesterday — latest available night), read via `repo.getOuraDailyDerived`,** not a live recompute. The rollup and the readiness route both go through `illnessFromSummaries`/`illnessZScores`, so stored and live values cannot diverge by construction. `learning` (or no row) → `null` — consumers must treat null as "no data", never fabricate.
2. **The LLM gets it AND deterministic guards get it.** Prompt rules alone are not enough (the same reason autoregulation/deload guards exist): `computeDeloadStrength` treats `elevated` like its existing temp-deviation trigger and `fever` as a strong deload; `reevaluatePrescriptionForToday` deloads every exercise in place when the flag is `elevated`/`fever` (reversible next day when the flag clears, via the existing preDeload restore path).
3. **Illness is deliberately NOT a new emergency-deload trigger** (`shouldTriggerEmergencyDeload` unchanged). An emergency deload regenerates the whole prescription via the LLM and mutates phase-adjacent state on acceptance; illness is transient (often 1–3 days) and is better handled by the in-place, self-reverting per-exercise override + the prompt's `rest_day_recommended` gate. Document this in the code comment so it isn't "fixed" later.
4. **Home needs NO new fetch.** `session-select-content.tsx` already holds the full `/api/readiness-score` response (`readiness` state, line 159; response fields verified at `app/api/readiness-score/route.ts:388-392`) — the banner is a new small component reading `illnessFlag/illnessAdvisory/illnessSuppression` from that prop. `session-select-content.tsx` is 1,358 lines, so the banner is extracted to `components/home/` (never appended inline). Icon + text label, never colour-alone.
5. **`watch` is advisory context only** — it appears in prompt/chat/digest text but triggers no deterministic action and no Home banner (only `elevated`/`fever` do), mirroring the radar's own suppression table (`READINESS_SUPPRESSION.watch === 0`).

## Verified current state (2026-07-16, post #570/#571/#575 + Polar H10)

- `PrescriptionSignals` (`lib/ai-periodization/signals.ts:17-82`) — no illness field; `aggregateSignals` already computes `yesterday` (line 108) and has a second `Promise.all` (line 110) to extend.
- Prompt rest-day rule at `lib/ai-periodization/prompt.ts:148-151`; recovery lines array at `:204-227`. `buildUserPrompt`'s `state` param is unused in the body — tests can pass a cast.
- `computeDeloadStrength` at `lib/ai-periodization/ai-dynamic.ts:149-170` (uses frozen Cloud `temperatureDeviation` + `daySummary`); sole caller `computeAiDynamicNextSession` (`:224`), assembled in `adapter.ts` `getNextSession` AI-dynamic branch (`:1514-1576`).
- `reevaluatePrescriptionForToday` (`lib/ai-periodization/reevaluate.ts:32`) — caller assembles `ReevaluationSignals` in `app/api/workout-data/route.ts:277-326` (already imports `shiftDateStr`).
- Chat: `getRecoveryData` `lib/ai-chat/tools.ts:46-74`; `buildRecoverySummary` `lib/ai-chat/context.ts:75-126`, called from `app/api/ai-chat/route.ts:67-79`.
- Digest context array `app/api/weekly-digest/route.ts:137-147`; health-insight readiness lines `app/api/ai/health-insight/route.ts:70-78`.
- Tests live in `lib/__tests__/` (`ai-dynamic.test.ts` baseInput at `:45-60`, `reevaluate.test.ts` baseSignals at `:34-43`) — **not** `lib/ai-periodization/__tests__/` (that dir holds only `secondary-zone.test.ts`); radar tests at `lib/health/__tests__/illness-radar.test.ts`.
- `OuraDailyDerivedRow.illnessFlag` is `string | null` (repo boundary, `repository.ts:861`) — narrow once, in the new helper.

## File structure

**Create:**
- `components/home/illness-advisory-banner.tsx` — compact Home advisory (elevated/fever only).
- `lib/ai-periodization/__tests__/illness-prompt.test.ts` — prompt rendering + system-rule tests.

**Modify:**
- `lib/health/illness-radar.ts` — add `latestIllnessFromDerived()` (+ `LatestIllness` type).
- `lib/health/__tests__/illness-radar.test.ts` — helper tests.
- `lib/ai-periodization/signals.ts` — `illness` field + populate in `aggregateSignals`.
- `lib/ai-periodization/prompt.ts` — illness signal line + rest-day rule extension.
- `lib/ai-periodization/ai-dynamic.ts` — `illnessFlag` input → `computeDeloadStrength`.
- `lib/ai-periodization/reevaluate.ts` — illness all-exercise deload (self-reverting).
- `lib/data/postgres/adapter.ts` — `getNextSession` AI-dynamic branch passes the flag.
- `app/api/workout-data/route.ts` — re-eval caller fetches + passes the flag.
- `lib/ai-chat/tools.ts` + `lib/ai-chat/context.ts` + `app/api/ai-chat/route.ts` — chat wiring.
- `app/api/weekly-digest/route.ts` + `app/api/ai/health-insight/route.ts` — one line each.
- `app/session-select/session-select-content.tsx` — mount the banner (2 lines).
- `lib/__tests__/ai-dynamic.test.ts`, `lib/__tests__/reevaluate.test.ts` — baseInput/baseSignals gain the field + new cases.
- `lib/changelog.ts` + `package.json` version, journal + `projectOverview.md` index (final task).

---

### Task 1: `latestIllnessFromDerived()` — the one accessor for persisted illness

**Files:**
- Modify: `lib/health/illness-radar.ts`
- Test: `lib/health/__tests__/illness-radar.test.ts`

Four consumers (signals, next-session, re-eval caller, chat/digest) all need "the latest non-learning illness row from a `getOuraDailyDerived` range" with the same null semantics and the same `string → IllnessFlag` narrowing. One Formula, One Place: it lives beside the radar.

- [ ] **Step 1: Write the failing tests** (append to `lib/health/__tests__/illness-radar.test.ts`)

```typescript
import { latestIllnessFromDerived } from '../illness-radar'

describe('latestIllnessFromDerived', () => {
  const row = (day: string, flag: string | null, score: number | null = 50) =>
    ({ day, illnessFlag: flag, illnessScore: score, illnessBiomarkers: flag ? { temperature: { z: 2.1, contribution: 40 } } : null })

  it('returns the latest row that has a flag (rows arrive sorted asc by day)', () => {
    const r = latestIllnessFromDerived([row('2026-07-14', 'normal'), row('2026-07-15', 'elevated', 70)])
    expect(r).toEqual({
      day: '2026-07-15', flag: 'elevated', score: 70,
      biomarkers: { temperature: { z: 2.1, contribution: 40 } },
    })
  })

  it('skips rows whose illness columns are null (e.g. body-comp-only days)', () => {
    const r = latestIllnessFromDerived([row('2026-07-14', 'watch', 45), row('2026-07-15', null, null)])
    expect(r?.flag).toBe('watch')
    expect(r?.day).toBe('2026-07-14')
  })

  it('returns null while the radar is learning (never fabricate a signal)', () => {
    expect(latestIllnessFromDerived([row('2026-07-15', 'learning', 0)])).toBeNull()
  })

  it('returns null for an empty range and defaults a null score to 0', () => {
    expect(latestIllnessFromDerived([])).toBeNull()
    expect(latestIllnessFromDerived([row('2026-07-15', 'fever', null)])?.score).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/health/__tests__/illness-radar.test.ts`
Expected: FAIL — `latestIllnessFromDerived` is not exported.

- [ ] **Step 3: Implement** (append to `lib/health/illness-radar.ts`, after `illnessAdvisory`)

```typescript
/** The latest persisted illness reading from a `getOuraDailyDerived` range. */
export interface LatestIllness {
  day: string
  flag: IllnessFlag
  score: number
  biomarkers: Partial<Record<IllnessBiomarkerKey, IllnessBiomarker>> | null
}

/**
 * Latest non-learning illness row from an ASC-sorted `oura_daily_derived` range (the shape
 * `repo.getOuraDailyDerived` returns). The ONE place the repo's `string | null` flag is
 * narrowed to IllnessFlag. `learning` or no flagged row → null — consumers treat null as
 * "no data" and must never act on it.
 */
export function latestIllnessFromDerived(
  rows: Array<{ day: string; illnessFlag: string | null; illnessScore: number | null; illnessBiomarkers?: unknown }>,
): LatestIllness | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (r.illnessFlag == null) continue
    if (r.illnessFlag === 'learning') return null
    return {
      day: r.day,
      flag: r.illnessFlag as IllnessFlag,
      score: r.illnessScore ?? 0,
      biomarkers: (r.illnessBiomarkers ?? null) as Partial<Record<IllnessBiomarkerKey, IllnessBiomarker>> | null,
    }
  }
  return null
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/health/__tests__/illness-radar.test.ts`
Expected: PASS (existing radar tests + 4 new).

- [ ] **Step 5: Commit**

```bash
git add lib/health/illness-radar.ts lib/health/__tests__/illness-radar.test.ts
git commit -m "Add latestIllnessFromDerived — single accessor for persisted illness rows"
```

---

### Task 2: `illness` in `PrescriptionSignals` + populate in `aggregateSignals`

**Files:**
- Modify: `lib/ai-periodization/signals.ts`

- [ ] **Step 1: Add the import** (top of file)

```typescript
import { latestIllnessFromDerived, type IllnessFlag } from '@/lib/health/illness-radar'
```

- [ ] **Step 2: Add the field to `PrescriptionSignals`** — insert after `spo2Trend: number | null` (line 74), before the `externalReadiness` comment:

```typescript
  // Latest persisted illness-radar reading (oura_daily_derived — last night, or the night
  // before when last night hasn't rolled up yet). null = no data or baseline still learning.
  illness: { flag: IllnessFlag; score: number } | null
```

- [ ] **Step 3: Fetch it.** Extend the second `Promise.all` (line 110) — add as the final element:

```typescript
    repo.getOuraDailyDerived(userId, yesterday, today),
```

and the destructuring gains `derivedRows` as the final name (the array literal at line 110 currently ends with `timingAudit`). Note `yesterday` (line 108) is already computed **above** this Promise.all — no reordering needed.

- [ ] **Step 4: Derive + return.** Near the SpO₂ trend block (after line 389) add:

```typescript
  const latestIllness = latestIllnessFromDerived(derivedRows)
  const illness = latestIllness ? { flag: latestIllness.flag, score: latestIllness.score } : null
```

and add `illness,` to the returned object (next to `spo2Trend,`).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | grep -v "illness-prompt" | grep "signals\|prompt\|emergency" || echo clean`
Expected: `clean` — nothing else constructs a full `PrescriptionSignals` literal (`EmergencySignals` is a `Pick` that doesn't include `illness`; verify with `grep -rn "PrescriptionSignals" lib app --include=*.ts | grep -v test`).

```bash
git add lib/ai-periodization/signals.ts
git commit -m "Expose the persisted illness-radar flag to prescription signal aggregation"
```

---

### Task 3: Prompt — illness signal line + rest-day rule (additive, small)

**Files:**
- Modify: `lib/ai-periodization/prompt.ts`
- Create: `lib/ai-periodization/__tests__/illness-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/ai-periodization/__tests__/illness-prompt.test.ts
import { describe, it, expect } from 'vitest'
import type { SessionPeriodization } from '@/lib/types/ai-periodization'
import type { PrescriptionSignals } from '../signals'
import { buildSystemPrompt, buildUserPrompt } from '../prompt'

// Minimal but complete signals object — every required field, neutral values.
const baseSignals: PrescriptionSignals = {
  trainingGoal: 'strength',
  autoApplyPrescriptions: false,
  effectiveTimeBudgetMin: 60,
  exercises: [],
  phase: 'accumulation',
  sessionsInPhase: 2,
  hoursSinceLastSession: 48,
  consecutiveSessionDaysOfThisType: 0,
  soreMusclesInSession: [],
  soreMusclesOutOfSession: [],
  sorenessLogDate: 'none',
  activeInjuredMusclesInSession: [],
  morningCheckin: null,
  rpeTrend: null,
  repCompletionRate: null,
  weeklyTargets: {},
  weeklyLogged: {},
  volumeBudgetPerMuscleGroup: {},
  acwr: null,
  sleepTrend: null,
  hrvTrend: null,
  spo2Trend: null,
  illness: null,
  externalReadiness: null,
  confidenceTier: 1,
  confidence: 0.5,
  confidenceReasons: [],
}
// buildUserPrompt never dereferences state (verified) — a cast keeps the test honest about that.
const state = {} as SessionPeriodization

describe('illness in the periodization prompt', () => {
  it('renders the illness line when a flag is present', () => {
    const p = buildUserPrompt({ ...baseSignals, illness: { flag: 'elevated', score: 70 } }, state, '2026-07-16')
    expect(p).toContain('Illness radar (vs personal baseline): elevated (score 70/100)')
  })

  it('renders "no data" when null so the model omits it from reasoning', () => {
    expect(buildUserPrompt(baseSignals, state, '2026-07-16')).toContain('Illness radar: no data')
  })

  it('system prompt gates rest_day_recommended on elevated/fever and keeps watch advisory-only', () => {
    const s = buildSystemPrompt('strength')
    expect(s).toContain('illness radar is elevated or fever')
    expect(s).toContain('"watch" is context only')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/ai-periodization/__tests__/illness-prompt.test.ts`
Expected: FAIL — the strings don't exist yet.

- [ ] **Step 3: Extend the system prompt.** In `buildSystemPrompt`, replace the `rest_day_recommended` rule (lines 148-151):

```
- "rest_day_recommended": multiple systemic stress indicators simultaneously poor
  (sleep_trend < 0.75 AND hrv_trend < 0.75, OR external_readiness < 40, OR spo2_trend < 0.97),
  OR the illness radar is elevated or fever (temperature/RHR/HRV moving together against the
  user's own baseline — training hard while fighting something makes both worse);
  recommend skipping training entirely today.
  An illness radar of "watch" is context only — never recommend a rest day from watch alone.
  If no sleep/HRV/SpO2/illness data, do NOT output rest_day_recommended from those signals alone.
```

- [ ] **Step 4: Add the recovery line.** In `buildUserPrompt`'s `recoveryLines` array, insert after the SpO₂ trend entry (line 218):

```typescript
    signals.illness != null
      ? `  Illness radar (vs personal baseline): ${signals.illness.flag} (score ${signals.illness.score}/100)`
      : `  Illness radar: no data`,
```

- [ ] **Step 5: Run to verify it passes, then commit**

Run: `npx vitest run lib/ai-periodization/__tests__/illness-prompt.test.ts`
Expected: PASS (3 tests)

```bash
git add lib/ai-periodization/prompt.ts lib/ai-periodization/__tests__/illness-prompt.test.ts
git commit -m "Gate rest-day recommendation on the illness radar in the periodization prompt"
```

---

### Task 4: Deterministic guard #1 — next-session deload strength

**Files:**
- Modify: `lib/ai-periodization/ai-dynamic.ts`, `lib/data/postgres/adapter.ts`, `lib/__tests__/ai-dynamic.test.ts`

- [ ] **Step 1: Write the failing tests.** In `lib/__tests__/ai-dynamic.test.ts`, add `illnessFlag: null,` to `baseInput` (line 45-60), then append inside the main `describe`:

```typescript
  it('flags recommended deload on illness "elevated" even below 3 consecutive days', () => {
    const history = makeHistory(['Push'], [1])
    const result = computeAiDynamicNextSession({ ...baseInput, history, illnessFlag: 'elevated' })
    expect(result.deloadOrRestRecommended).toBe(true)
    expect(result.deloadStrength).toBe('recommended')
  })

  it('flags strong deload on illness "fever" regardless of readiness', () => {
    const history = makeHistory(['Push'], [1])
    const result = computeAiDynamicNextSession({ ...baseInput, history, readinessScore: 90, illnessFlag: 'fever' })
    expect(result.deloadOrRestRecommended).toBe(true)
    expect(result.deloadStrength).toBe('strong')
  })

  it('does not deload on illness "watch" or "learning" (advisory-only flags)', () => {
    const history = makeHistory(['Push'], [1])
    expect(computeAiDynamicNextSession({ ...baseInput, history, illnessFlag: 'watch' }).deloadOrRestRecommended).toBe(false)
    expect(computeAiDynamicNextSession({ ...baseInput, history, illnessFlag: 'learning' }).deloadOrRestRecommended).toBe(false)
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/__tests__/ai-dynamic.test.ts`
Expected: FAIL — `illnessFlag` not in `AiDynamicInput`.

- [ ] **Step 3: Implement in `ai-dynamic.ts`.** Add the type import at the top:

```typescript
import type { IllnessFlag } from '@/lib/health/illness-radar'
```

Add to `AiDynamicInput` (after `hrvTrend: number | null`):

```typescript
  // Latest persisted illness-radar flag (null = no data / learning). elevated/fever are the
  // only action-bearing values — watch is advisory-only, mirroring READINESS_SUPPRESSION.
  illnessFlag: IllnessFlag | null
```

Replace `computeDeloadStrength` (lines 149-170) with:

```typescript
function computeDeloadStrength(
  consecutiveTrainingDays: number,
  readinessScore: number | null,
  temperatureDeviation: number | null,
  daySummary: string | null,
  illnessFlag: IllnessFlag | null,
): { recommended: boolean; strength: 'soft' | 'recommended' | 'strong'; temperatureAlert: boolean } {
  // Fever overrides everything — the strongest "don't train hard" signal we have.
  // temperatureAlert stays tied to the Cloud temp-deviation field (its own UI copy).
  if (illnessFlag === 'fever') {
    return { recommended: true, strength: 'strong', temperatureAlert: false }
  }

  const tempAlert = temperatureDeviation != null && temperatureDeviation > 0.5
  const stressOverride = daySummary === 'very_stressful'

  if (tempAlert || stressOverride || illnessFlag === 'elevated') {
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

In `computeAiDynamicNextSession`: add `illnessFlag` to the destructuring (line 175-179) and pass it as the fifth argument at the `computeDeloadStrength` call (line 224-226).

- [ ] **Step 4: Wire the caller.** In `lib/data/postgres/adapter.ts` `getNextSession` AI-dynamic branch: add the import `latestIllnessFromDerived` next to the existing `illnessFromSummaries` import (line 22), extend the `Promise.all` (line 1514) with a final element:

```typescript
        this.getOuraDailyDerived(userId, toAestDay(new Date(Date.now() - 86_400_000), timezone), todayIso),
```

(destructure as `derivedRows`; the `Date.now() − 86_400_000` day-shift matches the branch's existing `from14dStr` idiom two lines up — a range start, not a bucket boundary), then before the `computeAiDynamicNextSession` call:

```typescript
      const illnessFlag = latestIllnessFromDerived(derivedRows)?.flag ?? null
```

and add `illnessFlag,` to the call's input object (next to `hrvTrend,`).

- [ ] **Step 5: Run tests + typecheck + commit**

Run: `npx vitest run lib/__tests__/ai-dynamic.test.ts && npx tsc --noEmit 2>&1 | head -5`
Expected: PASS (existing + 3 new); typecheck clean.

```bash
git add lib/ai-periodization/ai-dynamic.ts lib/data/postgres/adapter.ts lib/__tests__/ai-dynamic.test.ts
git commit -m "Fold the illness radar into next-session deload strength"
```

---

### Task 5: Deterministic guard #2 — consumption-day re-evaluation

**Files:**
- Modify: `lib/ai-periodization/reevaluate.ts`, `app/api/workout-data/route.ts`, `lib/__tests__/reevaluate.test.ts`

The re-eval already re-derives per-exercise deloads against today's cheap signals once per day. Illness `elevated`/`fever` extends the deloaded set to **every** exercise, in place, using the existing goal-scoped override — and the existing `preDeload` restore path reverts it automatically the day the flag clears. This is the deliberate alternative to an emergency-deload trigger (design decision 3).

- [ ] **Step 1: Write the failing tests.** In `lib/__tests__/reevaluate.test.ts`, add `illnessFlag: null,` to `baseSignals` (line 34-43), then append:

```typescript
describe('reevaluatePrescriptionForToday — illness radar', () => {
  it('deloads every exercise in place on "elevated" without regenerating', () => {
    const prescription = makePrescription()
    const result = reevaluatePrescriptionForToday(prescription, { ...baseSignals, illnessFlag: 'elevated' }, baseState)
    expect(result.needsRegenerate).toBe(false)
    expect(result.changed).toBe(true)
    for (const ex of result.prescription.exercises) {
      expect(ex.deloaded).toBe(true)
      expect(ex.deloadNote).toBe('Deload — illness radar: elevated')
      expect(ex.preDeload).toBeDefined()
    }
  })

  it('restores preDeload values once the flag clears (self-reverting)', () => {
    const prescription = makePrescription()
    const sick = reevaluatePrescriptionForToday(prescription, { ...baseSignals, illnessFlag: 'fever' }, baseState)
    const recovered = reevaluatePrescriptionForToday(sick.prescription, baseSignals, baseState)
    expect(recovered.changed).toBe(true)
    for (const [i, ex] of recovered.prescription.exercises.entries()) {
      expect(ex.deloaded).toBe(false)
      expect(ex.sets).toBe(prescription.exercises[i].sets)
      expect(ex.pct).toBe(prescription.exercises[i].pct)
    }
  })

  it('keeps the soreness note where an exercise is both sore and illness-flagged', () => {
    const prescription = makePrescription()
    const result = reevaluatePrescriptionForToday(
      prescription, { ...baseSignals, soreMusclesInSession: ['chest'], illnessFlag: 'elevated' }, baseState)
    const bench = result.prescription.exercises.find(e => e.sessionExerciseId === 'bench')!
    const squat = result.prescription.exercises.find(e => e.sessionExerciseId === 'squat')!
    expect(bench.deloadNote).toContain('sore')
    expect(squat.deloadNote).toBe('Deload — illness radar: elevated')
  })

  it('does nothing on "watch"/"learning"', () => {
    const prescription = makePrescription()
    for (const flag of ['watch', 'learning', 'normal'] as const) {
      const result = reevaluatePrescriptionForToday(prescription, { ...baseSignals, illnessFlag: flag }, baseState)
      expect(result.changed).toBe(false)
    }
  })
})
```

(`makePrescription` is the file's existing factory — reuse it.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/__tests__/reevaluate.test.ts`
Expected: FAIL — `illnessFlag` not in `ReevaluationSignals`.

- [ ] **Step 3: Implement in `reevaluate.ts`.** Add the type import:

```typescript
import type { IllnessFlag } from '@/lib/health/illness-radar'
```

Add to `ReevaluationSignals`:

```typescript
  // Latest persisted illness-radar flag. elevated/fever deload the whole session in place
  // (self-reverting via preDeload when the flag clears). Deliberately NOT an emergency-deload
  // trigger: emergency deloads regenerate the whole prescription via the LLM and touch phase
  // state on acceptance — too heavy for a transient illness signal.
  illnessFlag: IllnessFlag | null
```

Then, after the `perEx` computation / `whole_session` early-return (line 63-65), replace the `nowDeloadedIds` line (67) and the note lookups with:

```typescript
  const illnessDeload = signals.illnessFlag === 'elevated' || signals.illnessFlag === 'fever'
  const nowDeloadedIds = perEx.outcome === 'per_exercise' ? new Set(perEx.deloadedIds) : new Set<string>()
  const notes: Record<string, string> = { ...perEx.notes }
  if (illnessDeload) {
    for (const ex of signals.exercises) {
      nowDeloadedIds.add(ex.sessionExerciseId)
      // Soreness notes are more specific — keep them where both apply.
      if (!notes[ex.sessionExerciseId]) notes[ex.sessionExerciseId] = `Deload — illness radar: ${signals.illnessFlag}`
    }
  }
```

and swap both `perEx.notes[ex.sessionExerciseId]` reads in the map body (lines 83 and 101) for `notes[ex.sessionExerciseId]`. Everything else (apply/restore/refresh branches, `perEx.override`) is untouched.

- [ ] **Step 4: Wire the caller.** In `app/api/workout-data/route.ts`, extend the re-eval `Promise.all` (line 277) with a final element:

```typescript
        repo.getOuraDailyDerived(userId, shiftDateStr(todayStr, -1), todayStr),
```

(destructure as `derivedRows`), import `latestIllnessFromDerived` from `@/lib/health/illness-radar`, and add to the signals object passed at line 309:

```typescript
          illnessFlag: latestIllnessFromDerived(derivedRows)?.flag ?? null,
```

- [ ] **Step 5: Run + typecheck + commit**

Run: `npx vitest run lib/__tests__/reevaluate.test.ts && npx tsc --noEmit 2>&1 | head -5`
Expected: PASS (existing + 4 new); clean.

```bash
git add lib/ai-periodization/reevaluate.ts app/api/workout-data/route.ts lib/__tests__/reevaluate.test.ts
git commit -m "Deload the day's prescription in place while the illness radar reads elevated/fever"
```

---

### Task 6: AI chat — tool data + default context

**Files:**
- Modify: `lib/ai-chat/tools.ts`, `lib/ai-chat/context.ts`, `app/api/ai-chat/route.ts`

- [ ] **Step 1: `getRecoveryData` gains illness.** In `lib/ai-chat/tools.ts` (`:46-74`): extend the tool's `Promise.all` with `repo.getOuraDailyDerived(userId, fromDate, toDate)` (destructure as `derived`), add to the returned object:

```typescript
          illnessRadar: derived
            .filter(r => r.illnessFlag != null)
            .map(r => ({ date: r.day, flag: r.illnessFlag, score: r.illnessScore ?? null })),
```

and update the tool description to: `'Oura daily scores (readiness/sleep/activity, temp deviation, resilience), sleep sessions (duration, efficiency, overnight HRV, lowest HR), body metrics (HRV, resting HR, steps, weight) and the app\'s own illness-radar flag per day for a date range. Use for recovery, sleep, HRV, readiness and "am I getting sick?" questions.'`

- [ ] **Step 2: `buildRecoverySummary` gains illness.** In `lib/ai-chat/context.ts`, add the imports:

```typescript
import { illnessAdvisory, type LatestIllness } from '@/lib/health/illness-radar'
```

Add a final parameter `illness: LatestIllness | null` to `buildRecoverySummary` (after `todayIso`), and after the `Last night:` block (line 106) insert:

```typescript
  if (illness) {
    const advisory = illnessAdvisory(illness.flag)
    // illnessAdvisory is non-null exactly when flag ≥ watch — normal nights stay silent.
    if (advisory) lines.push(`Illness radar (${illness.day}): ${illness.flag}, score ${illness.score}/100 — ${advisory}`)
  }
```

- [ ] **Step 3: Wire the route.** In `app/api/ai-chat/route.ts`: extend the `Promise.all` (line 67) with `repo.getOuraDailyDerived(userId, from7dIsoStr, todayIso)` (destructure as `derivedRows`), import `latestIllnessFromDerived` from `@/lib/health/illness-radar`, and pass it at line 79:

```typescript
    const recoverySummary = buildRecoverySummary(ouraRows, sleepSessions, morningCheckin, eveningCheckin, todayIso, latestIllnessFromDerived(derivedRows));
```

(Verify `buildRecoverySummary` has no other call sites: `grep -rn "buildRecoverySummary" app lib --include=*.ts*` — only the ai-chat route today.)

- [ ] **Step 4: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | grep "ai-chat" || echo clean`
Expected: `clean`

```bash
git add lib/ai-chat/tools.ts lib/ai-chat/context.ts app/api/ai-chat/route.ts
git commit -m "Expose the illness radar to AI chat (recovery tool + default context)"
```

---

### Task 7: Weekly digest + readiness health-insight — one line each

**Files:**
- Modify: `app/api/weekly-digest/route.ts`, `app/api/ai/health-insight/route.ts`

- [ ] **Step 1: Digest.** In `app/api/weekly-digest/route.ts`: import `latestIllnessFromDerived` from `@/lib/health/illness-radar`; extend the `Promise.all` (line 51) with `repo.getOuraDailyDerived(userId, from14dIso, recapWeekEndIso)` (destructure as `derivedRows`); after the `readinessLine` block (line 125) add:

```typescript
  // One line: latest flag, with the biomarker z's when ≥ watch (normal stays a bare "normal").
  const latestIllness = latestIllnessFromDerived(derivedRows)
  const illnessZs = latestIllness?.biomarkers && latestIllness.flag !== 'normal'
    ? Object.entries(latestIllness.biomarkers)
        .map(([k, v]) => `${k} z ${v.z > 0 ? '+' : ''}${v.z}`)
        .join(', ')
    : null
  const illnessLine = latestIllness
    ? `Illness radar (vs personal baseline): ${latestIllness.flag}${illnessZs ? ` — ${illnessZs}` : ''}`
    : null
```

and add `illnessLine,` to the `context` array (line 137-147, next to `readinessLine`).

- [ ] **Step 2: Health-insight (readiness section only).** In `app/api/ai/health-insight/route.ts`: import `latestIllnessFromDerived`; extend the `Promise.all` (line 61) with `repo.getOuraDailyDerived(userId, since7, date)` (destructure as `derivedRows`); inside the `section === 'readiness'` branch (line 70) compute `const latestIllness = latestIllnessFromDerived(derivedRows)` and append to `dataLines`:

```typescript
      latestIllness
        ? `Illness radar (vs personal baseline): ${latestIllness.flag} (score ${latestIllness.score}/100)`
        : 'Illness radar: no data',
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | grep "weekly-digest\|health-insight" || echo clean`
Expected: `clean` (both routes keep their existing try-catch around `generateText` — no parsing of model text anywhere, per the AI defaults rule).

```bash
git add app/api/weekly-digest/route.ts app/api/ai/health-insight/route.ts
git commit -m "Mention the illness radar in the weekly digest and readiness insight"
```

---

### Task 8: Home surfacing — advisory banner, zero new fetches

**Files:**
- Create: `components/home/illness-advisory-banner.tsx`
- Modify: `app/session-select/session-select-content.tsx`

The Home readiness response already carries `illnessFlag/illnessAdvisory/illnessSuppression` (`readiness` state, seeded from the `readiness-score` cache key and fetched once — verified). `session-select-content.tsx` is 1,358 lines, so the banner is its own component. It mirrors the `/health/readiness` advisory's structure (`health-score-detail.tsx:181-192`): Lucide icon + capitalized flag label + advisory text — state is never conveyed by colour alone, and the copy comes from the shared `illnessAdvisory()` via the API, never re-derived.

- [ ] **Step 1: Implement the component**

```tsx
// components/home/illness-advisory-banner.tsx
"use client";

import { memo } from "react";
import { Thermometer } from "lucide-react";
import type { ReadinessScoreResponse } from "@/app/api/readiness-score/route";

// Compact Home advisory for the illness radar. Renders only at elevated/fever —
// watch stays on the readiness detail page. Static status banner (not a nested
// control inside the chip row); tapping through lives on the Readiness chip beside it.
export const IllnessAdvisoryBanner = memo(function IllnessAdvisoryBanner({
  readiness,
}: {
  readiness: ReadinessScoreResponse;
}) {
  if (readiness.illnessFlag !== "elevated" && readiness.illnessFlag !== "fever") return null;
  if (!readiness.illnessAdvisory) return null;
  return (
    <div
      role="status"
      className="mx-4 mb-3 flex items-start gap-2.5 rounded-2xl border border-border bg-muted/60 px-3 py-2.5"
    >
      <Thermometer className="mt-0.5 h-4 w-4 shrink-0 text-foreground" aria-hidden />
      <div className="text-[12px] leading-snug text-foreground">
        <span className="font-semibold capitalize">{readiness.illnessFlag}</span>
        {readiness.illnessSuppression > 0 && (
          <span className="text-muted-foreground"> · readiness −{readiness.illnessSuppression}</span>
        )}
        <span className="block text-muted-foreground">{readiness.illnessAdvisory}</span>
      </div>
    </div>
  );
});
```

- [ ] **Step 2: Mount it.** In `app/session-select/session-select-content.tsx`, import `IllnessAdvisoryBanner` from `@/components/home/illness-advisory-banner`, and directly below the chip row (line 1017) add:

```tsx
        {/* ── Illness advisory (elevated/fever only — self-hides otherwise) ── */}
        {readiness && <IllnessAdvisoryBanner readiness={readiness} />}
```

`readiness` is a state object (stable between fetch resolutions) passed directly — the memo holds; no inline object/arrow props.

- [ ] **Step 3: Lint + typecheck + commit**

Run: `npx eslint components/home/illness-advisory-banner.tsx app/session-select/session-select-content.tsx && npx tsc --noEmit 2>&1 | head -5`
Expected: clean

```bash
git add components/home/illness-advisory-banner.tsx app/session-select/session-select-content.tsx
git commit -m "Surface elevated/fever illness advisory on Home"
```

---

### Task Final: Gate + dev-server smoke + version/docs

- [ ] **Step 1: Full gate**

Run: `pnpm lint && npx tsc --noEmit && pnpm test && pnpm build`
Expected: all green (DB integration tests run against the local Postgres).

- [ ] **Step 2: Dev-server smoke against the local DB** (`pnpm dev`, log in as `test@local.dev` / `testpass123`)

Seed a mature baseline plus a +4σ skin-temp night (the same shape the radar's original verification used — two `oura_daily_summary` rows are enough because the route reads the prior row's baseline and the latest row's values), and a persisted derived row for the decision layers (psql on port 5433, `trainingai_dev`; `:uid` = the test user's id):

```sql
-- Prior night: mature baseline (n_history 20). Baselines are ×8 fixed-point:
-- temp in centi-°C (34.20°C → 3420 → mean_x8 27360, dev 0.15°C → 15 → dev_x8 120),
-- RHR in bpm (55 → 440, dev 2 → 16), HRV in ms (45 → 360, dev 4 → 32).
INSERT INTO oura_daily_summary (user_id, date, hrv_avg_ms, rhr_low_bpm, temp_mean_c, n_history,
  temp_baseline_mean_x8, temp_baseline_dev_x8, rhr_baseline_mean_x8, rhr_baseline_dev_x8,
  hrv_baseline_mean_x8, hrv_baseline_dev_x8)
VALUES (:uid, CURRENT_DATE - 1, 45, 55, 34.20, 20, 27360, 120, 440, 16, 360, 32);
-- "Tonight": temp +4σ (34.80°C), RHR +3.5σ, HRV −3.75σ.
INSERT INTO oura_daily_summary (user_id, date, hrv_avg_ms, rhr_low_bpm, temp_mean_c, n_history,
  temp_baseline_mean_x8, temp_baseline_dev_x8, rhr_baseline_mean_x8, rhr_baseline_dev_x8,
  hrv_baseline_mean_x8, hrv_baseline_dev_x8)
VALUES (:uid, CURRENT_DATE, 30, 62, 34.80, 21, 27360, 120, 440, 16, 360, 32);
-- Persisted derived row (what signals/next-session/re-eval/chat/digest read):
INSERT INTO oura_daily_derived (user_id, day, illness_flag, illness_score, illness_biomarkers)
VALUES (:uid, CURRENT_DATE, 'fever', 90, '{"temperature":{"z":4,"contribution":50}}')
ON CONFLICT (user_id, day) DO UPDATE SET illness_flag = excluded.illness_flag,
  illness_score = excluded.illness_score, illness_biomarkers = excluded.illness_biomarkers;
```

Exact checks:
1. `GET /api/readiness-score` → `illnessFlag: "fever"`, `illnessAdvisory` non-null, `illnessSuppression: 25` (pre-existing behaviour — regression check).
2. Home (`/session-select`) at the S25 viewport (412×915) → the banner renders under the score chips with the Thermometer icon, "Fever" label, "readiness −25", and the advisory text; delete the derived+summary rows (or set flag `'normal'`) → banner gone.
3. `GET /api/workout-data?...` for an AI-dynamic session with an active accepted prescription generated on a *previous* day → every exercise comes back `deloaded: true` with note `Deload — illness radar: fever`; flip the derived row to `'normal'` (and clear `reevaluated_for_date` on the stored prescription) → next fetch restores the original sets/reps/pct. If the seeded DB has no AI-dynamic prescription in that state, note that this path is covered by the Task-5 unit tests instead and say so in the PR.
4. Next-session: `GET /api/next-session` (or the Home recommendation card) → `deloadOrRestRecommended: true`, `deloadStrength: "strong"` while the fever row exists.

**Not exercisable in the sandbox — state in the PR:**
- The Gemini-dependent surfaces (prescribe LLM call, chat completion, weekly digest, health-insight) — prompt/context *content* is unit-tested (Task 3) and the illness lines are string assembly verified by typecheck + the smoke's data seams, but no live model call runs without the API key.
- On-device rendering of the Home banner (Samsung WebView) — it's normal-flow content (no fixed positioning, no safe-area interaction), so web-viewport verification is the intended check; still eyeball it on the S25 at next opportunity. No Known-Issues row needed unless the device pass is skipped *and* something looks off at the web viewport.
- Real prod baselines (fresh local seed vs drifted prod data) — the radar itself has been live since 2026-07-15; this PR adds only readers of its persisted output.

- [ ] **Step 3: Version + changelog + journal + index**

Bump `package.json` **minor** (user-visible: Home banner, rest-day gating, chat/digest awareness). `lib/changelog.ts` entry (top of `CHANGELOG`): "The illness radar now reaches every decision layer: when your temperature, resting HR and HRV drift together against your baseline, the AI coach is told, the next-session recommendation deloads, an already-generated prescription automatically reduces load for the day (and restores itself when you recover), the chat and weekly digest can discuss it, and an advisory appears right on the Home screen at elevated/fever." Append the session note to the current `docs/overview/history-*.md`, update `projectOverview.md` (current status; strike/annotate the S3 row), and **remove this plan's backlog entry from `docs/implementation-backlog.md`** — all on this branch before merge.

- [ ] **Step 4: Push + PR**

```bash
git push -u origin feat/illness-signal-wiring
```

Standard change (no migration, no auth/security, no data-dropping anything) — merge on green per the CI/CD workflow once the smoke passes.

---

## Verification summary

- **Automated (sandbox):** `latestIllnessFromDerived` (4), prompt rendering + system rule (3), `computeDeloadStrength` illness cases (3), re-eval illness deload/restore/precedence (4) unit tests; full existing suites (radar, ai-dynamic, reevaluate, secondary-zone) still green; full gate.
- **Dev-server (sandbox):** readiness route regression, Home banner appear/disappear, next-session deload strength, workout-data re-eval where seedable.
- **Deferred:** live LLM calls; S25 WebView eyeball of the banner.

## Notes for the implementer

- **Never re-derive illness.** Everything reads the persisted flag through `latestIllnessFromDerived` or the readiness route's response. If you find yourself importing `computeIllnessRadar` outside `readiness-score`/the rollup, stop.
- `EmergencySignals` is a `Pick<PrescriptionSignals, ...>` that does **not** include `illness` — leave it that way (design decision 3).
- The `getOuraDailyDerived` fetches added here are all range reads on a one-row-per-day single-user table with a `(user_id, day)` key — negligible cost; do not add caching layers for them.
- Keep the prompt diff exactly as specified — additive lines only; do not restructure the recovery block or the rules list (plan-generation rule: small prompt changes).
- The repo moved fast this week (#570/#571/#575, Polar H10). If any line number above has drifted at implementation time, re-anchor by symbol name, not by re-designing.
