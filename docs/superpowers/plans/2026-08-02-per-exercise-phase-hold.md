# Per-Exercise Phase Hold — Implementation Plan

**Date:** 2026-08-02
**Domain:** `[workouts]`
**Branch:** `feat/exercise-phase-hold`
**Status:** Planned — not implemented

## Problem

Phase is stored per session type (`session_periodization`, keyed by `program_session_id`), so
every compound in a session moves through accumulation → intensification → realisation together.

That is wrong when two compounds on the same day progress at different rates. Push day has bench
(primary) and overhead press (secondary). Bench is climbing and has earned intensification. OHP has
stalled — its 1RM is flat and its RPE is drifting up. Today the session transitions as a unit, so
OHP is prescribed a heavier zone on the strength of a lift that is not it.

## Design decision — derived, never configured

**An exercise holds behind the session's phase only when its own signal says it has not earned the
transition.** There is no user-facing setting, no default offset, and no per-exercise
configuration. An exercise at the session's phase is the normal state; holding is an exception the
engine detects and can undo by itself.

This was the owner's explicit steer (2026-08-02): *"I don't want it to DEFAULT behind. I'd want it
to only be in a different session if it needed to be."* An earlier draft of this plan proposed a
manual `phase_offset` setting in the program editor — that is **rejected**, and it is not a
fallback to reach for if the derived version proves fiddly. A static offset is a permanent handicap
applied to a lift whose problem is temporary.

### How the hold is decided

The offset is recomputed **only at a phase transition**, per compound, and stored so it persists
across sessions until the next transition.

At the moment the session transitions (accepted in `advancePhase`):

- For each **primary/secondary** exercise, evaluate a deterministic eligibility predicate against
  that exercise's own signals.
- Passes → its offset moves toward `0` by one step (a held exercise catches up; an exercise
  already at `0` stays there).
- Fails → its offset moves one step further behind, floored at `-2`.
- **Accessories are skipped entirely.** `intensityZoneForRole` already routes them to a phase-free
  RPE band; applying a hold would be a second, contradictory mechanism on the same exercise.

The offset is then applied at prescribe time as a pure derivation:

```
effectivePhase = shiftPhase(sessionPhase, offset)   // offset ∈ {0, -1, -2}
```

One session phase, one `sessions_in_phase` counter, one transition prompt. The offset is a
derivation from that phase, not a second phase state.

### The eligibility predicate

Today's transition criteria live as **text in the system prompt** (`prompt.ts:129-132` — "RPE delta
≤+0.3, 1RM trending up") and are judged by the LLM for the session as a whole. A per-exercise
version cannot be LLM-judged: asking the model to rule on N exercises independently is unstable
across regenerations, and this value is persisted.

So this is new deterministic code mirroring the prompt's stated floors — put it in one place and
have the prompt render its thresholds from the same constants, per **One Formula, One Place**:

```ts
// packages/shared/src/ai-periodization/phase-eligibility.ts
export function exerciseEarnedTransition(
  sig: { rm1Trend: 'up' | 'flat' | 'down'; rpeDelta: number | null; plateau: boolean },
  targetPhase: 'intensification' | 'realisation',
): boolean
```

- → `intensification`: `rm1Trend === 'up'` and `(rpeDelta ?? 0) <= 0.3`
- → `realisation`: `rm1Trend !== 'down'` and `(rpeDelta ?? 0) <= 0.5`
- `rpeDelta === null` (insufficient history) → **passes**. An exercise with no data must not be
  silently handicapped; the whole point is that holding is an exception with evidence behind it.
- `plateau` (the 90-day flat-1RM flag) is deliberately **not** part of the predicate — it is a
  long-window signal and would hold a lift back for a quarter after a single flat stretch. It
  belongs in the stall escalation below instead.

The session still transitions on the existing LLM judgement plus the deterministic ceilings; the
per-exercise predicate is a **veto on individual exercises applied after that decision**. That
layering is the same shape as the per-exercise deload, which overwrites the model's numbers after
parsing (`generate-prescription.ts`).

### Holding is not a fix — escalate a persistent stall

An exercise pinned at `-2` across two consecutive transitions is not being helped by holding; it is
telling you the lift needs a reset or a swap. At that point surface it — a Known-Issues-style note
on the prescription card, e.g. *"Overhead press has been held back two blocks — consider resetting
its working weight or swapping the movement."* Without this the feature quietly hides a stalled
lift forever, which is worse than the problem it solves.

### Why the offset only goes backwards

`capLoadToAnchor` (`role-plausibility.ts:53`) is an absolute invariant: every non-anchor exercise's
pct is capped at the anchor's. A forward offset would be silently clamped back to the anchor's load
— achieving nothing while looking like it did something. The column's CHECK constraint must reject
positive values rather than accept a setting that cannot take effect.

Floor at `-2`: `accumulation - 2` has nowhere to go, and a third step is indistinguishable from
dropping the exercise from the block.

### Why not real per-exercise phase state

Rejected deliberately; recorded so it is not re-litigated:

1. **Transitions would run on signals only some exercises can support.** Eligibility keys on 1RM
   trend and RPE delta, which are sound for a compound and noisy for anything light and high-rep.
   The hold sidesteps this by only ever applying to primary/secondary compounds and only ever
   *subtracting* from a phase the session already established.
2. **The transition flow multiplies.** `advancePhase` resets `sessions_in_phase`,
   `pendingTransition` and the stored prescription per row. Per-exercise state turns one "ready to
   move on?" prompt per session into one per exercise.
3. **"What phase am I in" stops having an answer.** `buildAutomaticPhaseStatus`, the
   program-overview screen and the session recap all render a single phase per session.

## Implementation

### Block 1 — schema + shared helpers

- Migration `167_session_exercises_phase_offset.sql`: `ALTER TABLE session_exercises ADD COLUMN
  phase_offset smallint NOT NULL DEFAULT 0`, plus `CHECK (phase_offset BETWEEN -2 AND 0)`.
  Claim 167 against the directory **and** open PRs first — the backlog's "next free" line drifts.
- `schema.ts`: add `phaseOffset` to the `sessionExercises` definition.
- `prompt.ts`: export `shiftPhase(phase, offset)` over
  `['accumulation','intensification','realisation']`. **`deload` and `baseline` return unchanged at
  every offset** — a deload is systemic and must not be partially applied (the conclusion from
  `docs/superpowers/specs/2026-07-02-per-exercise-deload-design.md`). Clamp the shifted index at 0.
- New `phase-eligibility.ts` with `exerciseEarnedTransition` as specified above, and the threshold
  constants the prompt text renders from.

### Block 2 — compute the hold at transition

- In the transition-acceptance path (`advancePhase`, `lib/data/postgres/slices/periodization.ts:80`),
  after the phase is written, recompute `phase_offset` for each primary/secondary exercise of that
  session from the signals already assembled for the prescribe call.
- `advancePhase` currently takes `(db, userId, programSessionId, newPhase)` and does one UPDATE. It
  will need the per-exercise verdicts passed in — compute them in the caller (the transition route)
  where signals are already in hand, and pass a `Map<sessionExerciseId, offset>` down, rather than
  making the repository slice fetch signals itself.
- Scope every UPDATE to `user_id` via the owning program join — `session_exercises` has no
  `user_id` column, so this is the ownership-verification case called out in CLAUDE.md
  (`ensureWorkoutSession` is the reference pattern).
- Transitions **into `deload`** leave every offset untouched (the deload is session-wide, and the
  offsets must survive it to still be correct on the far side).

### Block 3 — apply it at prescribe

`intensityZoneForRole(goal, phase, role)` is called at exactly two sites, both in
`generate-prescription.ts` (397/398 for secondary, 410 for primary), both passing `parsed.phase`.

- Add `phaseOffset` to the per-exercise shape in `signals.ts` (alongside `role`, which already
  flows from `session_exercises`).
- At each site resolve `shiftPhase(parsed.phase, offset)` and pass that as the phase.
- **`primaryZone` at line 398 must keep using the unshifted `parsed.phase`.** It is the anchor
  ceiling, not the exercise's own zone — shifting it would let a held secondary drag the cap down
  and re-price the whole session.
- Prompt: when any exercise is held, name it and the phase it is being prescribed at, so the model
  does not fight the clamp. Mirrors how the per-exercise deload primes `buildUserPrompt`.

### Block 4 — surfacing it

- Prescription card: a held exercise shows its effective phase and the reason, so a lighter
  prescription reads as intentional. Reuse the per-exercise deload chip pattern
  (`role="button"` inside the tappable card, theme tokens, Lucide icon, no emoji).
- A manual "train this at the session's phase" override on that chip, mirroring the deload's "Use
  full weights" — held in the persisted workout store keyed by `(local date, session id)`, per the
  Zustand rules. This is an override of a derived value, **not** the configuration setting rejected
  above.
- The two-transition stall escalation from the design section.

## Testing

Unit (`packages/shared/src/ai-periodization/__tests__/`):
- `shiftPhase`: every phase at 0/-1/-2; clamped at accumulation; `deload`/`baseline` unshifted at
  every offset.
- `exerciseEarnedTransition`: each branch, both target phases, and `rpeDelta === null` → passes.
- Offset stepping: a failing exercise goes 0 → -1 → -2 and floors; a passing one steps back toward 0.
- Zone resolution: primary at 0 and held secondary at -1 in one session give the expected two zones,
  and the anchor ceiling is computed from the unshifted phase.
- Accessory with a non-zero offset → output identical to offset 0.
- `capLoadToAnchor` still holds with a held secondary (trivially — the hold only ever lowers).

DB (`lib/data/postgres/__tests__/`): the CHECK rejects `1` and `-3`; the offset UPDATE cannot touch
another user's rows.

Runtime: `pnpm dev` — seed an exercise with a flat 1RM and rising RPE, accept a session transition,
confirm that exercise holds while the others move, and that it catches up once its signal recovers.

**Not exercisable in the sandbox:** Samsung WebView rendering and tap targets for the new chip, and
real Gemini behaviour against the new prompt line (the deterministic override makes the outcome safe
either way, so that is a prompt-quality risk, not a correctness one). Both need an on-device check
after deploy, or a Known-Issues row per the device-verification gate.

## Out of scope

- Any user-facing configuration of the offset (explicitly rejected — see the design decision).
- Forward offsets (structurally cannot take effect; see `capLoadToAnchor`).
- Per-exercise deload (already exists; a deload stays session-wide by design).
- Changes to the phase ceilings, the session-level transition eligibility, or `sessions_in_phase`.
- Manual/static programs (`resolveStyleForExercise`) — those already diverge by role, and the
  owner's programs are AI-dynamic.

## Open question for the owner

`MODERATE_SECONDARY_GOALS` (`prompt.ts:70`) contains only `powerbuilding`, so on strength,
hypertrophy and strength+hypertrophy a secondary compound is clamped into the *same* zone as the
primary and the prompt's role-loading note is not emitted at all. It is a separate gap, not fixed by
this plan — the hold is signal-driven, so it will not touch a secondary that is progressing fine.
Worth its own backlog entry if the owner wants secondaries loaded below the anchor across all goals.
