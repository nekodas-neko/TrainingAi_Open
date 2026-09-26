# 2026-09-26 — LA-150: a session that ended before the first heart-rate reading is not pending work

**Branch:** `fix/la150-bound-hr-backfill-scan` · **Lane A** · closes `LA-150`.

Both HR backfill work lists floored their scan at a flat 180-day retention window.
`oura_heartrate` is **younger than its own retention window** — its first row is 2026-06-22, and
the floor reaches back to 2026-03-30 — so every session in that gap matched the predicate forever.
Each run reported the same count and filled nothing, which reads exactly like a broken backfill.
The device agent hit it on 2026-09-24 and reasonably asked whether the raw samples had been pruned.

The fix is one predicate: `completed_at >= (SELECT MIN(timestamp) FROM oura_heartrate WHERE …)`.

## Measured against production first, and the entry was right

For once the entry's numbers held up exactly. Read through the admin endpoint on 2026-09-26:

| work list | pending | unfillable | genuinely fillable |
|---|---|---|---|
| `listSessionsMissingSetHrStats` (the one LA-150 named) | 33 | **33** | 0 |
| `listSessionsMissingHrStats` (the sibling it did not) | 36 | **34** | **2** |

Earliest heart-rate row: `2026-06-22T01:26:45Z`. Oldest pending session: `2026-04-30`.

## Two things the entry did not say

**The sibling has the identical defect.** `listSessionsMissingHrStats` — the whole-session list
behind `/api/oura-ble/backfill-hr-stats` — is the same shape: a retention-day floor on `started_at`
plus a coverage-aware `readings_count = 0` predicate. LA-150 named only the per-set one. Both are
fixed here, per the sibling-surface rule. The sibling is the more interesting of the two, because
its list is **mixed**: bounding it removes 34 phantoms and leaves the 2 real items visible instead
of buried.

**The bound belongs on `completed_at`, not `started_at`.** The entry said "bound the scan at the
earliest `oura_heartrate.timestamp`" without naming a column, and the obvious reading — tighten the
existing `started_at` floor — would discard a session that began ten minutes before the first
reading and ran across it. Its window is partly coverable, so it is real work. A test covers that
straddling case directly, and the mutation that moves the bound to `started_at` fails it.

A NULL from the subquery — no heart-rate rows at all — makes the comparison NULL and excludes every
session. That is the right answer for an account with no HR data, and it needs no special case.

**No sentinel row**, per the entry's explicit prohibition: the coverage-aware `readings_count = 0`
predicate exists precisely because empty rows used to hide real gaps (Q-11 Defect B), and writing
one under another name walks straight back into it.

## Verification

- Full suite green; lint **831**, exactly baseline; `check-test-typecheck` at baseline; Custom
  Rules **80 of 80**. No version bump — nothing user-visible changed.
- A new DB-backed test (`la150-unfillable-sessions.test.ts`, 4 cases) covers the drop, the straddle,
  the no-readings case and the retention floor still applying.
- **Three** existing DB-backed files needed a heart-rate row added to their fixtures. They are about the
  soft-delete filters and the coverage rule, and with no readings at all the new bound emptied
  their lists — so every `toContain` failed and every `not.toContain` would have started passing
  for the wrong reason. The fixtures now seed one reading old enough to keep their sessions
  fillable, which is the honest fix rather than loosening the predicate. **The third
  (`oura-workout-hr-stats.test.ts`) only surfaced in the full suite** — I had run the two I
  reasoned my way to and missed the one covering the sibling list I had just changed.
- Mutation pass, 3 real mutants + 1 control: moving the bound to `started_at` killed 1 (the
  straddle), removing it from the per-set list killed 2, `MIN → MAX` killed 1. The control
  (`>=` → `>`, on timestamps that never collide exactly) survived.
- **`MIN → MAX` survived the first run**, because every fixture had exactly one heart-rate row, so
  the two agreed. That is the worse mutant of the pair — `MAX` would exclude every session older
  than the most recent reading, which in production is nearly all of them. The first case now
  seeds two readings so the fixture can tell them apart.

**Not exercised:** production. The measurements above are reads, not a run of the backfill route
against the fixed query — so the predicted "33 pending → 0, 36 → 2" is a calculation from the same
data the route would see, not an observed result. Running either backfill endpoint after deploy
would confirm it, and either reporting nothing pending is the signal.
