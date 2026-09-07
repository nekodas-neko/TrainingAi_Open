## 2026-09-07 — Three of the home screen's aggregate routes get their first real test (PS-39)

**Branch:** `test/home-aggregate-routes` · **Lane A**

### Why these three, out of 148

PS-39's entry named `calendar-data` and `training-load` as the routes that *looked* covered and were
not — they appear in tests only as cache-key strings, which is the exact mechanism that made the
original count read 93 instead of 150. Paying them down first closes the loop on the finding rather
than picking the easiest remaining route. `muscle-recovery` came with them because it is the third
card on the same screen and shares the mocking shape.

`lib/__tests__/home-aggregate-routes.test.ts` — **14 tests**. `BASELINE` in
`scripts/check-route-test-coverage.js` goes **148 → 145**.

### What is actually pinned

Contracts, not maths — `computeVolumeAcwr` and `acwrBand` have their own tests. Two are worth
stating because a plausible refactor breaks them silently:

- **`training-load` sends a banded `interpretation`, and the client never re-derives the
  thresholds.** That is One Formula, One Place verbatim, and it only holds if the route actually
  sends one. Also pinned: `insufficient_data` rather than a guess on no history; that `monotony` is
  independent of the ACWR gate (it needs a week, not four); and `baselining` +
  `baselineDaysRemaining` while a new program's chronic window still contains the previous
  routine's sessions.
- **`calendar-data` validates the year/month range *before* it authenticates.** An out-of-range
  request is answered identically signed in or out, so the route never becomes a way to probe for a
  valid session. Tidying it into the usual auth-first shape would change that, and nothing else in
  the repo says so.

One test pins a behaviour I would rather have fixed than pinned: `training-load` resolves a
program's start as `startedAt ?? createdAt`, while readiness (PS-28) uses `startedAt` else Infinity
and so never baselines. The owner's active program has `started_at = NULL`, so on live data the two
disagree today. The test says which one this route does and names PS-28 as the thing that has to
update it — a disagreement recorded is cheaper than a disagreement discovered.

### Verification

- `lib/__tests__` + `app/api/__tests__`: **1288 passed**.
- **Mutation-checked.** Dropping the `interpretation` field, removing the baselining gate, and
  hardcoding Brisbane instead of threading `session.user.timezone` into `getCalendarData` each fail
  exactly the case written for them. The timezone one is the one that matters: it is the Q-144
  shape, where every workout files a day late for anyone outside Brisbane.
- `pnpm check:rules` — **Ran 69 of 69**. `tsc --noEmit` clean.

**Not exercised:** all three run against mocked repositories, so what is pinned is each route's own
guard and assembly logic, not what Postgres returns. The remaining 145 are untouched; of the
actionable core, `program-week` and the ingest routes (`colmi/samples`, `oura-ble/samples/*`,
`oura/hr-day`) are what is left.

No version bump: tests only.
