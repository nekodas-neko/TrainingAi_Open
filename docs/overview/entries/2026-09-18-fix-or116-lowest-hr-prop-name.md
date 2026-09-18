# 2026-09-18 — OR-116 ②: the heart card's prop was misnamed, not miswired

**Lane B.** Branch `fix/or116-lowest-hr-prop-name`. No behaviour change.

## The suspicion, and why it inverts

OR-116 ② had stood open as a possible data bug, and the entry said so in the strongest terms:
*"Someone should establish whether `hrMin` is a deliberate proxy or an oversight before it is
'fixed'."* `/health/heart-rate` passes `data.hrMin` into `HrFactorsCard`'s `restingHr` prop, and
`hrMin` reads 50 where resting HR is 60.

It is neither a proxy nor an oversight. The card prints:

```
Lowest recorded today: {restingHr} bpm
```

`hrMin` **is** today's lowest recorded heart rate. The value, the sentence and the data always
agreed. Only the prop name lied.

**So the obvious fix was the dangerous one.** Passing a real resting HR would have left the card
printing a true number under a false sentence — a worse bug than the one being chased, and a less
visible one, because afterwards the name would finally match while the output quietly stopped being
true. The entry's instruction to establish the facts first is what stopped that.

## What changed

`restingHr` → `lowestHrToday`, in the component and its single caller, with the finding written into
the prop's own doc comment so the trap cannot be re-entered from the name alone.

## Checked, not assumed

- Exactly **two files** reference `HrFactorsCard` — the component and `app/health/heart-rate/page.tsx`.
  No other caller and no test pinning the old name (grepped across the repo).
- The nearby comment in `page.tsx` that mentions `data.hrMin` describes a different gate; left alone.
- `Ran 75 of 75` Custom Rules · tsc clean · lint 0 · component-size OK.

## Also filed here: LB-120

Five rebases of one PR in one afternoon, all conflicting on a single stored number, made the cause
worth writing down rather than absorbing: **the backlog's doc-size baseline collides on every pair of
concurrent implementer PRs**, because the protocol has each of them delete its own entry and so
change the file's line count. LA-33 already removed this class for documents in general; the backlog
is the one file where "two PRs touching the same document" means *every* implementer PR. Filed for
the Orchestrator with two options and the argument against the tempting non-fix (telling implementers
to skip the recompute — the check fails on slack, so that is just a red CI).

## Not exercised

The screen on the S25. OR-116 ③ is a device check and stays owed; nothing rendered changed here, so
there is nothing new for the device to show. OR-116 ① — what each of the three surfaces showing
resting HR is *for* — remains an owner decision and is untouched.
