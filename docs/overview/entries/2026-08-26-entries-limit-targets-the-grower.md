# 2026-08-26 — The journal limit now fails whoever grew the directory (BF-36)

**PR:** `fix/entries-limit-targets-the-grower` · **Lane B** · CI tooling only, no user-visible change

## What was wrong

`check-doc-index-size.js` fails the Custom Rules job when `docs/overview/entries/` holds more than
60 **foldable** (uncited) entries. The threshold is right and the compaction chore is real. What was
wrong is **who paid**: the failure landed on whichever PR happened to be open when the count crossed,
which has nothing to do with whoever grew the directory. Every session writes a journal entry, so the
cost fell at random.

Measured on the day it was filed: it blocked **PR #527**, a docs-only intake whose diff the failure
named none of — and the resolution was not the sweep but **merging `main`**, because another session
had swept concurrently. That PR paid a CI cycle and a diagnosis for a condition it neither caused nor
fixed.

## The fix

The same attribution the line-count ratchet a few lines above already does. It asks whether *this
branch* grew the file, not whether the file is over its number — different questions the moment two
PRs are open at once, and only the first has an answer the author can act on.

- Over the limit **and this branch adds an entry** → fail. That PR is the growth and its author is
  already touching the directory.
- Over the limit **and it adds none** → a note saying so, which is the mechanism that already existed
  for "sweep it when convenient".
- **The base unreadable** (a shallow clone, an export) → still fail. Attribution is impossible there,
  and an unreadable base must not silence the limit.

`dirNamesAtBase(baseRef, dir)` is new in `scripts/lib/base-ref.js`. It returns `null` rather than an
empty list when the base has no such tree, because "the base had nothing" and "we cannot see the
base" lead to opposite conclusions about what this branch added.

## Why it is testable now

The decision moved to `scripts/lib/entries-verdict.js` as a pure function. The two cases are driven
against **fixture numbers, not the live directory** — a regression test for a counting rule that
reads the repo's real count changes verdict as the repo does, which is the one thing it must not do.
The live count was 20 foldable against a limit of 60 when this shipped; none of the seven cases would
exercise the limit at all if they read it.

Reverting the attribution fails two of them: the core BF-36 case, and the one asserting the total
ceiling is still reached when the limit has been excused for this branch.

## Deliberately not done

- **The 250-entry total ceiling keeps failing everyone**, unattributed. The same argument applies to
  it, but BF-36 scopes to the runaway limit and the ceiling is 89 files away (161 today). Widening
  the change to reach it would be my decision, not the entry's.
- **Not raising the limit**, which the entry rules out: it defers the same collision about a week and
  makes the eventual sweep bigger, and the README records sweeps already failing the link checker in
  five separate ways.
- **Not making it warn-only.** A warning nobody must act on is how the directory reached 198 files.
  The obligation stays; it just lands on someone already in the directory.

## Not exercised

- **The failing path has not run in CI**, only in unit tests — the live count is 20 against a limit of
  60, so nothing here can reach the limit until the directory grows again. The wiring that computes
  `addedHere` was checked against the real base (162 entries at `origin/main`), so the inputs are
  right even though the verdict is not yet reachable.
