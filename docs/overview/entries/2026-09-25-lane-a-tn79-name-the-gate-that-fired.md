# TN-79 — one reason string meant two things, and that is why Q-270 sat five weeks

**Branch:** `lane-a/tn79-name-the-gate-that-fired` · Lane A · one string, one type, three tests.
**No user-visible change** — `training_load_gate` is an internal diagnostic column, so no version
bump.

## The finding

`computeTrainingStress` returned `insufficient_met` from **two unrelated places**: the MET floors
(`training-stress.ts:72`) and *"the scorer returned nothing"* (`:82`). `training_load_ots` is NULL
on all 130 of the owner's days; the 21 days that recorded a gate all read `insufficient_met`. So
every investigation read that string, went to the MET stream, and found nothing wrong — correctly,
because nothing is wrong with it.

**Confirmed by replay, not inference.** The owner's stored `0x50` frames were pulled from production
and pushed through the repo's own `metGridFromDaytimeSamples`:

| day | grid minutes | valid minutes | ≥720 | ≥360 |
|---|---:|---:|---|---|
| 09-18 | 1428 | 981 | ok | ok |
| 09-20 | 1440 | 892 | ok | ok |
| 09-23 | 1421 | 1073 | ok | ok |
| 09-24 | 1442 | 1185 | ok | ok |

Eight of nine recent days clear **both** floors; only the two partial edge days fail, as expected.
The upstream gates are ruled out too — `readiness_source` is `ble-derived` with real scores (44–59),
and DOB, sex and RHR are all present, so it is not `no_readiness`, `readiness_learning` or
`no_profile`.

So the gate is at `:82`, and the string blamed the wrong half of the pipeline. This PR gives that
case its own name, `scorer_no_output`. Nothing branches on the value — the only references were the
type and the two producers — so the change is a rename plus a type widening, and one day of
production now says which half it is.

## Two hypotheses I formed, stated confidently, and killed

Recording both, because each is a plausible place for the next session to restart and each is a
dead end.

**① `validate()` rejects any NaN, and grid gaps become NaN.** `computeTrainingStress` builds
`v == null ? NaN : v`, the grid is sparse, and `ots.ts:36` rejects any NaN when `noOts === 0`. That
is all true of the code and is **not** the cause: a gap-filled series with **zero** nulls still
returns null.

**② The scorer never works at all.** A uniform, dense, valid series returned null at every length I
tried. But `inference/__tests__/ots.test.ts` holds golden-vector tests that produce real scores, so
that conclusion was wrong too.

**The sandbox cannot settle the rest, and that is the useful part.** Those golden tests are
`skipIf(!hasRealConstants())`, and `lib/oura-models/constants/MANIFEST.json` is absent from the
public repo and from CI — it is in `private-paths.json`. So "returns null here" says nothing about
production, where `resilience_level` **is** populated and therefore *some* model constants do load.
`constants/index.ts:45` records that production downloads them at boot, and warns in the next
comment that *"boot does not necessarily run in the process that serves"*.

**The next step is a read, not a change:** once this deploys, see whether those days report
`scorer_no_output`. If they do, the question becomes whether
`training_stress_score_0_2_1.constants.json` is loaded in the serving process — and nothing about
MET.

## A separate finding, filed as LA-139

The clock-anchor table holds **12,545** rows, and of the 40 most recent consecutive pairs **39
disagree by more than 60 s** about the ring's clock rate, worst **56 minutes**; three anchors
written within 4 real seconds carry ring times ~19 minutes apart. **It is not TN-79's cause** — the
replay above used that same newest anchor and still produced sensible per-day buckets — but a table
growing at ~170 mutually-inconsistent rows a day is worth its own entry.

## Verification

`tsc` clean · `typecheck:tests` clean (318 / 89, none above baseline) · lint clean · Custom Rules
**78 of 78** · full suite **9,742 passed**, with one file (`oura-ble-daily-summary.test.ts`) failing
only under parallel load on the documented `ensureSchema … 080_lowercase_muscle_groups.sql`
contention residue — **4/4 in isolation**, and it does not import anything this PR touches.

Mutation pass — **4 mutants, 4 killed**, 1 equivalent control survived:

| mutant | outcome |
|---|---|
| revert the split (both causes share `insufficient_met`) | killed |
| rename the honest short-series case too | killed |
| raise the `validMin` floor to 1400 | killed **after** the test was strengthened |
| *control:* the two floor checks reordered | survived, correctly |

**The third mutant survived the first pass**, and the reason is worth keeping: my sparsity test
asserted the minute counts but never asked the gate, so a test titled *"sparsity alone does not trip
the MET floors"* did not actually check that the floors let it through. It calls
`computeTrainingStress` now.

**One more process note.** The new spec initially used an `as never` cast and put 3 errors through
`typecheck:tests` — the third time this session that gate has caught what `tsc` cannot see, because
`tsconfig.json` excludes `__tests__`. Typed properly now (`Omit<TrainingStressInputs, …>` and an
explicit `Vo2MaxInputs`), with no baseline row added.

I also removed an environment-dependent assertion before it shipped: one test pinned
`status === 'gated'`, which holds only where the vendor constants are absent. With them present the
scorer returns `ok` and the test would have failed — so it now asserts the invariant that holds in
both: a long series is never blamed on the MET stream.
