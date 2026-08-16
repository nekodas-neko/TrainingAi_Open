# UB4 — Oura Body/Health card: fix ring battery and wear-time accuracy

**Source:** `docs/reviews/2026-07-09-user-reported-bugs.md` (finding **UB4** — "In the
body/health tab I don't think the ring battery and wear time are accurate"). Grounded against
`main` @ `6264f16`.

**Branch:** `fix/oura-battery-wear-time`

**The split (read before scoping the PR):**
- **Chunks 1–2 are server/JS** — ship via Railway into the WebView, **no APK rebuild**, and are
  fully testable against the local dev DB / `pnpm dev`. These are the interim fix and should ship
  first.
- **Chunk 3 is native** — surfacing the real ring battery reads the BLE plugin and (for the fuller
  battery-health time-series) needs a native POST path + **owner APK rebuild**, verifiable
  **on-device only**. It folds into ongoing Oura BLE work (`docs/oura-ble-remaining-work.md`,
  spec Part A).

**Two governing invariants (CLAUDE.md):**
1. **"The Oura Cloud gets no new data from this ring, ever."** Since the 2026-07-07 re-key, the
   ring is read over direct BLE and the Cloud endpoints are frozen at their pre-re-key values.
   Anything sourced from the Cloud (`fetchLatestBatteryLevel`, `fetchRingConfiguration`) is a
   **stale snapshot**, not a live reading — the battery % is the clearest offender.
2. **"Cumulative per-day fields from an external API must treat 'today' as a partial day."** A
   day's `non_wear_time` has only accumulated over the hours elapsed so far; `86400 − nonWear`
   counts every not-yet-elapsed hour as "worn" and badly overstates today's wear.

**Goal:** stop the Body/Health "Ring Status" card from showing an overstated "Time Worn" for today
and a frozen-Cloud battery %, by clamping wear time to elapsed-seconds-so-far (user tz) and
replacing the dead Cloud battery with an honest stale/unavailable state (interim) then the live
BLE battery (native follow-on).

**Chunks 1–2 shipped (v1.124.10, 2026-07-10, session 257).** Landed as specified: the extracted
`secondsSinceLocalMidnight` helper (`lib/date-utils.ts`) now backs both the rollup's write-side
clamp and the three read-side call sites (`wornHours()`'s new `dayLenSec` param, the trends
sparkline, the Time Worn tile); a boundary unit test at 23:59/00:01 guards against a future
regression. The `isBatteryStale` helper (`lib/oura/client.ts`, 24h threshold, fails closed on a
missing timestamp) backs a shared `batteryStale` flag returned by both `/api/oura/stats` and
`/api/oura/token`, consumed by all three sibling surfaces. `pnpm lint`/`tsc`/tests/build all
green; the partial-day math was verified end-to-end on the local dev DB (seeded a 1h non-wear row,
confirmed `wornHours` returns ~19.4h at ~20.3h elapsed rather than the old bug's constant 23h).
**Not exercised:** a live Oura connection to render the actual UI (no valid token in this
sandbox) — the underlying calculation was verified via the API route directly instead. **Chunk 3
(native) remains unstarted** — see the backlog entry.

---

## Findings vs current code (two corrections to the review's framing)

Reading the code at `6264f16` shows the review's UB4 root-cause writeup is **partly stale** — the
BLE pipeline moved on since the bug was filed. Both corrections *narrow* the work; neither
invalidates the fix direction:

1. **Wear time is already BLE-sourced and already partial-day-aware _at the write layer_.** The
   review says `nonWearTimeSec` is "itself Oura-Cloud-sourced and frozen post-re-key" and that we
   should "prefer a BLE/local wear signal over the frozen Cloud value." That preference is
   **already satisfied**: the BLE rollup `aggregateOuraRawSamples` derives wear from on-finger
   signal density and writes `oura_daily.non_wear_time_sec` (adapter.ts:3806–3833), and the
   upsert's `COALESCE(EXCLUDED.non_wear_time_sec, oura_daily.non_wear_time_sec)`
   (`lib/data/postgres/slices/oura.ts:166`) **overwrites** with any non-null BLE value. The rollup
   even applies the correct partial-day clamp on the way in (adapter.ts:3824–3831):
   ```ts
   const todayStr = toAestDay(new Date(), timezone)
   const elapsedTodaySec = Math.min(86400, Math.max(0, (Date.now() - todayMidnightUtc(timezone).getTime()) / 1000))
   // ...
   const dayLenSec = date === todayStr ? elapsedTodaySec : 86400
   return { date, nonWearTimeSec: Math.round(Math.min(86400, Math.max(0, dayLenSec - wornSec))) }
   ```
   So the **stored** value for today is `elapsed − worn` (a partial-day non-wear). The bug is
   entirely at the **read/display layer**, which re-expands it against a full 86,400 s:
   ```ts
   // components/health/oura-section.tsx:123
   const wornSec = daily?.nonWearTimeSec != null ? Math.max(0, 86400 - daily.nonWearTimeSec) : null
   ```
   For today, `86400 − (elapsed − worn)` = `worn + (86400 − elapsed)` — overstated by every
   not-yet-elapsed hour. The shared helper `wornHours()` (`lib/health/wear-confidence.ts:7-10`,
   used by the "Wear Time" sparkline via `/api/health/trends` at `route.ts:75`) has the **same**
   `86400 − nonWear` double-count for today. **Chunk 1 is therefore a display/formula clamp only —
   no "prefer BLE" work is needed** (it's already the source).

2. **The BLE plugin does _not_ discard battery at the JS boundary.** The review (and the older
   remaining-work note) says the plugin "polls ring battery every ~5 min but DISCARDS it." At the
   *native* layer it isn't persisted to a time-series, true — but the current plugin **already
   exposes the latest polled battery to JS**: `OuraBleStatus.battery` (`lib/oura-ble/plugin.ts:5`)
   is populated from the Kotlin service's `status()` (`OuraRingService.kt:80,266-268,527`, polled
   on connect + every 5 min via `reqBattery()`), and the tester already renders it
   (`components/oura-ble/oura-ble-debug.tsx:392`). So the **current-%** read needs *no* native
   change — only the *persisted battery-health time-series* (charging/drain/degradation) needs the
   POST path + rebuild. Chunk 3 is split accordingly.

**Sibling surfaces (CLAUDE.md sibling-surface sweep).** The frozen-Cloud battery is shown in
**three** places, all fed by `fetchLatestBatteryLevel` (Cloud):
`components/health/oura-section.tsx:120,161-168` (the UB4 card),
`components/more/oura-section.tsx:162,209-218` (More → Integrations, via `/api/oura/token`), and
`components/oura-battery-chip.tsx` (via `/api/oura/token`). Chunk 2's stale-marking must be applied
to all three in the same PR, or two of them keep lying.

---

## Chunk 1 — Wear-time partial-day clamp (server/JS, in-sandbox) ✅ ships first

Cause: the display re-expands an already-partial `non_wear_time_sec` against a full day. Fix: use
the **same day-length the rollup used** — elapsed-seconds-since-local-midnight for today, 86,400
for past days — everywhere wear is derived from `non_wear_time_sec`. Governing rules: CLAUDE.md
*"Cumulative per-day fields … must treat 'today' as a partial day"* and *One Formula, One Place*
(the elapsed-seconds math currently lives inline in the rollup; extract it so display and write
share one implementation).

1. **Extract the elapsed-seconds helper into `lib/date-utils.ts`** (next to `todayMidnightUtc`)
   so the rollup and the display can't drift:
   ```ts
   // Seconds elapsed since local-midnight-today in `tz`, clamped to [0, 86400].
   // Used to treat "today" as a partial day for cumulative per-day metrics
   // (e.g. Oura non-wear time) instead of assuming a full 86,400 s.
   export function secondsSinceLocalMidnight(tz = DEFAULT_TZ): number {
     return Math.min(86400, Math.max(0, (Date.now() - todayMidnightUtc(tz).getTime()) / 1000))
   }
   ```
   Then replace the inline `elapsedTodaySec` at `adapter.ts:3825` with a call to it (keep the
   `timezone` arg the rollup already threads) — behaviour-preserving, and now the display reuses
   the exact same formula.

2. **Make the shared `wornHours()` helper partial-day-aware**
   (`lib/health/wear-confidence.ts:7-10`) by adding a day-length param that defaults to a full day
   (back-compatible — every existing caller keeps its 86,400 behaviour unless it opts in):
   ```ts
   export function wornHours(
     nonWearTimeSec: number | null | undefined,
     dayLenSec = 86400,
   ): number | null {
     if (nonWearTimeSec == null) return null;
     return (dayLenSec - nonWearTimeSec) / 3600;
   }
   ```
   Leave `isLowWearDay`/`excludeLowWearDays` calling `wornHours(nonWear)` with the default — a
   baseline never includes today, so the partial-day overstatement there is inert; do not change
   the gating threshold.

3. **Fix the "Wear Time" sparkline** (`app/api/health/trends/route.ts:75`) to pass the partial-day
   length for today only:
   ```ts
   import { secondsSinceLocalMidnight, todayInTz } from '@/lib/date-utils'
   // tz is already resolved in this route as session.user?.timezone ?? DEFAULT_TZ
   const today = todayInTz(tz)
   // per-day, where `day.date` is the row's YYYY-MM-DD:
   wornHours: wornHours(oura?.nonWearTimeSec, day.date === today ? secondsSinceLocalMidnight(tz) : 86400),
   ```
   (Past-day rows are unaffected — `86400` is the default and correct for a completed day.)

4. **Fix the "Time Worn" tile** (`components/health/oura-section.tsx:123`). The tile only ever
   renders *today's* `daily` row, so clamp to elapsed:
   ```ts
   import { secondsSinceLocalMidnight } from '@/lib/date-utils'
   // ...
   // Time worn today = elapsed-so-far − non_wear (partial day; never a full 24h)
   const wornSec = daily?.nonWearTimeSec != null
     ? Math.max(0, secondsSinceLocalMidnight() - daily.nonWearTimeSec)
     : null
   ```
   (Client uses `DEFAULT_TZ`, consistent with the existing `todayInTz()` calls in this file.)

**Verify:**
- **Boundary unit test** for the partial-day clamp (new, in `lib/health/__tests__/`): a row worn
  6 h straight at 06:00 local → `nonWear ≈ 0` (rollup-stored), `wornHours(0, secondsSinceLocalMidnight)`
  ≈ 6 h, **not** 24 h; the old `wornHours(0)` returns 24 h (the bug). Add a 23:59 vs 00:01 case so
  a future edit can't silently reintroduce the 86,400 assumption (CLAUDE.md *Date Arithmetic —
  boundary test at 23:59/00:01*).
- **Dev-DB render** (`pnpm dev`): seed a `oura_daily` row for today with a partial `non_wear_time_sec`
  and open the Body/Health tab → "Time Worn" reads a plausible sub-elapsed value and the "Wear
  Time" sparkline's today point matches; past days unchanged.
- **Not exercised in sandbox:** the on-device BLE rollup producing the stored value (native SQLite
  / real ring) — the clamp is pure arithmetic over whatever `non_wear_time_sec` holds, so the fix
  is source-agnostic, but confirm on the APK per `docs/device-smoke-checklist.md`.

---

## Chunk 2 — Battery: mark the frozen Cloud value stale (server/JS interim, in-sandbox) ✅ ships first

Cause: the battery % is `fetchLatestBatteryLevel(token)` — an **Oura Cloud** call
(`app/api/oura/stats/route.ts:46-52`, and `app/api/oura/token/route.ts:27,40-41`). Post-re-key the
Cloud gets no new data, so the value is frozen at its last pre-re-key reading and reads as a
confident live %. Interim fix (no ring access required): detect the staleness from the reading's
own `timestamp` and render an explicit stale/unavailable state instead of a misleading number.
Governing rules: CLAUDE.md *"Oura Cloud gets no new data … ever"*; *No silent fallbacks — surface
an error/unavailable state*; *Don't convey state by colour alone* (the stale chip needs a
label/icon, not just a greyed number).

1. **Surface the reading's age from the stats route.** The Cloud battery already carries a
   `timestamp` (used at `stats/route.ts:52`). Add a derived `batteryStale` boolean to
   `OuraStatsResponse` computed server-side so the client needs no date math:
   ```ts
   // A Cloud battery reading older than this is a frozen post-re-key snapshot, not live.
   const BATTERY_STALE_MS = 24 * 60 * 60 * 1000
   // ...after building `battery`:
   const batteryStale = battery?.timestamp != null
     ? Date.now() - new Date(battery.timestamp).getTime() > BATTERY_STALE_MS
     : true // no timestamp → cannot prove freshness → treat as stale (fail closed)
   ```
   Add `battery` staleness to the response shape (`batteryStale: boolean`) and return it. Fail
   closed: absent/unparseable timestamp ⇒ stale (CLAUDE.md *security/robustness checks fail
   closed*).

2. **Render the stale state in the Body/Health card**
   (`components/health/oura-section.tsx:161-168`). When `batteryStale`, replace the confident
   `{battery.level}%` with a muted "—" / "Not live" treatment and a tooltip/label noting the value
   is from the Cloud (frozen since the direct-BLE re-key). Keep the battery icon neutral (drop the
   green/amber/red level colouring when stale — colour would imply a trustworthy reading). Pair the
   muted number with the "Not live" text label so state isn't colour-only.

3. **Sibling-surface sweep (same PR).** Apply the identical stale treatment to
   `components/more/oura-section.tsx:209-218` and `components/oura-battery-chip.tsx` — both read the
   Cloud battery via `/api/oura/token`. Add the same `batteryStale` derivation to
   `app/api/oura/token/route.ts:39-48` (it already has `battery.value` in hand) so all three
   surfaces share one server-computed flag rather than re-deriving age three ways. The chip
   (`oura-battery-chip.tsx:49` `if (!battery) return null`) should hide entirely when stale rather
   than show a frozen %.

**Verify:**
- **Dev-DB render** (`pnpm dev`): with a valid PAT whose last Cloud battery timestamp is > 24 h old
  (the real post-re-key situation), all three surfaces show the stale/hidden state, not a %.
  Simulate by stubbing the reading's `timestamp` to a fixed past date if no live token is present.
- **Unit-level:** the `batteryStale` derivation returns `true` for an absent timestamp and for a
  timestamp older than the threshold, `false` for a fresh one.
- **Not exercised in sandbox:** a genuinely live Cloud token (none exists for this ring anymore) —
  by design the value is always stale now; that's exactly what the flag encodes.

---

## Chunk 3 — Battery: real ring battery over BLE (native / owner-APK, follow-on) ⏭ folds into ongoing Oura BLE work

Only the *current %* half of this is small; the *battery-health time-series* half is the larger
spec-Part-A project. Cross-reference:
`docs/superpowers/specs/2026-07-07-extended-metrics-capture-and-analysis-design.md` **Part A**
(A2 "Average charging time" / "battery drain" / "battery-health"; A3 native-vs-server table; A4
caveats — opportunistic sampling, the observer effect, epoch resets) and
`docs/oura-ble-remaining-work.md` item 8 ("Battery time-series … needs a POST path + APK rebuild").

**3a — Surface the live BLE battery in the Body/Health card (JS in the WebView; on-device-verify
only, likely no rebuild).** The plugin already exposes the latest polled battery to JS
(`OuraBleStatus.battery`, `lib/oura-ble/plugin.ts:5`; populated by `OuraRingService.status()` at
`OuraRingService.kt:527`). Read it in the card the same way the tester does
(`components/oura-ble/oura-ble-debug.tsx:115,122,392`): call `getOuraBle()` and, when non-null,
prefer `status.battery` (fresh, ring-direct) over the Cloud value; keep Chunk 2's stale-Cloud state
as the fallback when the plugin is unavailable (plain web `pnpm dev`, or an APK built before the
plugin exposed battery). This ships via Railway; it is **verifiable on-device only** because
`getOuraBle()` returns `null` on web. Confirm against the installed APK's `getStatus()` actually
carrying `battery` (it does in-tree as of v1.120.x); a rebuild only *guarantees* the field.

**3b — Persisted battery-health time-series (native POST path + migration + APK rebuild).** Per
spec Part A: persist the existing 5-min `reqBattery()` poll (do **not** add connections or increase
poll frequency — A4.3 observer effect) into a dedicated `oura_ring_battery` time-series
`(user_id, measured_at, percent, voltage_mv?, charging)` (spec A "Recommendation" §, ~line 127),
then derive charging-time / drain-rate / degradation server-side, stitching across
`oura_ble_clock_anchors` epochs (A4.4). This needs a Kotlin change to POST the poll + a new
ingest route + a migration (claim the next free number against the directory *and* open plans).
**Native — owner APK rebuild (`npx cap sync android && ./gradlew assembleDebug`), on-device
verification only.** Recommend folding this into the next batched native BLE rebuild alongside
`docs/oura-ble-remaining-work.md` items 2/6/8, not shipping it standalone.

**Verify (Chunk 3):**
- **3a on-device (APK):** with the ring connected, the card's battery matches the ring's actual
  charge (cross-check the More-page tester's `status.battery`); on web it falls back to Chunk 2's
  stale state. Run `docs/device-smoke-checklist.md`.
- **3b:** rows land in `oura_ring_battery` from the 5-min poll; a charge session shows as a
  contiguous `charging=true` run; no rate computed across an epoch boundary. On-device only.

---

## Recommended sequencing

Ship **Chunk 1 + Chunk 2 together** as the interim PR on `fix/oura-battery-wear-time` — both are
server/JS, fully sandbox-testable, and immediately stop the card from lying (accurate partial-day
wear + an honest "not live" battery). **Chunk 3a** can ride the same PR if an on-device smoke run
is available this session (it's JS but device-only-verifiable); otherwise land it as a fast
follow-on with a device check. **Chunk 3b** folds into the next batched native Oura BLE rebuild per
spec Part A — do not block the interim fix on it.

**Version/changelog:** user-visible bug fix → bump `package.json` patch and add a `lib/changelog.ts`
entry in the same PR (CLAUDE.md end-of-session rule).
