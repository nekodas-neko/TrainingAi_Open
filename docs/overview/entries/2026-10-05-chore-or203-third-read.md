# 2026-10-05 — OR-203: the third size read. Growth stopped; the index lead is refuted

**Branch:** `chore/or203-third-read` · **Lane A** · docs only; one read-only production query set.

**263.1 MB on 2026-10-05**, against 261.5 MB on 09-29: +1.6 MB in six days, about 0.27 MB/day, well under
the ~1.7 MB/day expectation. The three `oura_raw_samples` indexes are identical to the byte, which
refutes the "index bloat from the packer's deletes" lead from the second read. Per-table figures and
the table that is now the baseline are on the entry.

**Still unexplained:** the +29 MB between 09-23 and 09-29. It has not recurred and nothing was changed
that would stop it, so the entry stays, as a Keep for the `rr_intervals` cap step after 2026-10-15,
rather than being closed.

Reads are owner-scoped through `claude_ro` (a zero means none of the owner's); the sizes come from
`pg_catalog`, which is not row-scoped and whose size columns are exact.
