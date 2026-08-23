# 2026-08-23 — The rollup's drizzle edge, and the dependency the D-track plan never named

**Branch:** `refactor/rollup-server-only-edges` · **Lane A** · no behaviour change

Follow-on from [the rollup extraction](2026-08-23-oura-rollup-io-port.md). That PR made the
rollup's *I/O* runtime-agnostic and said its models were not. This measures what is actually left
and removes one of the edges.

## What the measurement says

Walking `lib/oura-ble/rollup/run.ts`'s import graph and following **value** imports only — a
type-only import is erased and reaches no bundle, and following them too makes the answer look like
the entire Postgres layer on the strength of one `import type` in `daytime-hrv-model.ts` — gives
**50 modules** and five server-only edges:

| via | lands on | needs |
|---|---|---|
| `health-source.ts` | `drizzle-orm` | ✅ **fixed here** |
| `step-day-buckets` → `step-counter-pipeline` | `oura-models/constants` — `node:fs` | a constants answer (below) |
| ⋯ → `step-counter.ts` | `inference/session.ts` — `node:fs/promises`, `onnxruntime-node` | injected session |
| `sleepnet-assemble` | `inference/sleepnet.ts` — `onnxruntime-node` | injected session |
| `daytime-stress` | `inference/dhrv.ts` — `onnxruntime-node` | **graph-only, not a call path** |

That last row is worth the distinction. The rollup calls only
`buildDaytimeStressSeriesFromModel`, which is synchronous and runs no model — `computeDaytimeStress`
and `buildDaytimeStressSeries`, the two ONNX users in that file, have **no production callers at
all**, only tests. So it is a file split, not an injection. **I did not do it**, because it removes
no edge on its own: the file still reaches `oura-models/constants` through `daytimeStressLevel`.
Churn that measures as zero is not worth a diff.

## What shipped

`HEALTH_SOURCES` / `SOURCE_RANK` / `sourceRank` moved to
`packages/shared/src/health/source-rank.ts`, driver-free. `lib/data/health-source.ts` imports and
re-exports them, so its six importers are untouched, and keeps `mergeSet` and the SQL half.

It also fixes a duplication that was sitting in that file: `storedRankSql` wrote the five ranks out
again by hand as a SQL `CASE`, so the ladder existed twice. It is now generated from `SOURCE_RANK`,
and the generated string is byte-identical to the one it replaces — checked, not assumed.

## ⚠️ The finding that matters more: the constants cannot reach the device

`lib/oura-models/constants/index.ts` reads its JSON with `node:fs`, **synchronously**, and its own
header states the position outright:

> *"SERVER-ONLY, and structurally so — `node:fs` cannot resolve in a browser bundle. Every consumer
> is a route or the adapter; if a client component ever needs one of these numbers, it belongs
> behind an API route, not behind a bundler shim."*

The synchronicity is deliberate and load-bearing — two ports evaluate their constants at module
scope, and the comment says async getters would "turn a pair of plain constants into lifecycle
problems across every port". That is exactly what forecloses fetching them. And
`constants-delivery.ts`, which exists so the files can leave the repository, solves delivery for the
**server**: it downloads them to disk at boot.

They are on the rollup's real call path in two places — `step-day-buckets` →
`step-counter-pipeline`, and `buildDaytimeStressSeriesFromModel` → `scoreStressPoints` →
`daytimeStressLevel` → `getDaytimeStressConstants()`.

So D2 Task 3 has a third dependency the plan never named, and unlike the other two it is not a port:
it is a choice between making the getters async everywhere, shipping the constants as
service-worker-cached assets, or putting them behind a route. It belongs on the Q-545 entry as a
decision to take before Task 3 starts, which is where I have put it.

## Verification

`pnpm check:rules` → 51 of 51. 192 test files / 1,468 tests across `lib/data/postgres`,
`lib/health` and `packages/shared/src/health` pass. Typecheck and lint clean (0 errors).

**Not exercised:** on device. Nothing here changes a runtime path — the rank values, the generated
SQL and the rollup's behaviour are identical.
