# 2026-09-24 — OR-138: the read-only pivot, and the hole that turned out not to exist

**Branch:** `lane-a/or138-pivot-readonly-scope` · **Lane A** · `app/api/admin/db-query/route.ts`,
`lib/data/postgres/claude-ro-owner.ts`, one new test file. **No migration.**

**⚠ AUTH/SECURITY — presented for the owner's confirmation, not merged on my own authority.** He
asked for the capability and the entry records his words; the carve-out is about the diff, not the
decision.

## The entry's flagged unknown, settled first — and it is good news

It said, of the current endpoint:

> *"Unverified, and worth checking first: whether a caller can today send a bare
> `SET app.claude_ro_owner = …` as its own single statement and have it stick on the pooled
> connection. … If it does stick, the current single-user guarantee is already softer than it reads."*

**It does not stick, and the reason is structural rather than lucky.** Every submitted statement is
wrapped — `SELECT * FROM (${sql}) _q LIMIT 1001` — so a `SET` becomes a subquery and Postgres
rejects it outright. Measured against a real database, not reasoned about:

```
REJECTED  SET app.claude_ro_owner = '1111…'        -> syntax error at or near "."
REJECTED  SET LOCAL app.claude_ro_owner = '1111…'  -> syntax error at or near "app"
ACCEPTED  WITH x AS (SELECT 1) SELECT * FROM x     -> 1 row
setting after all attempts: null
```

So the `;` rejection is not what was holding this — the wrapping is. No pre-existing softness, and
this change is purely additive.

## What shipped

An optional `userId` on the body. Absent, every line behaves as before and the role's own default
applies. Present, it is validated, gated, and scoped:

1. **Validated** against the interpolation boundary, now exported from `claude-ro-owner.ts` rather
   than copied. It is deliberately *not* the shared `isUuid`, which also pins version and variant
   nibbles: a stricter test would refuse a legitimate non-v4 id, and the only thing this guards is
   string interpolation, which hex-and-dashes already settles.
2. **Gated on having filed feedback** — a cheap `EXISTS` against `feedback_submissions`, which ties
   the widening to the justification given. It runs on the **app's** pool, not the read-only one:
   `claude_ro` views are themselves owner-scoped, so asking the read-only role whether *another*
   user filed feedback would always answer no. That is the kind of detail that would have shipped as
   a silent always-403.
3. **Scoped with `SET LOCAL` inside an explicit transaction**, then committed and the client
   released.

## Why `SET LOCAL`, proven rather than asserted

The endpoint reads through a **pool**, so a bare `SET` persists on that connection and silently
re-scopes whichever later request reuses it. Run against a real pool pinned to `max: 1` — the worst
case, every request on one connection:

```
default scope            : 0000…dead
inside the transaction   : 1111…1111
next request, same conn  : 0000…dead
after a FAILED pivot     : 0000…dead
```

The failure path matters as much as the happy one, and it is in the test list.

## The audit trail, and a judgement call

The pivot is recorded, because consent is not the same as no audit trail. `db_query_log` has no
column for it and adding one is a **migration, which ships alone** — so the pivot goes in as a
leading `-- claude_ro pivot: <uuid>` comment on the same audit row as the query it scoped. That is
attributable after the fact, which is the requirement, and greps cleanly. **A dedicated column would
be tidier and is a follow-up**, not a reason to split this into two PRs.

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | `SET LOCAL` becomes a bare `SET` | killed — 2 tests |
| 2 | feedback gate removed | killed |
| 3 | uuid boundary removed | killed |
| 4 | client never released | killed |
| C | the guard rewritten as `!(typeof … && test(…))` | **survived** (correct, first time) |

## Not done

- **Not merged.** Auth/security is confirm-first, whatever the entry records.
- **No version bump or changelog**: this is an agent-facing admin endpoint, not product behaviour.
- **No widening beyond the entry.** The pivot reaches only users who filed feedback. One predicate
  to delete if the owner wants it broader — and the narrow version costs nothing to reverse, while
  the broad one cannot be un-shipped.

## Failure surfaces not exercised

**Production.** Everything here was measured against the local database: the wrapping probe, the
no-leak proof, and the tests. The live endpoint was deliberately not used as a test subject.
