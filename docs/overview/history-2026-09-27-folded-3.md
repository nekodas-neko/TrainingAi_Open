# Session journal — batch folded 2026-09-27

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-09-26-review-sweeps-60-64-routing"></a>

# 2026-09-26 — Review: route sweeps 60–64, and hand the baton on to "awaiting a brief"

**Branch:** `review/sweeps-60-64-routing` · **Agent:** Review · **Docs only.**

- **RV-221 (Lane O, `Ask:`)** collects what sweeps 60–64 need from the owner:
  - the RV-213 mockup;
  - the daily calorie target (RV-218);
  - a merge-time yes on six security fixes;
  - pointers to RV-199 ② and RV-65.
- **RV-220 is now DV's single consolidated pass for Review:**
  - capture fixes first;
  - P41 before and after on RV-207's shipped fixes;
  - RV-206 P29–P38 (OR-176 gave standing approval);
  - the rest of RV-205;
  - a hidden-tab animation check.
- **RV-212 ⑤ dropped.** On the device, adherence reads 14% and 39% against three required meals;
  the web build's 0% came from the seed data.
- **The Review baton is rewritten.** It had stood at sweep 53 (next ID RV-123), and now reads
  sweeps 54–64 with next ID RV-222. It also records how screenshots reach Review and the
  public-repo security rule.

<a id="2026-09-26-rv200-running-plan-explain"></a>

# RV-200 item 3 — a model call that reworded a sentence already on the screen

**Branch:** `lane-a/rv200-ai-rewording` · **Lane A + B** · `[platform][cardio]`

One of RV-200's four. The owner's request is the product decision behind it: *"we use AI more than
we need to … use logic instead to save on tokens and offline compatibility."*

`POST /api/running-plan/explain` took the deterministic `rationale` the prescription already
carried, asked the model for a warmer sentence, and the card swapped it in when it arrived. The
route's own header called it "never load-bearing". The claim checked out exactly: `prescribed-run-card.tsx`
rendered `{aiMessage ?? rationale}`, so the user saw the deterministic text first and a reworded
version of the same thing a moment later.

Route, fetch effect, cache key module and its TTL are gone. The card renders `{rationale}`.

## Three things depended on it that the entry did not name

- **`lib/ai/degrade.ts` cited it as the reference implementation** for the whole degrade-don't-500
  pattern. Re-pointed at `ai/health-insight`, which the same comment already called "the second
  precedent, and the more exact one". The note now also says why this route stopped being a good
  reference: a route whose degraded answer is its own input never needed the model.
- **`ai-prose-routes-fail-safe.test.ts`** pinned its 200-with-rationale behaviour as one of two
  documented fail-safes. That block is removed and the header explains what happened to it.
- **`prose-guards.test.ts` carried `expect(prose.length).toBeGreaterThanOrEqual(7)`** — a tripwire
  against a scan that silently matches nothing. Now 6, with a note that it is a floor rather than a
  target.

## A gate failure worth remembering

`check-tab-navigation` died with `ENOENT` on the deleted route. Several checks enumerate source with
`git ls-files`, which lists what the index holds — so a file removed with `rm` but not staged is
still in the list and no longer on disk. **Stage a deletion before running the gate**, or the
failure names a file you have already deleted and reads as nonsense.

Deleting `.next` was also needed: its generated route types referenced the removed file and failed
`tsc`. Hand-editing the generated validator made it worse; removing the build cache is the fix.

## Verification

No new tests — this is a deletion, and the property that matters (the card shows the deterministic
rationale) was already true and is now the only path. The suites that covered the route are removed
or adjusted with their reasons.

Gates: `lint` 0 · `tsc` 0 · `typecheck:tests` 0 · `check:rules` 0 (79 of 79) · pointers 0 · full
suite **9,960 passed**.

## Not exercised

- **The card was not rendered.** The change is a deletion plus one JSX expression, typechecked, but
  nothing opened the Running screen — on the device or in a browser.
- **Offline behaviour is improved by construction rather than measured**: there is no fetch left to
  fail. The entry's "renders with the network off" bar is met for this surface in the sense that
  nothing network-dependent remains on it, which is not the same as having watched it offline.
- **Items 1, 2 and 4 of RV-200 are untouched and unverified.**

<a id="2026-09-26-rv201-computed-health-insight"></a>

# 2026-09-26 — RV-201 ①: the health insight is written from the numbers, and one of them was `[object Object]`

**Branch:** `feat/rv201-computed-health-insight` · **Lane A** · closes `RV-201`'s health-insight
half and `PS-31(a)`, files `LA-152`

## What shipped

`app/api/ai/health-insight` no longer calls a model. It was the app's most-called prose route —
**28 calls in 30 days**, measured against `ai_call_log` — and every fact it sent the model was
already computed in the handler. The model supplied phrasing, and phrased badly often enough to
matter: 16% of 117 audited insights carried a superlative or an imperial unit, one of them calling
a score of 80 "perfect" (Q-292).

The owner's decision of 2026-09-25, recorded on `RV-200`, covers this: *"we use AI more than we
need to … use logic instead to save on tokens and offline compatibility."* No further gate.

`insight-text.ts` renders the four things the prompt was asking for — headline and band, weakest
contributor, today placed against the recent values, and an explicit sentence for anything not
measured. It works offline, costs nothing, and cannot invent a number or a judgement.

## The defect this found, which was not what the entry was about

Running the route against the dev server — rather than reading it — returned this:

```
The weakest contributor is checkin at [object Object]/100. Also recorded — Contributors:
checkin [object Object]/100, hrvBalance [object Object]/100, …
```

Confirmed against production the same hour. **Two shapes live in one column name.**
`oura_daily.readiness_contributors` holds `{ hrv_balance: 90 }`; `oura_daily_derived`, which the
app writes and which this route PREFERS when present, holds
`{ hrvBalance: { score, input, gap, provisional } }`. `formatContributors` assumed the first — so
every readiness insight this route has ever produced was built on `[object Object]`, and handed
to the model as fact.

A second fault rode along: the derived row's keys are camelCase and the label map is snake_case,
so even the names rendered raw, and three keys (`checkin`, `temperature`, `prevDayActivity`)
differ by more than casing and had no label at all.

**Nothing could have caught it by reading.** The one caller wrote
`as Record<string, number | null>` on the row. That cast made the wrong shape typecheck, so the
compiler, the tests and any review were all looking at an assertion rather than the data — and
the route's own tests mocked contributors as plain numbers, so they agreed with the cast. The
dev-server run is the gate CLAUDE.md requires before a merge, doing precisely its job.

Fixed here: `lib/oura/contributors.ts` reads `.score` from either shape and takes `unknown`
rather than a lie, `labelFor` matches both casings, the three renamed keys have labels, the cast
is gone. Recorded as `LA-152` so the next reader of those columns does not rediscover it.

## Verification

- **Live, on `pnpm dev`, all four sections** — the readiness insight now reads
  *"The weakest contributor is Activity balance at 0/100. Also recorded — Contributors: Activity
  balance 0/100, Previous day activity 0/100, Morning check-in 50/100, …"*. Every key a human
  label, every value a number.
- Mutation pass, 5 mutants + 1 equivalent control. **M2 survived the first attempt**: appending
  the absent labels to the readout went uncaught, because the assertions looked for `Steps: ` and
  a bare label slipped through — the Q-353 defect class exactly. Added an assertion that an
  absent label appears only in the absence sentence, confirmed it kills the mutant.
- 18 contributor tests, including one that asserts every `READINESS_WEIGHTS` key resolves to a
  label; 23 route/builder tests.

## Four couplings moved with it

Three were recorded in advance by `RV-200`, which is why they cost minutes rather than a session:
`lib/ai/degrade.ts` cited this route as *the* reference implementation, `prose-guards.test.ts`
floored the prose-route count at 6 (measured 5 now), and its `PROSE_ROUTES` list named the file.
The fourth: `prompt.ts` no longer builds a prompt, so it is `metrics.ts`.

`stale-cache.test.ts` became `reflects-current-readings.test.ts`. Q-293 — an insight written
before the ring synced being served all afternoon — is now structurally impossible rather than
guarded, so the file asserts the property (output tracks current data, no row read or written)
instead of the mechanism that delivered it.

## Not done, deliberately

The **weekly-digest half of RV-201**. Split by surface: the two share no code and the done-when is
per-surface, while `main` merged five times during this half alone. The entry now carries that
reasoning and keeps the weekly-digest work queued.

**Not device-verified** — no APK run. The change is server-side and reaches the device through a
normal Railway deploy, but the card itself was seen only at the dev server.

<a id="2026-09-26-rv201-weekly-digest-offline"></a>

# 2026-09-26 — RV-201 ②: the weekly recap is a cached GET, and its prose is computed

**Branch:** `feat/rv201-weekly-digest-offline` · **Lane A** · closes `RV-201` (second half) and
`PS-31(a)`/`PS-31(b)`.

The first half took the model out of `ai/health-insight` (#1726). This is the other surface named
in the same entry, and the same move: `weekly-digest` no longer calls a model, and the route it
exposes is now a GET the client can cache.

## What shipped

- **`GET /api/weekly-digest`, and no POST at all.** Every number in the recap was already computed
  deterministically before the model was ever called — the model only wrote sentences about them.
  `buildWeeklyDigestText` (moved into `packages/shared/src/health/weekly-digest-metrics.ts`) now
  writes them, from the same `WeeklyDigestMetrics`.
- **The method was the point, not tidiness.** `cachedFetch` only caches GETs, so while this was a
  POST the week page's charts had no offline copy to paint from. There is deliberately no POST
  alias: it would be a path a future caller could take and silently lose that.
- **Both surfaces read one shared key**, `weekly-digest:<recap-week-monday>`, through
  `useCachedValue` with `WEEKLY_DIGEST_TTL`. Whichever of Home's banner and `/health/week` opens
  first pays for the request.
- **What went with the model:** the per-week `ai_health_insights` row, the 3-per-minute rate limit,
  and the `degradedFromFacts` catch path. The limiter guarded a paid call; a limiter over
  arithmetic is a way to fail a request for no reason. Rows written before this stay for history.
- **`useCachedValue` gained `reloadToken`** — the retry affordance for a card that failed. A
  refetch, not an `invalidateCache` of the key: purging throws away the best thing left to show,
  and a component calling `invalidateCache` is the #1279 shape the Custom Rules gate refuses.

## Three defects the work surfaced, none of them in the entry

1. **The banner's own `ta_weekly_recap_v1_<week>` localStorage entry was a second cache under the
   app's.** Nothing invalidated it, so a recap fetched before a late-logged Sunday session stood
   until the week rolled over. Gone; the shared key is cleared by four write groups
   (`invalidateWorkoutSummaries`, `invalidateOuraSync`, `invalidateBodyMetricWrite`,
   `invalidateBiometrics`).
2. **A hook cannot be skipped.** Moving the fetch into `useCachedValue` would have made a
   *dismissed* banner fetch on every Home mount, where it previously fetched nothing. The fetch
   lives in a child the dismissed branch never mounts. The source-scan test pins that ordering.
3. **"first week of data" was a false claim about the account.** The percentage is null both when
   there is no prior week and when the prior week logged no tonnage — a deload, or a pure-cardio
   week. The sentence is now reserved for a prior week with no sessions at all.

Two more came out of reading the rendered output rather than the code: the recovery bullet hung
one `overnight HRV` label off the front of a joined list, so a week without HRV read
"Recovery — overnight HRV readiness down 5 to 66"; and a sleep delta below the printed precision
rendered as `+0.0 h`, asserting a change the number beside it contradicted.

**`friendCount` is deliberately not rendered.** The prompt's line was "Friends training that week:
3 friends connected" — the value is how many friends are connected and says nothing about whether
any of them trained. Handing that to a model invited the claim that they had.

## Verification

- Full suite **10,254 passed / 87 skipped, exit 0**; lint **831**, exactly baseline; Custom Rules
  **80 of 80**.
- Mutation pass on the renderer, 3 real mutants + 1 equivalent control: reverting the recovery
  label to a prefix (4 tests died), dropping the sub-precision guard (2), rendering `friendCount`
  (2); the control — `> 0` to `>= 0` on a sign already guarded against zero — survived.
- **`pnpm dev`, which is where the last two defects came from.** GET 200 with
  `Cache-Control: private, no-store`; POST **405**; unauthenticated **401**. In a real browser at
  384 px: Home banner and `/health/week` both render from the GET; with the API stubbed 500 both
  show "Your week in review didn't load" and a working retry that refetches once and paints; with
  a warm cache and the API dead, the week page still paints its digest.

**Not exercised.** A true offline *navigation* — the headline claim — needs the service worker,
which `pnpm dev` does not run: a client-side route change offline never gets its RSC payload, so
the sandbox cannot show it. What was demonstrated is the half beneath it, that the cached value is
written under the shared key and paints when the API cannot answer. Also not exercised: the APK's
native SQLite cache (`getLocalStore` is null in the web sandbox), safe-area, and drifted
production data — the local seed has one sleep row and no sessions, so the empty-week branches got
far more coverage here than the populated ones, which only the route fixture covers.

Also untested by anything: with a **cold** cache and a genuine network failure (as opposed to a bad
response) the banner renders nothing rather than an error. That is `cachedFetch`'s deliberate
contract — "offline is not an error" — and is unchanged by this work, but it means the offline
error state people expect exists only after one successful visit.

<a id="2026-09-26-rv202-duration-refit"></a>

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

<a id="2026-09-26-rv202-rules-fallback"></a>

# 2026-09-26 — RV-202 ①: a failed model call answers with your program, not a 502

**Branch:** `fix/rv202-rules-fallback` · **Lane A** · closes RV-202 item 1. Items 2 (the rate-limit
bucket) and 3 (Lane B's source label) stay open.

The 502 was never a quiet failure. The client ignores the non-ok response and polls
`PRESCRIPTION_POLL_MAX = 10` times at 3 s, so the lifter watched "Preparing your AI workout…" for
about thirty seconds and then got the base program anyway. Now those same numbers arrive at once.

## What the entry got right, and the one thing it left out

Verified against `main` first, and its amended bullet was accurate: `PrescriptionSignals.exercises`
carried identity, 1RM history, timing and autoregulation inputs but **not one base number**, so the
only deterministic plan available was `buildWholeSessionDeloadPrescription` — which would have
prescribed a **deload to everyone whose model call timed out**. That is a training decision made by
an outage, and the entry was right to forbid it.

So `aggregateSignals` now resolves each exercise's `styleId` through `listProgressionStyles` and
carries `baseSets`, and `buildRulesPrescription` turns those into a plan through the same
`fitToBudget` the model path uses.

**What the entry did not specify: the rules plan is not persisted.** `storePrescription` holds a
plan for seven days, so storing this would give the model no further attempt until it expired —
one provider blip becoming a week of uninformed plans. That is precisely the shape RV-69 fixed for
the digests, where a degraded recap must never be cached ahead of the real one. The slot stays
empty and the next open re-runs the model.

It reports `confidence: 0.3`, not the deload builder's `1.0`. Everything the model contributes —
phase transitions, RPE autoregulation, per-exercise deloads — is missing, so the numbers are sound
and the judgement behind them is absent. An exercise with no style is skipped rather than given an
invented load, and when *no* exercise has one the builder returns null and the 502 stands.

## Verified on the dev server, twice

`pnpm dev` with a deliberately invalid `GOOGLE_GENERATIVE_AI_API_KEY`:

- **HTTP 200**, where `main` gives 502. `source: 'rules'`, phase unchanged (`accumulation`),
  `phaseAction: 'stay'`, `deload: false`, confidence 0.3.
- The prescribed **3×8 @ 75%, rest 90** matches `style_sets` for all three exercises, set for set.
- `SELECT prescription IS NOT NULL` read **f** afterwards — the non-persistence is observed, not
  argued — and the failure logged exactly once.

And with the container's real key, the model path still wins and stores as before, which is the
regression half of the same run. That second run is what caught my first attempt: I assumed local
dev had no API key because `.env.local` holds only `DATABASE_URL` and `AUTH_SECRET`, and got a
normal model-generated plan. The key is in the container environment.

## Verification

- Full suite **10,300 passed / 87 skipped, exit 0**; lint **831**, exactly baseline;
  `check-test-typecheck` at baseline; Custom Rules **80 of 80**.
- 14 new tests. Mutation pass, 4 real mutants + 1 control: reaching for the deload builder,
  persisting the fallback, inventing a set for a style-less exercise, and counting weekly volume
  from the style's sets rather than the fitted ones each died. The control — renaming an internal
  variable — survived, which is the check today's earlier over-tight source assertions taught me
  to run.
- Adding a required field to `PrescriptionSignals` broke a fixture in
  `prompt-bodyweight-units.test.ts`; it takes `baseSets: []`. Only `check-test-typecheck` sees
  that, never `tsc -p tsconfig.json`.

## Not exercised

**The reachability of the catch branch in production.** The dev run forces the failure with a bad
key, which is one way the model call can throw; a timeout or a schema-parse failure takes the same
path but was not driven. And the wiring test is source-level — no harness drives the real
`generatePrescriptionForSession`, because it would mean mocking the AI SDK plus ~30 repository
reads, and the route test one level up mocks the whole generator away.

**No device, and nothing renders `source` yet.** A lifter sees the base numbers under "Recommended
workout" with nothing saying the coach was unreachable — the same silence the offline path already
has. Labelling it is RV-202 item 3, Lane B's, and the field it needs now exists.

<a id="2026-09-26-rv204-rules-workout-review"></a>

# RV-204 — the Workout Review without a model, and the recap that has not run since July

**Branch:** `feat/rv204-rules-workout-review` · **Lane A** · no migration

## The measurement was right and understated; the framing was wrong on the second half

RV-204 says workout-review and the recap "have code that already does their job; neither ran in
30 days", and prices the work as low priority on that basis. Checked against production first:

| section | calls, 60 days |
|---|---|
| prescription | 36 |
| health-insight | 28 |
| nutrition-scan | 28 |
| … | |
| **workout-review** | **0** |
| **workout-recap** | **0** |

Neither appears at all, over 60 days rather than 30. But those two zeroes do not mean the same
thing, and that is the finding.

**workout-review is opened by hand** from a sheet in Config. Zero is disuse.

**The recap fires automatically** from `done-screen.tsx` every time a workout is completed. In the
same window the owner completed **43** workouts (2026-07-30 → 2026-09-25) and
`ai_health_insights` holds **4** `session-recap` rows, the newest dated **2026-07-23**. No
`error_events` row implicates the route — the whole 30-day window is BF-110's own instrumentation.
So the route is not failing; it is never being called. **That is a fault, not disuse**, and
RV-204 ②'s fix — make the stat block the default on that screen — fixes nothing if the screen is
not reached.

## What shipped: ① only

The review's `generateObject` call is gone. `buildRulesReview`
(`packages/shared/src/workout/review/rules-review.ts`) runs `applyRoleSetPlausibility` →
`dropToBudget` and hands the result to `reconcileReview` exactly as the model's answer used to be
handed to it, so every guard, the duration estimate and the weekly-volume maths are untouched.

**The argument for replacing rather than falling back** (RV-202 ① added a rules *fallback* and kept
its model): what survived the model here was only the *choice* — `reconcileReview` already clamped
every number, refused unsafe drops, back-filled omissions and recomputed the totals. And that
choice is already made deterministically on every prescription by the same trim ordering. Running
it here is what makes a review and a prescription **agree**; before, the review could propose a
shape the prescription would never generate, with no way to tell which was right. The proposal is
also user-confirmed through a separate apply endpoint, so nothing auto-applies.

To avoid a second construction of the same inputs, `buildBudgetMuscleVolume` and
`buildTimedExercises` are now exported from `budget-stage.ts` and used by both. The extraction is
behaviour-preserving — the 147 existing `ai-periodization` tests pass unchanged.

`review/prompt.ts` and `review/schema.ts` were deleted with the call, along with
`prompt-bodyweight-units.test.ts`. `untrusted-text.test.ts` loses its third injection site with a
note saying why: the file it fenced no longer exists, and left in place the case would fail on the
read and read as a broken test rather than a retired surface.

## The mutation pass deleted a branch I had written

Six mutants, one control. Two survived the first run and both were worth having:

| mutation | killed |
|---|---|
| never drop, trim only | 4 |
| emit an explicit `keep` instead of omitting | 2 |
| write a drop reason here as well as in `reconcileReview` | 1 |
| skip `applyRoleSetPlausibility` | **0 → 1** (see below) |
| always run `dropToBudget`, never check whether trimming sufficed | **0 — equivalent** |
| **control:** name the budget in a local const first | **0 — survived, as intended** |

The last-but-one is the useful one. I had written a guard — trim first, only drop if still over —
and the mutant that removed it changed no answer. It could not: `dropToBudget` *is* "trim then
drop", running `fitToBudget` itself and entering its drop loop only while still over budget. The
guard was dead code dressed as a policy. It is gone, and the comment in its place says so.

`applyRoleSetPlausibility` survived because every fixture sat at 3 sets, plausible for all three
roles — a no-op on the whole file. A 9-set accessory fixture kills it now.

## Verification

Lint 0 errors, warnings level with `main`; `check-test-typecheck` at baseline (**87** files after
`prompt-bodyweight-units.test.ts` came out of it — the deleted file leaves the baseline in the
same PR, or the check fails on a row it can no longer find); Custom Rules **80 of 80**; full suite
**1,105 files, 10,330 passed / 87 skipped, EXIT=0**.

**Two enumerations had to let this route go, and both say on their face when that is allowed.**
`prose-guards.test.ts` lists every route whose prompt must carry the shared guards and states the
rule: *"A route leaves this list when its model call goes, never because the guards became
inconvenient."* RV-201 set the precedent when it took the model out of health-insight. Same here.
`untrusted-text.test.ts` loses its third injection site for the harder reason — the file it fenced
no longer exists, and left in place the case fails on the read and reads as a broken test rather
than a retired surface.

**The first "green" suite I read was not my run.** A `grep -c 'Error:'` that finds nothing exits 1,
which short-circuited the `&&` before `vitest`, so the log I tailed was a stale file and I nearly
shipped on it. Two failures were real once the suite actually ran. Capture the exit code from the
run itself (`… > log 2>&1; echo "EXIT=$?" >> log`) and never behind a pipe.

On the dev server, against the local database:

- `POST /api/workout-review/session/<id>` → **200 in 2.3 s** (cold), *"This session already fits
  its 51-min working budget, so nothing is changed."*, with real `before` numbers off the
  progression styles.
- Session budget dropped to 12 to force the other path: **one of two primaries dropped, the other
  kept** — the last-primary guard doing its job — the accessory dropped, both carrying
  `reconcileReview`'s fallback reason, and the summary naming them.

The wording says **"working budget"** deliberately: `signals.effectiveTimeBudgetMin` was 51 against
a session configured at 60, and the sheet shows the 60 beside this sentence. Without the adjective
the two numbers read as a contradiction.

## Not exercised

**The sheet itself was not rendered.** `confidence` is now a constant 1; it is never displayed —
it round-trips to the apply route, which stamps its own 1.0 over whatever it receives — but that
was read from the code, not seen.

**No device.** The review sheet opens from Config on the S25 and none of this was opened there.

**RV-204 ② is deliberately not built.** It is parked behind **LA-155**, filed from the measurement
above, which asks the device agent whether the done screen is reached at all after the last set,
or reached with a null `workoutSessionId` — every loader on that screen is guarded by the same
`if (!workoutSessionId) return`, so one null would disable recap, energy and HR together.

<a id="2026-09-26-tn81-sleep-verdict-snapshot"></a>

# 2026-09-26 — TN-81: the app's verdict on a night, with its evidence frozen beside it

**Branch:** `feat/tn81-sleep-verdict-snapshot` · **Lane A** · entry TN-81 (removed from the queue)
**Plan:** `docs/superpowers/plans/2026-09-26-outlier-gated-rating-prompt.md` · engine half of TN-81 + TN-82

## Why this exists

Tuning has no validated outcome variable. Five validation attempts have failed for want of a
label, and asking for one has now failed three times across three affordances — 82 morning sheets,
and in each month exactly one field collects a handful of answers before decaying to zero. So the
app stops asking: it fills the sleep category itself, says what it filled and why, and the owner's
only interaction is to correct it. **A correction is a disagreement, and a disagreement is the
label.**

## What shipped

- `packages/shared/src/health/sleep-verdict.ts` — per-component rolling median/IQR over a trailing
  28 nights (duration, onset time, efficiency), a verdict of `normal | poor | good`, and **which
  components triggered it**. Plus `onsetMinutesForNight`, which reads the clock and the calendar
  day in the *user's* timezone.
- Migration **284** (`sleep_verdicts`) and its regenerated `claude_ro` twin **285**.
- `sleepVerdicts` in the Drizzle schema, `SleepVerdictRecord` in the shared types, and three
  repository methods.
- `quantile` exported once, in `daily-medians.ts` beside `median`.

## The requirement that shaped the table

**The verdict and its inputs are snapshotted, not just the outcome.** `sleep_score` is computed on
read and persisted nowhere — re-measured against production 2026-09-26, non-null on **0 of 119**
rows over the last 120 days, with `duration_hours` on all 119 and `average_hrv_ms` on 102. Every
figure in the entry checked out exactly, which is unusual enough to be worth recording.

Store only the word and a later scoring change silently rewrites what each correction was
disagreeing with. So the component values and the bands are columns, frozen at announcement time.
A correction whose paired verdict is not pinned is not evidence.

**A new table, which is the opposite of migration 282's call.** 282 put `acwr` on
`oura_daily_derived` because a second daily-metrics table splits one day across two places — right
for a metric. This is not a metric: it is an announcement with a response state. `day_checkins` was
the other candidate and is worse, because its row exists only once the sheet is **saved** while an
announcement happens when it is **opened**, so "announced, no response" would have nowhere to live.

## Three states, and the write that must never happen

`response_state` is `none | acknowledged | corrected`. Silence under correction-only feedback is
ambiguous — it means either "the app was right" or "he never looked" — and that cannot be
recovered afterwards. So `upsertSleepVerdict` deliberately **omits `response_state` from its
conflict update**: re-announcing a night must never turn an answer back into silence. There is a
DB-backed test for exactly that, and a mutant that adds the field is killed by it.

The TN-57 rule holds: an auto-fill writes `touched: false`, only a correction writes `true`. A test
asserts this path writes no touched flag at all.

## Mutation pass

11 deliberate defects, all killed; 2 deliberately equivalent controls, both survived.

One survived the first round and the test was at fault, not the code: "let a night help judge
itself" changed nothing, because a single low outlier barely moves the p25 of 28 values, so
"still poor" passed either way. It now asserts **band equality** between a run with the target in
its own history and one without — the property itself rather than a symptom of it.

## Not done, and filed rather than left implicit

- **LA-149 — nothing announces the verdict yet.** The plan ships the engine half first and the
  integration point depends on the surface TN-82 builds, so the computation and storage land inert.
  **TN-82's `Needs:` was repointed from TN-81 to LA-149** in the same edit: removing TN-81's heading
  would otherwise have made TN-82 READY while there is no data for it to announce.
- **LA-148 — four `median` implementations, and one disagrees.** Found while looking for something
  to reuse. Three average the two middles and return `null` on empty; `hr-smoothing.median` returns
  the upper middle and **`0`** on empty, which is a plausible-looking bpm. Not fixed here — it is a
  live display path and a migration ships alone.

## Not exercised

No device run, and none applicable: server-side only, with no local-SQLite mirror. The verdict
needs 28 nights and per-component medians, which makes it a server-assembled aggregate of the kind
`weekly-stats` already is, so the offline-first read rule does not bite.

**No `pnpm dev` route exercise either, and that is not an omission being glossed:** this PR adds no
route and no caller. What ran is the full suite against the local Postgres, the DB-backed
repository tests, and the two TCP `claude_ro` tests (**2 files, 27 tests, none skipped**). Nothing
here has been exercised against drifted production data, and nothing here runs in production until
LA-149 wires it.

<a id="2026-09-26-tn83-remeasure"></a>

# 2026-09-26 — TN-83 re-measured: the fix made the announcement rate worse, which is correct

**Branch:** `docs/tn83-remeasure` · **Lane A** · docs-only · the calibration is the owner's

## What was owed

LA-149 routed the sleep verdict through `nightSessions()`, so it no longer judges naps and 0 h
fragments as nights. TN-83's own sweep — 10.9 prominent announcements per 30 nights against a 4–6
target — was counted over `sleep_sessions` **rows**, so it did not survive that fix. The entry said
so and left the re-measure owed.

## The result inverts the expectation

Run with the shipped `nightSessions()` → `toVerdictNights()` → `sleepVerdictForNight()` over the
owner's real 125 rows (106 dates):

| population | judged | poor | good | normal | prominent / 30 nights |
|---|---:|---:|---:|---:|---:|
| raw rows | 96 | 25 | 9 | 62 | **10.6** |
| `nightSessions()` | 67 | 22 | 13 | 32 | **15.7** |

The raw figure reproduces TN-83's 10.9 closely (the small gap is a 200-day pull against their 120),
which is what makes the second row trustworthy.

**The fix raised the rate, and that is the fix working.** The 0 h fragments were *widening* the
bands: they dragged `p25` down, so nights that should have read as unusual were being absorbed as
normal. Remove them and the bands tighten. This is TN-83's own "desensitised bands" half arriving
as a number — the entry predicted both directions and only the loud one had been measured.

## The multiplier, swept over the corrected population

| × | poor | good | normal | per 30 |
|---:|---:|---:|---:|---:|
| 0.50 *(shipped)* | 22 | 13 | 32 | 15.7 |
| 0.75 | 16 | 5 | 46 | 9.4 |
| **1.00** | **10** | **3** | **54** | **5.8** |
| 1.25 | 9 | 2 | 56 | 4.9 |
| 1.50 | 5 | **0** | 62 | 2.2 |

The sweep uses a multiplier-parameterised copy of the rule, cross-checked against the real function
at ×0.5 — identical counts (22/13/32), which is why the other rows carry.

**1.00 is the proposal.** It is the only value inside the 4–6 target that keeps the "unusually good
night" half alive. 1.25 is also in band and halves `good` to 2 for no gain.

**TN-83's ⛔ against 1.5 survives its own numbers being wrong.** On the corrected population 1.5
still takes `good` to zero. The warning was right for a reason that outlived the measurement it was
written from — worth noting, because the tempting move was to discard the whole entry's guidance
along with its figures.

## Not done, deliberately

**The constant is unchanged.** Scoring calibration is the owner's call (CLAUDE.md): it changes
numbers he reads daily and a bad one is hard to notice from inside. The proposal states what a
proposal here is incomplete without — **of 67 judged nights, 22 change verdict**: 12 poor→normal
and 10 good→normal, nothing in the other direction.

## Not verified

The counts are the owner's own nights via `claude_ro`, which is row-scoped to him — correct here,
since it is his calibration, but they are his rows and not a population claim. `judged` falls from
96 to 67 because merging rows into nights means each component's 28-night window fills later; that
is expected, not attrition. Nothing was run on the device, and nothing here changes behaviour.

<a id="2026-09-26-tn83-verdict-multiplier"></a>

# 2026-09-26 — TN-83: the sleep verdict's calibration, decided and pinned

**Branch:** `tune/tn83-verdict-multiplier` · **Lane A** · closes `TN-83`

## What shipped

`VERDICT_IQR_MULTIPLIER` 0.5 → **1.00** and `SLEEP_VERDICT_MODEL_VERSION` 1 → **2**, in
`packages/shared/src/health/sleep-verdict.ts`. Two constants and one test. Nothing else changed.

## Why it is only two constants

The calibration is **the owner's call, not Lane A's** (CLAUDE.md: *"Tuning proposes; it never ships a
scoring change… the owner signs off and Lane A implements"*). TN-83 carried the measurement and the
proposal; the owner answered **1.00** on 2026-09-26. This entry is the implementation half, and its
whole job was to change the number without changing the rule.

## The number, re-confirmed against the shipped code rather than the sweep

The sweep in TN-83 was run against a replica of the scoring function. Before shipping, the same
count was re-run through the **actual exported functions** — `nightSessions()` → `toVerdictNights()`
→ `sleepVerdictForNight()` — over the owner's real 125 production rows, with the constant at its new
value:

| | judged nights | poor | good | normal | prominent / 30 nights |
|---|---:|---:|---:|---:|---:|
| ×0.5 (what shipped in TN-81) | 67 | 22 | 13 | 32 | 15.7 |
| **×1.00 (this change)** | **67** | **10** | **3** | **54** | **5.8** |

5.8 against a 4–6 target, with `good` still non-zero — which is the whole reason 1.00 won over 1.25
(4.9, but `good` halves to 2) and over 1.5 (2.2, and `good` goes to **zero**, deleting half the
feature). TN-83's ⛔ against 1.5 survived its own re-measurement.

## Why the model version had to move with it

`SLEEP_VERDICT_MODEL_VERSION` is stamped onto every stored verdict, and the point of storing it is
that a correction can later be paired with *the rule it was disagreeing with*. Changing the
calibration without moving the version would leave two incompatible rules sharing one version, and
every stored correction would silently become unattributable. The two constants are one change.

**No stored verdict needed reinterpreting** — production holds **0** rows in `sleep_verdicts`,
checked before the edit. Had it held any, they would have been version-1 rows judged by a rule that
no longer exists, which is exactly the situation the version stamp exists to make legible.

## The test, and the honest reason it exists

All 33 pre-existing verdict tests **pass at 0.5 and at 1.00 alike**. That is by design — they use
deliberately extreme values so they assert the *rule* rather than the tuning — but it means nothing
in the suite would have noticed the calibration being changed, or drifting back. So the change ships
with one test that pins both constants together.

Mutation pass, 3 mutants + 1 equivalent control:

| mutant | result |
|---|---|
| multiplier back to 0.5 | **killed** (1 test) |
| model version left at 1 | **killed** (1 test) |
| multiplier drifts to 1.25 | **killed** (1 test) |
| *control:* `1.0` → `1.00`, same value | **survived**, as it must |

Each mutant was killed by exactly one test — the new pin — which is the measurement confirming the
gap above rather than a claim about it.

## Not user-visible, and why that is a fact rather than a hedge

Nothing renders the verdict yet: `grep` for `sleep-verdict` across `app/`, `components/` and `lib/`
finds only the route itself. So there is no version bump and no changelog entry, and no device
verification is owed — the announcement surface is `TN-82`, still queued, and it will be the change
that needs the phone.

## Files

- `packages/shared/src/health/sleep-verdict.ts` — the two constants, with the sweep recorded in the
  docstring so the next person to touch the number sees what it cost to pick.
- `packages/shared/src/health/__tests__/sleep-verdict.test.ts` — the pin.
- `docs/implementation-backlog.md` — TN-83 removed; `TN-82`'s copy discussion amended, since its
  "which, until TN-83 lands, is often" no longer held.
