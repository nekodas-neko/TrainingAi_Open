# 2026-09-15 — the 8 RM that was an 11, on every surface but the one that was fixed (BF-164)

**Branch:** `lane-a/bf164-bodyweight-rep-max-inverse` · **Lane A** · v1.456.13

## What was wrong

The owner, on the Hanging Leg Raise ready screen showing **"Last: 11 reps · 12 Sept"** directly above
**"REP MAX 8 RM"**: *"How is this right?"*

It wasn't. `estimateOneRm` routes every bodyweight set through `calcAmrap1RM`, which applies an
all-out-set discount on top of `calc1RM`. Four helpers in `packages/shared/src/1rm.ts` inverted the
**unscaled** `calc1RM` instead, so a stored estimate read back short by exactly that discount.
Verified against the owner's real number before changing anything:

- `calcAmrap1RM(BW_REF, 11)` = **128** — so his stored 128 did come from an 11-rep set
- `repMaxFromOneRm(128)` = **8** · `repMaxFromAmrapOneRm(128)` = **11**

BF-149 found this and fixed `exercise-summary-screen.tsx`; BF-151 then replaced that fix with
`bodyweightRepMax`. Both changed **that one file**. The four helpers are what the other seven
surfaces import, so the defect stayed on all of them.

**One of the four is not cosmetic.** `rescaleBodyweightReps` sets `reps = floor(pct/100 × repMax)`
for the static progression style, so an understated rep max understates every prescribed rep by the
same proportion — about 8/11 at his numbers, a **27% shortfall in training volume**.

## Two call sites the entry did not know about, and one of them was worse

The entry said *"four call sites inside that one file feed all eight surfaces."* Grepping rather than
trusting it found **two more**, both Lane A, both handing a rep max to the **model** — which the
system prompt tells it to quote verbatim, so a wrong number there is reasoned from and repeated as
fact rather than merely rendered.

`lib/ai-chat/tools.ts:36` was the same defect and took the same fix.

**`lib/ai-chat/context.ts:70` was a different and larger one, and swapping the inverse does not fix
it.** It read `repMaxFromOneRm(orm * 0.8)` — take 80% of the estimate, ask what rep count that is.
That is a weighted-lift idea: 80% of a 1RM is a real working weight. A bodyweight `estimated1rm` is
not a weight at all; it is a `BW_REF`-relative index that starts at **101.75 for a single rep**. So
scaling it by 0.8 lands below the bottom of the scale, and the inverse returns **1**. Measured:

```
orm = 128 (eleven reps) → orm * 0.8 = 102.4
repMaxFromOneRm(102.4)      = 1
repMaxFromAmrapOneRm(102.4) = 1      ← both. swapping the helper changes nothing
```

The coach was being told **"target working set 1 reps"**, and would have been for any bodyweight
exercise at any strength level. The percentage belongs on the **reps**, which is how the app already
answers this question everywhere else — `rescaleBodyweightReps` is `floor(pct/100 × repMax)`. Same
convention, one place: 80% of an 11 RM is 8 reps.

## `repMaxFromOneRm` stays, and must

`exercise-stats-sheet.tsx:113` builds its comparison table with `calc1RM`, so inverting `calc1RM` is
the self-consistent choice **there** and only there. The two functions answer different questions and
a future "unify these" would reintroduce this bug from the other side. Both now carry a comment
saying so.

## Three tests were pinning the defect, and the fixtures are why

`displayOneRmDelta`, `displayOneRmSeries` and `describePersonalRecord` failed on the fix. They were
not protecting anything: their bodyweight fixtures were hand-written `calc1RM` values, a forward map
the bodyweight storage path never uses.

`118` is `calc1RM(BW_REF, 6)`. What `estimateOneRm` stores for six reps is `calcAmrap1RM(BW_REF, 6)`
= **114.50** — the documented 5/6 collision. A stored 118 is **7 reps**, not 6. So the fixture and
the assertion agreed with the inverse under test and with nothing else in the system.

They now **derive** from `calcAmrap1RM`, which states the intent and cannot drift — the same lesson
as the date-fixture rule: derive the fixture from the real forward function rather than hardcoding a
number from the wrong one. Two cases were added for the owner's live report (128 → 11 RM) and for the
prescribed-reps half (100% of 128 → 11 reps, 80% → 8).

## Verification

90 tests in `packages/shared/src/__tests__/1rm.test.ts` and 5 in
`lib/ai-chat/__tests__/bodyweight-rep-max-context.test.ts`, including a sweep asserting the coach's
target never lands on 1 rep across estimates from 3 to 25 reps — the old arithmetic returned 1 at
every one of them.

Mutation pass, exit codes captured directly:

| Mutation | Caught |
|---|---|
| `displayOneRm` back to the unscaled inverse | ✅ |
| `displayOneRmSeries` back to the unscaled inverse | ✅ |
| `rescaleBodyweightReps` back to the unscaled inverse | ✅ |
| the 80% target back to scaling the index | ✅ |
| `tools.ts` back to the unscaled inverse | ✅ |
| **control** — `displayOneRm` via `repMaxFromAmrapOneRm` directly (equivalent) | correctly passed |

The `tools.ts` guard reads the source, because `oneRmFields` is a closure inside `chatTools` and is
not reachable without standing up a repository. It strips comments first: the fix's own note names
the helper it replaced, and the first version of the check failed on its own explanation — the same
shape that made `check-e2e-stub-dates.js` flag a date inside its own header prose.

Full gate green: `Ran 75 of 75 Custom Rules steps`, lint, both typechecks, `8680 passed | 87 skipped`.
One run hit the LA-101 vitest teardown race; see below.

**Not exercised: the S25, and the AI chat end to end.** No route handler changed, and driving the
coach needs a real model call, so the two AI sites are covered by unit tests and the source guard
rather than by a live conversation. **Check on device:** one bodyweight exercise's ready screen,
pre-workout row, trend chart, stats sheet and strength card all printing the same rep max as the reps
last logged — 11 for the Hanging Leg Raise, not 8 — and its prescribed reps going **up**.

## A correction to something recorded a few hours ago

The LA-101 teardown race fired a **fifth** time during this work and named
`lib/__tests__/exercise-catalogue-routes.test.ts` — a different file from the four before it. The
2026-09-11 amendment in `docs/local-dev-database.md` argued that *"a file that is merely whichever
one happened to be running would vary"*, and concluded the repeatedly-named `hr-read-routes.test.ts`
was the lead. It has now varied. I endorsed that amendment this morning when recording the fourth
sighting; it is weakened and the doc now says so. What survives: zero failing tests, and a re-run on
identical code is clean — five for five.
