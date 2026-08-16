# 2026-08-07 — Workout card recovery chips: marquee → wrap

**Branch:** `claude/health-metrics-button-designs-hy6cyv` (restarted from `main` after #1128 merged)
· **Version:** 1.269.2

## The bug was not what the report said

Filed during the Cardio Hub session as "the RECOVERY chip strip is clipped at both ends". Opening
the component showed the real cause: the chips run as an **infinite marquee** (`ta-marquee`,
duplicated pill set, speed scaled to count). Nothing was mis-positioned — the row was permanently in
motion, so at any glance the chips at both edges were sliced mid-word and the only way to read a
given muscle was to wait for it to come round.

The second-order problem was worse and invisible from the screenshot: `globals.css` neutralises
`ta-marquee` under `prefers-reduced-motion`, which parks the strip at `translateX(0)` and makes
**everything past the first two chips permanently unreachable** for those users.

## Fix

`components/workout/muscle-recovery-card.tsx` — the chips wrap (`flex-wrap`) instead of scrolling.
Static, complete, readable at rest, and correct under reduced motion.

## Why not a scrollable strip

That was the obvious alternative and it is the wrong one here. This card renders **inside the
session carousel's swipe container**, which sets `touchAction: "none"` and hand-rolls its
`onTouchStart/Move/End` handlers to page between sessions. A horizontally-scrollable child would
fight that gesture — precisely the conflict CLAUDE.md's gesture rule describes (pull-to-sync
swallowed normal scrolling twice for the same reason). A wrapped row needs no gesture at all.

The extra line costs nothing structurally: the muscle diagram is `flex-1 min-h-0` inside a card that
is itself `flex-1 min-h-0`, so it absorbs the height rather than the screen overflowing.

## Verification

Signed in against the dev server and cycled all three seeded sessions at 412×891, asserting every chip's
box sits inside its wrapper's box:

| Session | Chips | Rows | Strip | Card | Clipping |
|---|---|---|---|---|---|
| Push | 3 | 2 | 56dp | 594dp | none |
| Pull | 4 | 2 | 56dp | 594dp | none |
| Legs | 4 | 2 | 56dp | 594dp | none |

Card height is identical to before the change.

**Not verified on device.** No blur/filter/gradient and nothing bottom-anchored, so neither the
Samsung compositor bug nor the safe-area floor applies.

## Gotcha worth remembering

The first verification run showed the **old** component despite the file on disk being correct — the
app's service worker served a stale build to the headless browser. Playwright contexts need
`serviceWorkers: 'block'` when checking a UI change against `pnpm dev`, or you will verify a
previous build and believe it.

## Left behind

`ta-marquee` in `app/globals.css` now has no callers, and CLAUDE.md's Key Files table still
advertises it. Not removed here — a bug-fix PR is the wrong place to edit shared CSS and project
docs — but recorded in `projectOverview.md` so it is not a dropped finding.
