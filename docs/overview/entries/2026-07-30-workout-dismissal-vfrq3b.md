# 2026-07-30 — AI prescription: no silent auto-expiry, generation moved to pre-workout

Branch: `claude/workout-dismissal-vfrq3b` · v1.247.0

Owner-reported starting point: a screenshot of the "Upper" pre-workout screen showed
`AI Prescription · Accumulation · Dismissed`, and the owner didn't remember ever tapping Skip.

## Root cause, found via production read-only query

`POST /api/admin/db-query` against the real `session_periodization` row (not a guess): the
prescription was generated 2026-07-22, recommending a transition to Intensification
(`phase_action: transition_recommended`). Its 7-day `prescription_expires_at` lapsed 2026-07-29 with
nobody having opened that session in the interim. The very next open —
`GET /api/ai-periodization/session/[sessionId]` — silently flipped `pending` → `dismissed`
(`updated_at` landed ~21h after expiry, matching when the owner reopened the screen the next
morning). `app/api/workout-data/route.ts` carried the identical auto-dismiss block. Both existed to
stop a stale phase decision from lingering forever — but "resolve it by silently deciding no on the
owner's behalf" is worse than lingering, especially for a decision (phase transition / deload) that
the codebase already treats as requiring explicit consent everywhere else.

Owner's follow-up asks, once the mechanism was clear:
1. No auto-expiry, ever — only an explicit Move/Skip/Accept/Dismiss changes status.
2. Confirmed `auto_apply_prescriptions` was already on for the active program — not a bug, just
   orthogonal (auto-apply only covers `phase_action: 'stay'`; transitions/deloads always need consent).
3. Generate the next prescription right before the workout, not at the end of the previous one — so
   staleness structurally can't happen instead of being bounded by an expiry timer.

## Fix

1. **Removed both auto-dismiss-on-expiry blocks** (the GET session route, `workout-data`'s two
   branches) and the mirroring `expired` gates in `app/api/next-session/route.ts` and
   `app/api/next-session/prescription/route.ts`. `prescriptionExpiresAt` is still stored (harmless,
   unused) — nothing reads it for gating or gets to unilaterally act on it anymore.
2. **Deleted the completion-time eager regeneration.** `regenerateNextPrescription` and its two call
   sites (`app/api/complete-workout/route.ts`, the offline-outbox `complete_workout` branch in
   `lib/data/postgres/adapter.ts`) are gone; `completeWorkoutFromPayload` no longer returns a
   `regeneratePrescription` flag, it just marks the slot `consumed`. The existing on-open trigger
   (`isAiPrescriptionPending`, previously only the Gemini-outage retry path) is now the sole
   generation trigger — a prescription is only ever as stale as "since you last opened this specific
   session," structurally bounded to roughly a training cycle instead of an arbitrary week.
   This reverses the 2026-07-20 "generate at session end" decision (see that day's journal) — the
   reason it existed (a blank "Auto" chip on the Health card right after finishing) is no longer a
   constraint, because of fix #3.
3. **`AiPeriodizationStatusCard`** (Health → Training) — owner: "that chip doesn't need to be shown,
   it's either all AI prescription or none... show a more useful stat." Replaced the per-session
   Auto/Ready/New status dot with days-since-last-trained ("9d ago" / "Yesterday" / "Trained today" /
   "Never trained"). `app/api/ai-periodization/program-overview/route.ts` now returns
   `lastTrainedDaysAgo` per session via the existing `getRecentSessionsOfType` (no new repo method,
   no new query pattern).

## Verified

- Full suite green after `pnpm install` re-linked a missing `@trainingai/shared` workspace symlink
  (pre-existing sandbox state, unrelated to this change — `npx vitest` and `pnpm vitest` both failed
  to resolve `@trainingai/shared/*` subpaths before the reinstall). One unrelated DB test
  (`oura-ble/live-steps`) needs `DATABASE_URL` exported in-shell to pass under plain `vitest run`;
  confirmed passing once exported — a pre-existing environment quirk, not a regression.
- `tsc --noEmit` clean. `pnpm lint`: 0 errors, pre-existing warnings only. Both custom-rule scripts
  (`check-push-mutations`, `check-reconcile`) pass.
- Updated `complete-workout.test.ts` (dropped the two tests asserting the now-deleted
  `regeneratePrescription` flag) and `next-session/prescription/prescription.test.ts` (the "falls
  back to static once expired" test now asserts the opposite: still drives load past expiry).
- Reproduced the exact production shape on local Postgres: seeded a `session_periodization` row for
  the seed program's "Push" session — `pending`, `transition_recommended`, phase `accumulation`,
  `prescription_expires_at` 2 days in the past, program flipped to `ai_dynamic` +
  `auto_apply_prescriptions = true`. Confirmed via direct API calls (logged in as the seeded
  `test@local.dev` user):
  - `GET /api/ai-periodization/session/[id]` and `GET /api/workout-data?session=...` both leave
    `prescription_status` at `pending` (previously flipped to `dismissed`), and `workout-data`
    still drives load off it (`styleName: "AI · Accumulation"`, `pct: 76` matching the seeded
    prescription).
  - `POST /api/complete-workout` on that session leaves `prescription_status = 'consumed'` with
    `prescription_generated_at` unchanged (no eager regeneration).
  - Reopening the now-`consumed` session returns `aiPrescriptionPending: true`, confirming the
    on-open trigger fires as the (now sole) generation path.
  - Screenshotted `/health` → Training tab (Playwright + the pre-installed Chromium) showing the AI
    Periodization card with "9d ago" / "7d ago" / "No data" in place of the old status dot.
  - Local DB test fixtures reverted to the seeded defaults afterward (program back to `manual`,
    `auto_apply_prescriptions = false`, test rows deleted).

## Not verified

- **The S25 APK.** This change is server routes + one React card with no Capacitor/native/safe-area/
  gesture/notification surface, so there's nothing native-specific at risk, but the actual on-device
  render of the updated card has not been looked at.
- **Real Gemini generation against the new pre-workout trigger timing.** The local sandbox has no
  Gemini key; the trigger firing correctly (`aiPrescriptionPending: true` → fire-and-forget
  `/prescribe` POST) was confirmed, but an end-to-end "open a consumed session → real AI numbers land
  within the poll window" pass needs a real API key or production.
