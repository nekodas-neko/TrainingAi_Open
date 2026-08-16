# Home / Workout / Progress UI polish

> Source: user report (2026-07-04, screenshots). Five small, independent UI
> tweaks across Home, workout-select, the pre-workout screen, and Health →
> Progress. All anchors confirmed in-session. One PR. Pairs naturally with the
> other 2026-07-04 polish plans (UI bug fixes, hypnogram, safe-area round 2).

## Task 1 — "Log Activity" button visibility uplift

`app/workout-select/workout-select-content.tsx:382-387`. Today it's a low-contrast
ghost button (`border border-border/50 text-muted-foreground`) below the session
carousel — easy to miss next to the big cyan "Start Workout". Give it real
presence: a filled/tinted secondary style (e.g. `bg-muted`/`secondary` with
`text-foreground`, or a subtle brand-tinted fill) **and a leading icon** (Lucide
`Plus`/`Activity`) so it reads as a tappable action, not a caption. Keep ≥48px
tap height. Don't make it compete with the primary Start Workout CTA — one step
up from ghost, not a second primary.

## Task 2 — Kill the open-delay on the pre-workout screen

User: "clicking a workout card has a small delay when there is no information
found and takes a second to load." The pre-workout / workout screen fetches
`workout-data` on open and shows a loading state until it resolves, even when the
result is empty ("Style not found" / "No previous data",
`pre-workout-screen.tsx:258-277`). Home already prefetches each session's card
data into the `workout-card:${sess.id}` cache
(`session-select-content.tsx:435`, `freshWithinTtl`). Seed the workout screen's
exercise list synchronously from that cache (`readCacheSync('workout-card:<id>')`)
on mount so it paints the exercises instantly and revalidates in the background —
same seed-then-revalidate pattern used across Home/Health. Verify the seed shape
matches what the screen renders; if the prefetch payload lacks a field the screen
needs, extend the prefetch (don't add a blocking fetch). Confirm the empty state
("No previous data") also paints immediately rather than after a spinner.

## Task 3 — Exercise cards: show a representative set + estimated 1RM

`pre-workout-screen.tsx:261-274`. Today the card concatenates **every** set
(`10×40kg | 8×40kg | 8×40kg | 6×40kg`) — noisy and long. Replace it with a single
representative working set plus the estimated 1RM, e.g.:

> **7 × 80kg · est 1RM ~144kg**  · {date}

(exact format/separators to taste — whatever reads cleanest). Fields, all already
on the card's `WorkoutExercise` data — **no threading needed**:
- reps = the average reps across the logged sets (round `lastReps`; this is the
  same average `estimated1rm` is derived from — reuse it, don't recompute per the
  one-formula rule).
- weight = the working-set weight (`lastSetWeights` modal/first value used for the
  bar load), rounded.
- est 1RM = `ex.estimated1rm` (already computed via `lib/1rm.ts` and exposed at
  `workout-data/route.ts:36`; the pre-workout screen already reads it at
  `pre-workout-screen.tsx:121`). Round and prefix `~` to signal it's an estimate.
  Omit the 1RM clause gracefully if `estimated1rm` is null.

Drop the explicit set-count. Keep the "No previous data" fallback. Display-only —
no change to logging or 1RM math.

## Task 4 — Remove the header underline on Home

`components/shell/screen-header.tsx:13` hardcodes `border-b border-border` on
every `ScreenHeader`. The user wants the line under the greeting (above the four
metric tiles) gone on Home. Add an opt-out — a `bordered = true` prop (or accept a
`border-b-0` via the existing `className` merge) — and set it off at the Home call
site (`session-select-content.tsx:932`). Scope the change to Home only unless we
decide to drop the underline app-wide (defensible with the wallpaper direction,
but out of scope here — Home only per the request).

## Task 5 — Strength Trend card formatting (Health → Progress)

`components/health/strength-trend-card.tsx`. User: "the UI in Progress for the
strength trend [is] formatted poorly" — the reported build shows an oversized row
of large empty circles as the exercise pager, eating vertical space and looking
unfinished. **Note:** current `main` already renders the pager as small pill dots
(`strength-trend-card.tsx:107-125`, `h-1.5`), so the big-circle version may be a
**stale APK build** — first verify on latest before doing work. If already fixed,
close this as done-on-main. Otherwise (or for remaining polish): tighten the card
— the pager dots, the `90d low / Peak` row, and the projection line — into a
compact, aligned layout; ensure the sparkline fills the width cleanly and the dots
are unobtrusive.

## Wrap-up

- `pnpm tsc --noEmit && pnpm lint && pnpm test`; `pnpm dev` at the S25 viewport —
  exercise the workout-select Log Activity button, open a session (confirm no
  spinner delay + averaged sets line), Home header (no underline), Health →
  Progress strength card.
- Patch bump + changelog (user-visible). Low-risk display changes, exempt from the
  merge-confirmation gate.
- **Not exercisable in sandbox (declare in PR):** on-device open-latency feel
  (Task 2) and Samsung WebView rendering; the strength-card build discrepancy
  (Task 5) needs checking against what's actually deployed.
