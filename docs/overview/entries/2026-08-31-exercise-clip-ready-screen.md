# 2026-08-31 — the movement, on the screen where you are about to do it (BF-65)

**Branch:** `claude/implementation-agent-lane-b-43nmep` · **Lane B** · v1.405.0

## The ask

The owner, with the ready screen and the warm-up screen side by side: *"id like the exercise gif in
the pre session screen so it shows you what movement you will be doing."* The warm-up screen renders
the clip at 40 px; the ready screen — name, last session, bar load, ramp-up, set targets — had no
picture and no route to one, because `ExerciseStatsSheet` carries the gif and is mounted only on the
pre-workout screen.

## The fetch was the real work

The same `fetch('/api/exercise-gif?name=…')` → `{gifUrl, imageUrl}` was hand-rolled in **four**
places: `warmup-screen`, `exercise-stats-sheet`, `config/exercise-preview-sheet` and
`workout-builder/builder-review`. This would have been the fifth, which is two past the point the
extract-before-a-third-copy rule fires. `lib/hooks/use-exercise-media.ts` is now the only fetch, and
all four sites are converted in this PR rather than left as a follow-up.

**The cache key is what makes the feature instant.** `WarmupScreen` fetches media for every exercise
in the session moments earlier, then unmounts on the mode change and the map goes with it. Going
through `exercise-media:<name>` means the ready screen's synchronous seed answers from what the
warm-up screen already fetched — no spinner for a file the app downloaded sixty seconds ago.
`prefetchBinaries` (warm-up only) still pulls the files so the service worker holds them offline.

`freshWithinTtl` is deliberately not set. The seed already gives the instant paint; skipping the
revalidation would trade a one-paint staleness for a six-hour one on a regenerated clip.

## The layout question answered itself

The entry called the layout "a real decision, not a drop-in", because the owner's screenshot already
had `SET TARGETS` cut off behind the action row and a full-width media block would push the bar-load
number — the thing actually being read — further down. So the clip renders at **64 px beside the
name**, tappable into a full-width strip.

Measured rather than assumed: with the collapsed thumbnail in place, **`SET TARGETS` is now fully
visible above the action row**, which it was not in the screenshot that prompted the entry. The
expand exists for a proper look; the movement is legible without it, which is what the owner asked
for.

## What else ships

- `components/workout/exercise-media-panel.tsx` — memoised, taking the name and fetching its own
  media, so the one prop is a scalar no call site can destabilise and the media arriving re-renders
  this and nothing else.
- The warm-up screen's dumbbell fallback, for the bodyweight and unmatched exercises the route
  answers with two nulls. A defined state, not a gap where the layout expects a picture.
- `aria-expanded` on the toggle, and a 64 px target — over the 48 dp floor.
- **The stats sheet's skeleton stopped waiting on a picture.** Its history and gif shared one
  `Promise.all().finally(setLoading(false))`, so a seeded history — which is meant to paint on the
  first frame — still sat behind the media. The skeleton and the error line both name the history;
  now so does the flag. A media failure still raises the same error state, via `onError`.

## Two guard tests, both mutation-checked

Neither hook is testable as React here (both vitest projects are `environment: 'node'`, no
`@testing-library/react`), so the tests guard where this defect class actually lives: **a fifth
fetch copy re-appearing**, and **a `<Image>` losing `unoptimized`**. Removing `unoptimized` from the
panel fails the second; adding a bare `fetch('/api/exercise-gif…')` fails the first; both pass on
the real tree.

## Verification, and the substitution it required

`tsc` clean · ESLint clean (three warnings in these files are pre-existing, confirmed against a
stashed tree) · `pnpm check:rules` **Ran 63 of 63** · 74/74 across `components/workout`, `lib/hooks`
and `components/config`.

Driven in a browser at 412 dp: a real workout from Start Workout through the warm-up to exercise 1's
ready screen and on to exercise 2's, asserting `naturalWidth > 0` rather than the `src` attribute —
**a src is not a picture** — and that exercise 2's clip is not exercise 1's, which is the mis-keyed
fetch the entry warns about.

**That needed a substituted image, and the reason matters.** The dataset's clips live on
`raw.githubusercontent.com`, which this sandbox's egress proxy drops — so every clip renders as a
blank white box here, **including the warm-up screen's own long-standing thumbnails**, which this
change does not touch. The blankness is the environment, not the code; it was confirmed by seeing the
untouched screen fail identically, and CSP was ruled out (the host is in both `img-src` and
`connect-src`). The local `exercise_gif_cache` rows were pointed at same-origin SVGs for the run and
restored afterwards.

## Not exercised

- **The device, and the one thing that matters most on it: whether the clip MOVES.** `unoptimized`
  is what decides that, a guard test holds the prop, and a passing prop is not a moving picture — a
  screenshot cannot tell them apart either. Nothing animated was rendered at any point in this work.
- **Offline playback.** The warm-up prefetch is unchanged, but the service-worker path was never
  exercised; the sandbox could not fetch the binaries in the first place.
- Samsung WebView rendering, and the real dataset's aspect ratios in the 64 px `object-cover` box
  and the 208 px `object-contain` strip.
