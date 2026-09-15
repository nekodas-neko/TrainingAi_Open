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

### C. Make the scoring declare what it consumed

5. **Every score returns its input provenance.** Sleep score already renormalises over present
   weights and readiness already has a Q-43 generic path — **the pattern exists; make it the rule.**
   Each score returns which inputs were present, which were absent, and what weight was
   renormalised away. **⛔ Not a new formula** — a return-shape change.
6. **Surface it once.** One component reads that shape wherever a score renders, so *"78 — computed
   without temperature or recovery index"* replaces a bare 78. The owner has asked what is behind a
   number repeatedly this quarter; this is the general answer.
7. **A CI check that a scoring module reads only generic tables.** Baseline the current violations
   rather than fixing them all at once — `readiness-payload.ts` is the only one, and TN-37 step 2
   removes half of it.

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
