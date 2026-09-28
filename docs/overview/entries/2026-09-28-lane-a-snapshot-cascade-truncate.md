# 2026-09-28 — the snapshot loader emptied child tables and reported a clean restore

The first complete snapshot load (after #1837 fixed the server side) printed "all counts match", but
the database held 120 sessions and **0** sets, 0 nights and 0 Body Battery days. Each table was
truncated with `CASCADE` just before its own insert, which emptied every table referencing it,
including ones loaded earlier in the alphabet: `workout_sessions` cascaded through `exercise_logs`
to `set_logs`, and `users` cascaded to most of the rest. The count check compared the manifest
against the insert counter, never against the table.

The loader now truncates every table in one statement before loading, and verifies each against
`count(*)`. **Control:** putting back the per-table truncate now fails the check (`activity_logs:
loaded 0, manifest said 62` …), rolls back, and leaves the database as it was (1,317 sets intact).

`docs/local-agent-environment.md` §④ now describes two lane databases. `trainingai_lane_a` is seeded
and used by the suite, and `trainingai_lane_a_snapshot` holds real data. A snapshot load truncates
everything and the suite writes fixtures, so the two cannot share one. The section also notes that
vitest needs `DATABASE_URL` exported.
