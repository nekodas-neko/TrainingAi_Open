# The swipe tray's Delete works on the web at every delay, so the cause is somewhere else

Implementation Lane B, 2026-09-26. `BF-61`, taken as work after `OR-176` reopened it — and handed
to Device Verification rather than fixed a third time.

## What this session actually established

Sweep 4a gave the defect a number for the first time: from a verified-closed tray, a real
`adb input tap` on Delete's own rect at **0 / 100 / 200 / 300 ms after the swipe is swallowed
(8 of 8)** and at **500 ms it works (2 of 2)**.

That window is **far wider than a CDP round-trip** — which sweep 3's was not — so for the first
time the Playwright harness could aim at it. Probed at 0, 100, 300 and 500 ms after a released
200 px swipe, with the natural 220 ms transition and no stretching: **the confirmation appeared
4 of 4**, and the row's transform read `matrix(1,0,0,1,0,0)` every time, meaning the button's
`onClick` ran and called `close()`.

The probe is kept as a test — *"a tap the instant the swipe ends opens the confirmation"* in
`e2e/food-log-swipe-delete.spec.ts`.

## What that rules out

Re-read for this, and all of it behaves: the gesture maths, the `offset < 0` raise that v1.465.62
shipped, the `aria-hidden`/`tabIndex` flag, and the wiring from the tray's button to the parent's
confirmation. The tray is a later-painting `z-10` sibling of a `z-auto` row, so hit-testing
resolves to the tray for the whole slide.

**The tray does nothing else during the slide.** There is no timer, no guard and nothing with a
~500 ms lifetime anywhere in `swipe-actions.tsx`, `swipe-actions-math.ts`, `meal-card.tsx` or the
nutrition day-swipe — which is what the entry asked to be checked before that line was touched
again.

And the obvious WebView explanation is excluded too: `app/layout.tsx` sets `userScalable: false`
with `maximumScale: 1`, so Chromium's 300 ms double-tap click delay is already off. It was a good
fit for a 300-versus-500 threshold, which is exactly why it was worth disproving rather than
assuming.

## Why no third fix

Two fixes have shipped on plausible mechanisms and both failed on the device. A third guess costs
another device sitting and keeps `BF-94` blocked behind it.

**And the harness structurally cannot see what is left.** `page.touchscreen.tap()` is a CDP
dispatch straight into the renderer; a real Android tap travels through the compositor's hit test
first. A green run here is evidence about the JS path and nothing below it.

## What was handed to Device Verification instead

`BF-61` is re-laned `B` → `DV` — the next action is a measurement nobody has taken with an
objective result, which is what that lane is for. The fix stays Lane B's and comes straight back.

The probe asks three things in order, each of which halves what is left: whether
`document.elementFromPoint` at Delete's centre returns the button or the row during the window;
whether a `pointerdown`/`touchstart` listener on the button fires at all; and whether a `click`
follows if it does. Hit-testing, a press that never reached the renderer, and a suppressed click
need completely different fixes, so the entry says not to touch it again until one is named.

## Also recorded, because a cloud session cannot message another session

Two notes were written onto `DV-12` rather than sent: a correction to this lane's own #1675 claim
(a real per-canvas measurement of 578 → 0 was generalised into a claim about the whole tab switch,
and sweep 4a was right to still find 16 of 20 taps at 51–104 ms), and the one question that decides
`OR-162`'s remaining half — whether the harness can separate "on arrival" from "while hidden" for a
single canvas, with Wear Time as the control.

## Failure surfaces not exercised

The device, which is the whole of what is left here. Nothing in this diff changes product
behaviour: it adds one e2e test and rewrites two backlog entries.
