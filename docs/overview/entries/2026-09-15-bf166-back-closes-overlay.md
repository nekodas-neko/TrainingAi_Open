# 2026-09-15 — BF-166: the registry already existed, under different names

**Branch:** `fix/bf166-back-closes-overlay` · **Lane B**

Owner: *"If you have a nutrition meal creator menu open and you press the back button - it makes the
page behind it go back to main."*

## The entry asked for something the app already has

BF-166 stated *"no overlay registry exists"* and proposed building one: a module-level stack that
`SheetContent` and `DialogContent` push a close-callback onto, consulted by the back listener.

**That stack exists.** `lib/hooks/sheet-back-stack.ts`, reached through `useSheetBackDismiss` →
`BackDismiss`, which **both** primitives already render — BF-27 put it there, deliberately central,
with a docstring explaining why it is not at the 45 call sites. The entry's grep looked for
`openOverlay|overlayStack|topOverlay`; the real names are `openSurface` and `closeSurface`.

**Building the proposed registry would have left two stacks disagreeing about what is open** —
strictly worse than the bug. This is the twelfth time an entry's stated cause has not survived being
read against the thing it describes, and the first where acting on it would have added a defect
rather than merely wasted a session.

## The real defect, which is one line

`openSurface` pushes with `pushState(state, '')` — **no URL argument** — so
`window.location.pathname` never moves. And `backActionForPath` reads nothing *but* the pathname.

| route | `backActionForPath` | what the listener did | consumed the pushed entry? |
|---|---|---|---|
| `/nutrition` (a tab) | `"home"` | `navigateToTab(router, "/")` | **no** |
| `/` | `"minimize"` | `App.minimizeApp()` | **no** |
| `/more/details` | `"pop"` | `window.history.back()` | yes |

**Only `"pop"` ever worked, and only by coincidence** — `history.back()` happens to be the thing that
consumes the entry. The other two branches navigate or background the app without touching history,
stranding the sheet on top of a page that has moved. That is the owner's report exactly.

**`"minimize"` is a second symptom the entry did not name:** a sheet open on Home, and back sends the
app to the background instead of closing it.

## The fix

Export `hasOpenSurface()` from the existing stack; have the listener call `history.back()` when it is
true. That routes into `handlePop`, which closes the topmost surface through Radix's own
`onOpenChange` — the identical path as the X button, so every guard already attached to a sheet's
close still runs.

**The entry's one correct instruction is kept: the check sits *after* the three mode guards.** Each
of those *raises* a dialog (`LeaveWorkoutDialog` and its siblings), and that dialog is itself on this
stack — checking overlays first would make a mid-workout back press close the confirmation instead of
answering it. A test pins the order.

## Verification, and its honest limit

`components/__tests__/bf166-back-closes-overlay.test.ts`: **4 of 5 assertions fail against `main`**.
The fifth passes on both sides deliberately — it records that the primitives were already wired,
which is the finding that stopped a duplicate registry being built, and a test that only passes after
a change cannot carry that.

**No harness run exercises this at all.** Android's hardware back is a Capacitor channel; Playwright
cannot fire it, and in a browser Radix closes on Escape so the bug never appears. The unit tests
cover the stack's behaviour and the listener's ordering — **not the gesture**. The device is the only
real check and it is owed.

## A note on the assertion that failed first

The ordering test initially measured `indexOf('hasOpenSurface')`, which matched the **import line** at
the top of the file rather than the call site — so it compared against a position before everything
and proved nothing about order. Both assertions now anchor on `hasOpenSurface()` with parentheses.
The code was right; the test was measuring the wrong occurrence.
