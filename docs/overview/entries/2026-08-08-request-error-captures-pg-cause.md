# 2026-08-08 — `onRequestError` now records the Postgres cause too (Q-142)

**Branch:** `claude/token-usage-strategy-7cx7z9` · **Domain:** `platform`

## What this closes

`DrizzleQueryError`'s own message is only `Failed query: <sql>`; the Postgres error that says *why* —
the one carrying `code`, `severity`, `detail` — sits on `err.cause`. Both of this app's error-recording
paths dropped it, which is why every `Failed query` row in `error_events` was undiagnosable.

**#1150 fixed one path** (`reportServerError`, called from 13 routes' own catch blocks). This fixes
the other: `recordRequestError`, behind Next's `onRequestError` hook, which per
[`docs/module-map.md`](../../module-map.md) §14 covers **the 80 route files with no `catch` at all** —
the larger population, and the one whose failures previously reached the client as a bare 500 with no
trace.

## The one non-obvious part

`request-error.ts` **cannot import `lib/observability.ts`**. That module reaches the DB through
`getRepositoryAsync()`, which pulls the Drizzle adapter → the onnxruntime-node native addon, which
webpack cannot bundle from an instrumentation entry point. The file header says so, and it is the
reason the two paths exist separately in the first place.

So `summariseCause` moved to **`lib/observability/pg-cause.ts`**, which imports nothing at all.
`lib/observability.ts` re-exports it so the existing import path (and its test) keeps working. One
implementation, two callers, no second drifting copy — the alternative was copy-pasting it into the
instrumentation path, which is exactly how this project's duplicate-formula bugs start.

## One deliberate choice worth recording

**Dedup keys on the *base* message, not the prefixed one.** The 60 s window exists so a hot loop in a
broken route cannot fill the DB (the binding constraint — ~9 MB/day against a 1 GB volume). The prefix
is derived from the same error, so including it cannot separate two genuinely distinct faults, but a
cause that *varies* between otherwise-identical failures — a pool-acquisition timeout carries no code
where a statement timeout carries `57014` — would write a row per occurrence and defeat the window.
There is a test for exactly this.

## Verification

Four new end-to-end tests in `lib/observability/__tests__/request-error-cause.test.ts`, run against
the real `error_events` table rather than a mock, per CLAUDE.md's rule that a field-name mistake reads
as `undefined` and fails silently: the `57014` prefix lands inside `left(message,120)` (where the
standing session-start query can see it), the codeless pool-timeout shape falls back to the cause
message, a plain error is recorded unchanged, and a varying cause does not defeat the dedup. They skip
cleanly without `DATABASE_URL`. Full suite, lint and all Custom Rules green.

**Not exercised:** no production failure has occurred since either fix deployed, so the codes have not
yet been observed landing in prod — the next occurrence is the real confirmation. Nothing here touches
a device path.

**One pre-existing failure found and queued, not fixed here.** The full local suite came back
`1 failed | 3240 passed`, and the failure is not this change:
`scale-ble-multi-reading.test.ts`'s user-scoping case seeds "another account" with
`SELECT id FROM users WHERE id <> $1 LIMIT 1` — a user it does not create. Locally that picks the
seeded dev user, which already has a `body_metrics` row for the hardcoded `2026-07-29`, so the insert
violates a unique constraint; reproduced on a clean checkout of `main`. In CI it does the opposite and
passes **vacuously**, because the Tests job runs migrations without ever seeding, so the `SELECT`
matches nothing and the assertion holds for the wrong reason. Filed as **Q-146**. A second file,
`count-sessions-by-id.test.ts`, failed in one run on residue from an earlier aborted run of mine and
passes clean — not a real failure, recorded so the next reader does not chase it.

## What this unblocks

Q-107's remaining half. Its `getSyncDelta` batching fix was aimed at a pool-contention theory that the
2026-08-08 review found weakly supported — 77 of 98 `Failed query` events are a lone query failing
while everything else in flight succeeded, which is not the shape pool exhaustion makes. With both
paths now recording the code, one production `error_events` read settles it: a `57014` majority means
`statement_timeout` and the batching fix is aimed correctly; codeless connection-acquisition failures
mean something else is dropping connections. **Read the codes before writing that PR.**
