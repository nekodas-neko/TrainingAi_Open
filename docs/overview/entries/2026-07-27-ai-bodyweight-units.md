## 2026-07-27 — The AI stops telling you your Pull-Up 1RM is 118 kg (v1.224.0, audit finding Q-19)

Q-12 converted every *display* surface to reps, but ten prompt/context builders still injected the
raw `BW_REF`-relative number into LLM input — and `app/api/ai-chat/route.ts` instructs the model
*"Quote them exactly — NEVER recompute a 1RM"*, so the misreading Q-12 removed from the UI simply
reappeared in chat.

### What shipped

Everything whose text reaches the **user**:

- **`lib/ai-chat/context.ts`** — `build1RmTargets` now emits bodyweight movements as a rep max with
  an explicit *"measured in reps, NOT kilograms"* marker, plus a rep-based working target. The route
  fetches the exercise library to feed it.
- **`lib/ai-chat/tools.ts`** — `getWorkoutsByExercise` and `getPersonalRecords` return a unit
  alongside each estimate rather than a bare `estimated1rmKg` / `recordsKg`. The library is fetched
  once per turn and only if a 1RM-bearing tool actually runs.
- **`lib/ai-periodization/explain.ts`** — the prescription card's rationale bullets. A bodyweight
  "1RM change in kg" is a change in an internal index, so the direction is reported without the
  meaningless magnitude: *"Your rep max is trending up"* rather than *"+3.5kg"*. `exerciseType` is
  threaded through `pre-workout-screen` → `AiPrescriptionCard`, following the existing
  `equipmentById` pattern.
- **Both digests** — the PR line went through a new shared `describePersonalRecord` in `lib/1rm.ts`
  rather than being fixed twice in two places with the same phrasing.
- **`lib/achievements.ts`** — the kg milestones ("Achieve 100kg squat 1RM") now exclude bodyweight
  PRs at the query. `prFor` matches by **substring**, so a bodyweight movement whose name contains
  "squat" — a Pistol Squat, say — would have unlocked Century Squat the moment it was first logged,
  at its `BW_REF`-relative value. Nothing in the library does today; this stops it becoming true.

### Verification

Full CI-equivalent suite **2,394 passing** (7 new), typecheck, lint and both custom-rule checks clean.

**End-to-end on `pnpm dev`**, against a local Pull-Up PR of 118 (bodyweight):

| question | answer |
|---|---|
| *"what is my pull-up PR?"* | **"6 reps (bodyweight)"** — previously would have been 118 kg |
| *"what is my bench press PR and my target working weight?"* | "98kg … target working weight is 78.5kg" — unchanged |

`/api/achievements` still resolves the kg milestones correctly through the new join (squat 130,
bench 98, deadlift 160), and the Pull-Up PR is correctly absent. `/api/daily-digest` returns 200.

New tests assert the properties rather than the strings: a bodyweight rationale contains **no**
`kg` on any trend direction, and `describePersonalRecord` never renders a bodyweight record as a
weight.

**Not exercised — on-device.** No native path, but the prescription card's bullets have not been seen
on the S25.

### Left for later (Q-19b)

Three **model-input-only** builders still pass kg, where a wrong unit can skew a prescription but is
never quoted at the user: `lib/ai-periodization/prompt.ts:196`, `lib/workout/review/prompt.ts:56`,
and `app/api/nutrition-goals/recommend/route.ts:88`. Each needs `exerciseType` threaded into a
builder that doesn't currently fetch it — more plumbing than the user-facing half, for less benefit.
