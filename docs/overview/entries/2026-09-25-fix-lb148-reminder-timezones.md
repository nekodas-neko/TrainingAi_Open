# 2026-09-25 — reminders are timed in the user's zone, not Brisbane and not the phone's (LB-148)

**Branch:** `fix/lb148-reminder-timezones` · **Lane:** Implementation B

## What was wrong

The three modules that decide *when a notification fires* — `lib/meal-reminders.ts`,
`lib/supplement-reminders.ts`, `lib/workout-reminders.ts` — used two different wrong clocks, and
used them **in the same function**:

- the "have I already notified today" key came from a bare `todayInTz()`, which defaults to
  Brisbane for every user;
- the scheduled instant came from `new Date(now).setHours(h, m)`, which sets the hour in the
  **device's** zone.

So on any user not in Brisbane the two disagreed with each other: the day rolled at one hour while
the reminder fired at another, and a reminder configured for 08:00 went off at 08:00 wherever the
phone happened to be. Invisible to the owner, whose phone and profile are both Brisbane — which is
why the class survived RV-176, whose sweep scanned `.tsx` and never looked at `lib/*.ts`.

## What shipped

`lib/reminders/local-instant.ts` (new) — `instantAtLocalTime(dateStr, hour, minute, tz)`, a
`fromZonedTime` wrapper that turns a wall-clock time in a named zone into the real instant. It is
the one place that answers "what moment is 08:00 for this user".

`localDayInTz(at, tz)` beside it, because the first cut of this fix had its own version of the same
bug. Every one of these functions takes `now` as a parameter, and I keyed the schedule off
`todayInTz(tz)` — the *real* clock. In production the two coincide, so nothing would have shown;
against a dated fixture they diverge by months, which is how the existing suite caught it. The day
now comes from `now`, so both halves of each function read one clock and one moment.

`tz: string = DEFAULT_TZ` threaded through seven exported functions across the three modules, and
all **8 sites** converted — `todayInTz()` → `todayInTz(tz)`, `setHours(…)` →
`instantAtLocalTime(todayInTz(tz), h, m, tz)`. Both halves of each function now read the same clock.
Callers updated: `components/sync-provider.tsx` (3 calls) and
`app/nutrition/nutrition-content.tsx`.

**Profile timezone, not device timezone** — a structural call, recorded here because it is the one
thing that would be re-litigated. The repo derives the user's zone uniformly from the session, and
the "notified today" key *must* match the app's own day boundary or the suppression logic is wrong
by construction. Where the two philosophies genuinely differ is a travelling user: profile-zone
means his 08:00 reminder follows his home clock. That is one parameter to flip if the owner ever
wants the other behaviour.

## Verification

`lib/reminders/__tests__/lb148-reminders-use-the-users-zone.test.ts` — 8 tests. Two are behavioural
(an 08:00 Brisbane reminder resolves to 22:00 UTC the previous day, and is still upcoming at that
same instant for a New York user); the rest are scanners holding the three modules free of bare
`todayInTz()` and of `setHours`, and holding every caller to passing a zone.

**Control-run against the pre-fix source: 5 of the 8 fail.** The test has teeth, rather than
describing what the code already did.

**The four existing reminder test files were themselves written in the device's zone** and had to be
rewritten — 27 fixture literals across them. A bare `new Date('2026-06-17T09:00:00')` is parsed
device-local, and the expected instants were built the same way, so they agreed with a `setHours`
implementation *because both sides carried the bug*. They are now built with `fromZonedTime` in the
user's zone and asserted with `formatInTimeZone`. Two things fall out of that: they pass identically
under `TZ=America/New_York`, `Europe/London` and `Pacific/Kiritimati` (checked), and **14 of their 40
cases now fail against the pre-fix modules**, where previously none could.

Not exercised: the notifications themselves. `@capacitor/local-notifications` only runs on the APK,
so what is proven here is the *instant handed to the scheduler*, not that Android fires it. No
Known-Issues row is owed — the scheduling arithmetic is the whole of the defect and it is covered —
but a device sitting that happens to cross a day boundary would be the real confirmation.

## Gotcha worth keeping

The caller scan was written as `/reconcileMealReminders\([^)]*\)/` and **falsely reported three
offenders**: `[^)]*` stops at the first `)`, so `reconcileMealReminders(a, b, new Date(), tz)` ends
at `new Date(` and its `tz` is never seen. A regex cannot balance parentheses. Replaced with a
depth-counting `callArgs()` scan, which is the shape any argument-level source check needs.
