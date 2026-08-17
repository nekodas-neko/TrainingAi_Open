## 2026-08-17 — a sub-3-second activity was rejected and lost, behind "Failed to save" (Q-351, v1.318.6)

`activity-store.ts` rounds `durationMin` to one decimal, so an activity under **3 real seconds**
becomes exactly `0`. `ActivityLogBody.durationMin` was `z.number().positive()`, so the route answered
a bare `400 {"error":"Invalid body"}` and the UI showed `Failed to save activity`. The recording was
discarded, and the user was told the save had failed rather than that the activity was too short to
measure — the same "your activity is gone" outcome as Q-450, one layer down and behind a generic
message.

### The fix, and why this one rather than the other two

The entry offered three shapes and left the choice to Lane A. Two of them — clamping in
`activity-store.ts`, or refusing the save in the UI with a better message — are Lane B's files.
The third is here and is also the better answer: **`.positive()` → `.nonnegative()`** on a field that
is already `.optional()`.

Accepting the zero is the honest outcome. The user pressed Start and then Finish, so the activity
happened; a row saying it lasted ~0 minutes is worth more than silence plus a wrong error, and it is
deletable. Inventing a duration server-side to satisfy the old bound would have been worse.

**Safe by construction, not by luck.** The cross-field rate checks divide by duration, and they
already skip zero: `plausibility.ts:115` sets `mins = null` when `durationMin <= 0` and returns
before any division. The `.superRefine` comment has said so all along — *"the rate checks below are
all skipped when `durationMin` is absent or zero"*. Every other field stays bounded on its own.

### It also closes the offline path

`pushMutations` parses with this same schema, so a sub-3-second activity queued offline was landing
in `errors[]` and being dropped. Checked against the "one bad mutation must never wedge the queue"
rule while I was there: the branch does `continue`, not `break`, so it **quarantined rather than
wedged** — the entry's "poison-pill candidate" was a real data loss but not a queue stall. Worth
recording, because the two failure modes want different responses.

### Verification

Measured on the running dev server, both directions:

| schema | result |
|---|---|
| `.positive()` (before) | `HTTP 400 {"error":"Invalid body"}`, nothing stored |
| `.nonnegative()` (after) | `HTTP 201`, row stored with `duration_min = 0` |

Six unit tests: the zero parses, `0.1` and absence still parse, a **negative** duration is still
rejected (nonnegative is not "anything goes"), the upper bound still holds, a zero duration beside a
real distance does not become an implausible rate, and a 420 km / 1 min activity is still caught.

`npx tsc --noEmit` clean · `pnpm build` green · `pnpm check:rules` **Ran 38 of 38** · suite
**3,918 tests passed**, 54 skipped.

### Not exercised

- **Not on device.** Server/JS only, so it reaches the APK through the Railway deploy with no
  rebuild — but the toast the user actually sees lives in `done-activity-screen.tsx` and was not
  touched or run. What changed is that the failure it reports no longer happens.
- **The 3-second dead zone itself still exists** in `activity-store.ts`'s one-decimal rounding. That
  is Lane B's file, and it no longer costs anything: the value it produces is now valid.
