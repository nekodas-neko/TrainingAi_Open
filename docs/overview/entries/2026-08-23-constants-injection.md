# 2026-08-23 — The Oura rollup reaches zero server-only modules

**Branch:** `feat/inject-oura-constants` · **Lane A** · no behaviour change

Last of today's Q-545 work. The [extraction](2026-08-23-oura-rollup-io-port.md) ported the I/O, the
[runtime injection](../history-2026-08-24.md) ported the models, and the one edge left was
the constants loader. It is closed.

`lib/oura-ble/rollup/run.ts`, walking its import graph on value imports only:

| | modules | server-only edges |
|---|---|---|
| after the extraction | 50 | 5 |
| after the `sourceRank` move | 50 | 4 |
| after the runtime injection | 46 | 1 |
| **now** | **45** | **0** |

No `node:` builtin, no `onnxruntime-node`, no driver. The rollup is a function of its inputs.

## What changed

Four ports read vendored constants and each read them off disk itself:
`steps-motion-decoder`, `daytime-stress`, `stress-resilience`, `cumulative-stress`. They now take
them by **injection**, the mechanism Q-221 built for the first of the four when a static JSON import
turned out to be serving Oura's numbers from `_next/static` with no session.

`lib/oura-models/constants-inject.ts` → `ensureServerOuraConstants()` is the one remaining module
that reads the directory. It runs at boot (`instrumentation-node.ts`, right after the delivery step
that already blocks boot on these files), inside the rollup worker's own `worker_threads` realm, and
at the rollup composition roots. It is idempotent, so an unsure caller can just call it.

`step-counter-pipeline` used to inject the steps-decoder table from disk **itself**, mid-pipeline.
That single line is why `node:fs` stayed in the rollup's graph long after everything else portable
had moved out.

## The failure mode, and why the test exists

Every one of these ports **throws** when its constants are unset rather than defaulting — inherited
from the disk loader, and correct: a missing constant is a wrong physical number, not a missing
feature. So a forgotten injection site is a hard production failure, and the two sites that are not
a Next request path are exactly the ones easy to miss — boot, and the worker realm, which inherits
`process.env` but not the main thread's injected values.

`lib/oura-models/__tests__/constants-inject.test.ts` pins the coverage list and the throw-not-default
contract. Deleting one line from `ensureServerOuraConstants` turns it red — checked, not assumed.

## Two things this turned up

**The count was wrong, and a grep is what got it wrong.** The queue entry said three getters. There
are four: `cumulative-stress.ts` imports its constants **relatively** (`from './constants'`), and
the scan that produced the three-row table only matched the `@/lib/…` form. The import-graph walk
caught it. If you re-measure this class of thing, walk the graph.

**A new file under `lib/oura-models/constants/` is silently untracked.** `.gitignore` excludes that
directory (the vendored data left the repo in Q-49) with an explicit negation per code file, so the
injector I first wrote there was never committed — while every local gate passed, because the file
was on disk. CI's Build would have caught it; nothing local would have. It now lives at
`lib/oura-models/constants-inject.ts`, beside `constants-delivery.ts`, which sits outside that
directory for the same reason.

## Verification

Full suite **544 files / 4,481 tests** green. `pnpm check:rules` → **51 of 51**. `pnpm build` clean;
`scripts/build-rollup-worker.mjs` bundles.

`pnpm dev` against the local database, signed in as the seeded user — the routes that reach these
constants past their auth gate:

| route | | reads |
|---|---|---|
| `GET /api/body-battery` | 200 | daytime-stress constants |
| `POST /api/weekly-digest` | 200 | resilience constants |
| `GET /api/oura-ble/decoder-constants` | 200 | steps-decoder table |
| `GET /api/oura-ble/step-counter-export` | 200 (as admin) | — |

**Stated honestly:** the last one returns `hasAnchor: false` on seed data, so its `ensure` call ran
but the pipeline body did not — that path is covered by `step-counter-pipeline.test.ts` and the
rollup suite instead. Cumulative-stress has no simple route and is covered the same way.

**Not exercised:** on device. Nothing here changes a runtime path on the server, and the device
rollup does not exist yet.

## What is left of Task 3

The device half, and nothing in the engine blocks it: a `RollupIO` over the local store, a
`ModelRuntime` over `getWebSession`, and a constants fetch following
`lib/activity/steps-decoder-constants-client.ts`. The route that serves the steps-decoder table
would need to serve the other three — deliberately **not** built here, because an auth-gated
endpoint exposing more vendored numbers with no consumer is surface without a reason.
