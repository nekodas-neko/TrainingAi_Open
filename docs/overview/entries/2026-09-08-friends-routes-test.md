# 2026-09-08 — the social graph gets tests (PS-39)

**Branch:** `test/friends-social-graph` · **Lane:** A · tests + docs only, no product code.

## What shipped

`lib/__tests__/friends-routes.test.ts` — 25 cases across `friends`, `friends/[id]`, `friends/feed`
and `profile/[userId]`. Batched because they are **the one place in this app where one user's data
can reach another**, and they verify as a set: a friendship is created by the first, accepted by the
second, and is the only thing that unlocks the other two. Everywhere else is single-user, so an
ownership slip shows the caller their own data; a slip here shows them someone else's.

The invariants that carry that weight:

- **`profile/[userId]` refuses a non-friend before it reads anything.** The friendship check is the
  entire boundary — there is no row-level filter behind it, the queries take the requested `userId`
  verbatim — so the 403 must land before any of them run. Pinned by the reads that must *not*
  happen: no `db.select`, no `db.execute`, no `computeAchievements`.
- **The response is an explicit field list, not the row it read.** `db.select()` fetches the whole
  `users` row, email and auth columns included. The fixture puts a real-looking address in that row
  and the case asserts it appears nowhere in the response body.
- **The caller's id comes from the session, never the body.** `friends/[id]` passes
  `session.user.id` into accept/decline/remove; the case sends a body naming a different user and
  asserts the session id is what reaches the repository.
- **`friends/feed` scopes to the caller's own friend ids** and short-circuits to an empty feed
  without querying at all when there are none. It also drops an event whose author is not in the
  friend set rather than labelling it "Unknown", and omits a session started but never completed.
- **The friend-request rate limit is a security control, not a courtesy.** The route's own comment
  says the 201/400 split lets an account enumerate registered emails, which makes 10-per-15-minutes
  load-bearing.

Also pinned: a repository refusal keeps its own status (409, 404) and is not recorded as a server
fault, while an unexpected driver error is hidden behind a generic message *and* reported — the
fixture uses `column "friend_code" does not exist`, which would otherwise reach the client.

`scripts/check-route-test-coverage.js` baseline 120 → **116**.

## Notes

- **Fourteen mutations, all caught**: removing the friendship check, spreading the user row into the
  response, using the subject's timezone instead of the viewer's, an unsorted trophy case including
  locked entries, dropping the 404, a 1000/window rate limit, leaking the driver message, dropping
  the trim, honouring a body-supplied user id, accepting any action, dropping both uuid guards,
  querying with no friends, attributing an unknown author, and including an uncompleted session.
- The drizzle stub is a chainable thenable that hands back a queued result per `db.select()`, so a
  route's `Promise.all` gets its rows in the order it wrote the queries. It tests the assembly and
  the guards, not the SQL — which is the honest boundary for a route whose scoping lives inside the
  query builder.
- **`friends/leaderboard` is deliberately not covered.** 141 lines of aggregation across five
  queries; a chainable stub there would pin canned rows rather than the ranking, and the
  security-relevant scoping is inside `inArray(allIds)` where a mock cannot see it. It wants either
  a real-database test or none, and none is the honest answer for now.
- One case initially failed because every POST case shared one rate-limit bucket keyed on the
  default user; the limit case now takes a fresh id. Worth remembering: `beforeEach` resets mocks,
  not the rate limiter.
