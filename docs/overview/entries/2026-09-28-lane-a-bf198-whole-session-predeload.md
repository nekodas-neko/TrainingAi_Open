# 2026-09-28 — BF-198: `Full` works on a whole-session deload

The owner, on an Upper reading "AI Prescription · Deload" with `Full` selected: *"How am I supposed
to select a full workout when the prescription is deloaded?"* He could not. `Full` reverts each
exercise to the `preDeload` block its prescription recorded, and the whole-session deload builder
never wrote one. Production held both shapes: Upper and Pull at 5 of 5 deloaded with 0 records, a
per-exercise Lower with 1 of 1.

The expensive half was invisible. Sets done at full weight under the override were still logged as
a deload, so they could not set a PR.

## The fix

`buildWholeSessionDeloadPrescription` records `preDeload` for every exercise with a base style. The
numbers come from `buildRulesPrescription`: the program's own sets, reps, pct and rest, fitted to
today's budget. A whole-session deload has no model numbers to keep, so the program is the honest
source. Everything downstream already existed: `session-data` turns `preDeload` into
`preDeloadStyle`, and `applyDeloadReverts` clears `deloaded`, which is what lets the sets count.

An exercise with no base style gets nothing and stays deloaded under `Full`, the same as the
per-exercise path without a record. The stored Upper and Pull prescriptions keep the dead toggle
until they are regenerated.

## Verification

- `bf198-whole-session-predeload.test.ts`, 5 cases: still a deload at the deload numbers; `preDeload`
  equals the rules plan; under a tight budget it carries the FITTED set count; nothing for a
  style-less exercise; and it arrives in `buildWorkoutExercises` as a `preDeloadStyle`.
- Mutants: not recording `preDeload`, killed. An unfitted set count first SURVIVED, because at a
  90-minute budget nothing is trimmed. The tight-budget case was added and kills it. Control
  (`?? undefined`) survived.
- 64 files / 710 tests in `ai-periodization`, `workout` and `components/workout`, plus the three
  DB-backed prescription route tests (74), pass.

## Not exercised

The seed program is not AI-dynamic and cannot reach a whole-session deload, so this was not driven
through `pnpm dev`. The device, and the card's copy (BF-198 Keep ①).
