# 2026-09-28 — LA-114: the stress bucket column is named for what it holds

`oura_daytime_stress_buckets.bucket_start` has always held the bucket's midpoint. A join written
the obvious way against a 30-minute series on the :00/:30 grid therefore returned nothing, and
that cost an hour on 2026-09-16. The rename was tried that day and reverted, because every
historical `claude_ro` view migration selected `t.bucket_start` and all of them failed on replay.
**BF-214 ① deleted those migrations**, which removed the blocker. What remains is migration 275's
`COMMENT ON COLUMN`: one replay exemption with its reason, not a dozen.

Migration `202609280647_rename_stress_bucket_mid.sql` is the **first migration named by the UTC
minute** (BF-214 ②). It renames the column to `bucket_mid` and is idempotent, renaming only while
the old name exists. The Drizzle column, the views file and two tests follow. The rehearsal on the
snapshot database kept all 802 rows and their values. The CI replay is clean (275 exempt), and 32
related test files are green.

This also corrected BF-214 ②'s own test. It asserted "numeric order equals string order on the
real directory", which held only until the first timestamp file existed. It now asserts the real
invariant: `NNN_` files keep their order, and every timestamped file runs after them.

**Deploy note:** for the minute an old container overlaps a new one, old code writing
`bucket_start` fails. The ingest cursor advances only on a 2xx, so the device re-sends and nothing
is lost.
