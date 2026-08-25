# 2026-08-25 — the timeline's workout card had a destination for seventeen days (Q-93-followup)

**Branch:** `feat/timeline-workout-day-detail` · **Lane B** · `components/home-day-timeline.tsx` +
one new e2e spec. JS-only — no APK needed. **v1.371.0.**

## What the entry was waiting on had already arrived

Q-93-followup was filed on 2026-08-06 with the workout card left unwired because *"no historical
per-session HR-chart + exercise-detail screen exists at all"*. A correction two days later pointed
at Q-110's mockups as the destination. **Q-110 shipped on 2026-08-08** as `/health/day`: its
Training section renders every session of a day with its exercises, sets, duration, volume and
kcal, tapping an exercise opens `ExerciseHistorySheet`, and the Activity section opens
`ActivityDetailSheet`. The card has had somewhere to land ever since, and nothing tracked the
dependency clearing — the entry kept describing a gap that had closed.

Two more of its premises had also gone stale:

- It says the wiring must be applied to **both timeline renderers**,
  `components/home-day-timeline.tsx` and `app/health/timeline/page.tsx`. The second file no longer
  exists. There is one renderer, mounted from `app/session-select/session-select-content.tsx`.
- The wiring reads `ev.date`, which the pushed workout event never sets. It is not missing:
  `app/api/day-timeline/route.ts:302` stamps `date` on **every** event centrally, after the type
  branches. So this needed no `app/api/**` change and stayed inside Lane B.

## What shipped

`workout` and `walk` cards navigate to `/health/day?date=<the event's own date>`. That covers five
of the seven card types; `bedtime` and `tag` stay inert on purpose, because a projected bedtime and
a ring tag have no detail view to reach and a destination that only repeated the card would be
worse than none.

The timeline is now a `<section aria-labelledby>` rather than a bare `div`. That is not decoration:
a workout card's title is its session name, and Home renders the same string as a session chip
further up the page, so a locator that knows only the text matches both. Naming the region makes
the timeline addressable instead of positional.

## Verified

- **`e2e/timeline-card-navigation.spec.ts`**, and it was proved to fail: with the two-line wiring
  reverted the spec goes red (`element(s) not found`), and green with it. The assertion is the
  destination URL plus the session name rendering on the screen it lands on — a row wired to
  nothing renders identically to a wired one, same card, same `role="button"`, same press feedback,
  which is exactly how this one stayed dead in plain sight. The fixture is anchored to **midday**
  on the user-local day read back from Postgres, because `/api/day-timeline` covers today and
  yesterday only and midnight is where an off-by-one stops being visible.
- **The walk branch was exercised too**, not inferred from sharing a line: an activity log inserted
  for today, tapped in a browser, landed on `/health/day?date=2026-08-25`.
- `tsc --noEmit` clean · `next lint` on the touched file clean (a dead `MapPin` import went with it)
  · `pnpm check:rules` **Ran 56 of 56** · `lib/__tests__/cache-groups.test.ts` 24/24 ·
  `tabs-instant-paint`, `health-tabs-instant-paint`, `home-card-invalidation-refetch` and
  `day-detail-sheets` all green against the changed DOM.

## Not exercised

**No device verification.** This is a navigation change on the canonical runtime's Home screen and
the destination is a navless full-screen route with a bottom-anchored back control — the shape that
has regressed repeatedly. The web harness renders safe-area insets as 0. Recorded as a `Gate: device`
row rather than claimed.

The web build also takes every offline-first fallback, so nothing here says anything about the APK's
local-store path. `/health/day` was already reachable from the calendar, so its own rendering is not
new ground; what is new is arriving there from Home.
