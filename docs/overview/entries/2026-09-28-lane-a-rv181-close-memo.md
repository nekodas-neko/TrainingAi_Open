# 2026-09-28 — RV-181 closed: the HR-profile memo is not worth a freshness trade

RV-181's aggregate shipped on 2026-09-25. It left one item open: a memo for the 90-day profile,
which was said to hold "the other two thirds" of the saving, and which the entry said to
re-measure first. Measured from production `pg_stat_statements`:

- The merged aggregate has run **294 times** since its deploy, about 3 days, at **232 ms** mean.
  That is roughly 100 calls and **23 s of database time a day**.
- A 16.8-minute window with no workout in it had **zero** calls. The cost exists only around
  workouts, where ring drains invalidate the key.

`use-hr-profile.ts` documents a real reason not to pin the key: live samples land in the window
during a workout. Trading that away for about 23 seconds a day is the wrong way round, so nothing
was built. The entry's other open item was refuted earlier the same day and is recorded in the
entry's own text, now folded here. HRR1 median vs best: 32 of 32 days differ, so reading the
stored column would redraw the chart as a different metric.

**Seen in passing, not filed yet:** in that same window a raw-sample read (`oura_raw_samples`
selecting `body_hex`/`decoded` since a cursor) took **2.1 s per call over 27 calls**, against a
93 ms cumulative mean. The hot window is steady at ~180k rows and the packer ran that morning, so
this is more likely one heavy reader in the window than growth. It needs a second sample before it
is a finding.
