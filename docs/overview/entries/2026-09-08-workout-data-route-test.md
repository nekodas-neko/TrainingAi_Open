# 2026-09-08 — `workout-data` gets tests, closing the twelve (PS-39)

**Branch:** `test/workout-data-route` · **Lane:** A · tests + docs only, no product code.

## What shipped

`lib/__tests__/workout-data-route.test.ts` — 29 cases against `app/api/workout-data/route.ts`, the
last of the twelve routes #956 found were *believed* tested and were not, and the biggest: 600 lines
behind one GET serving three shapes off a query param. Its own source calls it "one of the two reads
the whole offline architecture leans on".

Four of the pinned behaviours have a production incident named in the code beside them, and every
one is invisible from the response shape:

- **A poll must not fire generation.** The pre-workout screen polls every ~3s while a prescription
  regenerates; without the guard each tick fired a fresh generation, turning one into a burst of ~8
  Gemini calls that tripped the per-minute limit and 502'd them all.
- **A poll must not be HTTP-cached.** With `max-age=30` the browser re-served the first poll's
  `aiPrescriptionPending: true` for the entire window, so the client never saw the prescription that
  landed mid-window and timed out into "couldn't generate" — while generation had succeeded
  (prod 2026-07-19). A poll gets bare `no-store`, a normal read `private, no-store`.
- **`?tab=all` is strictly read-only** — no generation, no writes, no re-evaluation. Pinned by the
  reads that path must *not* make, not by its output.
- **The two deload entry points converge.** The pre-workout toggle sends `?aiDeload=1`; Home's "Take
  deload week now" writes `earlyDeloadWeekStart` and sends no param at all. The second arrived a week
  late and produced byte-identical full-intensity prescriptions for a whole confirmed deload week
  (Q-175). Both are pinned, along with a week that has already ended.

Also pinned: session identity is the **DB id** — a name and an unknown id both answer
`sessionNotFound`, with no `sessions[0]` fallback that would silently serve the wrong session's
numbers; an exercise counts as done today only within *this* session, so a shared movement logged
elsewhere does not tick here; the day is keyed to the user's timezone; a thrown read reaches
`reportServerError` before the 500; no active program answers empty rather than erroring; `?tab=meta`
reports the **furthest-progressed** session as the program phase status, not the first listed; the
stale-baseline guard is program-scoped; a stored prescription is normalised before it reaches the
bar and a dismissed one drives nothing — including its drops; and the consumption-day re-evaluation
fingerprint skips the heavy reads on a repeat fetch while re-running the moment a check-in moves.

`scripts/check-route-test-coverage.js` baseline 125 → **124**. **All twelve are now covered.**

## Notes

- **Sixteen mutations**, all caught: the poll guard, the poll cache header, a name/first-session
  fallback, dropping the early-deload week, unscoping logged-today, unscoping the baseline lookup,
  removing the observability call, making `?tab=all` regenerate, inverting the re-evaluation
  fingerprint in both directions, ignoring prescription status, dropping the read normalisation, not
  gating on baseline, ignoring the timezone, taking the first session as phase leader, and dropping
  the drives-load condition on this cycle's drops.
- `buildWorkoutExercises` and `buildAutomaticPhaseStatus` are mocked — both are large shared
  functions with their own tests, and mocking them is what lets the cases assert on the **decisions**
  this route makes (does the AI drive load, is deload active, what is dropped) rather than on a
  rendered exercise list. `isEarlyDeloadWeek`, `prescriptionDrivesLoad`, `isAiPrescriptionPending`
  and `normalizeStoredPrescription` are real: they *are* the decisions.
- The long tail has no shortlist now. The next coherent batch is the four remaining
  `ai-periodization` routes — `baseline/complete`, `program-overview`, `…/transition`,
  `weekly-volume` — which share fixtures with the file that landed in #966.
- **One finding filed while doing this: LA-77.** `pnpm lint` reports 290 warnings and 0 errors, and
  **174 of them (60%) are the deliberate `'_x' is defined but never used`** convention every mocked
  `vi.fn` signature in this repo uses on purpose. The other 60 are genuine dead code — an unused
  `clamp`, an unused `gte`/`sum` import pair, a `req` a handler stopped reading — sitting in a list
  nobody can read. One config line (`argsIgnorePattern: '^_'`) turns it back into signal. Filed
  rather than fixed here: `eslint.config.mjs` is repo tooling, in neither implementer lane.
