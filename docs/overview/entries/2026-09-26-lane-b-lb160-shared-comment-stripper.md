# 2026-09-26 — `lane-b/lb160-shared-comment-stripper` (LB-160) — 88 source-scan tests, one stripper, and a ratchet to keep it that way

**Lane B · one entry shipped (LB-160) · one new Custom Rules step.**

A source-scanning test that strips comments with a regex pair is reading a file the regex has
already damaged. The pair has no idea what a string literal is, so the `/` and `*` inside
`accept="image/*"` open a comment for it and it deletes everything to the next closer.
`scripts/lib/strip-comments.js` walks string literals properly — LA-64 extracted it for exactly
this, for the CI checks. The tests never got it.

## The population was 88, not 37 — my own entry was wrong

LB-160 was filed yesterday claiming 37 files, and that number came from a grep for one of the five
comment regexes (`{/* … */}`). **Files using only the other four were invisible to it: 51 more.**
The check written for this entry found them, which is the argument for a check over a count.

The correction matters beyond the arithmetic: the measured harm — 11 source files carrying the
trigger, 4 test→file pairs reading one, losses of 25–56% — was computed against the 37, so it is a
floor rather than the total.

## What the conversion found, which was less than expected and worth saying

The honest result: **converting all 88 exposed no vacuous assertion.** 85 files, 710 tests, all
green on the correct stripper. The four `.not.toMatch` assertions that had been running over
mangled source (three converted in RV-203's PR, one here) were true anyway. What was missing was
never a wrong answer — it was any reason to believe the answer.

Five tests did fail during the conversion, and only one was substantive:

- **Four were self-inflicted.** Three files already declared their own `stripComments`, so the
  rewrite made it self-recursive and blew the stack; two more took the import inside a multi-line
  `import { … }` block. Both are converter bugs, fixed, not findings.
- **One was real, and it is the thing to remember.** `sleep-provisional-surfaces.test.ts` pins
  `href: "/health/sleep"` and `provisional: sleepProvisional` inside a **120-character window**, so
  a cell cannot read the flag and then not use it. The old stripper *deleted* comments; the shared
  one *blanks them to spaces*, deliberately, so line numbers survive — and the three-line comment
  already sitting between those two fields then spends the whole budget. The window was calibrated
  against a property of the broken stripper. It now collapses whitespace first, which measures what
  the guard actually means (how much **code** sits between them) rather than a byte offset.
  `oura-score-chip-row.tsx`'s own comment described the old mechanism and is corrected in place.

## The ratchet

`scripts/check-test-comment-strippers.js`, in the Custom Rules job — **`Ran 80 of 80`**. Its
baseline is **empty**, so a hand-rolled stripper in a test is a regression rather than a debt row.
It matches the five comment regexes rather than the surrounding helper, because the 88 files spelled
that helper a dozen different ways — one inlined it into a `describe` body, one named it `strip`,
one kept a function-valued replacement.

Control-run: reintroducing a stripper into `diary-groups.test.ts` **fails** it. (The first control
attempt passed, and that was my shell escaping rather than a weak check — worth recording, because
a control that silently tests nothing is the same failure class as the bug.)

The error message names the two traps the conversion hit, so the next person does not: `require` is
an eslint error under `components/**`, and a `@ts-expect-error` on the import is **unused** and
fails `check-test-typecheck`.

## Gate

Full suite **1,077 files / 10,073 tests passed**, 5 skipped · `check:rules` **Ran 80 of 80** · lint
**0 errors / 811 warnings (= main)** · tsc, test-typecheck, build, doc gates clean by exit code.

## Not exercised

No product code changed except one comment in `oura-score-chip-row.tsx`, so there is nothing to see
on the device and no version bump. Everything here is test infrastructure and a CI step.
