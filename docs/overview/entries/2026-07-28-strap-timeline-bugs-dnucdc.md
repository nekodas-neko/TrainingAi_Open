## 2026-07-28 — Bug-fix batch: chest-strap notification/battery, weekly-steps digest bug, premature day-review banner (v1.226.2)

Owner-reported bug-fix session from four screenshots + a follow-up message. Four things reported,
three fixed in code, one root-caused to an already-documented pipeline issue with a self-service
mitigation.

### 1. Chest strap "unreachable" notification firing permanently — fixed
`PolarStrapService.scheduleRetry()` retried forever at a 120s ceiling whenever the H10 couldn't be
reached, keeping the ongoing "Strap unreachable — retrying in 120s" notification up indefinitely.
Unlike the Oura ring (worn continuously), the strap is opportunistic — the ring already covers HR
whenever it's absent (per `chest-strap-pairing.tsx`'s own copy) — so an unreachable strap almost
always just means it isn't being worn, not a real fault worth nagging about all day. Added
`MAX_CONSECUTIVE_FAILURES = 6`: after exhausting the backoff ladder once (~4 min), the service now
calls `stopSelf()`, which clears the notification. JS restarts it on the next app open
(`LiveHrAmbientProvider`'s existing mount-time `startAmbient()`), so the strap resumes trying next
time the app is opened rather than nagging in the background all day.

### 2. Chest strap battery not shown — fixed
The plan doc for the native chest-strap service (`2026-07-19-always-on-chest-strap-hr.md`) had
already flagged this as an explicit follow-up ("surface strap battery % ... so a dying coin cell
is visible") but it was never wired for the native service — only the one-shot pairing-time read
in `chest-strap-pairing.tsx`. Added the standard Battery Service UUIDs to `PolarProtocol`, a GATT
battery read in `PolarGattClient` fired once the HR characteristic subscription confirms (queued
behind the existing op queue, never blocks readiness), and `PolarStrapService.onBattery()` updates
the persistent notification to `Connected · X% battery` — the exact pattern the Oura ring service
already uses, which is what the owner referenced. Also threaded `battery` through `getStatus()`
and the `PolarBleStatus` TS type for parity, though the notification is the primary "somewhere" —
no new UI card was built for this (kept the change minimal, matching how the ring's own battery is
surfaced).

### 3. Sleep hypnogram gone + today's timeline needing a re-open — same root cause, no code change
Traced both to `docs/oura-ble-operations.md` row **I20**: the BLE ingest rollup
(`aggregateOuraRawSamples`, which derives both `sleep_phase_5_min` for the hypnogram AND the sleep
session that the day-timeline's "Woke up" event reads) runs fully backgrounded, fire-and-forget,
per ingest POST — deliberately never blocking the response (a prior incident, same row, already
covers why it can't be inline). Under load it can still lag behind a real drain, in which case the
hypnogram/wake event show up late — or need the self-service **Sync & Redecode** button
(`/admin/oura-ble`) to force a re-aggregate over the already-stored raw samples. This matches
exactly what the owner observed (present after a re-open, i.e. once the backgrounded rollup had a
chance to catch up). This is a known, already-documented gap with an accepted mitigation, not a
new regression — no code changed here. If it keeps recurring, I20's own note points at the next
lever: profile whether SleepNet inference is the tail cost, and consider moving it off the ingest
path onto a queue.

### 4. Daily digest wrongly claiming "weekly step goal already met" — fixed
`app/api/daily-digest/route.ts` passed `userGoals.stepsGoal` directly as the weekly target to
`stepsPaceToWeeklyGoal`. `stepsGoal` is always stored as a **daily** figure regardless of
`stepsGoalType` (confirmed against `home-card-widget.tsx`'s `goalDisplay = stepsGoal * 7` for the
weekly Steps home card, and `goals-section.tsx`'s save path) — so as soon as the week's cumulative
steps passed the *daily* number (often within a day or two), the digest declared the weekly goal
met. Screenshot evidence: digest said "weekly step goal already in the bag" while the Steps (week)
card showed 7,047 / 49,000 (14%). Fixed by multiplying by 7 before calling the pace function,
matching the home card's math.

### 5. "Your day in review is ready" banner appearing at 7am with nothing to review — fixed
Flagged in the same session (follow-up screenshot): the banner is gated purely on a per-day
localStorage dismiss flag, so it un-hides itself the instant a new calendar day starts — including
first thing in the morning, before there's anything to review. The digest itself is an
end-of-day summary (mirrors the "Bedtime approaching ... complete your end-of-day review" evening
reminder in `lib/day-review-reminders.ts`), so showing it at 7am is structurally premature — most
of the day hasn't happened. Added a local-hour gate (`>= 17`, i.e. it won't un-dismiss itself
before 5pm) alongside the existing per-day dismiss check in `session-select-content.tsx`.

### Verification
`tsc --noEmit` clean, `eslint` on touched files clean (pre-existing unrelated warnings only),
`pnpm build` green (all pages), targeted vitest suites (`sleep-night`, `daily-digest-context`, API
tests) pass. Logged into the local dev server as the seeded test user and hit `/api/daily-digest`
and `/session-select` directly — both 200, no server errors.

**Not exercised — on-device.** All three Kotlin changes (retry cap, battery read, notification
text) are native and compile-gated only in this sandbox — see the Known-Issues row above. The
banner's evening gate and the digest's steps-goal math are plain client/server JS, verified by
reading and the dev-server smoke above, but the banner's actual on-screen timing (does it stay
hidden before 5pm, does it appear after) wasn't watched live since the sandbox clock isn't the
owner's real evening.

No backlog entry needed for item 3 — it was already tracked (`projectOverview.md`'s existing
"Sleep hypnogram/stages over BLE" Known Issues row, and `docs/oura-ble-operations.md` I20); this
session just confirmed the current symptom matches that row rather than being a new regression.
