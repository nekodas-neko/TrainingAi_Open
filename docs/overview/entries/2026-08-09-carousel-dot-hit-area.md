# 2026-08-09 — 48px hit areas would have made the carousel dots harder to hit (Q-160)

**Branch:** `fix/carousel-dot-hit-area` · **Domain:** `app-shell`, `workouts` · **v1.276.4**

## The entry's fix was wrong, and measuring said why

Q-160: the session carousel's dots render at **7×7 px** (active 7×20). `tap-dense` opts them out of
the global 48px floor and nothing put a touch area back. The prescribed fix was *"keep the dot 7px
visually and pad the hit area to 48px"*.

Measured at 412×915 before touching anything, the row runs on a **15 px pitch**. A 48px box per dot
therefore overlaps its neighbours by 33px on each side, and the sibling painted last is the one that
receives the tap. Padding to 48px would have made the left-hand dots *less* reliable than they were
at 7×7 — a hit area wider than the pitch is worse than a small one.

## What shipped instead

24px boxes on a 24px pitch: WCAG 2.5.8 AA's minimum, and the widest that stays disjoint.

| | before | after |
|---|---|---|
| dot ink | 7×7 (active 7×20) | unchanged |
| hit area | 7×7 | **24×44** |
| pitch | 15 px | **24 px** |

Height is free — siblings are laid out horizontally, so a tall box overlaps nothing. Width is not,
which is the whole constraint.

`app/globals.css` gains `.tap-target-dot` (the invisible centred box) next to the existing
`tap-dense` opt-out, with the pitch reasoning written where the next person will hit it.

## Four carousels, not the two the entry named

The entry said `/workout` and `/workout-select`. There is no dot row on `/workout`; there are
**four** elsewhere, three of them byte-identical:

- `app/workout-select/workout-select-content.tsx` — session carousel
- `components/guided-walk/walk-config.tsx` — preset carousel
- `components/running/run-type-carousel.tsx` — run-type carousel
- `components/health/strength-trend-card.tsx` — a horizontal-pill variant

The first three are now one `components/ui/carousel-dots.tsx`, per the rule that a pattern at ≥2
sites gets extracted before a third copy — this was already at three, with a fourth adjacent. The
strength-trend card keeps its own markup (it draws a 16×1.5 pill, not a dot) and takes the same
touch area and spacing.

`components/ui/switch.tsx` had already hand-rolled this exact overlay for the same reason. It is
left as-is: it is an isolated control with no dense siblings, so its 48px box is safe and correct
where a dot row's would not be.

## The audit the entry asked for

Six controls use `tap-dense`. Four are fine:

- `switch.tsx` — already restores a 48px box.
- `done-screen.tsx:531`, `next-workout-card.tsx:92` — underlined 10px text inside a sentence. This
  is what the opt-out's comment was actually written for; a 48px box around inline prose would
  overlap the text around it.

Two are not, and are filed as **Q-176** rather than swept in here:

- `pre-workout-screen.tsx:362` — the Deload pill, about 16px tall, a standalone badge rather than
  inline prose.
- `profile-tab.tsx:378` — the avatar camera badge at 32×32. Clears AA, under Material's 48dp.

Neither is the 7×7 case, and neither shares the dot row's geometry, so `.tap-target-dot` is the
wrong class for them.

## Verified

- `tsc --noEmit` clean · **430 files / 3426 tests** green · all 15 custom-rule scripts pass · eslint
  clean on the changed files.
- Browser at 412×915, `/workout-select`: ink still 7×20 / 7×7, `::before` measures **24×44** on
  every dot, pitch exactly **24 px**.
- The case that would have broken under the entry's fix: clicking **10 px to the left of dot 1** —
  outside its ink, inside its box, and inside where a 48px neighbour box would have reached —
  selects index **0**. It is the first dot's tap, not its neighbour's.
- `/activity/guided-walk`: 3 dots, 24 px pitch, 24×44 boxes, labels `Long` / `Short` / `Custom`.
- No page errors on either screen.

**Gotcha worth repeating:** two of these screens timed out at a 90 s `waitUntil: 'load'` until the
routes were warmed with `curl`. Cold Next dev-server route compilation, not a hang — the same trap
that cost time on Q-165 earlier today.

## Not exercised

- **The APK.** Tap targets are the one thing a desktop browser cannot really vouch for: a mouse
  click is a point, a thumb is not. This belongs on the next device smoke run.
- `/running` and `/health` render **zero** dots on the seeded local DB — the run-type carousel needs
  a running plan with a live prescription, and the strength-trend card needs ≥2 exercises with
  history. Both were converted and type-check, and `/running`'s carousel is the same component
  proven on the other two screens, but **neither was seen rendering**. Stated rather than implied:
  4 of the 6 changed surfaces were observed, 2 were not.
