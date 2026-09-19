# 2026-09-19 — BF-100's `touchstart` cause reproduced in the harness, and fixed

**Branch:** `fix/bf100-touch-cancels-pending-restore` · **Lane B** · code + docs · no migration ·
**v1.459.2**

BF-100 was Lane B's only READY entry. It had failed on the S25 **twice**, its candidate cause had
been probed once and come back inconclusive, and `projectOverview.md` carried an explicit decision:
*"the fix is deliberately not built — it must not ship on a hypothesis when one tap decides it."*
That decision is reversed here, and the reason is that it stopped being a hypothesis.

## The window is real, and it had never been measured

The candidate: `use-scroll-restoration.ts` took its user-takeover from **`touchstart`**, and `stop`
latches `done = true` and clears the timer with **no re-arm** — so one touch abandons a *pending*
restore permanently. True in source, but nobody had shown the pending window was non-empty.

Instrumenting `addEventListener` and `sessionStorage` on a live `/more` back-navigation:

```
15240ms SAVE  ta_scroll:/more=840
15681ms LISTEN touchstart  <div class="flex-1 overflow-y-auto pb-nav-safe scrollbar-hide">
15863ms CLEAR ta_scroll:/more (restore landed)
```

**182 ms with the listeners live and `done` still false.** That also identified the container
properly, which the previous probe had only guessed at.

## Why the 2026-09-15 probe came back null — settled, and it was neither stated reason

The old entry blamed the element or the dispatch timing. Both are wrong. **`page.goBack()` does not
resolve until after the mount and the restore**, so any touch dispatched after it is on the wrong
side of the window by construction. Arming the dispatcher *before* `goBack()` does not help either —
the container only matches a selector once it has mounted, which is the same instant the restore
lands. Measured: first dispatch at 15627 ms against a restore at 15613 ms.

**The 182 ms window cannot be hit from the test side at all.** Reading that null result as evidence
against the hypothesis would have been wrong, and very nearly was.

## What made it testable: widen the window instead of chasing it

Seed an offset the container can never reach. `attempt()` then never lands, so the restore stays
pending for the whole of `RESTORE_WINDOW_MS` and the touch places trivially. Against the unfixed
hook the cancellation reproduces outright:

```
restored to 0 against a reachable 1019: 0 means a bare touchstart latched done=true
and cleared the timer, which is the BF-100 cancellation
```

## The fix

`touchstart` → **`touchmove`**, through a single `TAKEOVER_EVENTS` constant so the add and remove
lists cannot drift. Trap (4) is intact — takeover is still an **input event**, not a scroll delta —
but a finger that never moved has scrolled nothing. `e2e/bf100-touch-does-not-cancel-pending-restore.spec.ts`
pins both directions, and **both arms were proven red pre-fix**, in opposite directions: `touchstart`
cancelled when it should not have, `touchmove` was not listened for so it failed to cancel when it
should have. All three existing `scroll-restoration.spec.ts` cases stay green.

## What is NOT established

**Causation on the device.** The harness fires no touch on a back navigation, so it cannot say
whether the S25's gesture delivers one into that window — only the device can. If the gesture still
lands at the top, **the one-tap experiment survives as the fallback**: come back with a UI back
control instead; if that restores while the gesture does not, the cause is elsewhere in the gesture
path and BF-100 is buildable work again. Its `Keep:` says so outright, because this entry has twice
been mis-filed as *"shipped, a look is owed"* while the look had already failed.

BF-100 moves to `Verify: device` — legitimate this time only because the device has **never seen
this change**. It joins BF-166, LB-107 and LA-109 in the `back-gesture-sitting` batch, so Lane B's
READY list is now empty and one sitting answers all four.

## Gate

`Ran 75 of 75` Custom Rules · **8965 vitest tests** (946 files, 0 failed) · the new e2e 2/2 and
`scroll-restoration` 3/3 · tsc clean · tests-typecheck at baseline (320/90) · lint 0 errors.

## Not exercised

**The device** — which is the entire open question here, not a footnote. Also untouched: the offline
path, native SQLite, and real safe-area insets; this change is one event name in a web-reachable
hook.
