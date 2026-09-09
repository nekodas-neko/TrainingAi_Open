# Route tests: how they come out green while testing nothing

Every one of the 222 API routes now has a test that imports its handler
(`scripts/check-route-test-coverage.js`, baseline 0 — a new route arrives uncovered and fails CI).
This file is what the PS-39 sweep learned on the way there, kept because the checklist keeps
catching things and the queue entry it lived in is gone.

**Every batch in that sweep ran a mutation pass**, and in most of them at least one case passed while
testing nothing. None of those were found by reading. The mutation pass is the evidence; a batch that
goes green on its first run deserves *more* suspicion, not less.

---

## The one rule

> **A fixture in which the wrong rule and the right rule agree tests neither.**

Everything below is that sentence wearing different clothes. Before writing a case, ask: *if the
behaviour I am naming were deleted, would this fixture notice?* Afterwards, delete it and see.

## The variants that have actually shipped

Each of these passed review, and each was caught by mutation:

| Shape | Why it tests nothing |
|---|---|
| **A case meant to fail on guard X, rejected first by guard Y** | Delete X and it still fails, for the other reason. The most common variant by far. |
| Two equal values | Anything reading either one is untested — swap them and nothing moves. |
| A symmetric pair with equal totals | One male row and one female makes `generatedMale` and `generatedFemale` both 1; either predicate can be computed from the other's rows. Use two of one. |
| A list already in sorted order | Proves nothing about a sort. |
| A list whose newest element is last | "Reduce to max" and "take the last" agree. |
| A timezone that *is* `DEFAULT_TZ` | Proves nothing about which zone the route read. Give the fixture a different one. |
| A slash date that normalises to itself | The normaliser could be absent. |
| Timezones differing by a day but not a month | Half the arithmetic goes untested. |
| An empty collection | "Not yours" and "you own nothing" are the same answer. |
| One session per day | By-session and by-day aggregation agree. |
| A value normalised on **both** sides of a comparison | One side was already normalised; the normaliser is inert. |
| Two guards returning the same **status** | Assert the messages: "you sent no id" and "that is not an id" are different things to fix. |
| Setting only a JWT claim where the code reads the database | The fixture has to disagree with itself: claim `true`, row `false`. |
| A summary spread into a response where only sibling counters are asserted | The spread could be dropped. |
| Every fixture where a resolved ceiling equals the age estimate | Three derived values all readable from the wrong one. |

## Two that are not about fixtures

- **A hardcoded timestamp is only safe when BOTH sides of the comparison are fixed.** The moment one
  side is the real clock, an absolute date is a time bomb with a known detonation date — and
  deriving both sides from the clock is still not enough if they come from different timezones.
  Derive the fixture from the clock, or inject the clock. See the date-arithmetic rules in
  `CLAUDE.md`.
- **An anchor that does not apply is not a caught mutant.** A mutation run that reports `ANCHOR MISS`
  ran nothing; counting it as caught inflates the score by exactly the case that never executed.
  Re-plant it against the real text.

---

## What the ratchet does and does not measure

`check-route-test-coverage.js` asks whether **a test file imports the route's handler module**. It
deliberately refuses two weaker readings — a test that merely mentions the URL string (a
cache-invalidation test would then "cover" a route it never calls) and a type-only import that
borrows a `Response` shape and calls nothing. Both errors were live, in opposite directions, and
nearly cancelled: the honest count was 150 of 222, not the 93 first believed.

**It is a floor on attention, not a measure of it.** An import is not a test of behaviour: a file
importing a handler to assert one ownership guard is, to the counter, indistinguishable from one with
thirty cases across four verbs. `admin/exercises` already counted as covered on a single guard
assertion, and covering it properly moved no number.

**No check is proposed for that**, deliberately — a sufficiency metric would have to invent a
threshold nobody could defend. The number says which routes nobody has looked at; judging whether a
looked-at route is *tested* is a reading job, and the routes most worth re-reading are the ones
already below the line.

Since LA-81 the scan also compares against the merge base and fails on any route that was covered
there and is not covered here, whatever the total does — a count nets out covering five routes while
un-covering three, and that is not hypothetical: a new test file was once written to a path that
already held one, destroying three routes' tests while the number went *down*.
