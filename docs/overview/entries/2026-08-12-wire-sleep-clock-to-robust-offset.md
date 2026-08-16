# 2026-08-12 — Sleep/HR/temperature clock conversion wired to the robust offset (Q-71 code)

**Domain:** sleep · devices · platform — v1.292.1, JS/server-only (no APK rebuild)

Follow-up to the same-day investigation
([`entries/2026-08-12-oura-ble-anchor-drain-lag-investigation.md`](2026-08-12-oura-ble-anchor-drain-lag-investigation.md)):
owner reviewed the evidence (uniform −3 minute shift across 9 real nights, tested against the actual
shipped function before any code was written) and said yes — wire it in, and rewrite stored history
too, conditional on that evidence holding.

## What shipped

`aggregateOuraRawSamples`'s `toDate` (`lib/data/postgres/adapter.ts`) — the converter behind every
sleep session start/end, HR series timestamp, temperature sample, and `dayForDs` this rollup writes
— now resolves each ring `ds` via `resolveDsToMs` (Q-139's p10-of-lag robust offset over the whole
epoch's anchors) instead of `measuredAtMs` off a single newest anchor. The function now fetches the
full per-user anchor list (`getOuraClockAnchors`) once, alongside the existing single-anchor fetch
(kept only for internal cutoff/window-matching bounds that don't need display precision — the
35-day rollup window, the 14-day HR-series cutoff, workout-window proximity checks). The redundant
second `getOuraClockAnchors` call already in the function (feeding the steps path) now reuses that
one list instead of re-querying the table.

Falls back to the old single-anchor extrapolation only if `resolveDsToMs` somehow finds no anchor in
the current epoch — can't happen given the function already early-returns if no anchor exists at
all, kept as a defensive floor per the codebase's own "never silently compute a wrong time" rule.

## Verified before shipping, not assumed

- **Re-confirmed the investigation's real-data numbers right before merging**: anchor count in prod
  (2,844, epoch 2) was unchanged since the original measurement, so the same uniform −3 minute
  result stands.
- **Full local DB-backed rollup suite**: 21 files / 57 tests, including
  `oura-ble-sleep-anchor-drift.test.ts` — a regression test that specifically asserts sleep_start
  *changes* when a single clock anchor's `anchor_utc` is mutated between two rollup runs. Confirmed
  by inspection this stays valid under the new code: with exactly one anchor in the set,
  `resolveDsToMs`'s p10-of-lag offset reduces to the exact same arithmetic as `measuredAtMs` against
  that one anchor — the test's single-anchor scenario can't distinguish old from new by construction,
  and it passed unchanged.
- **Full repo suite**: 3,186 tests passed, 0 failures. Clean `tsc --noEmit`, clean `eslint` on the
  touched file (11 pre-existing unused-import warnings elsewhere in the same large file, confirmed
  via `git stash` diff, unrelated to this change).
- `check-push-mutations.js`, `check-reconcile.js`, `check-doc-links.js` all pass.
- Booted `pnpm dev` against the local seeded DB; home page and auth flow render cleanly (the
  redecode endpoint itself is session-auth-gated with no bearer-token path, so a non-admin local
  test user correctly gets 403 rather than proving anything about the code path — the DB-backed
  rollup tests are the real coverage for this function, called directly, not through HTTP).

## What this does NOT do yet

**Only future rollups get the corrected math.** No historical `sleep_sessions` rows were touched by
this change. Per the owner's decision, an admin **Redecode** (full, not the `dump` preview mode —
`POST /api/oura-ble/samples/redecode` with no `date` param) needs to run in production to rewrite
history. That endpoint only accepts a real session cookie, not the bearer-token admin path this
session already had access to, so it needs the owner to trigger it from the admin oura-ble tester.

## Not exercised

Not verified on-device (JS/server-only change, no native code touched, so this isn't expected to
need it). Not exercised through the actual HTTP redecode route end-to-end (blocked on session auth,
see above) — verified instead via direct repository-level tests, which exercise the exact same
function.
