# 2026-09-20 — TN-53 engine: HRR-60 now has to be a 60-second measurement

**Branch:** `lane-a/tn53-hrr-density-gate` · **Lane A** · Tuning filed it, Lane A implemented the
engine half. **The render half is Lane B and is NOT done** — see the Keep on the entry.

## The defect

`hrr1` means "the drop 60 s after the set". Nothing checked that the two readings it differences
were 60 s apart — only that each sat near its own target. `/api/health/trends` recomputes it live
from a raw `getHrForWindow` with no gate at all, while its sibling `exercise-hr-trend.ts` filters
every metric mean on `coverageOk`.

## What the entry got wrong, and why the fix is better for it

TN-53 quoted `nearestBpm(readings, target, windowMs = 90_000)` as applying to **both terms**. The
second term uses **45_000** (`hr-analysis.ts:73`). Re-deriving from the real code:

- `bpmAtLog` ∈ `log ± 90 s`
- `bpm60` ∈ `log + 60 s ± 45 s`
- so the pair spans **−75 s to +195 s**

That is *wider* than the entry's "150 s apart", and it includes the case that makes it obviously
wrong rather than merely imprecise: **one reading can satisfy both terms**, producing a drop of 0 —
a fabricated "no recovery" — from a single data point.

## Implemented as a separation check, not the proposed reading-count gate

The entry's first action was "require a minimum reading density in the window". The defect it
*names* is that the two readings are not checked to be 60 s apart. Those are not the same thing: a
count both over-rejects (a sparse set whose two readings happen to straddle 60 s genuinely can
measure HRR) and under-rejects (a dense set whose readings cluster on one side cannot). The gate is
therefore on the measurement — 45–75 s, ±15 s of the nominal 60 — with the constants exported so
the tests assert the boundary from them rather than restating it.

The density numbers are the *reason* the gate is needed, not the gate itself.

## The density claim reproduced exactly

Production, 2026-09-20, `set_hr_stats`:

| source | sets | `coverage_ok` | readings/set |
|---|---:|---:|---:|
| chest_strap | 220 | 91.4% | **111.8** |
| `ble` (ring) | 79 | 54.4% | **7.1** |
| NULL | 615 | 22.9% | 17.0 |
| mixed | 4 | 75.0% | 9.8 |

The 4-row `mixed` bucket was not in the entry. Everything else matches to the decimal.

## Where the gate went

Inside `analyseHrRecovery` — the single HRR formula — rather than in the route. All four `hrr1`
consumers (`oura/hr-data`, `health/trends`, `hr-recovery-by-exercise`, `progress-markers`) already
treat null as unknown, and `exercise-hr-trend.ts` does not read `hrr1` at all, so the already-gated
sibling is untouched. One formula, one place.

`peakBpm` and `bpmAtLog` still report when the HRR is refused: the gate is on the 60-second drop
only, and those two are measured rather than inferred.

## Verification

`packages/shared/src/workout/__tests__/tn53-hrr-separation-gate.test.ts`, 7 cases.

**Mutations:**

| mutation | result |
|---|---|
| gate removed (pre-TN-53 behaviour) | **5 of 7 fail** |
| **control — gate rejects everything** | **2 fail**, exactly the accept-cases |

The second is the one worth having. A gate that returns null unconditionally would satisfy every
"refuses" test; the dense-chest-strap case and the both-bounds case are what stop that passing.

**Equivalent control:** reordering the `&&` terms — green. **Neighbours:** all 115 HR/health test
files pass unchanged, 1248 tests.

## Not exercised

- **No browser or device check.** The engine emits nulls; how the sparkline *draws* a null run is
  unverified and is the Lane B half. A gap that renders as a broken chart is not an improvement
  over a wrong number, which is why that is written as a Keep rather than left implied.
- The owner's stated pass test — the sparkline showing a gap across the strap-dark period — is
  **unverified**.
