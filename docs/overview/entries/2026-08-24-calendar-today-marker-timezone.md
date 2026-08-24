# The Training Calendar's today marker now uses the user's timezone, not the device's (Q-477, slice 1)

**Branch:** `fix/client-today-uses-user-timezone` · **Lane B** · v1.360.0

## What was wrong

`calendar-widget.tsx` computed `todayStr` via `localDateString()` — the device's own timezone —
while every server route computes "today" from the user's `timezone` setting. While a user stays on
`Australia/Brisbane` (the default, and the only value in production today) the two agree and
nothing looks broken. The moment someone taps Profile's "Auto-detect timezone" button, the server
moves immediately and the client doesn't: the Training Calendar starts highlighting the wrong day.
Measured directly by the review that filed Q-477: a user set to `Pacific/Kiritimati` (UTC+14) had
the calendar highlight the 18th on their own 19th.

This is the first slice of a much larger sweep — Q-477's own ratchet
(`scripts/check-client-today-timezone.js`) found 78 bare `todayInTz()`/`localDateString()` calls
across 38 client files. The entry's own ordering is calendar today-marker first (the one with a live
symptom already measured), then write paths, then display — this PR is only the first item.

## What shipped

`calendar-widget.tsx` reads the user's timezone via `useUserTimezone()` (a context already available
anywhere in the tree, fed from the root layout's `auth()` call) and computes `todayStr` with
`todayInTz(tz)` instead of `localDateString()`. Nothing else in the component changed — the initial
view month/year still comes from `new Date()`, which is a separate (and much less severe) instance
of the same class not in scope for this slice.

## Verification

- `pnpm tsc --noEmit` / `eslint` — clean.
- `node scripts/check-client-today-timezone.js` — ratchet dropped from 78 calls/38 files to
  **76/37**; lowered `check-client-today-timezone.js`'s own baseline in the same commit (the
  `components/calendar-widget.tsx: 1` entry is removed, matching "a file not listed must have
  zero").
- **Reproduced the entry's own measurement live**, not just read the code: set the seeded test
  user's `timezone` to `Pacific/Midway` (UTC−11) directly in the local dev Postgres, re-logged in
  through the real sign-in form so the JWT picked up the new value, and opened Health → Training.
  This container's clock reads UTC, and at the time of the check Midway's local date was one full
  calendar day behind UTC's — exactly the divergent case needed. The calendar bolded the *previous*
  day (the user's actual today under `Pacific/Midway`), not the container's UTC day. Screenshotted;
  reverted the test user's timezone back to `Australia/Brisbane` before finishing.
- `pnpm check:rules` — Ran 55 of 55.

## Not exercised

The other 37 files / 76 remaining call sites in the sweep — deliberately left for follow-up PRs in
the entry's own stated order (write paths, then display). Not verified on the APK, where
`localDateString()`-style device-zone reads (the 9 sites the entry separately measured) follow the
*phone's* timezone, which this harness cannot reproduce. Not checked against production, where
every real user is currently on `Australia/Brisbane` and the symptom does not arise yet.
