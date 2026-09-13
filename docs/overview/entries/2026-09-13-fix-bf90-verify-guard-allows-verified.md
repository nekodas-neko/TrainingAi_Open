# 2026-09-13 — a sentence saying a gate was withheld was read as a gate, and it turned `main` red

**Branch:** `fix/bf90-verify-guard-allows-verified` · one guard amended, one backlog entry reworded,
one follow-up filed. No product code.

## The red

`scripts/__tests__/backlog-verify-field.test.ts` failed **11 of 34** on `main` and on every branch cut
from it, from #1136 onward. Nine failures were one assertion repeated; two were the end-to-end
classification.

**The cause is two things, and only their combination is visible.**

1. **The guard did not know about the third state.** It asserts that seventeen shipped entries carry
   `Verify: device` rather than `Gate: device` — BF-90's invariant, that finished work must never sit
   in PARKED beside work that genuinely cannot start. The owner's 2026-09-13 nutrition pass (#1136)
   verified nine of them on the S25, which correctly removes the `Verify:` bullet: there is nothing
   left to look at. So nine assertions went red **for device checks that had actually happened.**

2. **Underneath that, a real bug the guard was right to catch.** BF-46 came back as PARKED. Its
   `Keep:` block contains the sentence *"**The `Gate: device` above was deliberately withheld while
   they were unbuilt**"*, and `keep.js` reads a `Gate:` from anywhere in a Keep block — so a sentence
   **denying** a gate was parsed as asserting one. `next-item.js` had been cancelling it because the
   entry also carried `Verify: device` for the same value; removing the `Verify:` un-cancelled the
   phantom, and a verified entry went back to being parked.

The second is **the repo's own recurring class** — *"guards find their own documentation"*, in
CLAUDE.md and in Lane A's baton. Every previous instance was fixed by stripping comments before
scanning. A Keep block has no comment syntax to strip.

## What shipped

- **The guard now accepts the verified state, and accepts exactly one of the two.** An entry must
  carry `Verify: device` **or** record a device verification — not both, not neither — and in neither
  case may it carry a `Gate:`. `toBe(1)` on the count rather than an `||`, so a silently dropped
  `Verify:` and a verified entry that kept its bullet both still fail.
- **The end-to-end half reads which group an id is in off the FILE**, not off a second hardcoded list.
  The snapshot list drifted once already — that is this bug — and its job is now only to say which ids
  are in scope. "Not parked, never offered as startable" is asserted for all seventeen; the
  VERIFY-versus-KEEP split only for those that still owe a look.
- **BF-46's sentence no longer names the field**, which is what clears the red. The parser is
  untouched on purpose and is filed as **LA-103**, with the measurement and with the trap written
  down: anchoring the regex to a bullet start would lose the 7 legitimate inline mentions and silently
  un-park genuinely blocked work, which is worse than the bug.

## Verified

`node scripts/next-item.js --all` puts BF-46 in KEEP rather than PARKED, and the other sixteen are
unmoved. **Mutation pass: three mutants, all killed** — BF-46's prose gate restored (the exact
red-`main` cause), a real `Gate:` added to a verified entry, and a verified entry also claiming
`Verify:`. One deliberately equivalent control — rewording a verified marker's trailing note —
survived. All 26 script guard files pass, 251 tests.

**Not exercised:** nothing device or runtime; this is a backlog parser and its test.
