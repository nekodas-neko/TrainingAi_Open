# 2026-08-27 — `feat/day-review-one-door` (Q-112a) — one evening flow, one door

**Lane B · v1.393.0 · one entry shipped (Q-112a), two filed (LB-23, LB-24).** Every file is
`app/**`, `components/**` or `lib/**` outside storage — Lane B throughout, no engine half.

The day review had two entrances. Home's "Your day in review is ready" banner opened
`components/day-review-sheet.tsx`, a thinner sheet that only Home had; Nutrition's End of Day button
opened `EndOfDayReview`, the real one. **Both local reminders' `extra.route` was `'/'`** — tapping
either notification put you on Home and left you to notice a banner.

Everything now reaches `/nutrition?review=day`, and the weekly one reaches `/?review=week`.

## The plan hosted the review on Home, and that was wrong

§4 of [`2026-08-25-unified-day-review.md`](../../superpowers/plans/2026-08-25-unified-day-review.md)
says the reminders deep-link to `/?review=day` and *"Home opens the matching surface from the query
param"*. Reading `EndOfDayReview`'s props settles it against the plan: it needs `mealTypes`, the
day's `logs`, `targets` and an `onLogged` callback — all Nutrition's state, none of it Home's.
Hosting it on Home meant duplicating three fetches onto a screen that has none of them, to render a
component Nutrition already renders correctly.

**So the door moved instead of the review.** Home's banner navigates (`navigateToTab(router,
"/nutrition?review=day")`) and the evening reminder points at the same URL. The weekly recap *does*
live on Home, so `/?review=week` stays — `WeeklyRecapBanner` gained a `forceOpen` prop that opens it
expanded.

`forceOpen` deliberately overrides `dismissed`: tapping the notification is a clearer request to see
the recap than an earlier dismissal was a request never to. It cannot override `error` or an empty
recap, because there would be nothing to show.

## The digest came across with the error state it never had

`day-review-sheet.tsx` was the only consumer of `/api/daily-digest`, and its fetch had a
`.finally()` and **no `.catch()`** — a rejected request left `digest` null and the card silently
absent, which is Q-499's class exactly. `day-digest-card.tsx` adds the `.catch()`, treats `!res.ok`
as a failure rather than a null digest, and renders *"Couldn't write today's summary."* instead of
vanishing.

It is placed **above** `DaySummaryCard` — the narrative opener sits above the numbers it is talking
about, and Q-112b puts the read-through in that same position, so it is where that entry wants it
rather than somewhere b would have to move it from.

## The older deep link still works, and that is the point of the third test

Notifications already scheduled on the phone carry the old params. Changing
`lib/day-review-reminders.ts` only affects notifications written from here on, so
`nutrition-content.tsx` accepts `?review=day` **and** the pre-existing `?chat=backfill` from
`lib/meal-reminders.ts`. Dropping the latter would have stranded every pending meal reminder.

`chatOpen` → `reviewOpen` while there: it opened the review, not a chat, and the name was a leftover
that would have misled the next reader.

## Two tests, because the failure modes are different

`lib/__tests__/reminder-deep-links.test.ts` (7 tests) is a **cross-file agreement** check: for each
of the three routes it asserts the scheduler writes it *and* that the screen named as its reader
parses that exact param, plus that no scheduler still writes a bare `route: '/'`. This is the class
a unit test cannot catch — both halves are individually correct and disagree with each other, and
the only symptom is a notification that opens the wrong screen on a phone.

`e2e/day-review-one-door.spec.ts` (4 tests) drives the URLs. One is the inverse: `/nutrition` with
no param must open no dialog, because a param check that matched anything would open the review on
every visit. The fourth is the tab-shell case below.

**The spec matches on `getByRole('dialog')`, not the heading.** The review carries two nodes reading
"End of Day" — Radix's `sr-only` `SheetTitle` and the visible `<h2>` — so a heading query is a
strict-mode violation. That duplication is real and is filed as **LB-23** (three sheets do it;
`quick-edit-log-sheet.tsx` is the one that does not), not fixed here.

## The deep link crosses a shell that does not use the router, and `forceOpen` had a hole

Two things about `/?review=week` needed checking rather than assuming, and one of them was a bug.

**Does the param survive the tab shell?** Home's banner calls `navigateToTab`, which the tab shell
intercepts: it flips the tab and writes the URL with `window.history.replaceState`
(`tab-shell.tsx:78`) — the raw History API, not the Next router. That is normally invisible to
`useSearchParams()`. It works because **Next 15 patches `replaceState`** to reflect external history
changes in the router (`next/dist/client/components/app-router.js`, *"Patch replaceState to ensure
external changes to the history are reflected in the Next.js Router"*). Read in the source, then
driven: the fourth E2E test replaces the URL on an already-mounted Nutrition tab and the review
opens. Every other spec for this shape uses `page.goto`, a full document load, which cannot tell a
working patch from a broken one.

**Writing that test found the trap it now documents.** The first draft drove Health's `?tab=body`
instead — same mechanism, not hour-gated, and it passed. Then renaming the `searchParams.get` inside
Health's effect **left it passing**, because Health also reads the param in a `useState` lazy
initializer and that was quietly doing the work. The tab shell keeps a tab mounted once activated, so
the initializer is exactly what does *not* re-run on the second visit — and Nutrition's review has no
initializer at all. Aimed at the real feature, the discriminating mutation lands: changing the effect
deps from `[searchParams]` to `[]` fails that one test and leaves the other three green.

**`forceOpen` only reached `expanded` through a `useState` initializer, which never re-runs.** Home
is statically imported and the tab shell never unmounts it, so a notification tapped while the app is
open re-renders `WeeklyRecapBanner` with `forceOpen` true against an `expanded` that was initialised
false — the banner would have appeared **collapsed**, which is the state the user already had before
tapping. The effect sets it now. The `dismissed` half was already correct, because it lives in that
effect and `forceOpen` is in its deps; it is the half that goes through `useState` that failed, which
is the same shape as Q-402 one layer up.

There is no React Testing Library in this repo, so that fix is guarded by the comment beside it
rather than by a test.

## Deleting the sheet orphaned three things, and only one of them is wrong to keep

`day-review-sheet.tsx` also drew an HR day chart and a workout-load comparison chart.

- `HrDayChart` has three surviving renderers (`/health/heart-rate`, `home-card-widget.tsx`,
  `hr-day-card.tsx`), so that deletion cost no surface.
- `workout-load-comparison-chart.tsx` now has **zero** call sites, and `/api/workout-load-history`
  **zero** client callers. `invalidateWorkoutSummaries()` still prefix-clears
  `workout-load-history:`, now inert.

Kept rather than swept, and filed as **LB-24**: Q-112c's plan names `/api/workout-load-history` as
one of the series it reuses for the 7-day window, so deleting it now is work Q-112c would undo. The
entry sets the decision point — if Q-112d has not re-homed the chart, delete all three together.

## Paying for the two lines

`session-select-content.tsx` sits on a 1458-line ratchet and the change landed at 1460 — despite
*removing* a feature, because two explanatory comments cost more than the dynamic import, the
`useState` and the render they replaced. Both comments were compressed rather than the baseline
raised: the reasoning lives here and in the spec header, and raising a hotspot's number while
deleting one of its features would have been the wrong record.

## Not exercised

- **Not device-verified.** `extra.route` only does anything on Android — `scheduleEveningReminder`
  returns early off `Capacitor.isNativePlatform()`, so the sandbox cannot reach the line that
  changed. Whether the tap lands on `/nutrition?review=day` is unverified on the phone.
- `WeeklyRecapBanner`'s `forceOpen` path was not driven in Playwright: rendering it needs a
  `/api/weekly-digest` response, which is an AI call. Nor was **Home's day-review banner**, which
  only renders after 17:00 local (`session-select-content.tsx:354`) — a spec written now would
  pass this evening and fail every morning, which is the hour-dependence class `CLAUDE.md`
  warns about. The mechanism under both is covered indirectly by the shipped `/health?tab=body`
  tile, which takes the identical `navigateToTab` → `replaceState` → `useSearchParams` path.
- Safe-area: no anchored control moved. The review's footer is unchanged.
- **One local E2E failure, not this branch's.** `goal-invalidation.spec.ts` failed locally in both
  full runs — 94 passed, 1 failed — and it is the aged-fixture class `CLAUDE.md` documents. That
  spec's own header records the dependency: the seed inserts `body_metrics` for `current_date - d`,
  so **today** must carry a steps value or the row it asserts on never renders. `SELECT max(date)
  FROM body_metrics WHERE steps IS NOT NULL` returns **2026-08-25** against a `current_date` of
  2026-08-27, because the seed dates everything relative to the day it ran and nothing back-fills.
  CI provisions a fresh database per run, which is why it is green there. Nothing in this diff is
  reachable from that spec — it drives `/more` → goals → `/health?tab=progress`.
