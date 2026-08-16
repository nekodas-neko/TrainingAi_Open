# Next-workout prescription on the completion screen

**Status:** planned (PR-1 planning). Owner-requested in-session 2026-07-14.
**Branch (implementer):** `feat/next-workout-prescription-preview`

## Goal

On the workout-completion ("done") screen, add a **tap-to-load** card that shows the
prescription for the **next scheduled session** — its per-set weights / reps / rest,
driven by the same dynamic AI-periodization assignments the workout screen will apply
when the user actually starts that session. Owner's framing: "if it's a Legs session,
the next prescription of weights/rest/set etc. based on our dynamic AI assignments."

This replaces the per-exercise "Next Session" card that used to live on the
exercise-summary screen (removed 2026-07-14, same session as this plan) — that card
only showed the next time you'd repeat *that one exercise*. The owner wants the next
*workout's* full prescription at completion instead.

## The hard constraint that shapes the design (why not just reuse `/api/workout-data`)

The obvious shortcut — have the done screen call
`/api/workout-data?session=<nextSessionName>` and render its computed
`progressionStyle` per set — is **wrong**, because that route has **side effects keyed
on "today"** (`app/api/workout-data/route.ts`):

- **Consumption-day re-evaluation** (lines ~268–339): if the stored prescription was
  generated on a prior day and not yet `reevaluatedForDate === todayStr`, it re-derives
  soreness/injury deloads against **today's** signals and **writes the result back**
  (`updatePrescriptionExercisesCache`, stamping `reevaluatedForDate = todayStr`).
- **Expiry enforcement** (lines ~263–267): flips a past-expiry prescription to
  `dismissed`.
- **Failed-generation retry / regenerate** (lines ~328–333, ~347–353): fire-and-forget
  POSTs to `/api/ai-periodization/session/{id}/prescribe`.

Calling that for the **next** session (which is *not* today's session) at completion
time would mis-stamp a future session's prescription with today's re-evaluation and
potentially dismiss/regenerate it early — corrupting the exact prescription the owner
wants to preview. **The preview must be a read-only path.**

## Design: a new read-only endpoint

`GET /api/next-session/prescription` — no writes, no fire-and-forget regeneration, no
`reevaluatedForDate` stamping. SWR headers `private, max-age=60, stale-while-revalidate=120`
(match siblings). Standard auth + the app's default rate limit for a non-trivial route.

### Computation (reuse existing helpers — do not re-derive any formula)

1. `repo.getNextSession(userId, tz)` → next `ProgramSession` (+ `isRestDay`). Mirror the
   dropped-exercise filter that `app/api/next-session/route.ts` already applies
   (`prescriptionDrivesLoad` + `droppedExerciseIds`).
2. If `isRestDay` → return `{ isRestDay: true }`.
3. For the next session's exercises, in parallel (read-only):
   - `repo.getLastExerciseLogsBatch(userId, exerciseNames)` and
     `repo.listPersonalRecords(userId)` → per-exercise 1RM **basis** =
     `max(lastLog.estimated1rm ?? 0, prMap.get(name) ?? 0)` (identical to
     `workout-data` line ~439).
   - `repo.listProgressionStyles(userId)` → the exercise's static per-set style
     (its `styleId`).
   - If the program is `ai_dynamic`: `repo.getSessionPeriodization(userId, session.id)`
     → the **stored** prescription. Use it **only if**
     `prescriptionDrivesLoad(prescription.phaseAction, prescriptionStatus)` **and** it
     is not past `prescriptionExpiresAt` — but as a **pure read** (compute the boolean;
     do **not** call `updatePrescriptionStatus`/`updatePrescriptionExercisesCache` the
     way `workout-data` does). If a prescription drives an exercise, expand it with
     `prescriptionStyleForExercise(presc)` (`lib/ai-periodization/apply-prescription.ts`);
     otherwise fall back to that exercise's static style.
4. Per set: `weight = mroundStepUp(basis * pct / 100, weightStepFor(equipment))`,
   `reps`, `restSec` — reuse `components/workout/utils.ts` helpers (or their lib
   equivalents); **do not** hand-roll rounding.
5. Bodyweight exercises: mirror the removed card's rep-target logic
   (`repMaxFromOneRm`) rather than showing kg.

### Response shape (sketch)

```ts
{
  isRestDay: boolean
  sessionName?: string
  // 'driving' = AI prescription in effect; 'static' = base style; 'pending' = AI
  // program but no usable stored prescription yet (generated fire-and-forget at
  // completion, may not have landed) — UI shows a "generating" note.
  source?: 'driving' | 'static' | 'pending'
  exercises?: Array<{
    name: string
    exerciseType: ExerciseType
    sets: Array<{ weightKg: number | null; reps: number; restSec: number }>
  }>
}
```

### Edge cases the endpoint must handle honestly (no silent fallback)

- **AI program, no stored prescription yet** (`prescriptionStatus === 'consumed'` &&
  `prescription == null`, or none generated): return `source: 'pending'` — the UI shows
  "Your next prescription is still being generated — it'll be ready when you start."
  The endpoint must **not** trigger generation (the completion path already did).
- **Non-trivial pending recommendation** (phase transition / deload / session swap /
  rest-day) that does **not** drive load yet: prescription is advisory, so fall back to
  `source: 'static'` for the loads and (optionally) surface the recommendation text.
- **No 1RM history** for an exercise (basis 0): `weightKg: null`, show "—".

## UI (done screen)

`components/workout/done-screen.tsx` — add a card following the **Recap / HR** pattern
(tap-to-load button, not auto-fired — the user is leaving this screen; per CLAUDE.md
"don't auto-fire slow external round-trips on screens the user is trying to leave"):

- Header "Next workout" + a "Show" button (→ "Loading…" → rendered).
- On tap: `fetch('/api/next-session/prescription')`.
- Rest day → "Next up: a rest day 💤" (icon, not emoji — use a Lucide icon).
- Else render `sessionName` + a compact per-exercise list; each exercise shows its
  per-set `weight × reps` chips + rest, same visual language as the ready screen's
  "Set targets" card. `source: 'pending'` → the generating note above.
- Extract the card into `components/workout/next-workout-card.tsx` (done-screen.tsx is
  already large) and static-import it (lightweight data card — **not** `dynamic`, per
  the instant-paint rules).

## Offline-first / device notes

- This is a **cross-session, server-assembled aggregate** (next session + AI
  periodization + PRs across exercises), so a server-only `fetch` read is the
  **sanctioned exception** pattern (same class as the `next-session` home card and
  `home-day-timeline`) — it does **not** need a local-store read path. It simply shows
  a failure/empty state offline. Give the self-fetch an explicit error state
  (`cachedFetch` swallows `!res.ok`).
- **Device verification required** before calling done:
  `docs/device-smoke-checklist.md` — complete a workout on the APK, tap "Show next
  workout", confirm the loads match what the next session actually opens with. Until
  then, a `projectOverview.md` Known-Issues row marks it not-yet-device-verified.

## Out of scope

- Any change to how prescriptions are *generated* (this is display-only).
- Time-budget / muscle-volume *re-optimization* at completion — the next session's
  structure (exercise list, sets) is already fixed by the program / the stored
  prescription; this card previews it, it does not re-plan it. (The owner's "without
  knowing full workout / time / volume" worry only applies to re-planning, which we're
  explicitly not doing.)

## Files

- **New:** `app/api/next-session/prescription/route.ts`,
  `components/workout/next-workout-card.tsx`.
- **Edit:** `components/workout/done-screen.tsx` (mount the card).
- **Reuse (no changes):** `lib/ai-periodization/apply-prescription.ts`
  (`prescriptionDrivesLoad`, `prescriptionStyleForExercise`),
  `components/workout/utils.ts` (`mroundStepUp`, `weightStepFor`), `lib/1rm.ts`
  (`repMaxFromOneRm`), repository methods listed above.

## Verification

- Unit: endpoint returns `driving` loads when a stored prescription drives load,
  `static` when it doesn't, `pending` when AI + no prescription, `isRestDay` on a rest
  day — with **no** writes (assert no repo mutation methods called).
- `pnpm dev`: complete a session as the seeded AI-dynamic user, tap the card, confirm
  loads match `/workout` for the next session.
- On-device smoke (owner) — the real gate.
