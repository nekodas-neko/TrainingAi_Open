# 2026-08-07 — Home "Recommended Today" card stops freezing on "Last: —"

**Domain:** workouts — v1.267.15, JS-only (no APK rebuild)

## The report

Q-106 (owner UI-bug batch): the home "Recommended Today" card (Legs) showed "Last: —" despite a
62-day streak and other sessions already showing completed the same week.

## Root cause — the third site of a known bug class

Same bug family as Q-89 and Q-91: `RecommendationCard` is wrapped in `memo()`, and its
`lastSessionDay()` helper does a raw `readCacheSync('workout-card:<id>')` read directly inside
render. `session-select-content.tsx`'s `workout-data:all` batch fetch seeds every session's
`workout-card:<id>` cache entry via `setCached` — a side effect outside React state. `memo()`
compares props, not cache contents, so a card whose first render lands before the batch resolves
reads an empty/missing cache entry, gets `"—"`, and then never re-renders to pick up the correct
value once the batch actually populates it — none of `RecommendationCard`'s props changed.

The backlog entry also flagged an independent code smell in the same function: `lastSessionDay()`
looked its session up by **name** against `activeSessions` even though the caller (`displaySession`)
already held the full session object with a real `id` — the "session identity = DB id, not name"
anti-pattern the Standing Instructions call out, and needless indirection regardless of the memo fix.

## The fix

Same shape as the Q-89 fix in `workout-select-content.tsx` (the reference pattern, called out
directly in its own code comment):

- `session-select-content.tsx`: new `workoutCardEpoch` state, bumped inside the `workout-data:all`
  batch's `onData` callback (the same place that calls `setCached` for each `workout-card:<id>`),
  passed as a new prop to `RecommendationCard`.
- `recommendation-card.tsx`: `lastSessionDay()` now takes `sessionId: string` directly instead of
  `(session: string, sessions: ProgramSession[])` with an internal by-name `.find()` — the second,
  independent fix. The inline call at the JSX site is replaced with a `useMemo` keyed on
  `[displaySession?.id, aestDateString, workoutCardEpoch]`, with an `eslint-disable-next-line
  react-hooks/exhaustive-deps` on the deps line (the epoch is a proxy for "the cache changed",
  which the linter can't infer) — matching the Q-89 site's own established pattern exactly.

## Verification

`tsc --noEmit -p .` clean (only the pre-existing unrelated `voice-log-button.tsx` error). `eslint`
on both touched files matches the pre-existing baseline exactly (confirmed via `git stash` diff —
6 warnings before, 6 after, none new). Full suite: 404 files / 3192 tests green.

Verified the actual race live against `pnpm dev`, in a fresh browser context with no persisted
cache (to force the same cold-cache race the bug depends on): the local seed's "Recommended Today"
card only renders once today's mood is logged (a separate, unrelated gate), so a mood log had to be
seeded directly into the local dev DB to reach the card at all. With that in place, a fresh page
load showed **"Last: —" at t+1s**, then **correctly updated to "Last: Sun" by t+2s** and stayed
correct through t+5s — reproducing the exact reported symptom and confirming the fix closes the
race rather than merely making it less likely. Screenshotted before/after. Removed the seeded mood
log afterward so the local dev seed is unchanged going forward.

**Not exercised:** no on-device S25 verification — pure client-side memo/render fix, no
native/safe-area/gesture involvement.

## Note for future work on this pattern

This is the third independent site of the identical bug (Q-89, Q-91, Q-106). Added a gotcha to
`docs/domains/workouts/README.md` describing the shape of the bug and its fix so a fourth site gets
caught at review time rather than another owner report.
