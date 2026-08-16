# 2026-08-04 — Q-58 part 1: the 80 routes that failed silently now leave a trace

**Branch:** `feat/route-error-reporting-sweep` · **Domain:** platform · **Version:** 1.256.2

## The backlog's framing was wrong, and the numbers say so

Q-58 read *"189 of 200 API routes cannot report a 500"* and proposed either 189 one-line edits or a
global hook, with *"decide before building"*. Counting first changes the shape entirely:

| population | count | needs |
|---|---|---|
| No `catch` **anywhere** — the error escapes the handler | **80** | a global hook, **zero route edits** |
| Catches and returns its own 500 — invisible to any global hook | **31** | one explicit line each |
| Already calls `reportServerError` | 13 | done |
| No 500 path at all (static, redirect, `notFound`) | ~76 | nothing |

It was never 189 mechanical edits. It is one file for the worst 80, and 31 explicit calls after —
and the two populations are genuinely disjoint, because **a route that catches its own error never
reaches the global hook**. That distinction is the whole design and it is not in the backlog entry.

This PR is the first half. The 31 self-handled 500s follow separately, per the entry's own
instruction not to fold a route-wide sweep into anything else.

## What shipped

Next's `onRequestError` in `instrumentation.ts`, writing to the existing `error_events` table.

**It does not go through the repository.** `lib/observability.ts` uses `getRepositoryAsync()`, which
pulls the Drizzle adapter → the onnxruntime-node native addon, which webpack cannot bundle from an
instrumentation entry point. `lib/observability/request-error.ts` talks to the `pg` pool with raw
SQL instead — the same constraint, and the same workaround, `instrumentation-node.ts` already
documents.

**A repeat of the same failure is deduped for 60 s** (route + message). The DB is the binding
constraint on this project — ~9 MB/day against a 1 GB volume — so a hot loop in a broken route must
not be able to fill it. The dedupe map is bounded at 200 keys and prunes before inserting, so a
high-cardinality error stream (ids or timestamps in the message) cannot grow it without limit.

## The mistake worth recording

The first version used an early-return guard:

```ts
if (process.env.NEXT_RUNTIME !== 'nodejs') return
const { recordRequestError } = await import(...)
```

`instrumentation.ts`'s **own header comment** says this does not work — an early return leaves the
dynamic import reachable, so webpack cannot dead-code-eliminate it, and the pg client lands in the
edge bundle. Dev logged exactly the predicted `Can't resolve 'fs'` trace through the new file. The
positive-block form (`if (=== 'nodejs') { await import(...) }`) is required. I edited a file whose
comment warned about the specific error I then made.

## Verification — it actually fires

Typecheck and unit tests would both have passed on a hook that never ran, so it was exercised for
real: a temporary throwing route added under `app/api/`, hit against `pnpm dev`, and the row read
back out of Postgres.

```
 source |          url           |                   msg                    | has_stack
--------+------------------------+------------------------------------------+-----------
 server | GET /api/errortest-tmp | deliberate uncaught throw for onRequest…  | t
```

Path, method, message and stack — from a route with no error handling at all. Seven more hits
produced **one** row, confirming the dedupe live. The temporary route was removed afterwards.

(Side note: the first attempt at that route 404'd, because it was named `__errortest__` and Next
treats an underscore-prefixed folder as private. Worth knowing before concluding a hook is broken.)

6 unit tests on the dedupe predicate, including the bounded-growth and hot-key-survives-churn cases.

## Not verified

**Production.** The hook is runtime behaviour on Railway; the dev proof is a local Postgres. Nothing
depends on the environment beyond `DATABASE_URL`, and the write is best-effort and silent by design,
so the failure mode of it not working in production is that it records nothing — which is today's
behaviour, not a regression.

**The 31 self-handled 500s are untouched** and still invisible. That is the next PR, not an
oversight.
