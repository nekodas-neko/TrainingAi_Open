# 2026-09-23 — RV-135: the entry that parked itself waiting for data it already had (`fix/rv135-bf110-keep-reassign`)

Docs-only. Two lines of BF-110 changed; no code.

BF-110 opens with *"✅ THE READING IS IN, and it says NATIVE — measured 2026-09-18. This entry is no
longer waiting on data."* Its `Keep:` line, further down, still read *"the READING, and only that …
Still do not write a fix before that row exists."*

`next-item.js` reads the `Keep:`, not the body. So the entry sat in the **KEEP** bucket — whose
heading is *"shipped; only the stated residue is owed. **Not new work.**"* — and the `✅` was visible
only to someone who opened the entry and read past its status line. **The native fix was owned by
nobody for five days.**

Two changes, which is all RV-135 asked for:

- The `Keep:` is gone, replaced by a paragraph saying the reading arrived and why the entry is READY
  work rather than residue. The old text is quoted there rather than deleted, because *what it said*
  is the finding.
- `Lane: B` → `Lane: A`. The old lane line reasoned *"the DOM is alive, so the fix is a paint
  invalidation in the shell, not native. No APK needed"* — correct until the measurement landed, and
  now retracted in place rather than removed, since it is the reasoning a future reader would
  otherwise repeat.

Verified by running the tool rather than reading the file: BF-110 now prints at **#21 of Lane A's 37
READY** entries and does not appear in Lane B's list at all.

Nothing else about BF-110 changed — RV-135 is explicit that its analysis is right, which is exactly
what made the filing error expensive. The re-measured counts it carries (25 rechecks, 25 `stuck`,
0 `resized`, `dom-lost` never fired in 62 reported resumes) are folded into the replacement
paragraph so the entry states its own evidence.

## Why this shipped alone rather than in the next batch

`Batch:` aggregates on what has to be *verified*, and this needs no verification — so batching it
behind `tab-nav-shell` (a 37-site sweep) would only have delayed a native fix that currently has no
owner. Timeliness is the entire value of the change.

## Not exercised

Nothing to exercise — no code, no user-visible change, so no version bump. The claim that the entry
moved lanes was checked by running `next-item.js` for both lanes.
