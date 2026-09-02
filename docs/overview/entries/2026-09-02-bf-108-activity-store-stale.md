# 2026-09-02 — a finished walk no longer arms the Start screen (BF-108)

**Lane B · branch `fix/bf-108-activity-store-stale` · v1.435.0**

The owner, after a guided walk: *"after closing it - it still opens with the activity naming screen"* —
with a screenshot of Walk / *"Walk Home From Train"* / **Start**. The app's answer to "you finished a
30-minute walk" was a screen offering to start one, pre-titled with the walk they had just done.

## The entry blamed the wrong path

It says *"`startActivity` already resets from `INITIAL_STATE`, so the gap is only on the completion
side"*. **The completion side already resets.** `done-activity-screen.tsx` calls `resetSession()` on
both save paths (lines 263 and 309), and `pre-activity-screen.tsx` calls it on Back. A saved or
cancelled activity has always left clean state.

**What survives is a session abandoned before saving.** `onRehydrateStorage` demotes two shapes to
`pre` — a `done` session, and an `active` one past the 12-hour recovery bound — and **neither cleared
`activityType` or `title`**. So `activity-screen.tsx` rendered `PreActivityScreen`, pre-armed, instead
of falling through to `SelectActivityTypeScreen`. Reached by killing the app at the summary, or by
leaving a recording running for half a day.

That is the persisted-store class CLAUDE.md already names — *screen modes, in-flight flags, and
per-screen payloads never survive a reload* — and a `title` typed for a finished activity is a
per-screen payload. The rule listed four incidents; this is the fifth shape.

## What shipped

`clearActivitySetup` runs on both demotion branches, clearing type, label, icon, distance flag, title
and prescribed run. With the type null, the screen falls to the picker.

**The reconciler was lifted out of `onRehydrateStorage` so it can be driven directly.** `persist` does
not expose the hook, so the first version of these tests mirrored it — and a mirror that drifts is a
test of itself. `reconcileRehydratedActivity` and `clearActivitySetup` are exported now and the tests
call the real functions.

**Q-450 is intact and pinned.** A live `active` session inside the bound keeps its type and its
points, so it still returns to its own screen rather than a picker that would drop the recording. The
boundary is asserted as `>` rather than `>=`, because an off-by-one there silently discards a
recording.

## Where Done goes

`/health`, not `/activity`. The walk was just saved, and the activity tab is a screen for *starting*
one; Health carries the activity-history card, so the walk that just ended is on the screen it lands
on.

`/cardio` was the other candidate — it is where the walk was launched from — and loses for the same
reason as `/activity`: it is where you go to begin one, not where you see the one you did.

## Verification

8 tests against the real exported functions, **six mutations kill them**: either demotion branch
dropping the clear, `clearActivitySetup` also wiping the recording, the bound flipping to `>=` so a
live session at the boundary is discarded, the reconciler clearing a live `active` session, and `Done`
going back to `/activity`. Full unit suite **6,359 tests**; `pnpm check:rules` **Ran 67 of 67**; `tsc`
and lint clean.

**Not exercised:** the device, and it owns the case that matters most. The Q-450 path — an activity
interrupted mid-record still returning to its own screen — needs a real kill and relaunch, which the
sandbox cannot do. The reported symptom is reachable there too: kill the app at a walk summary, then
open the activity tab.
