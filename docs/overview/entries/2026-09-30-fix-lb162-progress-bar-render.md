# 2026-09-30 — LB-162: the three converted bars, finally seen

**Branch:** `fix/lb162-progress-bar-track-guard` · no product code changed.

Lane B's READY queue was **0** — five head items this session, one buildable here and four that
turned out to be Lane A's engine half. So this took the residue the baton names: `LB-162`'s `Keep:`,
which recorded **two render attempts that produced no evidence** and left `RV-72`'s `width` →
`transform: scaleX()` conversion *"sound by construction and unseen"*.

It is seen now, and **the device pass test is down from four items to one.**

## Both earlier failures were written down, so neither was retried

The entry's own `Keep:` said why each attempt died, and each had a different fix:

- **Home came up on the zero-data account**, where the Body Battery card does not exist. Pinning
  `STORAGE_STATE` is the whole fix — and a probe confirmed the card renders for the seeded user
  (`Body Battery` heading present, `Energy left right now` present) before any assertion was written.
- **The Health capture stopped above the muscle-sets card** even at `fullPage: true`, and scrolling
  to it by text timed out at 180 s against `next dev`. The card also mounts on **`/health/week`** —
  a pushed route that renders it near the top — so that is the surface used. The seeded week has no
  muscle sets (`Muscle volume this week` renders **0** times without one), so the digest payload is
  stubbed.

## The assertions are computed style and bounding boxes, not class names

The whole risk of moving six bars off `width` is geometric: **which end the fill grows from**, and
**whether a rounded fill gets clipped**. A class assertion would restate the source.

**Body Battery drains from the left.** At a stubbed 40%, `transform-origin` resolves to the fill's
right edge and the painted box is flush with the track's right edge:

| | x | width |
|---|---:|---:|
| track | 29 | 354 |
| fill | **241.4** | **141.6** |

So the right edges coincide at 383 and the left three-fifths of the track is empty.

**The muscle-sets marker stands proud.** Measured: marker **2 × 12 px** at y 759.5 against a row of
**346 × 8 px** at y 761.5 — overhanging 2 px top and bottom — with the fill clipped to the row's
8 px height and the marker at x 206, clear of the fill's right edge at 136.8.

That row is the one conversion that needed a nested clipper: the outer track stays
`overflow-visible` so two `h-3` markers can escape an `h-2` track, and the fill is clipped one level
in. Both halves are geometric and this is the only place they are checked.

## ⚠ `transform-origin` computes to used pixels, not `100%`

My first assertion was `origin.startsWith('100%')` and it failed against a **correct** bar: Chromium
resolves `origin-right` to `"354px 4px"`. Asserted as a ratio of `offsetWidth` now — the
untransformed layout width, which `scaleX` does not change — so it holds at any track width. Worth
knowing before writing the next transform-origin assertion in this repo.

## One pass-test item turned out to be a source property

The entry's fourth item was *"no fill looks oval at a low percentage"*, owed to the owner's eye.
It is not a device question. `ProgressFill`'s docstring already states the precondition —
*"A new caller without those two classes gets square ends"* — because the fill is **square** and
`scaleX` scales a radius with it:

- rounded track **+ `overflow-hidden`** → the square fill is clipped to the track's shape. Correct.
- rounded track, **no clipping** → square ends past the corners, and the fill reads oval at low
  percentages.
- **no radius at all** → square fill in a square track. Also correct — which is why the rule is
  *rounded ⇒ clipped* rather than *always `rounded-full overflow-hidden`*.

**Nothing enforced it.** `scripts/check-progress-fill-track.js` does now (Custom Rules,
**`Ran 86 of 86`**): **11 call sites, every rounded track clips its fill, baseline empty.** So the
item leaves the device list by being answered, not by being dropped.

**It judges the element that DIRECTLY wraps `ProgressFill`, and that is load-bearing.** Judging the
outermost track would report `weekly-muscle-sets-card` — a correct site — as broken, because its
track is `overflow-visible` on purpose. A control run pins exactly that: stripping the classes off
the *nested* wrapper fails, and the `overflow-visible` parent above it is not what is read.

The one site with no clipping is `metric-tiles-card.tsx:119`, an `h-1` track with **no radius**, so
there is nothing to clip and nothing to fix.

## ⚠ And the repo's oldest rule caught me in the fixture

My first version of the digest stub computed Monday from `getDay()` (device-local) and formatted it
with `.toISOString().slice(0, 10)` (**UTC**). `pnpm lint`'s `no-restricted-syntax` refused it
outright, and it was right to: the two disagree for the ten hours before 10am AEST, and this page
keys its cache on the week it asked for (`weekly-digest:${week}`), so a fixture a day out would stub
a week the page is not showing. It goes through `startOfWeekInTz()` and `shiftDateStr()` now — the
app's own helpers, no `Date` arithmetic at all. **A test fixture is not exempt from the timezone
rule**, and the gate is what said so.

## A leftover worth knowing about, deliberately not changed

`body-battery-card.tsx:172`'s track carries **`flex justify-end`** as well as the fill's
`origin="right"`. For a `w-full` child `justify-end` does nothing — the fill already spans the track
and `scaleX` shrinks it rightward — so it is a leftover from the `width`-based version, where a
narrow child did need pushing right. **Left in place:** removing it changes no pixel, and the render
above now proves which of the two mechanisms is load-bearing, so a future reader who deletes
`origin="right"` on the strength of the `justify-end` gets a red test rather than a bar that drains
the wrong way.

## Verified

- `e2e/lb162-progress-bar-render.spec.ts` — **2 passing** at 412 px dark.
- `scripts/check-progress-fill-track.js` — exit 0 on 11 sites.
- **Everything control-run, and one control was rewritten for being indirect.** Flipping
  `origin="right"` → `"left"` reddens the battery test naming `"0px 4px"`. Shrinking the marker
  `h-3` → `h-2` reddens the muscle-sets test — but the first version located the marker as
  `div.h-3`, so it failed by *finding nothing* rather than by measuring. It locates the row's
  non-clipping children structurally now, and the control fails on the height itself
  (`Expected: > 8, Received: 8`). Stripping `overflow-hidden` from a rounded track reddens the
  guard, from the nested wrapper and from a plain track alike.
- `npx tsc --noEmit` · `pnpm lint` 0 errors · `pnpm check:rules` **Ran 86 of 86** · `pnpm test` ·
  `pnpm build` · `check-backlog-pointers` and `check-doc-index-size` exit 0.

## Not exercised

- **The warmup bar's feel**, which is `LB-162`'s one remaining `Keep:` and is genuinely a device
  question: whether an 8 px glow still reads on a 2 px bar, and whether a 1 s `ease-linear` tick
  still looks like a tick. No container answers either.
- **The Samsung WebView compositor.** These measurements are Chromium's. A `transform` that
  composites cleanly here is the expected case on the S25 too, but "expected" is not "seen".
- **The three `height: auto` collapses**, still open on the entry above this residue — each is a
  look decision per site rather than a sweep, and none is touched here.
