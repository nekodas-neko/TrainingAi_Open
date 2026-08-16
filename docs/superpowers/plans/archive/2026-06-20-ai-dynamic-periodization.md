# AI Dynamic Periodization — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-06-20-ai-dynamic-periodization-design.md`
**Branch:** `claude/dynamic-ai-workout-plans-m8p99y`
**Migration:** 079

This plan is organised into 5 tiers. Each tier is independently deployable to `main` and adds working, testable value without requiring the next tier to be complete. Tiers must be executed in order — each tier's DB and API changes are prerequisites for the next.

---

## Tier 1 — Data Foundation
*Deploy target: standalone. Adds DB schema, migrates `workout_sessions`, wires `program_session_id` through the workout completion flow. No AI, no UI changes. Everything in Tier 2+ depends on this.*

### T1-1: Migration 079

**File:** `lib/data/postgres/migrations/079_ai_dynamic_periodization.sql`

```sql
-- 1. Program-level training goal and AI settings
ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS training_goal TEXT NOT NULL DEFAULT 'strength',
  ADD COLUMN IF NOT EXISTS auto_apply_prescriptions BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Session time budget
ALTER TABLE program_sessions
  ADD COLUMN IF NOT EXISTS time_budget_minutes INTEGER NOT NULL DEFAULT 60;

-- 3. Link completed workouts to program sessions (critical for prescribe trigger)
ALTER TABLE workout_sessions
  ADD COLUMN IF NOT EXISTS program_session_id UUID REFERENCES program_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_workout_sessions_program_session_id
  ON workout_sessions(program_session_id);

-- 4. Per session-type phase state and prescription
CREATE TABLE IF NOT EXISTS session_periodization (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_session_id            UUID NOT NULL REFERENCES program_sessions(id) ON DELETE CASCADE,
  phase                         TEXT NOT NULL DEFAULT 'baseline',
  phase_started_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sessions_in_phase             INTEGER NOT NULL DEFAULT 0,
  baseline_complete             BOOLEAN NOT NULL DEFAULT FALSE,
  baseline_1rm                  JSONB NOT NULL DEFAULT '{}',
  prescription                  JSONB,
  prescription_generated_at     TIMESTAMPTZ,
  prescription_expires_at       TIMESTAMPTZ,
  prescription_status           TEXT NOT NULL DEFAULT 'none',
  last_session_ran_prescription BOOLEAN,
  pending_transition            JSONB,
  pre_emergency_deload_phase    TEXT,
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, program_session_id)
);

CREATE INDEX IF NOT EXISTS idx_session_periodization_user_session
  ON session_periodization(user_id, program_session_id);

-- 5. Weekly volume targets per program per muscle group
CREATE TABLE IF NOT EXISTS program_volume_targets (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id           UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  muscle_group         TEXT NOT NULL,
  target_sets_per_week INTEGER NOT NULL,
  UNIQUE(program_id, muscle_group)
);
```

Apply and verify:
```bash
psql "$DATABASE_URL" -f lib/data/postgres/migrations/079_ai_dynamic_periodization.sql
psql "$DATABASE_URL" -c "\d session_periodization"
psql "$DATABASE_URL" -c "\d program_volume_targets"
psql "$DATABASE_URL" -c "\d workout_sessions" | grep program_session
```

### T1-2: Drizzle Schema

**File:** `lib/data/postgres/schema.ts`

Add to the `programs` table definition: `trainingGoal` and `autoApplyPrescriptions` columns.

Add to `programSessions`: `timeBudgetMinutes`.

Add to `workoutSessions`: `programSessionId` nullable FK.

Add new table exports: `sessionPeriodization`, `programVolumeTargets`.

Import `jsonb` from `drizzle-orm/pg-core` if not present.

### T1-3: Wire `program_session_id` through workout completion

**File:** `app/api/log-exercise/route.ts` (or whichever route calls `completeWorkoutSession`)

When a workout session is completed, the request must include the `programSessionId`. Find where `completeWorkoutSession` is called and add `programSessionId` to the payload. The client already knows which session it's running (it's in `workout-store`'s session state).

In `lib/stores/workout-store.ts`: confirm `programSessionId` is stored alongside `sessionType` in the workout state. If only the session name is stored, add `programSessionId: string | null` to the store and populate it when the workout is started (from the workout-data API response which returns session config).

In `app/api/workout-data/route.ts`: confirm the response includes `sessionId` (the `program_sessions.id`). If not, add it.

In `lib/data/repository.ts`: add `programSessionId?: string` to the `completeWorkoutSession` signature.

In `lib/data/postgres/adapter.ts`: write `program_session_id` to `workout_sessions` when completing.

### T1-4: Repository interface additions

**File:** `lib/data/repository.ts`

Add types and method signatures:

```ts
export type PeriodizationPhase =
  | 'baseline' | 'accumulation' | 'intensification' | 'realisation' | 'deload'

export type TrainingGoal = 'strength' | 'hypertrophy' | 'power' | 'endurance'

export interface Baseline1rmEntry {
  kg: number
  source: 'amrap' | 'personal_record'
}

export interface SessionPeriodization {
  id: string
  userId: string
  programSessionId: string
  phase: PeriodizationPhase
  phaseStartedAt: Date
  sessionsInPhase: number
  baselineComplete: boolean
  baseline1rm: Record<string, Baseline1rmEntry>  // session_exercise_id (UUID) → { kg, source }
  prescription: AiPrescription | null
  prescriptionGeneratedAt: Date | null
  prescriptionExpiresAt: Date | null
  prescriptionStatus: 'none' | 'pending' | 'accepted' | 'auto_applied' | 'dismissed' | 'consumed'
  lastSessionRanPrescription: boolean | null
  pendingTransition: PendingTransition | null
  preEmergencyDeloadPhase: PeriodizationPhase | null
  updatedAt: Date
}

export interface AiPrescription {
  phase: PeriodizationPhase
  phaseAction: 'stay' | 'transition_recommended' | 'deload_recommended'
  exercises: Array<{
    name: string
    sets: number
    reps: number
    pct: number
    restSec: number
  }>
  estimatedSessionDurationMin: number
  weeklyVolumeContribution: Record<string, number>
  deload: boolean
  reasoning: string
  confidence: number
}

export interface PendingTransition {
  newPhase: PeriodizationPhase
  reasoning: string
  urgency: 'low' | 'medium' | 'high'
}

// Methods to add to Repository interface:
getSessionPeriodization(userId: string, programSessionId: string): Promise<SessionPeriodization | null>
upsertSessionPeriodization(userId: string, programSessionId: string, patch: Partial<Omit<SessionPeriodization, 'id' | 'userId' | 'programSessionId' | 'updatedAt'>>): Promise<SessionPeriodization>
listSessionPeriodizationForProgram(userId: string, programId: string): Promise<SessionPeriodization[]>
getVolumeTargets(programId: string): Promise<Array<{ muscleGroup: string; targetSetsPerWeek: number }>>
upsertVolumeTarget(programId: string, muscleGroup: string, targetSetsPerWeek: number): Promise<void>
deleteVolumeTarget(programId: string, muscleGroup: string): Promise<void>
getWeeklySetsByMuscleGroup(userId: string, programId: string, weekStart: string, weekEnd: string): Promise<Record<string, number>>
```

### T1-5: Adapter implementation

**File:** `lib/data/postgres/adapter.ts`

Implement all methods from T1-4. Key query for weekly sets by muscle group (role-weighted: main=1.0, secondary=0.5):

```sql
SELECT
  m.muscle                                          AS muscle_group,
  SUM(CASE WHEN m.role = 'main' THEN 1.0 ELSE 0.5 END) AS set_count
FROM set_logs sl
JOIN exercise_logs el   ON el.id = sl.exercise_log_id
JOIN workout_sessions ws ON ws.id = el.workout_session_id
JOIN exercise_library lib ON lib.name = el.exercise_name
CROSS JOIN LATERAL jsonb_to_recordset(lib.muscles)
  AS m(role text, muscle text)
WHERE ws.user_id = $userId
  AND ws.started_at >= $weekStart
  AND ws.started_at < $weekEnd
  AND ws.program_session_id IN (
    SELECT id FROM program_sessions WHERE program_id = $programId
  )
GROUP BY m.muscle
```

If an exercise has no `exercise_library` entry, fall back to counting all muscles from `session_exercises.muscle_groups` at 1.0 each (full credit — missing library data is not penalised).

### T1-6: TypeScript compile check

```bash
pnpm tsc --noEmit 2>&1 | grep -E "periodization|session_peri|volume_target" | head -20
```

Expected: no errors on the new files.

### T1-7: Commit

```
git add lib/data/postgres/migrations/079_ai_dynamic_periodization.sql \
        lib/data/postgres/schema.ts \
        lib/data/repository.ts \
        lib/data/postgres/adapter.ts \
        lib/stores/workout-store.ts \
        app/api/workout-data/route.ts \
        app/api/log-exercise/route.ts
git commit -m "Tier 1: DB foundation for AI dynamic periodization

Adds session_periodization and program_volume_targets tables, wires
program_session_id through workout completion, adds repository interface
and adapter methods for phase state and volume tracking."
git push
```

---

## Tier 2 — Signal Aggregator + AI Engine
*Deploy target: standalone (no UI). The engine can be tested via direct API calls. Adds the signal aggregator, AI prompt builder, and the prescribe + baseline-complete routes. Depends on Tier 1.*

### T2-1: Signal aggregator

**File:** `lib/ai-periodization/signals.ts` (new directory)

Pure TypeScript module — no React, no routes. Takes `userId`, `programSessionId`, `repo`, `tz` and returns a `PrescriptionSignals` object with all the data the AI needs.

Key computed fields:
- `consecutiveSessionDaysOfThisType` — days in a row this session type was trained
- `hoursSinceLastSession` — null if never trained
- `rpeTrend` — avg actual RPE vs expected RPE (mapping: ≥92.5%→10, ≥87.5%→9, ≥80%→8, ≥70%→7, else 6) across last 3 sessions of this type. Null if `sessions_in_phase === 0` or no RPE data.
- `repCompletionRate` — null if `lastSessionRanPrescription === false` or `sessions_in_phase === 0`
- `oneRmTrend` per exercise — `{ exerciseName, baseline1rm, current1rm, direction, changeKg }`
- `volumeBudgetPerMuscleGroup` — the `sets_budget_for_this_session` formula from the spec
- `effectiveTimeBudgetMin` — `timeBudgetMinutes - 10`
- `avgSetDurationSecPerExercise` — map of exercise → avg from `set_logs.set_time_sec`, default 45
- `generalSoreness` — most recent `mood_logs` soreness score within 48h, null if none
- `acwr` — null if < 28 days history
- `sleepTrend` — null if < 4 nights data
- `hrvTrend` — null if < 4 days data
- `confidenceTier` — 1 (RPE + consecutive days only), 2 (+ 1RM trend + soreness), 3 (+ ACWR + sleep/HRV)

### T2-2: AI prompt builder

**File:** `lib/ai-periodization/prompt.ts`

Two functions:
- `buildSystemPrompt(goal: TrainingGoal)` — encodes phase parameters for the goal zone (the tables from the spec), transition rules, output format requirements, and the "no markdown, JSON only" constraint.
- `buildUserPrompt(signals: PrescriptionSignals, state: SessionPeriodization, exercises: SessionExercise[], today: string)` — formats all signals into the user turn. Includes effective time budget, volume budgets per muscle group, exercise list with avg set durations (for the AI to know what fits), and the current phase context.

The system prompt must include the server-computed `avg_set_duration_sec` per exercise and the `effective_time_budget` so the AI can self-constrain its prescription. The AI does NOT compute duration — it just picks `sets` and `rest_sec` that fit within the communicated budget.

### T2-3: Baseline complete route

**File:** `app/api/ai-periodization/baseline/complete/route.ts`

```
POST /api/ai-periodization/baseline/complete
Body: { sessionId: string, amrapResults: [{ exerciseName: string, weightKg: number, reps: number }] }
```

Logic:
1. Auth check
2. Load `session_periodization` — verify `phase === 'baseline'`
3. For each AMRAP result: validate reps against goal-dependent cap (strength/power > 15 → reject, hypertrophy/endurance > 25 → reject), compute Brzycki 1RM, upsert `personal_records`
4. Build `baseline_1rm` map from results
5. `upsertSessionPeriodization`: `{ phase: 'accumulation', baselineComplete: true, baseline1rm, sessionsInPhase: 0, phaseStartedAt: new Date() }`
6. Trigger prescription generation (call T2-4 internally)
7. Return `{ baseline1rm, prescription }`

### T2-4: Prescribe route

**File:** `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts`

```
POST /api/ai-periodization/session/[sessionId]/prescribe
```

`sessionId` is `program_sessions.id`.

Logic:
1. Auth check
2. Load session state, program (goal, auto_apply_prescriptions), exercises, schedule
3. Call `aggregateSignals(userId, sessionId, repo, tz)`
4. Check emergency deload conditions server-side (before AI call) — if triggered, short-circuit with a deload prescription without calling AI. This is deterministic and fast.
5. Build prompts, call Gemini `generateText`
6. Parse and validate AI JSON output (zod schema)
7. Server computes `estimatedSessionDurationMin` from `sets`, `rest_sec`, `avgSetDurationSec` per exercise — replaces any duration the AI may have included
8. If `confidence < 0.6`: force `prescriptionStatus = 'pending'` regardless of `auto_apply_prescriptions`
9. If `auto_apply_prescriptions` and `phase_action === 'stay'` and `confidence >= 0.6`: set `prescriptionStatus = 'auto_applied'`
10. Otherwise: set `prescriptionStatus = 'pending'`
11. Upsert `session_periodization.prescription` and status
12. Return the saved prescription

`maxDuration = 30` (Gemini call).

### T2-5: Session status route

**File:** `app/api/ai-periodization/session/[sessionId]/route.ts`

```
GET /api/ai-periodization/session/[sessionId]
```

Returns `{ state: SessionPeriodization, signals: PrescriptionSignals }` — used by pre-workout screen and Health tab card. Signals are included so the UI can show RPE trend, volume progress, etc. without a second call.

### T2-6: Weekly volume route

**File:** `app/api/ai-periodization/weekly-volume/route.ts`

```
GET /api/ai-periodization/weekly-volume?programId=...
```

Returns `{ targets: Record<string, number>, logged: Record<string, number>, sessions: SessionVolumePlan[] }` where `SessionVolumePlan` is per session type: which muscle groups it trains and the `sets_budget` for each.

### T2-7: Hook prescribe into workout completion

**File:** wherever `completeWorkoutSession` is called (likely `app/api/log-exercise/route.ts`)

After completing the workout, fire-and-forget (don't await in the response path) a call to generate the next prescription:

```ts
// Non-blocking — prescription generated in background after session completes
if (programSessionId) {
  fetch(`/api/ai-periodization/session/${programSessionId}/prescribe`, {
    method: 'POST',
    headers: { Cookie: req.headers.get('Cookie') ?? '' },
  }).catch(() => { /* silent — user will trigger on pre-workout load */ })
}
```

Also increment `sessions_in_phase` here:
```ts
await repo.upsertSessionPeriodization(userId, programSessionId, {
  sessionsInPhase: (currentState?.sessionsInPhase ?? 0) + 1,
  lastSessionRanPrescription: usedPrescription,  // passed from client
})
```

### T2-8: TypeScript + smoke test

```bash
pnpm tsc --noEmit 2>&1 | grep "ai-periodization\|signals\|prompt" | head -20
pnpm dev &
# After starting a session that's in baseline, complete it with mock AMRAP results:
curl -s -X POST http://localhost:3000/api/ai-periodization/baseline/complete \
  -H "Content-Type: application/json" \
  -H "Cookie: <session-cookie>" \
  -d '{"sessionId":"<programSessionId>","amrapResults":[{"exerciseName":"Squat","weightKg":80,"reps":6}]}' | jq .
```

Expected: returns `{ baseline1rm: { Squat: 97.3 }, prescription: { phase: "accumulation", exercises: [...] } }`

### T2-9: Commit

```
git commit -m "Tier 2: Signal aggregator and AI prescription engine

Adds lib/ai-periodization/signals.ts and prompt.ts, prescribe and
baseline-complete API routes, weekly volume endpoint, and hooks
prescription generation into workout completion."
git push
```

---

## Tier 3 — Pre-Workout UI + Prescription Accept/Dismiss
*Deploy target: standalone. Users can now see and act on AI prescriptions before workouts. Depends on Tier 2.*

### T3-1: Prescription respond route

**File:** `app/api/ai-periodization/session/[sessionId]/respond/route.ts`

```
PATCH /api/ai-periodization/session/[sessionId]/respond
Body: { action: 'accept' | 'dismiss' }
```

- `accept`: set `prescription_status = 'accepted'`
- `dismiss`: set `prescription_status = 'dismissed'`

When accepted, the client will have the full prescription object and can apply it to the workout store locally — no server round-trip needed for the weight targets.

### T3-2: Prescription card component

**File:** `components/workout/ai-prescription-card.tsx` (new)

Displayed on the pre-workout screen when `prescriptionStatus` is `'pending'` or `'auto_applied'`.

Props:
```ts
{
  prescription: AiPrescription
  status: 'pending' | 'auto_applied'
  onAccept: () => void
  onDismiss: () => void
  loading: boolean
}
```

Shows:
- Phase badge (colour-coded: accumulation=green, intensification=orange, realisation=red, deload=purple)
- Estimated session duration: "~54 min"
- Per-exercise summary rows: "Squat · 4×8 · 72.5%"
- Reasoning text (collapsed by default, expandable)
- Accept / Dismiss buttons (hidden in auto_applied mode, replaced with "AI adjusted" badge)
- Confidence tier indicator if tier < 2 ("Limited data — early estimate")

### T3-3: Baseline banner component

**File:** `components/workout/baseline-banner.tsx` (new)

Shown on pre-workout screen when `phase === 'baseline'`. Explains the AMRAP protocol in plain language. Shows per-exercise warm-up weights (40% and 55% of estimated 1RM from `personal_records` or a conservative default).

### T3-4: Pre-workout screen integration

**File:** `components/workout/pre-workout-screen.tsx`

At the top of the screen, before the exercise list:

```tsx
// Fetch session periodization state
const { data: periodization } = usePeriodizationSession(sessionId)

// Baseline mode
if (periodization?.state.phase === 'baseline') {
  return <BaselineBanner ... />
}

// Prescription pending
if (periodization?.state.prescriptionStatus === 'pending') {
  return <AiPrescriptionCard prescription={...} onAccept={handleAccept} onDismiss={handleDismiss} />
}
```

When the user accepts: call the respond route, apply the prescription to the workout store (overwrite `setWeights`, `reps`, `sets` for each exercise), show the session duration estimate.

Add a mini volume bar at the header level: "Quads 7/15 · Hamstrings 4/10" — fetched from `/api/ai-periodization/weekly-volume`.

### T3-5: AMRAP set card mode

**File:** `components/workout/set-card.tsx`

When `isAmrapSet === true` (new prop):
- Rep counter shows "MAX" instead of the programmed rep target
- No rep target indicator / no rep increment buttons
- After logging: triggers 1RM calculation display inline

**File:** `components/workout-screen.tsx`

During a baseline session, mark the 3rd set of each exercise as AMRAP. Pass `isAmrapSet` prop through to `SetCard`. After the AMRAP set is logged, call `baseline/complete` with the accumulated `amrapResults` once all exercises are done.

### T3-6: Workout store — AI prescription state

**File:** `lib/stores/workout-store.ts`

Add:
```ts
activePrescription: AiPrescription | null
prescriptionApplied: boolean
setActivePrescription: (p: AiPrescription | null) => void
applyPrescription: () => void  // overwrites per-set weights/reps from prescription
```

When `applyPrescription` is called:
- For each exercise in the prescription, set `reps` and compute `targetWeight = baseline1rm[exercise] * pct / 100` rounded to nearest 0.25kg
- Store `prescriptionApplied = true` so the workout completion handler can pass `lastSessionRanPrescription: true`

### T3-7: Test end-to-end on dev server

```bash
pnpm dev
```

1. Create a new program — confirm the Training Goal selector appears
2. Start first session — baseline banner should appear
3. Complete AMRAP sets — 1RM confirmation should appear after the final set
4. Open the same session again — prescription card should appear with accumulation prescription
5. Accept — prescription weights should be applied to the exercise list
6. Dismiss — style defaults should be used
7. Check weekly volume bar appears in pre-workout header

### T3-8: Commit

```
git commit -m "Tier 3: Pre-workout prescription UI and AMRAP baseline mode

Adds prescription card, baseline banner, AMRAP set card mode, respond
route, and wires prescription acceptance through workout store."
git push
```

---

## Tier 4 — Phase Transitions + Health Tab
*Deploy target: standalone. Adds phase transition accept/reject, the full Health tab periodization cards, and weekly volume visualisation. Depends on Tier 3.*

### T4-1: Phase transition route

**File:** `app/api/ai-periodization/session/[sessionId]/transition/route.ts`

```
PATCH /api/ai-periodization/session/[sessionId]/transition
Body: { action: 'accept' | 'reject' }
```

On accept:
```ts
await repo.upsertSessionPeriodization(userId, sessionId, {
  phase: transition.newPhase,
  phaseStartedAt: new Date(),
  sessionsInPhase: 0,
  pendingTransition: null,
})
// If newPhase === 'deload', also set: preEmergencyDeloadPhase to the current phase
// If newPhase !== 'deload', clear preEmergencyDeloadPhase
```

On reject: just clear `pending_transition`, keep current phase.

### T4-2: Health tab — per-session periodization cards

**File:** `components/health/session-periodization-card.tsx` (new)

One card per session type in the active program. Replace the existing whole-program card from the June 18 plan (if it exists) or add fresh to the Training tab.

Shows per-session-type:
- Session name + phase badge (colour per phase)
- `sessions_in_phase` count
- RPE trend delta ("+0.3 above expected" in amber if > 0.5)
- Next prescription summary if available ("Next: 4×8 @ 72.5%")
- Pending phase transition inline: "AI suggests → Intensification" + Accept / Reject buttons
- Confidence tier chip

**File:** `app/health/health-content.tsx`

In the Training tab: render one `<SessionPeriodizationCard>` per session in the active program. Cards are returned from a single call to `listSessionPeriodizationForProgram`.

### T4-3: Weekly volume visualisation

**File:** `components/health/weekly-volume-card.tsx` (new)

Progress bars per muscle group: `{logged} / {target} sets this week`. Colour: green if ≥ 80% of target, amber if 50–79%, red if < 50% at end of week. Include a note if the muscle group isn't scheduled for any more sessions this week (can't hit target).

Add to Training tab after the session periodization cards.

### T4-4: Program config — new fields

**File:** wherever the program creation/edit screen lives (likely `components/workout-config/` or `app/config/`)

Add:
1. **Training goal selector** — Strength / Hypertrophy / Power / Endurance — pill buttons, shown prominently near the top of program config. Default: Strength.
2. **Session time budget** — per session type. Stepper (`-5 / +5`) or slider, range 30–120 min, default 60. Placed inline with each session's config row.
3. **Weekly volume targets** — expandable section. Pre-populate with goal-appropriate defaults when training goal is selected:
   - Strength → major groups: 12 sets/week, minor groups: 8 sets/week
   - Hypertrophy → major groups: 18 sets/week, minor groups: 10 sets/week
   - Power → major groups: 10 sets/week, minor groups: 6 sets/week
   - Endurance → major groups: 20+ sets/week
   User can adjust each muscle group individually.
4. **AI prescription mode** — toggle at program level: "Review before applying" (default) / "Auto-apply"

### T4-5: Commit

```
git commit -m "Tier 4: Phase transitions, Health tab cards, program config AI settings

Adds transition accept/reject route, per-session periodization cards in
Health tab, weekly volume visualisation, and program config fields for
training goal, time budget, volume targets, and auto-apply mode."
git push
```

---

## Tier 5 — Hardening + Edge Cases
*Deploy target: standalone. Addresses all edge cases from the spec review. No new UI surface — these are guard rails and correctness fixes. Depends on Tier 4.*

### T5-1: Prescription expiry enforcement

In the pre-workout screen load (`/api/ai-periodization/session/[sessionId]` GET):

```ts
const state = await repo.getSessionPeriodization(userId, sessionId)
const isExpired = state?.prescriptionExpiresAt
  && new Date() > new Date(state.prescriptionExpiresAt)

if (isExpired && state?.prescriptionStatus === 'pending') {
  // Regenerate synchronously on this request (user is waiting at pre-workout screen)
  await generatePrescription(userId, sessionId, repo, tz)
}
```

### T5-2: Low-confidence prescription forced-confirm

In the prescribe route (T2-4), ensure this guard is applied AFTER saving:

```ts
const forceConfirm = prescription.confidence < 0.6
if (forceConfirm && prescriptionStatus === 'auto_applied') {
  prescriptionStatus = 'pending'  // downgrade to pending regardless of auto_apply setting
}
```

The prescription card should show "Limited data — confidence low" when `confidence < 0.6`.

### T5-3: Exercise swap mid-program handling

When a session's exercise list changes between sessions (detected by comparing current `session_exercises` UUIDs against the keys in `baseline_1rm`):

```ts
const currentExerciseIds = new Set(sessionExercises.map(e => e.id))
const baselineIds = new Set(Object.keys(state.baseline1rm))

// Exercises removed from session
const removedIds = [...baselineIds].filter(id => !currentExerciseIds.has(id))
// New exercises with no baseline
const newIds = [...currentExerciseIds].filter(id => !baselineIds.has(id))
```

For each new exercise ID:
1. Check `personal_records` for this exercise name — if found, write `{ kg: pr.estimated1rm, source: "personal_record" }` into `baseline_1rm` and proceed with normal prescription
2. If no `personal_records` — flag as `needsStartingWeight: true`, prompt user on pre-workout screen to enter an estimated weight, run mini-baseline (warm-up A + B + AMRAP) for that exercise in the next session while other exercises run normally
3. Remove stale IDs from `baseline_1rm` (these are the exercises that were swapped out)

Mini-baseline results for swapped exercises are merged into `baseline_1rm` via the `baseline/complete` route, which is extended to accept `{ sessionId, amrapResults: [...], partial: true }` — `partial: true` means only update the specified exercises, don't advance the phase or regenerate the full prescription.

### T5-4: Rotation schedule volume distribution

In `aggregateSignals`, when computing `sets_budget_for_this_session` for rotation schedules:

```ts
const scheduleType = schedule.type  // 'rotation' | 'weekly'

if (scheduleType === 'rotation') {
  // Count occurrences of sessions that train this muscle group
  // within the next full rotation cycle
  const sessionsInCycle = getSessionsTrainingMuscleGroup(muscleGroup, program.sessionsPerCycle)
  setsBudget = Math.ceil(target / sessionsInCycle)
} else {
  // Calendar week formula (existing)
}
```

### T5-5: Accumulation ceiling enforcement

In the prescribe route, before calling AI:

```ts
if (
  state.phase === 'accumulation' &&
  state.sessionsInPhase >= 10 &&
  transitionConditionsMet(signals)  // helper that checks RPE, 1RM etc.
) {
  // Override phase_action to 'transition_recommended' with urgency 'high'
  // and include it in the prescription even if AI says 'stay'
  forceTransitionRecommendation = true
}
```

### T5-6: Emergency deload formal phase entry

When emergency deload triggers (T2-4 server-side check before AI call):

```ts
await repo.upsertSessionPeriodization(userId, sessionId, {
  preEmergencyDeloadPhase: state.phase,  // save where we were
  phase: 'deload',
  phaseStartedAt: new Date(),
  sessionsInPhase: 0,
})
```

After deload, `Deload → return` goes to `preEmergencyDeloadPhase` (not always accumulation):

```ts
const returnPhase = state.preEmergencyDeloadPhase ?? 'accumulation'
// Apply min sessions: 1 for emergency, 2 for planned
```

### T5-7: Final smoke test — all tiers

```bash
pnpm dev
```

Checklist:
- [ ] New program → Training Goal selector visible, defaults to Strength
- [ ] Session time budget configurable per session
- [ ] Weekly volume targets editable with goal-appropriate defaults
- [ ] First session of new program shows baseline banner + AMRAP protocol
- [ ] AMRAP result → 1RM calculated and shown, phase advances to accumulation
- [ ] Second session → prescription card appears with accumulation prescription
- [ ] Prescription accepted → weights/reps updated in workout screen
- [ ] Session completed → prescription for next session generated in background
- [ ] Health > Training tab shows per-session phase cards
- [ ] Weekly volume bars visible with targets and logged counts
- [ ] Phase transition recommendation appears after 4+ accumulation sessions (with seeded data)
- [ ] Dismissing prescription → style defaults used, `lastSessionRanPrescription = false`
- [ ] `pnpm tsc --noEmit` passes with no errors

### T5-8: Commit

```
git commit -m "Tier 5: Edge case hardening for AI periodization

Prescription expiry enforcement, low-confidence forced-confirm, new
exercise mini-baseline, rotation schedule volume distribution,
accumulation ceiling, and formal emergency deload phase entry."
git push
```

---

## File Map (all tiers)

| File | Tier | Action |
|---|---|---|
| `lib/data/postgres/migrations/079_ai_dynamic_periodization.sql` | T1 | Create |
| `lib/data/postgres/schema.ts` | T1 | Modify |
| `lib/data/repository.ts` | T1 | Modify |
| `lib/data/postgres/adapter.ts` | T1 | Modify |
| `lib/stores/workout-store.ts` | T1, T3 | Modify |
| `app/api/workout-data/route.ts` | T1 | Modify (add sessionId to response) |
| `app/api/log-exercise/route.ts` | T1, T2 | Modify |
| `lib/ai-periodization/signals.ts` | T2 | Create |
| `lib/ai-periodization/prompt.ts` | T2 | Create |
| `app/api/ai-periodization/baseline/complete/route.ts` | T2 | Create |
| `app/api/ai-periodization/session/[sessionId]/route.ts` | T2 | Create |
| `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts` | T2 | Create |
| `app/api/ai-periodization/weekly-volume/route.ts` | T2 | Create |
| `app/api/ai-periodization/session/[sessionId]/respond/route.ts` | T3 | Create |
| `components/workout/ai-prescription-card.tsx` | T3 | Create |
| `components/workout/baseline-banner.tsx` | T3 | Create |
| `components/workout/pre-workout-screen.tsx` | T3 | Modify |
| `components/workout/set-card.tsx` | T3 | Modify |
| `components/workout-screen.tsx` | T3 | Modify |
| `app/api/ai-periodization/session/[sessionId]/transition/route.ts` | T4 | Create |
| `components/health/session-periodization-card.tsx` | T4 | Create |
| `components/health/weekly-volume-card.tsx` | T4 | Create |
| `app/health/health-content.tsx` | T4 | Modify |
| `app/config/` (program config screen) | T4 | Modify |

---

## Dependency Chain

```
Tier 1 (DB + store wiring)
    ↓
Tier 2 (signals + AI engine + routes)
    ↓
Tier 3 (pre-workout UI + AMRAP mode)     ← first user-visible value
    ↓
Tier 4 (transitions + Health tab + config)
    ↓
Tier 5 (hardening — edge cases from spec review)
```

Each tier commits to the feature branch and can be tested independently. Merge to main happens after all 5 tiers pass the T5-7 smoke test checklist.
