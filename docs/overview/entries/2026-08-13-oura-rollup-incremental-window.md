# 2026-08-13 — the BLE rollup only re-derives what changed (Q-213 Stage 1, v1.303.0)

**Branch:** `perf/oura-rollup-incremental-window`

## What this fixes

The production stalls diagnosed earlier today
([handoff](../../handoff-2026-08-13-platform-production-event-loop-starvation.md)).
`aggregateOuraRawSamples` read, hex-decoded and re-derived a **35-day** window of
`oura_raw_samples` on every BLE ingest. The table holds **984,862 rows** against ~37 days of ring
history, so that window was effectively the whole table — re-processed from scratch to absorb the few
minutes a sync actually carried. One run outlasted the gap between syncs, so runs went back-to-back
and pegged the single Node main thread for 15–30 minutes, starving every other request on the
process, including routes touching no database at all.

The owner felt this as "scanning food takes so long". Their photo scan measured **200 in 129,073 ms**
— it worked; the phone gave up first.

## The change

`aggregateOuraRawSamples` takes an optional `sinceDs` that narrows the read to the span an ingest
touched. `redecode`, `fullHistory` and any caller that omits it behave exactly as before.

**This is an extension of the existing design, not a new mechanism.** The function was already built
for a bounded window: the EMA baseline fold already resumes from a persisted checkpoint before the
window (documented in-tree as byte-identical), `summaryFloorDate` already discards nights within 2
days of the cutoff as possibly-truncated, and the 13-day derived look-back already reads persisted
derived values rather than raw rows. 35 days was a conservative constant chosen when the table was
small, and it aged into a full-table scan.

The 3-day margin follows from that existing guard: `summaryFloorDate` sits 2 days inside the cutoff,
so the window must open ≥2 days before the first night we intend to rewrite, and a sleep window can
open the calendar day before it ends.

**The one genuinely dangerous coupling — and the reason this needed care.** The HR-series block
deletes every `source='ble'` row from `hrSeriesCutoffDs` forward and repopulates it from the windowed
read. Narrowing the read without narrowing that delete would wipe up to **13 days of HR history per
run**, with no raw rows left in scope to rewrite it. `hrSeriesCutoffDs` is now clamped to the read
cutoff, so the delete covers exactly what the pass can rebuild. That clamp is load-bearing and is
mutation-tested below.

The sleep-session delete needed nothing: it was already scoped to the wake-days it is about to write.

**Correctness of *what* gets rolled up** is handled on the route side, not by trusting the batch:

- `pendingSinceDs` accumulates the oldest un-rolled ring timestamp per user, so a batch skipped by
  the 8-second coalescing window is **skipped, never dropped** — whichever run happens next covers it.
- A run claims that span and clears it, so batches arriving mid-flight accumulate for the next run
  rather than being marked done by this one. A failed run puts its span back.
- `fullWindowDone` forces the **first run after a cold start to re-derive the whole window**, because
  a fresh process cannot know what an earlier one left un-rolled. One expensive pass per deploy
  instead of a permanent gap.

## Measured

Benchmark against a seeded 35-day table (24,535 raw rows, one night per day plus daytime IBI):

| | |
|---|---|
| Full window (35 d) | **10,560 ms** |
| Narrowed (`sinceDs` = 1 day ago) | **930 ms** |
| | **11.4×** |

Production carries ~985k rows — roughly 40× this fixture — and the full-window cost scales with the
table while the narrowed cost does not: it reads about one day regardless of history. So the
production gain is substantially larger than 11.4×, and unlike the old constant it stops growing.

## Verified

Four DB-backed tests in `oura-ble-incremental-window.test.ts` (in the `rollup` vitest project, so it
gets the 60 s timeout rather than the 5 s default):

- a full-window run produces both seeded nights and an HR series spanning both
- **a narrowed run does not destroy the HR series outside its window**
- a narrowed run leaves the older night's sleep row in place
- narrowed-then-full produces the same rows as full alone

**Mutation-tested where it counts:** removing the `hrSeriesCutoffDs` clamp fails two of the four —
the destruction test and the idempotency test. The test catches exactly the failure the clamp exists
to prevent.

Full suite green — 460 files, 3,787 tests. `tsc --noEmit` clean, lint clean (11 pre-existing warnings,
none from this diff), all 20 custom-rule checks pass.

## Not exercised

- **The S25, and the real ring.** The BLE plugin does not run in the sandbox, so the ingest path was
  exercised only through the route and the repository. On-device is the authoritative check for any
  BLE behaviour.
- **Production data.** The benchmark and tests run against a seeded local table with a synthetic
  shape; production has 40× the rows and real decoding variety. The first rollup after deploy will be
  a full-window pass by design — that one will still be slow, and that is expected.
- Native SQLite, safe-area insets, Samsung WebView — untouched; this change is server-side only, so
  it reaches the device through the Railway deploy with no APK rebuild.

## Still open

Stages 2 and 3 of the plan
([`plans/2026-08-13-oura-ble-rollup-incremental-and-off-loop.md`](../../superpowers/plans/2026-08-13-oura-ble-rollup-incremental-and-off-loop.md)):
move the run into a `worker_thread` so blocking is structurally impossible at any window size, and fix
the coalescing predicate, where `frames.length < 255` means "any batch" rather than "the drain's last
batch" and so bypasses coalescing on essentially every real batch. Stage 1 removes the pathology;
those two remove the class.
