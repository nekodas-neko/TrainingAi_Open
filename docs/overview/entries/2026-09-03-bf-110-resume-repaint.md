# BF-110 — the blank resume was never a dead renderer

**Branch:** `fix/bf-110-resume-repaint` · **Lane:** B · **Domain:** `[app-shell]` `[platform]`

The owner: *"this screen still happens when tabbing back. I noticed it fixes itself if you just
scroll on it. but would like to fix."*

## One detail overturns the standing diagnosis

**A scroll fixes it.** A killed WebView renderer has no document left to scroll — the process is
gone, the layer tree with it, and the only recovery is `recreate()` plus a reload. Content that
reappears when you drag it was there all along and simply was not painted. That is a compositor
failure, not a process death, and the two want opposite fixes.

Production agrees: `error_events` holds **zero** rows matching `renderer` / `reclaimed` /
`RenderProcess` across every blank screen since 2026-08-31. **That silence is weaker evidence than it
looks**, and the entry is right to say so — BF-80's handler is native, and the newest published APK
is v1.414.1 against a v1.436.x web app, so it cannot be assumed the installed build even contains it.
The scroll is what carries the argument.

**BF-80 is not wrong and its handler stays.** `onRenderProcessGone` returning `true` is correct
either way, and `check-render-process-recovery.js` should keep failing CI if it goes. What changes is
that BF-80 no longer explains *this* symptom. Two causes, one appearance.

## What shipped

Both halves, in the order the entry insists on, because the cheap fix and the wrong fix look
identical until the measurement exists.

**Measure.** `handleResume` reads the shell root's bounding box and child count on every resume.
Intact means a real box with real children; anything else would put a renderer death back in play and
make a repaint the wrong fix.

**Repaint.** Promote a layer, flush layout, release it on the next frame — the same instruction the
manual scroll gives the compositor. **Not a scroll nudge:** BF-100's restoration hook lives on this
same container and listens for scroll, and a programmatic scroll there is a needless interaction with
a fix that took six documented traps to get right. **Not a permanent `will-change`:** that buys
memory on every screen forever to fix a moment lasting one frame.

On `pull-to-sync.tsx`'s container, where BF-100 already sits, because the report says *"pages often"*
rather than naming a screen — fixing this in a component would look like a fix and hold for a day.

## The entry asks for a row per resume; that was not built

Three reasons, and the third decides it. `error_events` prunes at 30 days and is the second-largest
object in the database. The owner resumes many times a day. And **JS cannot tell whether the screen
was actually blank** — the DOM is intact either way, which is this entry's own thesis — so a row per
resume records nothing about the failure it is meant to evidence.

What ships instead: a **`dom-lost` sample always**, because that is the observation which would
*disprove* this entry and it must never be lost to a cap; and a **`dom-intact` sample once per
launch**, which is all the positive case needs. The repaint runs on every resume; only the row is
capped. Written into the entry so a later session does not restore the flood.

## Verification

12 unit tests, **seven mutations killing them**: a zero-sized root counting as intact, a lost DOM
silenced by the cap, a row on every resume, the layer staying promoted, no promotion at all, the
repaint tied to the report cap (which would fix the first resume of a launch and leave every later
one blank), and the hook not wired into the shell.

`pnpm check:rules` **Ran 67 of 67**; `tsc`, `check-test-typecheck` and lint clean.

## Not exercised — and here that is the whole verdict

**Samsung's WebView compositor, which is the only place this bug exists.** Chrome and `pnpm dev`
cannot show it; the repo has met this compositor before, in the SVG-wipes-sibling-gradients note in
[`docs/mobile-ui-and-performance.md`](../../mobile-ui-and-performance.md), with the same signature —
correct DOM, absent paint, invisible outside the APK. **So the suite proves the effect RUNS and
nothing about whether it FIXES anything.**

The device check: background the app long enough to reproduce (the original report had battery at
**10%** with Messenger running, and low memory is the likeliest trigger), then resume and confirm the
screen paints on its own. Afterwards, read `error_events` for `bf110 resume` — a `dom-intact` row is
the measurement this entry wanted, and a `dom-lost` row would mean the diagnosis here is wrong and
BF-80 is back in play.
