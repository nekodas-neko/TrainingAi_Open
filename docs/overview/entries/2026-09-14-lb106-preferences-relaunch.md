# 2026-09-14 — LB-106: the flake was never where the entry said it was

**Lane B.** Branch `fix/lb106-preferences-relaunch`. Test-only — no product behaviour, no version bump.

## The entry's cause was wrong

LB-106 said the spec *"clears `localStorage`, reloads, and polls for `ta_weight_lookback` to
reappear from `hydrateUserPreferences`… A slow launch under a loaded CI runner is exactly the shape
that turns a poll timeout into a failure."* Plausible, and not what the log says.

From run `34814623905` (PR #1166, 2026-09-14 07:11 UTC):

```
Error: page.goto: net::ERR_ABORTED at http://localhost:3100/
> 53 |   await page.goto('/')
```

**Line 53 is the relaunch. The poll is line 57 and is never reached** — on the initial attempt *and*
on Retry #1, identically. `hydrateUserPreferences` was not slow; on the failing run it is never
called. The prescribed next step — *"instrument how long `hydrateUserPreferences` takes from launch
on CI"* — would have measured a function the failure does not execute.

This is the **second** entry today whose stated cause did not survive being checked against the
thing it described (LB-107 was the first, and its guess was wrong in both halves). Both were written
by a session that had the evidence available and reasoned instead.

## The spec had already written down how to falsify the last fix

Its header carries `test.use({ serviceWorkers: 'block' })`, added 2026-08-30 against this same
`ERR_ABORTED`, with the condition spelled out: *"If the abort returns, the SW was not it."*

**It returned, with the block in place.** That is the previous session's honesty paying off a
fortnight later — it converted a dead end into a conclusion without re-running anything. The header's
other claim, that `page.reload()` *"aborts the navigation every run"*, is also stale: measured today,
reload **and** a same-URL `goto` both complete in the sandbox.

## What changed, and what is deliberately not claimed

The relaunch is now a **new page** rather than a re-navigation of the live one.

This stands on fidelity alone, independent of the abort: clearing storage under a running app leaves
its React state, its timers and its sync provider alive, and that instance can write a preference key
back or start a navigation of its own. A reinstall is a cold process. `localStorage` is per-origin,
so the clear carries over — verified, the seeded keys still arrive.

**It is NOT claimed to fix the abort.** The abort is CI-only and does not reproduce here, so this
removes the operation that aborted without explaining it. The falsification condition is written into
the spec in the same shape that paid off above: **if a run aborts again, on `fresh.goto` this time,
the relaunch shape was not it either** — the SW block should then be dropped as justified by nothing,
and the runner becomes the remaining suspect, the same run having carried a native
`chrome-headless-shell` segfault on `plan-rescale.spec.ts`.

## Ruled out by reading, not by guessing

No `storage` event listener exists anywhere in the app; the two `window.location.assign` call sites
(`lib/native/rest-timer-chip.ts`, `run-status-chip.ts`) are behind a custom event only the native
layer dispatches; the single `beforeunload` handler (`components/workout-screen.tsx`) mounts only
mid-workout on the workout screen. None can supersede a navigation on `/`.

## Verified

`pnpm check:rules` **Ran 74 of 74**, all passed. The spec passes locally, 3 passed. **The abort
itself was not reproduced and could not be** — that is the whole difficulty, and it is why LB-106
stays open with a `Keep:` rather than being struck.
