# 2026-08-08 — Answering Q-11's open coverage question, and finding a constant

**Domain:** heart-rate / workouts — docs-only, no version bump

Q-11 carried an explicit instruction: *"Re-measure this specifically now that new sessions attribute
same-day, before concluding anything about device-side dropout rates."* That measurement had not
been run. This session ran it against production (`claude_ro.set_hr_stats`, 615 rows) and it answers
the question — and turns the entry's one-line side-check into a real finding.

## The open question: dropout, or artefact?

The entry recorded 79% `coverage_ok = false` and 67% NULL `peak_bpm`, and named the two candidate
explanations: genuine strap dropout during lifting, or contamination from days-late computes.
Splitting the table by `computed_at` separates them cleanly:

| computed_at | rows | coverage_ok | peak_bpm | readings_count = 0 |
|---|---|---|---|---|
| **2026-07-22** (the one-off backfill) | **508** | 74 | 138 | **334** |
| 2026-07-23 → 08-04 (recap-triggered) | 74 | 64 | 71 | 0 |
| 2026-08-06 (post-fix, same-day) | 24 | 18 | 23 | 0 |
| 2026-08-08 (post-fix, same-day) | 9 | 3 | 9 | 1 |

**It is the artefact.** 508 of 615 rows are that single backfill batch, run over old sessions whose
HR series was thin or absent — 334 of them have zero readings. Every aggregate treating the table as
one population was measuring that batch. Same-day computes since the Defect B fix carry near-complete
`peak_bpm` and no zero-reading rows.

No evidence of systematic device dropout. Nothing further to fix on that half of Q-11.

## The side-check turned into Q-149

The entry asked whether `rest_adequate` being true 245/245 meant the owner always rests enough or the
predicate is stuck. At n=278 it is neither — the predicate is **degenerate**:

- 278 non-null, **278 true**
- **271 (97.5%)** reached via the `bpmAtLog < 120 → true` shortcut; 7 via `hrr1 >= 15`
- `bpm_at_end` across the whole table: min 39, **max 128**, mean 94

`analyseHrRecovery`'s 120 bpm threshold assumes chest-strap-grade end-of-set HR. What the ring
records at set end **never once exceeded 128** — it power-gates when worn-idle and samples at 1/min,
so the nearest reading within ±90 s of the log is rarely near the true peak. The first branch absorbs
everything, and the flag never reaches the recovery question it is named for.

**Filed as Q-149 rather than fixed.** Both branches work as written; the input distribution is what
makes one of them constant. Choosing a new threshold — or a per-source one, or dropping the shortcut
and accepting ~2.5% coverage — is a calibration decision about what the app claims, the same shape as
Q-72 and Q-137. Three options are laid out in the entry with their costs. Recomputing would rewrite
278 stored verdicts, so no backfill either way without a decision.

## Also measured, recorded so it is not re-investigated

- **The B2 analysis blocker has eased, not cleared.** Rows joining to a following set: **92 → 108**.
  `pct_hrr_at_rest_end` accrues at ~10–13 per training day, so this is waiting, not re-engineering.
- **`source` is populated only from 2026-08-06 onward** (23/24, then 8/9), which is exactly when
  v1.260.0 shipped it. Expected, not a gap.

## Production error sweep (the standing session-start read)

Run in the same pass, since it is a standing instruction and 30-day pruning means an unrecorded fault
is a lost one:

- **`/api/readiness-score` failed again at 2026-08-08 03:26**, and `/api/sync/pull` twice at
  2026-08-07 20:42:35 — **two failures in the same millisecond, on different tables**, which is the
  fingerprint of a shared-resource failure rather than one slow query. Q-107's open half already owns
  this; no new entry. The cause capture shipped today (v1.270.10) annotates faults from now on, so
  these are the last undiagnosable ones.
- **React #418 has not recurred since the Q-73 fix.** Last occurrence 2026-08-07T20:53:02, and
  PR #1130 merged at **21:12:21** — 19 minutes later. Roughly 2.8 hours of post-deploy time has since
  fallen inside the bug's own 14:00–00:00 UTC window with zero occurrences. Encouraging, not yet
  conclusive.
- `/api/complete-workout#hr-sync` "fetch failed" ×4, latest 2026-08-06 22:11 — that code path was
  deleted today by Q-122, so those rows are now history rather than a live fault.

## Verification

Docs-only: no code changed, so no test/lint/build claim is being made beyond `check-doc-links: OK`.
Every number above came from a read-only query against production via the `claude_ro` schema and is
reproducible from the SQL in the backlog entry.

**Not exercised:** nothing on device, nothing in the app — this session read production and wrote
documentation.
