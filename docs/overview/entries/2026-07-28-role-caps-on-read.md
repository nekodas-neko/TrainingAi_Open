# 2026-07-28 — Role caps applied on read, so stored prescriptions get corrected too

**Branch:** `fix/role-caps-on-read` · **Version:** v1.233.1
Follow-up to #880 (v1.232.0), which added the role-ordering rule at generation time.

## Why this was needed

Immediately after #880 merged, a production re-audit showed **Upper unchanged**: Skull Crusher still
`5×7 @77.5 %` against Incline Bench `4×7 @76 %`. The rule works — it just runs at *generation*, and
that prescription was generated **2026-07-22**, six days earlier. Stored prescriptions live up to
7 days, so the fix would not have reached it until expiry.

This is the third time in one day this exact class has bitten:

| PR | generation-time fix | stranded rows |
|---|---|---|
| #855 | set floor | 4 single-set exercises still live |
| #874 | (read-side floor added) | — |
| #880 | role ordering | Upper's accessory still out-loading the primary |

`normalizeStoredPrescription` already existed for precisely this reason (added in #874 for the set
floor) and is called from all four read paths. This extends it.

## What it does

`applyStoredRoleCaps` applies **only the two absolute rules**:

- the per-role **set ceiling** (accessory ≤ 4), and
- the **anchor load cap** (nothing out-loads the session's anchor).

**The anchor SET cap is deliberately NOT applied on read.** Its lagging-muscle exception depends on
weekly-volume data the read path doesn't have; enforcing it blind would delete sets that generation
granted a genuinely under-target muscle *on purpose* — turning a correction into a regression. A
stored set count above the anchor's is therefore left alone; only one above the role's own hard
ceiling is a bug on its face. There is a test asserting exactly this restraint.

Order matters: **cap before floor**, so a ceiling clamp can never land under the two-set floor.

`SET_CEILING`/`roleCeiling` moved from `time-budget.ts` into `role-plausibility.ts` so the ceiling
has one definition shared by the generation and read paths ("One Formula, One Place") — the read
path must not be able to drift from what generation enforces.

Roles are threaded from `programSession.exercises` (`exerciseRole`) at all four call sites. The
parameter is optional; omitted, the role caps are skipped and the rest of the normalisation still
applies.

## Verification — the binding case, finally observed

v1.232.0's Known-Issues row flagged that the clamp had never been seen to *fire*. It has now:

- Seeded the exact live Upper shape into the local DB (accessory `5×7 @77.5 %`, primary `4×7 @76 %`)
  and read it back through `GET /api/ai-periodization/session/[id]` → returned **`4×7 @76 %`**. Both
  clamps fired.
- **The stored row is unchanged after the read** (`5×7 @77.5 %` still in Postgres) — confirming this
  is read-side only, with no write side effect.
- 37 tests across the two modules; full suite green (2592 passed, 343 files).

**Not observed:** `workout-data`'s weight-bearing output. The local seed has an empty `baseline_1rm`,
so no 1RM exists to compute weights from and every exercise returns zero sets — unrelated to this
change. That path uses the same helper and the same role map as the verified one, but the corrected
numbers were not watched all the way onto a rendered set.
