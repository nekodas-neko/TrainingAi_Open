# The half that cannot be repaired afterwards (OR-102a)

**Branch:** `feat/or102a-vial-and-dose-time` · **Lane:** A · **Domain:** platform / body
**Version:** 1.436.20 · **Postgres 267 + 268 · local SQLite v38**

Two columns' worth of engine, and both exist because of something that stops being fixable the
moment a dose is logged without them.

## `supplement_logs.taken_at`

The table had `log_date`, a DATE, and no time at all. "Correlate sleep and heart rate against the
dose" was not expressible.

It is also the column that makes the one honest analysis possible. On a titration, dose, cumulative
level and elapsed time all rise together, so almost nothing separates them — **except
hours-since-dose within a single week**, which varies while the dose is held constant. With no time
recorded that contrast does not exist, and the tracker could only ever show correlations confounded
by the schedule.

Nullable, and it stays nullable. Rows predating the column have no time, and defaulting them to
midnight or `created_at` would manufacture data points for exactly that analysis.

## The reconstitution, frozen on the log

A vial gets `strength_mg`, `water_ml`, `syringe_units_per_ml` and `opened_on`. **Concentration is
derived and stored nowhere** — a stored concentration is a third number that can disagree with the
two it came from, and the first time it does, nothing says which is right.

The part that matters is that the three numbers are stamped **on each log**, not only on the vial.
Mix the next vial at a different water volume and the same milligram dose becomes a different number
of syringe units. The stored mg stays correct, so nothing looks wrong — a historical "15 units" just
quietly starts meaning something else. This is BF-3's dose freezing one layer up.

Three numbers rather than a `vial_id` FK, deliberately: an FK points at a row that can be edited
afterwards, which is the rewrite this prevents. The test that matters re-mixes at half the water and
checks the earlier log still reads 50 units while the new one reads 25.

`frozenReconstitution()` returns `null` unless all three are present. A log with no stamp cannot be
expressed in units, and saying so is the honest answer — falling back to the *current* vial is the
retroactive rewrite in a different costume.

## The offline window, which the entry did not mention

`upsertSupplementLog` already fills BF-3's dose freeze from the local `supplements` row, because
stamping at the call site is what makes today's UI freeze the dose with no UI change. The vial
freeze needs the same treatment for a stronger reason: a log stamped by the **server at push time**
carries whatever vial is current when sync happens, not when the dose was taken. That is the same
retroactive rewrite with a shorter window.

So the device gets a read-only `supplement_vials` mirror through the pull delta, and the local write
path stamps from it. Vials are still created server-side only.

## What CI caught that I had not

Two custom rules failed on the first complete pass, both correctly:

- **`supplement_vials` was in neither the export allowlist nor the exclusion list.** Q-288's rule;
  registered as `user_id`-scoped with a `deleted_at` filter.
- **`listSupplementVials` and `updateSupplementVial` had no caller.** A repository the surface
  cannot reach is not wired, and the rule's own message says this has shipped three times and was
  never caught by a compiler, a linter or a test. Fixed by adding the four API routes —
  `app/api/**` is Lane A's, so they belong in this half rather than the next.

## Verification

- `tsc --noEmit` clean · **774 passed | 5 skipped (779 files), 6598 tests** · `pnpm check:rules`
  **68 of 68** · lint 0 errors
- Migration 267 applied against local Postgres and the table read back; 268 regenerated the
  `claude_ro` views and **diffs against 266 by exactly the four new columns and the new view**
- 11 formula cases, including the round-trip both directions and the refusal of zero water (which
  would otherwise return `Infinity` and render as a plausible dose)
- 9 repository cases against real Postgres, including the re-mix test and cross-user refusal
- **Mutation-verified:** removing the stamp fails the two freeze tests by name
- All four new routes load and fail closed (401) on `pnpm dev`

## Not exercised

**The device.** Local SQLite v38 has not been opened on hardware — `getLocalStore` returns null in
the sandbox, so the migration, the vial mirror and the offline stamp are verified by unit test and
by reading, not by running. No APK is needed for the server half (Railway delivers it), but the
local-store half is device-only and should be smoke-run before it is trusted. There is no UI yet:
OR-102b is the surface.
