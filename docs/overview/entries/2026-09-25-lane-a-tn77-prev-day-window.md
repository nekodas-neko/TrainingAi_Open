# TN-77(a) — "yesterday's activity" was reading today's training window

**Branch:** `lane-a/tn77-prev-day-window` · Lane A · v1.465.46. **Part (a) only** — (b) stays open
on the entry, deliberately.

## The defect

Readiness's `prevDayActivity` contributor scores *yesterday* by calling `computeActivityScore` a
second time. Both call sites — `readiness-payload.ts:471` and `build-day-audit.ts:182` — passed it
**today's** rolling 7-day `sessions7d` and `volume7dKg`.

The material case is a training day: today's window contains this morning's session and yesterday's
cannot, so the number describing *yesterday* reacted to a workout that had not happened when
yesterday ended. Over 115 days it differs from yesterday's own window on **83 (72%)**, mean
|difference| **4.45 points**, worst −15/+10. At the contributor's **0.09** weight that is ~1.4
readiness points at worst, and the mean signed difference is **−0.15** — noise, not bias.

## What shipped

One shared helper, `strengthWindowEndingAt(sessions, dayMidMs)`, used by both prev-day call sites.
The entry notes both sites agree, which is why this is the model rather than a divergence — and why
the fix is one function rather than two parallel edits.

Verified against `main` before writing anything: both call sites are as described, and
`recentSessions` already fetches 28 days, so the corrected window is an in-memory filter and costs
no extra query.

## Two things deliberately not done

**The same-day window is untouched.** The tidy move was one helper for both days, but today's window
currently has no upper bound; giving it one would shift the same-day activity score. That is a
change nobody asked for, on a number the owner reads daily, smuggled inside an off-by-one fix. The
helper is shared where the duplication actually lives — the two prev-day sites.

**Part (b) is left open.** The prev-day call still passes no `zoneMinutes`, `moveHours`,
`strengthSessionToday` or `acwr`, so it sits on a 63-point weight base and is ~71% strength-weighted
against the same-day score's 60%/53%. The entry says this "may be deliberate". Deciding what the
contributor is *meant* to measure is a different question from fixing which day it reads, and
resolving it while here would be answering it by accident.

## Verification

`tsc` clean · `typecheck:tests` clean (318 / 89, none above baseline) · lint clean · Custom Rules
**78 of 78**.

Mutation pass — **4 mutants, 4 killed**, 1 equivalent control survived:

| mutant | outcome |
|---|---|
| drop the upper bound (the original defect) | killed |
| window reaches 8 days instead of 7 | killed |
| upper bound excludes the day's own sessions | killed, 2 tests |
| volume sum zeroed | killed, 3 tests |
| *control:* `t >= from` → `!(t < from)` | survived, correctly |

The second test is the one that earns its place: it asserts this morning's session **does** count
toward *today's* window. Without it the helper could pass by excluding real work rather than by
fixing an off-by-one.

## Not verified

**No device check, and none is owed** — server-side scoring on a read path.

**The 115-day reconstruction is the entry's, not re-derived here.** It carries the sd-8.8 per-day
error TN-76 describes, so the distribution is the claim and the per-day figures are indicative.
Nothing here measures the corrected score against the old one on real days; what is pinned is that
the window now ends where its name says.
