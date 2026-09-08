# 2026-09-08 — the swap sheet's own copy of the equipment rule, deleted (LA-66)

**Branch:** `fix/la-66-equipment-single-source` · **Lane B** · no user-visible change.

## What it was

`buildEquipmentSet` existed as three byte-identical copies. BF-129 moved two of them
(`generate-program`, `builder-chat`) onto `packages/shared/src/workout/equipment.ts`, where an
exercise declaring **no** equipment is excluded rather than passed. `builder-review.tsx` kept the
third, still on the permissive `ex.equipment.length === 0 || …` branch, deciding which alternatives
the swap sheet offers.

Hardening rather than a live defect, and the distinction matters: migration 269 labelled the 22 rows
that had drifted and `POST /api/exercises` refuses to create another, so there should be no
unlabelled row for the permissive branch to admit. What is fixed is the third divergent home of a
rule that decides whether a lifter is offered an exercise they cannot perform — which is why BF-129
existed at all.

## What shipped

The local function is gone; the component imports `buildEquipmentSet` and `equipmentEligible`. Two
lines, as the entry said.

The part the entry did not ask for and which is the durable half: **a guard that no call site
re-declares the rule**. BF-129's tests exercise the shared predicate, so they keep passing when a
call site quietly stops calling it — which is exactly what `builder-review.tsx` had been doing for
however long. The guard greps rather than listing files, because the next copy will be in a file no
list written today contains. Verified by putting the permissive branch back: it goes red.

## A false positive worth recording, because it is the third this session

The guard's first version failed on **its own doc comment** and on the one in
`app/api/exercises/route.ts` that quotes the removed branch in order to explain it. That is the class
LA-72 measured and converted eleven checks for, landed on `main` hours earlier. Comment lines are
stripped before matching now, and this file excludes itself.

Three source-grep guards written today, three that matched prose on the first attempt
(`tap-dense`, `exercise-role-labels`, this one). The lesson is not "remember to strip comments" — it
is that a grep guard is not finished until it has been run against a tree that mentions the thing it
forbids, which every well-commented codebase is.

## Verified

- `pnpm test` — **798 files, 6,866 passed** · `pnpm build` clean · `pnpm lint` 0 errors ·
  `check-test-typecheck` at baseline · `pnpm check:rules` **Ran 69 of 69**.
- The guard checked in both directions: green as shipped, red with the permissive branch restored.

**One unexplained test result.** The first full run failed and I did not capture which file — the
output was piped through `tail`. Two subsequent full runs passed identically (798/6,866). I am not
calling it a flake, because I have no evidence of what it was; recording it so that if CI shows the
same thing there is a prior sighting rather than a first one.

## Not verified

The entry says to verify by reading rather than by generating, and that is what happened: the swap
sheet's alternatives already exclude machines from a home gym because of the **data** fix, so a
screenshot would prove nothing about this change. Not run on device; no APK needed.
