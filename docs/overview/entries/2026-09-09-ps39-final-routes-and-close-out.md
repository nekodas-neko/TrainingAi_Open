# 2026-09-09 — PS-39 closed: 0 of 222 routes uncovered

**Branch:** `test/final-ps39-routes` · **No product change.**

28 cases over the last three — `admin/battery-recovery-calibration`, `oura/hr-sync` and
`workout/backfill-set-hr-stats` — and the entry struck.

**The ratchet's baseline is now 0**, which is the end state it was built for: a new route arrives
uncovered and fails CI rather than joining a debt pile.

## `oura/hr-sync` is not what its path says

Checked before writing anything, because the Oura Cloud integration was removed on 2026-08-13 and a
route under `oura/` called `hr-sync` looks like a leftover.

It is not. The Cloud call is gone — the ring has been on our own BLE key since the 2026-07-07 re-key,
so that request could only ever earn a 401 — and the route is now a thin wrapper over
`syncAndAttributeSessionHr`, which attributes HR the BLE pipeline has **already ingested**. Live code
with a stale name.

**What it has none of is callers.** Every remaining reference across `app/`, `components/`, `lib/`
and `android/` is a comment or a test asserting it is *not* called: `complete-workout` used to POST
to it server-to-self, burning a second request worker and a second pool connection per completion
and failing outright ("fetch failed") nine times in production, until Q-122 replaced that with a
direct call. The route was left behind.

Filed as **LA-89**, tested and pinned rather than deleted. An HTTP endpoint can have callers this
repo cannot see — a curl in a runbook, a Tasker profile, an old APK — so the safe order is to confirm
nothing external uses it and *then* remove the route and its test together. That is the owner's call,
and it costs nothing to leave a tested 50-line route until someone answers.

The behaviour worth knowing, now pinned: **it answers `success: true` even when the pipeline
throws.** Deliberate — it was fire-and-forget from workout completion, and failing there would fail a
completed workout over heart-rate data the ring frequently has not drained yet. `readings: 0` carries
the truth; the flag does not.

## The sibling that deliberately has no lead-in

`battery-recovery-calibration` reads the same shape as `sleep-feel-calibration` and fetches **no**
extra history, where the sleep one fetches 28 days more than it reports on. That is right: battery
`end_value` is read as persisted, never recomputed, so the panel checks what the app actually served
rather than what a fresh run would produce — and a lead-in would be fetching rows it has no use for.
A mutant that adds one is caught, which is the only way that distinction stays true.

## Closing the entry

The count was PS-39's whole claim and it is 0, so no `Keep:` line: leaving a finished entry in the
queue to carry a caveat is what the "a finished entry must not still be in the queue" rule exists to
stop.

**But the entry carried a checklist that outlives it**, so it moved rather than vanished →
[`docs/route-test-fixtures.md`](../../route-test-fixtures.md): the fifteen fixture shapes that
passed review and were caught only by mutation, and what the ratchet does and does not measure. It
is linked from `docs/module-map.md` and named in the checker's own failure message, which is where
someone writing a new route test will meet it rather than having to know it exists.

The caveat that belongs there rather than in the queue: **a count is a floor on attention, not a
measure of it.** An import is not a test of behaviour — `admin/exercises` counted as covered on a
single guard assertion. No sufficiency check is proposed, because the threshold would be
indefensible.

## Mutation pass

**30 of 30 caught**, no anchor misses; the thirty-first is an equivalent mutant planted as a control
and survived as designed.

## Gate

`pnpm lint` 0 errors · `npx tsc --noEmit` clean · `tsc -p tsconfig.tests.json` clean · **Custom Rules
70 of 70** · `pnpm build` clean · full suite green · route ratchet **3 → 0**, verified by running the
checker · backlog baseline lowered 19,732 → 19,684.

**Not exercised:** the calibration builder, the HR computation and the attribution pipeline are all
stand-ins. No SQL, no ring, no device.
