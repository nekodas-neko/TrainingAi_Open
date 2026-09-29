# 2026-09-29 — LB-187: the AI builder's review screen is no longer unseen

**Branch:** `chore/lb187-builder-review-e2e` · one new spec, no product change, no version bump.

Nothing in `e2e/` reached `builder-review.tsx` — the single point at which an AI-generated program is
committed to the database — so `LA-183`'s style-fill shipped unit-tested and source-guarded but never
once observed in a browser. `grep -l 'generate-program' e2e/` was empty.

## The cost check the entry demanded, answered with a measurement

The entry required sizing against the shards' current wall-clock rather than adding a spec blind,
citing `LB-166`'s 45-minute ceiling. That ceiling was the **unsharded** suite. Measured from shard 4's
own uploaded `report.json`: **9.4 minutes for 75 tests, 7.5 s per test, against a 25-minute
`timeout-minutes`.** Roughly 38% of budget, ~15 minutes of headroom per shard. A spec of this size is
affordable, and this one runs in **1.6 min** locally.

## The cheap path is a trap, and taking it would have produced a spec that cannot fail

The obvious route is the default `ai` progression mode: `lastQuestionStep` is 7 there, so generation
fires after three inputs and four `Next` taps and jumps straight to the review. It is **useless for
this assertion.** In `ai` mode the row's second line is
`formatGoalRange(goalRange(inputs.goal, ex.exerciseRole)) · AI sets each phase`
(`builder-review.tsx:569-572`) — it never consults the style at all, so a style-less exercise and a
styled one render **identically**. Only the `progressionStyleName` branch at `:573` renders the style,
and only outside `ai` mode, where a slot with no style renders `null`. That `null` is the blank line
LB-187 exists for.

So the spec selects **Linear**. `handleNext` skips step 8 for linear (`next === 8 && linear → 9`), so
the path is 1→2→3→4→5→6→7→9→10 — **nine steps, the entry's own figure, for a reason the entry never
stated.** Only three steps need real input (`canAdvance`): a name, one equipment choice, one focus
muscle. The rest advance on `INITIAL_INPUTS`.

## Two things that would each have made the spec vacuous

**The stub must give a sibling a style.** `fillGeneratedStyles` infers from the program it is handed,
and `fill-generated-styles.test.ts:63-64` pins the case where nothing carries one: every slot stays
`undefined`, because there is nothing to read. A stub with no styles anywhere would render blank lines
and **pass against the very bug it guards.** So the fixture gives two primaries `Strength 4-set` and
leaves the accessory with neither id nor name; the fill resolves it from the siblings, and
`STYLE_DISPLAY['Strength 4-set']` renders `4 × 5 @ 80% · 120s rest`. The assertion is that line's
count is **3**, not 2.

**The `Next` count was one too many at first,** and the failure pointed somewhere else entirely — see
below.

## What it does NOT drive, and why that is not a gap

The entry also asks that the saved program carry a non-null `style_id`. `handleSave` maps
**`shown.sessions`** (`builder-review.tsx:297`) — the *filled* program, the same object the rows render
from. So asserting the rendered line establishes what the save would map; whether the route persists it
is the route's own concern with its own tests. The sibling spec on this screen
(`lb186-new-exercise-has-a-style.spec.ts`) also records why saving from a spec is a hazard: it makes
the assertion depend on state any earlier spec in the same run can change.

Style ids are arbitrary on purpose — `fillGeneratedStyles` calls `mostUsedStyleId` with the default
`isKnown`, which accepts every id, because a generated program's ids were already resolved
server-side. So this needs no `progression_styles` fixture at all.

## Verified by a control pair

| tree | result |
|---|---|
| as shipped | **3 passed** (1.6m) · exit 0 |
| fill bypassed (`const shown = program`) | **1 failed** at the assertion, `:121` · exit 1 |

The control is the half that matters: this lane has shipped a regression test that ran 8-of-8 green
under the very regression it claimed to guard, so a spec is not finished until it has been seen to
fail. `builder-review.tsx` was restored from a backup immediately after and the tree confirmed clean —
that sabotage must never reach a commit.

## ⚠ A failing spec's `error-context.md` snapshot is captured AFTER teardown, not at the failure

The first run timed out on the extra `Next`, and `error-context.md`'s page snapshot showed the bare
`/program` screen **with the wizard gone** — which reads exactly like a Radix sheet being dismissed
mid-run, a completely different bug. It is wrong. The **trace** shows every action up to the final
click succeeding, and its frame snapshots contain both the `Generate Program` button and step 10's
rotation UI, so the wizard was open and on the right step the whole time. Reading that snapshot as the
failure state would have meant hunting a dismiss that never happened.

**The trace is the authority; the context summary beside it is not.** Same lesson as the same day's
shard-4 hunt, one level down: there, `get_job_logs`'s tail was Postgres teardown and the answer was in
the report artifact's `errors[]`.

## Not exercised

- **The save path end to end.** Deliberate, per the reasoning above.
- **`ai` mode's own row.** The goal-range line has no coverage here; it is a different assertion and
  this spec would have to stop asserting the style to make it.
- **The device.** Nothing here ships to the APK.
