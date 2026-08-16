# 2026-08-06 — Make the Today's Timeline meal card tappable → nutrition log

**Domain:** app-shell — v1.266.9, JS-only (no APK rebuild)

## The report

Q-93 (owner UI-bug batch): make "Today's Timeline" cards tappable — nutrition card to the food
log, "Woke up" card to the sleep/hypnogram detail, workout card to the HR chart + exercise
details for that session.

## Scoping down before implementing

The plan claimed the sleep-card wiring was "straightforward... once ids/dates [are] threaded
through" alongside the meal card. That didn't hold up: `SleepContent` (`/health/sleep`) has no
date-selection UI at all — it always renders the latest night. Wiring a "yesterday" timeline tap
to it today would silently show the wrong night, which is worse than leaving the card
non-interactive. The workout card was already flagged in the plan as needing a historical
per-session HR-chart + exercise-detail screen that doesn't exist yet.

Shipped only the piece with a real, unambiguous destination: the meal card. Filed the rest as
`docs/implementation-backlog.md` Q-93-followup with the concrete screen work each half needs.

## The fix

- `app/api/day-timeline/route.ts`: added `date?: string` to `TimelineEvent`, populated from the
  same `today`/`yesterday` resolution already used for the `day` field — a tappable card can jump
  to that date without re-deriving it from `timeMs` client-side.
- `app/nutrition/nutrition-content.tsx`: added a `useEffect` reading `?date=` from the URL,
  validating `YYYY-MM-DD` format and clamping to `<= todayStr` (untrusted URL input), then calling
  the existing `setSelectedDate`.
- `components/home-day-timeline.tsx` and `app/health/timeline/page.tsx` (sibling-surface sweep —
  two independent timeline renderers share the `TimelineEvent` type): both `EventRow`/
  `TimelineItem` now compute a conditional tap handler, only for `type === "meal" && date`,
  navigating to `/nutrition?date=${date}` via `useTransitionRouter`. Wakeup/sleep and workout rows
  render exactly as before — no `role="button"` attributes, no cursor/opacity affordance — since
  they have nothing real to navigate to yet.

## Verification

Typecheck and lint clean on all four touched files (the pre-existing `voice-log-button.tsx`
missing-module error and the three lint warnings on these files are all confirmed pre-existing via
`git stash` diff, not introduced by this change). Full suite: 401 files / 3,175 tests green
(`DATABASE_URL` needed to be exported manually this session — the usual `session-start.sh` env
export wasn't present in this shell).

Ran `pnpm dev` against the local DB and exercised the real path end-to-end: seeded a food log for
today, confirmed `GET /api/day-timeline` returns `"date": "2026-08-06"` on the meal event, then
used a headless Playwright check (session cookie copied from a curl login) to load
`/health/timeline`, click the "Test Meal" card, and confirm the browser navigated to
`/nutrition?date=2026-08-06` and rendered that day's food diary. Also verified the reverse
direction — loading `/nutrition?date=2026-08-01` directly renders "Sat, 1 Aug" from the URL param.
Test rows were cleaned up from the local DB after.

**Not exercised:** the home-screen (`components/home-day-timeline.tsx`) tap path specifically —
verified by code review only (identical `onTap` logic to the `/health/timeline` copy that was
interactively tested) since exercising it requires the full home-screen data flow. No on-device
confirmation of tap-target sizing/feedback on the S25 — this project has no
component-test/Playwright infra wired into CI, so this was a manual one-off check, not a
regression guard.
