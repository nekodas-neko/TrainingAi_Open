# 2026-09-08 — AI Coach's write lifecycle gets route-level tests (PS-39)

**Branch:** `test/coach-thread-routes` · **Lane A** · PS-39, coverage ratchet **82 → 78**.

## What shipped

Two files, deliberately split by what each can actually establish:

- `lib/__tests__/coach-lifecycle-routes.test.ts` — 31 cases over `coach/preview`, `coach/apply`,
  `coach/apply/[id]/undo` and `coach/threads`, with the engine mocked. Runs everywhere, CI included.
- `lib/data/postgres/__tests__/coach-undo-window.test.ts` — 4 cases over the undo route against real
  Postgres. Skips in CI, like its siblings in that directory.

No product change; all four routes were already right.

## Why the split, and why it is not optional

The Coach **engine** is already well covered: `lib/data/postgres/__tests__/coach-apply.test.ts`
exercises ownership-by-join, staleness, stacked changes and the library checks against real rows.
What had never been tested is the layer above it — and one rule in particular.

**The undo window is "until your next workout", not a clock** (owner decision), and it is enforced by
an inline query in the undo ROUTE and nowhere else. The engine's suite cannot see it. A mocked file
cannot see it either: the stub answers the query, so what gets pinned is which branch each result
takes, not which rows the predicate selects. Writing only the mocked file would have left the most
consequential rule in the batch uncovered while the file's own header claimed it as the reason for
existing.

So the mocked file states that limit outright, and the DB-backed file covers the predicate:
a workout **after** the change closes the window, one **before** it does not, and **another user's**
workout does not. Those last two are the cases a stub is structurally blind to.

## Mutation pass — 44 mutations, 3 survivors, all real, all fixed

Two were fixtures that could not tell the behaviours apart:

1. **A one-change patch cannot show that only accepted rows are written.** Replacing
   `acceptedChangeIds` with every change id survived, because the fixture's single change was also
   the accepted one. The case now sends two changes and accepts one.
2. **The envelope's `.strict()` was never tested** — the unknown-key case put its stray key inside a
   *message*, testing the inner object's strictness twice and the outer schema's never.

The third is the one the split exists for: **replacing `record.appliedAt` with "an hour ago" survived
the mocked file entirely**, because the stub ignores the predicate. It is caught by the DB file, as
are two further mutations written specifically for it — dropping the user scope, and inverting the
comparison.

## What is not established

The DB-backed file **does not run in CI** (no `DATABASE_URL` there), so the undo window's predicate
is verified locally and not on every push. That is the existing convention for this directory rather
than something introduced here, and the coverage ratchet's count comes from the mocked file, which
does run in CI — the number is honest either way.

Web/Node only otherwise: no device run, no native, safe-area, gesture or notification surface, and no
Samsung WebView rendering.
