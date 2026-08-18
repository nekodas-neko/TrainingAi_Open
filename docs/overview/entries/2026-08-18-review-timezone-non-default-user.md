# 2026-08-18 — Review: the app run as a user who is not in Brisbane

**Agent:** Review 📖 · **Branch:** `claude/review-timezone-boundaries` · **Docs-only.**
**Filed:** Q-477, Q-478 · **Review:** [`docs/reviews/2026-08-18-timezone-non-default-user.md`](../../reviews/2026-08-18-timezone-non-default-user.md)

## What this sweep was for

`CLAUDE.md`'s Timezone and Date Arithmetic sections are two of its longest rule blocks, and the file
names the reason the class keeps escaping review: *"it hid for months because it is invisible while
the device sits in the zone the data was recorded in."* All 30 user rows in the local database are
`Australia/Brisbane`, and ten sweeps had never moved a user out of the default zone. This one set a
user to `Pacific/Kiritimati` (UTC+14), logged in fresh so the JWT carried it, and drove the app —
at a moment when three calendar dates were simultaneously live (Midway 08-17, UTC/Brisbane 08-18,
Kiritimati 08-19), so a wrong "today" shows up as a wrong *date*, not a subtle hour.

## The server is clean; the client is not

`app/api/**` contains **zero** argument-less `todayInTz()` calls — 53 `todayInTz(tz)`, 4 taken from
the session, 4 `formatInTimeZone(..., tz, ...)`. Live: `POST /api/day-checkin` returned
`logDate: 2026-08-19` and `GET /api/workout-data` returned `dataDate: 2026-08-19`. Both correct.

On the client, 125 call sites resolve "today" three different ways: **25** use the user's zone,
**91** call `todayInTz()` with no argument (→ Brisbane), and **9** call `localDateString()` (→ the
*device's* zone). `CLAUDE.md` warns about two client "today" sources; there are three.

## Q-477 — the setting is what breaks it

While a user is on Brisbane, client and server agree and nothing is wrong. **Setting the timezone
introduces the bug** — the server moves immediately, the 91 client sites do not. And
`edit-profile-sheet.tsx:190` ships an **"Auto-detect timezone"** button, so the intended one-tap
action for anyone outside Brisbane is exactly the action that desynchronises them.

Seen on screen, Health → Training: the Training Calendar highlights **18** and Training Load
highlights **Tue**, on a day that was Wednesday the 19th for that user.

Nothing is missing except the argument — `useUserTimezone()` is a tree-wide context and
`goals-section.tsx:114` already uses it correctly.

## Q-478 — the sharp, cheap half

`isWorkoutDataToday` and `isBodyMetadataFresh` compare a **server-stamped** date against a **client
`DEFAULT_TZ`** date, so they return false for |Δoffset| hours a day — 14 hours a day for a New York
user. Confirmed false against a live response with a real row planted on the user's true today.

The consequences are real UI states: session-select's early return leaves `setMetaLoading(false)`
unrun so the loading state never clears; Health's today values are never set; the workout screen
strips `loggedTodayInSession` from every exercise; the "Trained today" badge never appears.

The clearest illustration is two adjacent lines in `getLastTrainedLabel(session, tz)` — line 32 uses
the `tz` the function was given, line 31 cannot, because the helper has no parameter for it.

## Severity, stated honestly

**Latent for the current user base, structural for the stated direction.** No user has a non-Brisbane
zone today, so nothing is broken in production. It is filed above "someday" because the app ships the
button that triggers it, `projectOverview.md`'s 2026-08-02 amendment says not to assume the owner's
own device, and a Play Store listing is the stated intent. Recommended first step is a **CI ratchet**
freezing the count at 100, not a heroic sweep.

## Clean results

Every API route threads the user's timezone. `cachedFetchToday`/`unwrapToday` are self-consistent
(client-written, client-read) — mislabelled rather than broken, and deliberately not filed as the
same defect.

## Method notes

- **Changing `users.timezone` is not enough** — the zone is stamped into the JWT at login, so a fresh
  sign-in is required before any route sees it. A stale cookie makes the whole test silently pass.
- **Run it when the zones disagree.** Check `TZ=<zone> date +%F` against
  `TZ=Australia/Brisbane date +%F` first; with an offset that only shifts the hour, every symptom
  above disappears.
- The container needed `pnpm install` after pulling `main` before `pnpm dev` would build (`qrcode`
  was newly added and absent from the stale `node_modules`) — the Turbopack error names the missing
  module and looks like a repo break, but is not.
