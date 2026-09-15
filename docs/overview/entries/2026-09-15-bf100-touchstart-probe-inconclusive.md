# 2026-09-15 — BF-100: the probe was refuted, not the hypothesis

**Branch:** `docs/bf100-touchstart-probe-inconclusive` · **Lane B** · docs-only

BF-100 has failed on the S25 twice with its cause recorded as unknown, while `scroll-restoration.spec.ts`
passes in CI every run. That split is what made it look device-only and unreachable from here.

Its candidate cause says otherwise, and the candidate is testable in a browser:
`use-scroll-restoration.ts` cancels a pending restore on **`wheel`, `touchstart` or `keydown`** —
takeover is an input event rather than a scroll delta — and `stop()` latches `done = true` and
disconnects the observer **with no re-arm**. The S25's back gesture *is* a touch, landing on the
screen being restored to. `page.goBack()` fires no touch, which is exactly why the existing tests
never see it.

So Playwright can dispatch the missing half. It was worth trying, and the result is **not** what the
mechanism predicted.

## What was run, and what came back

The existing `/more` push-and-back, twice in one test with equal settle windows: once plain, once
dispatching `new Event('touchstart', { bubbles: true })` on the scroll container right after
`goBack()`.

| arm | restored? |
|---|---|
| control, no touch | **yes** |
| touch on arrival | **yes — 840** |

The touch did not cancel anything.

## Why that is not a refutation of BF-100

**It refutes the probe.** Two specific weaknesses, both mine:

1. **The element may be the wrong one.** It was picked as *"first node whose `scrollHeight` exceeds
   `clientHeight` + 100"*, which is not necessarily the `ref` the hook attached its listener to. An
   event dispatched on a sibling proves nothing about a listener on the real container.
2. **The timing may miss the window.** The dispatch fires as soon as the URL settles, which may be
   after the restore has already landed. `__scrollRestorationInternals` exports `RESTORE_WINDOW_MS`;
   nothing in the probe checked the event arrived inside it.

**The next attempt has to instrument rather than guess** — confirm which element carries the listener,
and that the event arrives inside the restore window, *before* reading anything into the outcome.
Until then this is one more thing that has not been established, and writing it down as "the
`touchstart` theory is dead" would be worse than not having run it.

## The draft that would have shipped a lie

The first version asserted only the touch arm, against `toBe(before)`, and marked itself
`test.fail()`. **It went green.** It would have gone green with no touch dispatched at all — because
the control does not hit that equality in every environment either. A `test.fail()` wrapper around an
over-precise assertion passes for any reason at all, and reports as a confirmation.

What caught it was running the control: restoring the file and re-running the two existing tests
against clean `main`.

## A second finding, about the spec rather than the bug

`scroll-restoration.spec.ts` asserts `toBe(before)` — an **exact** offset. Measured locally against
clean `main`: the restore landed at **1019** against a saved **778**, and the test went red. The
content grows on revalidation between save and restore.

**Restoration was working; the assertion was not.** It survives in CI, so this is a local/CI
divergence rather than a live regression — but an exact-offset assertion cannot tell *cancelled* from
*imprecise*, and that is exactly the distinction BF-100 turns on. Any probe for this class needs a
coarse measure — *did it move off the top at all* — rather than equality.

## Nothing shipped in code

No test was added: a red one makes CI red, and an inverted one would pin behaviour that is not
understood. The entry's own instruction still stands — a fix here changes takeover on every screen,
so it must not be built on a hypothesis. This narrows what the next session has to do, and removes
one probe it would otherwise have written.
