# 2026-09-03 — LA-56: a redecode that finishes late can now say so

**Branch:** `claude/la56-late-result` · **Agent:** Implementation Lane A

The owner ran the `fullHistory` pass three docs had been waiting on. It was reaped as "abandoned"
after exactly 30 minutes having written nothing — the second such failure in four days. LA-56 filed
the blocker; this ships the half of it that could be verified in the sandbox.

**`finishRedecodeJob` discarded late results.** It filtered `isNull(finishedAt)`, which the reaper
has already set. So a run completing after the staleness window could not record its outcome: the
work would land while the record still said it had been abandoned. Given that *every* full-history
redecode ever attempted was reaped that way, a late success has never had anywhere to go.

**Letting it through alone would have traded one blind spot for another.** A late result would
overwrite the abandoned error and hide that the run exceeded the window at all. `reaped_at`
(migration **261**, views regenerated in **262**) keeps both facts — when the reaper gave up, and
what eventually came back. NULL means never reaped.

**An existing test caught a first, broader attempt, and it was right to.** Removing the guard
outright also removed the guarantee that finishing twice cannot overwrite a good result. The
predicate is now precise: an open row, or a reaped row that never got an outcome. A job that
genuinely finished and recorded a result stays immutable.

**The gating on LA-56 was too wide and that is corrected.** `oura-redecode-job.test.ts` already ran
the reaper against a real local Postgres, so these storage semantics were verifiable here all along
— only the worker's heartbeat stamping needs the device. Saying otherwise parked work that did not
need parking.

**Still owed, and it is the risky half:** `reapStaleRedecodeJobs` remains a pure `startedAt` age
check, so slow and dead still look identical. A `last_beat_at` the worker stamps, reaped on beat age,
is what separates them — and it stays `Verify: device` because if beats do not stamp in production
every job stays `running` forever and the one-at-a-time index blocks every future redecode. It wants
a total-runtime ceiling shipped with it.

**A migration-number collision, caught before it landed.** Another lane took 260 mid-session; these
renumbered to 261/262 above it. Worth recording because the regenerated views are built from the
local DB, so a lane's migration missing locally would silently drop its columns from the view
definitions — checked here, and main's 260 is a data delete with no schema change.

**Not exercised:** the device, and the failure this ultimately serves. No redecode was run — the
route needs an admin session this environment cannot mint. The new column has never held a value in
production, and will not until a full-history pass both outruns the window and finishes.
