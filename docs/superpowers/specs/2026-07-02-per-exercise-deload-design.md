# Per-Exercise Deload — Design

**Date:** 2026-07-02
**Status:** Approved by user (session 179)
**Branch:** `claude/per-exercise-deload-l4b41b`

## Problem

Today, muscle-specific soreness is handled bluntly. When the mood-log check-in reports
sore glutes and today's session trains glutes, the AI prescription path can only respond
with `session_swap_recommended` or `rest_day_recommended` — all-or-nothing. A leg session
where five of six exercises hit fully-recovered muscles gets skipped or swapped because
one muscle group is sore.

The fix: deload **just the affected exercises** and run the rest of the session at full
strength. When soreness affects most of the session, offer a whole-session deload instead.

## Decisions (user-confirmed)

| Question | Decision |
|---|---|
| Trigger signal | Mood-log soreness only (`soreMusclesInSession` from `aggregateSignals`). The modeled `computeMuscleRecovery()` % is **not** a trigger — it already influences session choice upstream; double-counting risks over-deloading. |
| Adjustment | Deload-zone prescription — the same per-goal constants the emergency whole-session deload uses (`DELOAD_LOWER_PCT`, `DELOAD_REPS`, `DELOAD_SETS = 2`, `DELOAD_REST = 120`). "Deloaded" means the same thing at both scales. |
| Muscle role | Main-role assignments only. Secondary involvement (e.g. deadlift → glutes secondary) is ignored in v1; the module boundary leaves room for a "secondary → milder cut" tuning knob later. |
| Escalation | Deterministic count rule (below). No LLM judgement in the soreness path. |
| User control | Auto-applies within the normal prescription flow; badge + per-exercise undo ("Use full weights") on the pre-workout screen. |
| PRs | Sets logged under a per-exercise deload never update `personal_records` — extends the existing whole-session deload PR gate. |

## The escalation rule

Let `affected` = count of session exercises where any `soreMusclesInSession` entry
matches a **main-role** muscle assignment (matching via `moodMuscleMatches` +
`normalizeMuscle`, exactly as `signals.ts` does today). Let `n` = total exercises.

- **`affected === 0`** → nothing changes; normal prescription.
- **`affected × 2 ≤ n`** (half or fewer) → those exercises are deloaded in place;
  the rest of the session is prescribed at full strength.
- **`affected × 2 > n`** (more than half) → the route constructs a **whole-session
  deload offer**, reusing the emergency-deload prescription construction
  (`phase: 'deload'`, `phaseAction: 'deload_recommended'`, all exercises at deload
  values, `prescriptionStatus: 'pending'`). Offered, not imposed — the user accepts
  or declines via the existing respond flow, same as the emergency deload.

Degenerate case: a 1-exercise session with that exercise affected is `1 × 2 > 1` →
whole-session deload offer, which is the same thing anyway.

The `>50%` counting also uses main-role matches only, so sore glutes cannot push a
pull day into a whole-session deload via deadlift's secondary glute listing.

## Architecture

### New module: `lib/ai-periodization/per-exercise-deload.ts`

Pure function, sibling to `autoregulation.ts`:

```ts
computePerExerciseDeload(
  exercises: Array<{ sessionExerciseId: string; name: string;
    muscleAssignments: Array<{ muscle: string; role: 'main' | 'secondary' }> }>,
  soreMusclesInSession: string[],
  trainingGoal: string,
  phase: string,
): {
  outcome: 'none' | 'per_exercise' | 'whole_session'
  deloadedIds: Set<string>            // per_exercise outcome only
  notes: Record<string, string>       // e.g. "Deload — glutes still sore"
  override: { sets: number; reps: number; pct: number; restSec: number }
}
```

- Returns `outcome: 'none'` (no-op) when `soreMusclesInSession` is empty, or when
  `phase === 'deload'` — the whole session is already deloaded.
- The per-goal deload constants move out of the prescribe route into a shared
  constants module (imported by the emergency deload path and this one — one
  formula, one place; the route currently owns `DELOAD_LOWER_PCT` etc. privately).

### Prescribe route (`app/api/ai-periodization/session/[sessionId]/prescribe/route.ts`)

Order of operations:

1. `aggregateSignals` (unchanged — already produces `soreMusclesInSession` and
   per-exercise `muscleAssignments`).
2. Emergency deload check (unchanged, runs first; if it fires, per-exercise deload
   is skipped — the whole session is already deloaded).
3. `computePerExerciseDeload(...)`:
   - **`whole_session`** → build the whole-session deload prescription (same
     construction as the emergency path — extract a shared helper), store as
     `pending`, return. Reasoning states which muscles are sore. No LLM call.
   - **`per_exercise`** → continue to the LLM with prompt awareness (below).
   - **`none`** → continue unchanged.
4. LLM call. `buildUserPrompt` gains a line when per-exercise deloads fired:
   *"These exercises will be auto-deloaded due to muscle soreness: X, Y. Prescribe
   the session normally and do NOT recommend a rest day or session swap for this
   soreness alone."*
5. After parsing, deterministically **overwrite** the deloaded exercises'
   `sets/reps/pct/rest_sec` with the deload override, capturing the LLM's original
   values into `preDeload` first. The LLM cannot fight the override.
6. Autoregulation: deloaded exercises are **excluded** — their signals are filtered
   out before `applyAutoregulation` (deload wins; mirrors the existing
   `phase === 'deload'` no-op).
7. `clampPrescribedPct` / phase-zone floors: deloaded exercises are **exempt** —
   otherwise the accumulation zone floor (~65%) silently clamps the ~52% deload away.
8. Time budget (`fitToBudget`) and `weeklyVolumeContribution`: unchanged — they
   compute from final sets, which is correct.

### Data model — no DB migration

`AiPrescriptionExercise` (`lib/types/ai-periodization.ts`) gains optional fields:

```ts
deloaded?: boolean
deloadNote?: string       // "Deload — glutes still sore" (distinct from autoregNote)
preDeload?: { sets: number; reps: number; pct: number; restSec: number }
```

These live inside the prescription JSON already stored by `storePrescription` —
no schema/migration work, no sync-domain changes.

### PR gating (`lib/workout/log-exercise.ts`)

- `LogExercisePayloadSchema` gains `exerciseDeloaded: z.boolean().optional()`.
- The existing PR gate (`if (estimated1rm > 0 && (!isAnyDeload || isBaseline))`)
  additionally skips the `upsertPersonalRecordIfBetter` call when
  `exerciseDeloaded === true`.
- The estimated 1RM is still computed and stored on the exercise log (matching
  whole-session deload behaviour today) — it just never touches `personal_records`,
  so `rm1Trend`, PR celebrations, and the all-time PR table stay clean.
- The client sends `exerciseDeloaded` from the prescription's per-exercise flag;
  reverting to full weights clears it, so an overridden exercise counts for PRs
  again. If the offline outbox path (`pushMutations` workout-log branch) is active,
  it must carry the same field — verify during implementation (sync-mirror rule).

## UI

### Pre-workout exercise list
- Affected exercises get an amber chip (theme tokens, no hex literals; Lucide
  `BatteryLow` icon): **"Deload — glutes sore"**. Visually distinct from the
  full-width session-level deload banner.
- The chip is a real control (`<div role="button">` if nested inside a tappable
  card, per the WebView rule). Tapping opens a small sheet (existing Sheet
  primitive) showing:
  - the `deloadNote`,
  - deloaded vs original prescription side by side (from `preDeload`),
  - a **"Use full weights"** button.

### Undo ("Use full weights")
- Reverting swaps the `preDeload` values back in for that exercise, clears the
  `deloaded` flag client-side, and is held in the persisted workout store keyed by
  `(local date, session id)` — no server round-trip, works offline, and follows the
  Zustand rules (daily state keyed by date+session, reset on rehydration rollover).
- The log payload then omits/false `exerciseDeloaded`, restoring PR eligibility.

### Recommendation card
- When per-exercise deloads fired, the reasoning line includes e.g.
  *"Deloading Squats & Hip Thrusts — glutes still sore."*
- The whole-session offer (>50% path) renders through the existing pending-deload
  card flow — no new UI.

## Testing

Unit tests (`lib/__tests__/per-exercise-deload.test.ts`):
- Threshold boundaries: 3/6 → per-exercise, 4/6 → whole-session, 1/6 → per-exercise,
  1/1 → whole-session, 0 sore → none.
- Main-role matching only (secondary assignment does not trigger or count).
- Muscle-name matching through `moodMuscleMatches`/`normalizeMuscle` (mood-log
  names vs library names).
- `phase === 'deload'` → none.
- Note text present for each deloaded id.

Route-level assertions (existing test patterns):
- Deloaded exercises excluded from autoregulation and exempt from pct clamping.
- PR gate: `exerciseDeloaded: true` → no `upsertPersonalRecordIfBetter` call;
  reverted exercise → PR path intact.

Runtime pass: local `pnpm dev`, seed a mood log with sore muscles matching a subset
of a session's exercises, hit the prescribe route, verify the per-exercise override
and the >50% whole-session offer.

**Not exercisable in the sandbox:** real Gemini output variance (prompt-injection
resistance of step 5 is deterministic, so low risk), and on-device APK rendering of
the new chip/sheet — both need a device check after deploy.

## Out of scope (explicitly)

- Secondary-muscle milder cuts (tuning knob for later).
- Using `computeMuscleRecovery()` % as a trigger.
- Exercise swap suggestions (separate planned feature — Batch I injury-swap sheet).
- Any change to the emergency deload trigger conditions.
