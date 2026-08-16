# Bodyweight Rep-Based Progression — Design Spec

**Date:** 2026-07-01
**Status:** Approved in principle (Approach A); pending spec review
**Branch:** `claude/screen-safe-spacing-pokr38`

## Goal

Make bodyweight exercises (pull-ups, dips, etc.) progress on **reps**, not on the
user's fluctuating body weight. A baseline AMRAP establishes a **rep max**; later
sessions prescribe each set as a percentage of that rep max; the strength number is
recomputed from the sets performed. Body weight is never read. Added/assisted weight
is kept and factors in.

## Problem with today's behaviour

`lib/workout/log-exercise.ts:94-103` sets `effectiveWeights = latestBodyWeight + added`
and runs the standard weight-based 1RM on it. So a bodyweight exercise's "1RM" is a
kg figure inflated by the user's body weight, which drifts every time they weigh in.
The UI forces per-set weights to 0, uses the style's *static* reps, and hides the
summary's "Next session" targets for bodyweight. There is no rep-based progression.

## Approach — reference weight (Approach A)

Replace the real body weight with a fixed internal constant so the existing 1RM
primitives produce a number driven by **reps + added weight only**.

- **`BW_REF = 100`** (kg), defined in `lib/1rm.ts`. Internal only; never shown as kg.
- Bodyweight `effectiveWeights[i] = Math.max(1, BW_REF + addedWeight[i])`
  (`addedWeight` may be negative for assisted work; clamp to ≥1).

### The bodyweight number = best set (not an average)

For bodyweight, `estimated1rm` for a session is the **best single set**:

```
estimated1rm = max over sets i of  calc1RM(effectiveWeights[i], min(reps[i], 36))
             (rounded to 0.25; 0 if no valid set)
```

- **No `amrapScaleFactor`** and **no `prescriptionFactor`** for bodyweight — both are
  weight-oriented adjustments that would break the clean reps↔rep-max round-trip.
- Rationale: the meaningful strength signal for bodyweight is your top set. Averaging
  *submaximal* working sets (e.g. 3×6 when your true max is 10) and then re-deriving a
  rep max from the average would ratchet the rep max **down** over time. Best-set
  avoids that: `repMaxFromOneRm(calc1RM(BW_REF, r)) === r`.
- `target80 = mround(estimated1rm * 0.8, 0.25)` is still stored for schema
  compatibility but is **not** used to drive bodyweight prescriptions.
- Personal-record handling is unchanged (`upsertPersonalRecordIfBetter(estimated1rm)`),
  so `personal_records` tracks the best-ever bodyweight number.

### Rep max (derived)

Add to `lib/1rm.ts`:

```ts
export const BW_REF = 100

// Largest integer rep count R (1..40) whose reference-weight 1RM does not exceed
// oneRm. The +0.5 tolerance absorbs the 0.25 rounding in stored estimates so the
// round-trip reps -> oneRm -> reps is stable. Returns 0 when there is no estimate.
export function repMaxFromOneRm(oneRm: number): number {
  if (oneRm <= 0) return 0
  let best = 1
  for (let r = 1; r <= 40; r++) {
    if (calc1RM(BW_REF, r) <= oneRm + 0.5) best = r
    else break
  }
  return best
}
```

### Prescription — reps as a percentage of the rep max

Bodyweight working sets prescribe **reps**, not weight. In `app/api/workout-data/route.ts`,
for `exerciseType === 'bodyweight'` and a non-baseline phase:

```
basis   = max(lastLog?.estimated1rm ?? 0, personalRecord ?? 0)   // PR-based to avoid drift
repMax  = repMaxFromOneRm(basis)
for each style set i:  reps_i = Math.max(1, Math.floor(style[i].pct / 100 * repMax))
```

- The route overrides each `progressionStyle[i].reps` with `reps_i`. The existing
  client bodyweight branch (per-set weights forced to 0, reps taken from the style)
  then works unchanged.
- **Prescriptions key off the personal record**, not the last session, so an easy /
  submaximal day never lowers next session's targets. Targets only rise when a new
  best rep max is set (a hard AMRAP set beats the record).
- **Round down, min 1** (e.g. rep max 10, 80% → 8; rep max 6, 80% → 4).
- If `basis` is 0 (no bodyweight history yet), leave the style reps as-is — the
  baseline phase's AMRAP establishes the first rep max.

### Baseline / AMRAP

Baseline phase is already `progressionStyle = null`, `defaultSets = 1` → a single
AMRAP set. The user does max reps; `estimated1rm = calc1RM(BW_REF + added, reps)` sets
the initial rep max. No special-casing needed beyond the reference weight.

### Added / assisted weight

The added/assisted-weight picker stays. Added weight enters via `BW_REF + w`, so a
+20 kg weighted pull-up scores higher than a bodyweight one and nudges the rep max
(and therefore rep targets) up. Assisted (negative) work scores lower.

## Display

`components/workout/exercise-summary-screen.tsx`:

- **"ESTIMATED 1RM" block → "REP MAX" for bodyweight.** Show
  `repMaxFromOneRm(prevEst1rm)` and `repMaxFromOneRm(newEst1rm)` as `"<n> RM"` (reps),
  with the delta expressed in reps. Weight-based exercises are unchanged.
- **"Next session" block — unhide for bodyweight.** Show per-set target **reps** =
  `Math.max(ps[i].reps, Math.max(1, Math.floor(ps[i].pct/100 * repMaxFromOneRm(newEst1rm))))`.
  `ps[i].reps` is the current session's PR-based prescription (already computed by the
  route), so the preview holds that target and only rises if this session's performance
  implies a higher rep max — it never previews a lower target after an easy day.
- Set cards already render reps for bodyweight; only the target numbers change.

## Files

- `lib/1rm.ts` — add `BW_REF` and `repMaxFromOneRm`; no change to existing exports.
- `lib/workout/log-exercise.ts` — reference weight; best-set bodyweight `estimated1rm` (server, authoritative).
- `components/workout-screen.tsx` — mirror the same bodyweight `estimated1rm` client-side (the summary's rep max derives from the client-computed `newEst1rm`; `calculate1RM` on zero weights would return 0).
- `app/api/workout-data/route.ts` — bodyweight rep-target prescription (PR-based).
- `components/workout/exercise-summary-screen.tsx` — rep-max display + next-session reps.
- `lib/__tests__/1rm.test.ts` — tests for `repMaxFromOneRm`.
- `lib/workout/__tests__/` (or existing) — a test for the bodyweight best-set estimate
  if a suitable harness exists; otherwise cover the pure pieces in `1rm.test.ts`.

## Testing

Unit (`repMaxFromOneRm`):
- `repMaxFromOneRm(calc1RM(BW_REF, 10))` → 10 (clean round-trip).
- `repMaxFromOneRm(calc1RM(BW_REF, 6))` → 6 (rounding tolerance holds).
- `repMaxFromOneRm(0)` → 0; very small `oneRm` → 1 (min clamp).
- Monotonic: higher `oneRm` never yields fewer reps.

Prescription (pure helper, extract `bodyweightRepTargets(style, repMax)` if useful):
- rep max 10, pct [100,80,80] → [10,8,8]; rep max 6, pct [80,80,80] → [4,4,4]; min 1 floor.

Manual (`pnpm dev`, seeded DB): add/confirm a bodyweight exercise, log a baseline
AMRAP, then a normal session; verify (a) the summary shows "REP MAX" in reps not kg,
(b) next-session targets are `floor(pct × repMax)` reps, (c) an easy session does not
drop next session's targets, (d) beating the rep max raises them, (e) changing the
logged body weight in `body_metrics` no longer moves the bodyweight number.

## Non-goals / follow-ons

- The live 1RM readout and the 1RM trend sparkline stay hidden/unchanged for
  bodyweight (they'd show the kg-equivalent). Converting them to a rep-max display is
  a separate change.
- No DB migration. Historical bodyweight `estimated1rm` values remain; the
  reference-weight number takes over from the next logged bodyweight session. A fresh
  AMRAP recalibrates cleanly.
