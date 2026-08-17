## 2026-08-17 — the error dedupe was defeated by its own key (Q-539, v1.318.5)

`error_events` reached 49 MB / 13,196 rows. **5,771 of them were one fault** — the `oura_heartrate`
`cardinality_violation` that Q-214 fixed on 2026-08-13. A 60 s same-route-same-message window should
have capped that near 1,440 rows/day. It recorded ~2,600.

**The window was never broken; the key was.** Drizzle embeds the whole generated `VALUES` list in its
failure message, so a batch of 40 rows and a batch of 41 are different strings describing the same
broken query. Measured on those rows: **18 distinct messages, all sharing 1 distinct 60-character
prefix.** The dedupe was bypassed 18-fold.

### What changed

- **`normaliseErrorKey()`** collapses the parts that carry no information before the key is built —
  generated `(default, $1, $2), (default, $3, $4), …` runs, surviving `$N` placeholder lists, and
  long digit runs — then bounds the result to 500 chars. Two genuinely different faults still differ
  in the text *around* those, which is where a query's identity lives.
- **The stored message cap drops 2,000 → 1,000 chars.** Every one of those 5,771 rows was truncated
  at exactly 2,000 (`avg = max = 2000`) and was almost entirely `(default, $N, $N, $N),` repeated:
  2 kB of boilerplate for a message whose information ended at character 60. The cap worked as
  written and was simply far too generous for what these messages contain.

Either change alone would have made the incident cost single-digit MB.

### Tests

Seven, and the one that matters is the inverse: **the un-normalised key writes a row for all seven
batch sizes** in the same window, and the normalised one writes exactly one. Also asserted — two
different tables sharing a `VALUES` shape do **not** collapse, a timeout and an insert failure stay
distinct, and a 2 kB message cannot become a 2 kB map entry.

`npx tsc --noEmit` clean · `pnpm build` green · `pnpm check:rules` **Ran 38 of 38** · suite
**3,911 tests passed**, 54 skipped.

### Not exercised

- **No production verification, and none is possible yet.** This changes what gets *written* from
  here on; the 49 MB already stored is untouched and clears itself on the 30-day prune by
  ~2026-09-12. The next repeating fault is the first real test.
- **The normalisation is regex over driver text.** It is verified against the exact message shape
  that caused this incident and against a handful of neighbours, not against every message `pg` and
  Drizzle can produce. A shape it fails to collapse degrades to today's behaviour — more rows, not
  lost errors — which is the safe direction.
