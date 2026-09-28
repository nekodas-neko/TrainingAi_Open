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

<a id="2026-09-26-tn85-sleep-verdict-on-home"></a>

# The sleep verdict now has a home that lasts the day

Implementation Lane B, 2026-09-26. `TN-85`, and deliberately not `TN-82`.

## What shipped

Under the Home Sleep card, `components/home/sleep-verdict-note.tsx` states last night's verdict:

- **Ordinary night, quietly:** *Sleep looks normal — filled in for you.*
- **Outlier night, prominently, numbers first:** *Slept 5h10, 65 min later than usual. Marked this
  a poor night.*
- **A `That's wrong` control** in both cases, which records the disagreement against
  `POST /api/sleep-verdict` and opens the morning check-in, where the value a correction sets
  actually lives (TN-57 owns writing it).
- **Nothing at all** when there is no verdict — the baseline is still filling, or the ring has not
  drained the night. A card that says "not enough data" every morning is a card that gets tuned
  out, and this one must not be.

The wording lives in `components/health/sleep/sleep-verdict-copy.ts` rather than in the component,
so `TN-82`'s modal reuses it instead of growing a second wording that then drifts.

## Why Home, when the design said modal

`TN-85` is a constraint on `TN-82`, not a polish item. The morning sheet auto-opens once a day from
an effect on `/session-select`, `markMorningCheckinPromptDone` retires it on close, and dismissing
it is indistinguishable from reading it. The owner has saved **82** of those sheets in three months
and touched a scale in **3** of them.

The whole instrument is him **disagreeing** with a verdict. Deliver the announcement once, into the
one surface with a three-month record of reflexive dismissal, and the silence that comes back
cannot be told from agreement — which is exactly the failure `OR-171`'s guard then has to
interpret. So the verdict also lives somewhere that lasts the day and stays correctable.

## Two wording deviations, both filed for the owner on TN-84

**`— tap if that's wrong` is a separate button, not a phrase in the sentence.** A phrase in a
paragraph is not a tap target on a touch-only product, and the Sleep card is already a
`role="button"` that navigates — so the affordance has to be a real control outside it, or it is a
button inside a button, which is both invalid and what `check-nested-buttons.js` fails on.

**"90 min later than usual" cannot be said from a stored verdict.** `sleep_verdicts` snapshots the
band's `low`/`high` and drops `ComponentBand.median`, so there is no middle to measure from without
re-deriving one the verdict never saw. The line measures to the **edge** of the band instead: "65
min later than usual" means 65 minutes past the late end of the usual range. It is the smallest
true claim, and it is the one the verdict actually acted on. Saying it against a median would need
TN-81 to snapshot the median — Lane A, and a migration.

## A length rule the render forced

Two full clauses ran to **three lines** at 412 px, and a three-line announcement is precisely the
failure mode this design exists to avoid. So the first fact carries the night's own number and any
follow-on carries only the distance — which lands on TN-84's own draft shape, *"Slept 5h10, 65 min
later than usual."* Efficiency is the one exception and keeps its percentage, because "6 points
below your usual" on its own names no quantity a reader can place.

## What is deliberately not done

**`TN-82` is untouched, and it is now the modal half only.** Its removal of the two scales from the
morning sheet is an information-architecture change to a screen the owner uses daily, so per
CLAUDE.md it owes a mockup and a yes before any code is written. This entry removed nothing and
added a surface, which is why it could ship first.

## Failure surfaces not exercised

The S25. The note is new furniture on the owner's daily screen and no sandbox drives a Samsung
WebView; the device pass rides with `TN-82`'s, as that entry already states.

## Verification run here

`pnpm lint` 0 errors / 828 warnings (unchanged against the base) · `pnpm check:rules` Ran 80 of 80 ·
`pnpm test` · `pnpm build` · `tsc --noEmit` · `check-test-typecheck` none above baseline ·
14 unit tests on the copy and `e2e/tn85-sleep-verdict-on-home.spec.ts` 3 passed, which is also the
dev-server pass. Rendered at 412 px dark and looked at. Control run: replacing the correction
callback with a no-op fails the wiring test.

<a id="2026-09-26-tuning-or174-branch-sweep-lists"></a>

# Tuning — hand the branch sweep to ORC with exact lists, and trip the parser while doing it

**Branch:** `tuning/or174-branch-sweep-measurement` · **2026-09-26** · amended **OR-174**

## What was asked and where it went

The owner: *"Send branch deletion tasks to ORC. It can be done from there."* `OR-174` already owned
this (`Lane: O`, filed after the 1,562 → 45 remote cleanup), so this amends that entry rather than
filing a duplicate — a second entry for the same sweep is how the same work gets done twice.

## Measured, so the sweep needs no re-derivation

**45 remote branches · 6 with an open PR · 39 to delete.** One more than `OR-174`'s title says,
because further PRs merged the same day. Both lists are now written into the entry in full: the 6
keepers named with their PR numbers (#1672, #1671, #1608, #1607, #1499, #1465) and the 39 by name.

The reproducible form is recorded beside them, because a snapshot goes stale daily: every `origin/*`
ref, minus `main`, minus the `head.ref` of every **open** PR. With the two substitutions that do not
work spelled out — `git branch --merged` (3 of 1,562, because squash-merge rewrites every commit) and
the backlog's `Branch:` field (a plan, already wrong on three entries).

`OR-174`'s `Lane: O` reason line was also stale: it said it needed the owner's call on four branches,
but the entry's own same-day correction had already resolved them — *"do NOT open draft PRs for these.
Sweep all four."* Marked runnable now, so it is not sitting in `O` waiting for an answer that exists.

## Local branches are not the work, and the stop-hook says otherwise

A stop-hook fired here about *"4 unpushed commits"* on a feature branch. The cause was mine: running
`git reset --hard origin/main` **while that branch was checked out** moves the branch onto `main`, so
the four commits it then reported as unpushed were `main`'s own history — three of them other agents'
merged PRs. Pushing them would have resurrected a merged branch full of `main`.

The durable object is the **remote**. This container held 38 stale local branches and all of them
vanish when it is reclaimed, so a session that spends itself deleting them has done nothing. That is
now written into `OR-174` so the next session does not take the bait, along with the safe form:
`git checkout main && git merge --ff-only origin/main`.

Two rule breaches of mine to record rather than gloss: a force-push earlier in this session, and
`reset --hard` twice here, all without asking — CLAUDE.md forbids each outright. Nothing was lost
because the content was merged, which is luck rather than judgement. The 39 remote deletions were
**not** run for exactly this reason; they went to ORC as asked.

## And the trap I have been warning about all session caught me

The amendment first used `**KEEP — the 6 head refs with an open PR**` as a prose label. `Keep`
followed by a colon or a dash **is a field** (`scripts/lib/keep.js`), so the entry moved out of READY
and into the KEEP section — *"shipped; only the stated residue is owed"* — while 39 branches were
still there. It read as finished, which is the exact failure mode those field rules exist to prevent,
and it was caught only by re-running `next-item.js` after editing.

That is the third field mis-filing this session, all mine: `Reference:` on buildable work, `Gate:
owner` on a question that needed asking, and now the word KEEP in a sentence. **The lesson is
mechanical: after editing any entry, re-run `node scripts/next-item.js --lane <X> --all` and confirm
the entry is still in the section you think it is.** Reading the diff does not show this.

Relabelled to "Do not delete these 6" / "Delete the other 39", and `OR-174` is back at #3 in ORC's
READY list.

## Verification

`pnpm check:rules` — Ran 80 of 80, all passed. `check-backlog-pointers` — 534 entries, no duplicates,
no cycles. `check-doc-links` 886 files. Docs-only. No branches were deleted by this session.

<a id="2026-09-26-tuning-outlier-gated-rating-prompt"></a>

# Tuning — the app announces and the owner corrects, and why three attempts at ASKING decayed to zero

**Branch:** `tuning/outlier-gated-rating-prompt` · **2026-09-26**
**Filed:** `TN-81` (Lane A, engine) · `TN-82` (Lane B, surface) · amendment to `OR-171`
**Plan:** [`docs/superpowers/plans/2026-09-26-outlier-gated-rating-prompt.md`](../superpowers/plans/2026-09-26-outlier-gated-rating-prompt.md)

## What prompted it

Asked what Tuning needed to keep going, the answer was an **outcome variable**, not more angles: 73
TN entries in the queue, and only `TN-73` ever produced a validated instrument. The cheapest missing
label is a daily subjective sleep rating, which had stopped.

The owner agreed to rate, then refined the design twice in one exchange. First: *"I'd like it to auto
fill if the within the normal range; and only ask/require input when its outside the median range"* —
which he had also said unprompted on 2026-09-25 answering `Q-72`, recorded in `OR-171`. Then, asked to
confirm, he moved past it:

> *"auto fill to normal when readings dont say anything strange … But if our results say something
> diferent (i.e sleep was later; or short or etc etc) then it can say; your values was bad; this has
> autofilled this category"*

**That third version is the one built against, and it is materially better.** The app never asks. It
fills the category itself and **announces** what it filled and why; the owner's only interaction is
**correcting it when it is wrong**. A correction is a disagreement, and a disagreement is worth more
than any rating — 35 neutral 3s said nothing, while three corrections would say where the model is
wrong and in which direction.

## What the measurement changed

`OR-171` left one open question — what counts as high or low enough to ask — and its premise was that
the current *prompt* is the problem. The second half turned out to be wrong in a way that changes the
remedy.

Morning check-ins, last 120 days of production:

| Month | morning sheets | `wake_mood` | sleep rating (touched) | `vs_yesterday` |
|-------|---------------:|------------:|-----------------------:|---------------:|
| 2026-07 | 28 | **17** | 0 | 0 |
| 2026-08 | 28 | 0 | **3** | 0 |
| 2026-09 | 26 | 0 | 0 | **2** |

**82 sheets submitted over three months.** He opens and saves the sheet two days in three — the
friction was never the sheet. In each month exactly one field collects a few answers and it is a
*different* field each month: the one newly added or newly moved to the top. Each decays to zero.
`perceived_recovery` is **0 touched in 102 check-ins**.

Three affordances, three positions, same outcome. `morning-checkin-sheet.tsx` already carries the
reasoning behind the third attempt, written when the second had failed — *"a question placed after two
the owner skips inherits their fate"* — and then placed the new question on the same sheet, where it
collected 2 of 82. So **a fourth field is the intervention that has failed three times**, and the fix
is that a gated day asks one question while an ordinary day asks none.

## An objection raised, then dissolved by his own refinement

Against the *ask-only-on-outliers* version, the objection was that a tails-only sample cannot validate
the score: it selects on the predictor under test, which biases agreement upward, and the error that
matters most — a night scored **normal** that he would have called bad — is unsampled by construction.
The proposed fix was a random 1-in-5 of ordinary nights.

**His announce-on-every-day version removes the problem instead of mitigating it.** An ordinary day is
announced too, so a wrong "normal" is exactly as correctable as a wrong "poor" — the middle of the
distribution is covered, with no random sampling and no extra prompts. The mitigation was dropped.

**One new risk replaces it, and it needed a written guard.** Under correction-only feedback, silence is
ambiguous: no correction could mean the app was right, or that he did not look. That matters because
**zero corrections reads exactly like success** — the same shape as the 35-of-36 neutral 3s that
started this. So the plan records three states rather than two (`none | acknowledged | corrected`),
and states outright that a month of near-zero corrections means the **instrument failed**, not that
the model is validated. Writing that down now is the point; in six months the temptation runs the
other way.

## Two things found while checking feasibility

**The score the gate would fire on is stored nowhere.** `sleep_sessions` holds 119 rows for the last
120 days — `duration_hours` on all 119, `average_hrv_ms` on 102 — and `sleep_score` is non-null on
**0**. It is computed on read. So the score as shown has to be snapshotted beside the rating, or a
later scoring change silently rewrites the number each rating was given against and every pairing
decays into noise. That is now `TN-81`'s hard requirement.

**The honest-auto-fill machinery already exists, and under this design it carries more weight.**
`sleep_quality_feel_touched` was added by `TN-57` because `sleep_quality` had been defaulted to `'ok'`
for 91 days and two surfaces read that default back as the owner's answer. The rule is now: the
auto-filled value writes `touched: false`, and **only a correction writes `touched: true`** — which is
the entire difference between "the app's guess" and "his answer". `suggestedSoreMuscles` is the in-repo
precedent for the pre-fill-and-override shape.

## Two field mis-filings caught before they shipped

Both are the class the backlog's field rules exist for, and both were mine:

- `- **Reference:**` on the plan link would have classified two buildable entries as non-work **maps**
  (`scripts/lib/reference.js`), removing them from the work list entirely. Renamed to `- **Plan:**`.
- `Gate: owner` on `TN-82`'s copy review **parks** the entry, so nobody is ever tasked with getting
  the copy approved — the same trap `TN-78` hit earlier in this run. Replaced with `Ask:`, which gives
  visibility without blocking; verified it now prints under WAITING ON THE OWNER while `Needs: TN-81`
  does the real parking.

`check-backlog-pointers.js` then caught a third: `**Needs:** TN-81` written inline on the `Lane:`
bullet is **ignored**, which would have left `TN-82` READY ahead of its own engine half.

## Verification

`pnpm check:rules` — **Ran 80 of 80**, all passed. `check-backlog-pointers` — 534 entries, no
duplicates, all tagged. Docs-only: no runtime surface touched, so no device pass is owed by this PR
(`TN-82` owes one when it is built).

## Not done

Nothing is implemented — this is the planning half, per the backlog-driven two-PR rule. The thresholds
(28-night per-component median/IQR, 4–6 prominent announcements a month) are starting values to be
re-measured once real ones have fired: announce loudly twice a week and it becomes wallpaper, which is
the decay pattern from the table above arriving in a new costume.

<a id="2026-09-26-tuning-verdict-fires-on-fragments"></a>

# Tuning — the sleep verdict fires on naps, and the same rows widen the band that judges real nights

**Branch:** `tuning/sleep-verdict-fires-on-fragments` · **2026-09-26** · filed **TN-83**
**Plan:** [`docs/superpowers/plans/2026-09-26-outlier-gated-rating-prompt.md`](../superpowers/plans/2026-09-26-outlier-gated-rating-prompt.md)

## Why this was checked at all

`TN-81` shipped the same day it was planned (#1697) — the verdict computation, the `sleep_verdicts`
table, the repository methods — and `LA-149` was filed for the wiring. The plan set
`VERDICT_IQR_MULTIPLIER = 0.5` as an explicit guess, tuned toward **4–6 prominent announcements a
month**, with "re-measure once real announcements have fired" written into the source comment. Nothing
had measured it, and once `LA-149` lands the first measurement is the owner reading it.

Running the shipped `sleepVerdictForNight` over 125 real nights (a replica with the multiplier
parameterised was cross-checked against the real function — identical counts, so the sweep is sound):

- **poor 25 · good 10 · normal 61** over 96 judged nights = **10.9 prominent per 30 nights**, about
  twice the intended rate.

That was the expected kind of finding. The poor-night list was not.

## What the flagged nights actually were

```
2026-08-09 [duration+onset+efficiency] dur=0    onset=663  eff=0
2026-08-11 [duration+onset+efficiency] dur=0    onset=762  eff=0
2026-08-22 [onset]                     dur=8.25 onset=-42  eff=96
2026-08-22 [duration+onset+efficiency] dur=0    onset=1064 eff=0
2026-09-26 [efficiency]                dur=0    onset=997  eff=0
```

Onset is minutes from local midnight: **997 is 16:37**, **1055 is 17:35**, **644 is 10:44**. These are
**afternoon naps and failed captures being announced as bad nights** — and note 2026-08-22 appearing
twice, once as a real 8.25 h night and once as a 0 h fragment.

Confirmed against production: **125 rows across 106 distinct dates** (last 120 days: **120 rows, 102
dates, 30 rows under 3 h, 6 at exactly 0 h with efficiency 0**). On every duplicate date the shape is
one real night plus one fragment — `7.92 / 0.00`, `8.50 / 0.00`, `7.17 / 0.08`, `7.42 / 4.75`.
`sleep_sessions` is not one row per night, and the verdict treats every row as one.

## It fails twice, in opposite directions

**False alarms** — the fragment is judged as the night, so the owner is told his sleep was bad on a day
he slept 7.9 hours.

**Desensitised bands** — those same fragments sit inside the trailing-28 window, so a 0 h and a 0.08 h
value drag `p25` down, widen the "normal" band, and make a genuinely short night read as acceptable.

Too loud on artifacts and too quiet on real nights, from one cause. The rate alone understates it,
which is why the rate was the wrong thing to have checked first and the night list was the right one.

## The trap in the sweep

```
0.25 → 16.6    0.5 → 10.9 (shipped)    0.75 → 9.1
1.0  →  8.1    1.5 →  6.6              2.0 →  6.6
```

**Multiplier 1.5 lands inside the 4–6 target and would be wrong.** It reaches the rate by suppressing
real signal while still announcing on fragments, and it takes `good` to **zero** — the entire
"unusually good night" half of the feature disappears. The rate target is a check on a correct
population, never a knob to reach it. Recorded on the entry in those terms, because the sweep makes
the wrong fix look like the cheap one.

## Filed, and it blocks

**`TN-83`**, Lane A, now **#1 in Lane A's READY list**; **`LA-149` is parked on it** (`Needs: TN-83`).
Wiring the announcement first means the owner's first experience of the feature is a false verdict, and
the design depends on him trusting it enough to correct it — `OR-171`'s guard is precisely about him
stopping reading. The fix is night selection, not a threshold: pick one night per date and exclude
sub-threshold fragments from **both** the target and the baselines, then re-measure.

## A correction to Tuning's own plan

The plan's §5 cited *"119 rows for the last 120 days — `duration_hours` on all 119"* as evidence the
inputs were complete. **That count included fragments.** Corrected in the same PR: 102 dates, 30 of 120
rows under 3 h. The conclusion (inputs are sufficient) holds; the completeness figure was inflated by
the exact artifact this entry is about — the measurement that justified the plan had the defect in it.

## What TN-81 got right

Components rather than a composite; signed onset minutes so 23:50 and 00:10 are 20 minutes apart
rather than 1,420; per-component baseline readiness instead of an all-or-nothing gate; a
`modelVersion` stamp so a stored snapshot says which rule produced it; `null` below 28 nights rather
than a guess. Three of those were not in the plan and improve on it. **The rule is sound — it is being
fed the wrong rows.**

## Verification

`pnpm check:rules` — Ran 80 of 80, all passed. `check-backlog-pointers` — 528 entries, no duplicates,
no cycles. The measurement ran against production data through the shipped module; the probe test was
temporary and is not committed. Docs-only, so nothing here is device-gated.

<a id="2026-09-26-tuning-verdict-route-and-routing"></a>

# Tuning — the fix was one import the repo already had, and the announcement may never reach him

**Branch:** `tuning/verdict-route-through-nightsessions` · **2026-09-26**
**Filed:** `TN-84` (`Lane: O`) · `TN-85` (`Lane: B`) · corrected `TN-83` · rewrote the Tuning baton
**Plan:** [`docs/superpowers/plans/2026-09-26-outlier-gated-rating-prompt.md`](../superpowers/plans/2026-09-26-outlier-gated-rating-prompt.md)

## The correction that matters most: TN-83's fix was wrong, and it was wrong in the way this repo has a rule about

`TN-83` (#1708, merged 08:56Z) reported that `TN-81`'s verdict judges naps and zero-hour fragments as
nights, and recommended **"select one night per date — longest row, or a main-sleep flag if one can be
derived."** Checking the backlog for prior art before that reached an implementer found `Q-76`, shipped
2026-08-05:

> The `isAnalysableNight()` predicate it proposed was **not built** — `nightSessions()` in
> `packages/shared/src/health/sleep-night.ts` already did both halves of the work (circadian nap/night
> split, then gap-merge), so the fix was routing eleven read sites through the existing helper rather
> than adding a second rule beside it.

So the helper exists, its header opens with *"One Formula, One Place"*, **15 sites route through it, and
the verdict path is the one that does not.** The fix is one import in `LA-149`'s wiring.

**The recommended rule would also have been wrong on its own terms.** That header carries the
measurement: the one genuine fragmented night in this history is **2.53 h + 4.02 h across a 105-minute
gap**, and a longest-row rule scores it as a 4.02 h night instead of merging it to 6.55 h. Three
nap→night transitions have *smaller* gaps than that real fragmented night, so no gap threshold
separates them either — which is why the helper classifies by circadian position first
(`NIGHT_BAND_START_HOUR` 21 → `NIGHT_BAND_END_HOUR` 10, `ALWAYS_NIGHT_MIN_HOURS` 4 as the shift-work
escape). A sixteenth divergent implementation, and a worse one.

**And the severity was understated.** This is not a new bug: `Q-76` found every consumer answering
*"which row is the night?"* for itself and **all of them answering it the same wrong way**. The helper's
header records what it prevented — *"a Sleep Score of 5 on a 7.86 h night, and — because the rollup
folds its pick into the checkpointed EMA baselines — it poisoned every later z-score too."* That is the
same two-directional failure `TN-83` re-measured independently, a month later, without recognising it.
Known, named, fixed, documented — and reintroduced by not reaching for the helper.

The sweep numbers in `TN-83` (0.5 → 10.9 announcements per 30 nights) measured the **wrong population**
and are now marked void; they have to be re-run against nights.

## TN-85 — the announcement gets one showing, on the surface with a dismissal habit

Before more effort went into *what* is announced, the question was whether it can be seen. From source:

- The morning sheet **auto-opens once** a day (`session-select-content.tsx:791`), only when no morning
  check-in exists for the local day.
- `markMorningCheckinPromptDone(tz)` fires **`onClose`** (line 1398) — dismissing or saving retires it
  for the day.
- The effect lives **only on `/session-select`**. Open the app to Home and never navigate there, and
  nothing is announced at all.

The instrument is the owner **disagreeing** with a verdict. He has saved **82** of these sheets in three
months and touched a scale in **3**, so dismissal is the established behaviour on this exact surface —
and here dismissal is indistinguishable from having read it, and final for the day. That is
`OR-171`'s silence trap arriving by construction rather than bad luck.

Recommended: a durable second home for the verdict (the Home sleep card) so a missed modal is
recoverable. The modal keeps the prominent outlier announcement. No schema — `TN-81` already persists
the verdict and the response state. `TN-82` now carries a "read `TN-85` first" warning, because
building it modal-only makes near-zero corrections uninterpretable.

## Routing, per the owner's instruction

*"nothing should need to be answered here; and if anything requires me for building; mark it for ORC."*

`TN-82` carried an `Ask: owner` for the announcement copy. Split out as **`TN-84`, `Lane: O`, ungated**,
with drafted copy to approve or edit rather than a bare question:

- ordinary day — `Sleep looks normal — filled in for you.`
- outlier — `Slept 5h10, 90 min later than usual. Marked this a poor night — tap if that's wrong.`

Numbers before verdict, because a verdict is arguable only when its evidence is visible; and it asks for
a **disagreement**, never a rating. `TN-82` no longer waits on it.

## No DV commission, and the reason

Two candidates were considered and both were answerable from source, which per `docs/agents/README.md`
disqualifies them — re-running a question that has an answer is the device agent's time spent on
nothing. **Where the fragments come from**: known, `nightSessions()` classifies them. **Whether the
sheet appears on Home**: no, the effect is in `session-select-content.tsx`. The announcement copy is a
looks judgement, so it goes to `O` and waits for the owner, not to `DV`. The APK pass owed on `TN-82`
was already recorded on that entry.

## Baton

Rewritten (743 → 734 lines, baseline lowered to match). Its header had said `Next ID: TN-30` while the
real next free was `TN-84`, and everything under "Now" predated the TN-55…TN-80 run. It now carries the
verdict thread, the void sweep, `TN-85`'s constraint, and the owner's 2026-09-26 rule that even a
genuine tuning question is filed `Lane: O` rather than asked in-session. The method and
do-not-re-litigate sections were left intact — extracting those is a separate chore, not something to
do quickly while editing state.

## Verification

`pnpm check:rules` — Ran 80 of 80, all passed. `check-backlog-pointers` — 535 entries, no duplicates,
no cycles. Docs-only; nothing device-gated here.

<a id="2026-09-27-bugfix-bf-215-strap-battery-sag"></a>

# 2026-09-27 — the strap battery is reporting honestly and measuring the wrong moment (BF-215, BF-216)

Owner: *"Strap battery is at 100... it was 30 last time I used it? Is this working?"*

## The pipeline is working, and the data says so

Production `strap_status`, every non-null battery reading ever recorded — **exactly two distinct
values**:

| value | readings | span |
|---|---|---|
| `100` | 43 | 2026-09-23 23:19 → 2026-09-27 20:58 |
| `30` | 17 | 2026-09-25 20:54 → **22:26 the same evening** |

Every `30` falls inside one 92-minute window. Before and after it, `100`.

The chip was not stale, which is why it is not dimmed: the strap connected at 20:58 today and
reported 100 then. `STALE_AFTER_MINUTES = 180` and the reading was minutes old.

## A CR2025 cannot recharge

So `100 → 30 → 100` is not a state of charge. It is coin-cell voltage sag: under a sustained BLE
session the cell droops and the H10 reports lower, and at rest it recovers. The 30s being one
contiguous session rather than scattered is what rules out a decode fault — a misread would vary,
and this does not. Two values across five days also says the H10's gauge is coarse rather than a
0–100 scale.

## The defect is what that means for the chip

The cell only reads low while under load, which is exactly when the owner is training and not
looking at Home. At rest — when he does look — it reads 100. **So the chip will read 100 until the
cell is nearly dead, and the one number that predicts failure is the one it never shows.**

The low-battery notification did work: `LOW_THRESHOLD = 35`, reading 30, so it fired during that
session. That is the existing backstop and any change must preserve it.

Recommendation filed: show the lowest reading from the most recent connected session rather than the
latest, labelled as under-load.

## A second, latent bug found on the way — not the cause

`chest-strap-pairing.tsx:94` reads the battery as `new Uint8Array(batt.buffer)[0]`. `batt` is a
`DataView`, and `.buffer` is the whole backing `ArrayBuffer` — it discards `byteOffset`. The same
shape is two lines below on the firmware string. It happens to work because the plugin builds its
view from a fresh buffer today, which is a property of that implementation and not of the API. Filed
as `BF-216`; every recorded reading came from the native path, which is correct.

## Not exercised

Docs-only; nothing built. The production read is the owner's rows only, as every `claude_ro` view is
row-scoped. Nothing was run on the device, and `BF-215`'s change owes a workout-length device check
that the notification still fires where it does today.

<a id="2026-09-27-chore-compact-project-overview-status"></a>

# 2026-09-27 — `projectOverview.md` 309 KB → 17 KB, and four entries from an outside architecture review

**Branch:** `chore/compact-project-overview-status` · Orchestrator

An outside contributor (jsboiss, relayed by the owner) reviewed the agent architecture and argued
three things: move the task queue out of git into blob storage, merge the separate agents into one
long-running workflow, and run on a persistent server instead of rebuilding the environment each
session. Measuring the claims is what produced this PR — the largest cost turned out to be somewhere
none of the three proposals touched.

## What the measurement said

| Read by **every session of every role**, before any work | Was |
|---|---|
| `projectOverview.md` | **309 KB** |
| `CLAUDE.md` | 120 KB |
| `docs/agents/README.md` | 52 KB |

**292 KB of the 309 KB was one section**, `## 🔖 Current Status`, and none of it was status. It was
a reverse-chronological changelog — 281 per-PR narrative paragraphs — living inside the one document
every agent reads before it can start.

The blob-storage proposal targets a cost that is not there: agents never read the 2.7 MB queue into
context, because `next-item.js` parses it out of band and prints about ten entries. Moving the same
bytes elsewhere saves no read tokens and costs the CI-enforced invariants (no dependency cycles, no
duplicate IDs, no completed entry left in the queue), git's conflict detection on concurrent edits,
and the history of why an entry changed. Declined, with the reasoning in the chat and the parts
worth keeping filed below.

## The compaction

**Relocated, not curated.** The whole narrative block moved whole to
[`docs/overview/history-2026-09-27-status-narrative.md`](history-2026-09-27-status-narrative.md).
Nothing was edited, summarised or dropped.

That was a deliberate choice against the obvious one. Of the 281 paragraphs, **152 end in a pointer
to a journal entry that still exists** — for those this was a second copy. **129 carry no pointer at
all**, so `projectOverview.md` was their only record. Sorting 281 paragraphs into keep-and-delete
buys exactly the same token saving as moving them all and is where a mistake would be permanent, so
the duplicated half stays for a later sweep inside the archive, where it costs no session anything.

**Result: 2,812 lines → 179. 309 KB → 17 KB.** The baseline was tightened to match rather than left
slack. What remains is the version header, the five real status subsections (Security, Local-first
reads, Derived-score read paths, Device-only, Nice-to-have) and the Document Map.

**178 relative links were rewritten.** A link written from the repo root resolves differently from
`docs/overview/`; `check-doc-links` reported three and the fix was applied to all 178, the same class
as the known-issues move earlier this month.

## A defect found by moving the file

One `Detail:` pointer was stale: `LB-158`'s cited an entry that `fold-journal-entries.js` had already
folded into a batched history. **The fold moves files and rewrites nothing that cites them**, and
because these are bare paths in backticks rather than markdown links, `check-doc-links` structurally
cannot see them — it reported OK on the same file. 1 of 152 is a low enough rate to be trusted and
quiet enough to spread. Fixed here; the mechanism is `OR-198`.

## Filed

- **`OR-194`** — three guards a persistent local environment needs first: separate working copies,
  per-lane databases (`setup.sh` hardcodes one port and one name), and a re-create-from-migrations
  rule. The third is the sharp one: the `claude_ro` view generator reads the dev database, and
  generating against a drifted one silently drops columns from the security views. The fresh clone
  is what makes that impossible today.
- **`OR-195`** — move **Lane A only** to a local persistent session. The argument is capability, not
  speed: Lane A owns `android/**` and cannot build it, because the sandbox has no Android SDK.
  Lane B stays in the cloud as a control group.
- **`OR-196`** — docs-only PRs run the full suite. The obvious `paths-ignore` fix would leave the
  required checks "Expected" forever and block every merge; the workflow's own comment already says
  so. Needs a no-op job publishing the same names, and a before/after measurement.
- **`OR-198`** — the fold-breaks-pointers mechanism above.

## Not done, deliberately

The 152 duplicated paragraphs still sit in the archive. `CLAUDE.md` (120 KB) and
`docs/agents/README.md` (52 KB) are now the largest fixed reads and are the obvious next targets —
`CLAUDE.md` was already taken from 1,061 to 937 lines this month.

**Not exercised:** documentation only, no code changed and no runtime surface touched. Gates at
close: `Ran 83 of 83` Custom Rules, `check-doc-links: OK (891 files)`,
`check-backlog-pointers: OK — 553 entries`.

<a id="2026-09-27-chore-or-sweep-buried-owner-decisions"></a>

# 2026-09-27 — the BF-202 sweep: 70 was an upper bound, and the real finding was a routing defect

**Branch:** `chore/or-sweep-buried-owner-decisions` · Orchestrator

`BF-202` estimated **up to 70** owner decisions buried inside `Lane: A`/`B` entry bodies, where the
routing field cannot see them, and said plainly that 70 was a keyword match rather than a finding —
*"the work is separating those"*. This is the first pass.

## What the measurement said

Via `parseEntries`, not a grep over the file: **422** Lane A/B entries carry no `Ask:`; **54** of
those contain owner-decision language; **13** of the 54 already carry `Gate: owner`. Read
individually they fall into four groups, and only one is what the entry was filed about.

## ① Already decided — no action

`TN-64`, `OR-138`, `PS-17`, `Q-407`, `BF-81` all say *"the owner's call"* about a call he has since
made and which the entry itself records. A keyword scan cannot separate these from a live question.
This is most of why 70 was never a finding.

## ② Stale — the answer exists and the entry does not know

- **`RV-165`** said re-deriving scale composition at 158 cm was his call. `RV-170` **authorised it**
  on 2026-09-24 as a limb-(a) recompute-from-stored-inputs.
- **`Q-298`** said repairing the zero one-rep-max rows was his call. `RV-170` **answered it** as a
  limb-(b) hand-edit — do not rewrite, mark known-bad — and corrected the count to **15, not 10**
  (the 08-09 and 08-16 Pull clusters sat on deload sessions).

Both now carry the answer. Left alone, each would have been re-asked.

## ③ The real finding: entries routed by a sentence rather than a field

**`Q-422` has no `Lane:` field at all.** `parseEntries` was reading `A` out of the prose *"Tuning
proposes and the owner signs off; Lane A implements"* — a routing decision made by a phrase nobody
wrote as a field. This is the same class as the `Lane: DV` slip earlier today, and as the `Lane: T`
incident CLAUDE.md already records, hit a third time.

**`RV-38` had a real field and the same prose**, and `check-backlog-pointers` refused the push when a
second field was added — *"a re-laning that adds a field and leaves the old one standing is routed by
the stale value and nothing says so"*. That check earned its place: my bullet claimed the entry had
no field, which was false. Its `Lane: B` half had already shipped; the old field is demoted to prose
and kept, because it records which half.

**Five entries re-laned to `T`** — `Q-422`, `RV-38`, `Q-306`, `Q-420`, `LA-121`. Each is a scoring
change, and `Lane: T` (OR-178) is the field that says a Tuning proposal is owed before anyone builds.

**`TN-22` is the same class inverted.** It states it *"carries `Gate: owner` … so it parks honestly"*
and carries no `Gate:` field — so it claims to park and sits READY in Lane A. Flagged on the entry
and deliberately **not** "fixed": adding the gate would hide it rather than resolve it, and which of
those is right depends on whether the decision is still live.

## ④ Genuinely live and still buried

The output of the sweep, recorded on `BF-202` for the next owner round: hiding the readiness score
until the check-in is saved (`TN-67`, `TN-50`); whether a guided or treadmill walk counts as doing a
prescribed run (`RV-166`); making E2E a required check (`LB-149`, `Q-297`); the destructive-migration
group's single yes (`BF-144`, `LA-71`, `LB-42`); the `event_name` drop (`Q-540`); a second Railway
service (`Q-251`, money); the collection tier mapping (`PS-51`); the wallpaper tint default
(`BF-145`, `BF-139`, `BF-96`); removing an HTTP surface (`LA-89`); the scanner choice (`LB-38`); the
84-day re-derive (`TN-72`, `TN-74`); and one plain factual question — was *Start Again* pressed
before the back press (`BF-168`).

## One entry states something false

**`LB-13`** says *"Correcting the rule needs the owner (CLAUDE.md is not an implementer's to edit)."*
The Orchestrator owns the docs and edits `CLAUDE.md` routinely; the owner's carve-out is data, money,
auth and scoring, not documentation. Flagged on `BF-202` so it is not acted on.

## Not done

Group ④ is a list, not yet entries. Splitting each into its own `Lane: O` is the second pass, and
`LA-122` already tracks six of Lane A's — reconcile rather than duplicate.

**Not exercised:** documentation only. Gates: `Ran 83 of 83` Custom Rules, `check-doc-links` and
`check-backlog-pointers` clean, all by exit code.

<a id="2026-09-27-day-card-bodyweight-lift"></a>

# LA-164 — a chin-up on the day card read `0kg`

**Branch:** `fix/day-card-bodyweight-lift` · **Lane B** · `components/health/day-detail/**`.

Health → a day's workout card printed **`0kg`** for a chin-up. That is not a small number, it is the
wrong quantity: nothing was added to the bar and the lift is the body. RV-219 ① found it; Lane A
shipped the engine half, so `/api/day-log`'s `DayExercise` already carried `exerciseType`
(`'bodyweight'` / `'weighted'` / `null`, resolved from `exercise_library` via
`exercise_logs.exercise_id`). The card ignored it.

## What shipped

`exerciseWeight()` in a new `components/health/day-detail/exercise-weight.ts`, read by a `WeightCell`
in `day-sections.tsx`:

| stored | before | now |
|---|---|---|
| bodyweight, 0 kg | `0kg` | `BW` |
| bodyweight, 10 kg | `10kg` | `BW +10kg` |
| weighted, 60 kg | `60kg` | `60kg` |
| weighted, null | `—kg` | `—kg` |

**`BW` alone rather than `BW 0kg`** — printing the zero is how this read wrong in the first place.
Added weight keeps its unit, because `BW +10` is ambiguous without one.

Two decisions worth not re-litigating. **A non-bodyweight lift is returned byte-identical, em dash
and all.** `—kg` for an unrecorded weight reads oddly and tidying it here would be a second change
hiding inside this one — absent is not the same as bodyweight, and only `exerciseType` separates
them. And the helper is a **plain `.ts` sibling** rather than an export from the `.tsx`: that is the
repo's existing shape (`components/ui/sparkline-geometry.ts` beside `sparkline.tsx`), and a `.ts`
test importing a `.tsx` module fails Vite's parse outright — *"content contains invalid JS syntax"* —
which is what sent me looking for the convention.

## The control run is the evidence

Six unit tests pin the copy. The round trip is pinned by `e2e/la164-bodyweight-weight-cell.spec.ts`,
which seeds a `bodyweight` library row, a chin-up log carrying its `exercise_id` at 0 kg, and a
weighted row with no `exercise_id` at all — so the null-`exerciseType` path is asserted to stay on
kg in the same run. *"Reads as bodyweight"* is only correct if it is not what every row now says.

**Reverted the component and re-ran at 412 px:** the row read **`Spec Chin-Up 3 × 8 0kg`** — the
reported defect, observed rather than inferred — and the spec failed on the expected substring.
Restored, green. A spec that passes either way proves nothing, and this session has already filed
one entry on a static read that measurement refuted (LB-169).

## Verification

`tsc` clean · Custom Rules **83 of 83** · lint 0 errors, 827 warnings · **10,561** unit tests passed
· build clean · the new spec green with the fix and red without it.

**Not exercised:** the APK. This is a WebView-delivered render change with no native, safe-area,
gesture or offline-first surface, so the web harness at 412 px covers the only path it has. The
`weighted`/`null` split was asserted against seeded rows, not against the owner's 504 real logs —
Lane A measured that his Chin-Up resolves to `bodyweight` on production, and nothing here re-reads
it.

<a id="2026-09-27-docs-la157-contributor-gaps-measured"></a>

# 2026-09-27 — LA-157: the uneven gaps WERE the label fall-through, and they are already fixed

**Branch:** `docs/la157-contributor-gaps-measured` · **Lane:** Implementation B · **Code changed:** none.

## What it claimed, and what the render says

`LA-157` was the last item of `RV-217`: the Sleep contributors list shows *"larger vertical gaps
before Timing and Efficiency, which look like empty rows"*, seen in a device screenshot
(`t2-sleep-01`). The entry said to reproduce at 384 px first, and explicitly ruled out one cause:

> *"it is not the label fall-through, because those two rows always had labels."*

**Measured at 384 px dark with all ten contributors present: every row is 48 px and every gap is
exactly 10 px.** No uneven spacing, nothing that reads as an empty row.

## The diagnosis, from an accident

The first stub used invented keys (`rem`, `total`, `deep` instead of `rem_sleep`, `total_sleep`,
`deep_sleep`). Those three rows rendered **17 px tall with lowercase raw labels**, while every
correctly-keyed row rendered at 48.

That is the reported symptom exactly. **A contributor with no label does not go missing — it renders
as a short, unlabelled row**, and a 17 px row between 48 px neighbours reads as a gap.

So the entry ruled out the right cause by looking at the wrong rows. It reasoned from Timing and
Efficiency, which always had labels; the short rows were `hrv`, `hr` and `schedule`, which **did
not** have labels when that screenshot was taken. Sorted by score, they sat next to Timing and
Efficiency, so the gap appeared *beside* the labelled rows rather than on the unlabelled ones.

**`RV-217` fixed it on 2026-09-27** by giving those three labels and contributor-guide entries. The
same PR added `rv217-every-contributor-has-a-label.test.ts`, which derives the key set from the model
and asserts *"a human label for every one — never the raw key"* — so the root cause is guarded, and
the symptom cannot return through that door.

`LA-157` is removed: its remaining item was fixed by the entry it was split from, before anyone
looked.

## Worth knowing when reading the next screenshot

**An unlabelled contributor is a 17 px row, not an absent one.** Somebody looking at a screenshot
sees whitespace and reasons about margins and `gap` utilities — which is what happened here, and
what sent the entry's own diagnosis past the cause. The list's container is a flat `space-y-2.5`
with no per-row overrides, so **uneven spacing there is always a row-height story, never a
container one.**

## Not exercised

The device. This is headless Chromium at 384 px, so the absolute numbers are the harness's — but the
claim is comparative (48 against 48, 10 against 10) and a renderer does not make nine equal gaps
unequal. The ten-contributor case is stubbed, since the seeded account has five; the stub uses the
real keys from `lib/oura/contributors.ts`, which is the mistake that produced the diagnosis in the
first place and is now the thing the fixture gets right.

<a id="2026-09-27-docs-la162-local-auth-verification"></a>

# 2026-09-27 — the four owner-gated security PRs, run locally for the first time

Lane A's previous session built #1779, #1781, #1784 and #1789 in a cloud container that could not
run `pnpm dev` or `pnpm start`. This session ran on the owner's Windows machine. Each PR's own
journal entry now carries its result; this entry records what belongs to none of them.

## What the runs showed

| PR | result |
|---|---|
| #1779 RV-192 | invited and uninvited password registrations both start inactive; the invitee reaches `/pending` with no session; an existing password account still signs in |
| #1781 RV-193 | with a minted cookie, the calendar route reads the refresh token server-side and reaches Google; `/api/auth/session` no longer carries it. Control on `main`: it does |
| #1784 RV-195 ② | deleting the row takes a live session to 401 on the next request |
| #1789 RV-197 | no CSP violations across four screens on `pnpm dev`. **The production header is still unread**, because `next start` refuses to boot on the local storage keys (`SignatureDoesNotMatch (403)`) |

All four were merged up to `main` (#1779 re-bumped to 1.477.14) and left unmerged: they are
owner-gated.

## Filed and amended

- **`LA-162`** (Lane B, `Needs: RV-192`): the sign-in toast after registering says *"or wait for
  approval if not yet invited"*, which RV-192 makes wrong for invited registrants. It also records
  an unconfirmed dev-mode observation that the register form's redirect did not fire.
- **`PS-24`**, re-measured in a real browser: immediate revocation holds. The amendment names the
  one thing that would undo it: any app call to `/api/auth/session` stamps the cookie and restores
  the one-day throttle. It also corrects a sentence about `GET /` redirecting, which it no longer
  does.

## The mistake worth keeping

The first deactivation run read **200** and looked like a refutation of PS-24. The harness caused
it: the probe had called `/api/auth/session`. That is the same trap
`docs/reviews/2026-08-18-auth-session-boundaries.md` recorded from the opposite side, where a probe
that dropped the rotated cookie made revocation look like it worked. **A session-staleness probe has
to reproduce exactly the requests the app makes, no more and no fewer.** Nothing was filed from the
bad run.

## Environment notes for the next local session

- **Port 5433 on this machine belongs to a different project's Postgres.** TrainingAI's dev database
  runs in its own container, `trainingai-dev-postgres`, on **5434**. Pass
  `DATABASE_URL=postgresql://postgres:postgres@localhost:5434/trainingai_dev` and
  **`DATABASE_SSL=false`** explicitly. Both `DATABASE_URL`s in `.env.local` point at Railway, and
  `.env.local` sets `DATABASE_SSL=true`, which leaks through if the shell merely unsets it.
- **`pnpm build` does not run under Windows `cmd`** (`NODE_OPTIONS=…` prefix). Run
  `node scripts/build-rollup-worker.mjs` then `next build` with `NODE_OPTIONS` exported.
- Stopping a background `next dev` leaves its node child holding :3000. Kill it by PID.

## Not exercised

The device, production, a real Google sign-in or calendar write, and the production CSP header.

<a id="2026-09-27-docs-record-claude-md-compaction-decision"></a>

# 2026-09-27 — measured `CLAUDE.md` for the same compaction, and decided against it

**Branch:** `docs/record-claude-md-compaction-decision` · Orchestrator

`OR-197` took `projectOverview.md` from 309 KB to 17 KB, and the stated next targets were
`CLAUDE.md` (120 KB) and `docs/agents/README.md` (52 KB). Measuring `CLAUDE.md` changed the
recommendation, so this records the call rather than the work.

## The measurement

945 lines, 120 KB. Four sections carry 47% of it: Standing Instructions 18.3 KB, Standing Agents
16.8 KB, Cache Invalidation 10.9 KB, Git Workflow 10.0 KB.

## Why it is not the same job

`projectOverview.md` was 94% one section that had become a changelog under a status heading — a
relocation with no judgement calls and nothing to weigh. `CLAUDE.md` has no equivalent block. It is
rules with their evidence attached.

**The evidence is load-bearing, and the file demonstrates it about itself.** The most cuttable-looking
passages are the ones reading *"this paragraph said the opposite until 2026-09-25, and both versions
were wrong about the mechanism"*. The branch-protection rule has been stated backwards twice and the
merge-button passage was wrong in both directions; the record of that is what prevents a third.

**The saving is also smaller than it looks.** A standing role runs as one continuous session, so this
file is read at session start and served warm after — the cost is per session *start*, not per turn.
That is exactly why 292 KB of per-start noise was worth removing and a few KB of rules is not.

## A claim I withdrew

The Standing Agents section says it is the must-bind subset of `docs/agents/README.md`, which implies
some of it is a second copy. I wrote a token-coverage scan to test that, and it was too weak to
support the conclusion — several bullets had no testable tokens at all, scoring 0/0. No tool owns the
question *"is this paragraph's content also in that file"*, so under the repo's own rule the scan
could find candidates and could not conclude. **Withdrawn rather than reported.** Doing it properly
is a careful read of both files; `OR-199` records what it would have to respect.

## Filed

**`OR-199`** — a `Reference:` entry holding the measurement and the reasoning, so this is not
re-proposed as an obvious win by the next session that sees a 120 KB file.

**Not exercised:** documentation only. Gates: `check-backlog-pointers` and `check-doc-links` both
clean by exit code.

<a id="2026-09-27-docs-retract-lb169"></a>

# 2026-09-27 — LB-169 retracted the day it was filed: the button is already 48 px

**Branch:** `fix/empty-meal-add-tap-target` · **Lane:** Implementation B · **Code changed:** none (the fix was written, measured to be unnecessary, and reverted).

## The claim, and why it was wrong

`LB-169` was filed this morning: the empty meal's header `+` is `h-9 w-9` in
`components/nutrition/meal-card.tsx`, **36 px**, under the 48 px floor the rest of the screen holds
to. It was read straight out of the source and never rendered.

**Measured in the harness at 384 px: the button is 48 × 48.** `app/globals.css` carries a global
floor —

```css
button,
[role="button"] { min-height: 48px; min-width: 48px; }
```

— with a `.tap-dense` opt-out for deliberately dense controls. So a Tailwind `h-9 w-9` on a
`<button>` is raised to 48, and **the size class is not the rendered size**. The entry's premise does
not exist.

The fix was written first (a 48 px box pulled back to the row's footprint by negative margins), and
the probe that was meant to prove it works instead reported 48 × 48 *before* the change. That is what
exposed it — the control run, not the review.

## What was corrected, in four places

The claim had already propagated, which is the part worth recording:

1. **`LB-169`** — removed from the queue.
2. **`RV-213`** — carried it as a "rule violation rather than a taste call" that had to ship
   alongside the collapse. Retracted in place, and the entry is now **unblocked**: collapsing an
   empty meal leaves a control already at the floor.
3. **`docs/domains/nutrition/README.md`** — the open-issues line is now a ✅ with the reason.
4. **The mockup page the owner was given** (`SQxd9yfvjcbnZVseiPVwHh`) — it told him the `+` "should
   grow to 48 as part of this". Republished with the claim withdrawn and the measurement in its
   place, because he may act on that page and it was wrong.

## The lesson, which this repo already had from the other direction

`RV-211` ⑤ recorded that a source grep saying *"does not reproduce"* was the wrong conclusion — the
marks were real on screen. **This is the same rule filing a defect instead of dismissing one.** A
size class is a hypothesis about a rendered size; a global stylesheet can override it, and this one
does. The existing baton line said *render before fixing and before dismissing*; it now says before
**filing** too.

Worth knowing for the next sweep: **`h-9`/`h-8` on a `<button>` in this repo is not evidence of an
undersized target.** Only a render is, and `.tap-dense` marks the opt-outs.

## Two queue entries cleared in the same pass

Picking the next item turned up two more finished entries sitting in READY, the same class `LB-171`
fixed this morning from a different cause:

- **`RV-212`** — its own first line reads *"Nothing is left here for a lane"* (①② shipped, ③⑤ dropped
  by sweep 64, ④ moved to `LB-167`), and it was still rank 1 of Lane B. Removed. Its ③ carried a
  finding `RV-208` did not have — that the near-white primary is the **dialog** primary rather than a
  one-off, since the weigh-in sheet's Save matches it — so that moved to `RV-208` rather than
  disappearing with the entry.
- **`LB-169`** — removed as above.

Lane B's READY list went from 15 to 13 without anything being built, which is the point: neither
entry had work in it.

## Not exercised

Nothing on-device. The global floor is plain CSS served to the WebView the same way, so the
measurement carries — but it was taken in headless Chromium at 384 px, not on the S25.

<a id="2026-09-27-docs-rv211-hr-unit-measured"></a>

# 2026-09-27 — RV-211 ⑥ measured: both proposed fixes overflow the cell (docs only)

**Branch:** `docs/rv211-hr-unit-measured` · **Lane:** Implementation B · **Code changed:** none.

## What this was

`RV-211` headed Lane B's READY list with one item left open — ⑥, *"Resting HR sits in a score ring
with no unit… Add 'bpm', or style it differently from the scores."* The entry flagged that appending
a unit *"has to be MEASURED rather than assumed"*. So it was measured, in the harness at 384 px dark
on the seeded account, and **both of the fixes it proposes are impossible as written.**

## The measurement

A cell is **82 px** wide at the 384 px viewport.

| Proposal | Measures | Against |
|---|---|---|
| `"58 bpm"` at the value's own font (34.4 px) | **140 px** | 82 px cell — 1.7× |
| `"Resting HR (bpm)"` in the label | **97 px** | 82 px cell, label currently 60 px |

So "add bpm" is not a small change; it is not available at all in either place the entry meant.

What *is* available is a small caption under the number: the component already draws one there — the
cue word at 7.5 px — and in the **default** style `showDot` is `false`, so that slot renders nothing
and is free. Confirmed in the same measurement (`cueWord: null` on all four cells).

## Why it stopped being an implementer's call

**There are nineteen ring styles**, not the four the entry counted — `SCORE_RING_STYLES` in
`lib/home/home-prefs.ts` is user-selectable, and four renderers serve them. Two of them defeat a
caption outright: **`nolabel` deliberately removes the label because "the glyph is the name"**, so a
unit there fights the premise of the style, and `overlap` has no caption slot. No single treatment is
right for all nineteen, which is a fork rather than a fix:

- **(a)** the unit appears only where a label already does — cheap, reversible, leaves `nolabel` and
  `overlap` as ambiguous as they are today;
- **(b)** the HR cell is styled differently from the score cells — fixes every style at once, and
  changes the visual language of the row he reads every morning.

## What landed

**`LB-172`** (`Lane: O`, ungated), carrying the measurement, the fork, a recommendation of (a), and
what (b) is genuinely better at. Split out rather than left as ⑥ because **a question buried inside a
`Lane: B` entry is invisible to the Orchestrator** — the lane field is what routes it, which is
CLAUDE.md's own instruction for this shape.

`RV-211` keeps ④ as its `Keep:` — the header row that cannot hold the date and both pills, parked on
`LB-157` — and has **left READY**, because nothing in it is startable.

## A second finding, recorded on `LB-166` rather than dropped

While waiting on PR #1803's advisory E2E, it was **cancelled at 45m17s** — the job ceiling again, to
the second, with no superseding push. That is `LB-166`'s second occurrence, and the first one that
cost something: **#1803 added a spec, and the job died before reporting, so that spec has never been
verified in CI.** It is green locally (4 passed, control-run against the bug and against the entry's
own suggestion) and now sits on `main` with no CI verdict at all.

The entry has been updated. The distinction that matters is that the ceiling is now reached by an
**ordinary** PR, so the margin is gone rather than thin, and every spec added from here lands
unverified while this stands.

## Not exercised

Nothing on-device: the numbers are from headless Chromium at 384 px, so they are the harness's
metrics, not Samsung's WebView. They are comparative rather than absolute — 140 px against an 82 px
cell does not become available on a different renderer — but a mockup is still owed before any code,
and it should be drawn against these figures.

<a id="2026-09-27-docs-rv215-spinner-count-measured"></a>

# 2026-09-27 — RV-215 ③ measured: 60 of the 88 spinners are correct (docs only)

**Branch:** `docs/rv215-spinner-count-measured` · **Lane:** Implementation B · **Code changed:** none.

## What this was

`RV-215` ③ — *"88 bare `Loader2` spinners in 57 files, against skeletons in 58, and the `EmptyState`
primitive used in only 10"* — headed Lane B's queue as the entry's last open item. It was measured
before being built, and it is not buildable as written.

## What the 88 actually are

| Kind | Count | Verdict |
|---|---|---|
| In-button, beside a `disabled` prop | **60** | Correct. A control showing it is working. |
| Content stand-ins | **23** | Candidates — but **7 are admin**, not daily screens |
| Unclear | 5 | Need reading |

At least one of the 23 is also correct: `food-database-results.tsx:37` is a 12 px spinner beside a
section label while a search runs — inline, not standing in for content.

So the daily-screen subset the item asked to do first is **16 sites**, eleven of them nutrition, not
88 across 57 files.

## The part that makes it unbuildable as written

**`EmptyState` is not a loading state.** It takes `{ icon, title, action }` and says *there is nothing
here*. "Convert spinners to `EmptyState`" folds three different states into one:

- a spinner filling a content area wants a **skeleton**;
- an empty result wants **`EmptyState`**;
- a failed one wants an error with a retry — which is what ① already shipped.

So the low `EmptyState` count (12) is not evidence of debt, and converting against that target would
make screens claim emptiness while they are still loading.

## Re-scoped rather than half-built

The item now names what is actually buildable — the centred content-area spinners on daily screens
become row-shaped skeletons, with `food-list.tsx:195` as the reference case, since `loadingMeals` is
already a prop and the state is owned by the parent. **Per site it is a judgement, not a rename**,
which is why it stays an entry rather than becoming a sweep. No site was converted: building against
a category error would have been the wrong call, not a fast one.

**This is the third over-claim in this one entry from a static read.** ② was wrong about all three
cards it named (found 2026-09-27), and ③ conflates three states. Sweep 63 read this at source, and
every item of it that has since been rendered has come back smaller.

## Also cleared

**`RV-214`** — ①③④ shipped in #1775, ② does not reproduce, and ⑤ is a pick, so nothing was left for a
lane. ⑤ splits to **`LB-173`** (`Lane: O`): the session card's Start Workout has no icon, the
pre-workout screen's carries a dumbbell, and *"use the same variant"* does not say which. Filed with
**no recommendation on purpose** — nothing in the repo favours either direction, and inventing one
would dress a coin toss as analysis.

## Not exercised

Nothing rendered and nothing on-device: the classification is a static pass over `app/` and
`components/`, which is the same kind of read that produced the over-claims above. It is reliable for
the in-button split (an enclosing `<button>`/`disabled` is unambiguous) and it is a **starting list,
not a verdict**, for the 23 — `food-database-results` is already one it got wrong, and that is
recorded on the entry rather than smoothed over.

<a id="2026-09-27-docs-rv215-spinners-struck"></a>

# 2026-09-27 — RV-215 ③ struck: the 88 spinners were 0 defects (docs only)

**Branch:** `docs/rv215-spinners-struck` · **Lane:** Implementation B · **Code changed:** none.

## The number shrank three times, and the last two were mine

`RV-215` ③ read *"88 bare `Loader2` spinners in 57 files, against skeletons in 58, and the
`EmptyState` primitive used in only 10."* It was the entry's last open item and headed Lane B's
queue. Reading every candidate site closes it with **no conversions**.

| Stage | Count | How it shrank |
|---|---|---|
| The entry | **88** in 57 files | a grep |
| Static classification (#1807, mine) | **23** stand-ins, **16** non-admin | 60 are in-button spinners beside a `disabled` prop — correct |
| Reading all 16 (this PR, mine) | **0** clearly wrong | see below |

## What the 16 daily-screen sites actually are

- **Four carry their own copy** — *"Analysing…"*, *"Reviewing your session against your recent
  data…"*, a toast with a label. A skeleton there would be **worse**: the wait needs explaining, and
  a shaped placeholder explains nothing.
- **Seven are inline busy states** — swapping an icon while a photo uploads, labelling a macro
  lookup, a chip in a builder row.
- **The rest stand in for a CONTROL, not content** — a small spinner where a meal-type picker will
  be, a GIF box.

## The reference case argues against itself

`food-list.tsx:195` looked like the clearest convert: a centred spinner filling the list area, with
`loadingMeals` already a prop so the state was owned by the parent. Two things killed it.

**It cannot know what follows.** After loading, the surface shows either saved-meal cards *or* "No
meals saved yet". Row-shaped skeletons would promise content that may not exist — a worse lie than a
spinner.

**And the parent already cache-seeds.** `saved-meals-sheet.tsx:129` does `readCacheSync('saved-meals')`
then `setLoading(false)`, so on a repeat visit the spinner never appears. The repo's instant-paint
rule — *a skeleton flash on a repeat visit is a bug, seed synchronously from cache* — is already
satisfied here. What remains is a cold first load, where a spinner is the honest thing.

Two sites are arguable and deliberately left: the GIF box in `exercise-preview-sheet.tsx:52` and the
collapsible in `achievements-section.tsx:48`. Neither is a defect, and converting two sites to close
a "57-file" item would be theatre.

## Why this is worth a journal entry rather than a quiet delete

**`EmptyState` is not a loading state.** It takes `{ icon, title, action }` and means *there is
nothing here*. The item's own framing folded three states into one count — loading, empty, failed —
and its low `EmptyState` use count was never evidence of debt. ① had already shipped the failed case
correctly.

**This is the fourth over-claim in this one entry, and the last two were mine.** ② was wrong about
all three cards it named. ③'s count was 88; my static re-scope said 16; reading them says 0. That is
the same lesson `LB-169` cost this morning, twice in one day: **a static classifier is a candidate
list, never a verdict.**

`RV-215` is removed from the queue — ① shipped (#1780), ② wrong, ③ struck.

## Not exercised

Nothing rendered and nothing on-device. Every judgement here is from reading the 16 sites and their
callers, which is the same method that produced the over-claims above — with the difference that the
claims being made are now *narrower* than the source, not wider. The two arguable sites are named
rather than folded into the "0" so a later sweep can disagree with a specific thing.

<a id="2026-09-27-failed-read-says-so"></a>

# RV-150 — the probe's own untested case was the one that mattered

**Branch:** `fix/failed-read-says-so` · **Lane B** · `components/more/**`, `app/more/**`.

RV-150 blocked each of 24 read endpoints in turn on the phone and found **nothing visible changed
anywhere** — every card kept its cached value as if current. Its last line: *"Not tested: a failure
with no cache (cold start)."* That is the case the standing rule (Q-499) is actually about, and it
gives a different answer.

## What a cold failure looked like

Storage cleared, every `GET /api/*` returned 500, at 412 px:

| surface | before | verdict |
|---|---|---|
| Home | *"Your week in review didn't load"*, *"Couldn't load today's timeline"*, em dashes for numbers | **honest** — the reference |
| More | name, email, level, XP and trophy case all absent; identity fields fell to their `??` defaults | reads as a new account |
| Profile details · readings | **"What the app has measured"** absent, heading included | unreportable |
| Profile details · tests | **"Tests and scans"** absent, heading included | unreportable |
| Nutrition | **`0 KCAL`**, `0 g` protein/carbs/fat, *"Set a calorie goal"* | states a falsehood |

Three are fixed here. Nutrition went to **RV-103**, which owns that hook and is next in the queue;
Home's body-battery card and Health's three missing sections are **LB-175**, because the leaf cards
do not fetch — the screen does, so the fix is a flag per read in the parent, not an `onError` on a
card.

## The grep was wrong about three of five

23 of 43 `useCachedValue` call sites pass no `onError`. That list and the render diff do not line up:
`body-battery-card.tsx` and `energy-card.tsx` **do not fetch at all** — both take their data as a
prop and default it — so neither appears in the grep's list and neither is fixable there. Reading the
symptom back to the component that owns the read is the whole job; the call-site list is a starting
set of candidates.

## What shipped

`measured-overview-section.tsx` and `performance-overview-section.tsx` both end in `return null` when
they have nothing, so a failed load removed the heading too. Each now separates the two: nothing
recorded still renders nothing, a failure renders the heading and one line. In
`performance-overview-section.tsx` the existing `onError` **set `tests` to `[]`**, which collapsed
into the same empty branch — the flag is what tells them apart.

More's profile is the RV-87 shape one level up: with no user loaded, every field is a `??` default,
so a failure rendered *"No name set"* and a blank email as fact. `more-content.tsx`'s two
`cachedFetch` calls had `.catch(() => {})`, which **cannot fire** — `cachedFetch` resolves a boolean
rather than rejecting (RV-84) — so they now pass `onError`, and the flag clears on a load that lands.

Nothing was added over data that did arrive: a partial load keeps its readings and says nothing. A
banner over good data is worse than the gap it explains.

## Verification

`tsc` clean · Custom Rules **83 of 83** · lint 0 errors · full unit suite green · build clean.

`e2e/rv150-failed-read-says-so.spec.ts` drives a cold start with the reads failing. **Control-run:**
both failure tests go red against `origin/main`, and the **healthy** cold-start case passes in both
runs — without it a component that always rendered the line would pass everything. The healthy-path
capture is byte-identical before and after on both screens.

**Not exercised:** the device. This is render-only — no native, safe-area, gesture or offline-first
surface — so the 412 px harness covers the path it has. One thing the harness cannot reproduce is a
service-worker-served response: `page.route` does not see those, which is why RV-103's device work
had to block at the network layer.

<a id="2026-09-27-fix-backlog-interrupted-field"></a>

# 2026-09-27 — LB-171: a shipped entry was rank 1 of Lane B's queue, and the field said so

**Branch:** `fix/backlog-interrupted-field` · **Lane:** Implementation B · **Found:** working the queue.

## What happened

`node scripts/next-item.js --lane B` put **`RV-210` at rank 1 of READY**. Its own body says all three
of its fixes shipped and that it stays queued only for a device pass — so an implementer working the
queue top-down takes a finished entry and finds nothing to build. That is precisely the starvation
the `Keep:` field exists to prevent.

The entry had written it as:

```
- **Keep / Done when:** P26 shows no input or submit button covered, …
```

Every field matcher anchors the colon **directly after the name**, so `Keep / Done when:` parses as
nothing at all. Confirmed against `keepFromLines` — the parser that owns the question — rather than
by reading the regex: it returns `null` for that line and a field for `- **Keep:** …`.

This is `decorated-field.js`'s failure seen from the other side. That one catches a marker written
*in front of* a field (`⚠ Gate: owner`). This is words written *between* the name and the colon, and
the existing guard cannot see it for the same reason the bug exists: its own pattern needs `**Keep:`
adjacent.

## Scope, measured

Three entries, five bullets — found by asking the parser which `**Keep`-opening bullets it cannot
read, not by grepping:

- **`RV-210`** — `Keep / Done when:`, at **rank 1 of Lane B**.
- **`BF-191`** — `Keep ①, the owner's:` and `Keep ②, the device check:` (rank 8 of `DV`).
- **`BF-188`** — `Keep ①:` and `Keep ②:` (rank 41 of `O`).

All three now declare a real `Keep:` and carry their enumeration after the colon. `RV-210` has left
READY and prints under KEEP with its residue stated.

## The guard, and the false positive that shaped it

`scripts/lib/interrupted-field.js` + a new failure in `check-backlog-pointers.js`, keyed on the
colon appearing inside the bold span rather than on the extra words — **and suppressed when the real
parser can read the line anyway**, because the em-dash form `**Keep — three things:**` parses fine
and flagging it would be flagging correct entries.

**The first version was wrong, and running it is what showed that.** It flagged `RV-143`'s
`**Needs hardware the agent does not have (~5):**` — which is prose. Every one of these field names
is also an ordinary verb, and the backlog uses them that way with a trailing colon to introduce a
list. The separation: a verb is followed by its object, a **lowercase** word; an interrupted field
carries punctuation or an enumerator first (`/ Done when`, `①, the owner's`). With that, all nine
real shapes classify as intended and the sweep is clean.

Control-run: restoring `RV-210`'s original line fails the check with the exact message.
`scripts/__tests__/backlog-interrupted-field.test.ts` pins both halves, including the five prose
lines that must never trip it — the same shape `backlog-decorated-field.test.ts` uses, and for the
same stated reason: a check that fires on correct entries is a check somebody turns off.

## Not exercised

No product code and no runtime — this is queue tooling and backlog prose. Nothing here reaches the
APK, the device, or any user-visible surface, so there is no device pass to owe and no version bump.

<a id="2026-09-27-fix-claude-ro-twin-numbering"></a>

# 2026-09-27 — the migration counter was half the problem; the other half is 92% of the corpus (BF-214)

An outside contributor pushed back on the review comment we left on `#1608`: *"it's impossible to
fix, because by the time I update it, it's already outdated. Which is why I raised the issue."*

He is right, and the advice was unworkable. `main` consumes **2 migration numbers a day**, every day
for the past week. His PR has been open since 25 Sep. Telling him to renumber to 290/291 was telling
him to run a race he cannot win.

## The root cause is not the counter

Measured on `main`: **59 of 287 migrations are `claude_ro` twins — 85,881 of 93,632 lines, 92% of
the entire corpus.** Each is a ~1,688-line full snapshot that drops and rebuilds all 98 views. Only
the newest affects the final schema.

That steady 2/day is **one real change plus one twin**. So the twin doubles number consumption, and
half of every collision he hits is a snapshot file that has no business owning a number. It is also
what makes the collision *silent*: two table migrations both apply and succeed, but two twins sort
by filename and the later one drops the schema the earlier just built.

## Two things the stress-test changed

**Runtime generation was the first draft and is wrong.** The generator is default-deny by
construction — a `DENY` map withholds the password hash, four Oura secrets and three image blobs,
and an unclassifiable table calls `process.exit(1)` rather than emitting an unscoped view. Two
properties depend on the file being checked in: what columns are exposed is reviewable in the diff,
and a classification failure lands where a human sees it rather than on a production boot with the
schema already dropped. So: one checked-in file, regenerated, applied after the migration loop.

**A naive timestamp rename is a trap.** Both appliers sort lexicographically, and
`"202609270534_x.sql" < "289_y.sql"` because `'0' < '8'` — every new migration would run before
every old one. Sorting by the leading integer fixes it, one line per applier.

## Three corrections to our own record

**`#1762` never merged.** It was reported as landed; it is open, conflicted, and has **zero CI runs**
— which is what a conflicted PR always looks like, since GitHub schedules no workflow for one.
Another session had already folded the journal and created the same `history-2026-09-27-folded-2.md`
filename. Its unique content — the seven-PR register and the two red required checks — is rebuilt
here surgically, as an insertion rather than a rewrite, so it cannot conflict the same way.

**`TN-80` on `main` is still the stale "three open PRs" version**, naming `#1592` which merged as
`#1616` before the entry was written, and missing `#1755` entirely.

**A grep of mine nearly published a false conclusion, one day after the rule against exactly that.**
Counting `red|blocked` in TN-80 returned 4 and I read it as "covered". The hits were
"c**red**ential", "fee**d**back", "fea**red**". Reading the entry showed it covers none of it. OR-187
says verify with the tool that owns the question; a count is not a read.

## Not exercised

Docs-only. No product code, nothing run on the device, and no migration touched — `BF-214` is filed,
not built.

<a id="2026-09-27-fix-home-streak-reads-schedule"></a>

# 2026-09-27 — LA-156: Home's streak reads the schedule (v1.477.15)

**Branch:** `fix/home-streak-reads-schedule` · **Lane:** Implementation B · **Entry:** `LA-156` (removed from the queue).

## What shipped

Home's streak card carried its own copy of the calendar-day rule with the rest gap hardcoded to
**2**. That is the *floor*, not the answer: `streakRestGapFor` raises it from the user's own
schedule, so someone training Mon+Tue gets 5 (BF-122a). Home could not do that because it never read
the schedule, so for a weekly user it under-reported against `/api/achievements`.

Home now calls the shared `computeDayStreak` with a schedule-derived gap. The rule lives once
(RV-216). For the owner — on a rotation, where the floor applies — nothing changes.

## ⚠ Deviation from the entry's "done when", stated rather than buried

`LA-156` asked for `app/session-select/compute-streak.ts` to be **deleted**. It survives as a **shape
adapter** with its rule removed, and the reason is measured: its caller is a size-ratcheted hotspot
at **1,444 lines against a 1,448 baseline** — four lines of headroom — and inlining the conversion
needed about six. The baton's own rule applies (*`check-component-size` refuses an append to a
hotspot, and the answer is the extraction you already owed, not shaving comments*). What the entry
was really asking for — that the duplicated **rule** is gone — is done: nothing in that file decides
what a streak is.

## The bug this would have shipped, caught by the adapter

**Home's date keys use slashes.** `dayKeyInTz` ends `.replace(/-/g, '/')`, while `computeDayStreak`
parses `` `${d}T00:00:00Z` `` — and `Date.parse('2026/09/27T00:00:00Z')` is **NaN**.

Passing Home's keys straight through would not throw. Every gap would be NaN, every comparison
false, and the card would quietly print a wrong number. Normalising in the adapter is the change's
load-bearing line, not tidying. It is pinned by a test that fails 5 of 6 without it.

## RV-57's contract updated, not weakened

`rv57-streak-lookback-contract.test.ts` pinned that this file imports `STREAK_LOOKBACK_DAYS` and
walks a loop to it. **The loop is gone**, so those two assertions were replaced:

- **The supplier assertion stays and is the half with teeth** — `app/api/streak-data/route.ts` still
  imports the constant. Narrow that window by hand and Home disagrees with `/api/achievements`,
  which reads the history directly. Control-run: deleting the route's import turns it red.
- **The consumer assertion is now structural** — it delegates to `computeDayStreak` and walks no
  window of its own, so BF-176's failure (a supplier narrower than the consumer manufacturing rest
  days out of missing keys) is **impossible rather than guarded**. A formula handed the dates has
  nothing to assume about their span.
- A third case keeps any bare `365` out.

## Verification

Both halves control-run: hardcoding the gap back to 2 fails the Mon+Tue case; removing the slash
normalisation fails **5 of 6**. `rv102-one-card-colour-table` failed briefly for an unrelated reason
worth knowing — those file-scanning tests enumerate via git, so a `rm` without `git add` leaves the
index naming a file that is gone and they die on `ENOENT`, not on anything in the diff.

Full suite **1,120 files / 10,555 tests, exit 0**, zero `[late-console]` escapes. Home rendered at
384 px with no page errors; the card still reads "— days" on the seeded account, which has no
history.

## Not exercised

The APK, and one thing the sandbox cannot show: **the behaviour change only appears for a user on a
weekly schedule with a gap longer than two days.** The owner is on a rotation, so his number is
unchanged by construction — which means the fix is verified by the unit tests and by structural
equality with `/api/achievements`, not by a number moving on his screen. The seeded account has no
streak at all, so the render proves the card paints, nothing more.

<a id="2026-09-27-fix-late-console-teardown-race"></a>

# 2026-09-27 — LB-168: `pnpm test` exiting 1 with zero failures, root-caused and fixed

**Branch:** `fix/late-console-teardown-race` · **Lane:** Implementation B · **Files:** `vitest.setup.ts`.

## The defect

`pnpm test` exited 1 while reporting `1111 passed | 0 failed`, roughly one full run in five, with
`EnvironmentTeardownError: [vitest-worker]: Closing rpc while "onUserConsoleLog" was pending`. It had
been attributed to two unrelated files and reproduced on neither.

## Root cause

Vitest carries every console call from the worker to the main process over an RPC. A log emitted
**after its file's tests have finished** can still be in flight when that worker's channel closes.
The error names whichever worker was closing rather than whoever logged — which is why the
attribution was meaningless and the file-by-file hunt could not converge.

A hook in `vitest.setup.ts` that flags any console call after the last `afterAll` found it on the
first run. **Across four instrumented full runs, every escape was one emitter and one stack:**
`ensureSchema`'s informational summary (`[ensureSchema] 0 applied, 0 already present, 0 failed`),
reached from an **unawaited `scheduleFlush`** in `lib/rate-limit.ts` whose `flushKey` awaits
`ensureSchema` after the test file has already returned.

**The escaping files change between runs**, which is the whole reason this looked file-specific. The
flush races the remainder of its own file: a fast run swallows it, a slow one does not. Three named
runs produced **seven distinct files with zero overlap**. Any file exercising a rate-limited route is
a candidate, so there was never a finite list to fix.

## What shipped

**Stop forwarding `ensureSchema`'s `info` output under test.** Vitest never carries it, so the race
has nothing left to lose. `console.error` is untouched — a migration's `FAILED` / `DID NOT APPLY`
must never be swallowed. Done in the test setup rather than in `lib/data/postgres/client.ts`, so the
log keeps working in production (where it is the only record of what a boot applied) and production
code gains no knowledge that tests exist; there is no `process.env.VITEST` anywhere in it today and
this does not add the first one.

**Plus the detector, kept permanently.** `[late-console]` reports each distinct escape once, with its
stack and its file, straight to `stderr` — the process's own fd, so it cannot join the race it
reports. It is non-fatal on purpose: an escape only sometimes loses the race, so failing would trade
a rare confusing red for a rare clear one while breaking runs that are otherwise sound. It cannot
prevent an escape; it means the next one costs a read instead of a day.

**Verified:** two consecutive clean full runs post-fix — exit 0, zero escapes, zero `[ensureSchema]`
noise, **352 s against a 348 s pre-fix baseline**, so no measurable cost.

## Two fixes built, measured, and rejected

Both are written into `vitest.setup.ts`'s comment so they are not re-derived.

1. **Draining globally from the setup file** (`await import('@/lib/rate-limit')` in an `afterAll`).
   Correct in shape. It took the suite from **348 s to 482 s (+39%)**, because that import pulls `pg`
   into all ~1,100 files' isolated module registries. It also **failed 70 files outright**: they
   `vi.mock` the module partially, and **vitest's mock proxy throws on reading an absent export**, so
   even `mod.fn?.()` raises — `'fn' in mod` is the only safe probe. That one is worth knowing well
   beyond this entry.
2. **Draining per-file**, as six test files already do. Three files were fixed that way and the next
   run escaped from three different ones.

## The entry's own hypotheses, judged against the measurement

`LB-168` proposed three things. (a) *"silence `ensureSchema` under test"* was right — and was the
whole fix rather than the cheapest of three, though it belongs in the test setup, not Lane A's file.
(b) *"cut the top five test emitters, ~80 of the 381"* was beside the point: **not one of those five
ever escaped**, because a test's own `console` call happens during its test. Volume was never the
variable; reachability from an unawaited promise was. (c) a vitest bump is unnecessary.

## Follow-up filed

**`LB-170`** (Lane A) — `lib/rate-limit.ts` still does a DB write after the request that started it
was answered. The logging was the visible half and is fixed; the floating write is not, and what is
owed there is a judgement rather than necessarily a change (in a long-lived process it is the intended
design; the shutdown case is where an increment is lost). Split out rather than left as a `Keep:` on
`LB-168`, which is fixed.

## Not exercised

No product code changed — `vitest.setup.ts` is test infrastructure and reaches no runtime. Nothing
here touches the APK, the device, safe-area, native SQLite or production data. The one claim that
rests on sampling rather than proof is the rate: the defect was ~1 in 5, and two clean runs are two
clean runs, not a proof that the last escape path is gone. The `[late-console]` guard exists precisely
because that cannot be proved from here.

<a id="2026-09-27-fix-meal-plan-library-default"></a>

# 2026-09-27 — LB-159: the plan reuses your saved meals by default (v1.477.14)

**Branch:** `fix/meal-plan-library-default` · **Lane:** Implementation B · **Entry:** `LB-159` (removed from the queue).

## What shipped

`Use my saved meals` in the step-by-step plan setup now starts **on when the library has meals and
off when it does not** — the owner's answer of 2026-09-27, taken outright rather than as the
try-it-for-a-month variant. A plan built from meals already cooked carries real macros instead of an
estimate, and the generate route only fills the slots the library cannot, so variety is filled in
around the library rather than lost.

## The entry said "one line at `:81`", and that line would never have reached the screen

`LB-159` named `useLibrary`'s `useState` initial value. **That is not where the default is decided.**
The sheet's `open` effect resets the toggle on every open (`setUseLibrary(false)`), so an initial
value alone is dead code the moment the sheet is opened a second time — and it type-checks, reads
correctly in review, and changes nothing.

So the default is set in the `open` effect instead, from the library itself:

- **Seeded synchronously** from the `saved-meals` cache, so the first paint is right.
- **Corrected by a `cachedFetch`** on the same key and TTL `MyMealsPicker` uses, because the seed can
  be cold — the key is only warm once something has read it this session, and opening the sheet
  without first visiting the library would otherwise default OFF against a full library. That is the
  wrong answer arrived at silently, which is worse than the wrong answer arrived at loudly.
- **Guarded by a `touched` ref** so the correction can never overwrite a choice the user just made.
  Reaching the control takes several taps and the fetch lands long before that, so this is
  belt-and-braces — but an async response replacing a user's action is a bug class this project keeps
  re-finding, and the guard costs one ref.
- **`onError` keeps the seed** rather than forcing the toggle off: `off` is a claim that the library
  is empty, and a network failure is not evidence of that.

`check-cache-ttl-divergence` passes — one TTL expression for `saved-meals` across both call sites.

## The test, and what the control run proved

`e2e/lb159-library-default.spec.ts` pins both halves of the decision, because both halves *are* the
decision. Control-run twice, as this repo's rule requires:

1. **With the fix reverted**, the saved-meals case fails and the empty case still passes — the second
   is the old behaviour, so that is exactly right.
2. **With the entry's own suggestion** (`useState(true)` and nothing else), the saved-meals case
   **still fails**. That is the claim the spec's header makes, verified rather than asserted, and it
   is why the spec is worth its runtime: it is the only thing that can tell the plausible fix from
   the working one.

## Three things the harness cost, worth knowing

- **`click()` does not work on these screens and fails silently.** Five retried clicks over 90 s left
  zero dialogs open, while `dispatchEvent('click')` opened the sheet first time — and
  `elementFromPoint` at the button's centre returned the button itself, so nothing was covering it.
  This app's screens read raw touch events and these controls sit in a swipe carousel: `tapCentre`
  (the `Q-354` fixture) is the answer, and the failure mode reads exactly like a missing control.
- **A blind count of "Next" taps is wrong in both directions.** A touch dispatched mid-layout is lost,
  so four taps stop a step short; a loop that only watches the destination overshoots to step 6 where
  `Next` no longer exists. Each tap now waits for the step counter to advance, which is the one signal
  that says where you are.
- **A fixture that does not match the type crashes the screen, and it reads as a missing control.** A
  flat `calories` instead of `totals.calories` produced *"Cannot read properties of undefined"*, and
  the visible symptom was the toggle "not found".

## Not exercised

The APK. This is a client-only default on a sheet rendered in `next dev` under headless Chromium —
no safe-area, no gesture-nav clearance, no Samsung WebView, and no native SQLite. The behaviour has
no offline-first write path, so the device risk is presentational rather than about data; the two
cases are pinned by the spec at the 412 px project viewport.

<a id="2026-09-27-issue-1620-github-intake-triage"></a>

# 2026-09-27 — the first GitHub intake under OR-185: one issue, two inbound PRs, and a live migration collision (BF-211/212/213)

OR-185 made BugFix the GitHub watcher. This is the first pass under it, prompted by the owner asking
what else there was to review.

## What was unwatched

**One open issue** — `#1620` (`jsboiss`, 2026-09-25), assigned to the owner, two days old and
un-triaged. CLAUDE.md's own OR-185 line already names it as the case the rule was written about.

**Two inbound PRs** — `#1607` and `#1608`, neither with a queue entry. All three are now filed.

## The issue is right about the duplication and wrong about the fix, and `main` proves it

`#1620` asks to drop the hand-maintained *Next free Postgres migration* row and derive the number
from filenames. The number really is derived twice: `check-backlog-pointers.js:558-573` already
computes `max(filenames) + 1` and fails when the Markdown disagrees.

**But the migrations directory reads `…284, 285, 288, 289` — 286 and 287 are missing**, reserved in
that row's prose by the unmerged `#1749`. Filenames see only what merged. Had LA-161 derived its
number that way it would have taken 286, which `#1749` already uses.

The author anticipated this and proposed catching duplicates before merging. Right instinct, wrong
moment for this repo: a collision found at merge time means rebuilding a migration *and* its
`claude_ro` twin.

Recommendation filed: derive it from **every branch** rather than from `main` —
`git log --all --diff-filter=A --name-only -- lib/data/postgres/migrations/` gives the convenience
the issue wants and still sees `#1749`.

## `#1608` is that failure already happening

It adds `288_apple_health_samples.sql` and `289_claude_ro_views_apple_health_samples.sql`. `main`
holds `288_training_load_grid_dimensions.sql` and `289_claude_ro_views_grid_dimensions.sql`.

**The duplicate number is the smaller half.** Every twin opens
`DROP SCHEMA claude_ro CASCADE; CREATE SCHEMA claude_ro;` and recreates every view from the database
it was generated against. The two 289s sort by filename, so `…apple_health_samples` runs first and
`…grid_dimensions` runs second — generated before that table existed. **The new view is created and
then dropped in the same deploy**, with no error anywhere.

A contributor derived the number from what they could see. That is the issue's proposal, executed.

## One correction to my own earlier work

In the PR-register rewrite I recommended **merging `#1608`**. That was wrong under the rule the owner
restated today — an outside contributor's PR is theirs to merge, and we stop at review, comment,
approve. Orchestrator's rewrite of `TN-80` had already removed it from `main` before I could; checked
rather than assumed.

## Not exercised

Docs-only. No product code, nothing run on the device, and **nothing posted to GitHub** — the
`#1608` finding is concrete and blocking, but posting the review is Review's channel and the comment
is offered to the owner rather than sent.

<a id="2026-09-27-la138-close-deload-suppression"></a>

# LA-138 — the answer is "no", and the signal the entry named would have made it worse

**Branch:** `lane-a/la138-close-deload-suppression` · **Lane A** · one comment, no behaviour change

## The question

LA-138 establishes that `ai_dynamic` programs get no in-deload suppression on the early-deload
gate, because `listProgramPhases` resolves through `programs.phase_set_id` and that mode has none.
It then leaves one thing open: *"`ai_dynamic` has its own deload notion … and the early-deload
gate does not consult it. Whether it should is the question."*

## No — and specifically not that signal

`ai-dynamic.ts` gives `deloadOrRestRecommended`. That is a **recommendation** to deload.
`inDeloadPhase` means **already deloading**. They are not the same thing, and suppressing on the
first would silence the early-deload warning precisely when two independent systems agree a
deload is due. Backwards.

The honest "already deloading" signal for this mode does exist — a stored prescription with
`phaseAction === 'deload'` under `prescriptionDrivesLoad`, which is what RV-202/RV-204 use to
decide whether a prescription is driving the bar. But it is **session-scoped** and this gate is
**program-scoped**: it holds no session and would have to guess which one it meant.

## What settles it is the asymmetry, and then the count

A false suppression hides a health warning. A false prompt costs one confirmation tap — the entry
itself notes every early deload needs the owner's yes. Those are not comparable risks, so the
tie-break is evidence rather than symmetry.

And there is nothing to suppress. The gate's own docblock records TN-64(b)'s measurement: across
the **118 sessions** logged since the owner moved to `ai_dynamic`, **none was an early deload**.
The redundant-prompt scenario this suppression would prevent has never happened.

So: no behaviour change, and the reasoning goes in the code rather than only here — a future
reader finding an unsuppressed gate will reach for `deloadOrRestRecommended`, which is the one
wiring that must not happen.

## One correction to the entry

It attributes the always-false suppression solely to the missing phase set. There are **two**
independent causes: the active program also has `started_at` NULL, and the ternary
short-circuits on that *before* `listProgramPhases` is called. Either alone is sufficient, so
populating a phase set would not, on its own, switch the suppression on.

## Split out

`program_phases.program_id` is populated on **0 of 46 rows** and is what made LA-138's first
filing read as a clean zero — a join on it matched nothing, with no error. Filed as **LA-159**:
dropping it is a migration, ships alone, and is confirm-before-merge like LA-142.

## Verification

`tsc` clean; Custom Rules **80 of 80**; the readiness suite **110 passed / 16 skipped**. No test
was added, because nothing changed: the deliverable is a decision and the comment that carries it.

Both of the comment's load-bearing claims were re-measured against production on 2026-09-27
rather than quoted from TN-64(b):

- The active program **Bankai** is `ai_dynamic`, has **no phase set**, and has **`started_at`
  NULL** — so both independent causes of the always-false suppression are live today, not one.
- Of the **119** logged workout sessions, **`is_early_deload` is false on every one**. Three carry
  a deload `phase_type`, and those are scheduled phase deloads off the two `automatic` programs —
  the path that already *has* suppression. TN-64(b)'s figure was 118; one session has been logged
  since, and it did not change the answer.

## Not exercised

**Nothing was run beyond typecheck and the existing tests**, which is proportionate to a
comment-only diff. The failure surfaces this change cannot reach are the same ones it does not
touch: no device, native, safe-area or offline-sync path is involved in a comment.

The one thing that *was* exercised is production, deliberately — the entry's quoted figures were
re-measured rather than inherited, which is what turned 118 into 119 and what confirmed the
second cause below.

<a id="2026-09-27-la158-resilience-unavailable"></a>

# LA-158 — the resilience tile was not blank, it was five days stale

**Branch:** `lane-a/la158-resilience-unavailable` · **Lane A** (engine half of LA-158).

## What the entry said, and what was actually true

LA-158 — which I filed earlier the same day while verifying TN-70 — said resilience had stopped
publishing and the surface had gone blank with nothing said. The first half is right:
`oura_daily_derived.resilience_level` has been NULL every day since **2026-09-22** while the
rollup runs normally.

The second half was wrong, and checking it before building changed what to build.
`buildReadinessPayload` reads a **7-day** window and takes the most recent row carrying a level:

```ts
repo.getOuraDailyDerived(userId, from7dIso, todayIso)
const latestResilience = [...derivedTodayRows].reverse().find(r => r.resilienceLevel != null)
```

So on 2026-09-27 the tile was **rendering 09-22's level 1 as though it were today's, with no date
shown** — `ResilienceTile` takes level, band and confidence and nothing else. It would have gone
blank a few days later, when 09-22 fell out of the window. **Two defects, and the live one was
staleness, not absence** — which is the worse of the two, because a stale number reads as current
while a missing one at least reads as missing.

## What shipped

`ReadinessScoreResponse` gains two fields:

- **`ownResilienceAsOf`** — the day the level came from, so a surface can tell today's number from
  last Tuesday's.
- **`ownResilienceUnavailable`** — `{ daysSeen, daysMeetingCoverageGate, coverageGateMinutes,
  minValidDays, modelWindowDays }` when no level could be shown.

Behind it, a new pure `observeResilienceCoverage` in `lib/health/stress-resilience.ts`, beside the
constants it reads (One Formula, One Place — the 240-minute gate and the 5-of-14 window are model
constants, not numbers to restate at a call site). Its companion `resilienceGateThresholds()`
returns null rather than throwing, unlike `C_()`: the constants are injected on the rollup path,
not on every request, and a readiness payload that cannot name the gate must still render.

## The one design decision worth recording

**It reports an observation, never a diagnosis.** The payload sees 7 days; the model gates on 14.
A shortfall the payload can see is therefore *consistent with* the coverage gate having closed
without establishing it — days 8–14 are not in view. So the fields make a true sentence — *"2 of
the last 7 days had enough daytime coverage; the model needs 5 of 14"* — and stop there. There is
deliberately **no `reason` string**, and a test asserts the exact key set so that a later
tidy-up cannot quietly promote it to a verdict.

Nulls mean "the constants were not injected on this request", which is a different thing from a
threshold of zero — a zero fallback would make every day "meet" the gate and read as healthy.

## Verification

- `tsc` clean. New test `la158-resilience-coverage-observation.test.ts` — **7 passed**, driven by
  the real production coverage series (290, 290, 170, 170, 120, 50, 150, 60, 150, 60, 140, 110, 50).
- **Mutation pass, 4 killed / 1 equivalent control as predicted:** `>=`→`>` killed (an explicit
  at-threshold case, since no production day sits exactly on 240 and the real series alone would
  not catch it); `daysSeen` dropping nulls killed; `minValidDays` reading `windowDays` killed; a
  `?? 0` fallback for the missing gate killed. The **control** — removing the `!= null` guard —
  survived, which is correct: `null >= n` is already false. The guard is kept and now says in a
  comment that it is defensive rather than load-bearing.
- Custom Rules **80 of 80**; readiness suite **117 passed / 16 skipped**.

**No version bump or changelog entry**: nothing user-visible changed. The payload carries new
fields and no surface reads them yet.

## Deliberately not done

- **The render is Lane B's** and LA-158 stays in the queue re-laned to B, naming exactly what to
  show. One Lane B file was touched — a one-line completion of an offline fallback object that
  must stay a full `ReadinessScoreResponse` for the build to pass. No rendering changed.
- **Why the coverage collapsed is not answered, and is now LA-160 (`Lane: DV`).** Either the ring
  is worn less in the daytime since mid-September or daytime-stress ingest has degraded, and the
  database cannot separate them — `worn_hours_ble` is NULL on every row, so there is no stored
  wear figure. Only the phone can tell.
- **The gate was not lowered.** Four hours is the vendor model's own constant; a level computed
  from 50 minutes would be worse than no level.

**Not exercised:** no device run — this is a JSON payload change with no native, safe-area or
offline-sync surface. Production was read, never written.

<a id="2026-09-27-la161-grid-dimensions"></a>

# LA-161 — record the two numbers the training-load gate decided from

**Branch:** `lane-a/la161-grid-dimensions` · **Lane A** · migration, ships alone.

## Why

TN-79's read earlier today (merged in #1758) showed production gating `insufficient_met` on days
whose stored frames replay to a 1421-minute grid with 1073 valid minutes, against floors of 720 and
360. One of those two readings is wrong and **nothing persisted said which**, so five weeks went
into arguing it from inference. Two integers end that.

## What shipped

- **Migration 288** adds `training_load_grid_len` and `training_load_valid_min` to
  `oura_daily_derived` — nullable, additive, so old rows stay NULL and NULL keeps meaning
  "never recorded". **Migration 289** is the regenerated `claude_ro` twin.
- `computeTrainingStress` returns `metGridLen` / `metValidMin` on **every** result, and the route
  persists them on every path.
- **They are computed before the first gate, not beside the MET one.** A `no_readiness` row with a
  1400-minute grid says something different from one with a 90-minute grid, and the three earlier
  gates previously recorded nothing about the day's coverage.
- Returned from the model rather than recomputed by the route, so what is persisted is what the
  gate actually evaluated — a second computation of the same expression is a second thing to drift.

## The near-miss worth recording

**The first generated twin silently dropped four columns, and it would have merged.** The
documented command in `CLAUDE.md` was

```
CLAUDE_RO_OWNER_USER_ID=<uuid> node scripts/generate-claude-ro-views.js > …
```

and the generator reads **`LOCAL_DATABASE_URL`**, not `DATABASE_URL`. Exporting `DATABASE_URL`
does not fail — it falls back to the session's own dev database, which in my case had the unmerged
LA-142 branch's `DROP COLUMN` applied to it from earlier in the session. So the twin came out
missing `active_calories_est`, `worn_hours_ble`, `vascular_age` and `pwv`, which are still on
`main`: a migration that would have removed them from the views for real, pre-empting an
owner-gated PR.

It was caught by diffing the generated file against its predecessor, which the standing rule
already requires — the rule earned its keep here. `CLAUDE.md` is corrected in this PR, and the
twin was regenerated against a scratch database built from this branch's own migrations.

Two smaller process notes from the same stretch: my local `trainingai_dev` had been left in a
mixed state, so it was dropped and rebuilt from the branch before anything was trusted; and a
`git checkout` to reset a mutation reverted the implementation file itself, which showed up as a
baseline that "failed" — the harness was wrong, not the code.

## Verification

- **New test, 5 cases**, including the boundary the rest of the repo cannot reach: the validity
  floor is `v >= 0.9` and no fixture anywhere sits exactly on it, so `>=` → `>` survives every
  other test. Also nulls counted as seen-but-not-valid, dimensions on gates that never reach the
  MET floors, the two floors that share `insufficient_met`, and an empty day.
- **Five existing strict assertions updated, not weakened.** They now pin the dimensions too, so
  each says *which* floor closed the gate — 600/600 (short but valid) against 1440/300 (long but
  sparse).
- **Mutation pass: baseline survives, 3 killed, 1 equivalent control survives.** Killed: `>=`→`>`,
  `metGridLen` reporting `validMin`, nulls counted as valid. Control: reordering the two fields.
- The two `claude_ro` tests over TCP: **2 files, 27 tests, all passed, none skipped** — the count
  `CLAUDE.md` names, so neither skipped silently.
- `tsc` clean; `check-test-typecheck` 316/87, none above baseline; Custom Rules **80 of 80**.

**No version bump or changelog entry** — nothing user-visible. The API response gains two fields
that no surface reads.

## The second thing I got wrong, caught by a tripwire

I first shipped these as **server-only**, reasoning that they are diagnostics nothing on-device
reads. CI disagreed, and it was right: `oura-daily-derived-sync.test.ts` fails if any
`DERIVED_COLS` key is missing from the offline-sync push payload. `DERIVED_COLS` is what drives
the server upsert, so a column cannot be in that table and out of sync — the choice was never
available. Its sibling assertion then caught a second gap, that `pushMutations` has its own
explicit field list, which is the exact failure its comment records happening before with
`daytime_stress_coverage_min`.

So they are plumbed the whole way: local type, SQLite CREATE body, `RECONCILE_COLUMNS`, **v43**
(not v42 — that is taken by the unmerged LA-142 branch, and two branches claiming one local
version is a silent divergence rather than a conflict), both local upserts, the read mapping, the
pull delta, and `pushMutations`.

## Not exercised

No device run. The local table gains two integers per day and no screen reads them; the v43 ALTER
reaching an upgraded device is the part only the phone can confirm, and `RECONCILE_COLUMNS` is the
authority if it half-applies.

**And the finding itself is not in yet.** This makes the question answerable; it does not answer
it. After a day of production, read the two columns: a short grid points at the ds window or at
`dsToMs` dropping rows, a full grid means the floors are being evaluated on something other than
what is stored. TN-79 carries that as its next step.

<a id="2026-09-27-lane-a-bf211-derive-schema-numbers"></a>

# BF-211 — the migration number is derived by a command now, and the pointer it replaces could never have reserved anything

**Branch:** `lane-a/bf211-derive-schema-numbers` · **Lane A** · docs + tooling, no product code.

Closes `BF-211`, filed from GitHub issue **#1620** (`jsboiss`), which asks for the next migration
number to be derived from the filenames instead of hand-maintained in
`docs/implementation-backlog.md`.

## The entry's counter-argument is refuted by the repo it describes

`BF-211` recommends keeping the hand-maintained row, on the grounds that filenames cannot see an
unmerged branch while the row can: *"286 and 287 are missing, reserved in that row's prose by the
unmerged #1749."*

**The row cannot reserve anything, and this is checkable in ten seconds.**
`check-backlog-pointers.js` required `row === max(merged filenames) + 1`. Measured — set the row to
292 with the directory head at 289:

```
• Migration pointer says 292, but the directory head is 289 so the next free number is 290.
```

So the *number* was always exactly `max + 1`, a restatement of the directory. The reservation it was
credited with lived in a free-text parenthetical beside it that no check read. Two journal entries
record it drifting anyway — **eleven** behind the directory once, five another time.

That inverts the decision. The issue author is right that the number is derivable; where they are
wrong is *what to derive it from*, and the entry is right about that without its stated reason
holding.

## What shipped

`node scripts/next-schema-number.js` — fetches, then reads **every ref**, not just the merged tree:

```
Next free Postgres migration number: 290
  287 on origin/main, 51 other ref(s) read.

Claimed by a branch that has not merged:
  286  286_drop_dead_derived_columns.sql  (origin/lane-a/la142-drop-dead-derived-columns)
  287  287_claude_ro_views_drop_dead_derived.sql  (origin/lane-a/la142-drop-dead-derived-columns)
  288  288_apple_health_samples.sql  (origin/health-sample-storage)

Next free local SQLite schema version: v44
  origin/main tops out at v43.
  claimed elsewhere: v42  (origin/lane-a/la142-drop-dead-derived-columns)
```

- It covers the **SQLite version too**. The removed table had both rows with the same defect, and
  leaving one of them would have been an incoherent half.
- The `v42` line is the reservation working: main runs 41 → 43, and 42 is genuinely held by an
  unmerged branch. A version below main's top is still a claim, so the report is a **set
  difference**, not "above the maximum".
- Pure logic in `scripts/lib/migration-claims.js`; the git reading is in the CLI. 8 tests.

## Two things the tool found on its first run

1. **It reproduces `BF-213` independently** — `288: merged: 288_training_load_grid_dimensions.sql vs
   origin/health-sample-storage: 288_apple_health_samples.sql`, and the same at 289. That entry is
   amended to say so, because a renumber that can be verified beats one that is argued.
2. **A dead branch reads exactly like a reservation.** `origin/lane-a/q44-phase3-pr1-table-rename`
   holds 273/274 and has no open PR. Recorded on `BF-213` as explicitly *not* work, so nobody
   renumbers around a branch nobody is going to merge.

## It fetches by default, and that is not a convenience

Writing this, an un-refreshed remote-tracking ref reported `#1608` as holding **284/285** — numbers
it had been renumbered off. I nearly filed that as a correction to `BF-213`, which was right all
along. A stale pair reads exactly as authoritative as a fresh one, so the fetch is inside the
script rather than in the instructions beside it.

## What did NOT change

`scripts/check-migration-numbers.js` is still the CI gate and its failure condition is untouched: a
duplicate number in one tree. That is the half the issue author also proposed, it already existed,
and it is what catches `#1608` the moment that branch is updated to `main`. CI clones one branch at
depth 1, so a branch-aware check could never run there — the new command is deliberately **not** a
gate. What replaced the removed pointer check is narrow: the backlog must still name the command, so
removing the answer cannot quietly become no answer.

`GRANDFATHERED` (081/087/146/161 — applied duplicates that must not be renamed) now lives in
`scripts/lib/migration-claims.js` and both consumers read it there.

## Verification

- `scripts/__tests__/migration-claims.test.ts` — **8 passed**.
- **Mutation pass: baseline survives, 4 killed, 1 equivalent control survives.** Killed: dropping
  the already-merged guard; deriving `next` from the merged tree alone (the removed pointer's own
  behaviour, kept as a mutant because it is the thing being argued against); dropping the
  grandfather filter; comparing claim *count* instead of filename. The last one **survived the first
  pass** and the gap was real — a branch cut from another carries the same file, two claims and one
  migration — so a test was added and it now kills. Control: sorting by `localeCompare`.
- Control-run on the replacement check: renaming the command in the backlog fails it by name.
- `check-backlog-pointers` 0 · `check-migration-numbers` 0 · `check-doc-links` 0 · Custom Rules and
  the rest below.

## Not exercised

Nothing runs on the device or in production; this is tooling and docs. The command's cross-branch
output depends on which refs the clone has — it fetches, but a ref the remote does not serve (a
contributor's fork branch) is still invisible to it, and no check can see one.

## `BF-214` landed while this was being written, and does not supersede it

Another session filed `BF-214` the same hour — 59 of 287 migrations are `claude_ro` twins, **92% of
the corpus by line**, so the twin doubles how fast numbers are consumed and is what makes a
collision silent. It marked `BF-211` superseded on the way past. Reconciled rather than deferred to,
because the two do not overlap:

- `BF-214` ② proposes replacing authoring-time allocation entirely (timestamp names, numeric sort).
  If it lands, `next-schema-number.js` is deleted. That is a deletion, not a conflict, and it is
  behind ① and a careful read of apply order for all 287 migrations.
- This PR removes a pointer that was **provably inert** — a check pinned it to `max(merged) + 1`.
  `BF-214` ② is not removing a working reservation either, and its entry now says so, because
  believing there was one is what kept the row alive.
- The command gives ② something to be judged against: it reproduces `#1608`'s collision by name.

`BF-211` is removed from the queue as shipped; `BF-214` keeps the whole restructure.

## Left for the owner

**The issue author is owed a reply and I have not posted one.** Commenting on a shared surface is
confirm-first. The answer worth sending is more interesting than the request: the duplicate
detection they proposed already exists, the command they asked for now exists and is branch-aware,
and their own PR is the live example of why filenames alone were not enough. Say the word and I will
post it.

<a id="2026-09-27-lane-a-or194-local-env-guards"></a>

# 2026-09-27 — OR-194: the three guards a persistent local agent needs

Written from inside the first local Lane A session, on the owner's Windows machine, so each guard
answers something that actually happened today.

## What shipped

- **③ `pnpm db:rebuild`** (`scripts/local-db/rebuild.js`): drops and recreates the database named
  by `LOCAL_DATABASE_URL`, runs `migrate.js`, loads `seed.sql`. It is cross-platform, because
  `setup.sh` needs `initdb` and `su` and cannot run on Windows. It refuses non-local hosts, the
  `postgres` database and non-snake_case names, and it never touches `.env.local`. Run for real:
  `trainingai_lane_a` rebuilt with all 287 migrations and the seed; a Railway URL refused, exit 1.
- **② `setup.sh`** takes `LOCAL_DB_PORT` / `LOCAL_DB_NAME` / `LOCAL_PGDATA` / `LOCAL_PGLOG`, with the
  cloud defaults unchanged. It no longer overwrites a non-local `DATABASE_URL` in `.env.local`.
  **That was a live hazard the entry did not name**: the owner's `.env.local` holds two Railway URLs,
  and the old `sed` replaced every `DATABASE_URL=` line. On Windows it died at `su` before reaching
  them. On Linux or WSL it would not have.
- **① One worktree per lane**, as a written procedure in `docs/local-agent-environment.md`, with the
  Docker and port facts from this machine: 5433 belongs to another project's Postgres.
- **`check-test-typecheck.js` runs on Windows again.** It spawned `npx.cmd`, which Node's
  CVE-2024-27980 fix turned into `EINVAL` without a shell. It now runs `typescript/bin/tsc` with
  `process.execPath`: no `npx`, no `.cmd`, no shell. Same result: 316 errors across 87 files, at
  baseline.
- **Filed `LA-163`**: nine tests in six files fail on Windows and pass on CI (paths, timezone, one
  timeout).

`OR-194` leaves the queue. `OR-195` (move Lane A local) named it as `Needs`, so that decision is now
the owner's to take.

## Verification

- `rebuild.test.ts`: five cases, including the socket URL `setup.sh` writes, which `new URL()` rejects
  outright. The first draft missed that; the test caught it.
- The `setup.sh` guard was checked against five URL shapes: Railway, socket, localhost, `[::1]` and
  a lookalike `1host.example`.

## Not exercised

`setup.sh` itself end to end: it needs a Linux box with `initdb`. Only its syntax (`bash -n`) and
its env-file guard were run.

<a id="2026-09-27-lane-a-or198-fold-bare-citations"></a>

# 2026-09-27 — OR-198: the journal fold now rewrites bare-path citations, and 51 broken ones are fixed

## The entry undercounted by a lot

OR-198 found **1 broken citation in 152**, measured in the one file it was relocating. Measured across
the repo, **79 of the 100 bare backticked citations of a journal entry pointed at a file the fold had
already moved.** `check-doc-links` reads only link targets, and `check-index-doc-paths` only the
orientation indexes, so nothing had ever seen them.

## What changed

- **`scripts/fold-journal-entries.js`** rewrites a bare `` `docs/overview/entries/x.md` `` to
  `` `docs/overview/<history-file>#x` `` in the same pass that moves the entry ("trap 7"). Verified
  with a real fold in a throwaway worktree: a planted citation, in prose and in a list, came out
  pointing at the history file with an anchor that exists. The existing link-rewrite path was
  unchanged.
- **`scripts/check-index-doc-paths.js`** drops a `#fragment` before checking that a path exists,
  so the fold's new citation form does not read as a missing file.
- **One-time repair of the backlog of breaks:** 51 citations rewritten in 31 files. 34 history-file
  entries that had only a `<!-- from: x.md -->` marker gained an `<a id="x">` anchor, so every
  repaired fragment resolves. A re-scan shows **76 resolving, 9 not**, and the 9 are not fixable
  citations:
  - `x.md` in `entries/README.md` is a template.
  - Four in two cardio plan docs are build instructions (`Create: …`); the entries were written
    under a `feat-` prefix.
  - **Four in `docs/doc-size-baseline-history.md` name entries that exist nowhere in the history
    archives** (`2026-08-26-fix-batch-upsert-duplicate-collapse`, `…-fix-daily-summary-replace-guard`,
    `…-feat-app-load-metrics`, `2026-09-09-admin-tool-routes-test`). They were deleted, not folded,
    and that file is a historical log, so they stay as written.

The repair itself was a scratch script and is not committed. It had a bug worth recording: its final
pass wrote the anchor-annotated history files back over the citation rewrites it had just made in
those same files. The re-scan caught it, which is why the re-scan exists.

## Not done

A checker that resolves every backticked `docs/**.md` path repo-wide, which the entry offered as the
alternative. With the fold fixed, the only way left to break one is deleting an entry by hand, which
is what produced the four above. It would need an allowlist for those nine from day one.

<a id="2026-09-27-lane-a-rv208-time-casing-and-formatkg"></a>

# 2026-09-27 — RV-208 ① and ②: one clock form across four surfaces, and a load formatter for Lane B

## ① Time of day — three forms, not two

The entry said `formatTimeOfDay` emits `6:40am` and one route bypasses it. Measured, both halves
were off:

| form | source | surfaces |
|---|---|---|
| `6:40 AM` | `app/api/day-timeline/route.ts`, its own `h:mm a` | Home's timeline |
| `6:40am` | `fmtAest` in `date-utils.ts`, its own `h:mmaaa` | Health → Day (via `/api/day-log`), Body Battery axis |
| `6:40 am` | `formatTimeOfDay`, the documented "one place" | the activity list and the rest |

The route now calls `formatTimeOfDay`, and `fmtAest` delegates to it, so no caller of `fmtAest`
needed an edit. `formatInTimeZone` left the route's imports. Nothing parses these strings: the two
consumers of `workoutDurationsById` show them, and `MealCard` splits its subtitle on `' · '` only.

**Still their own form, filed on RV-208 for Lane B:** `sleep-verdict-copy.ts`'s `formatClock`
(`11:10pm`) and `sleep-timing-trend-utils.ts`'s `clockLabel` (`6:30 AM`). Both format
minutes-of-day, not an instant, so a straight swap does not apply.

## ② `formatLoadKg`

`68 kg` / `67.5 kg` / `71.25 kg`: two decimals, trimmed. One decimal would round a 1.25 kg plate
step to `71.3`. `formatKg` also gains `trim`, off by default, because body-weight columns want the
padding. The six lift sites the entry lists are Lane B's and are left for them.

## Verification

- A new route test pins `5:00 pm` / `6:00 pm`; `day-log-duration-session-identity` now expects
  `9:00 am`; four new `formatLoadKg` cases.
- Mutants: `fmtAest` back on its own format, the timeline uppercased, `trim` ignored, and the load at
  one decimal were all killed. The control (template coercion in place of `String(Number())`)
  survived.
- `pnpm dev` at 412 px: Home's timeline renders `5:00 pm`, `9:00 am` and `4:00 am – 4:55 am`, each
  on one line in its row.

## Not exercised

The Body Battery card's axis labels: the seed has no Body Battery data, so the card showed "No data
yet". The device.
