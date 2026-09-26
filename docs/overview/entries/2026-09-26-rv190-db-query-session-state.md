# RV-190 — the read-only endpoint's protections were session defaults, and they leaked between requests

**Branch:** `lane-a/rv190-db-query-session-state` · **Lane A** · `[platform]`

`/api/admin/db-query` is read-only because of a Postgres role — that was the claim, written into
`readonly-client.ts`'s own docstring: *"That role — not anything in this file — is what makes the
endpoint read-only."*

The GRANTs are real. The other three protections are **session defaults** set with `ALTER ROLE`, and
a submitted query can `SET` its way out of all three: the owner scope `app.claude_ro_owner`,
`default_transaction_read_only`, and `statement_timeout`. Each query ran in autocommit on a
two-connection pool that is never reset, so an override did not end with the request — it rode the
pooled connection into the next one. Re-pointing the owner scope means **a later, honest query reads
another user's rows.**

Reproduced on the local database. **Nothing was probed on production**, which is also how the entry
found it.

## The fix, and the part of it that actually works

Every query on that pool now goes through `runScoped` — `RESET ALL`, then `BEGIN TRANSACTION READ
ONLY`, `SET LOCAL` for the timeout and (optionally) the owner, the query, `ROLLBACK`, `RESET ALL`.
Both `db-query` call sites and `db-snapshot`'s count query use it; no raw `pool.query` on the
read-only pool is left.

**The mutation pass changed what this entry claims.** Of six mutations, only one failed a test:
removing the `RESET ALL` **on the way in**. Dropping `READ ONLY` from the transaction, swapping
`ROLLBACK` for `COMMIT`, dropping the outbound `RESET ALL`, and using `SET` instead of `SET LOCAL`
all passed everything.

That is not a gap in the tests so much as a fact about the mechanism, and it is worth stating
plainly rather than dressing up: **with the role correctly provisioned, `default_transaction_read_only
= on` already makes every transaction read-only**, so the explicit `READ ONLY` keyword changes
nothing observable. It earns its place the way this file's connection-level `statement_timeout`
already does — it holds if the role is ever mis-provisioned. The docstring now says which part is
load-bearing and which is belt, and says outright that the belt is not covered by the suite.

## What the reproduction caught that the happy-path tests could not

The first version of the three regression tests passed immediately — and proved nothing. They only
called `runScoped`, which did not exist before the fix, so they could never have run against the
broken path.

Adding a case that drives the **old** shape (a plain `pool.query` in autocommit) fixed that, and it
immediately failed on its second assertion: after a leak, `runScoped` returned the **leaked** owner.
The reset was in the `finally`, so it protected the *next* caller and not itself on a connection
that was already dirty. `RESET ALL` moved to the way in as well. That is the one mutation the suite
now kills, and it exists because the reproduction was written rather than assumed.

The route tests needed the same treatment from the other side: they mocked `getReadonlyPool` as
`{ query }`, which `runScoped` does not call. The fake pool is now `{}` with `runScoped` as a spy —
so a route that goes back to `pool.query` fails with *"query is not a function"* instead of passing
quietly. Verified by reverting the route: 8 of 17 cases fail.

## Verification

29 cases in `claude-ro-readonly-role.test.ts` (over TCP; both claude_ro suites run, 32 tests, none
skipped) plus 52 in the two route suites.

| mutation | killed |
|---|---|
| drop `RESET ALL` on the way in | 1 of 29 |
| route reverts to `pool.query` | 8 of 17 |
| `BEGIN` without `READ ONLY` | **0 — belt, see above** |
| `COMMIT` instead of `ROLLBACK` | **0 — belt** |
| drop `RESET ALL` on the way out | **0 — belt** |
| `SET` instead of `SET LOCAL` | **0 — belt** |
| **control:** name the timeout via a local const | **0 — survived, as intended** |

Gates: `lint` 0 · `tsc` 0 · `typecheck:tests` 0 · `check:rules` 0 · pointers 0 · full suite
**9,974 passed**.

## Not exercised

- **Production.** Nothing was probed there, deliberately, and the fix is not verified against the
  real `claude_readonly` role as provisioned on Railway — only against the one the test harness
  creates locally.
- **The `ownerId` parameter has no caller yet.** It exists for OR-138, whose entry said to build
  this first; that entry is updated to point at it.
- The route was not driven through `pnpm dev`; it needs `CLAUDE_DB_READONLY_URL`, which this
  container does not have.
