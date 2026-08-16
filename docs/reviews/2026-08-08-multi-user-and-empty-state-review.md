# Lens 12 + empty states — multi-user, driven not read, 2026-08-08

_Domain: `platform`, `app-shell`. Lens 12 and the empty-state half of Step 1 of
[`2026-08-09-deep-review-prompt.md`](2026-08-09-deep-review-prompt.md), after
[Step 0 + 1](2026-08-08-running-app-review.md), [lenses 9 + 11](2026-08-08-claude-md-and-test-suite-review.md)
and [lens 10](2026-08-08-mobile-ui-standards-review.md)._

A second user was **seeded and driven**: `userb@local.dev`, timezone `America/New_York`, no program,
no logs, no ring. Prior reviews reasoned about multi-user behaviour from source; this one logged in
as the second account and used the app.

---

## 1. 🔴 The home header shows the wrong DAY and the wrong greeting — observed

At the moment of the test the clock read:

| zone | time |
|---|---|
| UTC | 2026-08-08 22:52 Saturday |
| Brisbane (`DEFAULT_TZ`) | 2026-08-**09** 08:52 **Sunday** |
| **New York (user B's actual zone)** | **2026-08-08 18:52 Saturday** |

The app showed user B:

- header date **"Sunday 9 August"** — Brisbane's date, **a full day ahead of theirs**
- greeting **"Good morning, User B."** — at **6:52 PM** their time

**Four client render sites hardcode `DEFAULT_TZ`:**

| file:line | what |
|---|---|
| `app/session-select/session-select-content.tsx:94` | `getGreeting()` — `formatInTimeZone(new Date(), DEFAULT_TZ, "H")` |
| `app/session-select/session-select-content.tsx:1064` | header date |
| `components/overview-screen.tsx:308` | header date |
| `components/workout/pre-workout-screen.tsx:126` | `today` |

**The part worth understanding, because it explains why three prior fixes missed it.** Q-148 (#1176)
shipped a `UserTimezoneProvider` earlier the same day — **none of these four sites consumes it**.
And `session-select-content.tsx:99-100` carries a comment defending the hardcode:

> *"the server buckets workout/rest days in AEST regardless of device timezone, so the client must
> key off the same source or the week-strip, morning-checkin… "*

**That was true when written, and Q-144 (#1161) made it false** — `getCalendarData` and
`getRecentTrainedDays` now bucket in the *user's* zone. The client is deliberately matching a server
contract that no longer exists, and the comment reads as a justification to leave it alone. Any fix
that does not also delete that comment invites a fifth recurrence.

This is the **fourth** appearance of the class after Q-73 (home hydration), Q-144 (server calendar)
and Q-148 (client provider). Each earlier fix was correct; none covered these four sites. Filed as
**Q-163**.

## 2. Cross-user isolation — clean, and tested by attack rather than by reading

Seeded distinctive rows owned by user A (`SECRET-A-SESSION`, `SECRET-A-INJURY`, `SECRET-A-PROGRAM`),
then logged in as user B and went after them.

**Reads** — every attempt blocked, no payload leaked:

| probe | result |
|---|---|
| `GET /api/workout-sessions/{A}` | 404 |
| `GET /api/workout-sessions/{A}/energy` | 401 |
| `GET /api/workout-sessions/{A}/hr` | 404 |
| `GET /api/session-explain?sessionId={A}` | 404 |

**Writes** — every attempt blocked, and **user A's rows verified unchanged afterwards**:

| probe | result |
|---|---|
| `PATCH /api/injuries/{A}` | 401 |
| `DELETE /api/injuries/{A}` | 401 |
| `PATCH /api/programs/{A}` | 404 |
| `POST /api/programs/{A}/activate` | 404 |
| `DELETE /api/programs/{A}` | 404 |

Post-check: `SECRET-A-INJURY` still `mild`, not deleted; `SECRET-A-PROGRAM` still named, still
inactive. **Nothing leaked and nothing was mutated.**

This corroborates the 2026-08-07 review's read-based verdict with empirical evidence — worth
recording as a *positive* result, since it is the class where an unverified assumption is most
expensive.

**One inconsistency, low severity:** the same condition (authenticated, not your row) returns **401**
on the injuries routes and **404** on the programs routes. 401 means *unauthenticated*, which the
caller is not. Both prevent the leak, so this is cosmetic — but a 404 is also the better choice for
avoiding an enumeration oracle, and consistency would be worth having. Not filed separately; noted
here.

## 3. Empty states — all clean, and this closes a standing suspicion

Every page was driven as user B: **no program, no logged workouts, no food, no ring, no history.**

`/` · `/health` · `/workout` · `/nutrition` · `/more` · `/overview` · `/activity` · `/chat` ·
`/cardio` · `/workout-select` — **all render, zero `pageerror`, zero non-auth console errors.**

This matters because production's `error_events` carries two unexplained client-crash bursts —
`Cannot read properties of null (reading 'x')` (20 hits) and `.reduce is not a function` (10 hits) —
and "a screen that only ever meets the well-populated seed" was the leading hypothesis. **The
zero-data path is not where those come from.** That does not explain them, but it removes the most
obvious candidate, and it is cheaper to record that than to have the next session re-test it.

## 4. A discovery about onboarding, from getting it wrong

The first empty-state attempt failed: user B logged in successfully, then **every route bounced back
to `/sign-in`**. The cause was not a bug — `users.is_active` defaults to **`false`**
(`information_schema` confirms `column_default: false, is_nullable: NO`), and `middleware.ts:23-26`
redirects any authenticated-but-inactive user to `/pending`.

So the app is **invite-gated by default**: a new account can authenticate but reaches nothing until
someone flips `is_active`. That is deliberate and correct for today's single-owner deployment. It is
worth stating explicitly because the Play Store ambition implies self-service signup, and this is the
gate that would have to change — a `/pending` screen is the entire new-user experience right now.
Not filed as a defect; recorded so the launch checklist inherits it.

## 5. Not covered

The remaining Step 1 items are still undone: adversarial values (0 kg, 999 kg, negative reps,
26-hour sleep, 10,000-calorie entries, emoji/RTL text, 500-character notes), boundary dates
(23:59:59 vs 00:00:01, month-end, leap year), offline behaviour, and rapid double-tap on submit
controls. Those need write flows rather than page loads and were not reached.

No device, no APK, no native SQLite — `getLocalStore` returns null in the web sandbox, so the
offline-first *device* path remains entirely untested here.
