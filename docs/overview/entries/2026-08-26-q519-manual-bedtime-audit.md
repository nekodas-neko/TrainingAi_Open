# 2026-08-26 — Q-519's own audit falsifies Q-519's design

**Lane A · branch `docs/q519-manual-bedtime-audit` · docs only**

Q-519 (manual bedtime entry for a night the ring missed) ends with an instruction rather than a
finding: *"audit whether any consumer recomputes duration/efficiency from the span; that audit is part
of this item, not a finding of the review."* And a warning: *"if anyone later recomputes duration or
efficiency from the span, this silently produces a 9-hour night at 34% efficiency."*

Run before implementing: **something already does.**
[`docs/reviews/2026-08-26-manual-bedtime-write-audit.md`](../../reviews/2026-08-26-manual-bedtime-write-audit.md)

- `aggregateNight` (`sleep-night.ts:225`) computes `timeInBed = last.sleepEnd − first.sleepStart` and
  `efficiency = totalSleep / timeInBed`. On the owner's own reported night that is 9.05 h and **34%** —
  the warning's number exactly. Guarded only by a single-window fast path, so it fires on a fragmented
  night, and Q-274 measures ten fragment rows in production. Seven consumers reach it via
  `nightSessions`.
- The daytime-HRV model classifies samples by window membership and is fed from **stored** rows, so
  five awake hours would enter its *nightly* training set. No fragmentation needed. That fit feeds
  daytime-stress, which feeds resilience — already open as Q-507/Q-508/Q-510.
- `primaryCluster` unions same-date rows within an hour of the window, so widening the start can pull
  in an evening fragment: the "7:40 pm bedtime" bug that function exists to prevent.

**One consumer looked affected and is not**, and that is worth as much as the three that are:
`stress-resilience.ts:104` runs the identical window test, but its windows come from the rollup's own
freshly-built rows, never from storage. Third wrong-source near-miss of the session, after
`recovery_index_hours` on the wrong table and `n_live_tup` against a real count. **Trace the value to
its writer before believing a consumer is affected.**

## The corrected design

A nullable `manual_sleep_start` on `sleep_sessions`, read by the bedtime estimate and nothing else. It
delivers the owner's stated outcome — *"I don't want it to change estimated bed time values"* — while
the measured window stays measured. It costs the migration the entry ruled out, and that ruling rested
on the premise the audit just removed.

The principle underneath: **the per-field merge exists to let a better *measurement* of the same
quantity win.** A remembered bedtime is not a better measurement of the observed sleep window — it is
a different quantity, and giving it the same column is the entire cause.

## Also fixed: two ordering constraints that were prose

- **Q-294** sat at READY #3 while its own body says *"Do not start this as a standalone item"*. Its
  four cells each need an owner decision on intended behaviour first, so it now carries `Gate: owner`
  and the queue tool stops offering it.
- **Q-520** said *"Do Q-519 first"* in prose; it now carries `Needs: Q-519`, so it parks behind its own
  prerequisite instead of being offered above it.

Both are fields the protocol already has. The general "notes should leave READY" sweep remains the
Orchestrator's.

## Not done

The implementation. Q-519 stays in the queue carrying the corrected design and the shape it needs.
