# 2026-08-25 — the queue tool's Keep bucket could not see two of its own entries (LA-23)

**Branch:** `fix/next-item-keep-em-dash` · **Lane A** · `scripts/`. No product change.

`next-item.js` grew a KEEP bucket this morning
([LB-11](2026-08-25-next-item-keep-bucket.md)) so that shipped-but-owing entries stop occupying the
top of READY. That entry closes by recording *"Lane A is unaffected in shape and now leads with
`TN-3a`."* Lane A was affected. `TN-3a` is one of the entries the bucket was built to catch.

## What was wrong

`keepFromLines` required a literal `Keep:`. The colon was made mandatory deliberately, and for a good
reason — without it the regex matched prose that merely begins with the word, and Q-420's
`**Keep the stored field on 1–10**` was reported as that entry's residue. But two entries write the
residue with a dash instead:

```
- **Keep — three things are NOT done, and none of them is verifiable from a sandbox:**   (TN-3a)
- **Keep — what is NOT done:** why the constants were unset for those ten hours.          (TN-4)
```

Both read as unstarted work, and both sat above every genuinely startable Lane A item — **#1 and #2
of READY**. The residue each states is production-gated: TN-3a needs a rollup back-fill pass on
Railway, which cannot run in a sandbox at all, and TN-4 needs a root cause for a fault that stopped
on its own. A session following CLAUDE.md's instruction to take the top READY entry would have
started with the one item it had no way to finish.

## What changed

`Keep` must now be followed by a colon **or** a dash (`—`, `–`, `-`). That is punctuation, not a word
list, and it holds the false-positive line the colon was drawn for.

Measured over all 196 entries before choosing the rule: ten lines in the backlog begin with the word
and are not parsed as a residue. **Two are the genuine dash-form Keeps above; the other eight are
prose** — *"keep what the owner saw"*, ``- Keep `classifyZone`'s three-state shape``,
``**Keep `keepSavedMealIds.max(6)`**``, *"keep only the prose cached"*, and four more. The dash rule
takes the two and leaves all eight, which is the whole population, so nothing here is a guess about
shapes that might appear later.

Lane A's READY goes **90 → 88**, KEEP **9 → 11**, and its top row goes from `TN-3a` — shipped,
awaiting an owner-run back-fill — to `BF-16a`, which is startable.

## Verified

- `scripts/__tests__/backlog-keep-residue.test.ts` — 10 cases, **10 passed**. Three are new: the
  em-dash form, the en-dash and hyphen forms, and the four real prose lines asserted to stay null.
- **Mutation-proven.** Restoring the colon-only regex fails exactly the two new dash cases and leaves
  the false-positive case passing, so the widening is what the tests measure and the guard against
  re-opening the old defect is still doing its job.
- `pnpm check:rules` — **Ran 56 of 56**, all passed. `pnpm lint` — 0 errors.

## Not exercised

A developer tool; nothing to run on the S25. The eleven entries now in Lane A's KEEP bucket were not
individually re-read to confirm each stated residue is accurate — the tool reports what the entry
claims about itself, and this change only widens which claims it can hear.

## A note for whoever writes the next parser like this

The rule that broke here was correct when it was written and stayed correct; what it lacked was a
measurement of the shapes it would meet. Both defects in this parser — the missing colon and the
missing dash — were found by running it against the real file and reading the output, not by the
tests, which passed throughout. When a parser's input is a document people write by hand, the
population is small enough to enumerate: enumerate it.
