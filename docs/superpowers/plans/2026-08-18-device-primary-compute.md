# Device-primary compute — closing D2 Task 5/6 and D3

_Planning session, 2026-08-18, owner-directed: **"do the D-track first, that should have a lot of
focus."** No implementation. Ends at a docs-only PR._

**The owner's own words for what they believed was already true:** *"I assumed all the ring data would
go directly to the phone and once it's aggregated and calculated it sends to DB."* That is the D-track
north star verbatim — *"the phone owns raw `body_hex` and does all compute (incl. ML); Railway holds
only a compact finished-form backup that never computes."* It is not what runs today, and this plan is
about closing that specific gap.

---

## 1. Why now: the architecture and the bill are the same problem

Railway usage, measured 2026-08-18 over ~19.6 days, projected monthly:

| Service | Avg RAM | Avg CPU | RAM $/mo | CPU $/mo |
|---|---:|---:|---:|---:|
| `TrainingAI` (app) | 0.61 GB | **0.22 vCPU** | **$6.07** | **$4.42** |
| `prod_DB` | 0.79 GB | 0.002 vCPU | $7.87 | $0.03 |
| Volume + backup + egress | — | — | \$0.25 total | |

**Total ≈ $18.63/month, of which storage is $0.12 — 0.6%.** The whole 2026-08-17 storage exercise
(805 MB → 171 MB) moved the bill by about nine cents. The money is in **compute the server should not
be doing**: the phone ships raw frames up, and Railway decodes them and runs SleepNet inference.

Moving that compute to the device is what the D-track has always been for. The bill is a second reason,
not a new one.

> **Honesty about the CPU number.** 0.22 vCPU sustained is *not yet explained*. Three hypotheses were
> tested and refuted by measurement: (a) a server cron — there is none, every `setInterval` in the repo
> is client-side; (b) the rollup re-decoding a 35-day window — **Q-213 already fixed that**, a persisted
> watermark narrows it to the touched span; (c) an epoch-mismatched watermark forcing the full window —
> anchors, frames and watermark all read epoch 0. Drains land ~19×/day for 1–6 active minutes, a ~3%
> duty cycle that cannot produce 0.22 vCPU. **Task 0 below is the measurement that settles it**, and no
> CPU-reduction claim in this plan should be treated as sized until it runs.

## 2. What is actually built — measured against `main`, not read from the progress doc

| Piece | State |
|---|---|
| D2 Task 1 — local-store Oura accessors | ✅ shipped, **inert**. `upsertOuraDailySummary` / `upsertOuraBucket` / `upsertOuraHeartrate` etc. exist in `lib/local-store/index.ts` + `sqlite-backend.ts`; nothing calls them. |
| D2 Tasks 2–3 — native `oura_raw.db`, local-commit cursor, bridge | ✅ shipped **and device-verified** (694-batch drain, kill-mid-drain clean). Bridge exposes `getUnrolledRaw` / `markRolledUp` / `pruneRaw` / `rawStats`. |
| D2 Task 4 — on-device clock anchor | ⚠️ built on an **unmerged branch**, not device-verified, no PR open. |
| Q-541 — frame packing | ✅ Tasks 0–4 shipped; two-tier reader `lib/data/postgres/slices/oura-raw-frames.ts` is live, 764 blobs packed 2026-08-18. |
| WASM parity (SleepNet, dHRV) | ✅ proven — `lib/oura-models/__tests__/wasm-parity.test.ts` anchors WASM output to the TorchScript golden. `lib/oura-models/inference/session-web.ts` exists. |
| **D2 Task 5 — rollup on device** | ❌ **not started.** The gap. |
| **D2 Task 6 — SleepNet + step_counter in WASM** | ❌ not started, and **blocked** — see §4. |
| **D3 — read-flip + single-writer flip** | ❌ not started. |

**Nothing in the JS layer calls the device bridge.** A repo-wide grep for `getUnrolledRaw` and
`markRolledUp` finds only the interface declarations in `lib/oura-ble/plugin.ts`. The device drains,
stores and cursors correctly — and then nothing consumes what it stored.

## 3. The shape of Task 5, and why it is a port rather than a rewrite

`aggregateOuraRawSamples` lives in `lib/data/postgres/adapter.ts` at lines **4958–6067 — 1,110 lines.**
Measured coupling: **17 lines** touch `this.db` / `.select(` / an `oura.*` slice helper. Everything
else is computation over already-shared helpers — `sleepNet`, `computeDailySummaries`,
`computeSleepScore`, `computeResilienceForDay`, `computeStepsByDay`, `resolveDsToMs`, `decodeEventBody`.

So the port is:

1. **Extract** the 1,110 lines into a runtime-agnostic module — proposed `lib/oura-ble/rollup/` —
   taking an **I/O port** instead of a `Db`:
   ```
   interface RollupIO {
     readFrames(range): Promise<Frame[]>          // the ~17 touchpoints, narrowed
     readAnchors(): Promise<ClockAnchor[]>
     readWatermark(epoch): Promise<number | null>
     writeFinishedForms(forms): Promise<void>
     writeWatermark(ds, epoch): Promise<void>
   }
   ```
2. **Two implementations.** Postgres (server, what runs today — via the existing two-tier reader) and
   local SQLite (device — via the Task 1 accessors that are already there and inert).
3. **The math moves once and is shared**, which is what `CLAUDE.md`'s **One Formula, One Place** rule
   requires anyway. A second hand-written device rollup would be the exact duplicate-implementation
   bug that rule exists to prevent.

**This is the single highest-leverage piece of work in the queue**, because it also closes three other
open items as a side effect (§6).

## 4. The blocker nobody has hit yet — verified today

> **⚠️ RESOLVED 2026-08-20 — this section is kept for the record and is no longer current.**
> `wasm-unsafe-eval` shipped in Q-546 (#259) and lives in `lib/security/csp.ts` with a test on both
> halves (the directive is present, and production still does not carry `'unsafe-eval'`). Task 1
> below is done. What actually blocks the neural port is one step further in: `getWebSession`
> (`lib/oura-models/inference/session-web.ts`) **has no importers** — all seven session consumers
> hard-import the onnxruntime-node loader, and `wasm-parity.test.ts` reaches `onnxruntime-web`
> directly rather than through it.


Task 6 needs WASM in the WebView. Production CSP, `next.config.ts:10`:

```
script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://accounts.google.com
```

**No `wasm-unsafe-eval`.** WASM cannot instantiate in production today. The master plan predicted
exactly this trap — *"the parity test runs under Node (no CSP) and would false-green"* — and the
prediction holds: `wasm-parity.test.ts` passes under vitest and proves nothing about the device.

**This is a one-line change plus an on-device verification, and it gates all of Task 6.** Do it early
and independently so the neural work is never blocked behind it.

## 5. Tasks

**Task 0 — measure the 0.22 vCPU before optimising it.** Open Railway's `TrainingAI` CPU graph at
~3-hour zoom. Drains land near the top of most hours (measured: ~19/day, 1–6 active minutes each). If
CPU **spikes with drains and falls between** → request-driven, and Task 5 removes it. If it is a **flat
plateau between drains** → a baseline leak or spin, and Task 5 will *not* fix it. **Do not size any CPU
saving until this runs.** Cheap, decisive, owner-run.

**Task 1 — ✅ SHIPPED 2026-08-20 (Q-546, #259).** `wasm-unsafe-eval` is in the production
`script-src`. The S25 assertion that a WASM session actually instantiates is still outstanding and
cannot be made until the first client-side model lands — it belongs to Task 4, not here.

**Task 2 — ✅ SHIPPED 2026-08-23 (#306).** `runOuraRollup(io, timezone, opts)` in
`lib/oura-ble/rollup/run.ts`; the port is 22 store operations, not the five §3 sketches, and
`run.ts` still reaches `onnxruntime-node` through `sleepnet-assemble`/`daytime-stress`. Original
text: extract the rollup behind `RollupIO` (§3), keeping the Postgres implementation
byte-identical in behaviour. **Gate: the server rollup produces identical `sleep_sessions` /
`body_metrics` output over a sample of historical days before and after the extraction.** This task
ships no behaviour change at all — that is the point.

**Task 3 — implement the device `RollupIO`** over `getUnrolledRaw` + the Task 1 local-store accessors,
and wire it to run after a drain: `getUnrolledRaw` → rollup → write local forms → **`markRolledUp`**.

**Task 4 — SleepNet + step_counter under `onnxruntime-web`**, using `session-web.ts`. Parity is already
proven against the TorchScript golden; what is unproven is instantiation under the real CSP on the
device (Task 1) and inference latency on the S25.

**Task 5 — queue the device rollup's output for push**, so finished forms reach Railway. The push/pull
halves already exist from D1 (`oura_daily_summary`, `oura_daily_derived`, `sleep_sessions`,
`body_metrics`); `oura_daily` still needs registering in `SYNCED_MUTATION_DOMAINS`.

**Task 6 — D3 read-flip**, gated on a **data-presence check, not a plugin-availability probe** (a fresh
APK has the plugin and an empty store → blank Oura screens). Soak with both paths agreeing.

**Task 7 — single-writer flip:** stop the server rollup writing the finished tables once the device
rollup is proven. Until this lands the server keeps computing and **the bill does not move** — the
saving is realised here, not at Task 3.

## 6. What this closes as a side effect

- **Q-538 — `oura_raw.db` unbounded.** Measured on device 2026-08-18: 209,326 rows, **0 rolled up**,
  31.2 MB. `pruneRaw` needs `rolled_up = 1`, and **`markRolledUp` is called by nothing** — Task 3 is
  what finally sets it. The device pruner cannot work before this, and works almost immediately after.
- **D7 / `onnxruntime-node`.** Once inference runs on the device, the server's ONNX runtime becomes
  removable — app RAM, and the `sharp`-adjacent dependency weight.
- **The rollup's blast radius on the request path.** I19, I20 and I26 are all "a rollup starved the
  request beside it". A rollup that does not run on the server cannot.

## 7. What must not break

- **The ingest path and the history cursor are untouchable.** Tasks 2–3 of D2 are device-verified and a
  botched change there silently loses drained spans forever (ops-doc I18, I21). This plan adds a
  *consumer* of the local store; it must not modify the writer.
- **`markRolledUp` must only ever follow a durable local write of the finished forms.** Marking a frame
  consumed before its derived output is stored is a data-loss shape: the pruner would then be free to
  delete the raw, and nothing would hold the result.
- **The server rollup stays live until Task 7**, and Task 7 is reversible only while server raw exists.
  D4 (dropping server raw) is **not** part of this plan and must not be pulled forward.

## 8. What this plan does not claim

- **It does not promise a dollar figure.** Task 0 has not run. The app's $10.49/month of CPU+RAM is the
  *ceiling* on what device-primary compute could remove, not a forecast.
- **It does not settle Railway-vs-elsewhere.** The owner's stated goal is to leave Railway if the
  benefits are there; this plan makes the server small enough that the question gets easier, and is
  deliberately independent of the answer.
- **It does not touch retention.** `body_hex` stays archival on the server, per the owner's A+B+C
  decision.

**Failure surfaces not exercised:** planning only, no code written. Every "state" claim in §2 was
checked against `main` today rather than taken from the progress doc — which is how the unmerged Task 4
branch and the missing `wasm-unsafe-eval` were found. Nothing here has run on the device.
