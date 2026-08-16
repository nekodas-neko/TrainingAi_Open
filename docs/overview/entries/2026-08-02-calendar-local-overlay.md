# 2026-08-02 — the training calendar now shows unsynced local days (Q-41 finding 1)

_Branch `fix/calendar-local-first` · PR #1009 · v1.250.11 · domain `activity`_

The last open finding from Q-41 (activity payload hardening, #1001). Findings 2–4 shipped in
v1.250.4; this one was held on an owner decision.

## What was wrong

`getCalendarData` (`lib/data/postgres/adapter.ts:1034`) reads `workout_sessions` and `activity_logs`
from Postgres, so anything saved on the device but not yet pushed is simply absent from the training
calendar. On an offline-first app whose local SQLite is the source of truth, that is backwards: the
row exists, the user logged it, and the calendar says the day was empty.

## The decision, and why the middle path settles it

The owner's answer contained both readings: *"go with your recommendation"* — which had been *leave
it server-only and record a second sanctioned aggregate exception* — and *"the calendar should read
the local database first anyway"*, which is the opposite. Run 1 recorded the contradiction and
flagged it for re-confirmation before building.

The shape that satisfies both, and which the backlog entry itself proposed costing first: **merge
only unsynced local rows on top of the server payload**, rather than assembling the calendar
client-side. That is not a re-implementation of `getCalendarData` — the duplication the
`home-day-timeline` exception (session 287, R3 SYNC-R3) exists to avoid — so no second aggregate
exception is created, *and* the device's own rows show immediately. Built on that basis rather than
waiting.

## What shipped

`lib/calendar/local-overlay.ts`:

- `mergeCalendarOverlay(server, overlay)` — pure, additive, non-mutating. A day the server already
  knows about keeps its entries and gains only names it was missing.
- `readLocalCalendarOverlay(userId, year, month, tz)` — reads the local store for one month and
  returns only `sync_status = 'pending'` rows. Anything synced is in the server payload by
  definition, and restricting to pending is what bounds the per-workout `getExerciseLogs` lookup to
  the handful of rows actually waiting rather than making it an N+1 over the month.

`CalendarWidget` gains an optional `userId` prop, reads the overlay in its own effect, and merges at
render. Both live call sites (`overview-screen.tsx`, `health-sections.tsx`) already had `userId` to
hand. Without the prop the calendar is server-only exactly as before, which is also what happens on
web — `getLocalStore` returns null there.

Two details worth not re-deriving:

- **The workout day key goes through `formatInTimeZone`, not a string slice.** `activity_logs.date`
  is already a plain local `YYYY-MM-DD` (the server treats it the same way), but
  `workout_sessions.started_at` is a UTC instant, so slicing its first ten characters would put an
  evening session on the wrong day. The SQL cutoff is widened by a day for the same reason and the
  local key decides what is actually in range.
- **The overlay matches the server's "trained" rule** — a session counts only with at least one
  logged exercise — so an abandoned in-progress session does not paint a dot.

A local-store read failure returns whatever was collected rather than throwing: the server payload
must still render.

## Verification

Six unit tests on the pure merge: adds an unknown day, adds to a known day without losing its
entries, does not duplicate, never mutates the server payload, works with the payload still in
flight, and is a no-op with an empty overlay (the pre-existing behaviour).

On the dev server at 412 px: the calendar renders identically to before, and stepping back to July
still paints its session dots through the merged path.

## Not exercised

**The overlay itself has never produced a row.** `getLocalStore` returns null in the web sandbox, so
every sandbox run takes the empty-overlay path — what the dev server proves is the absence of a
regression, not the presence of the feature. A device check is on the owner checklist: save an
activity with the phone in airplane mode and confirm it appears on the calendar before sync.

**The session-select streak strip was deliberately left alone.** It has the same blind spot but
builds from cache seeds plus a separate `streak-data` payload; reasoning and scope are on the Q-41
backlog entry rather than left implicit.
