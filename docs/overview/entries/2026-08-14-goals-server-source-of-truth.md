# 2026-08-14 — goals stop being two disagreeing copies (Q-240, Q-241)

**Branch:** `claude/trainingai-backlog-v0abea` · **Version:** v1.307.1

Two backlog entries with one root, which is why the entry for the first says to do them together.

## Q-240: one missing call, and its sibling in the same file already made it

`patchGoalsDebounced()` fired `PATCH /api/user/goals` and invalidated nothing. `patchProfile()`,
forty lines above it, had always called `invalidateGoalRecommendations()` — and that group already
contained `invalidateCache('user-goals')`. So the group was right and this call site was never
wired to it.

The consequence: change a steps, sleep, calorie, water or target-weight goal in More → Profile,
switch to Health, and its goal-driven cards render the **previous** goal for up to the `user-goals`
TTL — then repaint it stale on the next cold start, because the same key is seeded synchronously.

The invalidation went into `patchGoalsDebounced` rather than into each of the nine handlers, since
they all funnel through that one PATCH and a tenth handler added later would otherwise have to
remember.

**The sibling sweep the entry asked for found two more.** Coach's `change-preview` and `number-dial`
both apply goal changes through `/api/coach/apply` and invalidated only the Coach history, so a goal
Coach changed was stale on Health in exactly the same way. Both now invalidate when the patch domain
is `user_goals`.

## Q-241: the copy that never synced

Nine goal values were written to `localStorage` **and** the database by three surfaces, and the
Health tab read three of them — water goal, target weight, target body fat — from the device copy
only. `localStorage` does not sync. On a second device, after a re-install, or between the web
surface and the APK, the server held the real goals while the app rendered defaults, and the two
could disagree indefinitely with nothing to reconcile them.

The direction is one-way now: the server payload is the source of truth, and `hydrateGoalSeeds()`
writes the seed *from* it. The seed survives only so the first paint is synchronous.

Two details that are the whole point rather than polish:

- **A server null clears the seed.** Writing only non-null values would leave a goal cleared
  elsewhere rendering here forever from a value nothing can reach. There is a test that fails if the
  `removeItem` branch is dropped.
- **It converges through the sync-provider warm list, not on a tab.** Hooking it to Health's fetch
  would only correct a device whose owner opens Health — and a device that has never opened Health
  is precisely the one holding stale goals. `CacheTask` gained an `afterData` hook that runs whether
  the payload came from the network or was already fresh in cache.

The Profile editor now loads from the server too. Before, opening it on a second device offered to
edit blank goals while the server held the real ones, and saving from that state would have written
the blanks back.

## The bug this exposed, which is why it is in this PR

**Clearing a goal never worked, in two places at once**, and both were invisible while
`localStorage` was the read path.

The editor sent **no request at all** when a field was emptied (`if (!isNaN(n) && n > 0)` with no
else), and the route mapped every field through `?? undefined`, which collapses "clear this one" and
"leave this one alone" into the same instruction — so an explicit `null` returned 200 and changed
nothing. Measured on the dev server before the fix: `PATCH {targetWeightKg: null}` → 200, and the
value read back as `77.5`.

This had to ship here rather than as a follow-up. Making the server authoritative is exactly what
turns a latent bug into a visible one: a cleared field would have come straight back on the next
load. `updateUserGoals` had always drawn the distinction correctly (skip on `undefined`, write on
`null`), so only the mapping in front of it changed.

## Verified

Eleven new cases plus four route cases. **Mutation-verified, and two of the mutations changed the
work:**

- Making a null stop clearing the seed fails 2 cases; making the device value win over the server
  fails 4.
- The clear test **fails against the genuine pre-fix route** (2 of 4), which is the only reason to
  believe it. An earlier version of it called the repository directly and passed both before and
  after — the repository was never the bug.
- **The invalidation guard was circular on its first version and had to be rewritten.** It detected
  Coach writers by the string `user_goals`, which `number-dial.tsx` did not contain *until this fix
  added it* — so it recognised only writers already carrying the fix, and would have passed on the
  very code it exists to catch. It keys on `GOAL_LOCAL_STORAGE_KEYS` now, a marker that predates the
  change, and **fails against the real pre-fix Coach files**.
- That guard also produced a **false positive** worth recording: matching "file mentions
  `/api/user/goals`" and "file mentions `PATCH`" separately flagged `health-content.tsx`, which only
  *reads* that endpoint and PATCHes other things hundreds of lines away. The URL and the method must
  be in the same call.

**Observed on the dev server:** the goals route round-trips `waterGoalMl`, `targetWeightKg` and
`targetBfPct`; clearing one sets it to null and leaves its siblings untouched.

Full suite green — **469 files, 3,869 tests**. `tsc --noEmit` clean, lint 0 errors,
`pnpm check:rules` 33 of 33, `pnpm build` passes.

**Not exercised: the S25.** Everything here is JS and reaches the device through a Railway deploy
with no rebuild, but the behaviour that matters most — a second device seeing the goals the first
one set — is by definition a two-device check the sandbox cannot make. The first launch after this
ships is where the seed converges, and that is the thing to look at.
