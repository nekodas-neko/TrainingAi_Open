# 2026-09-26 — BF-199: does the prescription need AI?

Owner: *"Prescription uses ai right? Do we NEED ai for this? Can we do this through logic so its easy
to prescribe and represcribe"*

**No, and most of it already is logic.** There is exactly one model call in the pipeline
(`generateObject`, `generate-prescription.ts:304`). Everything around it — reconciliation, role
plausibility, the budget fitter — is deterministic, and **the deload path produces a complete
prescription with no model call at all**. The app already ships a working non-AI prescriber.

What the model actually contributes, measured across all 33 distinct `(sets, reps, pct, rest)` tuples
in `session_periodization`:

| output | production | whose number |
|---|---|---|
| **sets** | **2 in all 33 tuples** | not the model's — `fitToBudget` clamps to its floor because the budget is binding (BF-197) |
| **reps + pct** | 12→66, 11→68, 10→70.5, 9→72.5, 8→75, 7→76–77.5, 6→80 (~+2.25 %/rep) | a lookup table; `style_sets` already stores these same fields |
| **rest** | **23 values from 68 s to 300 s** (76, 97, 143, 189…) | the model's, and the only free one — the styles say 60/90/120/130/180 |

The one quantity it controls end to end is the one that looks wrong.

**The counter-argument, not overstated:** reliability is not a problem today — `ai_call_log` shows
**35 prescription calls, 35 ok**, 2.1 s and 3,645 tokens average. The route has no fallback, so a
failure means a 502 and no plan, but that has not bitten. The case rests on what the model adds.

**Recommended:** numbers from deterministic rules, prose from the model. That makes representcribing
instant, offline and free; it dissolves BF-198 (a full prescription becomes a pure function of the
same inputs rather than stored state the deload never recorded); and it makes sizing changes
replayable over history, which is the evidence BF-189 needs and cannot get from a non-deterministic
generator.

**One part is explicitly not a lane's to decide:** the rep→%1RM table values are the loads he trains
at, so they are calibration — Tuning proposes, the owner signs.

Left undiagnosed: how often the model's *phase* decision survives reconciliation, as opposed to the
four per-exercise numbers. That belongs in the plan doc, since a phase engine is the part that might
genuinely want judgement.
