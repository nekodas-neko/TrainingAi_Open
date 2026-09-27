# 2026-09-26 — TN-83: the sleep verdict's calibration, decided and pinned

**Branch:** `tune/tn83-verdict-multiplier` · **Lane A** · closes `TN-83`

## What shipped

`VERDICT_IQR_MULTIPLIER` 0.5 → **1.00** and `SLEEP_VERDICT_MODEL_VERSION` 1 → **2**, in
`packages/shared/src/health/sleep-verdict.ts`. Two constants and one test. Nothing else changed.

## Why it is only two constants

The calibration is **the owner's call, not Lane A's** (CLAUDE.md: *"Tuning proposes; it never ships a
scoring change… the owner signs off and Lane A implements"*). TN-83 carried the measurement and the
proposal; the owner answered **1.00** on 2026-09-26. This entry is the implementation half, and its
whole job was to change the number without changing the rule.

## The number, re-confirmed against the shipped code rather than the sweep

The sweep in TN-83 was run against a replica of the scoring function. Before shipping, the same
count was re-run through the **actual exported functions** — `nightSessions()` → `toVerdictNights()`
→ `sleepVerdictForNight()` — over the owner's real 125 production rows, with the constant at its new
value:

| | judged nights | poor | good | normal | prominent / 30 nights |
|---|---:|---:|---:|---:|---:|
| ×0.5 (what shipped in TN-81) | 67 | 22 | 13 | 32 | 15.7 |
| **×1.00 (this change)** | **67** | **10** | **3** | **54** | **5.8** |

5.8 against a 4–6 target, with `good` still non-zero — which is the whole reason 1.00 won over 1.25
(4.9, but `good` halves to 2) and over 1.5 (2.2, and `good` goes to **zero**, deleting half the
feature). TN-83's ⛔ against 1.5 survived its own re-measurement.

## Why the model version had to move with it

`SLEEP_VERDICT_MODEL_VERSION` is stamped onto every stored verdict, and the point of storing it is
that a correction can later be paired with *the rule it was disagreeing with*. Changing the
calibration without moving the version would leave two incompatible rules sharing one version, and
every stored correction would silently become unattributable. The two constants are one change.

**No stored verdict needed reinterpreting** — production holds **0** rows in `sleep_verdicts`,
checked before the edit. Had it held any, they would have been version-1 rows judged by a rule that
no longer exists, which is exactly the situation the version stamp exists to make legible.

## The test, and the honest reason it exists

All 33 pre-existing verdict tests **pass at 0.5 and at 1.00 alike**. That is by design — they use
deliberately extreme values so they assert the *rule* rather than the tuning — but it means nothing
in the suite would have noticed the calibration being changed, or drifting back. So the change ships
with one test that pins both constants together.

Mutation pass, 3 mutants + 1 equivalent control:

| mutant | result |
|---|---|
| multiplier back to 0.5 | **killed** (1 test) |
| model version left at 1 | **killed** (1 test) |
| multiplier drifts to 1.25 | **killed** (1 test) |
| *control:* `1.0` → `1.00`, same value | **survived**, as it must |

Each mutant was killed by exactly one test — the new pin — which is the measurement confirming the
gap above rather than a claim about it.

## Not user-visible, and why that is a fact rather than a hedge

Nothing renders the verdict yet: `grep` for `sleep-verdict` across `app/`, `components/` and `lib/`
finds only the route itself. So there is no version bump and no changelog entry, and no device
verification is owed — the announcement surface is `TN-82`, still queued, and it will be the change
that needs the phone.

## Files

- `packages/shared/src/health/sleep-verdict.ts` — the two constants, with the sweep recorded in the
  docstring so the next person to touch the number sees what it cost to pick.
- `packages/shared/src/health/__tests__/sleep-verdict.test.ts` — the pin.
- `docs/implementation-backlog.md` — TN-83 removed; `TN-82`'s copy discussion amended, since its
  "which, until TN-83 lands, is often" no longer held.
