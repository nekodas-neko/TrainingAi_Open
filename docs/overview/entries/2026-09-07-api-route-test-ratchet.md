## 2026-09-07 — The untested-route count was 93 and is really 148 (PS-39)

**Branch:** `test/api-route-coverage` · **Lane A**

### The number was wrong, by the mechanism the entry half-noticed

PS-39 said 93 of 219 routes were "referenced by no test in any layer", and observed in passing that
`calendar-data`, `training-load` and `streak-data` "appear only as cache-key strings in tests". Those
two statements do not sit together: if a cache-key string counts as a reference, then a
cache-invalidation test covers a route it never calls, and the 93 is measuring mentions rather than
tests.

Asking the honest question — does any test import the route's handler — gives **150 of 222**. That is
the number the ratchet ships with (148 after this PR's two).

### What shipped

**`scripts/check-route-test-coverage.js`, in the Custom Rules job** (now 69 steps). Shrink-only, the
house pattern: the count may only fall, and **a new route arrives uncovered and therefore fails.**
That last part is what earns its keep — the 148 are debt and will be paid down slowly; the 149th is
the one this stops.

**Two routes off the list, chosen for what their failure looks like rather than how often they run.**
Both are ingest routes whose breakage is silent:

- `health-connect/ingest` — the only unauthenticated write into `body_metrics`. CLAUDE.md's rule is
  that security checks **fail closed**: a missing key is a rejection, not a skip, because the Oura
  webhook once skipped verification when its header was absent. That is precisely the shape a
  refactor breaks with nothing going red, since the happy path keeps working. Pinned: a wrong
  secret, **no secret configured at all**, the `'' === ''` degenerate case, a body the schema
  rejects, and that a rate-limit trip is byte-identical to a bad secret (SEC-I3's oracle).
- `client-error` — the pipe that fills `error_events`, which CLAUDE.md calls the only view of faults
  that never reach a human. Its failure mode is an absence, so nobody would notice. Pinned: the
  per-column truncation, that a blank message is refused rather than filed as an empty bucket, and
  that a missing stack or url stays null instead of becoming `"undefined"`.

### Verification

- `lib/__tests__` + `app/api/__tests__` + `packages/shared`: **3462 passed**, 10 skipped.
- **Mutation-checked.** Changing the secret guard from `!expectedSecret ||` to `expectedSecret &&`
  — the exact fail-open a refactor would produce — fails two cases. Dropping `client-error`'s message
  check fails the blank-fault case.
- Each ingest case uses a fresh client IP, because the route rate-limits every attempt per IP and
  cases would otherwise throttle each other and pass for the wrong reason.
- `pnpm check:rules` — **Ran 69 of 69**, the new step included. `tsc --noEmit` clean.

**Not exercised:** the remaining 148, obviously — and the two that shipped are tested through mocked
repositories, so what is pinned is the routes' own guard logic rather than what the database does
with the rows.

### Two entries corrected while here

**PS-39 keeps its place in the queue and takes no `Keep:`.** The first draft of this write-up gave it
one, which OR-100 is precisely about: a `Keep:` files buildable work under a heading that tells the
lane not to look. The remaining routes are work, not residue.

**LA-76 moved below PS-39.** It had inherited LB-60's queue position on being filed an hour earlier,
and by its own text it is the occasional case in a feature with no surface yet — the same
position-inheritance that put LA-70 and LA-72 at the top of Lane A this morning.

No version bump: nothing user-visible.
