# 2026-09-28 — LA-142 rebuilt on the BF-214 model: four dead derived columns, guarded, server only

#1749 dropped `active_calories_est`, `worn_hours_ble`, `vascular_age` and `pwv` from
`oura_daily_derived`. It predated BF-214, it could not be merged against a moving base (six
conflicts), and it also dropped the four columns from the **device's** SQLite, in a local upgrade
that its own comment admitted would throw on every retry if it half-applied. That is the failure
that has killed the device database twice. Rebuilt from current `main`:

- **Migration 294:** a guarded, replay-safe loop. Each column is dropped only if no row in any
  account holds a value, because the production evidence (133 rows, 0 values in each) is
  owner-scoped. The claude_ro view goes first, and `claude-ro-views.sql` is regenerated (the diff is
  the four columns).
- **The device keeps its physical columns.** The app stops reading and writing them (`types.ts`, the
  local read mapper, both upserts, the pull mapping), and there is no local migration at all. Four
  nullable columns cost nothing, and a half-applied `DROP COLUMN` costs the device its database.
- **Server:** schema, repository types, `DERIVED_COLS`, the row mapper, the push branch and the
  validator all drop the four. `oura_daily.vascular_age`, the stale Cloud vital the heart-rate page
  renders, is a different table and is untouched.

**Verified:** CI's replay reproduced locally is clean, and the upgrade on the owner's real data leaves
0 of the four columns, with all 133 rows present and readable through the view. The guard test runs in a
throwaway database. Mutations: removing the value guard, removing the existence check, and skipping
the view drop were all killed. Related suites 363/363.

**Merge order with LA-159 (#1847):** both regenerate `claude-ro-views.sql`. Whichever merges second
must re-merge `main` and regenerate, which CI's views-file test enforces. Held for the owner's yes,
as #1749 was. #1749 is superseded by this PR.

**Not done:** the entry's optional ratchet (a check that every derived column has a writer). It needs a reasoned allowlist, since `chronic_stress_*`, `recovery_index_hours` and the training-load pair are legitimately written but empty, so it is its own piece of work.
