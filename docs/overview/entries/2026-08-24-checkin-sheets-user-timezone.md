# The four check-in / log sheets write the user's date, not Brisbane's or the phone's (Q-477 slice 2)

**Branch:** `fix/checkin-sheets-user-timezone` · **Lane B** · v1.361.0

## What was wrong

Q-477's sweep order is calendar today-marker → **write paths** → display. Slice 1 (#400) did the
calendar. This is the write paths: the four sheets that stamp a date onto something the user saves.

All four computed "today" without the user's timezone:

| file | before | feeds |
|---|---|---|
| `mood-checkin-sheet.tsx` | `todayInTz()` → Brisbane | local write, outbox mutation, `mood:${date}` cache key |
| `morning-checkin-sheet.tsx` | `todayInTz()` ×2 → Brisbane | the `/api/day-checkin` POST body, local write, outbox |
| `profile/water-log-sheet.tsx` | `todayInTz()` → Brisbane | local-store write only |
| `health/metric-log-sheet.tsx` | `todayInTz()` **and** `localDateString()` | local write; the `/api/body-metadata` POST body |

`metric-log-sheet` is the sharp one: it carried **both** wrong answers in a single function — the
local-store branch used `todayInTz()` (Brisbane) and the web fallback POSTed `localDateString()`
(the *device's* zone). Same save, two different dates, neither the user's.

## What shipped

Each takes `useUserTimezone()` and passes it: `todayInTz(tz)`. `metric-log-sheet`'s web fallback now
sends that same `date` instead of `localDateString()`, so both of its branches agree; the
`localDateString` import is gone from the file. `morning-checkin-sheet`'s init effect gained `tz` in
its dependency array, since `init()` closes over it.

All four dropped to zero bare calls and are **removed from** `check-client-today-timezone.js`'s
baseline (not lowered — removed, since a file not listed must have zero). Ratchet: **76 calls across
37 files → 70 across 33.**

`/api/body-metadata`'s schema regex is `[-/]` on `localDate`, so switching from `localDateString()`'s
`YYYY/MM/DD` to `todayInTz()`'s `YYYY-MM-DD` is accepted — checked before making the change, not
after.

## Verification

Set the seeded user to `Pacific/Kiritimati` (UTC+14) and drove a browser with `timezoneId: 'UTC'`.
That makes three distinguishable answers, which is what the test needs:

```
tz=Pacific/Kiritimati
userDay=2026-08-25      ← correct
brisbaneDay=2026-08-24  ← what todayInTz() gave
deviceDay=2026-08-24    ← what localDateString() gave
```

- **`metric-log-sheet` — proven end-to-end.** POST body: `{"localDate":"2026-08-25","bodyFat":19.5}`.
  Row landed on `2026-08-25`. Before the fix this sent the device's `2026-08-24`.
- **`morning-checkin-sheet` — proven end-to-end.** POST body:
  `{"date":"2026-08-25","phase":"morning",…}`. `day_checkins` row landed on `2026-08-25`.
- `pnpm tsc --noEmit` / `eslint` on all four — clean.
- Full unit suite: **3945 passed, 0 failed.**
- `pnpm check:rules` — **Ran 55 of 55**, all passed (the ratchet re-run reports "baseline held").

Driven through a scratch route that mounts the real sheet components (removed before committing) —
the Health page's own Log buttons sit outside the viewport and Radix marks a lower sheet inert when
two are open, both of which made driving them through the page unreliable rather than informative.

## Not exercised

**`water-log-sheet` and `mood-checkin-sheet` are not proven, and the reason is structural, not
laziness.** `water-log-sheet`'s date feeds *only* the local-store write — `/api/water-log` derives
its own date server-side from the session timezone — and `getLocalStore` returns null in the web
sandbox, so that branch never runs here. Its fix matters on device, where the local row would
otherwise be filed a day off the server's. `mood-checkin-sheet`'s date likewise feeds the local
write and the outbox mutation, **plus the `mood:${date}` cache key** — that last one *is*
web-reachable, but I did not drive it.

Nothing checked on the S25. The remaining sweep is **33 files / 70 calls**; run
`node scripts/check-client-today-timezone.js --print` for the live list rather than hand-counting.
