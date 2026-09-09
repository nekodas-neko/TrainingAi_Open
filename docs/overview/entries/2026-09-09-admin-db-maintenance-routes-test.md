# 2026-09-09 — the snapshot's two doors, and two guards that were never asked (PS-39, 16 → 13)

**Branch:** `test/admin-db-maintenance-routes` · **No product change.**

35 cases over `admin/db-snapshot`, `admin/vacuum` and `admin/program-export`.

`db-snapshot`'s **helpers** were already covered against real Postgres over a read-only role
(`lib/export/__tests__/db-snapshot-integration.test.ts` — drift, primary keys, chunked streaming).
Nothing tested the route above them, and that is where the security decisions are.

## The token widens transport, never authority

The route exists because a sandbox reaches production over 443 and not over 5432, so it takes a
bearer secret as well as a session cookie. Three properties now have tests, and none of them had one
before:

- **A valid secret naming a non-admin is refused.** Without this the secret is a second, weaker
  admin credential rather than another way to reach the same one — `requireAdmin` still runs on the
  resolved export user.
- **The bearer path is disabled, not skipped, when either half is unset.** Two env vars, and a
  fixture missing only one cannot tell which the route requires, so each is removed on its own.
- **The rate limit runs before the compare**, and a trip answers identically to a bad token. Same
  status, same body — otherwise the throttle itself is an oracle telling an attacker their guess was
  worth throttling.

A fourth: a `Basic` authorization header falls through to the session rather than being treated as a
failed token attempt, so a signed-in admin with a stray header is not 401'd.

## The audit swallow is deliberate, and now pinned as such

`logSnapshot` catches and logs its own failure. That is the one legitimate swallow in the file —
`check-admin-guard-catch.js` allows it by name — because losing an audit row is bad and refusing the
snapshot because the log table is down is worse. A test asserting the export still completes when
the audit write rejects is what stops it being "tidied up" into a rethrow by someone applying the
Q-548 rule mechanically. Both the success and the part-way-failure audit rows are asserted too.

## The error line exists because the status is already spent

A snapshot that fails mid-stream has long since sent `200` and its headers, so the only place left
to say "this file is incomplete" is the body. The route pushes a final error line; the test asserts
the manifest is still first and that line is last. Without it the consumer has a file that simply
stops — which looks exactly like a complete one. (This is the failure LA-84 describes for the other
export route, handled here.)

The manifest carries `rowCounts` from the request's own read, and a count that could not be taken is
**null**, not 0 — a different claim, and the one that lets a consumer trust what is in the file.
Omitted tables are reported with their reason for the same reason.

## `vacuum`'s allowlist is the safety boundary

`VACUUM` takes no bind parameter, so the table name is interpolated into the statement and the
allowlist is the only thing standing between a request body and SQL. It is checked with
`hasOwnProperty`, not a bare lookup — the allowlist is a plain object literal, so `constructor`,
`toString`, `__proto__` and `valueOf` would otherwise read as members. All four are now cases. This
is the same defect class as the `TITLES` catalogue in `user/equipped-title` earlier in this queue,
where the bare lookup **was** the bug; here the guard is already right and the test keeps it that
way.

A failure answers 500 rather than a 200 with nothing reclaimed: a `VACUUM FULL` needs free disk
equal to the table's current size, so "it failed" and "there was nothing to reclaim" are very
different answers.

## `program-export`

Both its orderings are separate sorts on different keys — exercises by position, sets by set number
— and both fixtures are deliberately out of order, because a list already sorted proves nothing
about a sort. An exercise with no progression style contributes no estimate rather than a zero-length
one, so a half-configured program reads as incomplete rather than short.

## Mutation pass

**25 of 25 caught**, no anchor misses; the twenty-sixth is an equivalent mutant planted as a control
and survived as designed. The whole file passed on its first run, which is worth naming as a reason
for suspicion rather than confidence — the mutation pass is what turned that into evidence.

## Gate

`pnpm lint` 0 errors · `npx tsc --noEmit` clean · `tsc -p tsconfig.tests.json` clean for the new
file · **Custom Rules 70 of 70** · `pnpm build` clean · full suite green · route ratchet **16 → 13**.

**Not exercised:** no SQL runs — both pools are stand-ins, so this says nothing about the snapshot's
fidelity or about a real `VACUUM FULL` reclaiming anything. The bearer path is exercised with env
vars set in-process, not against a deployed secret. Web/Node only: no device, no native surface.
