# 2026-09-20 — BF-55: the database is not growing 7× its trend; two windows had not filled

**Branch:** `lane-a/bf55-growth-attributed` · **Lane A** · docs-only. Fifth KEEP-mined item of the
session, after LA-63, LA-123, LB-27 and LA-74.

## The question that was open

BF-55's index half shipped 2026-09-01. Its `Keep:` was *"the growth trend, which this did not
explain"* — ~2.1 MB/day unaccounted for after excluding the archive, against a ~0.4 MB/day
expectation, last read 2026-09-04.

## Measured 2026-09-20

**227.4 MB** on `sum(pg_total_relation_size)` over `pg_stat_user_tables` — the same measure as the
171 / 200 / 204 / 224 series, stated explicitly because BF-55 records nearly walking into the trap
of mixing it with `pg_database_size`, which reads **242.2 MB** today.

That is **1.71 MB/day against RV sweep 50's 224 MB two days ago, and 1.71 MB/day against the 171 MB
baseline 33 days ago.** The rate is stable, not accelerating.

## The answer, and it inverts the recorded evidence

CLAUDE.md said the growth was *"bounded and explained"* because `oura_raw_samples` reclaims into the
archive, `oura_heartrate` "spans 88 days against its ~90-day window **(steady state)**", and
`rr_intervals` "spans 60".

**The 90-day window belongs to `rr_intervals`. `oura_heartrate` prunes at 180** —
`HR_RETENTION_DAYS` in `lib/data/postgres/slices/oura.ts`, and the comment beside the `rr_intervals`
prune says so outright: *"its sibling oura_heartrate prunes at 180d"*.

So at a measured span of **90.6 days**, `oura_heartrate` is **half-filled and has never reclaimed a
row**; `rr_intervals` at 60 of 90 has not either. Both tables offered as evidence of steady state are
still filling — and that is the whole of the trend BF-55 chased for three weeks. **A window that has
not reached its cap reclaims nothing and grows at the full ingest rate.** The ~0.4 MB/day
expectation implicitly assumed a steady state that had not arrived.

| table | size | span | cap | MB/day | filled |
|---|---|---|---|---|---|
| `oura_heartrate` | 33 MB | 90.6 d | **180 d** | 0.36 | 50% |
| `rr_intervals` | 23 MB | 60 d | 90 d | 0.38 | 67% |
| `oura_raw_packed` | 24 MB | 33.4 d | *none — archive* | 0.72 | permanent |
| **sum** | | | | **1.47** | |

Against a measured 1.71 MB/day that leaves **0.24** for small tables and index growth. The
attribution closes.

`oura_raw_samples` genuinely is at steady state: **7.4 days under a 31-day cap**, the packer
reclaiming into `oura_raw_packed`. That half of the old explanation was right.

## The falsifiable prediction, which is the point

Total growth should **step down twice**: around **late October**, when `rr_intervals` reaches 90
days, and around **2026-12-19**, when `oura_heartrate` reaches 180 (its oldest row is 2026-06-22).
It should settle near **~0.96 MB/day** — the archive plus the small-table remainder.

**A step that does not arrive is the signal**, and it is a far better one than a daily figure,
because it fails loudly in one direction only. That replaces the "7× trend" framing, which compared
a filling system against a steady-state expectation and could only ever read as alarming.

## What must not be "fixed"

`oura_raw_packed` at 0.72 MB/day is 42% of current growth and the single largest grower. It is the
archival source of truth — `body_hex` is never pruned on the server, because a decoder added later
can only back-fill by re-decoding stored hex. ~440 MB/year, permanent, on a 5 GB volume. BF-55 said
this and it bears repeating next to a table that makes it look like the problem.

## Cost, so nobody panics

At Railway's $0.15/GB/month the whole database is about **three and a half cents a month**. The
reason to watch it is that an unexplained trend compounds — and this one is now explained.

## Not exercised, and the honest gaps

- **`rr_intervals`' span is RV sweep 50's figure (2026-09-18), not mine.** There is no
  `claude_ro.rr_intervals` view, so I could not re-measure it from the admin endpoint; its 0.38
  MB/day and its "67% filled" therefore carry two days of drift. Everything else in the table was
  read today.
- **Sizes are exact; the spans are the owner's rows only.** `pg_stat_user_tables` size columns come
  off the filesystem, but the spans come from `claude_ro` views, which are row-scoped. A second
  account's rows would widen a span and change nothing about the caps.
- **The prediction is untested by construction** — its first checkpoint is about five weeks away.
  That is what makes it worth writing down rather than concluding.
