# 2026-09-28 — LA-163: the full suite passes on Windows

The first local Lane A session measured nine tests in six files failing on the owner's Windows
machine and passing on Linux CI. A local red that is not the diff costs a debugging session each
time, and a lane is about to run here for good (OR-195).

**Result: 1,127 files, 10,618 tests, exit 0 on Windows**, the first clean local run.

## The three shapes

- **Paths compared against `/` literals (four files):** `personal-details-one-editor`,
  `rv208-one-duration-form`, `mutation-schema` and `constants-delivery` built relative paths with the
  OS separator and compared them to forward-slash strings, so an exemption list missed on Windows.
  Each normalises to `/` at the comparison; the expected values are unchanged.
- **A `DATE` read as an instant (one file):** `node-postgres` returns a `DATE` column as a JS `Date`
  at LOCAL midnight, which is 00:00Z on CI and 14:00Z the day before in Brisbane.
  `user-profile-partial-patch` now compares the calendar parts in that same zone, which is what the
  column means. It passes under the machine's zone and under `TZ=UTC`.
- **A timeout (one file):** `check-comment-blindness` runs `check-hex-literals` three times, and one
  run takes 15 s here against ~6 s on Linux. **Profiled: 98% of it is `spawnSync`.**
  `scripts/lib/base-ref.js` starts one `git show` per file for the base comparison, and a process
  spawn is expensive on Windows. The limit is 120 s with that reason written beside it, and the real
  fix, one batched git read, is filed as **LA-167** (Lane O).

## Found on the way

`storage-footprint-real-counts` raced its neighbours in its FIRST test too. #1817 fixed only the
second. `expected 350 to be 349` on a full suite; now a lower bound, and restoring the BF-54 estimate
still fails it.

## Verification

Each fixed test was run on Windows and passes. `user-profile-partial-patch` also passes under
`TZ=UTC`, and the footprint test still kills the BF-54 bug. Then two full suites: the first had the
one remaining footprint race, the second was clean.

## Not exercised

Linux, beyond CI running these same files. The changes normalise inputs and loosen nothing on Linux,
apart from the lower bound and the timeout, both covered above.
