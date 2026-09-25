# 2026-09-25 — RV-99: the second "done" green, and the number the entry was wrong about four times

Lane B, v1.465.58. `components/workout/warmup-screen.tsx` (three literals), one new test, and a
measurement that re-laned RV-99 and shrank `LB-152`'s question by an order of magnitude.

## Why RV-99 was heading Lane B's READY list with nothing in it

The entry says *"Lane: B for `components/**` and `app/**`"*, so `next-item.js` put it first. But its
Lane B half had already been split out as `LB-152` — the owner's call on whether ~113 hard-coded
greens and reds may get brighter — leaving Lane B nothing to build. That costs a pick-up per session
for nothing, so the entry is now `Lane: A`: the four shared modules are all that is buildable, and
they do not wait on the owner.

Establishing *"nothing left"* took two scans, and the second contradicted the first.

## The scan that found nothing, and the scan that found something

RV-99's own test for defect-versus-preference is **is there a second value for this same meaning?**
A same-file scan for a band token and its hex literal in one file returns **zero** — the
workout-clocks slice cleaned up the only one.

A co-render scan (import graph, so a parent and its children count as one screen) returns 19 pairs,
and reading them shows the scan is the wrong shape: the biggest cluster is
`movement-balance-card.tsx` using `var(--accent-green)` for **legs**, an identity colour for a muscle
group, beside ten Health cards using `#22c55e` as a **card tint**. Co-rendering is not shared
meaning.

What both scans structurally cannot see is the one that was real. `warmup-screen.tsx` paints
*"✓ Warm up complete"* in `#22c55e`; the next screen paints *"✓ Ready"* and the warmup ramp's done
segments in `var(--accent-green)` — same state, same ✓-label-plus-filled-bar idiom,
`rgb(34,197,94)` against `rgb(86,238,102)`. The modes are **exclusive**, so nothing puts them on
screen together and no same-screen scan can reach it. Only the sequence exposes it, and the user
walks that sequence in seconds.

Three literals migrated. The glow keeps its own 53% — `#22c55e88` — rather than adopting the brand
branch's 60% beside it: the colour was the disagreement, the opacity was not.

## The test guards the class, not the two files

`components/workout/__tests__/rv99-done-green-agrees.test.ts`: no screen in the workout flow may pick
a green by a *done* condition using a hex literal, plus positive assertions that both surfaces still
colour the state (or the ban passes on a file that simply stopped). It deliberately does **not** ban
the hex outright — `#ef4444` for rest-overtime is one value across `rest-ring.tsx`,
`last-set-rest-timer.tsx` and `workout-clocks.tsx`, so there is nothing to fix and migrating it would
be a restyle nobody asked for. Control run against `origin/main`: two of three fail.

## The number, counted rather than estimated

The entry has carried **173, 183, 116 and 182** at different points. Counted outside comments,
`app/**` + `components/**` holds **116 sites across 55 files** after this fix — and the count was
never the useful question. Splitting by whether a *condition* picks the colour:

- **33 conditional. All 33 read** — not a heuristic's output: **14 true bands**, 6 an
  already-consistent state red, 7 deliberate red→amber→green ramps of the exempt `hr-zones.ts` class,
  3 a trained-today state, 3 outright false positives (a per-metric identity accent sitting beside
  `#f97316` and `#06b6d4`, Steps' identity colour, and a `|| '#22c55e'` fallback default).
- **83 unconditional** — card tints, chart series, icon gradients. **Not read one by one**, and spot
  checks show they are not uniformly identity either: one is a charging/draining state table, another
  a deliberate 5-step rating ramp. So 83 is an upper bound, not a verified figure, and it is recorded
  that way.

**So RV-99's band population is about fourteen, not a hundred and thirteen.** That is `LB-152`'s
question restated: about fourteen readings get brighter — a body-fat delta, a goal's on-track label,
the monotony meter, the weekly muscle-sets bars, the streak card's broken state, the deload banner's
severity — not an app-wide restyle. Recorded on `LB-152` as well as here, because the *size* of the
change is the whole of what the owner is being asked to weigh, and "a hundred and thirteen" is the
kind of number that makes a cheap decision look expensive.

## Checked and deliberately not filed

`training-load-card.tsx`'s `monotonyColor` bands at 1.5/2 with the same three colours
`acwrBandByKey` uses, which looks like two implementations of one formula. It is not: monotony on a
0–2.5 scale against ACWR at `ACWR_THRESHOLDS`. Two metrics, two threshold sets, one palette. Written
into the entry so the next reader does not re-open it.

## No device check owed, on purpose

A token swap on one label and one bar, with both values known exactly
(`oklch(0.84 0.22 145)` against `#22c55e`) — none of the surfaces the device gate names
(offline-first, native, safe-area, gesture, notification). The workout-clocks slice took no device
look either, and adding one here would inflate a queue of 41 owed checks for a result that is already
determined. **If the owner answers `LB-152` with (c) "leave it", this file reverts with
`workout-clocks.tsx`** — the two are one decision now, which is the point of fixing a disagreement
rather than half of it.

## Not exercised

Samsung's WebView rendering of `color-mix(in oklch, …)` in a `box-shadow` — the idiom the brand
branch one line above already uses, so it is not new to this screen, but it has not been *observed*
here. Exercised: full suite, `check:rules`, lint, tsc, build.
