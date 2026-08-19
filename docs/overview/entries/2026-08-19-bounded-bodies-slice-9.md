# 2026-08-19 — Q-322 slice 9: the routes the numbered slices left over

**PR:** `fix/bounded-bodies-slice-9` · **Lane:** Implementation A

## What shipped

The last 31 route files still reading their request body through a bare `req.json()` now read it
through `readJsonLimited`, with a `MAX_BODY_BYTES` cap derived from each route's own schema (4 KB
for a single-field write like `user/equipped-title`, 256 KB for the phase-set and workout-template
bodies that carry a whole program). 33 read sites in four shapes:

- `Schema.safeParse(await req.json().catch(() => null))` — the common one;
- `Schema.parse(await req.json())` — throws today, so it kept its surrounding try/catch;
- `await req.json() as {…}` — an untyped cast, including the multi-line one in `phase-sets/clone`;
- an optional/fallback read — `daily-digest`, `weekly-digest`, `ai-periodization/…/prescribe`,
  `running-plan/runs/[id]`.

The optional ones keep their fallback exactly: only `too_large` short-circuits to 413, and an
invalid or absent body still falls through to whatever the route did before.

**The worklist is empty, and the ratchet is retired in this same PR.** Slices 6, 7 and 8 landed
while this was in flight, so after the last re-merge `check-bounded-request-body` reports **210 API
route files, 0 bare `req.json()` reads**. The per-file `BASELINE` and its shrink-only bookkeeping are
gone with the debt they tracked: the script is now a flat rule, so re-introducing a bare read fails
on the first one rather than against an allowance. Verified by reverting `mood`'s read and watching
it go red, then restoring it. An `EXEMPT` map replaces the baseline for a route that genuinely
cannot be bounded — it is empty, and an entry in it has to carry its reason, because a number with
no reason attached is what lets a count drift back up.

Q-322 is removed from `docs/implementation-backlog.md` in this PR. It began at **104 bare reads
across 92 route files**.

## A correction carried over from slice 8

`running-plan/runs/[id]`'s `.catch(() => ({}))` is not an optional body, for the same reason
`admin/generate-exercise-media`'s is not: it still `safeParse`s against a schema with required
fields, so a bodyless PATCH has always answered 400. Live-probed and confirmed 400 both before and
after. The genuinely optional ones — bodyless call → normal 200 — are `daily-digest`,
`weekly-digest` and `ai-periodization/…/prescribe`.

## Verification

`npx tsc --noEmit` clean · `pnpm check:rules` **Ran 49 of 49** · `pnpm lint` clean · full suite against the local DB **511 files / 4,185 tests
passed, 3 files + 75 tests skipped**.

Live-probed against `pnpm dev` with a real credentials session, every converted handler:
**oversized (1 MB) → 413** on all of them, **malformed → 400** (or the route's own prior answer
where the body is optional), **valid → unchanged** (`supplements` 201, `mood` 200, `injuries` 201,
`push/subscribe` 200).

Three of those probes first returned 400 on what I had called a valid payload, and in all three the
schema was right and my test data was wrong — `supplements` takes `dose`, not `doseAmount`/
`doseUnit`; both it and `injuries` are `.strict()`, so an invented key is a rejection. A 400 from a
route you just touched is a question, not an answer.

**Not exercised:** `log-calendar-event` gates on a Google refresh token before it reads the body, so
its guard cannot be reached with a credentials session — verified by reading the handler, not by
probe. `friends/[id]` and `injuries/[id]` DELETE take no body at all (the id is in the path); they
appear here only for their PATCH siblings. Nothing in this slice touches native, safe-area, gesture
or notification paths, so no device check is owed.

## `npx next lint --dir app` is not the lint CI runs

It reported warnings only and this slice was pushed on that basis; CI's `pnpm lint` — which is bare
`eslint` over the whole repo — then failed on a **`prefer-const`** error in `log-calendar-event`,
where the rewrite filled a pre-declared `let` that nothing reassigns. Two different runners with
two different rulesets, and only one of them is the gate. The pre-push command is **`pnpm ci:local`**
(`pnpm lint && pnpm check:rules && pnpm typecheck && pnpm test`), not a hand-assembled subset of it.
