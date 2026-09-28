# 2026-09-28 — OR-202: `next-schema-number.js` prints a page, not a wall

A run printed **470 KB**. About 100 stale branches still hold the `claude_ro_views` migrations that
BF-214 ① deleted, and each was listed once per branch; number 274 alone named one file on 44
branches. `summariseClaims` (`scripts/lib/migration-claims.js`) now collapses a (number, file)
claim to one line with `origin/a, origin/b +N more`. It also drops the dead pattern, reporting only
a count of the stale branches, and a collision whose only other claimant is that pattern is no
longer a collision. The same run is now **1.2 KB**.

The real collision that had been hidden now shows on its own line:
`273_exercise_media_review_status.sql (merged) vs 273_vendor_table_rename_phase_3.sql
(origin/lane-a/q44-phase3-pr1-table-rename)`. That branch has no open PR, so under the branch rule
it is sweepable and not a live claim.

The entry's alternative, pruning the stale branches, is not done here. The tool should read cleanly
whether or not they exist. Tests: `or202-claims-summary.test.ts`, with 4 of 4 mutants killed. One
survived at first and needed a case (a live file against a dead one) to kill it.
