# 2026-09-23 — TN-61 and the starved DV lane: one defect, two places

**Branch:** `fix/or-133-dv-lane-starved` · **Lane:** O · `scripts/next-item.js` + one test

Two findings that look unrelated and are the same thing: **the tool's output is correct and the
conclusion a reader draws from it is wrong, because what is missing is never accounted for.**

## TN-61 — the truncation line could not fire

READY caps at 10. There *was* a `… and N more (--all)` line, which is why this read as a missing
feature rather than a bug. It was computed from:

```js
const shown = ready.filter((e) => !e.batch || shownBatches.has(e.batch)).length
```

That counts every **unbatched** entry, whether or not the cap reached it. So the line fired only
when a *batch* collapsed rows, and **never when the cap hid them**. With Lane A's READY at 31 and
no batches involved, `shown` was 31, `ready.length` was 31, and ten rows printed in silence.

TN-61 found it the way you would: two entries it had just edited (`TN-55`, `LA-121`) appeared
nowhere in the output, which reads exactly like removed-from-the-queue — the failure the backlog's
own two-deletions rule exists to catch.

It now counts what was actually printed, and says so:

```
      … showing 10 of 16 — `--all` for the rest.
      An entry you cannot see here is BELOW THE CUT, not gone from the queue.
```

**The cap stays at 10**, per the entry's own warning. An implementer wants the next few items, not
thirty-one; what was wrong was that the truncation was invisible.

**One correction to TN-61:** it says *"READY and PARKED alike"*. Only READY truncates — KEEP,
VERIFY, REFERENCE, UNCLASSIFIED and PARKED all print in full. Nothing was changed there.

## The starved DV lane — found while reading, fixed in the same change

`node scripts/next-item.js --lane DV` printed **`nothing startable`** while **116 device checks were
owed**. The device agent's documented start ritual answered "there is nothing for you".

**The lane filter is not the bug, and it must not be "fixed".** `Lane:` says who *builds* a thing. A
check owed on the phone sits on the entry that built it — a Lane B screen fix with a device check
owed is still Lane B's entry, not DV's. `--lane DV` is *correctly* near-empty.

Correctly empty is indistinguishable from *there is nothing for me* unless the tool says otherwise.
So it does now, on both assigned-only lanes (`O` gets it too — Review and BugFix hand the
Orchestrator device work as well):

```
  116 device check(s) are owed across the whole queue and are NOT listed above —
  they sit on the entries that built them, whatever lane those are. `--sittings` groups them.
```

This is the same starvation Lane B hit in August for a completely different reason — 0 startable
against 48 parked. Worth naming as a pattern: **a lane reading zero is a claim about the whole
queue, and a queue tool should never make that claim without checking it.**

## The test, and that it was checked against the bug

`scripts/__tests__/next-item-visible-silence.test.ts` runs the real script against the real backlog
rather than a fixture — a fixture would have pinned the *formatting*, and what broke was the
**count being derived from the wrong set**.

Reverted the fix and re-ran: **4 of the 5 cases fail.** The fifth ("does not claim truncation when
everything fits") passes either way, correctly. A regression test that has not been run against the
bug is a guess.

## Not done

- **TN-59 is untouched** — an entry parked only by a prose marker. Different mechanism, still open.
- **No product code.** This is a queue tool; nothing reaches the device or the app.

## Gate

`pnpm ci:local` — exit 0, **Ran 75 of 75** Custom Rules steps, **8,075 tests passed**.

The first run exited 1, and because the log was kept whole rather than tailed it named its own cause
in the first line: the backlog had shrunk 23 lines under its baseline when TN-61 left the queue.
Fixed in one edit. Two earlier gate failures today were piped to `tail -5` and became OR-121 entries
instead of fixes — the difference is the redirect, not the diagnosis.
