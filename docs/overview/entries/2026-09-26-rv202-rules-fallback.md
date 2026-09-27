# 2026-09-26 — RV-202 ①: a failed model call answers with your program, not a 502

**Branch:** `fix/rv202-rules-fallback` · **Lane A** · closes RV-202 item 1. Items 2 (the rate-limit
bucket) and 3 (Lane B's source label) stay open.

The 502 was never a quiet failure. The client ignores the non-ok response and polls
`PRESCRIPTION_POLL_MAX = 10` times at 3 s, so the lifter watched "Preparing your AI workout…" for
about thirty seconds and then got the base program anyway. Now those same numbers arrive at once.

## What the entry got right, and the one thing it left out

Verified against `main` first, and its amended bullet was accurate: `PrescriptionSignals.exercises`
carried identity, 1RM history, timing and autoregulation inputs but **not one base number**, so the
only deterministic plan available was `buildWholeSessionDeloadPrescription` — which would have
prescribed a **deload to everyone whose model call timed out**. That is a training decision made by
an outage, and the entry was right to forbid it.

So `aggregateSignals` now resolves each exercise's `styleId` through `listProgressionStyles` and
carries `baseSets`, and `buildRulesPrescription` turns those into a plan through the same
`fitToBudget` the model path uses.

**What the entry did not specify: the rules plan is not persisted.** `storePrescription` holds a
plan for seven days, so storing this would give the model no further attempt until it expired —
one provider blip becoming a week of uninformed plans. That is precisely the shape RV-69 fixed for
the digests, where a degraded recap must never be cached ahead of the real one. The slot stays
empty and the next open re-runs the model.

It reports `confidence: 0.3`, not the deload builder's `1.0`. Everything the model contributes —
phase transitions, RPE autoregulation, per-exercise deloads — is missing, so the numbers are sound
and the judgement behind them is absent. An exercise with no style is skipped rather than given an
invented load, and when *no* exercise has one the builder returns null and the 502 stands.

## Verified on the dev server, twice

`pnpm dev` with a deliberately invalid `GOOGLE_GENERATIVE_AI_API_KEY`:

- **HTTP 200**, where `main` gives 502. `source: 'rules'`, phase unchanged (`accumulation`),
  `phaseAction: 'stay'`, `deload: false`, confidence 0.3.
- The prescribed **3×8 @ 75%, rest 90** matches `style_sets` for all three exercises, set for set.
- `SELECT prescription IS NOT NULL` read **f** afterwards — the non-persistence is observed, not
  argued — and the failure logged exactly once.

And with the container's real key, the model path still wins and stores as before, which is the
regression half of the same run. That second run is what caught my first attempt: I assumed local
dev had no API key because `.env.local` holds only `DATABASE_URL` and `AUTH_SECRET`, and got a
normal model-generated plan. The key is in the container environment.

## Verification

- Full suite **10,300 passed / 87 skipped, exit 0**; lint **831**, exactly baseline;
  `check-test-typecheck` at baseline; Custom Rules **80 of 80**.
- 14 new tests. Mutation pass, 4 real mutants + 1 control: reaching for the deload builder,
  persisting the fallback, inventing a set for a style-less exercise, and counting weekly volume
  from the style's sets rather than the fitted ones each died. The control — renaming an internal
  variable — survived, which is the check today's earlier over-tight source assertions taught me
  to run.
- Adding a required field to `PrescriptionSignals` broke a fixture in
  `prompt-bodyweight-units.test.ts`; it takes `baseSets: []`. Only `check-test-typecheck` sees
  that, never `tsc -p tsconfig.json`.

## Not exercised

**The reachability of the catch branch in production.** The dev run forces the failure with a bad
key, which is one way the model call can throw; a timeout or a schema-parse failure takes the same
path but was not driven. And the wiring test is source-level — no harness drives the real
`generatePrescriptionForSession`, because it would mean mocking the AI SDK plus ~30 repository
reads, and the route test one level up mocks the whole generator away.

**No device, and nothing renders `source` yet.** A lifter sees the base numbers under "Recommended
workout" with nothing saying the coach was unreachable — the same silence the offline path already
has. Labelling it is RV-202 item 3, Lane B's, and the field it needs now exists.
