# 2026-09-25 — BF-61: the test was green on the bug, so the fix shipped and the device rejected it twice

Lane B, v1.465.62. `components/ui/swipe-actions.tsx` (one gate), `e2e/food-log-swipe-delete.spec.ts`
(one new case).

## What was actually wrong

The owner: *"if I wait a second it works."* A swipe reveals the tray, and a tap on Delete inside the
next moment is swallowed by the row, which is still over it.

The 2026-08-31 fix raised the tray with `z-10` while `isOpen`. `isOpen` is `offset <= -width` — true
only once the row has travelled the **full** tray width. So the raise arrived at the *end* of the
journey rather than the start of it, and every moment before that was still the original bug. Sweep 2
tapped after a pause: 3 of 3 good. Sweep 3 fired the tap in the same `adb shell` call as the swipe, so
it landed before React had committed the rest-open state at all: **no confirmation, 2 of 2.**

The gate is `offset < 0` now. The tray is raised for the whole of the window in which it is visible,
which is the invariant that matters — **if you can see it, you can hit it.** `aria-hidden` and
`tabIndex` follow the same flag, so a visible Delete is never a clickable `aria-hidden` button.

## The uncomfortable half: the regression test was green on the unfixed component

Control-run with the fix stashed and the spec kept: *"the first tap on Delete opens the confirmation,
even mid-animation"* — **passes**. It stretches the transition to 6 s and taps after the row has
**rested open**, so it only ever exercised the half that was already fixed. That is why an entry with
a named mechanism, a regression test and a shipped fix failed on the phone twice and came back as open
work.

The window sweep 3 hit is narrower than one CDP round-trip, so no arrangement of `tap` calls can race
it here. So the new case asserts the **property** instead: *while the row is displaced at all — finger
still down, mid-drag — the tray is the topmost element over its own rect.* Held at 36 px against a
64 px tray, which is displaced-but-not-open: exactly where the old gate left the tray underneath.
Timing-free, and it covers every window the timing test cannot reach, including the uncommitted one.

| | unfixed | fixed |
|---|---|---|
| the existing mid-animation test | **✓ passes** | ✓ |
| the new displacement invariant | **✘ fails** | ✓ |

## A trap the first version of the new test walked into

It reported *"a tap mid-drag would land on BUTTON.min-h-12 …, not the tray"* — with the fix applied.
The drag had never happened: it started at the row's centre (landing on the row's own control) and
skipped the scroll-into-view and the 16 ms pacing that `swipeRowLeft` does. So the test read a true
statement about a state it had not created. It now starts 16 px from the right edge like its sibling,
and **reads the row's transform before probing**, so a failure says which half broke.

## What is covered by construction, and what is not

`SwipeActions` is shared — `meal-card.tsx` and `saved-meal-card.tsx` render the same component — so
the meal list needs no second fix. It is still unverified there on the device.

The component's existing unit test covers the drag **maths** only; vitest has no DOM project in this
repo, so the render gate is reachable from the e2e harness and nowhere else.

## Not verified — all three acceptance clauses

`Verify: device`. On the S25, swipe and tap Delete **immediately**: ① the confirmation on the **first**
press, on both the meal list and the food rows; ② the slow tap still works; ③ the next rightward swipe
closes the tray and leaves the day alone.

**Clause ③ is not separately fixed and is not claimed.** Sweep 3 saw the day jump to Yesterday only
*after* a swallowed tap — it is downstream of the same defect and may clear with it. If it survives,
it is its own entry with its own mechanism, not a re-open of this one.
