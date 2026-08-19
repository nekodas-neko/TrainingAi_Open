# 2026-08-19 — Q-322 slice 6: the workout and activity write routes

**PR #201** · branch `fix/bounded-bodies-slice-6` · Implementation Lane A · JS/server only.

Ten routes, thirteen read sites — the writes behind logging a set, deleting a session, recording an
activity, a fitness test, an RPE or an early deload.

| route | cap | derivation |
|---|---|---|
| `workout-review/session/[sessionId]/apply` | 256 KB | unbounded arrays — below |
| `exercise-estimates` | 256 KB | 400 entries × a 200-char name ≈ 90 KB at the schema's limit |
| `workout-entry` PATCH + DELETE | 16 KB | 20 weights, 20 reps, a few scalars |
| `activity-logs` POST + DELETE, `activity-logs/[id]/metrics` | 8 KB | one log, one id, a few numbers |
| `fitness-tests` POST + DELETE | 8 KB | one result, one id |
| `workout-sessions`, `.../rpe`, `confirm-early-deload`, `workout/backfill-set-hr-stats` | 4 KB | an id, a number, or an optional body |

## Three more routes were answering 500 for a malformed body

`activity-logs` (both verbs), `fitness-tests` (both verbs) and `confirm-early-deload` read with **no
`catch` at all** — `Schema.safeParse(await req.json())` and, on `confirm-early-deload`, a bare
`await req.json() as { programId?: string }`. A malformed body threw out of the handler and Next
answered 500. That is now the **fifth consecutive slice** in which converting the read turned up a
500-for-a-400; the count across the sweep is nine routes.

## Another schema that bounds nothing

`workout-review/session/[sessionId]/apply` takes `adjustments`, `dropThisCycle` and `dropPermanent`
each with a `.default([])` and **no `.max()`**, so the schema caps none of their lengths — only
`reasoning` (2,000 chars) is actually bounded. Until they gain caps the byte limit is what bounds
them, which is written into the constant. Same finding as `generate-program` in slice 4 and the
`coach` message array; three now.

## Verified live

`pnpm dev`, seeded user, promoted to admin for the one admin route and reverted after (confirmed back
to `f`).

| | 10 MB body | malformed | valid |
|---|---|---|---|
| all thirteen read sites | **413** | **400**, never 500 | — |
| `workout/backfill-set-hr-stats` | 413 (as admin) | — | **200 with no body** — the optional-body case |
| `activity-logs` | | | **201** create → **200** delete, a real round-trip |
| `exercise-estimates` | | | **200** |
| `workout-sessions` DELETE | | | **404** on a valid-but-missing id, unchanged |
| `confirm-early-deload` | | | **200**, a real early-deload week set |

**One probe failure was mine, not the code's**: `activity-logs` POST first returned 400 because my
payload omitted the required `title`. Checked the schema rather than assuming the guard had broken
it — the fixed payload wrote a real row. Worth recording as the habit: a 400 from a route you have
just changed is a question, not an answer.

Local state the probes changed was reverted: the admin flag, the early-deload week on the seeded
program, and the `rate_limits` rows. The activity log is soft-deleted, which is the route's own
correct behaviour rather than leftover state.

Full suite against the local DB: **489 files / 4,138 tests green**. Custom Rules 49 of 49.

## The import-anchor hazard from slice 5, fixed properly

Slice 5's insertion script anchored on "the last line starting with `import`" and spliced into the
middle of a multi-line import block. This slice anchors on a regex for a **complete** single-line
import (`^import .* from '…';?$`), so a multi-line block cannot be matched at all. A second variant
of the same script did break two ternaries by appending `;` to the wrong branch — `tsc` caught both
immediately, which is the argument for typechecking after every scripted pass rather than at the end.

## Not exercised

Production, and the APK. No native, safe-area or WebView surface is touched, but several of these are
**offline-first write paths** whose device counterpart is the outbox `pushMutations` branch rather
than the route — that branch is unchanged here, so the device path is unaffected by construction
rather than by test.
