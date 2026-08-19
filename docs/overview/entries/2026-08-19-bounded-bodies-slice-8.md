# 2026-08-19 — Q-322 slice 8: every remaining admin route

**PR #206** · branch `fix/bounded-bodies-slice-8` · Implementation Lane A · JS/server only.

Eight route files, eleven read sites. **After this there are no admin routes left in the baseline** —
verified by counting `/admin/` entries in it, which is now zero.

| route | cap | derivation |
|---|---|---|
| `admin/db-query` | 64 KB | one SQL statement; the audit log truncates it at 20,000 chars |
| `admin/exercises` (×2), `admin/fix-exercise-units` | 32 KB | an exercise with 2,000 chars of instructions; a list of names |
| `admin/activity-types` (×2), `generate-exercise-media`, `mirror-dataset-gifs` | 8 KB | one row, or a few flags |
| `admin/invites` (×2), `admin/timing-baseline` | 4 KB | one email, one date |

## A correction to my own framing from slices 5–7

Two of these — `generate-exercise-media` and `mirror-dataset-gifs` — read with
`await req.json().catch(() => ({}))`, which I had been calling the "optional body" shape. **That is
not what it is.** Both routes still `safeParse` the result against a schema with required fields, so
a call with no body has always returned 400. The `.catch` exists so a *malformed* body reaches the
schema's own 400 instead of throwing out of the handler.

The conversion preserves that exactly — an absent or unreadable body still falls back to `{}` and
still gets the schema's 400 — and it was verified rather than assumed: calling both with no body
returns `400 Invalid request`, the same as before. But the genuinely optional-body routes are the ones
in slices 5–7 (`rekey`, the backfills, `nutrition-goals/recommend`), where a bodyless call returns
**200**. Worth separating, because the two shapes need the same care for different reasons.

## `admin/db-query`'s cap is real but was not exercisable here

Its config gate (`isReadonlyDbConfigured`) runs **before** the body read and `CLAUDE_DB_READONLY_URL`
is unset locally, so the route answers 503 to everything and the 413 path is unreachable from a
session. That ordering is correct — a fail-closed config check belongs first — and it means the cap
is verified by construction and by the identical code shape in its ten siblings, **not** by a live
413. Said plainly rather than folded into the table.

## Verified live

`pnpm dev`, seeded user promoted to admin and reverted after (confirmed back to `f`).

| | 10 MB body | malformed | valid |
|---|---|---|---|
| ten of eleven read sites | **413** | **400**, never 500 | — |
| `admin/db-query` | 503 (config gate, see above) | — | — |
| `admin/invites` | | | POST **200** → GET shows the address → DELETE **200** |
| `admin/timing-baseline` | | | **200** |
| `admin/activity-types` | | | POST **201** → PATCH **200** (rename round-trip) |

**A second probe failure was mine, not the code's** — `activity-types` POST first returned 400 because
I sent `name` where the schema wants `label` and a `sortOrder`. Same lesson as slice 6's missing
`title`: a 400 from a route you just touched is a question, not an answer. Both probe rows were
deleted afterwards (confirmed zero remaining).

Full suite against the local DB: **489 files / 4,138 tests green**. Custom Rules 49 of 49.

## Typing, for the fourth time

`activity-types` PATCH, `exercises` PATCH and `invites` DELETE all took an id or an email straight
from an `any`-typed destructure into the repository. With the body now `unknown` each needs an
explicit `typeof === 'string'`. Every slice that converts a `const { x } = await req.json()` has found
one of these; it is the most reliable side effect of the sweep.

## Not exercised

Production, and the APK. Nothing native, safe-area, offline-store or WebView-shaped is touched — these
are admin console routes, reachable only from a browser session with the admin flag.
