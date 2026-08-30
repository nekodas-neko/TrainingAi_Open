# 2026-08-30 — Q-225: the stale sleep window, closed — the guard existed, the test did not

**Branch:** `fix/sleep-truncation-guard-test` · **Lane:** A · **Domain:** sleep

## What Q-225 was

The owner reported a displayed bedtime of **1:15am** for a night the ring's own data puts at 22:40 —
a 2h35m gap, too large for the anchor-lag bug (Q-71/Q-139, ≤3 min). A full local reproduction at the
time proved `aggregateOuraRawSamples` computes the *correct* window from the real raw frames, so the
stored row was wrong and nothing was self-healing it. The entry's leading hypothesis was an
**asymmetric truncation guard**: the daily-summary fold refuses nights near the read cutoff, and the
`sleep_sessions` write had no equivalent — so a front-clipped pass would replace a correct row rather
than merely fail to improve it. A guard plus four test cases were attempted on 2026-08-14 and
**withdrawn**, because none of the three fixture generations discriminated.

## What was actually true on `main`

**The hypothesis was right and the guard has since shipped.** `lib/oura-ble/rollup/run.ts:230`:

```ts
.filter(w => rollupCutoffDs == null || w.startDs >= rollupCutoffDs + MAX_SLEEP_DS)
```

The rollup also moved out of `adapter.ts` into `lib/oura-ble/rollup/run.ts` since the entry was
written, so its line references (`~5523`, `~5824`, `~5064`) no longer resolve.

**But the guard had no test.** Neutralising that filter left **all 23 rollup files and 68 tests
green** — so any refactor could have deleted it and nothing would have said so.

**And the owner's row is repaired.** Production now reads 2026-08-13 as **22:50 → 08:05 (8.17 h)**
against the reported 1:15am / 6h05m, with a different `oura_id` — consistent with a re-derived
window, and matching the 22:40→08:05 the original local reproduction computed.

## What shipped

`lib/data/postgres/__tests__/oura-ble-sleep-truncation-guard.test.ts` — three cases, and it fails
without the guard. It differs from the three withdrawn attempts in the two ways that matter:

1. **No `bedtime_period` (0x76) event.** That event carries an explicit `bedtime_start_ds` and is
   stamped at the night's *end*, so it survives any narrowing — a night carrying one **cannot**
   exhibit the bug. The owner's night had none, which is why clustering is what gets cut. The
   existing `oura-ble-incremental-window.test.ts` helper seeds one, so it was the wrong template.
2. **The cutoff is placed inside the night deliberately.** `rollupCutoffDs` is `sinceDs − 3 days`
   (the margin `summaryFloorDate` needs), so a `sinceDs` near the night leaves the cutoff days clear
   and nothing clips. Here `sinceDs = nightStart + 3 days + 4 h`, landing the cutoff four hours in.

A second night placed *after* the cutoff is the control — without it, "no short row exists" would
pass just as well against a run that wrote nothing. It has to be newer, not older: a night before
the cutoff is never read, so it would prove nothing.

**Under mutation the fixture reproduces the reported signature exactly** — bedtime moves forward
4 h (21:00 → 01:00) and the night shrinks **7.83 h → 3.83 h**, while the control night is untouched.

The test asserts on the **window** (`sleep_start` → `sleep_end`), not `duration_hours`: the latter is
time-asleep from the neural stager and reads 0 in this sandbox, where the sleepnet model is absent.

## The sweep the entry asked for

All **67** BLE-era nights checked for the clipping signature (a late start against a normal wake).
14 windows are under 6 h; 13 of those are daytime naps or evening fragments. The single
night-shaped candidate — **2026-08-19, 04:35 → 08:38** — is **not** truncation: `oura_heartrate` has
a genuine seven-hour hole from 21:00 to 04:00 that night, so the ring recorded nothing to clip.

**No other night was affected.**

## A premise this corrected in a neighbouring entry

Q-274 (fragment nights) was sharpened against Q-225 and cites 2026-08-11 and 2026-08-13 as dates
where a fragment is *"the ONLY record for this date"*. **That is no longer true for either** — both
now carry a full night beside the fragment (08-11: 8.50 h + 0.00 h; 08-13: 8.17 h + 1.42 h). Across
the whole BLE era exactly **two** dates have no full-night row: 2026-07-07 (the re-key day) and
2026-08-19 (the night above). So Q-274's problem 2 does not currently reproduce anywhere; its
problem 1 — that 0.00 h rows are written at all — is untouched. Recorded in its entry rather than
left in this journal.

## Files

- `lib/data/postgres/__tests__/oura-ble-sleep-truncation-guard.test.ts` — new, 3 tests.
- `projectOverview.md` → `docs/overview/known-issues-resolved.md` — the Known Issue moved whole.
- `docs/domains/sleep/README.md` — the pillar's Q-225 bullet marked closed.
- `docs/implementation-backlog.md` — Q-225 removed; Q-274's stale cross-reference rewritten.

## Verification

`pnpm check:rules` — **Ran 62 of 62**, all passed. Rollup project **24 files / 71 tests** green with
the guard in place. The guard mutation-tested both ways: green suite before the fixture existed,
2 of 3 new cases failing with the guard removed, all 3 green with it restored. Production readings
taken through `/api/admin/db-query`.

**Read the production numbers with their scope:** `claude_ro` is row-scoped to one user, so "all 67
BLE-era nights" means all of **the owner's** — which is the right scope here, since the ring and the
report are the owner's, but it is not a statement about anyone else's data.

**Not exercised:** no runtime surface and no device path changed — this adds a test and moves docs.
No device check owed, no version bump.

## Not closed by this

Confirming the DB-pool-contention causal link against Railway's own logs. That was never Q-225's to
answer — the `[platform]` Q-107 row carries it, and still does.
