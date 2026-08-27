# 2026-08-27 — `feat/day-review-one-door` (Q-112a) — one evening flow, one door

**Lane B · v1.391.0 · one entry shipped (Q-112a), two filed (LB-23, LB-24).** Every file is
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

`e2e/day-review-one-door.spec.ts` (3 tests) drives the URLs. The third is the inverse: `/nutrition`
with no param must open no dialog, because a param check that matched anything would open the review
on every visit.

**The spec matches on `getByRole('dialog')`, not the heading.** The review carries two nodes reading
"End of Day" — Radix's `sr-only` `SheetTitle` and the visible `<h2>` — so a heading query is a
strict-mode violation. That duplication is real and is filed as **LB-23** (three sheets do it;
`quick-edit-log-sheet.tsx` is the one that does not), not fixed here.

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
- `WeeklyRecapBanner`'s `forceOpen` path is unit-tested only through the route-agreement test; the
  expanded-on-arrival rendering was not driven in Playwright (it needs a `/api/weekly-digest`
  response, which is an AI call).
- Safe-area: no anchored control moved. The review's footer is unchanged.
