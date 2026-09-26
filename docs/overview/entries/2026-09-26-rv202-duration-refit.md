# 2026-09-26 — RV-202 ②: a duration change stops asking the model

**Branch:** `feat/duration-refit-without-the-model` · **Lane A** · entry RV-202 item 2

## What shipped

Changing the pre-workout duration preset used to re-run the whole prescription: the lifter watched
"Preparing your AI workout…" for ~30 s and spent a Gemini call so that a deterministic arithmetic
stage could run against a different number. It now re-fits the stored plan and never reaches the
model.

- `packages/shared/src/ai-periodization/budget-stage.ts` (new) — the deterministic tail of
  generation, extracted verbatim from `generate-prescription.ts`: role plausibility, the
  trim/drop/expand direction branch, the duration estimate, `weeklyVolumeContribution` and the
  budget note.
- `packages/shared/src/ai-periodization/refit-prescription.ts` (new) — `refitPrescriptionToBudget`,
  which runs that stage against the stored plan.
- `AiPrescription.refitBaseline` — the pre-budget set counts, the pre-note reasoning, and the
  autoregulation-earned set ids.
- The prescribe route tries the re-fit when the body carries a `durationPreset`, and falls through
  to the existing generation whenever the stored plan cannot answer.

**Measured on the dev server, against a reachable model:** three preset changes added **0 rows** to
`ai_call_log`, at ~0.4 s each. The short leg trimmed the bench 4→2 and dropped the pushdown; long
expanded to 6/6/4; standard returned the original 4/4/3. The stored row's expiry and
`prescription_status` were unchanged across all three.

## The entry's prescribed fix was wrong, and wrong quietly

RV-202 said: *"re-fit the stored prescription with `fitToBudget`."* That does not work, and the way
it fails is invisible.

The budget passes only ever **remove** sets, and a request for the session's own length runs
neither `dropToBudget` nor `expandToBudget` — so a re-fit that starts from the stored, already
trimmed plan can never give sets back. Measured on the fixture, standard → short → standard
returned `{Squat 4, Row 2, Curl 3, Raise 3}` against the correct `{4, 4, 2, 2}`: the Row loses half
its sets permanently, and the accessories keep a count they only ever had because the short plan
*dropped* them rather than trimming them. Nothing on screen says the plan is wrong.

So the pre-budget shape is stored instead, which is the same move `reevaluate.ts` already makes
with `preDeload` — a deterministic re-derivation needs a snapshot of what it is re-deriving from.
Only `sets` is lossy; the budget stage never touches reps, load or rest, so those are read off the
exercise itself.

**"That also works offline" is retracted** too. The re-fit still needs `aggregateSignals` for
weekly volume, time profiles and targets, so it is a server round trip. Computing it on the device
is the local-store work the entry itself puts out of scope.

## Migration

Every prescription already in production has no `refitBaseline` and falls through to a full
generation — which then writes one. Each session self-heals on its next real generation, so there
is no backfill and no migration. Confirmed live: stripping the field sent the request to the model
path, and the plan it stored carried a baseline.

## Mutation pass

10 deliberate defects, all killed; 2 deliberately equivalent controls, both survived.

Two survived the first round and are worth recording, because they were **my test fixture's fault,
not the code's**: flipping the standard preset into `expandToBudget` (`direction >= 0`) and into
`dropToBudget` (`direction <= 0`) both changed nothing, because that fixture happened to sit ~1 min
under its budget — too little slack for an expansion to fit, and no overrun for a drop to fix. Two
direct tests on `applyBudgetStage` now pin both guards: a standard session leaves its surplus alone
(that under-fill *is* the finish-early margin) and reports an overrun as a note rather than dropping
work nobody asked to drop.

## Not done, deliberately

The re-fit still spends the route's `prescribe:` rate limit, which is sized at 20/hour for model
calls — and the comment justifying that number cites preset-switching as the reason it is 20 rather
than 10. Splitting the buckets is a separate change: the limit is a real abuse guard on a path that
still does a full signal aggregation, so it cannot simply be dropped.

## Not verified

No device run. This is server-side only — no native, safe-area, gesture or offline-store surface —
so the APK reaches it through a normal Railway deploy with no rebuild. The exercised surfaces were
the local dev server against the local Postgres; prod-data shapes (a drifted prescription, a
session whose exercises changed after generation) were not.
