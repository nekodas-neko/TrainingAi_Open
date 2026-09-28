# 2026-09-29 — the accessory rep band is advice to the model and a constraint on nothing

**Agent:** BugFix intake. **Docs only** — no product code.

## The owner's question

*"If its accessory shouldn't it have reps towards the 12+ rep range?"* — on the Pull card that had
just given him `Cable Preacher Curl` at 7 reps, 13.75 kg, RPE 10.

## He was right, and the band is explicit

His active program is `powerbuilding`, and `goalRange('powerbuilding', 'accessory')` returns
**66–75% · 8–12 reps** (run, not read). He was prescribed **77.5% × 7** — below the rep floor and
above the pct ceiling.

**The two violations are one violation.** The accessory branch derives load from the target effort
at whatever reps it is handed — `pctForExpectedRpe(accessoryTargetRpe(goal), a.reps)`
(`generate-prescription.ts:597`). Holding RPE 8 constant, fewer reps means heavier, so dropping
below the rep floor mechanically pushes the load above the pct ceiling.

## Nothing enforces the band on that path

Following every consumer of `goalRange` — there are three:

| consumer | what it does |
|---|---|
| `prompt.ts:96` | puts the range in the **prompt**: a request, not a constraint |
| `autoregulation.ts:150` | clamps reps to the band **only when an adjustment fires** |
| `builder-review.tsx:566` | display only |

Otherwise `ex.reps = a.reps` (`:591`) takes the model's number unchecked, and the accessory pct
clamp is `Math.min(85, Math.max(40, pct))` — **40–85, not 66–75**. The primary and secondary
branches both clamp to their zone via `clampPrescribedPct`; the accessory branch is the only one
that does not. That skip is deliberate — accessories float to an RPE target rather than a fixed
band — and the design is sound. The gap is that floating the *load* was implemented without ever
constraining the *reps* it floats against.

Filed as **BF-221**, Lane A. Recommended fix: clamp reps to the band at `:591`, before the pct is
derived — the same clamp `autoregulation.ts:150` already applies, so the constraint reads
identically wherever it appears and the pct lands in band on its own.

**Still live on a second exercise:** `Pull-Up`, accessory, **77.5% × 7**, in the prescription
pending right now.

## A correction to BF-219, written the same session

That entry said the back-off would over-correct *"next week"*. **It ran in nine minutes.** Completing
the workout regenerates the next prescription in-process, so it fired at `22:16:34Z` and
`Cable Preacher Curl` now reads `66% × 12`. The claim was written from the autoregulation code
without checking when that code runs.

What survives the correction is the oscillation: 66% → RPE 6 → 77.5% → RPE 10 → back to 66%. That
is a return to the load he already found too easy, not a settling. **What the swing has never
visited is the middle of the band** — which is BF-221's territory.

## Not exercised

Docs only, no device run, no code change. **Why the model chose 7 reps for two accessories while
giving Face Pull 12 was not diagnosed** — all three are accessories in the same session carrying the
same band in the prompt, and Face Pull is also the style-less one (BF-217), so the difference may be
a style effect rather than a model whim. Named as undiagnosed in the entry.
