# 2026-09-25 — the back-gesture sitting: a surface's own history entry was eating the navigation that closed it

Lane B, v1.465.61, the `back-gesture-sitting` batch (BF-165 + DV-2) as one PR.
`lib/hooks/sheet-back-stack.ts`, three call sites, one new e2e spec, one new fixture.

## One bug wearing two faces

The owner reported *"when I try click the treadmill; or any 'Other activity' nothing actually
happens"*, and — asked to narrow it — *"it just scrolls to the top of cardio hub"*. Separately,
Device Verification found *Leave* on *"Leave workout?"* closing the prompt and leaving you on the
workout you had just abandoned.

Both are the same thing. A sheet or dialog pushes a history entry when it opens and pops it when it
closes, which is correct in isolation. When the close is **caused by** a navigation, that pop lands
on the entry the navigation just created:

```
1741ms startViewTransition @/cardio     ← the Treadmill tap
1754ms pushState(/activity)
1761ms back()                           ← 7 ms later, on the S25
1779ms popstate @/cardio                ← back where it started
```

`/cardio` then re-renders at the top of its scroller, because that scroller is a nested
`overflow-y-auto` div no scroll-restoration covers. Sheet closed, same screen, scrolled to top —
the owner's sentence, exactly.

## Three cheaper fixes, each measured as failing

This is the part the entry earned over several sessions, and it is why the fix looks heavier than the
bug:

- **Wait for the pop to drain.** The module already counts self-pops (`pendingSelfPops`, BF-34). An
  `afterSelfPops(navigate)` was built and does not work: the counter is still **0** when the
  navigation is issued, so the parked callback runs inline and is eaten by a pop that has not
  happened yet.
- **Reorder the call site's three statements.** `router.push` runs inside
  `document.startViewTransition`, which suspends frame production and holds the React commit — so the
  navigation is itself what delays the surface's close past it. No ordering separates them.
- **Lengthen the navigation cap.** The push is fine and is undone afterwards. This turns a dead tap
  into a slow dead tap.

## The fix: release the entry before the navigation starts

`releaseTopSurfaceEntry()` clears the top surface's `pushed` flag synchronously, at the call site,
before anything else happens. The close then pops nothing, so there is no window left to mistime.
Tied to the surface **object** rather than a module flag — BF-34's finding that *"a state that is not
mine is indistinguishable from a real back gesture"* is the reason a bare "navigating" flag was the
known-bad shape here.

**It is two halves and the second is not optional.** Suppressing the pop alone leaves the sheet's
entry stranded underneath `/activity` at `/cardio`'s own URL, so backing out takes two presses with
the first one visibly doing nothing. So `selectType` uses **`router.replace`** when the entry was the
sheet's, overwriting it, and `push` when it was not. The `false` branch is real rather than
defensive: `openSurface` deliberately skips its push while one of our own pops is in flight.

DV-2's three `onLeave` handlers share a `leaveScreen()`: release, then **one** `history.go(-n)`. One
call rather than n `back()`s, for the same timing reason.

## The hole in my own fix, found before merge

`go(-2)` — release the dialog's entry, cross it and the screen's — is wrong on a path that is
reachable rather than theoretical. The Capacitor back handler checks the three session guards
**before** `hasOpenSurface()`, deliberately, so that a mid-workout back press *answers* this prompt
instead of closing whatever is open. With a sheet already up — the 1RM calculator, an exercise-stats
sheet — the dialog therefore opens **on top of it**, history is `[…, /workout, sheet, dialog]`, and
`go(-2)` lands on `/workout`: the screen *Leave* exists to leave.

The mistake underneath it is worth stating plainly, because it is easy to make again: **releasing an
entry does not remove it.** Clearing `pushed` only stops the surface popping it; the entry is still in
history and still has to be travelled. So the distance is `1 + releaseAllSurfaceEntries()`, and it is
**counted** rather than taken from the stack depth — a surface that skipped its push contributes 0,
and going one too far leaves a screen the user never asked to leave.

Found by re-reading the diff against the back handler, not by a test — which is the argument for that
re-read, since no test in this repo can reach the path.

## The spec reproduces it, and the control run is the evidence

`e2e/bf165-dv2-navigation-survives-surface-close.spec.ts`, with the two conditions BF-165 spent three
rounds of wrong answers establishing: **warm both destinations with a direct `goto`** (a `next dev`
cold route hangs its RSC fetch indistinguishably from a dead tap), and **make the tap land**.

Against the unfixed source:

| | |
|---|---|
| Other activity → Treadmill | **fails** — *"the navigation was undone after it landed"* |
| one back to the hub | **fails** |
| Guided walk (discriminator, no sheet) | **passes** |

That last row is the whole reason it is in the file: a fix that broke navigation generally would
otherwise pass. All three pass with the fix.

## `tapHitTested`, and the fabricated defect it prevents

`page.touchscreen.tap()` is a raw coordinate dispatch: no scrolling, no actionability check, no
complaint when the point is outside the viewport. On `/cardio` at 412×915 the three modality controls
sit at y=852, 924 and 997 — so *Run* is on screen and the two below are not, and their taps hit
nothing. That read as *"both `/activity*` destinations are dead and `/running` works"*: a perfect
href-shaped differential, and entirely a coordinate artifact. It produced a second "dead button" that
did not exist and had to be retracted. `tapInView` does not save you — it filters on **x** only.

The helper scrolls `block: 'center'` and asserts `document.elementFromPoint` resolves to the control
before dispatching, naming what it would have hit instead.

## Coverage, honestly

The sheet half is reproduced and control-run in the harness. **The dialog half cannot be** — reaching
it needs the Android system back gesture over a Capacitor channel Playwright cannot fire. What covers
the mechanism for both is `lib/hooks/__tests__/sheet-back-stack.test.ts`, nine new cases driving both
releases against an injected history, mutation-tested five ways: leaking a self-pop (2 fail),
releasing the bottom surface instead of the top (1 fail), always returning true (2 fail), counting the
stack depth instead of the pushed entries (1 fail), and taking only the top when the caller needs all
(1 fail).

## Swept, and one thing deliberately left

`components/cardio/time-picker-sheet.tsx` `start()` is the identical close-then-push shape and is
fixed with it. Its `onLogActivity` arm deliberately does **not** release: it opens another sheet
rather than navigating, so the entry stays useful for the surface replacing this one. It remains
**COULD NOT CHECK** on the device — its trigger renders only `!hasRunningPlan` and the owner has one.

BF-165 asked whether a navigation that never lands should leave its selection behind. The fix answers
it rather than deferring it: `startActivity` still runs first and the navigation now lands, so the
`ta_activity_state` it writes is correct rather than orphaned.

## Not verified

**Both device pass tests.** On the S25: Cardio → *Other activity* → *Treadmill* lands and stays, one
back returns to the hub; and start a workout, back, *Leave* → the screen leaves `/workout?session=…`
and one more back does not return to it. The device undoes the navigation **60× faster** than the
harness (7 ms against 415 ms), so the canonical runtime is where a timing claim is actually tested —
and the timing claim here is that there is no window at all.
