# 2026-08-07 — Manual Home "Deload" choice now actually reduces prescribed load

**Domain:** workouts — v1.267.13, JS-only (no APK rebuild)

## The report

Q-109 (owner UI-bug batch): the owner picked "Deload" from Home's three-way Full/Deload/Rest card
before a Legs session, and the resulting pre-workout screen showed the exact same "AI Prescription
· Intensification" numbers as a normal Full session — no visible deload treatment. Suspected the
calculation wasn't actually happening.

## Root cause

`handleDeload` (`session-select-content.tsx`) routes to `/workout?session=<id>&aiDeload=1`.
Server-side, `app/api/workout-data/route.ts` reads `aiDeload=1` and sets
`sessionPhaseStatus.isDeloadActive = true` — but that flag only ever reached the actual prescribed
load through `deloadAwareStylePhase()` (`packages/shared/src/phase-engine.ts`), which swaps in a
lighter phase style and **only applies to the static-progression-style path**. The moment
`aiDrivesLoad` is true — an AI-dynamic prescription actively driving load, the normal state for
this program — `buildWorkoutExercises` (`packages/shared/src/workout/session-data.ts`)
unconditionally applied `prescriptionStyleForExercise(p)` from the already-generated prescription,
with no reference to `aiDeload` at all. The only per-exercise reduction that could appear was
`p.deloaded`, a flag baked into the prescription **at generation time** by the AI-dynamic engine's
own independent, automatic emergency/per-exercise deload detection — a completely different,
orthogonal mechanism from the user manually asking for a lighter session today. `aiDeload` still
did three things — flagged the phase-status banner condition, tagged logged sets
`intensityMode: 'deload'`, and suppressed PR credit — none of which touched the actual weight/rep
numbers shown or logged.

## The fix

Added a new `else if (aiDeload)` branch inside `buildWorkoutExercises`'s existing `if (aiDrivesLoad)`
block, applying the same tuned reduction the automatic engine already uses instead of inventing a
new one:

```ts
} else if (aiDeload) {
  const override = deloadOverrideForGoal(trainingGoal)
  preDeloadStyle = progressionStyle
  preDeloadSets = defaultSets
  progressionStyle = prescriptionStyleForExercise({
    ...p,
    sets: override.sets, reps: override.reps, pct: override.pct, restSec: override.restSec,
    deloaded: true,
  })
  defaultSets = override.sets
  deloaded = true
  deloadNote = "Deload"
}
```

Deliberately an `else if`, not an additional condition ANDed onto the existing `p.deloaded` branch:
when the automatic per-exercise/whole-session engine has already deloaded this exercise, the manual
toggle's reduction is skipped entirely and the automatic numbers stand — picking Deload on top of an
already-deloaded session must not compound two reductions into an even lighter one. `preDeloadStyle`/
`preDeloadSets` are populated from the pre-manual-deload progression style/set count, reusing the
same fields the automatic path already sets, so the existing revert-to-full-weights UI
(`DeloadInfoSheet`) works correctly for a manual deload too — gated on `exercise.preDeloadStyle`
existing (a Q-115 fix from earlier the same session).

## Composing with this session's earlier Q-115 fix — no extra wiring needed

`components/workout-screen.tsx` already sent `exerciseDeloaded: true` in the log payload whenever
`ex.deloaded` was true (pre-existing, unrelated to this fix). Setting `deloaded = true` on the
returned `WorkoutExercise` here means a manually-deloaded exercise now flows through that same
payload flag automatically — which the same day's Q-115 fix (`estimateOneRm`'s explicit `deloaded`
option) and the pre-existing `shouldCountTowardPr` gate both already key off. Result: manually
deloaded sets are excluded from 1RM/PR credit with zero additional server-side changes, a clean
composition of two same-session fixes rather than a third patch.

## Verification

`buildWorkoutExercises` has exactly one caller (`app/api/workout-data/route.ts`) — no sibling
surfaces needed updating. `tsc --noEmit -p .` clean (only the pre-existing unrelated
`voice-log-button.tsx` missing-module error). `eslint` clean on touched files.

Added `packages/shared/src/workout/__tests__/session-data-manual-deload.test.ts`, exercising the
pure `buildWorkoutExercises` function directly with a hand-built context (5 cases): a normal
AI-driven session with `aiDeload: false` is untouched; `aiDeload: true` correctly reduces
pct/reps/restSec/sets to the goal's `deloadOverrideForGoal()` values and sets `deloaded: true`;
`preDeloadStyle`/`preDeloadSets` carry the real pre-deload prescription for the revert UI; an
exercise the automatic engine already deloaded (`p.deloaded: true`) is left at its automatic numbers
rather than being reduced again; a `hypertrophy`-goal session gets that goal's own override values,
not strength's. All 5 pass. Full relevant suite (`packages/shared/src/workout/`,
`packages/shared/src/ai-periodization/`, `packages/shared/src/1rm` tests): 26 files / 281 tests
green.

**Not exercised:** a live `pnpm dev` + API verification the way every other fix this session was
verified — the local seeded program (`Push Pull Legs`) is `phase_mode='manual'`, not `ai_dynamic`,
so `aiDrivesLoad`/`aiDeload` never actually engage against the current seed data without first
switching or regenerating the program to `ai_dynamic` mode. Verified via the direct unit test above
instead, which exercises the exact same pure function with no side effects. No on-device S25
verification — JS-only, no native/safe-area/gesture involvement.

## Remaining scope

The owner separately asked to move the Full/Deload/Rest choice off Home (which should offer only
Workout/Rest) onto the pre-workout screen, near the Quick/Normal/Long duration picker. Split off as
**Q-109-followup** (`docs/implementation-backlog.md`) — it no longer depends on this fix and is a
purely cosmetic relocation.
