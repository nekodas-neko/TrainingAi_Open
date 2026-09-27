# TN-74 — the "dead field" was load-bearing offline, and the real defect was underneath it

**Branch:** `lane-a/tn74-deload-estimate-predicate` · **Lane A**.

## The trap

TN-74's remaining item 2 read: *"`target80` is an accepted input that silently does nothing…
Either drop it from the schema or honour it."* The server half is exactly right —
`log-exercise.ts:224` destructures `target80` from `estimateOneRm`, shadowing the payload field.

It is false of the device. `sqlite-backend.ts:459-460` writes `payload.estimated1rm` and
`payload.target80` straight into the local `exercise_logs` row, under its own comment *"use
client-provided offline estimate if present"*. **Taking either remedy the entry offered would have
removed the 1RM from every offline-logged exercise on the device until it synced** — on the
offline-first path, which is the canonical runtime.

The field is not dead. It is read by a different consumer than the one the entry looked at.

## The real defect, which is fixed

Looking for who supplies that offline value turned up the actual problem: the predicate deciding
whether an exercise's 1RM estimate is suppressed existed in **two copies**.

- `packages/shared/src/workout/log-exercise.ts:218` — server
- `components/workout-screen.tsx:1224` — client, and this one decides what the device stores
  offline

Both computed `exerciseDeloaded === true || (isAnyDeload && !isBaseline)`. **They agreed**, which
is why nothing had broken and why a reader would pass over it.

They are one function now — `isDeloadedForEstimate`, exported from the shared module and called
from both.

**Why it earns a change despite the two copies agreeing.** `estimated_1rm > 0` **is** the deload
test (`adapter.ts:1482`), not a proxy for one. A drift between the copies would not surface as a
wrong number on a screen; it would surface as an offline-logged exercise disagreeing with the
server about whether a deload happened at all — on the field that encodes the answer.

## The mistake this cost, and the gate that was missing

The predicate first went into `packages/shared/src/workout/log-exercise.ts`, beside the server
call that used it, and the client imported it from there. `tsc` passed. **CI's Build did not**,
and the import trace says why:

```
./lib/data/postgres/adapter.ts → ./lib/data/index.ts
→ ./packages/shared/src/workout/log-exercise.ts → ./components/workout-screen.tsx
```

`log-exercise.ts` reaches the repository, which reaches the Postgres adapter, which reaches
`onnxruntime-node` — so importing it from a client component pulls a **native binary into the
browser bundle**. Being under `packages/shared/` does not make a module client-safe, and
**typecheck cannot tell you**: the types resolve perfectly. Only the bundler knows.

It now lives in `packages/shared/src/1rm.ts`, which has **no imports at all** — a true leaf, and
already the home of `estimateOneRm`, whose `deloaded` argument this computes.

**The gate I skipped was `pnpm build`.** For anything that adds a client-side import of a shared
module, typecheck plus tests is not enough, and this is the one failure mode where local green and
CI red are guaranteed rather than unlucky.

## Verification

- New test, **6 cases**: per-exercise deload, session/phase deload with no per-exercise flag
  (the Q-298 case), the baseline carve-out, the asymmetry that a baseline does **not** override an
  explicit per-exercise deload, the all-false case, and `undefined` reading as false.
- **Mutation pass: baseline survives, 3 killed, 1 equivalent control survives.** Killed: `||`→`&&`;
  dropping the baseline exemption; making `isBaseline` override the per-exercise flag too (the
  tempting simplification). Control: `=== true` → truthy.
- `tsc` clean; **`pnpm build` clean** (the check that caught the first attempt); `check-test-typecheck` 316/87, none above baseline; Custom Rules **82 of 82**.
- `packages/shared/src/workout` + `packages/shared/src/__tests__`: **649 passed (49 files)**.

## Not exercised

No device run — and this is the one change in a while where that matters, because the copy being
replaced is the client's, and the behaviour it governs is what the device stores **offline**. The
two expressions are textually identical and the test pins the truth table, so the risk is low, but
the offline log path itself was not exercised on the phone. `pnpm dev` cannot reach it:
`getLocalStore` returns null in the web sandbox.

## Still open on TN-74

Item 1 only: four zero-1RM rows whose `target_80` was set by some later write path, 6–7 hours
after logging. Which path is still not established. Repairing the historical rows remains the
owner's call, as the entry says.
