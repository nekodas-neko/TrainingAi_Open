## 2026-08-08 — `fix/auto-detection-inflight-teardown` — Q-95-followup: the surviving detection session

Closes **Q-95-followup**. Q-95 shipped a gate that refuses a *new* `motionTrigger` while a Guided
Walk, a manual activity, or a lifting workout is running (#1101). The owner then reported the "Other
Activity" naming sheet opening **by itself right as a Guided Walk finished** — a different failure,
which is why it was split off.

### The item asked for verification first. The source answers it.

The entry's open question was *"verify whether an auto-detection session already in `'tracking'`
state gets torn down (not just prevented from starting)"*. It does not, and
`auto-detection-service.ts` says so deliberately, in the comment Q-95 itself added:

> *"An already-probing/tracking session from before the workout started is left alone rather than
> torn down — a narrow, low-risk edge case."*

So the gate is doing exactly what it was written to do. The bug is that the edge case is not narrow:
it is reachable whenever detection was already running when the walk began.

### The mechanism, reproduced in a test

`endSession()` (`auto-detection-store.ts:99`) finalizes a session by pushing it into
`pendingSessions` — **and `pendingSessions` is what the confirm sheet reads**. So a surviving session
does not merely linger; on its next finalize it *becomes* the popup. `inflight-teardown.test.ts`
drives the store through that exact path and asserts `pendingSessions` has length 1. That is the
scripted-state reproduction the item asked for, and it needs no device.

### The fix

- **`discardSession()`** added to the store — throws an in-flight session away without finalizing it.
  Deliberately distinct from `endSession()`: calling `endSession` on abort would *cause* the very
  popup being removed.
- **`shouldAbortInFlightDetection()`** — a pure, exported predicate (same shape as the file's other
  extracted predicates, unit-testable without a device). It checks gate state and session state
  **independently**, because they go non-idle independently: in ungated (web-fallback) mode GPS is
  always on, the gate never leaves `'idle'`, and only the session is evidence of anything in flight.
- **`abortInFlightIfSessionOwned()`** runs on every gate tick, on `resume`, **and at the top of
  `onPoint`**. The first two catch the transition whichever store flips, with no per-store
  subscription to keep in sync. The third closes a race that the ticker alone loses: GPS points keep
  arriving during an owned session (nothing has stopped GPS yet), and `onPoint` calls `runWatchdog`,
  which calls `endSession()`. Between two ticks, that is the popup again.

A genuine unattended walk is untouched — the predicate returns false unless one of the three owning
stores is active.

### Verification

- `tsc --noEmit` clean · `eslint` 0 errors · **11 new tests** in
  `lib/activity/__tests__/inflight-teardown.test.ts` · full suite green · all eight custom-rule
  scripts pass.

### Not exercised

**No device run**, and the honest split is worth stating: the *decision*
(`shouldAbortInFlightDetection`) and the *effect* (`discardSession` producing no pending session) are
both directly tested. **`abortInFlightIfSessionOwned` itself is not** — it reads module-level
`gate`/`ungated` state and four Zustand stores, so covering it would mean mocking the service's
whole module graph for little added confidence. Its logic is two tested pieces joined by a call.

The real-world trigger — GPS/motion during a Guided Walk — still cannot be produced in the sandbox,
so **the end-to-end behaviour is unverified on device**. What has changed since the item was filed is
that the fix no longer *depends* on that reproduction: the failure path is pinned by a test, so an
on-device check is confirmation rather than the only evidence.
