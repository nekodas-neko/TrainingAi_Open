## 2026-08-08 — `feat/client-session-timezone` — Q-148: the client can finally read the user's timezone

Closes **Q-148**. The item's own framing is the right one: the two remaining device-local render
sites were the symptom, and **the structural gap was the item**. `users.timezone` has always been on
the JWT and reachable in every API route — which is why Q-144 could fix the server-side half
(calendar, streak, Oura workouts) — but **nothing on the client could read it**, so every client-side
`formatTimeOfDay`/`formatDayShort`/`toAestDay` silently fell back to `DEFAULT_TZ`.

### The plumbing

`components/shell/user-timezone-provider.tsx` — a context fed from the root layout's **existing**
`auth()` call, plus a `useUserTimezone()` hook. No extra fetch, and no mounted gate: the value is in
the first server render and matches on hydration. A mounted-gated read would produce a wrong first
frame, which is the bug class this removes, not one to add.

### The call sites

Both files the entry named:

- `chat.tsx` — `new Date(chat.lastActivity).toLocaleDateString()`, with no locale *or* zone. Now
  `formatDayShort(toAestDay(…, userTz))`. The rendered format changes (`8/8/2026` → `Aug 8`), which
  matches how the rest of the app writes dates.
- `more/stats-grid.tsx` — `formatInTimeZone(…, userTz, 'MMM yy')`.

**And the sweep the entry asked for**, which the CI check cannot see: six `formatTimeOfDay(...)`
calls with no tz argument — `scale-pairing`, `sleep-card`, `hypnogram`, `health-metric-sheet` ×2 and
`exercise-review-sheet` ×2. Two of those (`hypnogram`, `health-metric-sheet`) are module-scope
helpers that cannot call a hook, so tz is threaded as a parameter from the component.

`exercise-review-sheet` mattered most: Q-123 moved it to `toAestDay`/`msToHHMMInTz`, which **left the
check's scope while still writing `DEFAULT_TZ` into the database**. Its day key and its persisted
`start_time`/`end_time` now use the user's zone.

**Deliberately not changed:** ~8 `toAestDay(cutoff)` calls that compute query windows (30/90-day
lookbacks) from a UTC anchor. Those are boundary math on a multi-week window, not display, and
re-keying them risks cache churn for no user-visible gain.

### `BLOCKED_ON_CLIENT_TZ` is now empty, and the check said so

The ratchet failed the moment both files were fixed — exactly its job. The set is kept (not deleted)
with the reasoning recorded, so a future genuinely-blocked site has somewhere to go rather than
being quietly benign-listed. The comment also now records that **the check's scope is narrower than
the bug**: `toLocale*String` only, so a site moving to the shared formatters without a tz leaves the
check while still being wrong.

### Verification

- `tsc --noEmit` clean · `eslint` 0 errors · full suite green · all nine custom-rule scripts pass.
- **Proved in the browser with three distinct zones**, so no result is ambiguous: user
  `America/New_York` (DB), device `Europe/London` (Playwright), fallback `Australia/Brisbane`
  (`DEFAULT_TZ`). A temporary probe route (deleted before commit) rendered the context value and a
  fixed instant of `2026-08-01T02:00:00Z`:

  ```
  tz=America/New_York  |  day=31 July  |  time=10:00 pm  |  device=Europe/London
  ```

  `31 July` is New York. London and Brisbane would both read `1 August`, so this rules out **both**
  device-local and the `DEFAULT_TZ` fallback. The local DB's timezone and `created_at` were mutated
  for this and **restored afterwards**.

### Not exercised

No device run — no native, safe-area, gesture or notification path.

**The converted call sites were not each rendered.** The probe proves the provider delivers the right
value and that the formatters honour it; the individual screens (chat history list, "Member since",
sleep card, hypnogram, scale pairing, metric sheet) were not opened with data in them. Two are known
hard to reach in the sandbox: `stats-grid`'s "Member since" only renders when no program exists (the
tenure branch wins with the seed), and the review sheet needs a detected walk.

**No back-fill of already-stored values.** `activity_logs.start_time`/`end_time` rows written before
this hold `DEFAULT_TZ` clock strings. For the owner that is the same value, so nothing is wrong today
— but a user in another zone would have pre-existing rows in Brisbane time and new ones in theirs.
