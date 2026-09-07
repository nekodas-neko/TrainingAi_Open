# The collection ladder, and a rest-day allowance the app already knew (BF-122a)

**Branch:** `feat/bf122a-collection-ladder` · **Lane:** A · **Domain:** app-shell / platform
**Version:** 1.436.25

The engine half of the cat collection: a pure fold over day series the app already stores, plus the
decay window the owner asked for. No migration, no table, no route.

## ⚠ This changes an existing streak

`computeStreak(dates, tz, maxRestGap)` had `1` hardcoded at two call sites — `lib/achievements.ts`
and `app/api/friends/leaderboard` — for exactly the question the new helper answers. Per **One
Formula, One Place** they now read it off the schedule.

**That moves the workout streak for anyone not on a rotation.** A user training Mon+Tue is two
sessions a week with a five-day hole in it, and was following their plan for every one of those days
while a literal `1` broke their streak weekly. The fallback is 1 when there is no schedule, so an
unscheduled user is unaffected. This is the only behaviour change in the PR and the entry asked for
it to be said out loud.

The leaderboard needed each user's schedule; it already batches every other query with
`inArray(userId, allIds)`, so this is **one more batched query**, not an N+1 over the friends list.

## Why the count helper next door is the wrong input

`getScheduledSessionsPerWeek` collapses both schedule shapes to a number for Home's "This Week X/Y"
chip. **A count cannot see where the hole is.** Mon+Tue and Mon+Thu are both two a week; the first
tolerates five rest days and the second three. `maxCompliantRestGap` sits beside it and the count is
left alone.

The wrap-around term is the part a pairwise scan of a sorted list misses: Sat+Sun's real hole is
Sun→Sat, which never appears as a difference between adjacent entries.

## The fold

`replayCollection` walks distinct days: each spawns a bottom-tier item, merges settle to a **fixed
point** (five slimes making a scout can complete a tank in the same step — one pass would leave the
collection a merge behind its own rule), and each gap beyond the allowance decays once per day.

Two owner rules, both in the code and both pinned:

- **Smallest first.** Loose stock is the buffer, so a missed day costs the thing you were about to
  merge.
- **A big item breaks into its components, never vanishes.** Losing a scout costs the merge, not the
  five workouts under it.

Days the app itself recommended as rest are excused, so a deload week decays nothing.

## The test that did not test what it claimed

"Takes the smallest item first" **passed with the rule reversed.** The gap in my fixture was followed
by a spawn, and the spawn re-merged what the decay had broken apart — so smallest-first and
largest-first both landed on `[1, 1, 0]`.

Rewritten with a **trailing** gap so nothing follows the decay: smallest-first leaves `[0, 1, 0]`,
largest-first leaves `[5, 0, 0]`. Same total, different truth about what was lost. It now fails by
name under the mutation.

That is the second time today the same lesson landed — mutate the line you changed, not the line you
understand.

## Two of my own expectations were wrong, not the code

`Mon+Thu` is 3 rest days, not 2 (Fri/Sat/Sun is wider than Tue/Wed). And a decay that cannot happen
is not counted, so a two-decay assertion on a collection holding one item reads 1. Both were my
arithmetic; both corrected in the test rather than the source.

## A rule matched my comment

`No UTC date slicing` flagged a comment explaining that the module deliberately does **not** use the
banned expression. Third instance of that shape today — filed as **LA-64**, with the note that the
costly direction is the false *negative* (a scan reporting clean over code it never read, which is
how PS-34's icon-button rule stayed green against a fully reverted fix), not this loud false
positive.

## Verification

- `tsc --noEmit` clean · **779 passed | 5 skipped (784 files), 6640 tests** · `pnpm check:rules`
  **68 of 68**
- 8 cases on the gap helper, 15 on the fold
- **Mutation-verified:** deleting a big item instead of breaking it down fails two by name;
  reversing smallest-first fails the rewritten one

**Not exercised:** nothing renders this yet — BF-122b is the widget, the models and the in-app
explanation. The streak change is server-side and reaches the device through a normal deploy; no APK.
No production data was read, and the 120-day calibration in the entry is the owner's measurement,
not re-run here.
