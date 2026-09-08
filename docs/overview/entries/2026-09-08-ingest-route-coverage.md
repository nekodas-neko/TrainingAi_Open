## 2026-09-08 — Three more routes off the untested list, and a timezone test that tested nothing (PS-39)

**Branch:** `test/ingest-route-coverage` · **Lane A**

### What shipped

23 tests across three routes; `BASELINE` **145 → 142**.

- **`lib/__tests__/colmi-samples-route.test.ts`** — the Colmi R09's only way in, and the routes whose
  guarantees break *silently*. Pinned: an implausible sample is **dropped, not batch-rejected** (the
  poison-pill rule — a 400 makes the client swallow the sync and lose it); a future-dated sample is
  refused (Q-56, where real sensor data landed on future rows); the local day comes from the
  session's timezone rather than the server clock; a night is filed under the day it **started** in;
  and **raw frames are written unfiltered even when every decoded sample is discarded**, which is the
  archival guarantee the whole redecode strategy rests on.
- **`lib/__tests__/program-week-hr-day-routes.test.ts`** — `program-week` picks between three answer
  shapes (`cycle` / `tenure` / null) and nothing else said which inputs select which; `oura/hr-day`
  builds its window from the user's timezone, accepts the slash form the client actually sends, and
  400s a malformed date instead of throwing on the arithmetic.

### Two things the tests got wrong first, both caught by checking rather than reading

**A timezone test that would pass against a hardcoded timezone.** The first draft asserted
`oura/hr-day` builds its window in "the user's timezone" — using a session set to Brisbane, which
*is* `DEFAULT_TZ`. Replacing `session.user.timezone` with `DEFAULT_TZ` passed all 14 tests. The case
now runs in `America/New_York` and additionally asserts the window differs from the default zone's,
so it cannot go vacuous again. **A timezone test written in the default zone tests nothing** — and
the only reason this surfaced is that the mutation was run.

**A bound tested on the path that never breaks.** The over-long sleep segment (migration 260's
8.9-hour night stored as 19.1) is caught by Zod on the *client* path, so asserting it there proves
nothing about the route. The route restates the bound because a **server-decoded** segment meets no
schema at all — so the decoder is stubbed and the case now drives that path, which is the half that
actually broke. Both are now covered, separately.

### Verification

- `pnpm check:rules` — **Ran 70 of 70**. `tsc --noEmit` clean, `check-test-typecheck` at baseline,
  `pnpm build` exit 0, full suite green.
- **Mutation-checked four ways**: writing raw frames only when samples survive fails the archival
  case; batch-rejecting an implausible sample fails the poison-pill case; dropping the `cycleCurrent`
  clamp fails the "never past the total" case; hardcoding `DEFAULT_TZ` fails the timezone case — the
  last only after the fixture was moved out of the default zone.

**Not exercised:** all three run against mocked repositories, so what is pinned is each route's own
filtering and assembly rather than what Postgres stores. `colmi/samples` is additionally tested with
the decoder stubbed, so the frame→payload mapping itself is covered by its own tests, not these.
`oura-ble/samples/*` — the last and largest of the ingest routes — is still uncovered.

No version bump: tests only.
