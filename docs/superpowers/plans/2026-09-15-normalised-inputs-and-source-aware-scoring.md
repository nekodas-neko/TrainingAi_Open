# Plan: finish the normalise layer, then make the scoring declare its inputs

_2026-09-15 (TN-38). Written by Tuning, **propose-only** — Lane A and Lane B build it._

_Read first: [`docs/data-source-connector-guide.md`](../../data-source-connector-guide.md) §3–§6 is
the contract. This plan does **not** redesign it; it finishes it and makes it checkable. Companion to
[`2026-09-14-data-source-connector-interface.md`](2026-09-14-data-source-connector-interface.md)
(PS-40, the registry) — that plan types *which sources exist*, this one fixes *what happens to their
data*._

## Why now

The owner asked to *"work on getting some normalised inputs; then creating our scoring system on
it."* The input layer already works for the 16 fields in `body_metrics`, and a second source is
**live today, not hypothetical**: over 45 days `oura_heartrate` holds **74,860 chest-strap samples
against 12,673 ring samples** — the strap outnumbers the ring six to one.

**⚑ And the owner will not use Health Connect — other users will** (2026-09-15). That is the
difference between an internal tidy-up and a product requirement: **the app has to be good on basic
sources alone**, with the ring as refinement rather than as the floor. It also means **B's value
cannot be measured on the owner's account** — a Health-Connect-only test user is needed.

**The steps example the owner gave is already correct, and is the template.** The ring decodes frames
into a step count and writes `body_metrics.steps` through the same method any source calls; nothing
downstream knows it came from a ring. **The same is already true of `hrv_ms`, `resting_heart_rate`
and `spo2_pct`.** The measurement layer does what he describes. **It is the derived/score layer that
does not** — that is TN-37, and it is where this plan's weight sits.

## The finding this plan exists for: normalisation is implemented THREE ways

Each is individually sound. Nothing names them as one concept, so a new connector's author has to
discover which applies to the data type they supply.

| data | mechanism | merged at | multi-source today? |
|---|---|---|---|
| `body_metrics` scalars | `source_map` + `SOURCE_RANK`, `mergeSet` | **write** | **yes** — `oura_ble` ×4 fields, `scale_ble` ×12 |
| `oura_heartrate` series | `preferStrapBuckets` (10 s buckets, strap wins) | **read**, inside `getHrForWindow` | **yes** — strap 74,860 / ring 12,673 |
| `oura_daily_derived` | **none — single writer** (`rollup-io.ts:83`) | — | **no.** No other source can reach it |

**Three mechanisms, three lifetimes, one concept.** §5 of the guide describes the *stages* (decode →
normalize → write) and never says that the merge step has three different implementations depending
on what you are writing.

## Tasks

### A. Name the three mechanisms in the guide (docs-only, do this first)

1. **Add §5.x: "which merge governs which data type"** — the table above, with the rule that decides
   it: **scalars merge at write by rank; series merge at read by resolution; derived rows have one
   writer.** Then amend **§5.4**, whose invariant is false as written (TN-37).
2. **Extend §3's catalogue** so each data type names its merge mechanism alongside its shape. A
   connector author reads §3 to know what to write; that is where the answer belongs.

**⛔ Do not skip to B.** A written contract the code does not hold is worse than none — this is
TN-37's argument and it applies to its own fix.

### B. Close the two filed normalise gaps

3. **PS-41 — Health Connect's `HeartRateSeries` never reaches `oura_heartrate`.** It arrives in the
   sync payload, enriches `activity_logs.avgHr/maxHr` inline, and is discarded. Normalise it into the
   series table like any other source. **Unlocks Activity Score's `zoneMinutes` (10%) and `moveHours`
   (12%) for a non-ring user — 22% of the formula.** `preferStrapBuckets` already handles the
   three-way merge; **verify it does, rather than assuming** — it was written for two sources.
4. **PS-42 — the illness radar is gated on an Oura row, not on its inputs.** The formula already
   renormalises over whatever is present; its only caller computes it *only if* an
   `oura_daily_summary` row exists. Move the gate onto the inputs. **Formula untouched.**

### C. Split every score into a CORE and ADJUSTMENTS — the owner's tier model

**⚑ This replaces "degrade gracefully", which is what the code does today and is not the same thing.**

**Owner, 2026-09-15:** *"ideally we have whatever data we can get from basic sources like health
connect; and have its own rating/scoring system. Then have our extra data we pull from oura give us
more fidelity and adjust the scores more. So app works fine with less sources but is more accurate
and tuned with more sources."*

**Today's behaviour is renormalise-on-absence**, and `sleep-score.ts:399` says so outright:
*"contributors are included only when their input is present, and the weighted mean is renormalised
over the included weights."* Readiness does the equivalent by passing a neutral 50.

| | renormalise-on-absence (today) | core + adjustments (the owner's) |
|---|---|---|
| formula | `Σ(present w × sub) / Σ(present w)` | `clamp(core + Σ adjustments)` |
| adding a sensor | changes the **denominator** — the whole score shifts | **adds an adjustment**, core untouched |
| two users' 78s | computed from **different weight sets** — not comparable | **the same quantity**, differently refined |
| explainability | a contributor is inside a mean; no delta exists | *"78 — core 74, +6 HRV, −2 SpO₂"* |

**The decisive argument is the second row.** Under renormalisation, connecting a ring changes a
user's score for a reason that has nothing to do with their body. Under core+adjustments it moves by
a stated amount, for a named input. That is the owner's *"works fine with less, more accurate with
more"*, made literal — and it is also the general answer to *"why is this number what it is"*, asked
repeatedly this quarter.

5. **Define the CORE input set per pillar** — the inputs any basic source or manual logging can
   guarantee. **⚠ This is the one genuine design decision in this plan and it needs the owner**;
   everything else is mechanical. A starting proposal, to be argued with rather than accepted:
   sleep duration and stages · steps · active calories · logged workout volume · resting HR · the
   daily check-in.
6. **Every score returns `{ core, adjustments[], final, missing[] }`** — each adjustment a signed
   delta with the input that produced it. **⛔ Not a new formula**: the core keeps today's curves,
   and the optional contributors become deltas instead of mean-members.
7. **Surface it once.** One component renders that shape wherever a score appears.
8. **A CI check that a scoring module reads only generic tables.** Baseline the current violations
   rather than fixing them at once — `readiness-payload.ts` is the only one, and TN-37 step 2 removes
   half of it.

**⚠ Re-scoring risk, and it is the reason this is `Gate: owner`.** Changing from a renormalised mean
to core+adjustments **moves every stored score**, including history. The 2026-08-24 history policy
applies — leave stored days and stamp the new model. **Size it before building**: TN-5's calibration
work is the precedent for how far a blend change reaches.

### D. Then, and only then, the ring-only pillars

8. **Record, per pillar, what a non-ring user actually gets** — from §4, which already traced it.
   **⚠ Do not plan to "normalise" these; several cannot be.** Chronic stress, resilience, daytime
   HRV, Body Battery and the OTS score read raw BLE frames with **zero fallback branches anywhere in
   the call chain**, and readiness's temperature contributor (0.10) passes `null` on every generic
   path. Making those source-neutral means re-implementing vendor models, which is a project and not
   a task.

## Sequencing, and why

**A → B → C → D.** A is docs-only and unblocks nothing, which is exactly why it goes first: it is
the cheapest step and every later task is checked against it. B delivers the only *user-visible* win
available today (22% of Activity Score for a non-ring user). C is where the owner's real goal lands
— a score that says what it was built from. D is honest scoping, not work.

## Non-goals

- **Renaming the `oura_*` tables.** [`2026-08-02-de-oura-naming.md`](2026-08-02-de-oura-naming.md)
  owns that, says it needs its own plan, and is right — six tables, cache keys and invalidation
  groups.
- **A runtime plugin system.** PS-40's non-goal, inherited.
- **Re-implementing any vendored model.** See D.
- **Changing any scoring formula.** C changes return shapes and callers, not maths. **Tuning does not
  ship scoring changes and this plan does not propose one.**

## What could make this wrong

- **`preferStrapBuckets` at three sources is untested.** It was written for strap-vs-ring. Task 3
  must prove the three-way case rather than extend it on faith.
- **Health Connect writes nothing today** — zero `health_connect` entries in `source_map` over 30
  days. B's value is real but **latent until the owner connects it**; if that is not planned, B drops
  below C in priority. **Ask before starting B.**
- **The `oura_daily_derived` single-writer design may be correct.** If everything in it is genuinely
  ring-derived, the fix is documentation (task 8), not plumbing. **Task A.1 should settle which,
  before anyone plans to change it.**
