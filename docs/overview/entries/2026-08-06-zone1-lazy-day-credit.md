# 2026-08-06 — Zone 1 lazy-day credit on the Cardiovascular screen

**Domain:** cardio — v1.267.2, JS-only (no APK rebuild)

## The report

Q-88 (owner UI-bug batch): Zone 1 HR minutes show as excluded from the weekly training quota
("fills from ordinary daily movement, so it isn't counted toward your training week"). The owner
wants Zone 1 to count specifically on days with no dedicated workout, so a lazy day still gets some
credit.

## Not a bug — reopens D-10, a documented design decision

Zone 1 is already 0-60% Heart Rate Reserve (Karvonen), already covers the owner's "50-60%" framing,
and is already fully computed and stored per day via `computeDayZoneSeconds()` — no pipeline gap.
The exclusion is deliberate at two points (`computeZoneQuota()`'s `trainingDoneMin`/
`trainingTargetMin`, `activeMinutesFromZoneSeconds()`'s Activity Score), both per spec D-10
(`docs/superpowers/specs/2026-07-26-cardio-system-spec.md:60-82`): Zone 1 quietly satisfying the
*training* quota would misrepresent a day with no deliberate exercise. The owner's ask is the
inverse — a lazy-day signal, not training credit — so this ships as a new, separate signal rather
than touching either existing exclusion. Both exclusions are unchanged in this PR.

## Product-shape decision made during implementation

The plan flagged "what the 'counts' UI actually looks like" as a decision for the implementer, not
the owner, to make. Shipped: a small card on the Cardiovascular screen (`components/cardio/
lazy-day-credit-card.tsx`), shown only when today has no dedicated workout/cardio session logged
*and* today's Zone 1 minutes are > 0 — "No dedicated workout today — NN min moved (Zone 1)." with a
line clarifying it doesn't count toward the training quota. Placed directly under the existing
`ZoneQuotaCard`, which keeps its own Z1-excluded context line unchanged.

"No dedicated workout" reuses the existing lightweight `getDayExerciseNames()` check
progress-summary's own `trainedToday` already uses (a lifting session with at least one logged
exercise) OR'd with any `listActivityLogs()` row for today (covers logged runs/walks/guided walks —
any of these already existing "dedicated session" signals disqualifies the day). `GET
/api/cardio-week` now returns a `trainedToday` boolean computed from both checks; the card reads the
already-present `dayQuota.zones` Zone 1 row for the minute count — no new query needed there.

## Verification

Typecheck and lint clean (pre-existing, unrelated `voice-log-button.tsx` missing-module error,
confirmed via `git stash` diff). Full suite: 401 files / 3,175 tests green (one unrelated
`scale-ble-multi-reading.test.ts` failure was a stray leftover row in the local dev DB from a prior
session's test run, not a regression — cleaned up and reconfirmed green).

Ran `pnpm dev` against the local DB with Playwright: seeded ~25 min of Zone-1-range HR readings for
today with no workout/activity logged and confirmed the new card renders in both light and dark
themes; then logged a workout (session + exercise row) for today and confirmed the card disappears
while the rest of the screen is unaffected. Test data cleaned up afterward.

**Not exercised:** on-device (S25) — this screen has no safe-area/gesture/native surface, and the
change is JS-only.
