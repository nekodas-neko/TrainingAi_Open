# 2026-09-24 — OR-158: the E2E detector looked for client roots where they aren't

**Branch:** `fix/or-158-client-roots` · **Lane:** O (Orchestrator) · `scripts/` only, no product code

This corrects **my own LB-108 fix from earlier today** (#1557). It replaced a prefix list with
computed reachability, and the computation started from the wrong roots.

## How it surfaced

The LB-108 work left one thing owed: the fix could not be verified by reading the diff, only by
watching the E2E job **duration** on the first PR to touch a client `lib/` file. Checking for one on
merged history found **#1569** — which changed `instrumentation-client.ts` and `lib/observability/
sentry-scrub.ts`, and whose E2E job skipped. Running the detector against that commit's file list
reproduced it: `false`.

## Two defects, both measured

**1. Roots were grepped inside `lib/` only.** Almost no client component lives in `lib/` — they live
in `app/` and `components/`, which the prefix rule catches, so *their* `lib/` imports were never
walked. Measured: **47 `lib/` modules are imported directly by a `'use client'` file under
`app/`/`components/` and were not marked reachable**, including `lib/cache-groups.ts` and
`lib/haptics.ts`. A PR touching only `lib/cache-groups.ts` skipped the browser run — the exact class
LB-108 existed to close. The entry's own *"81 of 282 reachable"* figure was produced by this wrong
root set and was therefore also wrong.

**2. `instrumentation-client.ts` matched nothing.** Next identifies it by filename, so it carries no
`'use client'` and no grep found it; it is not under `lib/` and not under the `app|components|e2e`
prefixes. It runs in every browser session. It is now a named root, with a comment saying any future
convention-named entry point needs adding by hand — that is the price of the directive being the
signal.

## The correction that the correction needed

Fixing the roots alone took the reachable set from **81 to 179 of 282**, which is too many, and the
reason was a third defect in the same walk: **it counted `import type` as an edge.**
`early-deload-card.tsx` type-imports one symbol from `lib/health/readiness-payload.ts`, which
re-exports `lib/data/index.ts` — so `lib/data/postgres/adapter.ts`, a server-only Drizzle adapter,
arrived in the browser-reachable set behind a type the compiler erases. That would have undone
LA-63's whole point. Dropping erased edges gives **124 of 282**, and the adapter correctly skips
again. A mixed `import { type A, b }` keeps its edge, because `b` is real.

Worth naming: 179 *looked* like a successful fix. The number that exposed it was a specific file that
had no business being in the set, not the total.

## Verified behaviour

| Changed file | Before | After |
|---|---|---|
| `lib/cache-groups.ts` | skip ❌ | run ✅ |
| `instrumentation-client.ts` | skip ❌ | run ✅ |
| `lib/data/postgres/adapter.ts` | run (type-only edge) ❌ | skip ✅ |
| `lib/resume-repaint.ts`, `lib/hooks/use-resume-repaint.ts` (the PR #1173 pair) | run ✅ | run ✅ |
| `lib/sqlite/cache.ts` | run ✅ | run ✅ |
| `app/api/**`, `docs/**` | skip ✅ | skip ✅ |

## Verification

`pnpm check:rules` — **Ran 78 of 78**, all passed. `scripts/__tests__/e2e-ui-touched.test.ts` — **17
passed** (4 new, covering each defect and the LA-63 regression).

The known floor is unchanged and still stated in the file: static `from '…'` imports only, so a
dynamic `import()` built from a variable is not seen.

**This will make more PRs run the browser suite, which is the point** — the previous behaviour bought
its speed by skipping browser code. No product code changed, so no runtime surface was exercised.
