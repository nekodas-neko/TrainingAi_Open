# AI Dynamic Periodization — Design Spec

**Date:** 2026-06-20
**Status:** Ready for implementation planning
**Supersedes:** `docs/superpowers/plans/2026-06-18-ai-dynamic-periodization.md` (that plan is now superseded by this spec — implementation planning should start here, not there)

---

## Overview

A fully data-driven periodization engine that runs each program session type (e.g. the user's Legs session, Push session, Pull session — whatever they've named them) through its own independent phase lifecycle. The AI reads RPE trends, 1RM trajectory, recovery signals, weekly volume progress, and session time constraints, then generates a concrete next-session prescription: `{exercise, sets, reps, pct, restSec}`. The user can accept or auto-apply it.

New programs always begin with an AMRAP baseline week — no fixed programme percentages until a real 1RM is established for each session type. After that, the AI drives progressive overload within the appropriate intensity zone for the user's goal (strength, hypertrophy, power, endurance), modulating volume and intensity across accumulation → intensification → realisation → deload cycles.

The existing `1RM × pct = weight target` formula is unchanged throughout. The AI's only lever is what `pct`, `sets`, and `reps` it prescribes. The 1RM continues to be recalculated from actual `weight × reps` after every session.

---

## Core Principles

- **Session-type is the unit of periodization.** Each program session the user has created runs its own phase independently. A Legs session can be in deload while the Push session is in intensification. Individual exercises within a session always share that session's phase — they never diverge.
- **AMRAP first, prescribe second.** No AI prescription until a baseline 1RM is established via AMRAP for that session type. New program = baseline week for every session.
- **The goal zone is the hard constraint.** The user's training goal determines which intensity range and rep range the AI operates within at each phase. The AI cannot prescribe outside those bounds.
- **Time budget is non-negotiable.** Every prescription must fit within `session_time_budget - 10 minutes` (10 min reserved for warm-up). If it doesn't fit, the AI cuts sets before cutting exercises, and prioritises compound movements.
- **Weekly volume targets are the AI's distribution problem.** If the same muscle group is trained twice a week, the AI distributes sets across both sessions rather than frontloading.
- **Deload is the only full override.** For exceed/match situations the existing style runs. The AI's only mechanical intervention is deload — which cuts both load (~50% of 1RM) and sets (~50% of normal). Everything else is a prescription recommendation for the user to see and accept.
- **The athlete executes, the data decides.** The AI always targets a prescription. Whether the athlete exceeds it (more reps than programmed) is irrelevant to the model — the 1RM auto-update captures that naturally.

---

## Training Goals → Intensity Zones

The program-level `training_goal` determines which intensity bands and rep ranges the AI works within at each phase. These are hard bounds — the AI cannot prescribe outside them.

### Strength

| Phase | Intensity | Reps | Sets | Volume Direction |
|---|---|---|---|---|
| Accumulation | 70–77.5% | 5–8 | 4–5 | High |
| Intensification | 80–87.5% | 3–5 | 4–5 | Moderate |
| Realisation | 87.5–92.5% | 1–3 | 3–5 | Low |
| Deload | 50–55% | 6–8 | 2–3 | Minimal |

### Hypertrophy

| Phase | Intensity | Reps | Sets | Volume Direction |
|---|---|---|---|---|
| Accumulation | 65–72.5% | 8–12 | 3–4 | High |
| Intensification | 72.5–80% | 6–8 | 4–5 | High–Moderate |
| Realisation | 80–85% | 5–6 | 3–4 | Moderate |
| Deload | 50–55% | 10–12 | 2–3 | Minimal |

### Power

| Phase | Intensity | Reps | Sets | Volume Direction |
|---|---|---|---|---|
| Accumulation | 72.5–80% | 3–5 | 4–5 | Moderate–High |
| Intensification | 80–87.5% | 2–4 | 5–6 | Moderate |
| Realisation | 87.5–95% | 1–2 | 4–6 | Low |
| Deload | 55–60% | 4–5 | 2–3 | Minimal |

### Endurance

| Phase | Intensity | Reps | Sets | Volume Direction |
|---|---|---|---|---|
| Accumulation | 50–62.5% | 15–20 | 3–4 | High |
| Intensification | 62.5–70% | 12–15 | 3–4 | High |
| Realisation | 70–75% | 8–10 | 3–4 | Moderate |
| Deload | 40–50% | 15–20 | 2 | Minimal |

---

## AMRAP Baseline Protocol

Every new program begins with a baseline week. Every session type runs baseline on its first occurrence in the new program, regardless of how many sessions of that type have been done historically.

**Why a new baseline on each new program:** A new program may change exercises, session structure, or training goal. Historical 1RMs from a different program structure are not reliable anchors for a new prescription engine.

**Baseline sessions are exempt from time budget enforcement.** The AMRAP protocol takes however long it takes. The time budget applies to post-baseline prescriptions only.

### Per-Exercise AMRAP Sequence (within the session)

Each exercise in the session runs this sequence:

### Starting Weight for the AMRAP

**If `personal_records` exists for this exercise:** Suggest **~70% of the known 1RM** as the AMRAP working weight. This is a suggestion only — the pre-workout screen shows the suggested weight and lets the user adjust it before the session starts. Warm-up weights are derived from whatever AMRAP weight the user confirms:
- Warm-up Set A: 40% of confirmed AMRAP weight × 10 reps
- Warm-up Set B: 55% of confirmed AMRAP weight × 5 reps
- AMRAP Set: confirmed working weight, max reps

**If no `personal_records` exists (never trained this exercise):** There is no reliable basis for calculating a starting weight. The user is prompted on the pre-workout screen to **enter an estimated starting weight** for each such exercise before the session begins. The system cannot guess this. The pre-workout prompt shows: "Enter your estimated working weight for [exercise] — you'll test your max reps at this weight." Warm-up weights (40% and 55%) are derived from whatever the user enters.

### AMRAP Rep Guardrails

**1RM Calculation from AMRAP result:**

All AMRAP results are calculated using `calcAmrap1RM(weight, reps)` from `lib/1rm.ts`. This applies `calc1RM` (average of Epley + Brzycki) and then scales by a rep-band factor to compensate for fatigue-driven inflation at high rep counts:

```
amrapScaleFactor:
  ≤5 reps  → 1.00
  ≤8 reps  → 0.97
  ≤12 reps → 0.93
  ≤20 reps → 0.88
  >20 reps → 0.82
```

These scale factors provide conservative, accurate estimates across all realistic rep ranges — no per-goal discard thresholds are needed. A high rep count simply yields a more conservative 1RM estimate, which is the correct direction when the weight was too easy to be a strong signal.

Guardrails:
- If `reps === 1`: that weight is the 1RM directly (no formula applied, scale factor = 1.0).
- If `reps > 20`: the 0.82 scale factor applies. The screen shows a soft advisory: "High rep count — result stored but consider testing heavier next baseline." No discard.
- If `reps >= 37`: the Brzycki denominator approaches 0; `repFactor` falls back to Epley-only (already handled in `lib/1rm.ts`). Hard UI prompt to retest heavier before storing, since Epley-only at this extreme is unreliable.

**`baseline_1rm` key format:** Keys are `session_exercises.id` (UUID), never exercise names. Names are volatile — users can rename exercises and names differ by capitalisation. All baseline 1RM lookups join on `session_exercise_id`. The signal aggregator maps `session_exercise_id → 1RM` when building the AI prompt context, and includes the exercise display name separately for readability in the prompt text.

**After all exercises in the session have completed AMRAP:**
- `session_periodization.baseline_complete = true`
- `session_periodization.baseline_1rm` is populated using `session_exercise.id` as keys: `{ "<uuid>": { kg: 105.2, source: "amrap" }, ... }`
- Phase advances from `baseline` → `accumulation`
- First accumulation prescription is generated immediately

### Exercise Swaps Mid-Program

Exercises should not be freely added to a session mid-program — the expected case is a **swap**: one exercise is replaced by another at the same position. Adding an entirely new exercise to an already-full session is out of scope for this system; users who want to do that should create a new program.

When an exercise is swapped:
- The old `session_exercise_id` entry in `baseline_1rm` is removed
- A new `session_exercise_id` is created for the replacement exercise

**If the replacement exercise has a `personal_records` entry:**
Use it as the working 1RM immediately. No mini-baseline needed. The `baseline_1rm` entry for the new `session_exercise_id` is populated from `personal_records` and marked as `source: "personal_record"` rather than `source: "amrap"` in the JSONB value (extend the value to `{ kg: number, source: "amrap" | "personal_record" }`).

**If the replacement exercise has no `personal_records` entry:**
The exercise must run a mini-baseline on its first session occurrence: warm-up A (40%) + warm-up B (55%) + AMRAP at the goal-appropriate % — but the starting weight is unknown. The user is prompted to **enter a starting weight estimate** before the session begins (shown in a pre-workout prompt for that specific exercise). The rest of the session proceeds normally with the AI prescription. After the mini-baseline AMRAP, the result is merged into `baseline_1rm`.

The pre-workout screen shows a specific banner when a swap has been detected: "Squat has been swapped for Bulgarian Split Squat — enter a starting weight estimate to set up the baseline test."

The session's phase is **not reset** by a swap. Only the baseline for the swapped exercise is affected.

### Baseline UI

The active workout screen shows a distinct baseline mode per exercise:
- Label: "BASELINE · AMRAP"
- Warm-up set A and B are shown as normal sets with their fixed targets
- AMRAP set shows "Max reps" instead of a rep target; weight target shown
- After the AMRAP set is logged, the screen shows the calculated 1RM: "1RM: 105kg — saved"

---

## Hard Constraints on Every Prescription

### 1. Time Budget (Non-Negotiable)

Each program session has a `time_budget_minutes` setting. Every prescription must fit within:

```
effective_time = time_budget_minutes - 10   // 10 min warmup buffer
```

**Session duration estimate:**

```
total_time = Σ (per exercise):
  (sets × avg_set_duration_sec)
  + (sets - 1) × rest_sec
  + 120  // 2 min transition between exercises
```

Where `avg_set_duration_sec` is taken from `AVG(set_time_sec)` for that exercise in the user's history (default: 45 seconds if no history exists).

**If the prescription overshoots `effective_time`:**

Priority order for trimming:
1. Drop sets on accessory/isolation exercises first (those with `exercise_role = 'secondary'`)
2. Drop sets on compound exercises (those with `exercise_role = 'primary'`) if still over
3. Drop an entire isolation exercise if still over
4. Never drop a compound exercise entirely

The AI must include `estimated_duration_min` in its output so the UI can display it. If the AI's first draft exceeds the budget, it must revise before returning.

### 2. Weekly Volume Targets

Each program has volume targets: a target number of sets per muscle group per week. These are set by the user in program config.

**Multi-muscle set counting:** `exercise_library.muscles` stores `[{ role: "main" | "secondary", muscle: string }]` for each exercise. The volume contribution per set differs by role:
- `role: "main"` → **1.0 set** toward that muscle group's weekly count
- `role: "secondary"` → **0.5 sets** toward that muscle group's weekly count

Example: Incline Bench Press (`muscles: [{role:"main",muscle:"Chest"},{role:"secondary",muscle:"Shoulders"},{role:"secondary",muscle:"Triceps"}]`). Four sets = 4.0 Chest sets, 2.0 Shoulder sets, 2.0 Tricep sets.

The weekly volume aggregator joins `exercise_logs` → `exercise_library` (on exercise name) to get the `muscles` JSONB and applies the role-weighted count. If an exercise has no `exercise_library` entry (custom/user-created), all its muscle groups from `session_exercises.muscle_groups` count as 1.0 (full) — missing library data is not penalised.

**Weekly vs rotation schedules:** For weekly (day-of-week) schedules, "this week" is Mon–Sun. For rotation schedules, volume distribution uses the next N occurrences of sessions that train each muscle group within the rotation cycle, rather than a calendar week.

Before generating a prescription, the signal aggregator computes:
```
for each muscle group in this session:
  sets_logged_this_period = SUM of sets already logged for that muscle group
                            in the current week (weekly) or current rotation cycle
  sessions_remaining = sessions scheduled that train this muscle group
                       and haven't run yet in this period
  sets_budget_for_this_session = ceil(
    (target - sets_logged_this_period) / (sessions_remaining + 1)
  )
```

The AI uses `sets_budget_for_this_session` as the target set count per muscle group. It may go slightly over on the final session of the week for that muscle group if the target hasn't been reached. Volume targets are suspended during deload sessions — the AI ignores them and uses the fixed deload prescription instead.

---

## Signal Inputs to the AI

All of the following are passed in the AI evaluation prompt, every time a prescription is generated.

### Session-Level Signals

| Signal | Source | How Computed |
|---|---|---|
| Current phase | `session_periodization.phase` | Direct read |
| Sessions in current phase | `session_periodization.sessions_in_phase` | Direct read |
| Baseline 1RM per exercise | `session_periodization.baseline_1rm` | JSON map, set at baseline |
| Current estimated 1RM per exercise | `personal_records` | Latest record per exercise |
| 1RM trajectory per exercise | `personal_records` (last 3–5 entries) | Direction: up / flat / down |
| RPE trend (last 3 sessions of this type) | `set_logs.rpe` for this session type | Avg actual RPE vs avg expected RPE from intensity % (mapping: ≥92.5%→10, ≥87.5%→9, ≥80%→8, ≥70%→7, else 6) |
| Rep completion rate | `set_logs.reps` vs `session_periodization.prescription` | % of AI-prescribed reps actually achieved. **Only included from the 2nd post-baseline session onward** (`sessions_in_phase >= 1` after first accumulation session). Skipped if the user ran the session on style defaults (`last_session_ran_prescription = false`). |
| Rest time adherence | `set_logs.rest_time_sec` vs prescribed `rest_sec` | Did user take significantly more rest than programmed? |

### Recovery Signals

| Signal | Source | How Computed |
|---|---|---|
| Hours since last session of this type | `workout_sessions` | NOW() - MAX(completed_at) for this session type |
| Muscle group soreness | `mood_logs.soreness` (general score) | General soreness score from the most recent mood log within 48h of this session. Per-muscle soreness is deferred to Phase 2 — general soreness is used as a proxy signal (high general soreness within 48h of a session of this type is a recovery flag). |
| Consecutive training days | `workout_sessions` (last 14 days) | Days in a row with at least one session |
| Sessions this calendar week | `workout_sessions` | Count for current week |

### Weekly Volume State

| Signal | Source | How Computed |
|---|---|---|
| Sets logged this week per muscle group | `exercise_logs` + `set_logs` + `session_exercises.muscle_groups` | Aggregated from DB |
| Weekly target per muscle group | `program_volume_targets` | User-set target |
| Sessions remaining this week per muscle group | `schedule_days` + `scheduleDays` | Sessions in schedule that haven't run yet this week |

### Session Constraints

| Signal | Source |
|---|---|
| Effective time budget | `program_sessions.time_budget_minutes - 10` |
| Exercises in session | `session_exercises` ordered by position |
| Avg set duration per exercise | `AVG(set_time_sec)` from `set_logs` history, default 45s |
| Exercise role (primary/secondary) | `session_exercises.exercise_role` |
| Muscle groups per exercise | `session_exercises.muscle_groups` |

### Tier 2 Signals (available after 3–4 weeks of data)

- Sleep trend: `sleep_sessions.duration_hours` — recent 3-night avg vs 10-night baseline
- HRV trend: `body_metrics.hrv_ms` — recent 3-day avg vs 10-day baseline
- ACWR (Acute:Chronic Workload Ratio): sessions past 7 days / (sessions past 28 days ÷ 4)

---

## AI Prescription Output

The AI always returns a structured JSON object. The system prompt enforces this format — no markdown, no prose, JSON only.

```json
{
  "phase": "accumulation",
  "phase_action": "stay",
  "exercises": [
    {
      "name": "Squat",
      "sets": 4,
      "reps": 8,
      "pct": 72.5,
      "rest_sec": 120,
      "estimated_duration_sec": 765
    },
    {
      "name": "RDL",
      "sets": 3,
      "reps": 8,
      "pct": 70.0,
      "rest_sec": 120,
      "estimated_duration_sec": 534
    }
  ],
  "estimated_session_duration_min": 54,
  "weekly_volume_contribution": {
    "Quads": 7,
    "Hamstrings": 6,
    "Glutes": 7
  },
  "deload": false,
  "reasoning": "RPE tracking at 7.6 vs expected 7.8 — load is well-managed. 1RM up 2.5kg on Squat since last session. Staying in accumulation zone (72.5%), adding one set vs last session to build volume before intensification. 54 min fits the 60 min budget with 10 min warmup.",
  "confidence": 0.84
}
```

**`confidence` usage:** If `confidence < 0.6`, the prescription is always shown in confirm mode regardless of the user's auto-apply setting — low-confidence prescriptions must never be silently applied.

**`estimated_session_duration_min` computation:** The AI outputs `sets` and `rest_sec` per exercise. The server computes `estimated_session_duration_min` server-side using `avg_set_duration_sec` from the DB — it is not computed by the AI. The AI's output format does not include per-exercise `estimated_duration_sec`; the server derives the total from the AI's `sets` and `rest_sec` values.

**`phase_action`** values:
- `"stay"` — continue current phase
- `"transition_recommended"` — AI believes transition is warranted (requires user confirmation, never auto-applied)
- `"deload_recommended"` — AI is flagging deload need (requires user confirmation unless auto-apply is on)

**`deload: true`** overrides all exercise prescriptions. When deload is active, the AI still outputs the full exercise list but with `pct` ~50% and `sets` ~50% of the user's normal prescription for that session type.

---

## Phase Transition Rules

Phase transitions are always a recommendation requiring user confirmation. They are never auto-applied, regardless of the auto-apply setting.

### Transition Triggers (all conditions must be met)

**Accumulation → Intensification:**
- `sessions_in_phase >= 4`
- RPE delta (actual - expected) is ≤ +0.3 across last 3 sessions (athlete handling load)
- At least one primary exercise 1RM is trending up
- No deload has been triggered in the last 2 sessions

**Intensification → Realisation:**
- `sessions_in_phase >= 3`
- RPE delta ≤ +0.5
- 1RM is flat or trending up (not declining)
- ACWR ≤ 1.2 (if available)

**Realisation → Deload:**
- `sessions_in_phase >= 2`
- Always transitions to deload after realisation (mandatory recovery)

**Deload → Accumulation:**
- **Planned deload:** `sessions_in_phase >= 2` AND general soreness ≤ moderate in most recent mood log
- **Emergency deload:** `sessions_in_phase >= 1` (one deload session is enough to return)
- RPE during deload sessions ≤ 6 is confirmation only, not the primary gate

**Accumulation ceiling:** If `sessions_in_phase >= 10` and all other transition conditions are met, the recommendation is flagged as `urgency: "high"` — the user must actively confirm but cannot silently accumulate indefinitely. The AI should escalate messaging at this point.

### Emergency Deload (any phase)

Triggers without waiting for normal transition. Formally enters the `deload` phase (resets `sessions_in_phase` to 0, records previous phase as `pre_emergency_deload_phase` for return routing):
- Consecutive training days of the same session type ≥ 4
- Hours since last same-type session < 36 AND general soreness HIGH in most recent mood log
- ACWR > 1.5 (if available)
- RPE delta > +2.0 across last 2 sessions of this type
- Rep completion rate < 70% across last session

Emergency deload is flagged as `urgency: "high"`. Auto-applied if the user has auto-apply enabled. Always shown as a confirmation regardless when `urgency: "high"` — overrides the auto-apply bypass rule. After emergency deload, returns to the phase the session was in before (not always accumulation).

### Re-Baseline Triggers

A re-baseline (return to `phase: "baseline"`) is recommended when:
- 1RM has declined for 3 consecutive sessions of this type with no deload in between
- The user hasn't logged this session type in > 28 days
- The user activates a new program (always re-baselines all session types)

---

## Prescription Accept vs Auto-Apply

A program-level setting (stored in `programs.auto_apply_prescriptions`) with two modes:

| Mode | Behaviour |
|---|---|
| **Confirm (default)** | Pre-workout screen shows the prescription card with reasoning. User taps Accept or Dismiss before the workout starts. If dismissed, the previous style defaults are used. |
| **Auto-apply** | Prescription is applied silently. The pre-workout screen shows the applied parameters with a small "AI adjusted" badge and the reasoning, but no confirmation step. |

**Regardless of the setting, these always require user confirmation:**
- Phase transitions (accumulation → intensification → realisation)
- Re-baseline recommendations
- Any recommendation with `urgency: "high"`

---

## Data Model

### New Columns on Existing Tables

```sql
-- programs: training goal and auto-apply preference
ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS training_goal TEXT NOT NULL DEFAULT 'strength',
  -- 'strength' | 'hypertrophy' | 'power' | 'endurance'
  ADD COLUMN IF NOT EXISTS auto_apply_prescriptions BOOLEAN NOT NULL DEFAULT FALSE;

-- program_sessions: time budget per session
ALTER TABLE program_sessions
  ADD COLUMN IF NOT EXISTS time_budget_minutes INTEGER NOT NULL DEFAULT 60;
```

### New Tables

```sql
-- Per user × program session: phase state and current AI prescription
CREATE TABLE IF NOT EXISTS session_periodization (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_session_id        UUID NOT NULL REFERENCES program_sessions(id) ON DELETE CASCADE,

  -- Phase state
  phase                     TEXT NOT NULL DEFAULT 'baseline',
  -- 'baseline' | 'accumulation' | 'intensification' | 'realisation' | 'deload'
  phase_started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sessions_in_phase         INTEGER NOT NULL DEFAULT 0,
  baseline_complete         BOOLEAN NOT NULL DEFAULT FALSE,
  baseline_1rm              JSONB NOT NULL DEFAULT '{}',
  -- Keys: session_exercises.id (UUID). Values: { kg: number, source: "amrap" | "personal_record" }
  -- Example: { "a1b2-...": { kg: 105.2, source: "amrap" } }

  -- Current prescription (for the NEXT session of this type)
  prescription                  JSONB,
  -- Full AI output object (exercises array + metadata)
  prescription_generated_at     TIMESTAMPTZ,
  prescription_expires_at       TIMESTAMPTZ,
  -- Expires on whichever comes first: session runs (consumed) OR 7 days (stale, regenerate on next pre-workout load)
  prescription_status           TEXT NOT NULL DEFAULT 'none',
  -- 'none' | 'pending' | 'accepted' | 'auto_applied' | 'dismissed' | 'consumed'
  last_session_ran_prescription BOOLEAN,
  -- true = last session used the AI prescription; false = user dismissed and ran on style defaults.
  -- Used to determine whether rep_completion_rate signal is valid for the next cycle.

  -- Phase transition recommendation — only the most recent is stored
  pending_transition            JSONB,
  -- { newPhase, reasoning, urgency } or null. Overwritten on each new recommendation.

  -- Emergency deload state
  pre_emergency_deload_phase    TEXT,
  -- Phase to return to after emergency deload resolves (may not always be 'accumulation')

  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, program_session_id)
);

-- Weekly volume targets per program per muscle group
CREATE TABLE IF NOT EXISTS program_volume_targets (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id            UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  muscle_group          TEXT NOT NULL,
  target_sets_per_week  INTEGER NOT NULL,
  UNIQUE(program_id, muscle_group)
);
```

### Migration Number: 079

`lib/data/postgres/migrations/079_ai_dynamic_periodization.sql`

---

## API Surface

| Route | Method | Purpose |
|---|---|---|
| `/api/ai-periodization/session/[sessionId]` | GET | Current phase state + active prescription for a session type |
| `/api/ai-periodization/session/[sessionId]/prescribe` | POST | Trigger AI to generate a fresh prescription. Called automatically after each session completes. |
| `/api/ai-periodization/session/[sessionId]/respond` | PATCH | Accept, dismiss, or apply a prescription. Body: `{ action: 'accept' \| 'dismiss' }` |
| `/api/ai-periodization/session/[sessionId]/transition` | PATCH | Accept or reject a pending phase transition. Body: `{ action: 'accept' \| 'reject' }` |
| `/api/ai-periodization/weekly-volume` | GET | Sets logged this week vs targets, per muscle group, for the active program |
| `/api/ai-periodization/baseline/complete` | POST | Called after AMRAP session completes. Body: `{ sessionId, amrapResults: [{exerciseName, weightKg, reps}] }`. Calculates 1RMs, stores baseline, advances phase to accumulation, triggers first prescription. |

---

## Trigger: When Prescription is Generated

A new prescription is generated automatically in these situations:

1. **After AMRAP baseline completes** — first prescription for the session type
2. **After any session of this type completes** — prescription for next time
3. **On-demand** — user taps "Re-evaluate" button in the periodization card

The `/api/ai-periodization/session/[sessionId]/prescribe` route is called server-side from the workout completion handler, not triggered by the client directly. This means when the user opens the pre-workout screen for their next session, the prescription is already waiting.

Prescriptions expire 7 days after generation. If a session runs overdue and the prescription has expired, a fresh one is generated when the pre-workout screen loads.

---

## UI Changes

### Program Config Screen

New fields added to the program creation/edit flow:

1. **Training goal selector** — Strength / Hypertrophy / Power / Endurance (one-tap pill selector, shown prominently)
2. **Time budget per session** — slider or stepper per session type (default 60 min, range 30–120)
3. **Weekly volume targets** — expandable section per muscle group (pre-populated with research-backed defaults based on goal, user can adjust). Defaults:
   - Strength: major muscle groups 10–15 sets/week
   - Hypertrophy: major muscle groups 15–20 sets/week
4. **AI prescription mode** — toggle: "Confirm before applying" (default) vs "Auto-apply"

### Pre-Workout Screen

**Baseline phase (first session of new program):**
- Amber banner: "Baseline Week — AMRAP test for each exercise"
- Short explanation of the protocol
- Exercise list shows: "Warm-up A (40%) · Warm-up B (55%) · AMRAP (max reps at confirmed weight)"

**Prescription pending (confirm mode):**
- Card appears above the exercise list with:
  - Phase badge (Accumulation / Intensification etc.)
  - Estimated session duration (e.g. "~54 min")
  - Per-exercise summary (Squat: 4×8 @ 72.5%, RDL: 3×8 @ 70%...)
  - AI reasoning text
  - **Accept** button (primary) + **Dismiss** button (secondary)
- Accepting writes the prescription into the active workout state
- Dismissing falls back to the progression style defaults for that session

**Auto-apply mode:**
- Same card but no Accept button — shows "AI adjusted" badge with reasoning visible but no confirmation required

**Any phase — always shown:**
- Estimated session duration badge on the pre-workout screen header
- Weekly volume progress mini-bar: "Quads: 7 / 15 sets this week"

### Active Workout — Baseline Mode

The set card for AMRAP sets:
- Shows confirmed working weight (from pre-workout entry or 70% of PR suggestion), no rep target
- Rep counter shows "MAX" instead of a number
- After logging: shows calculated 1RM in a confirmation banner: "1RM: 105kg — saved"

### Health Tab — Training Section

Replace the current single periodization card with per-session-type cards:
- One card per session type in the active program
- Each shows: phase badge, sessions in phase, RPE trend indicator, next prescription summary
- Phase transition recommendation (if pending) shown inline with Accept/Reject
- Weekly volume progress bars (sets logged vs target per muscle group)

---

## Integration Points

### Existing 1RM Calculation — Unchanged

The formula `1RM = weight / (1.0278 - 0.0278 × reps)` runs exactly as now after every set. The AI reads `personal_records` to get the current 1RM for each exercise. Nothing in this feature changes how 1RM is tracked.

### Existing Progression Styles — Fallback

Progression styles continue to work as the default when:
- The program is in baseline phase (AMRAP overrides everything)
- A prescription has been dismissed by the user
- No prescription has been generated yet (new session type before first workout)

When an AI prescription is active (accepted or auto-applied), it overrides the progression style's `pct`, `reps`, and `sets` for that session. The style's `useFor1rm` flag is preserved — the AI does not touch which sets count toward 1RM calculation.

### `workout_sessions` → `program_session_id` Linkage

The prescribe trigger fires after a `workout_sessions` row is completed. It must know which `program_session_id` was just run to update the correct `session_periodization` row. Currently `workout_sessions` stores `session_name` (text) but not `program_session_id`. **Migration 079 must add `program_session_id UUID REFERENCES program_sessions(id)` to `workout_sessions`**, nullable for historical rows. The workout completion API must populate this FK when completing a session.

### RPE Capture — Already in DB (Migration 077)

`set_logs.rpe` is already added by migration 077. This spec builds on that — the signal aggregator reads it. No changes needed to the RPE capture UI or the log-exercise API.

### Exercise Library Muscle Groups

`session_exercises.muscle_groups` (TEXT ARRAY) is the source for weekly volume tracking. The weekly volume aggregator joins exercise logs to session exercises to count sets per muscle group. The AI's `weekly_volume_contribution` output map must use the same muscle group name strings as stored in the DB — the prompt will include the valid muscle group names from the program's session exercises.

---

## What This Spec Does Not Cover (Defer to Phase 2)

- **Push notification when prescription is ready** — notify user before they open the app
- **Phase history timeline** — visual log of all past transitions and what triggered them
- **Auto-apply per recommendation type** — e.g. auto-apply small % tweaks but confirm phase shifts (the current design has a binary auto-apply toggle; per-type granularity is a follow-up)
- **Exercise swap recommendations** — AI suggesting a different exercise when plateau is long-running
- **Social/coach mode** — sharing prescription or phase state with a training partner
