# 2026-09-20 — the reta data is sound, nothing shows it, and BF-183 was modelling the wrong thing

**BugFix intake.** Docs-only. Two items: **BF-184** (new) and a same-day correction to **BF-183**.

## BF-184 — recording verified, join verified, one gap

All three doses are present and correct:

| # | log_date | taken_at (Brisbane) | amount | vial |
|---|---|---|---|---|
| 1 | 2026-09-07 | **missing** | **0.5 mg** | none |
| 2 | 2026-09-13 | 20:00 | 1 mg | 10 mg / 3 mL @ 100 u/mL |
| 3 | 2026-09-20 | 20:46 | 1 mg | 10 mg / 3 mL @ 100 u/mL |

`log_date` and the Brisbane day of `taken_at` agree on both timed doses — no timezone drift. The
join to recovery metrics was run rather than assumed: every day 2026-09-06 → 09-20 carries RHR, HRV,
weight, readiness and stress, **15 of 15 rows populated**. The data is already matchable.

Three gaps worth knowing: dose 1 has no `taken_at` and no vial (it predates the vial opened 09-10);
dose 1 was 0.5 mg against 1 mg for 2 and 3, so cycle 1 is a titration step and not comparable; and
the intervals are 6 days then 7, so "day N after dose" and "day of week" are not interchangeable.

**The observed pattern is recorded as an observation and explicitly not a verdict.** Cycle 2 (1 mg):
RHR 55 → **65** at days 3–4 with HRV 48 → **19**, both back to baseline by day 5. Cycle 1 (0.5 mg)
has the same shape, smaller and earlier. Two cycles at two different doses with training, sleep and
stress uncontrolled.

**The bar is already set in that folder.** `weight-response.ts` (OR-102b) rejected the owner's own
two-point-delta request with production numbers — residual SD 1.203 kg, so a two-reading difference
carries ±1.70 kg, *"close to random while looking authoritative, which is worse than no colour"* —
and withholds the verdict unless the whole interval falls one side of a boundary. A recovery-response
card must do the same, and should extend that module rather than add a third estimator.

## BF-183 — corrected the same day, before any work started

Filed as *"the meal a food IS usually eaten at"*, inferred from history. The owner meant the
opposite: *"what meal timing each meal can be used for (i.e protein shake could be all 4 meals).
This will tie into the meal planner."*

**The measurement already in the entry is the proof it matters.** His protein shake has 45 logs,
every one at breakfast — and he names it as suitable for all four meals. **History records where a
food HAS been used, which is a floor on suitability and never the set.** So anything derived from
logs alone under-tags exactly the foods he uses most consistently.

The entry now asks for a stored, multi-valued `suitableMealTypeIds` — declared, not inferred — with
history demoted to a pre-tick seed. That makes it a schema change, so it moves to Lane A. Two things
survive: the emoji recommendation (stronger now, since a row may show four glyphs and they must be
the four he already reads), and the threshold, which now decides only what gets pre-ticked.

**His "too many meals" worry was wrong under my reading and right under his** — one dominant glyph
never grew, a capability set does. Capping the display is now a decision to make before building.

## What was not exercised

Nothing on the S25. BF-184's verification is live queries against production rows; no code was run
and no model fitted. BF-183 remains a planning entry with nothing built.
