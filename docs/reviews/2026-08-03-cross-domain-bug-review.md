# Cross-Domain Bug Review — 2026-08-03

**Scope:** a review-only session (no code changes) covering the changes shipped since v1.250.0
(2026-08-02) through v1.252.4 (2026-08-03) — sync/streak overlay, auto-apply phase transitions,
bodyweight-1RM rendering, Q-40/Q-43/Q-45 — plus a fresh production data-integrity pass across
nutrition/body/sleep via the read-only admin DB endpoint. Four review agents ran in parallel: an
HTTP Cache-Control staleness sweep, a write-path-ownership/offline-sync-mirroring audit, a deep-dive
on the two riskiest recent workout-logic changes, and prod DB integrity spot-checks. Everything
below was verified by reading the actual code or running the actual query — nothing here is
speculative. Two of the four passes came back clean (nutrition data integrity; sync-push mirroring
across the last 40 commits) and are not repeated below beyond this line.

Five findings, all now queued in `docs/implementation-backlog.md`.

---

## 1 & 2 — [workouts] Prescription cache staleness after a mutation (Q-53)

Two independent cache layers, same symptom class the project already fixed once this cycle
(`GET /api/running-plan`, v1.246.0 — a bare `fetch()` let the **browser's own HTTP cache** serve a
stale response for up to 60s after a rapid user-driven mutation, invisible to the app's own
`cachedFetch`/cache-group invalidation). Two new, unfixed instances of the same and an adjacent bug
class turned up in the phase-transition/prescription flow:

**(a) Missing `cache: 'no-store'` on a post-mutation read.** `components/workout-screen.tsx`'s own
`loadPeriodization()` helper (lines 438–444, 457) already documents and fixes this exact bug for
itself — `fetch(url, opts?.afterWrite ? { cache: 'no-store' } : undefined)` — and
`handleDurationPresetChange` correctly passes `{ afterWrite: true }` (line 499). But
`onPhaseChanged` (`workout-screen.tsx:1649-1660`, passed to `PreWorkoutScreen`/`AiPrescriptionCard`
and fired after `executeTransition()`'s POST in `components/workout/ai-prescription-card.tsx`) does
its own **separate** bare `fetch(...)` at line 1652 with no `cache: 'no-store'` override — missing
the fix its sibling call site already applies. A phase transition can show the stale
pre-transition prescription/phase state for up to 60s. Medium-confidence secondary instance:
`components/mood-checkin-sheet.tsx`'s own duplicate duration-preset handler (lines 117-144) POSTs to
`.../prescribe` and only calls `invalidatePrescriptionChanged()` (the app cache-group layer) — it
has no access to the `afterWrite`-aware refetch, so whatever next reads
`ai-periodization-session:${sessionId}` through the ordinary path can also be served a
browser-HTTP-cached stale response.

**(b) Missing app-level cache-group invalidation on the auto-apply trigger.** The
`aiPrescriptionPending` effect (`workout-screen.tsx:550-563`) is documented as *the* reliable
client-side trigger for prescription generation, including auto-applied phase transitions (added in
v1.252.0). On success it calls `fetchExercises({poll:true})` + `loadPeriodization({afterWrite:true})`
— but never `invalidatePrescriptionChanged(programSessionId)`. Every sibling trigger site does:
the duration-preset path (`:497`), the manual refresh path (`:508`), the completion-triggered
next-prescription fetch (`:1524-1526`), and accept/dismiss in `ai-prescription-card.tsx:93,112`.
`invalidatePrescriptionChanged` is what busts the `workout-card:<id>` key that
`app/session-select/session-select-content.tsx:553-570` reads with `freshWithinTtl:true` (a
network-skip short-circuit). Concrete scenario: a session's prescription auto-applies a phase
transition via this path; the just-opened workout screen paints correctly (its own `cachedFetch`
always revalidates), but backing out to the session list within `TTL_LONG` repaints session-select
from the untouched `workout-card:<sessionId>` cache — stale pre-transition phase/confidence/
"suggested" text instead of the "Moved to Intensification" state that actually landed in the DB.

Backlog: Q-53, plan `docs/superpowers/plans/2026-08-03-prescription-cache-staleness.md`.

## 3 — [workouts] Non-atomic prescription write sequence, reachable by different dedup keys (Q-54)

`generatePrescriptionForSession` (`packages/shared/src/ai-periodization/generate-prescription.ts:
628-654`) performs three sequential, non-transactional writes to the same `session_periodization`
row: `advancePhase` → `storePrescription` → conditional `updatePrescriptionStatus`.
`storePrescription` (`lib/data/postgres/slices/periodization.ts:109`) unconditionally resets
`prescriptionStatus` back to `'pending'`. The dedup cache (`generation-dedup.ts`) only collapses
calls that share an *identical* key (`userId:sessionId:day:excludeSessionId:durationPreset`). The
duration-preset picker (`handleDurationPresetChange`, `workout-screen.tsx:481-497`) intentionally
builds a **different** key and passes `skipCooldown:true` (`generate-prescription.ts:160`), so it is
never deduped against a concurrent standard-key generation for the same session — e.g. the
auto-fire that runs at session-open time. Two concurrent runs for the same session can interleave
their three writes, leaving `prescriptionStatus='auto_applied'` paired with prescription
content/phase from a different, unvetted run (or vice versa). Not covered by `canAutoApplyTransition`'s
existing unit tests, which only exercise the single-call decision function, not the write sequence
under concurrency.

Backlog: Q-54, plan `docs/superpowers/plans/2026-08-03-prescription-generation-race.md`.

## 4 — [workouts] Bodyweight `target80` rendered as "X kg" in the workout-preview sheet (Q-55)

v1.252.4 (this session's predecessor) fixed the Year-in-Review PR selection and the deload sheet's
kg target for bodyweight exercises — a bodyweight `estimated_1rm`/`target80` is a `BW_REF`(100)-
relative index, not a real weight, so printing "kg" after it fabricates a number. That fix was
deliberately scoped to the two surfaces found, not a blanket sweep (confirmed correct:
`live-1rm-readout.tsx`'s only render site, `active-workout-screen.tsx:644`, guards on
`exerciseType !== "bodyweight"` and computes its value live rather than from a stored index — no
finding there). A third, unfixed instance exists: `components/overview-screen.tsx:484`, the
workout-preview sheet's Target column, renders `` `${snapWeight(ex.target80)} kg` `` with **no**
`exerciseType` check — unlike the correctly-guarded block 70 lines above in the same file
(`overview-screen.tsx:409-414`). Concrete failure: open the workout-preview sheet (tap a session
card on the overview screen) for a session with a bodyweight exercise carrying a good rep max — its
`target80` (≈80% of a `BW_REF=100`-relative index) prints as e.g. "**80 kg**", a fabricated weight
with no relation to anything the lifter has ever moved.

Backlog: Q-55, plan `docs/superpowers/plans/2026-08-03-bodyweight-target-kg-overview-sheet.md`.

## 5 — [devices][body][sleep] Real sensor data landed on dates up to 5 days in the future (Q-56)

Production DB audit (`claude_ro`, single real account) found five `body_metrics` rows and one
`oura_daily` row, all written in the same one-second batch:

```sql
SELECT id, date, created_at FROM body_metrics
WHERE created_at BETWEEN '2026-07-30T03:44:09' AND '2026-07-30T03:44:10' ORDER BY date;
--  date        | created_at
--  2026-07-31  | 2026-07-30T03:44:09.953Z   (+1 day)
--  2026-08-01  | 2026-07-30T03:44:09.953Z   (+2 days)
--  2026-08-02  | 2026-07-30T03:44:09.953Z   (+3 days)
--  2026-08-03  | 2026-07-30T03:44:09.953Z   (+4 days)
--  2026-08-04  | 2026-07-30T03:44:09.953Z   (+5 days)

SELECT id, date, synced_at FROM oura_daily WHERE synced_at BETWEEN '2026-07-30T03:44:09' AND '2026-07-30T03:44:10';
--  2026-08-04  | 2026-07-30T03:44:12.815Z   (+5 days), source_map: {"non_wear_time_sec":"oura_ble"}
```

All five `body_metrics` rows carry **real** sensor data (not placeholders): `weight_kg` 71-71.65,
`body_fat_pct` ~24-25, `hrv_ms`, `resting_heart_rate`, `spo2_pct`, `steps` in the 4,600-7,000 range,
all stamped `source_map: {"...":"oura_ble", "...":"scale_ble", ...}`. The four rows dated
2026-07-31 through 2026-08-03 have since **self-healed**: as those days actually arrived, the real
per-day write upserted onto the same `(user_id, date)` row (`updated_at: 2026-08-03T11:33:51`
now shows correct values), so the unique constraint held and no duplicate exists. **The
2026-08-04 row is still live in production right now** (today is 2026-08-03) — it holds a partial
placeholder (`steps: 970`, `source_map: {"steps":"oura_ble"}`, everything else null) sitting one
calendar day in the future.

Read as five consecutive future dates, 1 day apart, each carrying real-looking daily-cadence data
(steps in a plausible daily range) — this pattern matches the project's known Date-Arithmetic bug
class (CLAUDE.md, "Date Arithmetic — beyond todayInTz()": hand-added/mis-signed date offsets) more
than random corruption: something in the Oura-BLE and/or scale-BLE ingest path computed a batch of
dates as `today + i` for `i` in `1..5` where it should have computed `today` (or backfilled
`today - i`). Root cause not yet identified — no code change made in this session, this is an
investigation-first backlog item. Candidate starting points: the BLE daily-rollup/anchor code
(`ring_timestamp_ds ↔ UTC` anchor mapping, per CLAUDE.md's Oura Direct-BLE section) and any
scale-BLE backfill/catch-up write path, both of which write `body_metrics`/`oura_daily` with
`oura_ble`/`scale_ble` provenance. Not confirmed whether this has recurred since 2026-07-30 — the
2026-08-04 row is the only currently-live evidence, and it will self-heal or become a permanent
future artifact within the next 24h depending on whether the real 08-04 write lands correctly.

Backlog: Q-56, plan `docs/superpowers/plans/2026-08-03-future-dated-ble-ingest-rows.md`.

## Passes that came back clean

- **Sync-push mirroring** (`pushMutations` vs web API routes) across every write-capable route
  touched in the last 40 commits: no drift found. `saveSleepSession`'s new required `source` param,
  the Q-47 cadence-field fix, and the new `sleepPhase5Min` Health-Connect field are all correctly
  mirrored on both write paths.
- **Ownership checks**: the two most recently added mutating routes
  (`activity-logs/[id]/metrics`, `ai-periodization/session/[sessionId]/transition`) both
  ownership-check before writing and scope their UPDATEs to `user_id`.
- **Cache-group registration**: no new `cachedFetch`/`readCacheSync` keys were introduced in this
  range, so no new cache-groups.ts gap.
- **Nutrition production data**: zero orphaned rows across `food_logs`→`food_items`,
  `saved_meal_items`→`food_items`/`saved_meals`, `supplement_logs`→`supplements`; no negative/zero
  macros on named items; no future-dated rows; no non-positive `quantity_multiplier`.
- **Sleep integrity** (`sleep_sessions`): no duplicate `oura_id`s, no negative or >24h durations, no
  `sleep_end < sleep_start`. One n=1 edge case noted for awareness, not filed as a bug: a 45-minute
  nap row (`299fa732-…`) has `time_in_bed_hours: 0.75` but all sleep-stage/efficiency fields zeroed —
  a fully-awake short rest got stored as a zero-value "sleep session".
