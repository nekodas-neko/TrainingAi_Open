# 2026-08-05 — A full-width "Completed Today" banner on the Workout tab card

**Domain:** workouts — v1.266.8, JS-only (no APK rebuild)

## The report

Owner, following up now that Q-89 fixed the card actually updating promptly: the "already done"
indication itself isn't visible enough — a faint green ring on the whole card, a 12px checkmark +
"Trained today" text sized the same as every other secondary metadata line, and a softened button
style. Wants something large and unmistakable.

## The fix

Replaced the small inline icon+text line (previously squeezed in among the recommended-session
badge and phase labels) with a dedicated, full-width banner row: a `CheckCircle2` icon at `h-5`
(up from `h-3`) and bold `text-sm` "Completed Today" text (up from `text-xs`), on a tinted green
background (`bg-green-500/15` light / `/20` dark) with a matching border — placed between the
session header and the muscle diagram so it's the first thing visible after the session name, not
squeezed among other small text.

Kept the existing icon+text pairing (never colour-only) and the existing faint card-wide ring as a
secondary cue. The "Start Again" button is unchanged and stays reachable below — this is a
visibility enhancement, not a state that blocks re-starting.

## Verification

Typecheck and lint clean (the one remaining warning — `hasSeeded` unused — is pre-existing and
unrelated). Full suite: 400 files / 3,175 tests green.

**Not exercised:** `WorkoutSelectContent` only renders this state from client-side cache data
(`readCacheSync`/`useLayoutEffect`), so it doesn't appear in raw SSR output — verified by reading
the rendered JSX structure and confirming the new row sits cleanly in the existing `flex flex-col`
layout (the card's muscle diagram already uses `flex-1 min-h-0` and absorbs the extra row's height
without needing a layout change). No on-device confirmation that the banner doesn't clip or
overflow at the S25 viewport — this project has no component-test/Playwright infrastructure to
automate that check, and it wasn't run interactively this session.
