# 2026-08-17 — Q-309 refuted: the tap works; the harness was tapping wrong

**Branch:** `claude/implementation-lane-b-0o7kb9` · **No version bump** — no product code changed · **Lane:** Implementation B

## What the entry claimed

Q-309: *"a touch tap on Nutrition's action row does not activate the button; a synthesised click
does."* It suspected the screen's date-swipe binding
(`useDrag(..., { filterTaps: true, pointer: { touch: true } })`) was swallowing taps, and noted this
repo's history of gesture handlers swallowing input (pull-to-sync, twice). It also — correctly —
refused to authorise a gesture change without device reproduction first.

That caution turned out to be the right instinct, because the premise is wrong.

## What was measured

Four probes in the real harness, against the live screen:

| Input | Events the element received | Sheet opens |
|---|---|---|
| `.click()` | `pointerdown, mousedown, pointerup, mouseup` — **a mouse sequence, no touch events** | **no** |
| `page.touchscreen.tap()` | `pointerdown, touchstart, gotpointercapture, pointerup, touchend, lostpointercapture, click` | **yes** |
| hand-rolled synthetic `TouchEvent`s | (synthetic events produce no real activation) | no |
| `dispatchEvent('click')` | the old workaround | yes |

**A real touch tap opens the sheet, first time, every time.** That is what the canonical runtime —
a touch-only APK — actually does, so the reported user-facing bug does not exist.

**The `filterTaps` hypothesis cannot be right.** The failing case produces *no touch events at all*;
there is nothing for a tap filter to filter. `pull-to-sync` is ruled out too — it binds only touch
listeners and is not mounted on this screen.

Two further checks, to avoid replacing one guess with another:

- **Not an open-then-close.** Polling the DOM 20× over 2 s after `.click()` shows `[role="dialog"]`
  never appears at all.
- **Screen-specific, not harness-wide.** `.click()` on `/more` → Edit Profile opens that sheet
  normally, so Playwright's mouse path is not simply broken.

## One correction to my own working, recorded because it nearly misled me

An early probe attached listeners to the element returned by
`[...document.querySelectorAll('button')].find(b => /water/i.test(b.textContent))` and reported that
**no `click` event fired at all**. That was wrong — it had attached to a different element than the
locator resolves. A document-level capture listener shows the click *does* reach `span[Water]` in
both cases. The corrected picture is what the table above records, and it is what makes the residual
question ("a click arrives and the handler does not run") the interesting one rather than "no click
arrives".

## What shipped

Only the spec. `e2e/water-log-write-path.spec.ts` now taps with `page.touchscreen.tap()` instead of
`dispatchEvent('click')`, which satisfies the entry's own requirement that *"the spec should stop
needing `dispatchEvent`… a spec that cannot tap the way a user taps is testing something adjacent to
the product."* Its comment block now carries the measurements rather than the refuted hypothesis.

**No product code changed**, so no version bump and no changelog entry.

## What is left, and what was deliberately not done

**Q-309 is removed** — its premise, that a touch tap does not activate the button, is false.

**Q-354 filed** for the part that is genuinely unexplained: a mouse click reaches the element on this
screen and the handler does not run, while the same input works elsewhere. Filed **low priority and
explicitly non-actionable-by-guessing**: the entry says not to change gesture code without first
reproducing a *touch* failure, because the touch path is verified working and a speculative change
there would put the path that matters at risk.

**The sibling sweep was not run**, deliberately. Q-309 asked for one across Health and the day-detail
screen "if this is real". It is not real for touch, which is the only input the supported target
produces, so sweeping siblings for a mouse-only anomaly is not worth the change surface. If Q-354 is
ever picked up and turns out to be something structural, the sweep belongs with it.

## What was NOT exercised

- **The device.** Everything here is Chromium under Playwright. A CDP touch sequence is the closest a
  browser harness gets to a finger, and it is not a finger on the S25's WebView — so "touch works" is
  measured in the harness, not on the phone. It is, however, the *opposite* direction of risk from
  the entry's concern: the harness was the pessimistic case.
- **Why the mouse path fails.** Narrowed to "screen-specific, click arrives, handler does not run",
  not pinned. That is Q-354.
