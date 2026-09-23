# 2026-09-23 — OR-126: the raw-archive brief, and the premise it found had moved

**Branch:** `docs/or-126-raw-archive-brief` · **Lane:** O · docs only

Q-29 Task 5 proposes dropping the server-side Oura raw archive. It was put to the owner as a
yes-on-principle; he asked for the case first, which made the missing brief our debt rather than his
indecision. This is that brief —
[`docs/oura-raw-archive-retention-brief.md`](../../oura-raw-archive-retention-brief.md).

**It recommends keeping the archive**, and OR-126 explicitly allowed that outcome: the entry's own
instruction was *"do not write this as an argument for the drop"*.

## The brief answered a question that had changed underneath it

Q-29 Task 5 names `oura_raw_samples.body_hex` as *"the archival source of truth"*. That was true
when written and stopped being true when the packer shipped (Q-541 Task 4). Measured 2026-09-23:

| | rows | role | payload | span |
|---|---|---|---|---|
| `oura_raw_samples` | 189,263 | **7-day hot window** | 4.5 MB hex | 8 days |
| `oura_raw_packed` | 1,467 | **the archive** | 25 MB blob | 1,811,765 frames |

**So Task 5 as written would drop a week-long scratch buffer.** The packer moves each sealed bucket
into one compressed blob and proves it first — insert, read back out of the database, unpack, prove
the frames equal, and only then delete. Readers span both tiers, so nothing outside the packer knows
which side a frame is on.

## Two more load-bearing facts had moved

**The device's 14-day window has not shipped.** `pruneRaw` has no caller anywhere in the app, and
its predicate needs `rolled_up = 1`, which only D2 Task 5 sets. On-device 2026-08-18: **209,326
rows, 0 rolled up, 31.2 MB**, growing ~3.4 MB/day and past Android Auto Backup's 25 MB quota, so
none of it is backed up. The "what survives on the device" half of the trade does not presently
exist. This was already in `projectOverview.md`; nothing had connected it to Q-29.

**The 76 MB that makes `oura_raw_samples` look expensive is 45 MB of index plus bloat against 4.5 MB
of payload.** That is BF-106's `VACUUM FULL` — a *larger* lever than this one that loses nothing,
and one the owner has already deferred rather than declined.

## The cost, so nobody re-derives it

Railway bills on use at $0.15/GB/month. The archive is 25 MB = **$0.004/month**, growing 0.72
MB/day, so **$4.66 a year ten years out**. Reversal cost of dropping: none, ever — the ring's
cursor only moves forward and cannot be rewound. The brief says outright that this is not a cost
problem rather than implying a saving.

## What changed beyond the brief

- **`CLAUDE.md`'s raw-archive rule was wrong** and had been since the packer shipped. It named
  `body_hex` as the server's source of truth, which pointed every session at a 7-day scratch buffer.
  Corrected, with the device half beside it: do not cite the device as a surviving copy until the
  window lands.
- **Q-29 now carries a reconcile rather than a question.** Per the backlog protocol's re-verify
  rule, a task whose three load-bearing facts have all moved is reconciled before anyone builds from
  it. Asking against a stale premise is worse than not asking, because the answer would not mean
  what either side thought it meant.
- Linked from the devices domain index, positioned ahead of the older docs that still describe the
  single-tier model.

## Not done

- **Q-29 Task 5 is not rewritten or struck** — that is a decision about the task, and it belongs
  with whoever next touches the D-track, not to a docs PR that happened to notice.
- **The owner has not been re-asked**, deliberately. The brief exists so he can answer; the
  reconcile has to happen first or he would be answering about the wrong table.
- **No production write, no code change.** `BF-106`'s `VACUUM FULL` remains deferred and untouched.

## Gate

`pnpm ci:local` — exit 0, **Ran 75 of 75** Custom Rules steps, **8,063 tests passed**. Docs only.

**⚠ The first run of that gate exited 1 and its evidence was lost**, because the output was piped
to `tail -5` — five lines cannot show which file failed. Two subsequent runs of the identical tree
exited 0. Recorded as a **third occurrence on OR-121** rather than dropped, with the instruction
that a gate run is kept whole (`> /tmp/gate.log 2>&1; echo $?`) rather than tailed. Nothing is
diagnosed from it and it is not evidence for any cause — including OR-130's, which shipped earlier
the same day and whose own warning did not appear.
