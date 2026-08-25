# 2026-08-25 — I shipped BF-18's defect three hours after fixing it (TN-7 follow-up)

**Branch:** `fix/stress-report-test-order-independent` · **Lane A** · one test file. No product change.

TN-7's new test asserted `expect(rows).toHaveLength(1)` on `error_events`. It passed locally, passed
CI on its own PR (#477), and then failed on the next PR to run against it (#480):

```
AssertionError: expected [ { …(2) }, { …(2) } ] to have a length of 1 but got 2
```

**That is BF-18's defect, one file over, written by the same session that had just fixed it** — an
assertion whose truth depends on which of two async writes happens to have landed, which holds on an
idle machine and does not on a loaded runner.

## The mechanism

The file has two tests and **both call `GET()`**, so both take the stress catch and both call
`reportServerError`, which is fire-and-forget by design. The second test polls `error_events` and
the old poll exited on the first non-empty read.

- **Locally** test 1's row lands *after* that read, so the poll sees exactly one row — its own.
- **In CI** test 1's row lands first, so the poll sees two.

Measured rather than assumed: with the `afterAll` user-delete removed and two seconds allowed at the
end of test 1, the table holds **`/api/body-battery#stress` × 2**, one per test. Both rows were
always being written; only their timing differed.

**The obvious reproduction did not reproduce it.** Adding a 1500 ms wait to the end of test 1 —
letting its row land first — still passed, because the poll then exits on *that* row before test 2's
own arrives, and one row is one row. The failure needs **both** visible at the first read. Seeding a
matching row before the poll models that exactly: the old assertion fails, the fixed one passes
against the identical state.

## The fix

Assert the **content**, not the count:

```ts
if (rows.some(r => r.url === STRESS_URL)) break   // poll for the row that matters, not for any row
const stress = rows.filter(r => r.url === STRESS_URL)
expect(stress.length).toBeGreaterThan(0)
expect(stress[0].message).toContain('daytime-stress: constants not set')
expect(rows.filter(r => r.url === '/api/body-battery')).toEqual([])
```

The count was never the claim. What TN-7 needs to prove is that a trace exists and that it is
attributable to the stress strip rather than to the outer catch — and the last line is *stronger*
than what it replaced, because it now fails if anything reaches the outer catch, order-independently.

## Verified

- **The failure reproduced first, then the fix.** With two matching rows visible: old assertion
  fails (`to have a length of 1 but got 3` — three because the seed sits on top of the two real
  ones); fixed assertion passes.
- **Not weakened.** Deleting the `reportServerError` line from the route still fails the test — the
  poll times out with no `#stress` row, so `toBeGreaterThan(0)` fails.
- `app/api/body-battery/` — **19 passed** across 5 files. `pnpm check:rules` **Ran 56 of 56**.
  `tsc --noEmit` clean.

## The lesson, which is not the one I would have guessed

Knowing a bug class is not the same as recognising it. I fixed BF-18 — *an assertion that allows an
async write zero time* — and then wrote `toHaveLength(1)` against a fire-and-forget write in the same
session, because it did not look like the same shape: BF-18 was a missing *wait*, this was a present
wait with a count attached. The common element is narrower and more useful than "poll for async
work": **an assertion about how many times something happened is an assertion about scheduling
unless one write is the only possible writer.** Two tests in one file calling the same reporting
route are two writers.

## Not exercised

Nothing on the device, and no product code changed. The CI-side confirmation is the next few PRs
running clean against this file.
