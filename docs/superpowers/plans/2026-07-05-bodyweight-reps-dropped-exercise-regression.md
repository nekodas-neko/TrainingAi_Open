# Bodyweight-Reps Remap Gate: Fix the Dropped-Exercise Regression

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Bug (shipped, live on `main`):** PR #233
(`2026-07-05-bodyweight-reps-ai-prescription-override.md`) correctly stopped the
bodyweight rep-remap from overwriting the AI's prescribed reps — but it gated the remap
on the **session-level** `aiDrivesLoad` flag rather than a **per-exercise** "did the AI
actually prescribe this exercise" check. The `2026-07-05-workout-backlog-review.md` §1
flagged this as a blocker before #233 merged; it shipped with the session-level gate
anyway, so the regression is now in production.

**Current shipped code** (`app/api/workout-data/route.ts`):

```ts
// ~line 314 — AI override only replaces the style when the prescription CONTAINS the exercise:
if (aiDrivesLoad) {
  const p = aiPrescription!.exercises.find(e => e.sessionExerciseId === ex.id)
  if (p) {
    progressionStyle = prescriptionStyleForExercise(p)   // AI's own reps
    ...
  }
  // else: exercise absent from the prescription → keeps its STATIC style (comment at :308)
}

// ~line 346 — remap now skipped for the WHOLE session when the AI is driving:
if (bwType === 'bodyweight' && progressionStyle && !isBaselinePhase && !aiDrivesLoad) {
  const basis = Math.max(lastLog?.estimated1rm ?? 0, prMap.get(ex.exerciseName) ?? 0);
  progressionStyle = rescaleBodyweightReps(progressionStyle, basis);
}
```

**The regression:** the model **dropping a `session_exercise_id` from its response** is a
known live incident (projectOverview Known Issues; also the target of the queued
`ai-prescription-response-reconciliation` plan). When that dropped exercise is a
bodyweight movement, `aiDrivesLoad` is still `true` for the session, so the remap is
**skipped** — and because the exercise fell back to its static style, its bodyweight
reps are now served **raw and un-rescaled** (the static style's stored `reps`, which for
a bodyweight exercise on an AI-dynamic program are placeholder/pct-oriented, not a real
rep target). Before #233 the remap ran unconditionally and *would* have rescaled them
sensibly. So #233 made the dropped-bodyweight-exercise case worse — the exact failure
mode §1 predicted.

**Fix:** gate the remap on a **per-exercise** flag that is true only when an AI
prescription style was actually applied to *this* exercise — not on the session-level
`aiDrivesLoad`. A bodyweight exercise that fell back to the static style then still gets
the remap (correct); an AI-prescribed exercise keeps the AI's reps untouched (the #233
fix, preserved).

**Tech Stack:** Next.js 15 API route, TypeScript, vitest. No schema/migration change.

**Interaction with the `ai-prescription-response-reconciliation` plan:** that plan
backfills dropped exercises with a real (zone-midpoint) prescription, which would make
most dropped-exercise cases take the AI path instead of the static fallback — reducing
how often this regression triggers. This fix is still the correct defensive change: it's
the right behaviour for *any* static-fallback bodyweight exercise inside an AI session
(reconciliation disabled, an exercise deliberately on static style, etc.), and it's a
one-condition change. Land either order; they don't conflict (different routes).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `app/api/workout-data/route.ts` | Modify | Track a per-exercise `aiStyleApplied` flag; gate the remap on it |
| `lib/__tests__/` (see Task note) | Add/Modify | A test that locks the dropped-bodyweight-exercise behaviour |

The core logic (`rescaleBodyweightReps`) is already a tested pure function in `lib/1rm.ts`
(extracted by #233) — this plan does **not** touch it. Only the route's gate changes.

---

### Task 1: Gate the bodyweight remap on a per-exercise `aiStyleApplied` flag

**Files:**
- Modify: `app/api/workout-data/route.ts`

- [ ] **Step 1: Introduce the per-exercise flag**

In the per-exercise mapping, alongside the other `let` declarations that precede the
`if (aiDrivesLoad)` block (`lastSetMode`/`deloaded`/`preDeloadStyle`/…, ~line 309), add:
```ts
      let aiStyleApplied = false
```
Then inside the `if (p) { ... }` branch (where `progressionStyle =
prescriptionStyleForExercise(p)` is assigned, ~line 316), set it:
```ts
        if (p) {
          aiStyleApplied = true
          progressionStyle = prescriptionStyleForExercise(p)
          ...
        }
```

- [ ] **Step 2: Change the remap gate**

Replace the gate condition (~line 346):
```ts
      if (bwType === 'bodyweight' && progressionStyle && !isBaselinePhase && !aiDrivesLoad) {
```
with:
```ts
      // Only for the STATIC style. An exercise the AI actually prescribed keeps the AI's
      // own bodyweight reps (aiStyleApplied); one the AI *dropped* fell back to the static
      // style and must still be rescaled — gating on the session-level aiDrivesLoad instead
      // would leave a dropped bodyweight exercise showing raw, un-rescaled static reps.
      if (bwType === 'bodyweight' && progressionStyle && !isBaselinePhase && !aiStyleApplied) {
```
Update the block's existing comment above it (the "Only for the STATIC style — an
AI-driven prescription already decided…" comment) to match this per-exercise framing.

- [ ] **Step 3: Lock the behaviour with a test**

`app/api/workout-data/route.ts` has no route-level test harness in this repo (routes are
integration-tested via the dev server, and the pure math already lives in `lib/1rm.ts`).
Two options — pick whichever the implementer can make robust:

- **Preferred:** extract the per-exercise style-resolution decision (the "AI style vs
  static-then-remap" choice) into a small pure helper in `lib/` that takes
  `{ prescribedStyle | null, staticStyle, bwType, isBaselinePhase, basis }` and returns
  the final style, then unit-test it — asserting that a bodyweight exercise with
  `prescribedStyle === null` (dropped) **is** remapped even though the session is
  AI-driven, and one with a real `prescribedStyle` is **not**. This also removes a chunk
  of branching from the already-large route.
- **Minimal:** if extraction is judged too invasive for this fix, add a focused test on
  `rescaleBodyweightReps` plus an explicit comment/regression note at the gate, and rely
  on the Step-4 dev-server check for the integration behaviour. State clearly in the PR
  that no automated test covers the route gate itself.

- [ ] **Step 4: Verify + dev-server check**

Run: `pnpm test && npx tsc --noEmit && pnpm lint` — all green.

Then exercise it on the dev server (⚠️ note: `/api/log-exercise` currently 500s on
`pnpm dev` — see `2026-07-05-log-exercise-turbopack-dev-fix.md`; if that item hasn't
landed yet, verify against `next build && next start` instead). Confirm the
`GET /api/workout-data` response for an AI-dynamic session:
- an AI-**prescribed** bodyweight exercise shows the AI's reps (unchanged from #233), and
- a bodyweight exercise **absent** from the prescription shows rep-max-rescaled reps, not
  the raw static-style numbers.
Seeding a dropped-exercise prescription end-to-end needs a realistic AI-dynamic history
+ a Gemini call; at minimum, construct the two-exercise case directly (one prescribed,
one not) and confirm the served styles differ as expected.

- [ ] **Step 5: Commit**

```bash
git add app/api/workout-data/route.ts lib/  # + any extracted helper/test
git commit -m "fix: rescale bodyweight reps for exercises the AI dropped from its prescription"
```

---

⚠️ **Not exercised:** the exact production reproduction (needs the model to actually drop
a bodyweight exercise on a real AI-dynamic session — same data-access limits noted in the
original #233 plan's confidence note) and native/on-device behaviour (server-side route
change, no device surface).
