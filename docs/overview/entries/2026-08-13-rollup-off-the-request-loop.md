# 2026-08-13 — the BLE rollup runs in a worker thread (Q-213 Stage 2)

**Branch:** `claude/trainingai-backlog-v0abea`

`POST /api/oura-ble/samples` dispatches the rollup through `runRollupOffLoop`
(`lib/oura-ble/rollup-worker.ts`) instead of calling `repo.aggregateOuraRawSamples` on the request
thread. The work runs in a `worker_threads` realm with its own `pg` pool.

This is the last piece of the 2026-08-13 outage. Stage 1 plus the watermark took a real ring sync
from 15–30 min to 2 min, and that was still not enough: at 15:47:33 a concurrent ingest returned
**500 after 27.6 s**, `getNewestOuraClockAnchorByUtc` failing with `Connection terminated due to
connection timeout` while a two-minute rollup held the thread. `pg`'s connect timeout is a JS timer,
so a blocked loop kills healthy connections while the database answers in milliseconds — and a
non-2xx there holds the ring's history cursor and triggers a re-drain. Narrowing shortens the window
in which that can happen; only moving the work off the loop removes it.

## Why it needs its own bundle

The repository reaches `onnxruntime-node`, a native addon webpack cannot bundle
(`serverExternalPackages` in `next.config.ts`), so there is no Next build output a `Worker` could be
pointed at. `scripts/build-rollup-worker.mjs` esbuilds `lib/oura-ble/rollup-worker-entry.ts` into
`.rollup-worker/rollup-worker.cjs` with the native deps external. It runs from `pnpm build` **and**
`pnpm dev`, so the bundle always matches the tree and dev exercises the worker rather than the
fallback. Output goes to `.rollup-worker/` because `next dev` and `next build` both own `.next`.

Three details that would otherwise be found the hard way:

- The worker uses `new PostgresWorkoutRepository()` directly, **not** `getRepositoryAsync()` — the
  latter calls `ensureSchema()`, and a second ~180-file migration sweep racing the main process's is
  a hazard, not a safety net.
- `poolMax()` in `lib/data/postgres/client.ts` reads `PG_POOL_MAX` and **can only ever lower** the
  10. The worker asks for 2, so a replica running a rollup holds 12 connections rather than 20. An
  env var that could raise it would be a way to breach the Railway connection budget by typo.
- esbuild targets `node20`, not the sandbox's node 22 — CI's Tests job pins node 20.
- `.rollup-worker/**` had to be added to `eslint.config.mjs`'s ignores. Being gitignored is not
  enough: eslint happily linted the 3.4 MB bundle and reported drizzle's and pg's own violations as
  ours — including a `no-restricted-syntax` timezone hit that reads exactly like a real one.

## The fallback is the safety property

If the bundle is missing or the worker will not start, `runRollupOffLoop` runs the rollup in-process:
exactly today's behaviour. A broken worker degrades to the status quo, it never drops a rollup. That
is proven, not asserted — with the bundle deleted, the correctness test still passes.

## Verified

Full suite green on the merged tree — 463 files, 3,805 tests, zero failures. `tsc --noEmit` clean, lint 0 errors,
`pnpm check:rules` 33 of 33 (main added two rules mid-session — the runner picked them up without being told, which is the point of parsing the YAML). `pnpm build` exits 0 with the new esbuild step in front of it.

**Measured, and the numbers are the point.** A 20 ms interval on the main thread, sampled across a
rollup:

| | rollup duration | worst main-thread lag |
|---|---|---|
| in-process | 262 ms | **185 ms** — the loop was gone for 71% of it |
| in the worker | 439 ms | **4 ms** |

The test asserts lag as a *fraction* of each run rather than a millisecond budget, so it does not
depend on machine speed. The first threshold considered — an absolute 250 ms — would have passed the
blocking run too, which is how a test like this ends up proving nothing.

**Mutation-verified, three ways:**

- Forced `getWorker()` to return null (every call takes the fallback) → the lag test fails,
  `expected 133 to be less than 51.25`.
- Made the worker reply without running the rollup → the correctness test fails, `expected [] to
  deeply equal [ {…} ]`, and the lag test's own degeneracy guard fires (`expected 1 to be greater
  than 100`).
- Deleted the bundle → the guard test fails as designed, and the correctness test still passes,
  which is the fallback proof above.

**Exercised on the dev server**, since a green unit test is not the changed route. Logged in as the
seeded admin, `POST /api/oura-ble/samples` with a real `0x76` frame returned
`{"stored":1,"aggregateCoalesced":true}` in 385 ms, the log carried `rollup worker ready` exactly
once, and `oura_rollup_state.last_rolled_ds` advanced to the posted timestamp. The handshake line is
the positive proof it went through the worker rather than the fallback — absence of the fallback's
warning would not have been.

**Not exercised:** production, and it is the only place the claim finally settles — a performance
change's cost model is a claim about production, and both of the outage session's confident
predictions were wrong. Watch Railway CPU for the sustained 1.0–1.6 plateaus and `/api/version`
latency after this deploys. Also not exercised: the S25, native SQLite, Capacitor plugins,
safe-area, WebView — this is server-side only and ships through a Railway deploy with no new APK.

**One risk worth stating plainly:** the worker realm loads its own copy of the ONNX sleep models. In
steady state that is a *move* rather than an addition, since the ingest path was the main process's
only regular reason to load them — but the redecode route can still load them in the main process, so
a container that runs both holds two copies. Memory measured 0.553 GB after the watermark landed;
this needs watching, not predicting.

## Deliberately not done

`app/api/oura-ble/samples/redecode/route.ts` still runs both `redecodeOuraRawSamples` and a
`fullHistory` aggregate in-process. It is admin-triggered, rare, and the caller is waiting on the
result. Moving only its aggregate would leave the heavier `redecodeOuraRawSamples` on the loop and
read as finished, so it was left whole and filed instead — see the Q-213 entry.

Stage 3 (the coalescing predicate, `isFinalOrSmallBatch` meaning "any batch") is untouched and stays
in the queue.
