# 2026-09-18 — LA-110: the missing-prescription window is five sessions, and the set count is the tell

**Branch:** `lane-a/la110-window-remeasure` · **Lane A** · docs-only · no code, no migration ·
unversioned

Lane A reached LA-110 as the first genuinely startable item after LA-76, Q-220 and Q-1a were gated.
Its own ⚠ from 2026-09-16 already says the entry's diagnosis is wrong and that what is owed is *"find
why seven sessions were written with no prescription"*. This is that measurement, taken fresh — and
it stops there, deliberately.

## What the fresh read says

Per user-local day over 30 days, live logs and live sets only:

| day | logs | no `style_name` | sets | no `planned_pct` |
|---|---:|---:|---:|---:|
| 09-04 · 09-05 · 09-06 | 5 each | 0 | **10** each | 0–2 |
| **09-07** | 4 | **4** | **4** | **4** |
| **09-08 · 09-10 · 09-11 · 09-12** | 5 each | **5** | **5** each | **5** |
| 09-14 → 09-17 | 5 each | 0 | **10** each | 0–2 |

**Five consecutive sessions, totally affected, clean on both sides.** 09-06 clean, 09-14 clean. Not a
drift, not a formula property — a state that began and ended.

## The part that is new, and it changes where to look

**The set count is the discriminator, not the nulls.** Every affected day logged **one set per
exercise**; every clean day logs **two**. A prescription that merely failed to persist would leave
two sets with null columns. Half the sets missing too means the exercises were presented with no
resolved style at all — `plannedPct`, `plannedReps` and the set count all descend from the same
`ex.progressionStyle` (`components/workout-screen.tsx:1270` →
`packages/shared/src/workout/log-exercise.ts:263`).

**And "no style id" is a red herring.** On **09-17**, a clean day, all five logs carry `style_id`
NULL while `style_name` is present and 8 of 10 sets have a pct. A null style id is ordinary here —
RV-32 drops an unowned one rather than refusing the whole log — so it cannot be the signature, and an
investigation keyed on it would chase a normal state.

## What I deliberately did not conclude

Three hypotheses fit the data and **none was tested**: that the program's session exercises lost
their styles for that week; that those five sessions came through the outbox replay path
(`sync-helpers.ts:113` omits `progressionStyle` unless *every* set has planned fields, which is
self-consistent with the observation and says nothing about cause); or that something else presented
the workout unprescribed.

Writing one of them into the entry as a cause is exactly the mistake LA-110 already documents twice —
it was filed with a rep-band diagnosis that a later measurement refuted, and its first proposed fix
turned out not to be implementable because `workout_sessions.phase_type` is NULL on every production
row. A third wrong cause is worse than none.

## Why the rest of LA-110 was not attempted

The entry's remaining work splits in two and **the second half is explicitly the owner's**: whether
those stored `estimated_1rm` values get recomputed. That rewrites history the app's PRs and
`target_80` read from the same column, so it is not confined to a trend line. The first half — the
cause — is what this narrows, and the fix shape is still undecided by the entry's own account
(*"a genuinely new like-for-like rule … a design decision rather than a wiring change"*).

## Not exercised

- **The S25 device.** Docs only.
- **Any of the three hypotheses.** That is the point of the section above, not an omission.
- **Whether the window recurred before 08-19.** The read is 30 days; the entry's own 60-day count is
  not re-derived here.
