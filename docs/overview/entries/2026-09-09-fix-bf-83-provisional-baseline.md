## 2026-09-09 — A night still filling is not part of its own baseline (BF-83)

**Branch:** `fix/bf-83-provisional-baseline` · **Lane B** · PR #1014

### What shipped

`health-metric-sheet.tsx` builds its "vs your recent nights" scales from `settledNights(allNights)`
rather than every night, so a night still filling is excluded from the distribution it is being
compared against.

That was the last of BF-83's three halves. The engine landed 2026-08-31 (`provisional: boolean` on
every `/api/sleep-sessions` row); the badge already renders on the sleep detail, the Body tab's sleep
card and Home's score chip row; this is the baseline.

### Why it is the half that was easy to miss

The owner's report came with two screenshots of the same night four minutes apart:

| Opened | Time asleep | Efficiency | HRV | 30-night avg |
|---|---|---|---|---|
| **6:44** | 6 h 15 m | 93 % | 61 ms | **7 h 46 m** |
| **6:48** | 7 h 40 m | 95 % | 65 ms | **7 h 49 m** |

The badge answers the first four columns. **The last column is why the badge alone is not enough**:
the average moved too, so the reading and the context judging it were drifting together. A
provisional night is both the newest in the window and the one night whose numbers are known to be
incomplete, which is the worst possible member of a comparison set.

### The two distinctions that make it correct rather than merely applied

**The night being viewed is never filtered.** It is the reading, not the baseline — a provisional
night still shows its own numbers, under its own badge, compared against settled ones. Filtering it
out of its own detail view would have been a different and worse bug.

**An absent flag counts as settled, not provisional.** Every night recorded before the flag existed
carries no value; reading those as provisional would empty the baseline rather than protect it. The
stricter-looking filter is the broken one, which is why it has its own test.

### Verification

4 unit tests on `settledNights`, covering the absent-flag case, order preservation, and the empty
result a fresh install produces — which the sheet's own `>= 3` gate is what handles.

`pnpm check:rules` — **Ran 70 of 70** · `tsc --noEmit` clean · lint 0 errors · full unit suite **845
files passed, 0 failed**.

No new e2e: the change is which rows feed a distribution, and the state that exercises it — a night
mid-drain — is not something the seeded database has or a browser can create. The unit tests are the
honest coverage here, and the real check is the device, next time a night is opened while it is still
filling.

**Not exercised:** the S25, Samsung WebView, and a genuinely provisional night.

Patch bump — a bug fix.
