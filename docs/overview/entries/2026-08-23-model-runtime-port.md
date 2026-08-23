# 2026-08-23 — The neural ports take a runtime now, and one edge is left

**Branch:** `refactor/inject-model-sessions` · **Lane A** · no behaviour change

Third and last of today's Q-545 pieces. [The extraction](2026-08-23-oura-rollup-io-port.md) made the
rollup's I/O portable; [the measurement](2026-08-23-rollup-source-rank-and-constants.md) found five
server-only edges and closed one. This closes three more.

## What was actually wrong

`sleepnet.ts`, `step-counter.ts` and `dhrv.ts` were server-only for a reason that had nothing to do
with their maths: each imported `getSession` from `./session` (the `onnxruntime-node` loader, which
also reaches `node:fs/promises`) **and** did its own `await import('onnxruntime-node')` to build feed
tensors. Injecting only the session would not have been enough — the `Tensor` constructor belongs to
the runtime too.

So the port carries both, and they travel together deliberately:

```ts
interface ModelSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, ModelTensor>>
  float32(data: Float32Array, dims: number[]): unknown
}
interface ModelRuntime { session(fileName: string): Promise<ModelSession | null> }
```

A feed tensor must come from the same runtime as the session that consumes it. Handing them out
separately is how an `onnxruntime-web` tensor ends up fed to a node session.

`nodeModelRuntime` (`lib/oura-models/inference/runtime-node.ts`) is the server implementation and is
passed in at each composition root — the rollup wrapper on the adapter, `previewStepsBackfill`, and
the step-counter-export route. The types are structural rather than imported from either package:
the two `InferenceSession` types are not assignable to each other and a port needs neither full
surface.

`daytime-stress.ts`'s two ONNX functions — `computeDaytimeStress` and `buildDaytimeStressSeries`,
neither of which has any production caller — moved to `daytime-stress-inference.ts`, the same split
`daytime-stress-thresholds.ts` already got and for the same stated reason. On its own that removes
no edge, which is why the previous PR skipped it; combined with the injection it does.

## The result, measured

`run.ts`'s import graph, following value imports only:

| | modules | server-only edges |
|---|---|---|
| before the extraction | — | — |
| after #306 | 50 | 5 |
| after #308 (`sourceRank`) | 50 | 4 |
| **now** | **46** | **1** |

The one left is `lib/oura-models/constants` — `node:fs`, synchronous, and by its own header
"SERVER-ONLY, and structurally so". It is the single thing between here and a device rollup, and
**it is a port rather than a decision**: Q-221 already built the mechanism (inject the table,
serve it from an auth-gated route through the same accessor, fetch and cache it on the device) for
the steps-decoder constants, which the rollup already uses. Two more getters —
`getDaytimeStressConstants` and `getResilienceConstants` — want the same treatment, and the
measurement says that is the whole list.

## Verification

Full suite **542 files / 4,470 tests** green. `pnpm check:rules` → **51 of 51**. `pnpm build` clean,
and `scripts/build-rollup-worker.mjs` bundles — that one matters, because the rollup runs in a
`worker_threads` realm with its own esbuild bundle and is where an import-shape mistake would show.
Typecheck and lint 0 errors.

Nine call sites across seven test files gained an explicit `nodeModelRuntime` argument. That churn is
the point: every entry point now says out loud which runtime it is asking for, instead of the answer
being baked into a module three levels down.

**Not exercised:** on device. Nothing here runs a model differently — the same node runtime executes
the same sessions with the same tensors. What changed is who says so.
