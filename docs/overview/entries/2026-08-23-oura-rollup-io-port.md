# 2026-08-23 — The Oura rollup now takes an I/O port (Q-545, D2 Task 2)

**Branch:** `feat/oura-rollup-io-port` · **Lane A** · no behaviour change

The D-track's north star, in the owner's words, is *"all the ring data goes directly to the phone
and once it's aggregated and calculated it sends to DB."* Today it is inverted: the phone ships raw
frames up and Railway decodes them and runs SleepNet. Q-545 is the missing middle, and this is its
Task 2 — the extraction that makes a device rollup possible without writing a second one.

## What shipped

`PostgresRepository.aggregateOuraRawSamples` was 1,102 lines of computation with its stores wired
straight into the method body. It is now:

| file | what it is |
|---|---|
| `lib/oura-ble/rollup/run.ts` | `runOuraRollup(io, timezone, opts)` — the whole computation, runtime-agnostic |
| `lib/oura-ble/rollup/io.ts` | `RollupIO` — every store the rollup touches, 22 methods |
| `lib/data/postgres/rollup-io.ts` | `createPostgresRollupIO(deps)` — the server implementation |
| `lib/data/postgres/adapter.ts` | a 10-line wrapper; the file drops 6,906 → 5,818 lines |

`RollupIO` is bound to one user by the implementation, so the rollup itself never handles a
`userId` and structurally cannot write across one.

**The gate this entry named was "identical output over a sample of historical days".** The
in-repo form of that gate is the **20 test files** that drive `aggregateOuraRawSamples`
end-to-end against real Postgres — sleep staging, night merge, anchor drift, step rollup and
backfill, SpO₂ day-keying, HRV median, illness persistence, incremental window, daily summary.
All 20 pass unchanged, and so does the full suite (542 files, 4,470 tests) and all 51 Custom
Rules steps.

## Two premise corrections, both of which change how Task 3 should be sized

**1. The port is 22 methods, not five.** The plan measured *"17 lines touch `this.db` / `.select(`
/ an `oura.*` slice helper"* and sketched a five-method interface from it. Lines are not
operations: there are **28 touchpoints across 22 distinct store operations** — nine reads (two
anchor reads, the watermark, raw frames, step live-windows, existing steps, workout windows, the
latest daily summary, the daytime-HRV model, daily derived) and thirteen writes. Anyone sizing the
device implementation off "five methods" would be out by about four-fold.

**2. ⚠️ The I/O is portable now; the models are not, and this extraction did not change that.**
`run.ts` still reaches `onnxruntime-node` transitively — `sleepnet-assemble` → `inference/sleepnet`
→ `inference/session.ts`, and `daytime-stress` → `inference/dhrv` → the same loader — a file whose
own header reads *"server-only: onnxruntime-node is a native addon and must never reach the client
bundle."* So Task 3 needs the model session injected the same way the I/O now is. `session-web.ts`
already exists as the WASM sibling, which is plan Task 4, and that is gated on plan Task 1: the
production CSP has no `wasm-unsafe-eval`, so WASM cannot instantiate on the device at all today.

A smaller one, worth doing when Task 3 lands: `sourceRank` (`lib/data/health-source.ts`) drags
`drizzle-orm` into the module graph for what is a rank lookup.

## Not exercised

No device run — this is a server-side refactor that reaches the APK through a Railway deploy with
no rebuild, and the rollup's on-device path does not exist yet. Not exercised against drifted
production data either: the gate is the test corpus against a fresh local Postgres, which is the
same gate the rollup has always had.

## What this does *not* claim

Nothing here moves the bill. The rollup still runs on the server, computing exactly what it
computed before. The saving lands at plan Task 7, the single-writer flip, and every task between
here and there is still open.
