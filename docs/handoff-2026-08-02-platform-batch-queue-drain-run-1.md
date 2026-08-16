# Handoff — batch queue drain, run 1 (items 1–9)

_Date: 2026-08-02 · Domain: `platform` (touching `devices`, `readiness`, `workouts`, `sleep`) ·
Continues [`docs/handoff-2026-08-02-platform-batch-queue-drain.md`](handoff-2026-08-02-platform-batch-queue-drain.md),
whose run-list this worked top-down._

**Do not start a second device checklist.** The one in the parent handoff is the only one; four
items were appended to it this run.

## What shipped

| # | Item | PR | Version | State |
|---|---|---|---|---|
| 1 | **Q-43** Health Connect as a first-class source tier | **#994** | 1.250.0 | Merged |
| 2 | **Q-38** phase transition emptied the prescription card | **#995** | 1.250.1 | Merged |
| 3 | **Q-39** Body Battery anchor flipped mid-morning | **#996** | 1.250.2 | Merged |
| 4 | **Q-40** chest-strap card stuck on "Connecting…" | **#997** | 1.250.3 | Merged |
| 5 | **Q-35** `oura_raw_samples` footprint | **#998** | docs-only | **Not built — retired** |
| 6 | **Q-31 re-scope** Oura-IP triage plan | **#999** | docs-only | Merged |
| 7 | **Q-28** `applyDelta` bridge crossings | **#1000** | docs-only | **Not built — deprioritised** |
| 8 | **Q-41** activity payload: HR on every activity, zero distance accepted | **#1001** | 1.250.4 | Merged — **finding 1 still open on an owner decision** |
| 9 | **Q-33** admin raw-store status card | **#1002** | 1.250.5 | Merged |

**The owner bug batch (Q-36 … Q-40) is closed as an implementation queue** — all five shipped.
What remains of it is device verification.

## The two that came back "don't build it"

Both were "measure first" items, and production read-only SQL (owner decision 3) is what made the
measurement possible. Both are worth knowing about because the plans were confidently wrong.

**Q-35.** Finding 1 (stop JSON-decoding two motion tags) was already done — `insertOuraRawSamples`
hard-codes `decoded: null`, and **0 of 740,966 production rows carry a decoded value**. Finding 4
(a sha256 generated column to shrink the dedup index) was backwards: `body_hex` averages 24
characters, a sha256 is 32 bytes, so the key would get *wider*, plus 32 bytes/row of new heap and
an `ACCESS EXCLUSIVE` rewrite of a 452 MB table at deploy. Its stated sizes were ~10× stale (306 MB
of indexes, not ~30 MB).

What the numbers *did* show: `n_tup_upd` 1,324,792 against 740,966 rows with **19** HOT updates,
because `redecodeOuraRawSamples` re-stamps the **indexed** `measured_at` unguarded. ~130 MB of the
306 MB is bloat. Filed as **Q-46** (one `IS DISTINCT FROM` clause) plus a `REINDEX` on the owner
console checklist.

**Q-28.** A full restore is **≈1,800 rows** across `applyDeltaBody`'s twenty domains — the "few
hundred" end of the item's own scale, not five figures. Deprioritised, not deleted. The useful part
is the tripwire: `oura_heartrate` is **37,950 rows**, *is* mirrored locally, and is **not** one of
the twenty delta domains. Add any high-cardinality timeseries to the delta and Q-28 becomes urgent
in the same PR — most likely via Q-29 D2.

## Decisions worth not re-litigating

**A Health Connect hypnogram is all-or-nothing.** `sleep_phase_5_min` is positional with four codes
and no way to say "unstaged", while HC can emit `SLEEP_STAGE_SLEEPING`/`UNKNOWN`. Skipping a gap
shifts the night; filling it invents a stage. So `intervalsToPhase5Min` returns null unless every
bucket is covered, and the caller keeps its four honest totals.

**`saveSleepSession`'s `source` is required, not optional.** The plan suggested defaulting it. A
caller left on a default writes rank-0 and beats the ring forever. There is one caller; required
costs nothing and closes the hole permanently.

**A cold baseline is refused, not used.** Two samples of a steady 50 bpm fold to mean 25 / dev 3.1
and produce z = 8, which the composite reads as a flawless day. `trailingBaselineZ` holds out until
`BASELINE_MIN_NIGHTS` priors accrue. Found by a test written to assert the opposite.

**A frozen Body Battery anchor stays frozen even when readiness is later recomputed.** A logged
check-in changes readiness; honouring it would reintroduce the same mid-day jump through a smaller
door.

**`advancePhase` was left alone** for Q-38. It has a second caller (the accepted-deload path) that
re-stores the prescription and writes its own status; a transition-specific meaning does not belong
in a generic phase advance.

## What is NOT verified

- **Q-43's Health Connect ingest has never run against a real provider.** Owner has HC off, no
  second device. Unit-tested against fixtures; `projectOverview.md` row names each unexercised
  surface.
- **Q-40's Kotlin did not compile locally** — no Android SDK in the sandbox (`npx cap sync android`
  works; `./gradlew compileDebugKotlin` fails at "SDK location not found"). **CI's Android job is
  the compile gate and passed.** None of the connected/retrying/stopped labels have run against a
  real strap, and E3 needs the new APK.
- Q-38 and Q-39 are pure TypeScript with no native surface, verified end to end in a real browser
  at the S25 viewport. No device gate applies to either.

## Also from items 8–9

**Q-41 finding 4 was unanswerable and is re-filed as Q-47.** It asked whether the 60 spm cadence
floor rejects real slow walks. Production: **0 of 42 activity rows carry a `cadence_spm`**, while 3
carry a `cadence_series`. Nothing has ever reached the floor.

> **Correction (2026-08-02, run 2).** The second half of that paragraph originally read *"the real
> question is why the scalar is null on rows whose series is populated"*. Those three series are
> **empty arrays** — `jsonb_array_length = 0`. I counted them with `IS NOT NULL`, which an empty
> jsonb array satisfies. Nothing was dropped; cadence has never been captured at all. The
> empty-array write is fixed in v1.250.10; the capture question is a device check on the checklist.

**Q-41 finding 2's stated mechanism was inverted.** It said runs and walks never store HR because
the save screen gates on treadmill. The gate is real, but production has HR on 15 of 30 walks (via
the Health Connect enrichment) and **0 of 2 treadmills** — the one type the code path was written
for. The fix turned out to be small: a mount effect already fetched `/api/oura/hr-window` for every
type and was discarding the `avgHr`/`maxHr` it returns.

## Left on the run-list

Items **10–13**, untouched: Q-29 D2 Task 5 (port the rollup — large, needs APK) · Q-10 (degenerate
sleep rows) · `sleep_sessions.oura_id` user-scoping · Q-34 (sleep-staging upgrades).

**Q-41 stays open** carrying only finding 1, which is an owner decision (below), not effort.

**One caution on Q-10 before someone takes it as "small".** Its entry says *"skip/floor
sub-20-minute sessions in the night-selection path"*. A blanket 20-minute floor is probably wrong:
`groupSleepPeriods` merges short night windows into fragmented nights on purpose, so a floor would
discard genuine fragments. The safe target is the *degenerate* row specifically — `duration_hours`
0/null with all stages 0 — not everything short. Worth 10 minutes of thought, not a mechanical
edit.

## New backlog entries from this run

- **Q-45** (🟢) — a provisional readiness contributor renders its *weight* where a score should be:
  "Resting heart rate 88" with no resting-HR data. Pre-existing, but Q-43 routes many more users
  through the provisional path.
- **Q-46** (🟠) — the `measured_at` re-stamp guard described above.
- **Q-47** (🟡) — `cadence_spm` has never been stored though `cadence_series` has.

## Owner decisions now blocking work — all three on the parent handoff's checklist

1. **Public repo: fresh `git init`, or a push of this history?** Decides whether `.gitignore` is a
   real strategy for 43 MB of Oura model assets or a false comfort.
2. **`steps-motion-decoder`: protocol decode or model constants?** The code cannot settle it.
3. **Training calendar: merge unsynced local activities, or a second sanctioned server-aggregate
   exception?** (Q-41 finding 1.) Both are defensible and lead to different architectures.

## A note on the prod read-only endpoint

It uses a `max: 2` pool. Sustained querying across a session exhausts it — late in this run it
started returning `Forbidden` and then connection timeouts, and recovered after a pause. Batch
queries into fewer round trips rather than exploring interactively, and treat an error as "back
off", not "access is broken" (a `SELECT 1` still succeeded throughout).

## Pickup prompt

```
You are continuing a batch queue-drain on TrainingAI. Run 1 (items 1–7) is done.

Read in this order:
1. projectOverview.md — Current Status and the Known Issues rows dated 2026-08-02
2. docs/handoff-2026-08-02-platform-batch-queue-drain.md — the owner's four unblocking
   decisions, the run-list, and the SINGLE owner device checklist (do not start a second one)
3. docs/handoff-2026-08-02-platform-batch-queue-drain-run-1.md — what run 1 shipped and why
   two items came back "don't build it"
4. docs/implementation-backlog.md — the queue protocol

First action: take run-list item 10 (Q-29 D2 Task 5, large, needs an APK) or — if you want a
smaller start — item 11, Q-10. Read the Q-10 caution above before treating it as mechanical: a
blanket 20-minute floor would discard genuine fragmented-night windows, so target the degenerate
row (duration 0/null with all stages 0), not everything short.

Constraints you would otherwise rediscover:
- Production read-only SQL works from the sandbox: POST to
  https://trainingai-production.up.railway.app/api/admin/db-query with
  Authorization: Bearer $CLAUDE_DB_QUERY_SECRET and {"sql":"SELECT ..."}. CLAUDE_DB_READONLY_URL
  being unset locally is expected. Note the claude_ro views are ONE user's rows, and
  pg_relation_size needs an explicit public. prefix to see real table sizes.
- USE IT BEFORE BUILDING any "measure first" item. Two of them (Q-35, Q-28) were retired this
  run because the real numbers contradicted the plan. Re-verify before implementing, always.
- Next free Postgres migration number is still 166 — it was claimed for Q-35 and not used.
- Kotlin only compile-gates in CI; there is no Android SDK in the sandbox. Say so plainly rather
  than claiming a local compile.
- The full test suite takes ~100s and the DB-backed files are flaky in parallel — re-run a
  failing file alone before reporting it, and stop any pnpm dev server first.
- Merge policy: feature branch, pnpm dev exercising every changed route and flow, CI green, then
  merge without asking — except destructive/irreversible changes, which are confirm-first.
- Every PR needs its journal entry (a NEW file in docs/overview/entries/), projectOverview.md
  update and version/changelog bump committed BEFORE the merge fires.
```
