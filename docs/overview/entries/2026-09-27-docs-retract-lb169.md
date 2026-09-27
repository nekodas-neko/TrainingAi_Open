# 2026-09-27 — LB-169 retracted the day it was filed: the button is already 48 px

**Branch:** `fix/empty-meal-add-tap-target` · **Lane:** Implementation B · **Code changed:** none (the fix was written, measured to be unnecessary, and reverted).

## The claim, and why it was wrong

`LB-169` was filed this morning: the empty meal's header `+` is `h-9 w-9` in
`components/nutrition/meal-card.tsx`, **36 px**, under the 48 px floor the rest of the screen holds
to. It was read straight out of the source and never rendered.

**Measured in the harness at 384 px: the button is 48 × 48.** `app/globals.css` carries a global
floor —

```css
button,
[role="button"] { min-height: 48px; min-width: 48px; }
```

— with a `.tap-dense` opt-out for deliberately dense controls. So a Tailwind `h-9 w-9` on a
`<button>` is raised to 48, and **the size class is not the rendered size**. The entry's premise does
not exist.

The fix was written first (a 48 px box pulled back to the row's footprint by negative margins), and
the probe that was meant to prove it works instead reported 48 × 48 *before* the change. That is what
exposed it — the control run, not the review.

## What was corrected, in four places

The claim had already propagated, which is the part worth recording:

1. **`LB-169`** — removed from the queue.
2. **`RV-213`** — carried it as a "rule violation rather than a taste call" that had to ship
   alongside the collapse. Retracted in place, and the entry is now **unblocked**: collapsing an
   empty meal leaves a control already at the floor.
3. **`docs/domains/nutrition/README.md`** — the open-issues line is now a ✅ with the reason.
4. **The mockup page the owner was given** (`SQxd9yfvjcbnZVseiPVwHh`) — it told him the `+` "should
   grow to 48 as part of this". Republished with the claim withdrawn and the measurement in its
   place, because he may act on that page and it was wrong.

## The lesson, which this repo already had from the other direction

`RV-211` ⑤ recorded that a source grep saying *"does not reproduce"* was the wrong conclusion — the
marks were real on screen. **This is the same rule filing a defect instead of dismissing one.** A
size class is a hypothesis about a rendered size; a global stylesheet can override it, and this one
does. The existing baton line said *render before fixing and before dismissing*; it now says before
**filing** too.

Worth knowing for the next sweep: **`h-9`/`h-8` on a `<button>` in this repo is not evidence of an
undersized target.** Only a render is, and `.tap-dense` marks the opt-outs.

## Two queue entries cleared in the same pass

Picking the next item turned up two more finished entries sitting in READY, the same class `LB-171`
fixed this morning from a different cause:

- **`RV-212`** — its own first line reads *"Nothing is left here for a lane"* (①② shipped, ③⑤ dropped
  by sweep 64, ④ moved to `LB-167`), and it was still rank 1 of Lane B. Removed. Its ③ carried a
  finding `RV-208` did not have — that the near-white primary is the **dialog** primary rather than a
  one-off, since the weigh-in sheet's Save matches it — so that moved to `RV-208` rather than
  disappearing with the entry.
- **`LB-169`** — removed as above.

Lane B's READY list went from 15 to 13 without anything being built, which is the point: neither
entry had work in it.

## Not exercised

Nothing on-device. The global floor is plain CSS served to the WebView the same way, so the
measurement carries — but it was taken in headless Chromium at 384 px, not on the S25.
