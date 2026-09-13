# Session journal — batch folded 2026-09-10

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-08-16-deferred-measurements"></a>

# 2026-08-16 — the deferred measurements, taken

**Branch:** `claude/gym-app-comprehensive-review-j38fo9` · **Type:** review, docs-only ·
**Backlog:** no new numbers — **Q-292, Q-298, Q-300, Q-304 amended**

Sixth round. Every previous one filed entries that said *"measure this first, it may change the
fix"*. This one takes those measurements rather than leaving them for an implementer, because they
were all answerable from data already in hand.

## Two entries changed shape

**Q-304's escape hatch was tested and did not fire.** I had filed it with an explicit out —
`prescriptionFactor` might already absorb the high-rep inflation, and closing the entry as
measured-and-rejected was named an acceptable outcome. It isn't: **28 of the 29 sets at 13+ reps
that feed the 1RM carry no `planned_pct`**, so the factor returns 1 and the raw curve stands. The
proxy turned out exact rather than approximate — `log-exercise.ts:233` writes the same value the
factor consumes.

**Q-300's question is answered, and the answer removes a dependency.** It said to split Q-289's
buckets by rest adherence before recalibrating anything, and named the two outcomes. The
miscalibration **persists in all four bands** (expected-10: −1.75 on-target, −2.80 rushed, −2.33
overlong, −2.21 unknown). Rest is a contributor, not the explanation. **Q-289 should not wait on
it**, and Q-300 is re-scoped to its secondary half.

## The synthesis I didn't expect

The `unknown` rest band had the worst error, which is not a fact about rest. Splitting by whether a
**prescription** was recorded at all: prescribed **r = 0.499 / MAE 0.88**, unprescribed
**r = 0.297 / MAE 1.08**. So `prescriptionFactor` is doing real work *and* is not enough — both
groups still clear the dead band at expected-10.

The sharp end: **unprescribed light sets average +2.36, above the 2.0 emergency-deload threshold**,
not merely the 1.5 autoregulation band. Q-289, Q-299 and Q-304 turn out to share one upstream cause,
and the highest-leverage fix is the one none of them names: **get a progression style recorded on
more than 28% of sets.**

## Q-298 is down to one line

`log-exercise.ts:196` zeroes the 1RM when **either** the AI flag or **the phase** says deload;
**line 264 stores only the AI flag**. That is the whole bug, and the file's own comment at 190–191
already states both cases must not feed the estimate. They don't — only one is recorded.

Three rounds to get here: filed wrong, corrected (half the rows were by design), resolved from
production data, now pinned to source. Each step was cheap because the previous one wrote down what
it had actually checked rather than what it assumed.

## The AI audit, finished

All 117 insights, not the 8 I'd read: **7 imperial-unit errors** (all Fahrenheit, all in `sleep`)
and **12 absolute superlatives** — about **16% carry at least one**. A second fabricated superlative
is double-confirmed: *"a perfect recovery index"*, for a contributor **Q-271 measured has never
exceeded 50 on any of 31 scored days** because its anchor is unreachable.

One hit I want on the record as a **false positive**: a regex flagged
*"despite your illness radar remaining normal"* as train-through-illness advice. Reading it shows it
describes the radar. Counting it would have been the kind of finding that erodes trust in the rest.

## Blocked

**Railway per-query RTT** — Q-308 needs it before anyone touches the sync fan-out, and it cannot be
measured from the sandbox. Instructions handed to the owner.

<a id="2026-08-16-goal-invalidation-not-guardable"></a>

# 2026-08-16 — the guard that cannot exist

Q-259 asked for the Q-240 regression guard that `goal-round-trip.spec.ts` failed to be. It was built.
It does not guard Q-240 either — and the reason is structural rather than a third mistake, which
makes the measurement more useful than the test would have been.

## What Q-259 got right, and what it got wrong

Right: **the steps goal is the correct probe.** The water-goal version failed because Health falls
back to a `localStorage` device copy for water, target weight and target body fat, and the goals UI
writes that copy synchronously — masking exactly the server-cache staleness Q-240 is about.
`STEPS_GOAL_KEY` is written too, but it is read by *Home*, never by Health: `useGoalSeeds` seeds only
the other three. So Health's steps number comes from `userGoals` alone, with nothing to hide a stale
cache.

Wrong: **the seed work it specified was unnecessary.** The entry said
`scripts/local-db/seed.sql` "does not guarantee a steps or calorie value for today". It does —
`body_metrics` is inserted for `current_date - d`, d in 0..13, so today carries steps 8000 and
calories 2400, which is what makes the `goalsProgress` rows render at all (`visibleRows` filters on
`value != null`). Half the queued work did not exist.

## Why no guard is possible here

Deleting Q-240's fix — `.then(res => invalidateGoalRecommendations())` in `goals-section.tsx` — left
the new spec **passing**. Two measurements explain it, and neither is about the goal chosen:

**The settled value is correct either way.** `cachedFetchCore` paints the cached value through
`onData(cached)` and then *always* proceeds to the network fetch, unless the call site passes
`freshWithinTtl`. `user-goals` does not pass it. So the cache is a first-paint accelerator here, not
a short-circuit — invalidating it cannot change where the screen ends up.

**The stale flash is identical too.** Sampling the DOM every 100 ms across the return trip, with and
without the invalidation:

```
without:  ["8,000 / 7,000 ✓", "8,000 / 9,000"]
with:     ["8,000 / 7,000 ✓", "8,000 / 9,000"]
```

The old value paints briefly in both cases, because the first paint on a **tab re-entry** comes from
Health's retained React state — the tabs stay mounted — not from the cache. Clearing a cache cannot
change what component state already holds.

So on this screen `invalidateGoalRecommendations()` has **no observable effect on the goal at all**.

## What that says about Q-240

Q-240's entry described the impact as *"change a goal, open Health, and it renders the old one for 30
minutes."* That framing assumed the cache short-circuits the fetch. It does not, so the 30-minute
claim was never right for this path.

The genuinely persistent staleness — the one an owner could actually hit — was **Q-260**: `user-goals`
fetched only by the Progress tab's group while the water goal rendered on Body, so nothing re-read it
at all. Different mechanism, fixed yesterday. The two were easy to conflate because the symptom is
identical, and conflating them is what produced two false guards in a row.

## What shipped

`e2e/goal-invalidation.spec.ts`, relabelled to what it actually proves: a steps-goal edit reaching
Health's Progress panel **client-side**, with no reload. That is the Q-260 shape on a panel no other
spec exercises, using a goal with no device copy. Mutation-verified both ways —

| Mutation | Result |
|---|---|
| baseline | 2 passed |
| steps PATCH suppressed | **1 failed** |
| Health drops the `user-goals` payload | **1 failed** |
| restored | 2 passed |

— and its header carries the Q-240 measurement, so the next person does not start from the premise
that burned two attempts.

The return trip is deliberately client-side. `page.goto('/health?tab=progress')` is a full document
load that remounts and refetches unconditionally, which would have passed regardless — the trap the
first version fell into.

## Filed

**Q-262** — is `invalidateGoalRecommendations()` doing anything, for any of its six keys? One key is
now measured inert, and the reason is general: invalidation only matters where a call site passes
`freshWithinTtl` or a read path never revalidates. CLAUDE.md treats missed invalidation as the most
repeated bug class here, so these calls are added defensively and never audited for effect. Worth
knowing which are load-bearing rather than assuming all of them are.

## Verification

`npx tsc --noEmit` · `pnpm lint` 0 errors · `pnpm build` · `pnpm check:rules` **Ran 36 of 36** ·
unit suite · full E2E cold on a fresh database with `--retries=0`. No version bump — test and docs
only, nothing user-visible.

Not device-verified and does not need to be: this adds one browser spec and documentation, and
touches no runtime code.

<a id="2026-08-16-goal-label-association"></a>

# 2026-08-16 — labels that pointed at nothing

Q-258, found while writing the E2E goal spec and fixed here. v1.317.3.

## What was wrong

Six number inputs had `<Label>`s associated with nothing — no `htmlFor`, no `id`:

| File | Fields |
|---|---|
| `components/profile/goal-targets-section.tsx` | Steps Goal, Sleep Goal, Daily Water Goal, Calorie Goal |
| `components/profile/required-info-section.tsx` | Weight, Body Fat % |

A screen reader announces those as unnamed number fields. Sighted users see a label; anyone using
assistive tech gets "edit, blank".

**The convention already existed in the same file.** `required-info-section.tsx` correctly pairs
`goals-height` and `goals-birthYear`. So this is a consistency fix against a pattern already in the
directory, not a new idea imposed on it — the six now follow the same `goals-<field>` id scheme.

## The proof, which is a deletion

The Q-258 entry specified how to know it worked: re-point the E2E selector at `getByLabel` in the
same PR. `e2e/goal-round-trip.spec.ts` had been anchoring on DOM position —

```ts
page.getByText('Daily Water Goal').locator('xpath=following::input[1]')
```

— a brittle selector whose brittleness *was* the symptom. It is now `page.getByLabel('Daily Water
Goal')`, which resolves through the accessible name and therefore only works if the association
exists.

| State | Result |
|---|---|
| Association in place | **2 passed** |
| `goal-targets-section.tsx` reverted to `main` | **1 failed** |
| Restored | **2 passed** |

Full E2E suite green cold on a fresh database with `--retries=0`: **7 passed**.

That is a better guard than a new assertion would have been. Nobody has to remember to keep an
accessibility test alive — the spec cannot navigate the screen at all if the labels come unstuck.

## What was deliberately NOT fixed

Six more `<Label>`s in `components/profile/` still have no `htmlFor`, and they are a **different
shape**: they front button groups or static text rather than form controls, so there is no `id` to
point at. Fitness Goal, Biological Sex, Activity Level, Timezone, Weight Units, Food Region.

They are not bundled here because the fix is not mechanical. `<Label>` renders
`@radix-ui/react-label`, whose entire job is associating text with a control — pointed at a `<div>`
of buttons it is the wrong element, not an unfinished one. Whether each wants `role="group"` +
`aria-labelledby` or simply should not be a `<Label>` differs case by case (Timezone and Weight Units
front a value and a button, not a set of options). Filed as **Q-261** with that question stated,
rather than guessed at here.

Recording them matters because Q-258 swept this directory: stopping at the input pairs without
saying so would leave the sweep looking complete when it is not.

## Verification

`npx tsc --noEmit` · `pnpm lint` 0 errors · `pnpm build` · `pnpm check:rules` — **Ran 36 of 36** ·
unit suite **478 files / 3,939 tests** · E2E as above, including the revert.

**Not device-verified**, and the honest limit is sharper than usual here: Playwright resolving
`getByLabel` proves the accessible name is wired, which is the mechanism. It is not the same as
hearing TalkBack announce the field on the S25. The mechanism is what was broken and is what is
fixed; the announcement itself is unverified.

<a id="2026-08-16-health-stale-goal"></a>

# 2026-08-16 — the goal Health could not see

Q-260, found by the E2E harness two days after the harness itself landed, and fixed here. v1.317.2.

## The bug

Change your water goal on More, tap Health, and Health shows the old goal — indefinitely. Measured
at the moment of the stale render: `GET /api/user/goals` returned the new value, the
`ta_cache:user-goals` entry held the new value, and the `ta_water_goal_ml` device copy held the new
value. Every source of truth correct, the screen wrong, for 120 seconds across repeated tab
re-entries.

## The cause, which is narrower than it first looked

Two facts that are individually reasonable and jointly a bug:

1. **`user-goals` was fetched by `fetchProgressHealthData`** — the Progress tab's group.
2. **The water goal renders in `waterIntake`, which is a `BODY_GROUPS` card** — the Body tab.

So a value displayed on one tab was fetched only by another tab's group. On its own that would still
self-heal on the next mount; what makes it permanent is the third fact, documented in
`useTabVisibility`'s own header: **all five tabs stay mounted for the life of the app.** A
`useEffect(…, [])` therefore runs once per app launch. Health had no reason to re-read the goal, ever.

That is why this survived Q-240. Q-240 was *"the cache is stale"* and was fixed by adding an
invalidation. This is *"the screen never re-reads a cache that is already correct"*. Fixing one could
not have fixed the other, and the shared symptom is exactly what made it look like a regression of
the same bug.

## The fix

- `user-goals` moved from `fetchProgressHealthData` to `fetchSharedHealthData`, which already
  re-runs on `tabEpoch`. It feeds `waterIntake` on Body **and** `goalsProgress` on Progress, so
  shared is where it belonged for both.
- The localStorage first-paint seed moved into `app/health/use-goal-seeds.ts`, which re-reads on
  `tabEpoch` rather than on mount alone. That is the path that matters before `userGoals` loads, and
  the goals UI writes those keys synchronously on every keystroke.
- `fetchProgressHealthData` is down to one fetch, so its `runWithConcurrency` wrapper went with it.

## Verification — the part that matters

`e2e/goal-round-trip.spec.ts` **lost its `page.reload()` workaround**, as the Q-260 entry required.
Without that removal the spec would have gone on passing whether or not the bug was fixed, which is
the whole reason the entry insisted on it.

| State | Result |
|---|---|
| Fix applied | **2 passed** |
| `health-content.tsx` reverted to `main` | **1 failed** |
| Restored | **2 passed** |

The extraction into `useGoalSeeds` happened *after* that first proof, so the full
fix/revert/restore cycle was re-run against the final code and gave the same answer. Full E2E suite
green cold on a fresh database with `--retries=0`: **7 passed**.

Also `npx tsc --noEmit` · `pnpm lint` 0 errors · `pnpm check:rules` **Ran 36 of 36** · unit suite
**478 files / 3,939 tests**.

## A note on the size gate, because it shaped the diff

The first version of this fix pushed `health-content.tsx` from 929 to 941 lines and
`check-component-size.js` failed it. The baseline is shrink-only, so raising it was not an option —
correctly, since this file is a known hotspot. The gate is what turned "add a comment and move a
fetch" into extracting `useGoalSeeds`, which is the better shape anyway. The file is now **911
lines** and the baseline was lowered to match.

## What this does NOT cover

Not device-verified: no device in session. The fix is pure client-side data flow with no native
surface, so the sandbox browser is a fair test of it — but the S25 is still where tab-mount
behaviour under the real shell is authoritative, and this was exercised in Chromium.

**The sibling surfaces are not audited.** `targetWeightKg` and `targetBfPct` come through the same
seed/`userGoals` pair and are fixed by the same change, but any *other* screen that reads a value it
does not re-subscribe to has this exact shape and was not swept. That is a real gap, and the class —
mount-scoped state on a screen that never unmounts — is worth a broader look than this fix gave it.

<a id="2026-08-16-invalidation-audit"></a>

# 2026-08-16 — the invalidation that wasn't protecting anything

Q-262, the question Q-259's measurement exposed: does `invalidateGoalRecommendations()` do anything,
for any of its six keys? **No — for all six.** Docs and one CLAUDE.md rule; no code change.

## The mechanism, which the rule never stated

`cachedFetchCore` paints the cached value and then **always** revalidates over the network. A stale
entry can therefore only survive as a *settled* value in two cases:

- **(a)** a call site passes `freshWithinTtl: true`, which short-circuits on a fresh entry, or
- **(b)** a read path is **seed-only** — a screen that `readCacheSync`s the key and never fetches it.

Absent both, the cache is a first-paint accelerator and clearing it changes nothing about where the
screen ends up.

## Per-key answer

None of `energy-balance:<date>`, `nutrition-targets`, `body-metadata`, `progress-summary`,
`user-goals` or `more-user-profile` is fetched with `freshWithinTtl`, and none has a seed-only read
path — every screen that seeds one also fetches it, and five are in the sync-provider warm list as
well. **Every `freshWithinTtl` call site in the app was enumerated**; the one inside
`health-content.tsx` is `activity-types`, not a goal key.

The full table is in
[`docs/reviews/2026-08-16-goal-invalidation-audit.md`](../reviews/2026-08-16-goal-invalidation-audit.md).

One key needed reading rather than grepping: `energy-balance:<date>` is built by `energyKeyFor(date)`,
so no literal search finds it. That is the same static blind spot `check-cache-ttl-divergence.js`
counts and reports — a reminder that a clean sweep is not the same as full coverage.

## What the invalidation actually does

It clears a first-paint seed, so the next visit paints **nothing** where it would have painted a
slightly-stale value that corrects a moment later. By the repo's own instant-paint rule that is the
worse outcome, and it is strictly worse offline, where `cachedFetch` cannot revalidate and the seed
is the only data there is.

## Why no code was deleted

`lib/cache-groups.ts` is untouched, and that is a decision rather than caution:

1. The group becomes load-bearing the instant anyone adds `freshWithinTtl` to one of these six keys —
   a reasonable thing to do for an expensive payload. Removing it now buries the failure in a future
   PR with no reason to look here.
2. The convention that every write invalidates through a named group is worth more than six inert
   lines. A group that is currently inert still states the dependency correctly.

## What did change: the rule

CLAUDE.md stated the bug class — *"missed invalidation is the single most repeated bug class in this
project (12+ incidents)"* — without stating what makes an invalidation load-bearing. So invalidation
calls get added defensively, believing they prevent staleness `cachedFetch` already prevents, while
the cases that genuinely need it go unrecognised.

The amendment names conditions (a) and (b) and explicitly **does not** license skipping invalidation.
Its practical value is triage: a stale-value report is more often condition (b) — a read path with no
fetch — than a missing group entry. **That is exactly what Q-260 turned out to be**, and it was
misdiagnosed twice as a cache-invalidation problem before being measured.

## Honest limits

- **Only this group was audited.** The others are not expected to come out the same way —
  `cache-groups.ts` already flags `workout-data:all` and `workout-card:<id>` as `freshWithinTtl` keys
  that caused a real bug. Filed as **Q-263** with the method.
- **The blank-first-paint consequence is reasoned from the code path, not reproduced in a browser.**
  It follows from `readCacheSync` returning null after an invalidation, and the offline case from
  `cachedFetch` having no fallback. The settled-value claim — the one the audit turns on — is both
  static and, for `user-goals`, directly measured in Q-259.
- **The 12+ historical incidents were not imaginary.** Several were condition (a) and at least one was
  condition (b). The mechanism is real; it is narrower than "any missed invalidation".

## Verification

`npx tsc --noEmit` · `pnpm lint` · `pnpm build` · `pnpm check:rules` · unit suite · E2E. No version
bump — documentation and one rule, no runtime code touched, nothing user-visible.

<a id="2026-08-16-public-repo-cut-a4b"></a>

# 2026-08-16 — Q-49 A4b: Oura's material leaves the repository

**Branch:** `claude/trainingai-migration-a4b-sufoxv` · **Domain:** platform

The deletion step of the public-repo migration. All ten paths in `scripts/private-paths.json` are
gone — trained weights, baked constants, decompiled vendor source, and the two documents describing
how any of it was obtained. `check-private-paths` now reports `total tracked: 0.0 MB`.

## What shipped

- **535 files deleted**, ~89 MB. `lib/oura-models/weights/` (44 MB), `onnx/` (28 MB), `constants/`
  (12 MB), `docs/oura-models/` (3.7 MB), `scripts/oura-models/_source/`, both extraction skills, and
  the three provisioning/inventory/key-extraction documents. Our own code inside those directories
  stays: the constants loader, its type declarations, the golden recordings under
  `onnx/__fixtures__/`, and the tests.
- **`.gitignore` covers every path**, with negations mirroring the manifest's `excludes`. The point
  is `git add -A` on a machine that still has the files.
- **Both boot checks are fatal in production.** `checkModelAssets` asked the *disk*, which after this
  change is the wrong question, so it now asks the bucket; `deliverConstants` already reported and
  now throws. Both are awaited, which is what makes them gates — `register()` is awaited by Next, so
  a `void` call would have surfaced the same error as an unhandled rejection while the process
  carried on serving.
- **`NOTICE`** — it could not be written earlier, because it states that no third-party model weights
  are included and that was false until they were gone.
- **17 test files guarded** with `skipIf(!hasRealConstants())` / `!hasRealModels()`.

## The blocker A3 was believed to have removed

`next build` failed with `ENOENT ... energy-expenditure-features.json` at *Failed to collect page
data for /api/achievements*. A3 replaced the static JSON imports with a runtime loader and
`publish-dry-run --all` went green, which everything downstream read as "the constants are no longer
a build-time dependency". They still were: `next build` imports every route to collect page data, so
a module that calls a loader at **module scope** opens the file during the build. Seven such reads
existed across six modules.

They now read on first use, memoised, with each function taking its own `const C = C_()` so the
bodies are untouched. Parity against the real vendor values was run before and after the refactor —
70/70 across the four golden suites — because a lazy-init transform on 100 usages of domain math is
exactly the kind of change that looks safe and is not.

**The dry-run could not have caught this**, and that is the durable finding: its six gates do not
include a build. Filed as **Q-306**, with a cheap partial (a Custom Rules check for module-scope
constants reads) alongside the real fix.

## Guarding, and why it was done per block rather than per file

The handoff warned that a blanket regex over every top-level `describe` over-guards, and that turned
out to understate it. Measured against the deleted tree, the failures were **49 of 122 assertions**
in those files, and they do not line up with `describe` boundaries: `constants/__tests__/index.test.ts`
loses 4 of 6 blocks in its first describe while MANIFEST integrity and the registry shape hold fine
against synthetic fixtures; `ots.test.ts` loses 4 of 5; `daytime-stress.test.ts` loses 11 of 24 across
three describes. So each block was guarded on what it actually asserts, and the result was checked
**both ways** — with the vendor's files temporarily restored via `git show`, all 122 run and pass; with
them gone, 73 run and 49 skip. A guard that over-skips is invisible, so measuring only the second
direction would have proven nothing.

**The handoff's list of 16 was one short.** It was measured by moving the *constants* aside, which
never exercised the `.onnx` deletion. `oura-ble-rollup-worker.test.ts`'s "leaves the main thread free
while it runs" compares *durations*, and without the models every caller falls back and the rollup
finishes in ~65 ms — tripping the test's own degenerate-comparison guard. That guard is the test
being honest about its preconditions, so it skips rather than being relaxed.

## What is not proven

**The bucket download has still never executed anywhere.** Every run to date took the repo-copy
branch, and session sandboxes hold placeholder storage credentials that reject with
`SignatureDoesNotMatch` — confirmed again here, in the `pnpm dev` boot log. Its first real run is the
Railway deploy that merges this. A healthy boot logs `model constants: bucket — downloaded 34
file(s)` and `model assets: 8 file(s) in object storage`; anything else and the process will not come
up, which is the intended behaviour and the reason the check was made fatal in this same change.

The fatal path is gated on `NODE_ENV === 'production'`, not on whether storage credentials are set —
gating on credentials would skip the check in exactly the case it exists to catch. Non-production
logs the same message and continues degraded, which is what keeps `pnpm dev` startable at all now
that there is no tree copy to fall back on.

## Also here

- The two dangling provenance comments the private-path check had been reporting are rewritten, so
  it now reports zero.
- `lib/oura-models/constants/README.md` described a directory of files that no longer exist and
  linked to two deleted documents. Rewritten to describe the loader and where the files come from.
- `bucket-report.ts`'s summaries told an operator that "the repo-tree fallback is what production is
  using" — the single most misleading sentence to read at the moment the boot fails, since there is
  no fallback any more.
- `check-oura-models-dormancy`'s KEEP list carried 33 exemptions for files that are now untracked. An
  exemption for a file `git ls-files` cannot return exempts nothing, so they are removed.
- CLAUDE.md pointed sessions at the `oura-native-ble` skill, which went with the rest.

## Verification

`publish-dry-run --all` green with the files actually deleted rather than simulated · `next build`
clean · full suite 3,864 passed / 75 skipped / 0 failed · `pnpm check:rules` 36 of 36 ·
`check-private-paths` at `total tracked: 0.0 MB` with zero comment references · `pnpm dev` boots,
logs both degraded lines with their real cause, and serves `/api/readiness-score` 200.

**Not exercised:** the bucket download path (no credentials reachable from a session), and anything
device-side — this PR touches no native code, so the APK is unaffected and no rebuild is needed.

<a id="2026-08-16-public-repo-snapshot-pushed"></a>

# 2026-08-16 — Q-49 Phase B step 8: the snapshot is public

**Domain:** platform · **PRs:** #1393, #1396, #1397 (all in this repo) + one push to the new one

`nekodas-neko/TrainingAi_Open` holds one commit, `6c072f9` — 3,253 files, 45 MB, `git archive` of
`main` at `c9df8db`. A snapshot, not a history rewrite: ~89 MB of material sits scattered across the
old history and missing one trace is the failure mode.

Verified the way the runbook specifies rather than by inspecting the tree that produced it — cloned
the pushed repo fresh and ran `check-private-paths.js` there. Every row reads "already removed" or 0
files; `total tracked: 0.0 MB`.

## What the pre-push audit actually found

The audit was not a formality. Three things had to be fixed first, because after a push they are
public permanently.

**The owner's email, in two historical docs** (#1393). Both quote a long-dead admin check by its
literal address. Migration 006's hardcoded address had already been removed during this migration for
precisely that reason — "a personal detail the public repo should not carry" — so this was applying a
decision the project had made, not making a new one. They were the only two occurrences in the tree
and the only two files naming the owner at all.

**`scripts/private-paths.json` catalogued what it was protecting** (#1396). Its `reason` fields
described what each removed path contained, and the entry for the most sensitive one restated the
substance of the file itself. An inventory that describes its contents is a map to them. Worse, the
*same description* had been copied verbatim into `docs/overview/entries/2026-08-10-github-repo-migration.md`,
so trimming only the manifest would have bought nothing — a reader would have found it one file over.
Owner instruction was "vague so other people can't understand but our agents can": the `reason`
fields now say what an agent needs to classify a new file and refuse to commit it, the `kind` slugs
moved from naming a method to naming a category, and the mechanics the tooling depends on are
untouched.

Be honest about what that buys. It removes the specifics and the method, which is the actionable
part. It does not make the subject unknowable — `NOTICE` states outright that third-party model
weights exist and are excluded, because that is its job, and the published BLE port is itself
evidence of what was done. The owner's 2026-08-10 decision already accepted that trade for the port.
That sentence is now written into the manifest entry so it does not get lost.

**`main` was red on E2E, and had been for eight hours** (#1397). Found by refusing to re-run #1396's
failed check without reading it. `seed.sql` built every date from `current_date` — the Postgres
server's date, UTC in CI — while the app reads "today" in the user's timezone, and the seeded user is
`Australia/Brisbane` (UTC+10). From 14:00 UTC the two disagree by a day, so the newest seeded row is
yesterday as far as the app is concerned. `goal-invalidation.spec.ts` asserts a steps goal on Health's
Progress panel, and `goals-progress-card.tsx` drops rows whose value is null — so the row it looks for
could not render, and the spec failed for **ten hours of every day**. It passed when it landed because
that merge was in the morning; #1391 and #1393 passed for the same reason, at 11:09 and 11:40 UTC.

This is the repo's own banned UTC-date pattern, expressed in SQL. The fix is one anchor,
`today date := (now() AT TIME ZONE 'Australia/Brisbane')::date`, used for all five seeded domains so
they cannot drift a day apart from each other either. Confirmed by CI, not just locally: E2E green at
21:38–21:44 UTC, inside the window that had been failing.

Nothing to do with the migration — but it would have blocked step 9's throwaway PR just as surely.

## One thing left open, deliberately

`lib/data/postgres/__tests__/periodization-soft-delete.test.ts > getWeeklySetsByMuscleGroup` fails
locally (3 of 21). It is **not** the seed change: it fails with the original seed restored and on
pristine `main`'s code. CI's Tests job passed on the same window on a fresh database, which points at
accumulated local DB state rather than a `main` breakage.

Not root-caused, and not claimed to be harmless. The honest status is "reproduces locally, not in CI,
cause unknown". The tell is its shape — `expected undefined to be 1`, a *missing* row rather than a
duplicated one — which is worth knowing before someone burns a session on it.

## What is public now, and what is not

Public: the whole application, the tests, the CI workflows, and 1,039 markdown files of engineering
record — reviews, handoffs, production data audits, incident post-mortems. That was an explicit owner
decision ("publish it all — it's the project's value") rather than a default.

Not public, and enforced by a CI gate rather than by care: everything in
`scripts/private-paths.json`. The application obtains the models and constants from private object
storage at boot, and fails the boot in production rather than serving a degraded result — see
`NOTICE`.

## Next

Runbook steps 9–14. Rollback stays available until the last of them, which archives the old
repository rather than deleting it.

<a id="2026-08-17-activity-untyped-entry"></a>

# 2026-08-17 — Q-450: `/activity` with no type recorded an activity and threw it away

**Branch:** `claude/implementation-lane-b-0o7kb9` · **Version:** v1.318.1 · **Lane:** Implementation B

## What was wrong

`components/activity/activity-screen.tsx` fell through to `<PreActivityScreen />` whenever
`mode === 'pre'`, with no check on `activityType`. A typeless store is not exotic — it is the
initial state, and `resetSession()` restores it after **every** save and on the Pre screen's own
back button, so it is where the store sits between activities. Four ways in: the AI Coach's
"Log an activity" handoff, the guided-walk summary's Done button, a cold open, and a refresh.

What the user got was a blank-looking but fully working recorder: unlabelled title, working Start,
working timer, working Finish, a real summary — and then `handleSave`'s first line
(`if (!activityType || …) return`) discarded the whole thing before the local write, the outbox and
the API fallback alike. No toast, no error, no navigation, no network request. Discard was the only
control on that screen that did what it said.

Re-verified every claim in the backlog entry against `main` before building; all held, including
both offending navigations and the fact that the two legitimate `startActivity` callers set the type
correctly.

## The fix

**The entry guard is the real fix.** `activity-screen.tsx` now renders a new
`SelectActivityTypeScreen` when `mode === 'pre'` and no type is set, so a typeless recording is
unreachable rather than merely unsaveable.

The guard is deliberately **only** on `'pre'`. An in-flight `'active'` session with a missing type
keeps its own screen — throwing it back to a picker would destroy the session, which is the failure
mode the fix exists to prevent, in a new shape.

**The picker grid was extracted rather than copied.** `components/activity/activity-type-grid.tsx`
now serves both the new screen and `components/workout/log-activity-sheet.tsx`, which had the same
fetch-and-grid inline. Two sites, identical markup, both feeding `startActivity` — the repo's
"extract before a third copy" rule, and the thing that stops the two offering different type lists.
It takes an `enabled` prop because the sheet stays mounted while closed and already, correctly,
declined to fetch a list nobody is looking at.

**And `handleSave` now speaks.** The bail-out is still there as defence in depth — the entry
mandated it stop being silent — and it toasts instead of returning bare. That is not dead code: the
app is a WebView loading from Railway, so a user mid-session when this JS lands still arrives at
that guard, and silently discarding what they just did is never the right answer for them.

## The spec found a second bug

`e2e/activity-untyped-entry.spec.ts`, two tests: the typeless entry shows a picker, and a recorded
activity actually saves. The second one **failed on the first run**, and the cause was not my change.

`POST /api/activity-logs` returned **400**. `durationMin` is
`Math.round((activeMs / 60000) * 10) / 10`, so a sub-3-second activity rounds to exactly `0`, and
`ActivityLogBody.durationMin` is `.positive()` — the row is rejected and the user sees a bare
"Failed to save activity". Measured both directions: 2 s → `400` with `activity_logs` empty; 5 s →
`201` with `duration_min = 0.1`.

Q-450's bail-out was *masking* this — the review that filed Q-450 observed "zero network requests"
precisely because the save never got as far as the POST. Fixing the first defect exposed the second.

Filed as **Q-351** and **not fixed here**: the schema is `packages/shared/**` and the route is
`app/api/**`, both Lane A. The entry carries the measurement, the mechanism and a note that the
outbox path parses with the same schema, so it is a poison-pill candidate rather than only a failed
web POST.

## Mutation-checked

Per the Q-259 rule that a guard which cannot fail is not a guard: reverting `activity-screen.tsx` to
`return <PreActivityScreen />` fails assertion 1 — "element(s) not found" for the picker heading —
and the save test still passes. So the assertion dies with the fix it covers, and the two tests are
independent.

## What was NOT exercised

- **The device path.** `getLocalStore` returns null outside the APK, so the save here took the
  `/api/activity-logs` web fallback, not the SQLite write plus outbox a real tap takes. The `:167`
  guard sits above the local-store branch, so the old bail-out was if anything *earlier* on device —
  but that is reasoning, not an observation.
- **Safe-area on the new screen.** It reuses `PreActivityScreen`'s `pt-safe` header and has no
  bottom-anchored control, so there is no floored-utility hazard to get wrong — but it has not been
  seen on the S25.
- **The two offending navigations end to end.** The Coach handoff needs a live AI response and the
  guided-walk summary needs a completed walk; neither was driven. The fix is at the destination
  rather than at those call sites, which is what makes that acceptable — every entry path lands on
  the same guard, including the ones nobody has enumerated.
- **Samsung WebView rendering** of the new grid.

<a id="2026-08-17-ai-dynamic-deload-fallback-not-flagged"></a>

## 2026-08-17 — an ai_dynamic deload that fell into the catch-all branch was a deload in name only (Q-310, v1.317.5)

**Owner report (2026-08-17), two screenshots:** an active Sumo Deadlift set headed
"Pull · Deload · S2 · Ex 1/5", and the exercise summary right after it showing a
"New Personal Record!" badge with the estimated 1RM up 15.5 kg. *"it still reccomended deload
again - and the weights are increasing the PR."*

### Root cause

`/api/workout-data` resolves an ai_dynamic session's phase status through four branches in order:
AMRAP baseline, an early-deload week confirmed from Home, the `?aiDeload=1` toggle, then a catch-all
for everything else. The catch-all existed in **two verbatim copies** (the per-session-summary loop
and the single-session path) and both hardcoded `isDeloadActive: false` / `phaseType: 'normal'`, on
the belief — stated in the comment above them, "not baseline, not deload" — that a deload could only
reach the branches above.

It can't be. When the AI periodization engine picks `phase: 'deload'` off accumulated fatigue,
nobody confirms anything, so the catch-all is the *only* branch left to catch it. The label read
"Deload" because it is title-cased from `aiPeriodizationState.phase` — the same field the flag
beside it ignored.

### What the flag actually controlled — measured, not assumed

Production (`claude_ro`, owner-scoped) held two sessions stamped `phase_type = 'deload'` in the last
60 days: 2026-08-09 Pull and 2026-08-16 Pull, the day before the report. Both carry
`max(estimated_1rm) = 0` across their five exercise logs, and `personal_records` has **no row dated
either day** (latest are 08-15, 08-13, 08-12). So of the three symptoms the entry predicted:

1. **Weights stayed at full intensity — real.** `buildWorkoutExercises` receives
   `isDeloadActive: sessionPhaseStatus?.isDeloadActive ?? false`, so no reduction ran, and neither
   the prescribed nor the un-prescribed deload branch in `session-data.ts` was reachable.
2. **A `personal_records` row was written — refuted.** `logExerciseFromPayload` reads
   `session_periodization` itself and sets `currentPhaseType = 'deload'` independently of the route,
   so the server zeroed the estimate and wrote no PR. What the owner saw was the **client's**
   optimistic display: `workout-screen.tsx` derives its `isAnyDeload` from this route's flag, so it
   computed a full-intensity estimate, flashed the badge, and wrote that estimate into the local
   SQLite store while the server stored 0. **No corrective migration is needed** — that was item 3
   of the entry's fix direction, and this is its answer.
3. **The deload never resolved — follows from (1).** No intensity reduction ever happened, so the
   fatigue signal that triggered the phase was never addressed.

The entry's second half — that `exercise-summary-screen.tsx`'s `isNewPR` needs its own deload gate —
is **also refuted, and deliberately not built**. `estimateOneRm` returns exactly `0` when
`deloaded`, and the badge already gates on `newEst1rm > 0`. There is no "submaximal-adjusted
estimate that still happens to exceed the bar"; on a correctly-flagged deload the number is zero.
The badge needs no change, and `components/` is another lane's surface.

### What shipped

- `aiDynamicFallbackPhaseStatus()` in `packages/shared/src/workout/session-data.ts` — one helper
  replacing both copies, deriving `isDeloadActive` and `phaseType` from `phase === 'deload'`. Two
  identical copies of the same 17 lines is what let one bug be written twice; One Formula, One Place.
- `app/api/workout-data/route.ts` calls it from both sites.
- `packages/shared/src/workout/__tests__/ai-dynamic-fallback-deload.test.ts` — 7 tests across the
  helper and the three downstream consequences (prescribed load, the `exerciseDeloaded` flag, the
  `shouldCountTowardPr` gate, the zeroed estimate the badge reads). **Mutation-checked:** reverting
  `isDeload` to a hardcoded `false` fails 5 of the 7.

It incidentally closes the missing-stamp half of Q-298 **for this path**: with the flag right,
`buildWorkoutExercises` marks the exercise `deloaded`, the client sends `exerciseDeloaded: true`,
and the row stamps. Q-298's own entry covers the historical rows and stays open.

### Verification

Full local gate on `pnpm dev` against the local Postgres, with the seeded program switched to
`ai_dynamic` and a `session_periodization` row at `phase: 'deload'` (both reverted afterwards):

- `GET /api/workout-data?session=<pull>` → `name: "Deload"`, `phaseType: deload`,
  `isDeloadActive: true`, all three exercises at 50% × 2 sets with `deloaded: true`.
- `GET /api/workout-data?session=all` → the same for Pull; Push and Legs (no periodization row)
  unchanged at 75% × 3 sets. Both fixed copies exercised.
- A non-deload phase through the same branch (`phase: 'accumulation'`) → `"Accumulation"`,
  `phaseType: normal`, `isDeloadActive: false`, full load. No regression.
- `POST /api/log-exercise` on the deload session → `estimated1rm: 0`, `isPR: false`; the stored row
  has `estimated_1rm = 0`, `exercise_deloaded = t`, `phase_type = deload`, and the pre-existing
  Barbell Deadlift PR (160 kg) is untouched.
- `npx tsc --noEmit` clean · `pnpm lint` 0 errors (122 pre-existing warnings, none in the touched
  files) · `pnpm build` green · `pnpm check:rules` **Ran 38 of 38** · full suite 477 files /
  3,893 tests passed, 2 files / 54 tests skipped.

### Not exercised

- **On device.** Server/JS only — no `android/**` or `capacitor.config.ts` change, so this reaches
  the APK through the Railway deploy with no rebuild. The client half (`workout-screen.tsx` reading
  `phaseStatus.isDeloadActive`) was verified by reading the response the route now returns, not by
  running the WebView; Samsung rendering and safe-area were not touched and not checked.
- **The local SQLite divergence during the bug window.** Rows the device wrote with an inflated
  `estimated1rm` are corrected on the next pull (`applyDelta` overwrites once `sync_status` is
  `synced`), but that self-heal was not observed on hardware.
- **Real prod data.** The production check was read-only over `claude_ro`, which is scoped to the
  owner's rows — it says nothing about other accounts.

<a id="2026-08-17-ai-insight-sufficiency-gate"></a>

# 2026-08-17 — Q-452: the AI insight card commenting on data that does not exist

**Branch:** `claude/implementation-lane-b-0o7kb9` · **Version:** v1.318.6 · **Lane:** Implementation B

## What was wrong

`AiInsightCard` fired `POST /api/ai/health-insight` on every mount, unconditionally. The route
builds its prompt by substituting the literal string `"no data"` for every absent field — ten of
them across the four sections — and calls `generateText` regardless.

Handed `Steps: no data`, the model does not report absence. It asserts **zero** and then
editorialises. A zero-data account on its first ever visit to `/health/activity` was told:

> Your activity tracker currently shows **zero movement and no strength sessions** toward your goal
> of five per week. **This inactivity creates a significant gap** in your ph…

Re-verified against `main` before building: the unconditional fetch, the card's data-free props and
all ten `"no data"` substitutions were exactly as filed.

## What shipped, and what deliberately did not

`AiInsightCard` now takes a **required** `hasData: boolean` — required rather than defaulted, so a
new call site has to answer the question — and neither fetches nor renders without it. Gating in the
client rather than returning `{ insight: null }` from the route costs no request at all, where the
server-side version would still pay one.

Two call sites:

| Call site | Gate |
|---|---|
| `health-score-detail.tsx` (readiness · sleep · activity) | `score != null` |
| `app/health/heart-rate/page.tsx` | the trend series carries any `rhrBpm` or `hrvMs` |

**This is half the fix, and the half that is not mine.** The prompt is what conflates absent with
zero, and it lives in `app/api/**` — Lane A. A section that *has* a score but is missing a field
still hands the model a `"no data"` line, which is the common case for anyone without a ring rather
than an edge case. Filed as **Q-353** with the fix shape.

## A claim in the first draft of this entry was wrong — corrected 2026-08-17

The original version of this entry said the heart-rate gate had to avoid `data.hrMin`/`data.recentHrv`
because those are "live-ring-only and therefore null for an account with months of recorded resting
HR", and cited a measurement showing the card hidden from the seeded user.

**That is not true.** Re-measured directly against `/api/readiness-score` for the seeded user:

```
hrMin: null   hrCurrent: null   recentHrv: 65   baselineHrv: 65
```

`recentHrv` is populated, so `hrMin != null || recentHrv != null` is **true** and that gate would
have worked. The earlier `card=0` observation was a **cold-compile timing artifact** — the probe
waited 6 s, and `/api/readiness-score` had not resolved yet on a first visit, so `data` was still
null. Confirmed by mutation: putting the old gate back and running the seeded-user spec with a 30 s
budget **passes**.

The shipped code is unchanged, because the trend-series gate is still the better choice — it mirrors
what the *prompt* actually reads (`body_metrics.restingHeartRate` / `hrvMs`) rather than a different
API's fields that happen to correlate. But it was chosen for that reason, **not** because the
alternative was broken, and the earlier entry asserted a measurement that does not hold.

The real lesson is the one worth keeping: **a 6-second wait is not a measurement on a cold dev
server.** Two of this repo's own rules already say so — `SKELETON_TIMEOUT_MS` is 20 s and
`goal-round-trip.spec.ts` documents a 39.7 s cold run against a 7.6 s warm one — and I walked into it
anyway.

## Verified, not guarded

Measured in a browser against two accounts — the seeded user and a temporary zero-data user, both
removed afterwards. Both directions matter and both were checked: the fix must hide the card when
there is nothing, **and** must not hide it when there is. The second is where the bug was.

No committed spec covers it, for the same reason as Q-451: the harness has one seeded account and it
has data. **Q-352** is the fixture that would close this, and it now has two dependants.

## What was NOT exercised

- **The device.** Web build only.
- **The partial-data case.** Not reproducible without constructing an account that has one field and
  not another; it is the subject of Q-353 rather than of this change.
- **The `heart-rate` section's prompt behaviour** — the gate was verified, the copy the model
  produces for a partially-populated heart-rate section was not.
- **Samsung WebView rendering.** No layout changed (the card either renders as before or not at
  all), so there is nothing new to see, but it was not looked at.

<a id="2026-08-17-nutrition-tap-refuted"></a>

# 2026-08-17 — Q-309 refuted: the tap works; the harness was tapping wrong

**Branch:** `claude/implementation-lane-b-0o7kb9` · **No version bump** — no product code changed · **Lane:** Implementation B

## What the entry claimed

Q-309: *"a touch tap on Nutrition's action row does not activate the button; a synthesised click
does."* It suspected the screen's date-swipe binding
(`useDrag(..., { filterTaps: true, pointer: { touch: true } })`) was swallowing taps, and noted this
repo's history of gesture handlers swallowing input (pull-to-sync, twice). It also — correctly —
refused to authorise a gesture change without device reproduction first.

That caution turned out to be the right instinct, because the premise is wrong.

## What was measured

Four probes in the real harness, against the live screen:

| Input | Events the element received | Sheet opens |
|---|---|---|
| `.click()` | `pointerdown, mousedown, pointerup, mouseup` — **a mouse sequence, no touch events** | **no** |
| `page.touchscreen.tap()` | `pointerdown, touchstart, gotpointercapture, pointerup, touchend, lostpointercapture, click` | **yes** |
| hand-rolled synthetic `TouchEvent`s | (synthetic events produce no real activation) | no |
| `dispatchEvent('click')` | the old workaround | yes |

**A real touch tap opens the sheet, first time, every time.** That is what the canonical runtime —
a touch-only APK — actually does, so the reported user-facing bug does not exist.

**The `filterTaps` hypothesis cannot be right.** The failing case produces *no touch events at all*;
there is nothing for a tap filter to filter. `pull-to-sync` is ruled out too — it binds only touch
listeners and is not mounted on this screen.

Two further checks, to avoid replacing one guess with another:

- **Not an open-then-close.** Polling the DOM 20× over 2 s after `.click()` shows `[role="dialog"]`
  never appears at all.
- **Screen-specific, not harness-wide.** `.click()` on `/more` → Edit Profile opens that sheet
  normally, so Playwright's mouse path is not simply broken.

## One correction to my own working, recorded because it nearly misled me

An early probe attached listeners to the element returned by
`[...document.querySelectorAll('button')].find(b => /water/i.test(b.textContent))` and reported that
**no `click` event fired at all**. That was wrong — it had attached to a different element than the
locator resolves. A document-level capture listener shows the click *does* reach `span[Water]` in
both cases. The corrected picture is what the table above records, and it is what makes the residual
question ("a click arrives and the handler does not run") the interesting one rather than "no click
arrives".

## What shipped

Only the spec. `e2e/water-log-write-path.spec.ts` now taps with `page.touchscreen.tap()` instead of
`dispatchEvent('click')`, which satisfies the entry's own requirement that *"the spec should stop
needing `dispatchEvent`… a spec that cannot tap the way a user taps is testing something adjacent to
the product."* Its comment block now carries the measurements rather than the refuted hypothesis.

**No product code changed**, so no version bump and no changelog entry.

## What is left, and what was deliberately not done

**Q-309 is removed** — its premise, that a touch tap does not activate the button, is false.

**Q-354 filed** for the part that is genuinely unexplained: a mouse click reaches the element on this
screen and the handler does not run, while the same input works elsewhere. Filed **low priority and
explicitly non-actionable-by-guessing**: the entry says not to change gesture code without first
reproducing a *touch* failure, because the touch path is verified working and a speculative change
there would put the path that matters at risk.

**The sibling sweep was not run**, deliberately. Q-309 asked for one across Health and the day-detail
screen "if this is real". It is not real for touch, which is the only input the supported target
produces, so sweeping siblings for a mouse-only anomaly is not worth the change surface. If Q-354 is
ever picked up and turns out to be something structural, the sweep belongs with it.

## What was NOT exercised

- **The device.** Everything here is Chromium under Playwright. A CDP touch sequence is the closest a
  browser harness gets to a finger, and it is not a finger on the S25's WebView — so "touch works" is
  measured in the harness, not on the phone. It is, however, the *opposite* direction of risk from
  the entry's concern: the harness was the pessimistic case.
- **Why the mouse path fails.** Narrowed to "screen-specific, click arrives, handler does not run",
  not pinned. That is Q-354.

## Addendum, 2026-08-17 — the cause found, and a correction to this entry

The section above concluded that the `useDrag` binding "cannot be the cause", reasoning that the
failing input produces no touch events for `filterTaps` to filter. **That reasoning was too narrow
and the conclusion was wrong.** It is about the *touch* path; `useDrag` also binds mouse/pointer, and
the mouse path is exactly what it breaks.

Proven by removing `{...bindDateSwipe()}` from the container and re-running the probe:

| Input | with binding | binding removed |
|---|---|---|
| `locator.click()` | ✗ | ✓ |
| raw `page.mouse.click()` | ✗ | ✓ |
| mouse down+up, 0 ms gap | ✗ | ✓ |
| `touchscreen.tap()` | ✓ | ✓ |
| `element.click()` in page context | ✓ | ✓ |

So the original Q-309 report named the right component for the wrong reason, and this entry then
cleared it for a reason that did not cover the mouse path. **What does not change** is the part that
decides whether anyone is affected: touch taps work, on every probe, and touch is the only input the
supported runtime produces. Q-309 stays refuted as a user-facing bug.

`pointer: { touch: true, mouse: false }` was tried as a targeted fix and **does not work** — all
three mouse paths still fail with it set — so it was reverted rather than left in as a
plausible-looking no-op. A real fix means going into use-gesture's click-suppression behaviour, which
is the rewrite the entry warned against, for a path no supported user takes. Recorded in Q-354 with
that recommendation.

**The method lesson:** "X cannot be the cause because mechanism M does not apply" is only as good as
the enumeration of mechanisms. The binding had two (touch and mouse); I checked one and generalised.
Removing the suspect and re-measuring is what settled it, and it is cheaper than the argument was.

<a id="2026-08-17-profile-group-labelling"></a>

# 2026-08-17 — Q-261: the six button groups on More that had no accessible name

**Branch:** `claude/implementation-lane-b-0o7kb9` · **Version:** v1.317.4 · **Lane:** Implementation B

## What this was

Q-258 associated every `<Label>`/`<Input>` pair in `components/profile/`. Six `<Label>`s were left
behind because they are a different shape — they front groups of buttons, or static text, so
`htmlFor` had nothing to point at. The backlog entry recorded them rather than letting the sweep
look complete, and left the design question open: `@radix-ui/react-label` pointed at a `<div>` of
buttons is the wrong element, not a half-configured one.

Verified the premise against `main` before building: exactly the six cited sites, at the cited
lines, unchanged.

## What shipped

Five of the six front mutually-exclusive option sets — Fitness Goal, Biological Sex, Activity Level,
Weight Units, Food Region. They now carry `role="radiogroup"` + `aria-labelledby`, with
`role="radio"` + `aria-checked` on each option.

**That choice is house precedent, not a new invention.** Three sites already do exactly this
(`workout/deload-toggle.tsx`, `workout/session-duration-picker.tsx`,
`more/home-widgets-section.tsx`). A fourth site — `nutrition/ingredient-row.tsx` — uses the
competing `role="group"` + `aria-pressed` shape. The backlog entry proposed `role="group"`, but
`radiogroup` is both the accurate semantic for pick-one and the majority precedent, so the five went
that way and the entry's suggestion was not followed literally.

**`aria-labelledby` rather than `aria-label`.** The three existing sites use `aria-label`, which is
right for them — they have no visible label. These five do, so pointing at the on-screen text means
the visible label and the accessible name cannot drift.

**Timezone was the one case that is not a group.** Its `<Label>` fronted a static value plus an
unrelated action button, so it became a plain styled `<p>` — nothing was being labelled. The button
left behind was named only "Auto-detect", which says nothing once the surrounding text is not
visible; it is now `aria-label="Auto-detect timezone"`.

Nothing moved visually. The replacements carry the computed classes `<Label>` resolved to
(`flex items-center gap-2 text-xs leading-none font-medium select-none` plus the call site's
`text-muted-foreground`), so this is an accessibility-tree change and nothing else.

## The guard, and why it was mutation-checked

`e2e/profile-group-labelling.spec.ts`, two tests. Every assertion is a role query —
`getByRole('radiogroup', { name })` resolves the name through `aria-labelledby`, so it reads the
accessibility tree rather than the DOM, which is what the backlog entry asked for ("verify with a
screen reader or an accessibility-tree dump, not by eye").

Q-259's lesson is that a guard which cannot fail is not a guard, so both were checked by mutation
rather than assumed:

| Mutation | Result |
|---|---|
| Drop `role`/`aria-labelledby` from `goal-targets-section.tsx` | Test 1 fails; test 2 passes |
| Drop them from `edit-profile-sheet.tsx`'s units row | Test 2 fails; test 1 passes |

So the assertions are independent and each dies with the fix it covers.

One assertion is deliberately weaker than it looks: Fitness Goal, Biological Sex and Activity Level
all clear on a second tap of the active option, and the seed user may have none set, so the spec
asserts `aria-checked` is *present and boolean* on every option rather than that one is checked.
Weight Units is the one group that cannot be cleared, so it is the one place the checked count is
asserted exactly.

## What was NOT exercised

- **TalkBack on the S25.** Playwright reads Chromium's accessibility tree. That proves the name and
  checked state are exposed — the mechanism that was broken — and it is not the same as hearing the
  announcement on the device. This is the outstanding item and the reason the Known-Issues row stays
  in `projectOverview.md` rather than moving to the resolved archive.
- **The APK generally.** Per `e2e/README.md`, the harness drives the web build; `getLocalStore`
  returns null there. Nothing in this change touches an offline-first path, so that limitation does
  not bite here, but it is stated rather than assumed.
- **Safe-area / layout.** Not exercised, and not at risk: no fixed header, bottom-anchored control
  or sheet inset was touched, and the computed classes are unchanged.

## Filed, not fixed

**Q-350** — none of the app's now-eight `role="radiogroup"`s implements arrow-key navigation with a
roving `tabindex`. Q-261 matched the three existing sites rather than fixing them: building that
inside a labelling fix would have been an unrequested refactor, and five sites with keyboard nav
next to three without is worse than eight consistent ones. It is genuinely low priority on a
touch-only APK where TalkBack navigates by swipe, and it wants a shared `components/ui/` primitive
across all eight rather than eight hand-rolled copies.

## Gates

`tsc --noEmit` clean · `pnpm lint` 0 errors (122 pre-existing warnings) · `pnpm test` 376 files /
3320 tests passed, 0 failed · `pnpm check:rules` **36 of 36** · `pnpm e2e` 14 passed including the
two new specs.

<a id="2026-08-17-q251-export-endpoint-plan"></a>

## 2026-08-17 — the prod-snapshot endpoint is a paginated read of a schema that already exists

**Branch:** `claude/q251-export-endpoint-plan-6e1b7j` · **Domain:** `platform` ·
Planning session, docs only. Nothing implemented.

### What was asked

Plan the admin export endpoint behind the rescoped **Q-251** — a prod-shaped database snapshot for
local migration rehearsal and data-shape realism — reusing the row-scoping map in
`scripts/generate-claude-ro-views.js` rather than duplicating it, and say plainly whether it is worth
its risk.

### The answer, and it is smaller than the entry implied

Build it, as **Q-530**, plan in
[`plans/2026-08-17-admin-db-snapshot-endpoint.md`](../superpowers/plans/2026-08-17-admin-db-snapshot-endpoint.md).

The scoping map does not need to be shared, extracted, or imported. **`claude_ro` already *is* the
export**: 80 views, one user, default-deny, nine columns withheld, served by a role with no write
grants and its own `max: 2` pool. The endpoint paginates `SELECT *` over that schema. One map, in one
file, and the second consumer reads its output rather than its source — so there is nothing to keep
in step. ([Q-287's deletion plan](../superpowers/plans/2026-08-16-account-deletion.md) reached the
same "reuse it, do not rebuild it" conclusion for a third consumer.)

### Three measurements against production that changed the design

- **The DB is 477 MB and `oura_raw_samples` is 360 MB of it — with 1,098,005 of its 1,098,183 rows
  belonging to the owner.** Filtering to one user removes **0.02%** of the volume. Scoping is a
  consent fix and never a size fix, and Q-251 should not be read as implying otherwise. The shaped
  data rehearsal actually needs is a few MB (90 workout sessions, 1,019 set logs, 76 sleep sessions),
  so the default export omits the four bulk tables and a `?bulk=<days>` parameter opts a window back.
- **The `claude_readonly` role can read `pg_class` / `pg_attribute` for `public`** — 83 tables, 944
  columns — despite holding no `SELECT` privilege there, because `pg_catalog` does not filter by
  privilege the way `information_schema` does. That is what makes the drift gate implementable from
  the read-only connection: **a table added without regenerating the views makes the export fail and
  names it**, rather than being silently omitted, computed from the live database at request time.
- **Every production table has a primary key**, so keyset pagination has no fallback case to design.
  `pg-cursor` is not a dependency and is not needed.

### The existing CI parity test is kept, and is not sufficient

`claude-ro-readonly-role.test.ts` asserts `views == tables - 2`. It is a **count** rather than a set
of names, it is **column-blind**, its migration filename pin **went stale silently between 181 and
185** (the file says so itself), and it checks the **local** schema — while `CLAUDE.md`'s standing
root cause is prod drifting from the fresh local seed. It also skips entirely under the Unix-socket
`DATABASE_URL` the session-start hook writes, so it does not run in a sandbox session at all; CI uses
the TCP form and does run it.

### A near-duplicate, caught before it landed

The `/api/export` coverage defect was drafted here as a fresh Q number before grepping the queue
turned up **Q-288**, filed 2026-08-15, covering the same file with the same fix direction. Folded the
new findings into Q-288 instead and released the number.

Two corrections and one new defect went into it: the count is **26 of 82 tables**, not 27 of 80 (the
old figure counted `goals`, a repository call rather than a table); ten further omissions including
the user's own `users` profile row; and — new — **the route cannot stream a large table, while its
comment claims it can.** `exportUserData` calls `pool.query` per table, buffering each result set
whole. Harmless across 26 small tables, an OOM the moment a bulk table is added to close the coverage
gap, which means **fixing coverage without fixing the buffering is strictly worse than the bug.**

### On the risk

The leak analysis is plan §6. Short version: total health-data disclosure for one person, **no**
account takeover, no write path, no other user's rows. The marginal risk over today is small, because
`CLAUDE_DB_QUERY_SECRET` already sits in every agent session's environment and already reads exactly
this data through the same views and the same role — the snapshot adds bulk egress speed and a second
key, not a new data class. A **separate** `ADMIN_SNAPSHOT_SECRET` is recommended over reusing
`ADMIN_EXPORT_SECRET`, so a leak of one is not a leak of both. Secret handling is confirm-first, so
the variable itself is flagged for the owner in the entry.

### Also this session

The `error_events` orientation read found nothing new: the largest signature is the `[pg 21000]`
cardinality fault on `/api/hr-ingest`, already recorded and fixed under **Q-214**, with its latest
hit on 2026-08-13. No new Known-Issues row was owed.

### Not exercised

Nothing was built. The production numbers, the `pg_catalog` readability, the primary-key coverage and
the withheld-column nullability were each run and are quoted from output. The endpoint, the restore
path, and the load behaviour of a bulk pull do not exist yet. No client code and no device surface is
touched by any of this.

<a id="2026-08-17-q536-clock-epoch-diagnosis"></a>

## 2026-08-17 — the 43 midday bedtimes are a spurious clock epoch, not a timezone bug (Q-536, v1.318.0)

Q-536 was handed to Lane A as top of queue with an explicit gate: *"Do not run a corrective pass
until the open question is settled"* — whether the 2026-07-04 → 08-16 rows were already wrong or
were rewritten wrong by the 2026-08-17 redecode. **Both of its questions are now answered from
production, and two hypotheses are refuted** — including the one the entry called "the fix". The
repair the evidence *does* support was approved by the owner and shipped as migration 189; the
redecode that rewrites the stored nights is still owed.

### What is actually wrong

The ring clock **never reset**. `oura_ble_clock_anchors` holds four epochs, and the minimum lag
(`anchor_utc − anchor_ds×100`, bounded below by the true offset because an event cannot be received
before it happened) agrees across all four to within **50 seconds**, over three weeks and 5,368
anchors:

| epoch | anchors | min lag vs epoch 2 | p10 lag vs epoch 2 | created |
|---|---|---|---|---|
| 0 | 312 | −5 s | −0.01 h | (default) |
| 1 | 695 | +44 s | **+12.17 h** | 2026-07-30, 28-min burst |
| 2 | 3,666 | 0 s | 0.00 h | 2026-07-30 |
| 3 | 695 | +45 s | **+14.16 h** | 2026-08-17, 40-min burst |

Epochs 1 and 3 are **history re-drains misread as resets**. After a re-pair the app holds no sync
cursor, so the ring replays days of buffered events; the replayed `ds` looks like a counter
regression and `isClockEpochReset` opens an epoch. The counter is in fact continuous — epoch 3's
first sample above epoch 2's ceiling is ds 37,112,507 against 37,112,321, a gap of **18.6 seconds**.
Nothing dropped to near zero, which is what `clock.ts` itself says a real reset does.

The damage follows in two steps. `robustOffsetMs` estimates an epoch's offset at the **p10** of lag,
justified in its own comment by a steady-state measurement (n=99, p0→p10 spans 1.4 min). A re-drain
breaks that assumption outright: over 90% of the burst's anchors carry backlog, so p10 lands 14.16 h
inside it. Epoch 3 then became `currentEpoch(anchors)`, and `aggregateOuraRawSamples`'s `toDate`
(`adapter.ts:5088`) calls `resolveDsToMs(ds, anchors)` **with no epoch argument**, defaulting to the
newest. Every historical sample was re-timed by +14.16 h.

**The number reconciles exactly.** Subtracting 14 h 10 min from the 43 wrong `sleep_start` values
puts every one into a bedtime distribution: 2 at 20:00, 15 at 21:00, 23 at 22:00, 2 at 23:00, 1 at
00:00 Brisbane. Nothing else is needed to explain them.

### The two blocking questions

**Were the rows already wrong, or rewritten wrong? Rewritten, by the redecode.**
`sleep_sessions.updated_at` shows **49 nights** written on 2026-08-17 covering 2026-07-08 →
2026-08-17; every other night was last written on its own day. Before the reinstall `currentEpoch`
was 2, whose offset matches epoch 0's to within 48 s — so those rows were **correct when written**.
Nothing needs reconstructing, and a corrective pass is the right response.

**Is the resolver epoch-scoped per row, and is that the fix? No, and no.** The samples do carry
`oura_raw_samples.epoch` (migration 161), and `ds → epoch` is very nearly a function — 3 collisions
in ~1.09 M rows. But epoch 3 holds **5,756 re-drained rows below epoch 2's ceiling**, interleaved
with their epoch-2 originals across ds 33.0 M–37.11 M. Resolving those per-row would split one span
across two offsets 14 hours apart, which is worse than the uniform shift it replaces. The entry's
*"That is the fix"* does not survive contact with the data: **the epoch labels themselves are
wrong**, so scoping to them repairs nothing.

### What shipped

**Migration `189_q536_merge_redrain_clock_epochs.sql`** merges same-clock epochs across
`oura_ble_clock_anchors` and `oura_raw_samples`, and drops the affected `oura_rollup_state`
watermark so the next rollup re-derives rather than trusting a watermark whose epoch moved
underneath it.

It decides what to merge from **measured evidence, not a user id or an epoch number**. Scoping to
one user would need that id hardcoded in a public repo, and `pg_stat_user_tables` is far too stale
to prove the owner is the only ring user (it estimated 6 anchor rows against 5,374 actual). Scoping
to "epochs 1 and 3" would encode the incident rather than the rule. So the criterion is the
evidence: two epochs are the same ring clock when their **minimum** anchor lag agrees, within 10
minutes — 12× the observed 50 s spread and orders of magnitude below any real re-key gap. A re-drain
leaves that minimum untouched, because the drain's newest anchor is delivered as promptly as any
steady-state one; a re-key restarts the counter and moves the origin by weeks.

Validated on the merged production values before writing it: p10 across all 5,374 anchors lands
**3 seconds** from the clean epoch-2 offset.

`lib/data/postgres/__tests__/q536-merge-redrain-clock-epochs.test.ts` — 5 tests, run through
`pool.query()` with the whole file, the same way `ensureSchema` runs it, so the `ON COMMIT DROP`
temp table is exercised under the production execution path. **Mutation-checked both ways:**
removing the lag-agreement guard fails the "genuine re-key is left alone" test, and removing the
sample relabel fails another.

**The fixture taught something worth keeping.** Its first draft gave each drained epoch two anchors,
and the test failed — with n=2, `robustOffsetMs`'s p10 index is 0, so it returns the clean minimum
and the contamination vanishes. The second draft left the drain's newest anchor 40 minutes late,
which broke the merge criterion instead of testing it. What actually reproduces the bug is the
*shape*: a drain replays days of ds inside a short window that ends as the newest event lands, so
lag falls monotonically to ~0 and p10 sits a tenth of the way up that ramp.

### Still owed

⚠️ **A full-history Redecode after deploy.** The migration relabels; it does **not** rewrite the 43
stored nights. The rollup's incremental window is 35 days and the damage spans 44 (2026-07-04 →
2026-08-17), so clearing the watermark does not reach the oldest of them. **Health stays wrong until
that is run** — this is the step that actually fixes what the owner sees. (Q-535: Redecode reports a
spurious "failed: 502" for work that succeeded.)

### What was deliberately not done
- **`robustOffsetMs` was left alone, on evidence.** Lowering the percentile is the obvious fix and
  it is wrong: on a drained epoch even **p1 is already +1.28 h contaminated**, and only the *two*
  smallest anchors are clean — too thin to estimate from. On a healthy epoch p0→p10 spans 7 s and
  50 s, so the statistic is fine. The defect is the spurious epoch.
- **Reset detection was not changed** — filed as **Q-314** instead, because it needs a design
  decision and there is **no observed true reset in the data** to validate any threshold against.
  Both epoch openings were re-drains. Getting it wrong in the other direction — missing a real
  re-key — is worse and quieter than the current failure, which is not a call to make silently.

### ✅ Confirmed on the owner's device, 2026-08-17

The redecode ran at 10:47 against v1.318.2 and the fix is real, measured rather than reported:

| | before | after |
|---|---|---|
| nights starting 10:00–14:00 Brisbane | **43** | **4** |
| nights starting 21:00–22:00 | 25 | **62** |
| total nights | 82 | 82 — nothing lost |

The owner's screen now reads 10:01 pm, 9:10 pm, 10:23 pm, 11:03 pm — against 10:45 am, 9:54 am,
12:30 pm before. The four survivors are **short daytime fragments** (0.0–1.4 h: 14:39–14:59,
11:03–11:33, 09:33–11:11, 16:47–18:32), not bedtimes; they are Q-274, and they are now the only
deviation left in the table.

**The +14.16 h reconciliation was arithmetic on stored values when this entry was written. It is now
an observed result** — which is the claim the "Not exercised" section below correctly refused to make
at the time, and it took three deploys to earn.

### Not exercised

- **The migration has not run against production.** It is verified against a local reproduction of
  the production epoch shape, and against a synthetic genuine re-key. Nobody has yet seen a real
  corrected sleep window — the +14.16 h reconciliation is arithmetic on stored values.
- **The redecode has not been run**, so Health still shows the wrong times as of this writing.
- **No device, no dev server.** Server/DB only; nothing here reaches the APK except through data.
- **Owner-scoped.** Every production count is the owner's rows only, and `claude_ro` prunes at 30
  days — the migration's merge criterion is deliberately per-user so that limitation cannot leak
  into other people's data.

<a id="2026-08-17-q536-migration-statement-timeout"></a>

## 2026-08-17 — the Q-536 migration rolled back on every boot, so the redecode rebuilt the same wrong times (v1.318.2)

The owner deployed v1.318.0, ran the full-history redecode as asked, and sent a screenshot of Health
still showing midday bedtimes — 10:45 am, 9:54 am, 12:30 pm.

**The redecode was not at fault. Migration 189 never applied.**

### How it was established

`/api/version` reported `1.318.0`, so the deploy had landed. Three reads settled the rest:

- `claude_ro.oura_ble_clock_anchors` still held **four epochs**, with epoch 3's p10 lag still
  ~14 h off epoch 2's. Nothing had been merged.
- `claude_ro.schema_migrations` topped out at **188** — 189 was absent.
- `oura_rollup_state` still read `epoch: 3`, and 189's last statement deletes that row. So the
  transaction had rolled back **whole**, not partially applied.

`ensureSchema` catches a failed migration, logs `[ensureSchema] FAILED`, records nothing, and
carries on — its own comment says such a file "is retried on every boot, which is why one of these
can print forever and still be real". It had been failing since the deploy.

### Cause

189 relabelled `oura_raw_samples` in the same transaction: **434,707 rows on the 667 MB table**, four
indexes. The pool sets `statement_timeout = 15s` (`lib/data/postgres/client.ts:39`).

Verified rather than assumed, through the exact execution path `ensureSchema` uses — one
`pool.query()` with the whole file text:

| what was run | result |
|---|---|
| pool at 15 s, `pg_sleep(20)` | `FAILED [57014] canceling statement due to statement timeout` |
| `SET LOCAL statement_timeout='60s'; pg_sleep(20);` | completed |
| `SET LOCAL statement_timeout='200ms'; pg_sleep(2);` | `FAILED [57014]` |

So the pool's limit does bite, and `SET LOCAL` genuinely overrides it inside the implicit
transaction of a multi-statement simple query — in both directions, which is what rules out it being
silently ignored.

**What went wrong in the making: the migration was verified against an 8-row fixture.** That proved
correctness and said nothing whatever about scale, on the largest table in the database. The local
test passed, CI passed, and neither could see the only property that mattered.

### The fix, and why it is a split rather than a bigger timeout

The two halves are not equally important, and that is what makes splitting them right rather than
merely convenient:

- **189** — merge the **anchors** (~5,400 rows) and drop the stale watermark. This is the entire
  repair: the offset every derived timestamp depends on comes from `oura_ble_clock_anchors`, via
  `currentEpoch(anchors)` and `robustOffsetMs(anchors)`.
- **190** — relabel `oura_raw_samples.epoch`. That column is written at ingest
  (`adapter.ts:4888`) and **read by nothing**. It matters only for a future per-row resolver, and
  leaving samples labelled 1/2/3 while every anchor says 0 would hand that resolver labels which
  disagree with the clock they index.

Both carry `SET LOCAL statement_timeout`. Separating them means the expensive, inert half can no
longer roll back the cheap, load-bearing one — if 190 times out on real data, 189 still stands and
the sleep times are still correct.

**190 introduced a hazard of its own, caught before it shipped.** It re-derives the mapping from the
anchors *after* 189 merged them, and the obvious re-derivation — `MIN(epoch) GROUP BY user_id` —
would also collapse a user whose epochs 189 deliberately left split, destroying a genuine re-key.
It now only touches users left with exactly one surviving anchor epoch, and skips anyone ambiguous.
Mutation-checked: removing the `HAVING COUNT(DISTINCT epoch) = 1` guard fails the re-key test.

Editing 189 in place is safe **only because it never reached `schema_migrations`**. That is not
licence to edit an applied migration — `ensureSchema` tracks by filename, so an edit to an applied
file never runs. Both files say so.

### Verification

Two new tests (7 total in the file): 189 alone repairs the clock, and 190 leaves a genuine re-key's
sample labels alone. Both migrations applied cleanly through `scripts/local-db/migrate.js`.
`npx tsc --noEmit` clean · full suite **478 files / 3,900 tests passed**, 2 files / 54 skipped.

### Still owed

⚠️ **The redecode has to be run again.** The one the owner ran against v1.318.0 could not have
worked — the migration under it had rolled back. Nothing about that run was wasted effort beyond the
time, and nothing was corrupted by it.

### Not exercised

- **Nothing was run against production.** The diagnosis is read-only over `claude_ro`; the fix is
  verified locally and by CI's clean-database migration job. **Nobody has yet seen a corrected sleep
  window** — that remains true from the previous entry and is the whole point of the re-run.
- **The 434,707-row UPDATE has never been executed at production scale.** 190's 30-minute budget is
  reasoned from the row count and the fact that `epoch` is in no index (so the updates are
  HOT-eligible), not measured. If it times out, it rolls back alone and costs nothing.

<a id="2026-08-17-radiogroup-keyboard-nav"></a>

# 2026-08-17 — Q-350: arrow keys for the eight radiogroups

**Branch:** `claude/implementation-lane-b-0o7kb9` · **Version:** v1.318.7 (Q-350) + v1.318.9 (Q-355) · **Lane:** Implementation B

## What was missing

Eight `role="radiogroup"`s, none with arrow-key navigation or a roving tabindex. `Tab` walked every
option individually and the arrows did nothing — so a group of five options was five tab stops
instead of one, and a screen-reader user navigating by keyboard could not do the thing the role
promises.

Three of the eight predate this work (`workout/deload-toggle`, `workout/session-duration-picker`,
`more/home-widgets-section`); five were added by Q-261, which matched their shape deliberately
rather than shipping five with keyboard nav next to three without.

## The shape, which is not what the entry proposed

Q-350's entry asked for a shared `components/ui/` radio-group **component** taking
`{ options, value, onChange, label }`. I built a **hook** instead —
`lib/hooks/use-roving-radio-group.ts` — and the reason is the eight call sites:

| Site | Visual shape |
|---|---|
| `deload-toggle`, `session-duration-picker` | two-line segmented pills in a grid |
| `home-widgets-section` | bordered card list with a check icon |
| `profile/goal-targets-section`, `required-info-section` (activity) | card list with title + description |
| `required-info-section` (sex) | equal-width pill row |
| `edit-profile-sheet` (units, region) | compact segmented strip |

Five genuinely different renderings. A single component covering them needs either a render-prop for
the option body or enough styling props to reconstruct each one, and that abstraction fits none of
them well. **What every site was missing is behaviour**, so behaviour is what got shared. The markup
stays where it is and stays readable.

Two design points inside the hook:

- **Options are read from the DOM** (`querySelectorAll('[role="radio"]')`) rather than from a list
  passed in. It keeps the hook agnostic about rendering and it cannot disagree with what is on
  screen.
- **Selection is delegated by clicking the target**, not by calling back with a value. Each site owns
  its own semantics — some clear when you re-pick the active option, some cannot be cleared — and
  routing the keyboard through the `onClick` those buttons already have means the hook cannot get any
  of that subtly wrong. Arrow keys never land on the already-active option, so the deselect-on-repick
  sites are unaffected.

## The guard, and the finding that came out of writing it

`e2e/radiogroup-keyboard.spec.ts`, mutation-checked in both halves: removing `onKeyDown` from
`groupProps` fails the arrow assertions; replacing the computed `tabIndex` with a constant `0` fails
the single-tab-stop one.

The first draft drove **Fitness Goal** and failed on `toBeFocused` — selection moved correctly, but
focus was gone. That is not the hook. `handleFitnessGoalChange` calls `patchProfile`, which sets
`saving`, and those buttons carry `disabled={saving}` — **a browser drops focus from an element that
becomes disabled**. So on the three goal groups, an arrow keypress moves the selection and then
ejects the user from the group.

Filed as **Q-355 — and then fixed straight after**, because a keyboard feature that ejects you on
every press is not worth shipping half-done. It ships as **v1.318.9**, its own entry, because
v1.318.7 had already merged and deployed by then; amending a shipped version's notes would have
described a change users did not yet have. The three goal groups now use `aria-disabled={saving}`
with the in-flight guard moved into the handler (`if (saving) return`). That keeps exactly the
double-submit protection `disabled` gave — CLAUDE.md is explicit that submit paths need an in-flight
guard — while leaving the button focusable. `useRovingRadioGroup` skips `aria-disabled` options, so
the group is inert but not lost while a save is running.

The spec's second case now asserts focus on Fitness Goal, twice in a row so that one keypress
surviving cannot pass by luck. Mutation-checked: putting `disabled={saving}` back fails it.

I could have made the original failure go away by dropping the focus assertions everywhere. Keeping
them where they can hold is what turned a red test into a real second fix.

## What was NOT exercised

- **A screen reader.** Chromium's accessibility tree exposes `aria-checked` and `tabindex`, which is
  what the spec reads. Nothing here is TalkBack on the S25, and that remains the outstanding check
  for every accessibility change this lane has shipped.
- **A physical keyboard on the device.** The canonical runtime is touch-only, which is precisely why
  this was low priority; the value is for future desktop/keyboard use and for automated a11y scanning
  (Q-282), not for the owner today.
- **Six of the eight groups**, in the harness. The spec drives Food Region and Fitness Goal. The
  other six take the identical hook, and typecheck plus the full E2E suite confirm nothing regressed,
  but no assertion drives them individually.
- **Home/End keys**, deliberately not implemented — optional in the ARIA practices, and no call site
  is long enough to want them.

<a id="2026-08-17-rollup-worker-error-cause"></a>

## 2026-08-17 — the redecode reported which query failed and never why (v1.318.4)

Three redecode attempts, three identical reports:

```
redecode error: Failed query: select "id", "anchor_ds", "anchor_utc" from "oura_ble_clock_anchors"
  where "oura_ble_clock_anchors"."user_id" = $1 order by "created_at" desc limit $2
```

No reason, either time. The first was dismissed as load, and that was wrong — it reproduced on
v1.318.2 with the migrations applied and the database idle.

### The blind spot

`aggregateOuraRawSamples` and `redecodeOuraRawSamples` run in a `worker_threads` realm (Q-213), and
an `Error` does not survive structured clone with its prototype — so `rollup-worker-entry.ts`
flattened errors to a string with `err.message` and posted that across the boundary.

That is exactly the wrong half. Drizzle wraps every driver failure in a `DrizzleQueryError` whose
`message` is only `Failed query: <sql>\nparams: …`; the reason lives in **`.cause`**, and `pg` puts
the discriminating part in **`.code`**. So the report named the query and discarded everything that
would identify the fault. A statement timeout (`57014`), a dead pooled connection, a permissions
error (`42501`) and a constraint violation were indistinguishable.

`msg()` now walks the cause chain, appends each `code`, and guards against a cycle.

### What is still not known

**The actual cause of the redecode failure.** This ships the instrument, not the diagnosis. What was
established and can be skipped next time:

- The query is not slow — the same statement runs in **34 ms** against production.
- It is not connection exhaustion — `max_connections` is 500 with **11** in use.
- It is not the migration: 189 and 190 applied at 10:33:52 and 10:34:11, and all **5,383 anchors are
  now epoch 0**, with the merged p10 offset landing **3 s** from the clean value.
- The same method (`getOuraClockAnchor`, `adapter.ts:4530`) is on the incremental rollup path, which
  **succeeded** at 10:21:58 through the same long-lived worker.

So it fails in the worker on the redecode job while working in the worker on the ingest job. A dead
pooled connection on a reused worker fits, and so do several other things; without the cause it is
guesswork, which is what this change ends.

### Not exercised

- **Nothing was run against production**, and the sleep windows are still wrong: the stored nights
  carry `updated_at` of 07:58 and 10:21, both before the migration landed.
- **The new formatting has never flattened a real driver error** — the tests build Drizzle-shaped
  errors by hand. It is verified in shape, not in the field.

<a id="2026-08-17-score-presentation-audit"></a>

# 2026-08-17 — Q-281's audit, and the one colour-only-state violation it found

**Branch:** `claude/implementation-lane-b-0o7kb9` · **v1.318.10** · **Lane:** Implementation B

## What this was

Q-281 asks for every surface rendering a pillar score to be enumerated and scored for contributors /
trend / action, and its own sequencing says to **do the audit now and hold the UI work** until
Q-500 / Q-272 / Q-275 / Q-277 settle the numbers — otherwise it gets done twice. It carves out one
exception: fix anything failing the repo's colour-only-state rule first, since that is already a
`CLAUDE.md` violation and is the cheapest subset.

That is exactly what shipped: the audit, plus that one subset.

## The audit

[`docs/reviews/2026-08-17-score-presentation-audit.md`](../reviews/2026-08-17-score-presentation-audit.md).
Fourteen surfaces. **Nine of fourteen render a score with no contributors and no trend**, and exactly
one surface — `health-score-detail.tsx`, reachable only by tapping through from Home — has all three.

## The fix, and the one that was deliberately not made

Two candidates matched the colour-only-state rule. Only one is real.

**Fixed:** of the twenty selectable Home score-ring styles, `accentring` is the only one that renders
a state cue at all, and it rendered it as an 8 px `aria-hidden` band-coloured dot with no text. The
band word reached the aria-label, so a screen reader had it and a sighted user with a red/green
deficit did not. The word now rides beside the dot at 7.5 px, which leaves the cue's height — and so
the row's — unchanged. The other nineteen styles render no state colour at all, which is the absence
of the cue rather than a violation, so nothing else moved.

**Not fixed, on purpose:** `FactorBar` colours both the bar and the trailing number by band and
renders no band word — a literal match for the rule. But the trailing number *is* the sub-score, in
text, right beside the bar, so the state is already carried in a non-colour channel, which is what
the rule protects. Adding "High/Moderate/Low" to each of 5–7 rows would crowd the densest surface in
the app to restate what the number already says. Recorded in the doc as inspected-and-declined so it
is not re-filed as an open violation next time someone greps `scoreBand`.

## Three corrections to Q-278, which is the entry this most affects

Q-278 is about score coverage and absent-vs-zero. The audit contradicts two of its premises:

1. **"Typically a gap, a carried-forward value, or nothing, depending on the surface"** is not what
   the code does. Every surface independently arrived at the same behaviour — `—` on Home and
   day-detail, `—` with a muted ring and the band label *suppressed* on the detail hero, and the
   element hidden entirely on the timeline, day-sections, sleep card and stress tiles. **No surface
   renders a null score as 0 and none carries yesterday's value forward.** What is missing is only
   the *why*, which makes Q-278 one explanation layer rather than a defect sweep.
2. **Two of the five "pillars" have no score surface to fix at all.** Daytime stress is two *minute*
   tiles nested inside `/health/activity`; resilience is one conditional tile inside
   `/health/readiness`. Whether they are pillars is a decision Q-278 has to make before it
   generalises a representation over five of them.
3. And a scoping note in the other direction: **`packages/shared/src/health/score-audit/` has zero
   user-facing consumers** — two admin routes, one admin tab, one producer. Q-281 describes the
   machinery as existing and partly used; for that layer it is entirely unused, so a plan saying
   "wire up the existing layer" is building the first consumer. `scoreAvailability` likewise has
   exactly one consumer, `readiness-breakdown.tsx`, which makes Q-278's scope item 1 cheaper than it
   reads.

## Guard

`e2e/score-band-not-colour-only.spec.ts`. It sets the style preference via `addInitScript` before
`goto` (it is a localStorage pref read on mount, and routing through the settings UI would let an
unrelated screen break the guard), reads the band out of the cell's aria-label, then requires that
same word to be visible inside the cell.

**Mutation-checked**: deleting the word span fails it — verified by actually removing the span and
watching the run go red, then restoring. Asserting on the *word* rather than the dot is what makes it
a guard; the dot is present either way.

## What was NOT exercised

- **The device.** Chromium under Playwright at 412×915. The 7.5 px band word is the kind of thing
  that needs eyes on the S25 — it is legible in the harness screenshot, but small type on a real
  panel at real distance is a different question, and this is a *style the owner can select*, not the
  default. **Owed: a look at Home with "Accent ring" selected on the S25.**
- **Contrast.** Not measured, on either theme, for any band colour. That is Q-282's gap and this
  change does not close it — the word inherits the same band colour the dot had, so it is exactly as
  contrasty as the dot was.
- **The other nineteen styles** were read, not run. The spec exercises `accentring` only.
- **No score model was touched.** The audit is source-level and the fix is presentation.

<a id="2026-08-17-scroll-panel-page-jump"></a>

# 2026-08-17 — Q-532: a streaming panel that scrolled the whole page

**Branch:** `claude/implementation-lane-b-0o7kb9` · **Version:** v1.317.6 · **Lane:** Implementation B

## The report and the cause

Owner, during the Oura re-sync runbook: *"The screen constantly moves to the centre while a scan is
running — making it hard to click buttons."*

The entry guessed at "a `scrollIntoView` / auto-scroll on new log lines, or a keyed remount", and
pointed at `oura-ble-debug.tsx`. It was the first of those, one file over —
`components/oura-ble/log-console.tsx:17`:

```ts
useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'auto' }) }, [lines.length])
```

`endRef` is a sentinel `<div>` at the bottom of a `h-64 overflow-y-auto` panel. **`scrollIntoView`
scrolls every scrollable ancestor up to the document, not just the nearest one** — so each log line
appended during a drain scrolled the log panel *and* the page. That is the whole bug. It is not a
re-render or remount problem, and the screen's polling was a red herring.

Why it matters more than an annoyance, per the entry: this screen is only used during a live drain,
which is the one situation where a mistimed tap can hit **Clear key**.

## The fix

`lib/hooks/use-scroll-to-bottom.ts` — the ref goes on the scrolling container itself and the effect
assigns `scrollTop = scrollHeight`, which cannot escape that element. The sentinel `<div>`s are
gone from both call sites.

Extracted rather than inlined twice because the repo's rule is that a pattern at ≥2 sites gets
extracted before a third copy, and because the reason not to reach for `scrollIntoView` is exactly
the kind of thing that needs to be written down once.

## The sibling sweep, which found a second instance

CLAUDE.md requires grepping for every other surface with the same pattern. Five `scrollIntoView`
calls exist. Sorting them by whether the target sits inside its own scroll container:

| Site | Verdict |
|---|---|
| `oura-ble/log-console.tsx` | **The bug.** Sentinel inside `h-64 overflow-y-auto`. Fixed. |
| `workout-builder/builder-review.tsx` | **Same defect.** Sentinel inside `max-h-48 overflow-y-auto`, itself inside a `flex-1 overflow-y-auto` panel — so every streamed chat message moved the review page under the user while they were editing exercises. Fixed. |
| `coach/coach-content.tsx` | **Correct as written.** No inner scroll container in that file; the page *is* the scroller for a full-screen chat, so scrolling it is the intent. Left alone. |
| `profile/level-sheet.tsx` | Not this bug — one-shot on sheet open, user-initiated. |
| `health/contributor-chart.tsx` | Not this bug — fires from a tap handler, user-initiated. |

The builder-review one is the find. Nobody reported it, and it would have behaved identically to
the reported bug on a screen with a genuinely destructive neighbour (Save/Discard on a program).

## What was NOT exercised — this is the important part

**Neither fix is device-verified, and the reported bug is not reproducible in the sandbox at all.**
The entry says so itself: a BLE scan cannot run here, and a static screenshot would not show it.
What I have is a precisely identified mechanism and a fix whose correctness follows from documented
DOM behaviour — not an observation of the symptom disappearing.

**No automated guard was added, deliberately, and the reason is a capability gap rather than a
judgement call.** Both vitest projects run `environment: 'node'` and there is no
`@testing-library/react` in the repo, so there is no way to render a component and assert on scroll
position without introducing component-test infrastructure — which is its own item, not a rider on
a two-line fix. The E2E harness cannot reach it either: `/admin/oura-ble` needs an admin session and
a live radio.

So the regression risk is real and unmitigated: someone can reintroduce `scrollIntoView` on a
sentinel and nothing will fail. The `module-map.md` row and the hook's own comment are what stand in
for a test. A CI rule flagging `scrollIntoView` inside a `useEffect` (allowlisting the two
legitimate uses, the way `check-api-no-store.js` allowlists `/api/version`) would mechanise it
properly — considered and not built here, because adding a 39th custom rule is a call worth making
on its own rather than inside an unrelated fix.

**Also not exercised:** Samsung WebView rendering, and the workout-builder chat end-to-end (it needs
live AI calls). The full suite (377 files, 3327 tests) and all 14 E2E specs pass, but none of them
touch either changed panel.

## Q-531 skipped, and marked blocked rather than passed over

Q-531 sits above Q-532 and is also `[app-shell]`, so it was the higher Lane B item. It asks for the
premise of a shipped IA decision (Q-234) to be re-litigated against a real user's task. The owner's
report is the only evidence of what that task is, and an agent picking the new structure alone would
repeat precisely the failure the entry describes — Q-234 reasoned taxonomically, correctly on paper,
and was wrong in use. It is annotated `⛔ blocked: needs an owner decision` in place, per the
backlog protocol, with what would unblock it.

<a id="2026-08-17-workout-select-empty-state"></a>

# 2026-08-17 — Q-451: the Workout tab's dead primary action on a brand-new account

**Branch:** `claude/implementation-lane-b-0o7kb9` · **Version:** v1.318.2 · **Lane:** Implementation B

## What was wrong

`/workout-select` is the `Workout` bottom-nav destination and the app's primary action. With no
program it rendered the session carousel anyway: a ~1,400 px card showing position-0's palette emoji
(💪) as a stand-in for content that did not exist, under a full-width **Start Workout** button whose
handler was

```tsx
onClick={() => currentSession && handleStart(currentSession)}
```

With no program there is no `currentSession`, so the expression short-circuited to `undefined`. The
button was not `disabled`, produced no navigation, no toast, no console error and no request. The
comparison that makes it a bug rather than a gap: `/program` handles the same account correctly
("No programs yet. Create one to get started.") — the screen a new user is actually dropped on did
not.

Re-verified against `main` before building: the short-circuit, the palette-emoji stand-in and the
missing empty state were all exactly as filed.

## The fix

Three states where there was one. The important part is the middle one — `sessions: []` meant both
"still loading" and "this account has no program", and rendering the second as the first is what
produced the broken card:

| Condition | Renders |
|---|---|
| `N === 0 && !programLoaded` | a skeleton — genuine cold first load |
| `N === 0 && programLoaded` | "No program yet" + a **Create a program** CTA to `/program` |
| otherwise | the carousel, unchanged |

`programLoaded` is set from a cache seed or a settled fetch, and **deliberately not in a `finally`**.
Telling someone who has a program "No program yet" because their network dropped is a worse failure
than holding the skeleton, so a failed first load with no cache keeps the skeleton and the Refresh
button in the header resolves it.

A repeat visit never sees the skeleton: the `useLayoutEffect` seed sets `sessions` synchronously
before paint, so the carousel is already there — the instant-paint rule holds.

The inert button is **removed** in the no-program case rather than disabled. A disabled primary CTA
still says "this is the thing to do here", which is not true; a CTA to the thing that *is* the
prerequisite is.

## The sibling sweep, and its answer

Grepped for the same `onClick={() => x && f(x)}` shape. One syntactic match:
`app/session-select/components/recommendation-card.tsx:281`, which is on **Home** (that file is
`SessionSelectContent`, rendered by `tab-shell.tsx` as the `home` tab — the `/session-select` route
itself just redirects).

**It is not a bug.** That button sits inside the component's `) : displaySession ? (` branch, so
`displaySession` is non-null by construction there — the `&&` is redundant defence, and its sibling
button two lines down calls `onStartWorkout(displaySession)` unguarded, consistent with that. When
there is no session the card renders `null`, so Home shows no dead control. The review that filed
Q-451 rendered 21 zero-data screens and flagged only this one, which agrees.

Everything else the grep found (`!sectionEditMode`, `!future`, `!inert`, `!isEquipped`) is a
deliberate mode guard, not an inert-on-missing-data path.

## Verified by observation, not guarded

**Observed working.** The harness has one seeded account and it has a program, so I inserted an
ad-hoc `fresh@local.dev` row into the local DB and drove a throwaway spec against it. Full screen
text before, from the review: `Workout / Choose a session to start / 💪 / Start Workout / Cardio Hub
/ Run · Walk · Log anything`. After:

```
Workout / Choose a session to start / No program yet / Create one to get a session to start.
Cardio and one-off activities work without a program. / Create a program / Cardio Hub / …
```

No `Start Workout` button present, and **Create a program** navigates to `/program`. The temporary
spec and the temporary row were both removed.

**Not guarded, and that is the honest state.** Nothing committed can reach a first-run state, so
this can regress silently. Filed as **Q-352**: a zero-data account in the seed plus a second
Playwright storage state. It is not free — `scripts/local-db/setup.sh` will not re-seed a non-empty
`users` table, so an existing local DB never gains the account while CI always has it, and a spec
that assumes it would pass in CI and fail locally. That needs deciding rather than bolting on, which
is why it is an entry and not a rider on this PR.

## What was NOT exercised

- **The device.** Web build only; nothing seen on the S25.
- **Safe-area.** The empty state sits inside the existing `flex-1 min-h-0 mx-4` slot the card
  occupied, with no fixed or bottom-anchored element of its own, so there is no floored-utility
  hazard — but that is structural reasoning, not an on-device check.
- **The failed-first-load path** (no cache, fetch fails). Reasoned about and deliberately left
  showing the skeleton; not reproduced.
- **Samsung WebView rendering** of the new state.
- The 16 committed E2E specs pass, but all run as the seeded user *with* a program — they prove no
  regression to the carousel, and say nothing about the new branch.

<a id="2026-08-18-acwr-calibration"></a>

# The workouts pillar had never been calibrated, and the thresholds turned out to be the one thing that was right

**Date:** 2026-08-18 · **Branch:** `tuning/acwr-calibration` · **Agent:** Tuning 🎶
**Type:** docs-only — calibration evidence · **Filed as:** Q-512, Q-513

Prompted by the owner asking whether *all* pillars had been tuned against historical data. They had
not. The earlier sweep covered the health/recovery **scores**, and **workouts, heart-rate and cardio
had zero calibration coverage.** This is the first review of the workouts pillar, starting with
`ACWR_THRESHOLDS` because it drives deload decisions.

**One correction to that answer, found while acting on it:** I first listed **nutrition** as
uncalibrated too, citing `DEFAULT_STEP_GOAL 8000` and `SESSION_VOLUME_GOAL_KG 5200` as unchecked round
numbers. That was wrong. Both the strength-frequency goal (Q-137, 91 days) and the session-volume goal
(Q-190, 40 sessions) were carefully fitted to the owner's own data on 2026-08-11, with
[`docs/activity-goal-calibration.md`](../activity-goal-calibration.md) as the record; the step and
zone-minute goals are deliberate population anchors (Paluch 2022, WHO 150 min/wk) with their reasoning
in the source. The genuinely uncalibrated part of nutrition is narrower: **whether the recommended
calorie target tracks the owner's observed weight change.**

## The thresholds are right

Replaying `computeVolumeAcwr` over 77 completed sessions / 109 days, using the window the
decision-driving caller actually passes: mean **0.99**, median 1.05, sd 0.32, and bands of
Undertraining 18.2% / **Optimal 69.3%** / High 12.5% / Very High 0%.

Centred on 1.0 with a modest tail each side — what the literature says a well-managed athlete looks
like. `{0.8, 1.3, 1.5}` divides it sensibly. Nothing to move.

The emergency deload (`acwr > 1.5`) has never fired; the observed maximum is **1.48**. That is
recorded as clean rather than filed, and the contrast with Q-506 is the point. The illness radar
peaked at 38 against a threshold of 40 and *was* filed — because its input was provably broken. Here
the input is healthy. **A near-miss is a symptom, not a diagnosis; the rule is "check the input
first", not "never touch a threshold that just misses".** And an emergency deload that fires often is
not an emergency.

## Two of the three things computing it are wrong

**`health-insight`'s ACWR is null on 110 of 110 days.** It passes a 7-day session list into a helper
that gates on a 21-day span, measured from the earliest session *in the list it was handed*. A 7-day
list can never span 21 days. Structural, not a coverage problem — the route reads `.acwr` every time
and it is always null.

**The score-audit panel and the engine disagree on the band 38% of the time.** Three callers pass
three windows: 28 days (the engine), 7 days (always null), and **all history** (the audit panel). The
chronic term divides by the span of whatever list it gets, so the audit variant computes *this week
vs the entire training history* rather than vs the last four weeks. Mean 1.07 against 0.99, `high`
share 29.2% against 12.5%, and three days past the emergency-deload line the engine never saw.

The mechanism gets worse with progress: the lifetime weekly average is 20,572 kg against 23,239 over
the last 28 days (1.13×), so the smaller denominator inflates the ratio — and any sustained volume
increase widens that gap indefinitely.

That matters more than a display nit because `build-day-audit` **is** the score-audit panel, whose
whole contract is to show a score beside the inputs that produced it. On 38% of days it shows a
training-load band the engine never used.

## Not exercised

No code changed. **The replay is a faithful port, not the shipped function, and it could not be
validated against a stored value because no ACWR is persisted anywhere** — there is nothing to
reconcile against. That is why §1 is phrased as "the thresholds fit this distribution" rather than
"the shipped code produces these numbers". Volume is `sum(weight_kg × reps)` from `set_logs`; the
bodyweight-load path was not traced and three zero-volume sessions were left at zero. The audit
caller's `programTooNew` gate is not modelled and can null its ACWR independently, so **38% is an
upper bound** on the days the panel renders a band. Nothing on-device; no owner-reported symptom
prompted this. Every figure is the owner's (`claude_ro` is row-scoped).

## Correction

The previous session entry said the Tuning lane was "drained". That was wrong, and the owner's
question caught it: it was drained of *health-score* work. Four pillars with real tunable constants
had never been looked at. The baton now tracks pillar coverage explicitly instead of score coverage.

<a id="2026-08-18-battery-anchor-discontinuity"></a>

# Auditing my own recalibration found nothing missed, and one pillar quietly fixed

**Date:** 2026-08-18 · **Branch:** `tuning/battery-anchor-discontinuity` · **Agent:** Tuning 🎶
**Type:** docs-only — calibration evidence · **Filed as:** Q-511

The standing rule is that when a display scale moves, **every** threshold and consumer on it gets
re-anchored in the same PR. The sleep recalibration moved that scale ~15 points and re-anchored
`LOW_SLEEP_SCORE`. This is the audit of whether that was the whole list.

**It was.** There is exactly one comparison threshold on the sleep scale in the entire codebase, and
it was the one that moved. Every other consumer — Body Battery's anchor, readiness's `previousNight`
contributor, resilience's `sr` — takes the score as a *value* and inherits the shift directly rather
than needing a constant changed.

## The thing the audit turned up instead

`body-battery/anchor.ts` uses the sleep score **raw** as the day's anchor, and a provisional sleep
anchor can upgrade to readiness part-way through the morning. Its own docstring records what that
cost: *"shifted the ENTIRE day's curve … the number visibly jumped and the two Home cards stopped
agreeing"* — an owner report from 2026-08-02.

The size of that jump is `readiness − sleepScore`, and nobody had measured it. Over the 33 days
carrying both: **mean −17.7**, sd 10.2, range **−51 to +6**.

Then the useful part. The recalibration moved sleep 84.1 → 69.5 over its replay window, so the gap
goes from −17.7 to roughly **−3**: the two anchor sources were about 18 points apart and are now
about 3. Nothing targeted Body Battery — it fell out of putting sleep on a realistic range, because
readiness already was on one.

**Which makes it something to protect rather than celebrate.** The obvious future move — reading the
new sleep distribution as "too harsh" and lifting it back — re-opens an owner-reported bug in a
different pillar. That constraint now exists and was previously written down nowhere, which is the
actual deliverable here.

## What did not get fixed

The *systematic* offset is mostly gone. The per-day disagreement (sd 10.2) is not, and no
recalibration removes it — two different scores disagreeing about the same morning is Q-276's open
question. So ±10-point flips remain routine and **the freeze-once rule stays load-bearing**. It must
not be relaxed on the grounds that the scores now agree; they agree on average, which is a different
claim.

## The bound worth stating

`body_battery_daily` has **never** persisted `anchor_source = 'sleep'` — 41 days `readiness`, 9
`default`, zero `sleep` — because a sleep anchor is provisional and gets overwritten. So the
end-of-day table cannot separate "the flip happens every day" from "readiness is always available
first and the sleep arm never runs". **The magnitude is solid; the frequency is unknown**, and the
owner's report is the only evidence it fires at all.

Also recorded rather than filed: nine days right after the re-key anchored at a flat **50** because
neither score existed. Last occurrence was over a month ago, so it reads as a coverage gap that closed
on its own — noted as unexplained rather than fixed.

## Not exercised

No code changed; nothing on-device. The −3.1 post-recalibration gap **mixes two windows** — the gap is
measured over 33 production days, the sleep shift comes from the review's 65-night replay, and their
old-sleep means differ (87.2 vs 84.1). So it is an estimate, not a measurement; the robust claim is
"most of the systematic offset is removed". It cannot be measured directly until enough new-model rows
accumulate, and there is currently **one**. Every figure is the owner's (`claude_ro` is row-scoped).

<a id="2026-08-18-ble-era-input-drift"></a>

# The re-key moved two inputs, and the useful result is a refit we are not shipping

**Date:** 2026-08-18 · **Branch:** `tuning/ble-era-input-drift` · **Agent:** Tuning 🎶
**Type:** docs-only — calibration evidence · **Filed as:** Q-509, Q-510

Both items come off this agent's own follow-up list rather than another lane's queue: Q-509 is the
"re-derive Q-500's anchor on BLE-era nights" item, Q-510 closes the lead Q-508 left open when the
db-query endpoint locked out mid-session.

## The refit came back, and the answer is not to use it

`readiness-composite.ts` carries a rule written *before* the data existed to test it:

> *If a BLE-only refit lands well below 5, the input changed and that is a `devices` finding, not a
> scoring one.*

There are now 42 BLE-era nights of `recovery_index_hours` where there were 15 Cloud-era ones. Running
Q-500's own zero-bias procedure on them gives an anchor of **3.31 h** against the shipped **5**. Well
below. So the rule fires, and the anchor stays.

What makes it convincing rather than merely rule-following is that **the anchor and the input moved by
the same factor**: mean hours 3.59 → 2.657 (0.74×), median 3.28 → 2.377 (0.72×), zero-bias anchor
4.63 → 3.31 (**0.715×**). A real change in the owner's recovery would move the hours while leaving the
correct anchor where it was. An anchor that must shrink by exactly the factor its input shrank by is
absorbing a multiplicative bias in the estimator — and moving it would be compensating for a broken
input at the scoring layer.

It is a level shift, not a drift: July mean 2.73 / median 2.35, August 2.56 / 2.48. The step is at the
re-key and has not moved since. The mechanism was already measured in Q-500's review — at matched
sampling density the BLE series is about twice as noisy.

Worth recording plainly: **Q-500 worked.** At the shipped anchor of 5 the contributor is mean 50.8
against 43.4 at the old 6. Nothing here argues against that change; it argues against making a second
one in the same direction two days later for a reason that turns out to be measurement.

## Resilience's missing days are a coverage gate nobody can see

All four `contributorsOk` inputs are present on **18 of 18** August days — recovery index, HRV, RHR
and the HRV baseline. A daily index is produced on **3**. So the blocker is inside `preprocessStress`,
and with a stress series present on 14 of those days, the coverage check is what is failing.

It cannot be confirmed from the database, because **neither side of that inequality is persisted**.
The stored extreme-bucket counts do not separate the cases: 08-07, 08-13 and 08-17 all carry 90
minutes of extremes and produce nothing, while 08-16 carries the same 90 and produces an index.

And `worn_hours_ble` — the field an auditor reaches for first — is **NULL on all 96 rows**, exactly as
it was recorded at 0 of 79 on 2026-08-05.

So the ask is one number: persist the coverage `preprocessStress` already computes. Only after that
is "is `minDaytimeStressHours` too strict for this wear pattern" a question anyone can answer — and it
must not be answered by lowering the constant until the score fires, which is the Q-506 mistake.

## Not exercised

No code changed and nothing ran on-device. §1's refit has **no ground truth** — Oura Cloud stops at the
re-key — so the 69.0 target is carried over from the Cloud-era nights on the assumption that the
owner's long-run mean recovery did not step-change on 2026-07-07. That assumption is load-bearing and
is stated rather than tested; the smoothing experiment proposed as the first action does not depend on
it. The §2 conclusion is **by elimination** — the four contributor gates were measured, the coverage
check is inferred as the remaining candidate, not observed failing. Every figure is the owner's
(`claude_ro` is row-scoped).

## A correction to yesterday's note

The baton recorded the db-query `Forbidden` as "sustained, different from the burst 401". It recovered
on its own a few minutes later, so it *was* the transient failure after all — the baton has been
corrected, since the wrong version would have told a successor to stop using a working endpoint.

## Postscript, same session: both recalibrations went live while this was being written

PR #77 measured that neither had reached a stored row and predicted where the first one would appear.
It appeared within the hour.

Readiness now has **1 of 96** rows stamped `v3:ri5:2026-08-18`, and the shared `model_versions` JSONB
reads `{"bodyComp": "atlas_2_1_0", "readiness": "v3:ri5:2026-08-18"}` — so the **merge** that code was
deliberately written as held in production, which had only been argued for until now.

Sleep has no stamp, so it was verified by recomputation instead: 2026-08-17 stores **78** against a
raw weighted blend of **77.91** (old model), and 2026-08-18 stores **92** against a calibrated **92**
(new model; its raw blend is 86.07). Each day matches exactly one candidate, by 8 and 6 points. **The
step in the sleep trend falls between those two days.**

Worth stating because it is counterintuitive: 08-18's score went *up* under the new model, even though
the recalibration dropped the mean from 84.1 to 69.5. `SCORE_CALIBRATION` lifts the upper-middle, so a
genuinely good night still reads as one. Checking "did it land?" by looking for a lower number on a
good night gives the wrong answer.

95 of 96 rows remain pre-recalibration and will stay so — history is not back-filled.

<a id="2026-08-18-ble-rekey-declared-not-inferred"></a>

# 2026-08-18 — a ring re-key is declared, not inferred (Q-314)

**Lane A** · branch `fix/ble-clock-reset-vs-redrain` · migrations **194** + **195** · no Kotlin, no APK.

`isClockEpochReset` opened a new clock epoch on any ds regression over an hour. **A history re-drain
produces exactly that shape.** After a re-pair the app holds no sync cursor, so the ring replays days
of buffered history — a 4.75-day regression on 2026-08-17 — and that read as a ring-clock reset. It
was not: the counter is continuous across the boundary (an **18.6 s** gap) and the minimum anchor lag
agrees across all four epochs to within **50 s**.

The cost is not small. A spurious epoch becomes `currentEpoch`, its offset is estimated from a burst
in which >90% of anchors carry re-drain backlog, and `aggregateOuraRawSamples` resolves every ds
against `currentEpoch` — so **one re-pair re-times the entire sleep history**. It happened twice
(2026-07-30, +12.17 h; 2026-08-17, +14.16 h). The first self-healed in seven minutes when another
epoch opened. The second did not, and became Q-536.

## The decision

The entry listed three candidates and did not choose. **The owner chose "declare it explicitly"
(2026-08-17)**, and it is the right shape for the reason the entry gives: a re-key is a deliberate
act performed with `open_oura` on a laptop, so the app can be *told* rather than left to infer it
from counter shape.

`POST /api/oura-ble/rekey` records a declaration; the **next** ingest batch consumes it and opens the
epoch. Deferred because the new ds is not knowable until the ring reports. `GET` shows what is
pending, `DELETE` cancels a mistaken one — but only while it is un-consumed, because a consumed
declaration names an epoch that already exists and every timestamp derived from it depends on that
row as the audit trail.

## The safety net, and why it is still there

The entry's own warning: *"missing a real re-key is worse and quieter than the current failure."* So
counter shape still opens an epoch on its own — but only when the counter genuinely **restarted**,
which is the discriminator a bare regression lacks.

A re-drain replays history the ring already sent, so its max ds is a large fraction of the ceiling —
**53%** and **89%** on the two real events. A re-key restarts the ring's clock at zero, so the first
batch after one is a small fraction of a ceiling built over months. `EPOCH_RESTART_RATIO = 0.05`
gives a **10× margin** against both measured re-drains.

A ratio rather than an absolute floor because it self-scales: on a ring re-keyed after two years the
ceiling is ~630 M ds, and 5% of that still leaves ~36 days of fresh history before the net stops
firing — where a fixed threshold would be wrong at one end or the other.

⚠️ **There is still no observed true reset in the data**, so this bound is validated only against the
two events it must *not* fire on. That is why the declared path carries the load and this is a net.

Two judgement calls in the classifier worth recording:

- **A declaration does not require a regression at all.** A ring re-keyed mid-buffer can legitimately
  come back with a *higher* ds than the old ceiling; requiring the counter to look restarted would
  silently ignore the owner saying it was re-keyed.
- **The re-drain branch logs loudly.** It is the case that used to corrupt history and it is also the
  ordinary consequence of a re-pair, so it must be visible without being an error — and the message
  names the route to use if the ring really was re-keyed.

## Verification

- **12 pure tests** over the classifier, using the two **real** events as fixtures rather than
  invented numbers: both regress (which is why the old check fired), neither is a restart, both are
  classified `redrain`, and the margin against the bound is asserted directly. Plus the declaration
  winning without a regression, the undeclared-restart net, the ratio boundary, ceiling-scaling, and
  the no-history case (`-Infinity` must not read as a restart).
- **7 DB-backed tests** on the ingest path itself: a re-drain does not open an epoch; a declaration
  opens exactly one on the next batch and is consumed with the epoch it opened; three following
  batches do not open three; declaring twice queues one; a pending declaration cancels and a consumed
  one does not; an undeclared restart still opens one; and it is user-scoped.
- **Mutation-checked**: restoring the old "any regression opens an epoch" turns **four** of them red,
  including both real-event fixtures.
- **Live on `pnpm dev`**: all four verbs — nothing pending, declare, declare again (idempotent, same
  id), pending, cancel, cancel again, and unauthenticated 401.
- Full suite **490 files / 3,993 tests passed** · `tsc --noEmit` clean · `pnpm check:rules` 38 of 38.
- Migrations 194 and 195 applied against the local dev DB; the partial unique index confirmed in
  `\d`.

## Failure surfaces NOT exercised

- **A real re-key.** By construction — there has never been an observed true counter reset in this
  data, which is the whole reason the net's threshold is unvalidated in the direction it exists for.
  Exercising it means actually re-keying the ring, which risks a firmware update that breaks the
  reverse-engineered BLE protocol.
- **The device half.** The declaration is a server-side admin action; nothing in the APK calls it, so
  the owner declares it themselves after running `open_oura`. Making the app declare on re-pair would
  be Kotlin and a new APK.
- **No UI.** `components/oura-ble/` is Lane B's — filed as a follow-up rather than written across the
  lane boundary.
- No device, no Kotlin, no APK.

<a id="2026-08-18-hr-rest-threshold-calibration"></a>

# Getting fitter shrank the rest boundary by 3×

**Date:** 2026-08-18 · **Branch:** `tuning/heart-rate-calibration` · **Agent:** Tuning 🎶
**Type:** docs-only — calibration evidence · **Filed as:** Q-515

First calibration review of the heart-rate pillar. `HR_REST_THRESHOLD` is the single rest/active
boundary shared by Body Battery's charge/drain and the Activity Score's "moved this hour" signal, so a
wrong value propagates into two pillars.

## What happened

Over 12,471 BLE ring samples in waking hours, joined per day to that day's own stored profile:

| month | resting HR | hr_max | boundary | median % of waking samples below it |
|---|---|---|---|---|
| 2026-07 | 62.9 | 187.0 | **69.1 bpm** | **26.5%** |
| 2026-08 | 54.4 | 171.2 | **60.2 bpm** | **8.2%** |

A 3.2× collapse in a month, at identical sample density.

## Every input behaved correctly

Resting HR fell because the owner got fitter. `hr_max` fell from 187 to 168 because the profile matured
from the age formula to a corroborated observed ceiling — the chest strap's max is 166 over 40,230
samples, so that is `resolveHrProfile` working as designed. Waking HR fell too, 77.5 → 73.3.

**The trap is a rate difference.** Resting HR fell 8.5 bpm; waking HR fell only 4.2. Resting HR is the
more responsive fitness marker, so a boundary pinned to it moves about twice as fast as the
distribution it is supposed to classify. The owner improved and was rewarded with less recovery credit.

## No fraction fixes it

Sweeping the constant, July vs August medians: 0.05 → 26.5/8.2, 0.08 → 38.5/22.7, 0.10 → 47.8/29.8,
0.12 → 59.6/35.2, 0.15 → 72.8/50.6. The gap narrows from 3.2× to 1.4× but never closes. Raising the
fraction opens the window at both ends without stabilising it.

**That is the fourth time today** the answer has been "the threshold is right, the input or the anchor
is wrong" — the illness radar, ACWR, RPE autoregulation, and now this.

## Two questions, and I only answered one

*Is the boundary stable?* No, and that is a defect regardless of taste — a classifier whose behaviour
changes 3× in a month because its subject improved is not measuring what it claims to.

*Is 8.2% the right level?* **Unknown, and I am not claiming otherwise.** That is ~1.2 hours of a
15-hour day, which is not obviously wrong, and whether Body Battery should charge more during daylight
is a product question. **Fix the stability alone** — raising the fraction at the same time makes the
two effects inseparable and neither verifiable afterwards.

## The recommendation, and the tempting wrong answer

Anchor the boundary to a slow-moving resting baseline — 90-day trailing, or a fixed offset re-derived
quarterly — so a month of fitness improvement cannot move the classifier under its own data.

The tempting alternative is a percentile of the owner's own recent *waking* HR. It self-calibrates to
the right distribution and is stable by construction — which is exactly the objection. Body Battery
charge would go near-constant, so a genuinely restful day could not read as one. The codebase already
names this "the treadmill" and removed it from the activity-goal volume lane. **A self-referential
boundary is fine for a pure classifier and wrong for anything feeding a score, and this one feeds two.**

## Not exercised

No code changed. `hr_max = 168` was **not traced to its source** — that it comes from a corroborated
observed ceiling is inferred from the numbers, not read out of the resolver. The 07:00–21:59 waking
window is this review's definition, not the app's, so the absolute percentages would shift under a
different one (the July-vs-August ratio would not — one definition throughout). **Body Battery was not
replayed**, so the link from boundary to charge is read from the route's structure rather than measured
through it. `PEAK_BANDS` and the Karvonen zone boundaries were not reviewed and remain open.

Q-272's "median 6.7% of waking samples" could not be reproduced — the same statistic now gives 15.0%
pooled over 42 days. **Not filed as an error there**; the month split suggests it was measured on
recent data alone, and the drift documented here explains the gap.

## Part 2: the peak bands were built for a heart-rate range lifting never reaches

`hr-recovery-profile.ts` justifies its bands as *"for stable per-bucket sample sizes"*. That is an
empirical claim, so I measured it. Over 208 episodes the owner's set-peaks run **59–132**, median 102,
p95 121.

| band | episodes | share | mean `drop_60s` |
|---|---|---|---|
| `<110` (spec: de-emphasise) | **149** | **71.6%** | **3.0** |
| `110–129` | 57 | 27.4% | **14.9** |
| `130–149` | 2 | 1.0% | 13.5 |
| `150–169` | 0 | 0% | — |
| `170+` | 0 | 0% | — |

The highest set-peak ever recorded is 132, so the top two bands are **structurally unreachable**. The
low-signal cutoff sits at the p75, so the profile de-emphasises three quarters of its own data. **One
usable bucket.**

The uncomfortable part: the de-emphasis is *right*. `drop_60s` averages 3.0 below 110 against 14.9
above, so the spec's "mostly measurement noise" holds. Re-banding recovers no hidden signal — peak HR
in a lifting set simply does not reach the range where HR recovery is informative. So the proposal is
re-band **and say so**: a four-bucket profile that averages noise looks like it is working, which is
worse than one honest bucket.

Also recorded: `coverage_ok` passes on only 212 of 691 rows (31%), so two thirds are discarded before
banding. Not diagnosed.

## Part 3: the zone boundaries, checked and deliberately not filed

Measured against all stored HR, Zone 1 holds 99.8% of BLE samples and 99.1% of chest-strap samples.
That looks damning and it is the **wrong denominator** — `computeHrZones`/`zoneForBpm` are consumed
only on cardio surfaces, and 99% Zone 1 is the expected answer for a 24-hour population regardless of
where the boundaries sit.

The right denominator does not exist yet: `activity_logs` holds 32 walks, 7 runs, 5 treadmill and 1
cycle over the whole history, newest run 2026-07-24. Fitting five boundaries to ~13 sessions is
fitting noise, so **nothing was filed** — which is the same reason the cardio pillar stays
deprioritised.

Both dead ends are recorded in the review and the baton so the next session does not walk them again.
The all-day measurement in particular is worth flagging, because it produces a number that reads like
a finding and is not one.

<a id="2026-08-18-local-first-write-rule-and-journal-sweep"></a>

# 2026-08-18 — the inverse offline-first rule, and Q-488 handed back with the dead end mapped

Lane B. Docs and one CI baseline; **no application code shipped**, deliberately. No version bump.

## What this set out to do

Take Q-488 — *deleting an activity leaves it in the local store, so three other screens keep showing
it* — which the review sweep had tagged Lane B, scoped to one handler, and described as "one call".

## What actually happened: the fix shape does not exist

`app/health/health-content.tsx` deletes through `fetch("/api/activity-logs", { method: "DELETE" })`
and never touches the local row. That part of the entry is correct. The fix it prescribes is not.

- **`lib/local-store` has no `deleteActivityLog`.** Every hit for that name is
  `repo.deleteActivityLog` — `lib/data/repository.ts:547` and `adapter.ts:2374` — the *server*
  repository, which the route already calls. The local store has `deleteFoodLog`, `deleteInjury`,
  `deleteSupplementLog`, `deleteSavedMealLocally`, `deleteExerciseLogLocally`,
  `deleteWorkoutSessionLocally`. Not this one.
- **`upsertActivityLog` cannot express a delete.** Its INSERT names 27 columns with 27 placeholders
  and its `ON CONFLICT(id) DO UPDATE SET` names 27 assignments; `deleted_at` is in neither
  (`sqlite-backend.ts:2607`). `LocalActivityLog` declares `deletedAt: string | null`, so a caller
  can set it, pass the type check, and be ignored.

A read-merge upsert stamping `deletedAt: now` was written here and reverted before commit. It
compiled, `tsc` passed, and it was a **no-op**: `getActivityLogs` filters `deleted_at IS NULL`
against a column the write never sets. Nothing available in this sandbox would have caught it —
`getLocalStore` returns null in the web runtime, so no spec can exercise the path either. It would
have merged green, been journalled as fixed, and left the bug in place under a struck entry.

That is why the entry was rewritten rather than trimmed to "re-tagged": the dead end reads as
correct in every check that can be run here, so the next session needs the column-list evidence, not
a verdict.

**Re-tagged to Lane A.** The load-bearing half is `lib/local-store/index.ts` +
`lib/local-store/sqlite-backend.ts`, both Lane A's by the ownership list. The Lane B call site is
four lines and is the last step. Splitting it would leave a call to a method that does not exist.

The entry's **audit** still stands untouched: eight other mutating writes to local-first domains
were checked and all eight write locally. This remains the only instance.

## What did ship

**The inverse rule, in `CLAUDE.md`** (Offline-First section, immediately above the forward-direction
rule it inverts). The written rule was *"if a domain WRITES to the local store, its UI MUST READ from
the local store"*. The half that was missing is the one that broke: **a domain the UI reads
local-first must have every write update the local store — deletes included, and including a write
made from a screen that itself reads server-side.** That last clause is the whole reason this hid.
`health-content.tsx` reads the server-assembled `day-log:` aggregate, a sanctioned exception, so the
row vanished instantly on the screen that deleted it while three local-first surfaces kept it.
Nothing on the originating screen could reveal the inconsistency.

**The journal compaction sweep** — third of the day. 61 loose entries, 20 of them unlinked by any
durable doc, folded oldest-first into a new `docs/overview/history-2026-08-18.md` with
`](../../` → `](../` rewritten in each body. A new history file rather than an append because
`history-2026-08-15.md` had reached 300 KB against the ~250 KB rule. 61 → 41, under the 60-file
runaway limit that was **already failing on `main`** and therefore failing Custom Rules on every
open branch.

The README predicted a rising floor: the linked count went 32 → 41 between the first two sweeps. It
did **not** rise on this one — 41 before, 41 after — so the trend is not yet a line, and the README
now says so rather than leaving its own forecast standing unchecked. Headroom is 19 files.

## Baselines raised, with the reasons in the script

- `CLAUDE.md` 1075 → 1077 — the two-line inverse rule.
- `docs/implementation-backlog.md` 9905 → 9924 — the Q-488 evidence and re-tag.

## What was NOT exercised

- **The bug itself is unreproduced and the fix is unwritten.** Nothing here changes app behaviour.
- **No device run.** Not applicable — no runtime code changed.
- The 5-minute staleness floor is still read from `MIN_SYNC_INTERVAL_MS`, not observed.

<a id="2026-08-18-meal-label-ingredient-breakdown"></a>

# 2026-08-18 — Q-393: the ingredient breakdown on the label, and a pitch figure that was wrong

**Branch:** `claude/implementation-lane-b-0o7kb9` · **v1.323.0** · **Lane:** Implementation B

The owner moved this to the top of the queue: *"could we have a small font showing the break down of
the meal i.e Pasta / [macros] / (100g pasta, 200g mince, etc etc)"*. It is a follow-up to Q-389,
which shipped the renderer the day before.

## What shipped

A fifth style, **Square · ingredients**: the per-serving ingredient list — `200g Beef mince`, one
line each, up to five — with calories and macros beside a large code, and the write-on rule beneath.

The entry's measurement decides the shape and it holds: on a **round** 50 mm label the usable box is
130 × 137 and the shipped default already spends all of it, leaving **7 units — zero lines**. A list
cannot go on a round label without taking something off it. The square die gets the corners back
(171 × 171) and the list fits with room to spare.

So the new style is marked **SQUARE** in the picker and carries a standing warning under the preview
that a round die crops the list — which Q-393 explicitly requires rather than letting a round die
silently cut it.

**The ingredients are per serving**, from `savedMealToIngredients`, which goes through
`oneServingItems` exactly as `mealLabelFigures` does. That is deliberate: the weights and the
calories printed beside them describe the same portion. Feeding it the whole recipe would have put a
batch ingredient list next to a per-serving calorie count on a physical tub.

The preview now also reports **how many ingredients actually printed** and how many were summarised
as "scan for the full list". A list that stops at five without saying so is the quiet failure this
feature was most likely to ship.

## The correction, which matters more than the feature

**Every module-pitch figure in Q-389 and Q-393 is ~24% too optimistic.** The renderer draws the
4-module quiet zone *inside* the code box (`cell = codeW / (moduleCount + 8)`), so the pitch actually
printed divides by **33**, not 25:

| style | code | documented (÷25) | **as drawn (÷33)** |
|---|---|---|---|
| band (default) | 12.17 mm | 0.487 mm | **0.369 mm** |
| editorial | 13.23 mm | 0.529 mm | **0.401 mm** |
| ticket | 13.76 mm | 0.550 mm | **0.417 mm** |
| plaque | 15.87 mm | 0.635 mm | **0.481 mm** |
| **square (new)** | 18.52 mm | 0.741 mm | **0.561 mm** |

The app was already displaying the honest number — only the docs were wrong, so nothing shipped
incorrectly. But it makes the still-owed print test **more** important, not less, and it is why the
square style was sized at 70 units: **0.561 mm is the only pitch in the set above the 0.487 that
every one of these figures was assumed to have.**

## What was deliberately not built

**Option 2, the round trimmed list.** At 44 units its true pitch is **0.353 mm** — below every
shipped style, not merely below the "0.487 floor" the entry names. It buys three of five ingredient
lines at 6.5 px in exchange for the least reliable code in the feature, and Q-393's own framing is
that a partial list is what the request was trying to avoid. Left for the owner with a
recommendation against it.

**A stored default.** Q-393 says to build it on whatever Q-392 settles rather than beside it, so the
style stays picked-at-print-time and nothing was persisted.

## Guard

`e2e/meal-label.spec.ts` extended to drive all five styles.

**The first version of the new assertions was not a guard, and mutation-checking caught it.** With
`ingredients: true` removed from the square spec, the style falls through to the *round* painter — so
the canvas still had ink and the square-only warning still showed, and **both new assertions passed**.
That is the Q-259 lesson exactly. The renderer now returns what it drew (`ingredientLines`,
`ingredientOverflow`), the sheet displays it, and the spec asserts on that number — which fails under
the same mutation. The reported count is a real contract, not test scaffolding: it is what tells the
user their list was truncated.

## What was NOT exercised

- **Nothing was printed, and nothing was scanned.** Both remain owed from Q-389 and this change does
  not discharge either. **Print black band first** — it is the default and, at 0.369 mm, the tightest.
- **No square label has been cut.** The square-only claim is geometry, verified in the preview at
  true 50 mm scale, not against a real die.
- **A long ingredient list was not printed** — the overflow path ("+N more") is asserted in the
  preview's reported count, not on paper.
- **The device.** Chromium at 412×915; the new style's 7.5 px ingredient lines are the smallest type
  in the app and want a look on the S25.

<a id="2026-08-18-meal-label-inline-centred"></a>

# 2026-08-18 — Q-397: the label the owner actually asked for, and why it fits a round die

**Branch:** `claude/implementation-lane-b-0o7kb9` · **v1.324.0** · **Lane:** Implementation B

Q-393 shipped yesterday and shipped the wrong design. Not because it was built badly — it was built
faithfully — but because **the entry carried an analysis the owner had already corrected in chat and
nobody wrote back into the queue.** Q-397 filed that, and this is the fix.

The owner spotted it immediately: *"I dont see the option we worked on for everything centered?"*

## The correction, which is a nice piece of reasoning

Q-393's heading says the ingredient list *"does not fit on a round one"*, and its measurement backs
that up: the round usable box is 130 × 137, the default already fills it, **7 units of slack, zero
ingredient lines**. All true — **for a stacked list**.

The owner's suggestion was to run the ingredients as **one wrapping line**. That spends *width*,
which the label has going spare, instead of *height*, which is the one thing the code also needs.
Five ingredients become **three wrapped lines rather than five**, and the height handed back goes to
the code.

So there was never a trade between the list, the round die and a readable code. Inline wrapping buys
all three. The complete list now fits a **round** label with a code **larger than the previous
default's**.

## What shipped

**`inlineCentred` — B2 — is the new `DEFAULT_MEAL_LABEL_STYLE`**, per the owner's decision in Q-397
(*"Yes have B2 as the default"*). Name, calories, macros, the full ingredient run, then the code —
all centred, round-safe.

| | code box | symbol | mm/module |
|---|---|---|---|
| old default (`band`, no list) | 12.2 mm | 9.2 mm | **0.369** |
| **new default (`inlineCentred`, full list)** | 17.5 mm | 13.2 mm | **0.529** |

It is not merely a nicer layout: it prints a **43% larger module** than the style it replaces *and*
carries the breakdown. Leaving it as an opt-in would have made the better default the one you had to
go and find, which is why Q-397 says to change the constant in the same PR.

The stacked square style stays in the picker for anyone who prefers that alignment on square stock,
and every other style is untouched — "keep them all as options" was the owner's ask.

## Guards, and the one that was worth the most

Q-397 asks for the code size to be **asserted**, because *"a number nobody asserts is a number that
drifts"* — and it had already drifted once. `meal-label-code-size.test.ts` now pins every style's
mm/module, and pins the claim the owner's decision rests on: **the default prints a bigger module
than the style it replaced.** If a later layout tweak reverses that, a test fails rather than a print
run.

`wrapIngredientRun` is pure and property-tested: never exceeds its line budget at any width, never
silently drops an ingredient (`shown + overflow === count`), and summarises rather than truncating a
name. One of those properties **found a real bug** in its sibling `fitIngredientLines` — with room
for a single line and two ingredients it drew one ingredient *plus* a "+N more", two lines in a
one-line space.

**The E2E spec now decodes the QR straight off the rendered canvas**, for every layout, using
zxing's pure-JS core in Node — the pixels come out of the page because `@zxing/browser` cannot be
imported into it and needs a DOM anyway. That proves the symbol is complete, unobstructed and
resolves to *this* meal at every style. It is the closest the sandbox can get to the print test.

**And it proved a guard I had written was worthless.** An earlier version of the centred layout ran
its ingredient list into the code. The decode still passed — because `drawCode` paints a white
quiet-zone box before its modules, so an overrun destroys the *ingredient text*, not the code. No
end-to-end check can see that. The arithmetic moved into a pure function with a property test, which
is where it belonged.

## What was NOT exercised

- **Nothing was printed.** Still the one gate that matters and still owed. The new default is more
  forgiving than the old one, which lowers the risk but does not discharge the check.
- **No round die has been cut.** "Round-safe" means every element composes inside the inscribed
  130 × 137 box, verified in the preview at true 50 mm scale — not against real stock.
- **The device.** Chromium at 412×915; the wrapped ingredient run sets at 7 px.
- **The stored default is still not stored** — `DEFAULT_MEAL_LABEL_STYLE` is a constant, and a
  per-user default remains blocked on Q-392, exactly as Q-397 says.

<a id="2026-08-18-memo-scalar-props"></a>

# 2026-08-18 — the meal-plan macro bars memo for real now (Q-490)

Lane B. v1.324.9. Three component files, one new Custom Rules step, one Q filed.

## The defect

`MealMacroBars` and `DayMacroTotals` (`components/nutrition/meal-macro-bars.tsx`) are both wrapped in
`memo(...)`, and neither has ever held. `memo` compares props shallowly; every call site passed a
**fresh object identity**, so the compare failed on every parent render.

`meal-plan-edit-sheet.tsx` holds nine `useState` hooks including per-keystroke handlers
(`onChange={e => setInstruction(e.target.value)}`, `setRenameText`), and `MealMacroBars` renders
inside `variant.meals.map(...)`. **Every keystroke in the rename or instruction field re-rendered
every meal row's macro bars** — precisely what the memo was added to prevent.

## The correction to the finding

The Q-490 entry named `target` as the fresh object. **`actual` is fresh at three of the four sites
too**, so fixing `target` alone would have left three of four still defeated and the sheet still
re-rendering on every keystroke:

```
meal-plan-review-step.tsx:132  dayActual = sumMacroTotals(...)              ← fresh
meal-plan-review-step.tsx:212  m.actual                                     ← stable (the only one)
meal-plan-edit-sheet.tsx:236   dayActual = sumMacroTotals(...)              ← fresh
meal-plan-edit-sheet.tsx:301   actual = sumIngredients(m.ingredients)       ← fresh, inside the map
```

`sumMacroTotals` and `sumIngredients` both return a new object, and both are called in the render
body.

## The fix, and why scalars rather than `useMemo`

Both components now take the eight macro numbers as **scalars**. The entry recommended this for the
per-meal site and the reasoning generalises: `MealMacroBars` renders inside `variant.meals.map(...)`,
where a hook is not allowed, so there is no `useMemo` that can stabilise a per-row object. Scalars
remove the class rather than working around it — a future call site cannot reintroduce it by
accident, because the type is a number.

The compiler named all four call sites the moment the props changed, which is the other half of the
argument for scalars over a custom `areEqual` comparator: a comparator is a hand-maintained equality
that silently stops covering a prop someone adds later.

## The check, and the four sites the audit missed

`scripts/check-memo-prop-stability.js` collects every `memo(...)` component in `app/` + `components/`
(66 of them), finds every JSX call site of one, and fails on an inline `{{…}}`, `{[…]}` or
`{… => …}` in a prop. Shrink-only per-file baseline, same shape as `check-hex-literals.js`.

Run repo-wide it found **six** defeated call sites, not two. The Q-490 review had reported *"No
inline arrows exist anywhere"*; there are four, on four different memoised components, none of them
the two this PR fixed:

```
app/nutrition/nutrition-content.tsx:627        <MealPlanReviewCard>   4 inline arrows
app/nutrition/nutrition-content.tsx:638        <MealPlanSection>      1 inline object
components/nutrition/saved-meals-sheet.tsx:587 <SavedMealCard>        5 inline arrows, inside a .map
components/oura-ble/oura-ble-debug.tsx:704     <LogConsole>           1 inline arrow
```

They are baselined and **filed as Q-357** rather than swept here: `SavedMealCard`'s fix is a callback
contract change (`onLog={quickLog}` with the child calling `onLog(meal)`), which is a different piece
of work from this one. Frozen is the point — nothing new can join them.

Mutation-checked both ways: re-introducing the Q-490 shape at a non-baselined site fails the check,
and fixing a baselined site fails it too until the row is lowered.

`CLAUDE.md`'s parenthetical — *"both long-standing memos in the codebase were defeated exactly this
way"* — is corrected in the same commit. There are 66, and a count from when memoisation was rare
read as discouragement from adding one.

## What was NOT exercised

- **No render counts were measured.** The claim follows from object identity and React's shallow
  compare, not a profiler run — same standing as the review that filed it. What *is* verified is
  that the props are now primitives, which is the property the compare needs.
- **No device run.** JS-only; reaches the APK through a Railway deploy with no rebuild.
- **The edit sheet itself was never driven.** `/nutrition` loads and `/api/nutrition/meal-plans`
  returns a seeded plan (three meals, two with ingredients and one without, so both the bars branch
  and the no-ingredients fallback are reachable) — but two Playwright attempts to open Manage plan →
  Edit meals failed to reach the sheet, the second because `scrollIntoViewIfNeeded` parked the
  button under the fixed bottom nav and the tap navigated to `/workout` instead. Not pursued
  further; the probe was deleted rather than committed half-working.
- **The transposition risk was closed differently.** A scalar refactor can silently swap two numbers
  and still compile, so all **40** prop mappings across the three files were machine-checked: every
  `actualX`/`targetX` prop must read from the matching field. Zero mismatches. That is a weaker
  check than seeing the bars, and it is what was actually done.
- The four baselined sites are untouched and still defeated.

<a id="2026-08-18-model-version-clobber"></a>

# A claim I published this morning was false by lunchtime

**Date:** 2026-08-18 · **Branch:** `tuning/model-version-clobber` · **Agent:** Tuning 🎶
**Type:** docs-only — defect evidence · **Filed as:** Q-518

Found by re-running the session-start production read rather than by looking for it. The stamped-row
count had gone 0 → 1 earlier in the session when the readiness route first ran; on a later read it was
**back to 0**.

## What happened

Same row, `oura_daily_derived` for 2026-08-18, twice in one session:

| read at | `model_versions` | `readiness_score` |
|---|---|---|
| 04:38:27 | `{"bodyComp": "atlas_2_1_0", "readiness": "v3:ri5:2026-08-18"}` | 76 |
| 10:18:40 | `{"bodyComp": "atlas_2_1_0"}` | 77 |

Three rows share `updated_at = 10:18:40`, so one job rewrote them all.

## Why

`upsertOuraDailyDerived` sets every column as `COALESCE(excluded.col, existing.col)`. That is right for
scalars — its comment explains it stops a partial recompute nulling a good value — but for a `jsonb`
column `COALESCE` takes the first non-null **document whole**. It cannot merge.

So the merge is left to each caller, and only one of two does it. `readiness-payload.ts` reads the row
and spreads (`{...existingVersions, readiness}`); the body-composition backfill passes a flat
`{ bodyComp: … }` and replaces. **The readiness code did nothing wrong** — it is the only participant
honouring a convention the shared writer does not enforce.

## The correction

PR #85 reported that the merge *"held in production"*. That was true when I measured it and false five
hours forty minutes later. The verification review now carries a dated correction pointing here.

Worth naming the lesson rather than just the bug: **I verified a merge by observing one write, when
the thing that needed observing was the next write by someone else.** A single positive reading of a
shared mutable field proves the writer, not the invariant.

## The fix, and the one not to make

Move the merge into `upsertOuraDailyDerived` — `existing || excluded` for `model_versions` — so the
guarantee is the function's own. That is the pattern this codebase already chose one column over:
`upsertOuraHeartrate`'s comment says *"this makes the guarantee the function's own, so every caller
gets it rather than each one remembering"*, and **Q-280 exists because two of its siblings missed it**.

Patching the bodyComp caller alone restores today's stamp and leaves the next writer to rediscover the
rule, which is exactly how this happened.

## Not exercised

No code changed, and the proposed `||` expression was **written, not run** — no test, no local DB.
**The job that ran at 10:18:40 was not identified directly**: the bodyComp backfill is the only
`model_versions` writer passing a flat object and its payload matches the surviving document exactly,
but no scheduler or trigger was traced, so its cadence is unknown and "short half-life" is an inference
from one observation. `readiness_score` also moved 76 → 77 between the reads and that is **not
explained** — it doesn't affect the finding, which rests on the missing key.

<a id="2026-08-18-nutrition-tdee-calibration"></a>

# The TDEE check found the module already doing it, and a floor set 52 kcal too low

**Date:** 2026-08-18 · **Branch:** `tuning/nutrition-tdee-check` · **Agent:** Tuning 🎶
**Type:** docs-only — calibration evidence · **Filed as:** Q-517

The nutrition pillar's last open item was whether the calorie target tracks the owner's observed
weight change. `adaptive-tdee.ts` already runs exactly that calculation, and its header already warns
that an ungated version *"would tell the user their maintenance is 1200 kcal — actively harmful
advice"*. So the real question became: do the gates it added actually hold?

## The input condition

The food log captures about **50%** of what the owner eats. 44 logged days of 110, mean **1,223
kcal**, 43% of logged days under 1,200, 4.8 entries per day. Against 75 weigh-ins showing a slope of
+8 g/day — an energy balance of **+62 kcal/day** — and a Cunningham BMR of **1,547** giving a
predicted TDEE of **2,397**, implied actual intake is **~2,459**.

Taking the log at face value implies a maintenance of **1,161 kcal, below the owner's own BMR of 1,547**. That
is not a slow metabolism; it is arithmetic proof of under-logging. **Nothing is filed for it** —
people log partially, and that is the condition everything else has to survive.

## The gates hold 75% of the time

Replaying every rolling window: 72 of 97 fourteen-day windows are correctly refused on coverage or
span, 2 more on plausibility, and **23 (24%) pass — with values from 1,052 to 2,219**.

Two things stand out. **`MIN_PLAUSIBLE_MAINTENANCE = 1000` sits just below the artefact**: this
owner's lands at **1,052**, clearing the floor by 52 kcal. The module's own comment predicted the
failure at 1,200 and the floor was set 200 below that prediction, so the real value slipped between
them. And the passing values span **1,167 kcal** for the same person within weeks — unstable even
where not harmful.

**Why the coverage gates cannot catch it:** `MIN_LOGGED_FRACTION` counts days that *carry* a log, not
whether each day's log is *complete*. A day with breakfast and nothing else counts as fully logged.
So a 45%-complete record passes a 70%-coverage gate. The gates measure the wrong kind of
incompleteness.

This reaches the user: `TdeeAdaptationCard` writes the accepted value through the endpoint its own
docstring calls the source of truth for the daily calorie target.

## The fix, and what it does not fix

Replace the universal 1,000 floor with **the user's own BMR**. Maintenance below BMR is impossible by
definition rather than implausible by taste, and `cunninghamBmr` is already imported in the same
package. Measured: 14-day passing windows 23 → **13**, range tightening to **1,592–2,219**; 28-day
22 → **13**, range **1,565–1,889**. Every harmful value blocked.

**It makes the estimate safe, not correct.** The survivors still sit ~500 kcal under the formula's
2,397 — residual under-logging showing through — and that should not be described as a fix for
accuracy.

Two tempting wrong turns, both recorded: **raising `MIN_LOGGED_FRACTION`** drops good windows while
keeping bad ones, because the gate structurally cannot see within-day incompleteness; and **scaling
logged intake up** by a multiplier inferred from the weight trend is circular, since maintenance is
derived from that same trend — it would reproduce the assumed TDEE and present it as a measurement.

## Not exercised

No code changed. The replay is a faithful port of the gates but **could not be validated against
stored output — no maintenance estimate is persisted**, the same limitation as the ACWR and RPE
replays. `linearFit` was re-implemented as plain least squares; the gate outcomes are dominated by
coverage counts, which don't depend on it. `activity_level: moderate` is taken from the profile as-is
— if the owner is more active, the under-logging is worse than 45%, not better. Accuracy of individual
`food_items.calories` values was not checked.

Also recorded, not filed: **`tdeeAdjustment` is dead code**, referenced only by its tests and by the
comment explaining it was replaced. Same trap as `amrapScaleFactor` in Q-514.

## Corrected 2026-08-19

Every BMR-derived figure above was first published from the **textbook** Cunningham equation
(`500 + 22 × LBM`), taken from memory. The app uses `cunninghamBmr = ffm × 21.6 + 370`
(`body-composition.ts`), deliberately matched to Oura's `atlas` postprocessor and shared with the
nutrition-goal baseline — so the published BMR was **152 kcal too high**, and that propagated into the
TDEE, the under-logging percentage and the floor test.

**The conclusion is unchanged**: the log-implied maintenance of 1,161 is still below BMR, so
under-logging is still proven, and the BMR floor still blocks every harmful value. Only the magnitudes
moved.

The lesson is the repo's own: *verify against the pinned source, not memory*. That rule is written
about external API field names, and it applies just as directly to a formula the codebase defines.

<a id="2026-08-18-readiness-range-refuted"></a>

## 2026-08-18 — Readiness should NOT get a range calibration (Tuning; Q-504 refuted)

Follows the Sleep recalibration (v1.319.0) in the owner's range-tuning pass. Q-504 said readiness had
the same problem and the same fix was measured and ready. **It was implemented, and it is wrong.**
Evidence: [`docs/reviews/2026-08-18-readiness-range-refuted.md`](../reviews/2026-08-18-readiness-range-refuted.md).

**The calibration produced the target distribution** (mean 66.8, sd 19.1, range 17–99) and then the
suite failed on 7 tests across 4 files. Three encode invariants the composite genuinely holds:
**contributions must sum to the displayed score** (the score-audit panel's entire job — it gave 70
against 67), **all-neutral input must give exactly 50** (it gave 35), and **skipping the check-in must
cap below 100** (it reached 100). The first is disqualifying on its own: readiness drives every
training recommendation, and the owner's difficulty throughout this thread was *seeing what a change
does* — shipping a score whose explanation no longer adds up makes that permanently worse. Reverted,
not rewritten.

**The in-model lever fails too.** `Z_POINTS_PER_UNIT` would widen spread while preserving all three
invariants, but the z-based contributors are already wide and already saturating: `hrvBalance` sd
**27.1** with median implied |z| **1.26** against a 1.5 ceiling, `sleepBalance` sd **32.3**, both
hitting the 0 and 100 rails. Raising the slope compresses the ends.

**There is no compression bug.** Contributors carry sd 17–32; the composite sd ~11–13, against **7.7**
predicted if they were independent — so readiness already extracts more spread than independence
gives. Against the owner's test it is the healthiest of the three pillars (range 29–87, sd 13, with
genuinely low days), unlike Sleep's 27-of-35 above 85.

**Its real weakness is the ceiling** — 1 of 34 days ≥85 — and the term dragging it down is
`recoveryIndex`, **mean 35.3**, lowest of the nine by 20 points. That is **Q-500**, which this session
had demoted to "lower priority". Corrected: Q-500 *is* the readiness fix.

**Shipped:** the readiness `model_version` stamp (Q-273's readiness half), merged into the shared
`model_versions` JSONB rather than replacing it so `bodyBattery`'s stamp survives. Sleep shipped
without one and left an unmarked trend step; readiness will not repeat that.

**Verification.** Full suite **3,352 passed**; `check:rules` 38/38; typecheck clean. No version bump —
nothing user-visible changed and readiness scores are unchanged by this PR (they do move ~1.8 points
on their own from v1.319.0's sleep change feeding `previousNight`).

**Not exercised.** Nothing on-device. n=26–34 days; seven of 33 could not be reconstructed exactly
(they predate the `checkin` contributor or hit the Q-501 drift). The implied-|z| figures are
back-derived through the current slope and inherit any error in the stored contributor values.

<a id="2026-08-18-rpe-autoregulation-calibration"></a>

# Two thirds of the engine's load cuts were an artefact of a clamp

**Date:** 2026-08-18 · **Branch:** `tuning/acwr-calibration` · **Agent:** Tuning 🎶
**Type:** docs-only — calibration evidence · **Filed as:** Q-514

Second review of the workouts pillar, after ACWR. `RPE_DEAD_BAND` drives real load changes and had
never been checked against the owner's logged RPE.

## The aggregate looked fine, and that hid it

Over 570 sets carrying both an RPE and an `intensity_pct`, the mean delta between reported and
expected RPE is **−0.19**. On that number `expectedRpe` looks calibrated.

It is not. Two populations pull opposite ways, and the split is the clamp.

`expectedRpe` clamps to the 5–10 slider range. The **ceiling never binds** — raw expected tops out at
exactly 10.0, zero sets clamped. The **floor binds on 37 of 570 sets**, hiding raw values as low as
**−10.4**. Those are not warm-ups: 50–67% of 1RM at 7–13 reps, ordinary accessory work. At 54% the
formula puts reps-to-failure near 19, so a 10-rep set has ~9 in reserve and a true expected RPE near
0.6. The model can only say 5. The owner reports 6.9.

Floor-clamped sets carry a mean delta of **+1.89**. Everything else carries **−0.34**. A 2.2-point
offset, pointing exactly where the back-off arm reads "RPE ran high".

## What it cost

Replaying the shipped grouping — per exercise, trailing 3 sessions, ≥3 sets, threshold 1.5 — across
377 windows:

| | shipped | excluding floor-clamped |
|---|---|---|
| back-off (≥ +1.5) | **39 (10.3%)** | **14 (4.1%)** |
| push (≤ −1.5) | 27 (7.2%) | **27 (7.9%)** |

**25 of 39 back-off triggers vanish — 64% — while the push arm is untouched.** That asymmetry is the
whole argument: a blunt de-sensitisation would move both arms. Each trigger is a 5–10% load cut, so
the engine has been cutting load on accessory work because the model could not express how easy the
set was supposed to feel, then read the gap as the lifter struggling.

## The dead band is fine and must not move

Sensitivity: 1.25 → 20.7%, **1.5 → 17.5%**, 2.0 → 14.9%. It sits on a flat part of the curve and the
delta distribution is centred. Raising it to suppress the artefact would also suppress the 14 genuine
back-offs.

**That is the third time today the answer has been "the threshold is right, the input is wrong"** —
the illness radar, ACWR, and now this. It is worth stating as a habit rather than three coincidences:
check the input's distribution before touching a constant.

## The fix, and the fix not to make

Exclude sets whose **raw, pre-clamp** expected RPE falls outside the slider range. They carry no
information — the model cannot state its expectation, so the gap to what was reported measures
nothing. That matches what the codebase already does elsewhere, passing `null` rather than fabricating
a neutral value.

**Do not widen the clamp** to allow expected RPEs below 5. An expectation of 0.6 against an owner who
never reports below 6 gives a delta of +6.3 — worse. The set is unrepresentable either way; the fix is
to not let it vote.

## Not exercised

No code changed. The replay is a faithful port but **could not be validated against a stored value —
no RPE delta is persisted anywhere**, the same limitation as the ACWR replay. **The back-off arm needs
a second signal (a falling 1RM or missed reps) that this review does not model**, so 39 and 14 count
windows clearing the *RPE* gate, not cuts actually issued — the true numbers are lower and **the 64%
ratio is the finding, not the absolute counts**. Only sets carrying both an RPE and an `intensity_pct`
are visible, 570 of 1,029. Nothing on-device, and no owner-reported symptom prompted this.

## Recorded, not filed

`calcAmrap1RM` and `amrapScaleFactor` — the 1.0/0.97/0.93/0.88/0.82 rep-band table — have **no
production call site**; they appear only in tests. They were on this review's list as hand-tuned
constants worth validating, and calibrating a function nothing calls would be wasted. Whether the
table is correct is unknown and unimportant while it is unreachable.

## Also measured, and clean: Foster monotony

`HIGH_MONOTONY = 2.0` softens a prescribed hard run when the week's load has been too samey. Over 102
rolling 7-day windows the owner's monotony reads mean **1.29**, median 1.34, sd 0.31, range 0.41–2.32,
and crosses 2.0 on **one window (1.0%)** — the right rate for a risk flag. Nothing to change.

Worth recording *why* it works: `assemble-plan-context` seeds all seven days at zero before adding
session volume, so rest days count toward the standard deviation. That is the correct Foster
definition, and it is what makes the 2.0 threshold meaningful — computing monotony over training days
only would roughly halve the SD and push most weeks over the line. Do not "optimise" that seeding away.

## A measurement I abandoned

I tried to strengthen the accessory argument by grouping sets on `session_exercises.exercise_role`.
Exercise names map to **more than one role** across programs — `Barbell Shrug` is both accessory and
secondary, and twenty-odd others are similarly split — so a name-based join fans out and its per-role
means are unsound. The 6.89-vs-7.5 comparison in the review needs no role attribution, so it is stated
without one.

## Sizing the finding honestly

The 64% is a ratio over windows clearing the **RPE gate**. A load cut also needs a falling 1RM or
missed reps — and the owner is short of the prescribed reps on only **14 of 196 sets (7.1%)**, exact on
75%, over on 17.9%. So `missedReps` is rarely the corroborator and most back-offs must come through a
falling 1RM.

**Read the two together: the number of cuts actually issued is well below 39, and the number the fix
prevents is well below 25.** The defect is real and one-directional, but "64% of back-off *triggers*"
is not "64% of load cuts on your training", and this review cannot size the absolute impact without
modelling `rm1Trend`, which it does not.

## Also clean: prescription adherence

Over the 275 sets carrying a `planned_pct`, actual intensity averages **73.6%** against a planned
**73.1%** (delta −0.47), and reps land **+0.25** over target. The owner follows the prescription
closely.

That is why `INTENSITY_ZONES` was deliberately **not** calibrated. Those zones are prescriptive
textbook periodisation and the program was generated from them, so checking them against the work they
produced would be circular. **Adherence is the non-circular question, and it is clean** — the zones are
being realised, not merely written.

<a id="2026-08-18-running-explain-cache"></a>

# 2026-08-18 — Q-469: the prescribed run was re-described on every visit

**Branch:** `claude/implementation-lane-b-0o7kb9` · **v1.324.3** · **Lane:** Implementation B

`components/running/prescribed-run-card.tsx` asked `/api/running-plan/explain` for a warmer
restatement of the run's deterministic rationale from a bare `useEffect` with no cache. Measured in
the AI double-trip sweep: **31 redundant calls across 9 distinct runs** — the same run explained
about seven times.

The author had already handled the obvious re-fire: `gateReasons` is joined into a stable string so
a new array ref does not re-trigger the effect. **Mount was the remaining trigger**, and every
navigation back to the running screen is a mount.

## Why it was worth fixing, given the call is cheap

It is — 62 calls, 6,864 tokens, and explicitly never load-bearing (the deterministic `rationale`
paints immediately; the AI copy only swaps in if it arrives). **The reason is content consistency:**
the model rewords the sentence each time, so the same prescribed run was described differently on
every visit. That is the part a user notices.

## What shipped

A cache keyed on everything that can change the sentence — the local date plus the prescription
fingerprint (`type`, `durationMin`, `rationale`, the gate reasons). `readCacheSync` first, and only
a real answer is written back: a `degraded` response is the deterministic text wearing an AI hat,
and caching that would pin the fallback for the whole TTL.

`RUNNING_PLAN_EXPLAIN_TTL` is `TTL_LONG`, declared once in `packages/shared/src/cache-ttl.ts` per
the one-canonical-TTL-per-key rule. Expiry is a backstop rather than the freshness mechanism — the
key already carries everything that matters, so a long TTL is the honest choice.

Seeded in an effect, not a `useState` initializer: a cache read in an initializer is what caused the
hydration mismatches this repo already fixed once.

## Guard

`runningPlanExplainCacheKey` is a pure function in its own `.ts` module, unit-tested on the property
that actually matters: **the key changes exactly when the sentence should.** Too loose and a stale
sentence outlives its prescription; too tight and the redundant calls come straight back. Eight
tests — stable for an unchanged prescription, distinct for each of date / type / duration / gate
reasons / rationale, day-scoped, and a missing duration distinguished from a zero one.

**Mutation-checked**: dropping the date and rationale from the key fails three of them.

**It is a `.ts` module rather than an export from the card, and that is not cosmetic** — the unit
project runs in `node` and cannot parse JSX, so anything exported from a `.tsx` cannot be imported by
a test at all. Worth knowing before trying to test a helper that lives in a component file.

## What was NOT exercised

- **No E2E.** The seed has **zero** running plans, so the card is unreachable from the harness
  without seeding a plan and its prescription — a table chain out of proportion to a caching change.
  The key is where the correctness lives and it is unit-tested; the "no second fetch" behaviour is a
  direct consequence of `readCacheSync` returning a hit.
- **The redundancy was not re-measured after the fix.** The 31-across-9 figure is from the sweep's
  production data; confirming the drop needs another production read, not a local run.
- **The device.** Chromium only; nothing here is native, but the cache layer is the one that behaves
  differently on the APK (native SQLite rather than the web fallback).

<a id="2026-08-18-saved-meal-printable-label"></a>

# 2026-08-18 — Q-389 built: printable saved-meal labels, scannable back into the app

**Branch:** `claude/implementation-lane-b-0o7kb9` · **v1.320.0** · **Lane:** Implementation B

PR 2 of Q-389's two-PR split — [the plan](../superpowers/plans/2026-08-17-saved-meal-printable-label.md)
landed yesterday, this is the implementation. Q-389's queue entry is removed; what it still owes is a
`projectOverview.md` Known-Issues row, because both remaining checks are physical.

## What shipped

A saved meal now has a code button that opens a preview of a 50 × 50 mm label — name, calories,
per-serving macros, a bare rule to write the date on, and a QR — in the four styles the owner chose,
switchable, with black band the default. **Share or save** hands the PNG to the system share sheet.
Scanning that code in the existing food scanner resolves the meal and logs one serving.

| Piece | Where |
|---|---|
| Payload codec + label figures | `packages/shared/src/nutrition/label-payload.ts` |
| Renderer (canvas, four styles) | `components/nutrition/meal-label-render.ts` |
| Preview + share sheet | `components/nutrition/meal-label-sheet.tsx` |
| Scan branch | `capture-step.tsx` → `food-logger-sheet.tsx` |
| Fonts (Archivo, Instrument Serif) | `app/layout.tsx` via `next/font` |

## Five decisions, and why

**Canvas, not SVG → PNG.** Fonts referenced inside an SVG loaded as an `<img>` do not resolve — the
browser rasterises it with no access to document fonts, so every style would silently fall back and
this layout has no slack to absorb the metric change. `ctx.fillText` uses the real faces, which is
what makes the `next/font` self-hosting actually do anything.

**Web Share, not a Capacitor plugin.** `@capacitor/share` would have meant a new APK.
`navigator.share({files})` reaches the system sheet — which is where a print app lives — and needs no
native code at all; `<a download>` is the browser fallback so the label is reachable in `pnpm dev`.

**Style is picked at print time and not stored.** The spec left this open with three options, one of
which (a per-meal column) is a migration and therefore Lane A's. Picked-at-print-time needs neither a
schema change nor a settings surface, and the renderer takes the style as a parameter either way — so
persisting it later is an addition, not a rewrite.

**EC level M, and the payload is the bare id.** Measured against the real encoder rather than
assumed: the 22-char token is version 2 (25×25) at both L and M; a canonical UUID is version 3. **One
correction to my own plan** — it said a `ta:` prefix would push it to v3, and that is wrong: at 25
chars it still fits v2/M. Only a URL forces v3. The budget is 26 bytes, the token is 22, so there are
four bytes of headroom and the design still cannot carry anything meaningful. A unit test asserts the
length against the budget so a later "let's also put the name in" fails in CI rather than on paper.

**Ink on paper, never a theme token.** The one surface in the app that deliberately does not use
`--accent-*`, with a comment saying so, and previewed on a white ground in both themes.

## Three things found by building rather than reading

**1. The canvas was in the DOM and never drawn.** `SheetContent` mounts into a portal, so on the
render where `open` flips true the draw effect fires *before* the canvas exists; a plain `useRef`
read null and the effect returned early. Fixed with a state-backed callback ref. **The E2E spec found
this** — the sheet opened, the canvas was in the accessibility tree, and nothing was ever painted.
Reading the code would not have shown it.

**2. A `<canvas>` has no implicit ARIA role.** An `aria-label` on it alone is not exposed at all — the
element simply does not appear in the accessibility tree. `role="img"` is what makes it
announceable, and it was also the only way the spec could find it.

**3. The Nutrition action row still swallows mouse clicks.** The spec's first attempts failed
because `.click()` on that screen does nothing — Q-354, diagnosed earlier and parked. The baton's
"first suspect when a click silently does nothing" note is what shortened this to one round. The spec
uses `touchscreen.tap()`, which is the more faithful test anyway.

## Guards

- **Unit** (`label-payload.test.ts`, 13 tests): round-trips including all-zero and all-`f` ids;
  `decode` returns null for EAN-13, UPC-A, wrong length, wrong alphabet, a URL; the token stays
  inside the v2/EC-M byte budget. And **the assertion this feature exists to keep true** — the label's
  figures are compared against a sum of what `logMealItems` would actually log, in one test, for
  1, 1.5, 2 and 0 servings. Checking them separately would pass even if they had drifted apart.
- **E2E** (`meal-label.spec.ts`): seeds a 2-serving meal, opens the sheet, and asserts each of the
  four styles actually **paints ink onto the canvas** — sampling pixels, not just checking the sheet
  opened. **Mutation-checked**: with the painting removed but the metrics still returned, it fails.
- Full suite: **484 files / 3,940 tests**, 24 E2E, `check:rules` **38 of 38**, build clean.
- `saved-meals-sheet.tsx` hit the 800-line ceiling, so `BulkDeleteConfirm` was **extracted** rather
  than the limit raised — and its two red hex literals became the `destructive` token on the way, so
  the hex ratchet went **down** (471 → 469) instead of needing a raise.

## What was NOT exercised

- **Nothing was printed.** The whole physical half is untested: the code is **0.49–0.66 mm per
  module** and ink spread merging fine modules is the expected failure — which presents as "the
  scanner doesn't work", not as a print problem. **Print black band first**; it is the default and
  the tightest, so if it scans the others do.
- **The camera scan path has never run.** QR decoding goes through the Capacitor plugin, inert in the
  sandbox. The decode, lookup and logging are unit-tested; the camera is not.
- **The share path is device-unverified.** `navigator.share({files})` is checked with `canShare`
  first, but whether the S25's WebView offers a print target is unknown.
- **Fonts were not visually checked on device.** Archivo and Instrument Serif are new to the app.

<a id="2026-08-18-sleep-score-range-recalibration"></a>

## 2026-08-18 — Sleep Score recalibrated to use its range (Tuning, v1.319.0)

Owner-directed: *"free reign to continue changing this until it makes more realistic values — this
should be determined by days getting close to full and some days being low."* The acceptance test is
a distribution, not a day. Full evidence:
[`docs/reviews/2026-08-18-sleep-score-range-recalibration.md`](../reviews/2026-08-18-sleep-score-range-recalibration.md).

**The problem, measured.** Sleep averaged 87.4 with **27 of 35 days ≥ 85** and **no night between 40
and 69**. Eight of ten contributors averaged ~90; only `deep` discriminated.

**Two real defects.** Scoring exactly your own HRV/HR baseline returned **90** and **86** — a
self-referencing term whose median input scores 90 cannot separate anything. And the REM ceiling sat
at 2.2 h with 1.8 h scoring 97, against an owner median of **1.86 h**.

**The structural cause, and the transferable lesson.** Re-shaping all nine curves moved the mean
84.1 → 73.6 and left spread almost unchanged (**sd 15.9 → 14.9**): the blend averages ten
contributors, so its spread shrinks by ~1/√10. Its interquartile range was **6 points**. So the fix
splits: *contributor curves decide the ranking; a calibration on the blend decides the range.*

**Shipped.** Nine curves re-anchored on the owner's measured percentiles, plus `SCORE_CALIBRATION`
on the blend. Over the same 65 nights, run through the shipped TypeScript: **mean 69.5, sd 16.6,
range 32–99, 7 nights ≥ 90, 8 below 50, every band populated.** Ordering checks out — 9.17 h at 95 %
tops it at 99, a 7 h night at 81 % efficiency lands at 33.

**A threshold rule came out of it.** `LOW_SLEEP_SCORE` was tuned against the compressed score (fired
4/65, 6 %). Left at 60 it would fire 17/65 (26 %) — three times the nagging for no physiological
reason. Re-anchored to **42**. A threshold on a display scale is calibrated to that scale's
distribution; re-anchor every one in the same PR as a range change, preserving the firing *rate*.

**Verification.** Full suite 3,345 passed; `check:rules` 38/38; typecheck clean. The distribution was
produced by importing the shipped `computeSleepScoreSeries`, not the design harness. Four tests
changed, each with its reason recorded — three because a 2.0 h-REM fixture is no longer maximal, one
because "old baseline pins at exactly 100" was a curve artifact and now asserts the relation instead.

**Readiness and Activity: analysed, NOT shipped.** Readiness has the identical problem (IQR 11 points,
nothing above 87) and the same fix gives mean 66.8 / sd 19.3 / range 15–99. It is held because it
feeds **five** action thresholds and moves 12 of 26 days across at least one — early-deload firing
would quadruple. Those need re-anchoring across `readiness`/`workouts`/AI periodization first.
Activity (sd 7.3) is untouched — Q-277.

**Not exercised.** Nothing on-device. **Historical rows keep their old scores until re-read, so the
trend chart shows a step at the changeover — and sleep stamps no `model_version` (Q-273), so nothing
marks where.** The calibration is fitted to one sleeper. Noise is amplified in the steep middle.

<a id="2026-08-18-stress-resilience-calibration"></a>

# The last two un-calibrated scores: a threshold pointing backwards, and a score with one value

**Date:** 2026-08-18 · **Branch:** `tuning/stress-resilience-calibration` · **Agent:** Tuning 🎶
**Type:** docs-only — calibration evidence · **Filed as:** Q-507, Q-508

Daytime stress and resilience were the last two scores in the app with no calibration review. Picked
under the owner's instruction to take **only tuning work no other lane holds**.

Both are vendored ports pinned to golden vectors, and both say plainly that their algorithms are not
to be touched. So this measured the two things that *are* ours: the hand-tuned constant sitting on
top of daytime stress, and the inputs we feed the resilience model.

## The stress threshold fires at a sensible rate on the wrong days

`STRESS_HIGH_DAY_THRESHOLD_MIN = 120` raises a stress override that eases the day's prescribed
session. It fires on **4 of 25 days (16%)** — a rate nothing about invites changing.

Those four days average readiness **79.0**; the twenty-one quiet days average **65.0**. The
correlation between high-stress minutes and readiness is **+0.400** — the wrong sign for the decision
it drives. The two genuinely bad days in the set (readiness 37 with a sleep score of 31, and
readiness 29) carry 0 and 30 minutes and never fire.

Exercise does not explain it (19 of 25 are workout days, spread evenly). Wear coverage explains part
of it — high-stress and high-*recovery* minutes correlate +0.304, and both zero-days are zero on both
— but not all: net stress still correlates +0.379 with readiness.

**So the threshold was not touched.** Same shape as Q-506 and the inverse failure: there a constant
sat on a dead input, here on a live one pointing backwards. Moving it would change which good days
get eased, not whether the right ones do.

One thing worth carrying: `STRESS_BUCKET_MS` is 30 minutes, so the value can only ever be a multiple
of 30 and the threshold has **seven** meaningful positions. 120 sits exactly on an atom — `>= 121`
would halve the firing rate. A constant in minutes over 30-minute data is a precision illusion.

## Resilience has emitted exactly one value, ever

Level **5** and granular **5.99** on all 13 rows that have one. 5.99 is the clamp bound — the value
`findGranularResilienceLevel` returns when the computation runs off the top of the scale.

The golden vector produces level **1.0** / granular **1.01**, so the port spans the range and the
pinning is input-driven. The mechanism is that `longTermSleepRecovery` is a **sum** over the window
where its two siblings are weighted means — it replicates a `[N,1] × [N]` broadcast from the `.pt`.
Verified exactly against the golden: `13 × 0.6 + 29.99013 = 37.79013`, which is `out_7` to every
stored digit. Solving the golden's outputs for the recovery weights gives 0.30 / **0.70**, so that
summed term carries most of `longTermRecovery`. Our per-day indices run 0–55.6, so a window sum lands
near 130–240 against the golden's 37.79 — above every band boundary, every day.

**The golden cannot catch this**, and that is the lesson worth keeping: its list is 13 *identical*
values of 0.6, two orders of magnitude below production. A golden proves a port computes the same
function; it says nothing about whether the inputs are on the scale it was captured at.

It is dormant too: 13 rows on 2026-08-05 and the same 13 today, newest dated 2026-08-05, while
daytime stress grew 11 → 25 over the same stretch. The daily-index gate is the likely cause (12 of 96
rows carry one, in clusters) but that was **not confirmed** — `/api/admin/db-query` began returning
`Forbidden` to every query, trivial ones included, before the per-gate coverage could be pulled.

## Deliberately not done

Neither constant was changed and no algorithm was touched. Whether the sum is faithful to the vendor
or a porting bug **cannot be settled in this repository** — the vendor source is in the private
archive — and that decision gates the fix, so it is stated as the first action rather than guessed.
The odd behaviour of `resilience_daily_sleep_recovery` (sleep score 93 → 0.0, while 31 → 17.3) is
recorded as an observation with a suspect, not as a diagnosis.

## Not exercised

Nothing on-device; no code changed. The resilience model was **not replayed** against production
inputs — the 130–240 figure is arithmetic from stored indices and golden-inferred weights, and the
private constants needed to run it are not in the sandbox. The stress finding is **n = 25**, where an
r of +0.40 sits near the conventional significance boundary; the group means are the durable part.
All 13 resilience rows predate the sleep recalibration, which feeds this model — so it must be
re-measured once Q-501's stored-row problem clears. Every figure is the owner's (`claude_ro` is
row-scoped).

<a id="2026-08-18-training-load-day-flag-inline"></a>

# 2026-08-18 — Q-390: the deload flag was lifting its day's bar off the baseline

**Branch:** `claude/implementation-lane-b-0o7kb9` · **v1.321.2** · **Lane:** Implementation B

## What the owner asked for, and what was actually wrong

*"look at the format; reccomend doing Mon (D) instead so it fits better."* — a formatting
preference. The entry had already traced it to something worse, and the trace holds: the flag was a
**sibling** of the day label inside a column flex, so it became an extra **row**, and since the bar
row is `items-end`, a taller column pushes its bar **up**.

The consequence is not cosmetic. On a chart whose only purpose is comparing days against each
other, a flagged day and an unflagged day **with identical volume drew at different heights** — and
the same overflow is what made the tallest bar collide with the "TRAINING LOAD" heading.

**Measured, not asserted:** with the extra row present the two bars sit **exactly 12 px** apart,
which is the figure the entry derived from the box model. The fix brings that to 0.

## What shipped

One file, `components/stats/weekly-stats-hub.tsx`:

- The flag is **inline in the label span** — `Mon (D)` — so no extra row exists and every column is
  the same height. It keeps its colour as a nested span, so the letter *and* the amber/purple
  survive; the glyph is the non-colour channel the colour-only-state rule needs.
- The bar row went from `h-14` to `min-h-[72px]`. The entry's third point was right and worth
  doing: the columns were **already** taller than 56 px with no flag at all (52 bar + 4 gap + ~13.5
  label ≈ 69.5), so they overflowed upward regardless. Inlining removes the *difference* between
  columns; this removes the *overflow*, which is what was hitting the heading. `min-h` rather than a
  fixed height keeps the row stable across weeks without re-introducing a ceiling.

## One correction to the entry

Its point 2 says *"Both flags can be true at once — the two `&&` blocks are independent, so a day can
render `D` and `T` together"*, and treats the combined form as a decision to make. **At the data
level they are mutually exclusive.** `classifyDay` computes

```ts
const isTesting = daySessions.some(isTestingSession)
const isDeload  = !isTesting && daySessions.length > 0 && daySessions.every(isDeloadSession)
```

— and carries a comment saying testing is decided first *deliberately*, "so each day gets its own
marker". So `(D·T)` cannot arise from the current producer.

**The combined form is implemented anyway**, and that is not the "error handling for scenarios that
cannot happen" the repo warns against: this component receives two independent booleans as props,
and making its rendering total over its own inputs is cheaper than depending on an invariant
enforced in an API route two layers away. `Mon (D·T)` is 9 characters in a ~51 dp column, which fits.

## Guard

`e2e/training-load-day-flags.spec.ts` seeds two days in the visible week with **the same volume**,
one `phase_type='deload'` and one plain, and asserts their bar **top edges land at the same y** —
the exact confirmation the entry asked for. It asserts geometry, not markup, because the geometry is
the defect; "the label contains (D)" would pass with the bug reintroduced in any other shape.

**Mutation-checked twice, and the second one mattered.** Reverting to sibling spans fails it — but
only on the *label* assertion, the weaker half. Re-checked with a geometry-only mutation (label left
inline so `(D)` still matches, one empty sibling span added back): the bars moved **12 px** apart and
it failed on the baseline assertion. Writing the first mutation also exposed a real weakness in the
probe — it read the label from `lastElementChild`, which is only the label while the layout is
correct, so it was blind to the very regression it existed to catch. It now reads the column's text.

## The spec took three CI rounds, and the reason is worth carrying

It passed locally and failed in CI twice. Both causes were in the *seeding*, not the fix:

1. **Future days are discarded.** `app/api/weekly-stats/route.ts` renders `isFuture ? [] : …`, so a
   session dated after today draws an empty 6 px sliver. The spec had seeded "tomorrow".
2. **`seed.sql` fills days relative to when it runs**, so a fresh CI database always has a session on
   the current week's Monday — and `isDeload` is `every(isDeloadSession)`, so that one ordinary
   session removes the "(D)" the assertions hang off. A months-old local database has a completely
   different set of days occupied, which is why local never showed it.

Together those leave very little room: on a Tuesday there are exactly two elapsed days and one is
already seeded. The spec now takes the *unseeded* elapsed day as the flagged one and uses the other
elapsed day as the control **whatever is already on it** — reading that day's existing volume and
matching it, rather than needing a free day or deleting a seeded row.

**What actually settled it was reproducing CI's database locally** (`createdb`, `migrate.js`,
`seed.sql`) rather than reading the job log — the log tail is filled by the Postgres container dump
and never showed the Playwright output. That reproduction is three commands and is worth reaching for
first next time.

## What was NOT exercised

- **The device.** Chromium at 412×915. The entry says browser-reproducible at the S25 viewport with
  no native path and no production data, and that is how it was verified — but a 9 px label with a
  nested coloured letter is worth a glance on the real panel.
- **A testing week.** `T` and `(D·T)` were never rendered against real data, because no seeded
  session carries `phase_type='testing'`. The deload path is the one under test.
- **Light theme.** The amber/purple flag colours are pre-existing palette classes and were not
  re-checked in light mode; this change did not alter them.

<a id="2026-08-18-tz-aware-cache-guards"></a>

# 2026-08-18 — the two cache today-guards now take the user's timezone (Q-478)

Lane B. v1.324.8. Seven files, nine call sites, one new Custom Rules step.

## The defect

`isBodyMetadataFresh` and `isWorkoutDataToday` (`lib/sqlite/cache.ts`) compare a date the **server**
stamped in the user's timezone against a date the **client** computed with bare `todayInTz()` —
which is `DEFAULT_TZ`, Brisbane. Two zones Δ hours apart hold different calendar dates for |Δ| hours
out of 24, so for a New York user (Δ=14 in summer) both guards returned false **fourteen hours a
day**, on data that was current.

Measured against a live `/api/body-metadata` response, with the seeded user's timezone set to a
fixed-offset zone chosen to be on a different calendar day than Brisbane at that moment:

```
planted body_metrics row : 2026-08-18, steps 7777   (the user's true today)
server stamped today.date: 2026-08-18
todayInTz()              : 2026-08-19  -> guard says fresh?  false
todayInTz(userTz)        : 2026-08-18  -> guard says fresh?  true
```

The row was in the response the whole time. The guard threw it away.

Downstream of that false: the Health screen leaves today's metrics and active energy blank;
`workout-screen` rewrites every exercise to `loggedTodayInSession: false`, so sets already logged
show as not yet done; the "Trained today" badge never appears; nutrition drops today's water and
active energy; the end-of-day review nulls its metadata.

## The fix

Both helpers take an optional `tz`, and every call site passes one. Two sites already had the
timezone in hand two lines away and were not using it — `getLastTrainedLabel(session, tz)` in
`workout-select-content.tsx:31`, whose very next line reads `dayKeyInTz(tz, 0)`, and
`goals-section.tsx:110`, three lines above a correct `todayInTz(user?.timezone)`. The other four
components take it from `useUserTimezone()`, and `tz` joins the dependency array of each callback
that reads it, so a Profile timezone change re-runs them.

**For a Brisbane user this is byte-for-byte unchanged**, which is what makes it safe to ship
without a device run, and there is a test asserting exactly that.

## Why a CI step and not just the sweep

The parameter has to stay optional — some call sites legitimately have no session, and the default
is right for the owner. That is precisely why prose cannot hold it: the wrong call compiles,
type-checks, lints clean, and behaves correctly on the only device anyone tests on.
`scripts/check-tz-aware-cache-guards.js` (Custom Rules, step 44 of 44) fails on any call to either
helper without a second argument, walking the argument list to its matching paren so a nested call
or an object literal in argument one is not mistaken for a second argument. A site with genuinely
no timezone passes `undefined` explicitly — a decision in the diff rather than an omission.

Mutation-checked both ways: dropping `tz` from the helper bodies turns two unit tests red, and
dropping it from one call site fails the new CI step.

## Line-limit accounting

Two 800-line hotspots had to pay for the two lines each needed. `nutrition-content.tsx` funded it
entirely — a dead `Droplets` import, two dead lucide names, and two `@trainingai/shared/types/nutrition`
imports merged — and stayed at exactly 800. `health-content.tsx` reclaimed one line the same way
(its two `body-metadata/route` type imports merged) and its baseline goes 911 → 912 for the
remainder, with the reason in the script. There is no smaller shape: a hook cannot be called from
inside the callback that needs its value.

## Deliberately not done

`unwrapToday` / `readTodayCacheSync` / `cachedFetchToday` still use bare `todayInTz()`. Per the
Q-478 entry they are **not** the same defect: their envelope date is client-written and client-read,
so they are self-consistent — mislabelled rather than wrong. Threading `tz` through them would touch
every `cachedFetchToday` call site for no behaviour change. Not filed as a defect.

Q-477's step 1 — a ratchet on bare `todayInTz()` across all client code — is still owed. This
check is a narrower shape: two named helpers, not the general case. Q-477's pointer says so now.

## What was NOT exercised

- **No device run.** JS-only, so it reaches the APK through a Railway deploy with no rebuild.
- **No end-to-end non-Brisbane render.** The guard verdict was verified against a live API response
  and the helper is mutation-checked, but no Playwright run drives a non-Brisbane user through the
  Health or workout screens to watch the values appear.
- Every changed screen was loaded against `pnpm dev` on the local DB (`/health`, `/nutrition`,
  `/workout`, `/workout-select`, `/more`) — all 200, no server errors.
- The 100 other bare `todayInTz()` client call sites of Q-477 are untouched.

<a id="2026-08-19-body-battery-drain-and-roadmap"></a>

# Body Battery measures how long you wore the ring

**Date:** 2026-08-19 · **Branch:** `tuning/body-battery-exertion-brief` · **Agent:** Tuning 🎶
**Type:** docs-only — diagnosis + design brief · **Filed as:** Q-521

From an owner brief: *"body battery still doesn't seem that good… id like that type of granular
drain."* They were right, and the reason is worse than needing a tune.

## The drain model does not respond to activity

51 days, joined to steps and completed workouts:

| relationship | measured | should be |
|---|---|---|
| `corr(hr_sample_count, total_drained)` | **+0.518** | — |
| `corr(steps, total_drained)` | **−0.153** | strongly positive |
| `corr(steps, end_value)` | **+0.112** | strongly negative |

**The strongest predictor of the battery ending low is how many HR samples were recorded** — how long
the ring was on. Steps are *negatively* associated with drain.

A workout moves the day's end value by **0.6 points**: 50.6 on 37 workout days against 50.0 on 14
without. And the four days that ended at exactly 0 had **828–4,152 steps**, while the 16 days that
cleared the 8,000-step goal did *not* end lower. So today `0` means "you wore the ring a long time",
and the owner wants it to mean "you did everything" — close to opposites.

**Mechanism:** drain is `-DRAIN_RATE × (hrr − REST_THRESHOLD) × dt`, purely HR-driven. With Q-515's
boundary having fallen to ~60 bpm as the owner got fitter, nearly every waking sample drains, and
`(hrr − threshold)` varies far less than wear duration — so drain ≈ rate × time worn. **Q-521 is
downstream of Q-515.**

## Two of the three asks were already done

The owner asked for the same treatment across sleep, activity and battery. They turned out to be at
three different stages, which is worth knowing before building anything:

**Sleep is delivered.** Q-503's calibration already reserves the top: anchors `[88.7,97] [91,99]
[93,100]`, the owner's best real night blends to 91, and the replayed distribution puts **7 of 65
nights (11%) in the 90s**. It doesn't *look* done because stored history is still the old model
(mean 85.3, 27 of 36 nights ≥ 85) — that's Q-501/Q-518, not a scoring gap.

**Activity is specified.** Q-505 already states that hitting every target gives 100, with the
"what if I do too much" question resolved. Unbuilt, waiting on Lane A.

**Body Battery is the genuinely new work.**

## The brief, and the tension in it

Drain proportional to total exertion, normalised against the day's targets so "everything hit" lands
near empty — which is why a workout-only day should leave reserve. Keep the morning anchor, floor at 0,
route overshoot to an overreach signal rather than below empty.

Two constraints the data imposes: **`active_calories` is present on 8 of 51 days** and cannot carry
weight; and normalising to targets means **a fitter person drains less for the same absolute work** —
correct for "did I do my day", wrong for "how depleted am I". The brief chooses the former and that
choice needs writing into the model's comment so it isn't silently reversed.

Stated once, because it will come up: an exertion-scaled battery **cannot also detect overreaching** —
on a target-hitting day the well-recovered and the overreached athlete both read 0. That job belongs to
ACWR, readiness and the illness radar. It arguably resolves Q-276 by making Body Battery explicitly not
a recovery number.

## Not exercised

No code changed, and **no drain model was prototyped or replayed** — the numbers describe the current
model only. n = 51, one athlete, Pearson on daily aggregates; the weak values (+0.112, −0.153) mean
*no relationship* rather than a precise signed effect. **Zone minutes and movement-per-hour were not
pulled or coverage-checked** — they're named because the owner named them, and verifying their
coverage is the first implementation step given what `active_calories` shows. The sleep claim rests on
the distribution recorded in Q-503, not a fresh replay. No causal claim is made.

<a id="2026-08-19-body-derived-scores-closeout"></a>

# Two derived scores I'd ticked at the pillar level, actually checked

**Date:** 2026-08-19 · **Branch:** `tuning/body-derived-closeout` · **Agent:** Tuning 🎶
**Type:** docs-only — clean results plus a Q-517 addendum

The body pillar was marked ✅ on the strength of the Body Battery range and anchor work. That was a
**pillar-level** tick, and two derived scores inside it had never been looked at. Both are checked now,
and **neither has anything to calibrate** — which is worth recording so nobody re-measures them.

## BDI — no threshold exists, so there is nothing to tune

`bdi_derived` is the breathing-disturbance index, a byproduct of the SleepNet staging pass's apnea
head, on 46 of 96 rows: median **4.15**, p75 5.10, max **10.10**, 30% of nights ≥ 5, **none ≥ 15**.
Against the clinical AHI convention that is a plausible distribution for someone without sleep apnoea.

The reason there is nothing to do is simpler than the distribution: **no threshold exists anywhere.**
Its only consumer is a debug console, which labels it *"observational, not a diagnosis"*, and the
validation layer classes it with the open-ended research metrics. It is being accumulated, not acted
on — the right treatment for a clinical-adjacent number from an ML head.

## Body composition — a published formula, matched on purpose

`body_comp` (71 rows) is a deterministic derivation from logged weight and body fat, and its only
formula — `ffm × 21.6 + 370` — is deliberately matched to Oura's `atlas` postprocessor. Same category
as cardio's Riegel exponent: re-fitting it to one person would break the external consistency it exists
to maintain.

## The byproduct worth having

Q-517 proposes flooring the adaptive-TDEE plausibility check at the user's own BMR. **That BMR is
already persisted** — `body_comp.bmr_kcal`, per day, on 71 of 96 rows, from the same function. So the
floor should read the stored value rather than recompute: it becomes *the day's* BMR rather than a
window mean, and it cannot drift from the number the body-composition card already shows.

The fallback matters more than it looks. 25 rows have no `body_comp` because there was no body-fat
reading and `bodyComposition()` returns null rather than fabricating. On those days the floor should
fall back to the **most recent snapshot**, never to the universal 1,000 — a stale BMR is far closer to
the truth than a number ~500 kcal below it.

## Not exercised

No code changed. **The BDI values were validated against nothing** — there is no sleep study and no
second device, so "plausible" means *consistent with the clinical convention*, not *verified*. A
systematically wrong apnea head would produce a plausible-looking distribution too, and this review
could not tell the difference. The apnea head itself was not examined, only its persisted output.
`body_comp`'s formula was checked against one stored row; whether the body-fat percentage feeding it is
accurate is a scale question, not a formula one. And the fallback recommendation is reasoning — the 25
rows were counted, but no replay was run showing what a stale-BMR floor would pass or block.

<a id="2026-08-19-cache-invalidation-signal"></a>

# 2026-08-19 — an invalidated cache key now tells the component reading it (Q-402)

Lane B. v1.325.1. One new hook, one signal in the cache module, one hook converted, one Q filed.

## What the owner reported

*"noting the widget energy bar doesnt update natively; requires a restart of the app."*

## The half that already worked

`lib/cache-groups.ts` clears `energy-balance:` from **six** write groups, and it always did. The
entry was correctly evicted every single time. This was never an invalidation bug.

## The half that did not exist

Nothing told the component reading the key to go and get a new one. `useEnergyBalanceToday` seeded
from cache and then fetched once:

```ts
useEffect(() => {
  cachedFetch(`energy-balance:${today}`, …, ENERGY_BALANCE_TTL, d => setData(d ?? null))
}, [])          // ← once per mount, never again
```

That shape is fine for a screen you navigate away from — the next mount refetches. It is silently
wrong for anything in the **persistent tab shell**, which never unmounts. `HomeEnergyBalanceCard`
kept its first payload until the app was killed. Exactly the reported behaviour.

**The repo had no subscribe-to-invalidation mechanism at all** — no cache event, no listener.
`TAB_NAV_EVENT` exists and is navigation only.

## What shipped

- **`subscribeToInvalidation(fn)`** in `lib/sqlite/cache.ts`. `invalidateCache(prefix)` notifies
  after the delete lands, so a listener that refetches cannot repopulate the key before it is gone.
  A plain module-level `Set`, not a `window` event: the cache module is the only thing that
  invalidates, subscribers are in the same bundle, and a DOM event would need a server guard and
  would not fire in the node test environment where this is asserted. A throwing listener is caught
  and logged — this runs on every write path in the app, and one bad subscriber must not turn a
  mutation into a failed one.
- **`useCachedValue(key, url, ttl)`** in `lib/hooks/use-cached-value.ts`. Seeds from cache in an
  effect (never a `useState` initializer — session 165's hydration mismatch), fetches, and refetches
  on a matching invalidation. Prefix matching runs both directions because a group clears
  `energy-balance:` while the reader holds `energy-balance:2026-08-19`.
- **`useEnergyBalanceToday` converted** to it, and reduced to five lines.

## Two things deliberately not done

- **`ENERGY_BALANCE_TTL` is untouched.** The Q-402 entry says so and it is worth repeating: the
  effect never ran again, so the TTL was never consulted. Shortening it adds load and hides the
  defect.
- **No visibility gate on the refetch.** An off-screen card in the shell will refetch. That is one
  GET against a correctness bug, and `cachedFetch` de-dupes concurrent requests for the same key, so
  a write clearing several groups at once still produces one request.

## The other 36

A scan for `useEffect(…, [])` blocks containing `cachedFetch` found **37**, this one included. The
other 36 have the same shape and are **latent rather than broken**: almost all sit in components that
unmount, so their next mount refetches. Some are deliberately fetch-once — a sheet snapshotting data
at open, the sync provider's warm pass — and converting those would add refetches with no reader
waiting. Filed as **Q-359**, with the suggestion that a shrink-only Custom Rules baseline may be
worth more than the sweep: it freezes the count and makes each conversion visible, which is the part
that actually matters.

## Verification

Five unit tests on the signal, mutation-checked twice: commenting out the notify call reddens three,
and removing the try/catch around listeners reddens the throwing-subscriber case.

## What was NOT exercised

- **`useCachedValue` itself is not unit-tested.** Both vitest projects are `environment: 'node'` and
  `@testing-library/react` is absent, so there is no route to rendering a hook. What is asserted is
  the signal it consumes; the wiring between them is read, not run.
- **The owner's exact scenario is unconfirmed end to end** — log from Home and watch the bar move,
  without leaving the tab. **Three E2E probes all measured zero `/api/nutrition/energy-balance`
  requests**, so none of them ever reached the thing under test, and none was committed
  half-working. Two fixture gaps found on the way, both worth knowing before the next attempt:
  the seeded user has **no `height_cm` / `date_of_birth` / `sex`**, so the card sits in its
  "add your details" state; and `HomeEnergyBalanceCard` is an **opt-in** Home widget —
  `DEFAULT_CARD_WIDGETS` in `lib/home/home-prefs.ts` is an empty array, so nothing renders it by
  default. Setting `ta_ss_cards` via `addInitScript` was not enough on its own. **A guard for this
  needs a fixture that turns the widget on and gives the user a body, and that fixture does not
  exist** — which is also why the bug survived to a user report.
- **No device run**, and the persistent shell is what makes this reproduce: a browser reload masks
  it entirely. This is a JS-only change, so it reaches the APK on the next Railway deploy with no
  rebuild — but the check the entry asks for is still owed.

<a id="2026-08-19-cross-pillar-score-ranges"></a>

# Do all the pillars actually move? Only one does

**Date:** 2026-08-19 · **Branch:** `tuning/cross-pillar-range-view` · **Agent:** Tuning 🎶
**Type:** docs-only — cross-pillar synthesis, no new findings

The owner asked whether every pillar moves through its range — near 100 on good days, under 50 on bad
ones — and whether that is a useful way to judge a score. Both halves turned out to be worth writing
down, because each component was filed separately and the comparison existed nowhere.

## Only Body Battery genuinely spans

| score | n | range | mean | sd | < 50 | ≥ 85 |
|---|---|---|---|---|---|---|
| **Body Battery** | 51 | **0–100** | 50.7 | **29.6** | 24 | 5 |
| sleep — **old model** | 36 | 15–97 | **85.3** | 16.4 | 2 | **27** |
| readiness | 35 | 29–87 | 68.2 | 13.4 | 5 | 1 |
| **activity** | 23 | 64–91 | 75.2 | **6.0** | **0** | 1 |
| illness *(inverted)* | 46 | 0–38 | 7.3 | 7.2 | — | 0 |

And even Body Battery overstates itself: **5 of 51 days sit exactly on 0 or 100**, so part of that span
is the clamp rather than resolution.

Sleep's 85.3 is the **pre-recalibration** model — 27 of 36 nights at 85+, which is exactly what Q-503
fixed; the shipped curves replay to mean 69.5. Activity is the most compressed thing in the app at sd
6.0 with no day under 50. Illness never crosses its own threshold.

## The more useful half of the answer

**Range is a good first filter and a bad verdict.**

It catches the stuck-score class in one query, and it earned its keep this sweep — resilience emitting
one value ever, illness never firing, `strengthFreq` at exactly 100 on all 91 days, two of five peak
bands structurally unreachable. A score that cannot move cannot inform anything.

But it misleads three ways. **Clamping manufactures range** — saturating at both ends looks maximally
healthy on this statistic. **A wide range can be amplified noise** — sleep's calibration deliberately
turns ~4 blend points into ~12 displayed points, a stated cost the baton already flags. And most
importantly, **range says nothing about whether the movement is correct**: Q-507's stress metric has a
textbook spread, a defensible 16% firing rate, and correlates **+0.40 with readiness** — it moves
beautifully and points the wrong way for the decision it drives.

So the statistic to use is a pair: *does it move*, and *does it move with something it did not come
from*. Nothing in the first question could have separated Q-507 from Q-503. A cheap third is worth
having too — count the days sitting exactly on a clamp bound, which is one `CASE WHEN` and tells real
span from saturation.

## Not exercised

No code changed and no new measurement was taken beyond the aggregates — every underlying finding is
already filed with its own caveats, and this adds the comparison rather than evidence. The rows are
**stored** values, so they reflect whichever model wrote them; sleep's 36 are the old model, and
because Q-518 means the version stamp does not survive, **this table cannot be re-derived per-model
from stored data**. `n` differs per score (23–51) and the columns are not the same days. Activity's 23
rows predate its unbuilt redesign.

<a id="2026-08-19-fetch-once-ratchet"></a>

# 2026-08-19 — freeze the fetch-once effects, and correct the count while doing it (Q-359)

Lane B. v1.325.4. One new Custom Rules step, one hook gained a callback, one site converted.

## What this is

Q-402 shipped the mechanism — `subscribeToInvalidation` + `useCachedValue` — after the owner
reported Home's energy bar needing an app restart. This freezes the sites that still have the old
shape, so the problem stops growing while the sweep happens at its own pace.

`scripts/check-fetch-once-effects.js` fails any **new** `useEffect(() => { … cachedFetch … }, [])`,
with a shrink-only per-file baseline: a file not listed must have zero, a listed file may only
shrink, and a file that reaches zero must have its row deleted so the inventory cannot rot into a
stale allowlist. Same shape as `check-hex-literals.js` and `check-memo-prop-stability.js`.

**The baseline is grouped by whether the site can actually bite**, which is the judgement the entry
asked for rather than a flat list:

- **Can bite — 19 sites.** Permanently mounted, so a write made without leaving the tab never
  reaches them. This is the group worth converting.
- **Deliberately fetch-once — 1 site.** `sync-provider` warms the cache on mount; it is not a
  reader, and converting it would add refetches nothing is waiting for.
- **Unmount on navigate or on a conditional render — 16 sites.** Their next mount refetches, so they
  are latent rather than broken, and some may never be worth converting.

### The grouping was wrong the first time, in a way worth carrying

The first draft put every sheet in the third group on the reasoning that sheets close. **They do not
unmount here.** `components/shell/tab-shell.tsx` keeps all five tab contents mounted once visited,
and the tab screens mount their sheets **unconditionally** — `<ActivityDetailSheet
log={selectedActivity} />` and `<ExerciseReviewSheet sessionId={reviewingSessionId} />` are rendered
with a null prop and self-hide, not rendered behind a boolean. So both are permanently mounted, and
so are the Health cards reached through `health-sections.tsx`.

Re-checked by tracing each file's renderer up to a tab screen rather than judging by where the file
sits, the first group went **from 14 to 19** — nearly a third more sites can actually go stale than
the first pass said. Judge these by mount site, never by filename.

## Two counting corrections, both found by mutation-checking the rule

**The scan behind the earlier "36 remaining" undercounted by one.** Its pattern required a newline
before the effect's closing brace, so it **missed single-line `useEffect(() => { … }, [])`
entirely**. Measured on `origin/main` with both patterns:

```
wide pattern (correct):  37 sites across 27 files
narrow pattern (old):    36
```

So the true remaining count was **37**, not 36, and `app/nutrition/nutrition-content.tsx` has **two**
fetch-once effects, not one. After the conversion below it is **36**, which is what the baseline
sums to.

This surfaced because the first mutation test of the new check **passed when it should have failed**:
a one-line effect inserted into a non-baselined file went undetected. That is the whole argument for
mutation-checking a guard rather than watching it go green — the rule looked correct, ran clean, and
could not see a shape that is perfectly ordinary. Both arms fire now: a new site fails, and a fixed
site left in the baseline fails too.

## One conversion, and what it needed

`ObservedHrCard` renders inside the Health tab, so it is squarely in the first group. Converting it
required `useCachedValue` to grow an **`onError`** callback: `cachedFetch` swallows `!res.ok`,
including this app's own rate limit, so a card without one cannot tell "no data" from "the request
failed" — and the standing rule is that it must show an error state rather than vanishing. The
callback is held in a ref, so a caller passing an inline arrow (which is every caller) does not
re-run the fetch effect on each render.

That is 37 → 36 by count. The file leaves the baseline entirely rather than being lowered, since it
reaches zero — which is what the shrink-only rule requires.

## What was NOT exercised

- **36 sites are untouched.** This entry stops the growth; it does not do the sweep.
- **No device run.** JS-only; reaches the APK on the next Railway deploy with no rebuild.
- **The `onError` path was not triggered.** It is wired and type-checked, but nothing here made
  `/api/hr-profile` fail, so the error card was not rendered.
- **The check is regex-based, not AST-based.** It now catches both single-line and multi-line
  effects, but a `useEffect` whose callback is a named function defined elsewhere, or one built
  through a helper, is invisible to it. A clean run is not proof of full coverage.

<a id="2026-08-19-fetch-once-scanner-correction"></a>

# 2026-08-19 — Q-359 slice 3: the scanner was over-counting by ten

**Branch:** `chore/adopt-use-cached-value` · **Lane B** · v1.325.8

Third slice of the fetch-once sweep, and most of it is a correction rather than a conversion.

## The defect

`scripts/check-fetch-once-effects.js` — written two slices ago, in this same Q — found effect bodies
with a non-greedy regex:

```js
/useEffect\(\(\)\s*=>\s*\{([\s\S]*?)\}\s*,\s*\[\s*\]\s*\)/g
```

It starts at a `useEffect(() => {` and runs to the **first `}, [])` anywhere after it**. When the
effect it starts on has real dependencies, that closing brace belongs to a *different* effect further
down, and everything in between — other effects, `useCallback` bodies, plain functions — is swallowed
into the "body" and searched for `cachedFetch`. Five lines reproduce it:

```js
useEffect(() => { setThing(1) }, [dep])
const load = useCallback(() => { cachedFetch(…) }, [])
useEffect(() => { load() }, [load])
useEffect(() => { doSomethingElse() }, [])   // ← the regex's match ends here
```

The regex reports one fetch-once effect. The correct answer is **zero**: the fetch is in a
`useCallback` that an effect with real dependencies invokes — which is the shape the rule exists to
steer people *toward*.

The body is now found by brace matching.

## What it cost

**25 sites across 16 files were really 15 across 12. Ten of the twenty-five never existed.**

| file | claimed | real | why |
|---|---|---|---|
| `app/health/health-content.tsx` | 2 | **0** | every fetch is in a tab-group `useCallback`, re-run on `tabEpoch` |
| `app/nutrition/nutrition-content.tsx` | 2 | **0** | same, plus a `[userId, tabEpoch]` effect |
| `components/workout-screen.tsx` | 2 | **0** | `[userId]` effect |
| `components/sync-provider.tsx` | 1 | **0** | the warm pass is a plain function |
| `app/session-select/session-select-content.tsx` | 4 | **2** | |
| `components/running/running-plan-content.tsx` | 4 | **3** | |

The two orchestrators that slices 1 and 2 both deferred as "the hard ones, do them last" had
**nothing in them**. `sync-provider`'s row had a written justification — *"warms the cache on mount by
design; converting it would add refetches nothing is waiting for"* — for a site that does not exist.

**So the can-bite group was two sites, not the eight the previous revision claimed.**

Each phantom was verified by hand before the baseline was rewritten, not taken from the new scanner:
tracing every `cachedFetch` in those files to its enclosing hook, and reading the dependency arrays
(`[userId]`, `[userId, tabEpoch]`, `[fetchSharedHealthData, tabEpoch]`).

## The one real conversion

`session-select-content`'s `more-user-profile` read, and it is load-bearing rather than housekeeping:
`lib/cache-groups.ts` clears that key from two places, so **changing a display name or avatar left
Home's greeting and avatar stale until the app was restarted**.

Kept as state with an effect that syncs from the hook, rather than derived directly, because
`goalsProfile` also takes two optimistic local writes (`handleGoalsRemindLater`,
`handleGoalsUserSaved`) that must survive until the server catches up. Neither is at risk from the
refetch this adds: the goals card is gated on `goalsCheckinDismissed` first, and a profile save
invalidates the key, so the refetch it triggers returns the values just saved.

## What is left

**One can-bite site**: session-select's `ta:oura-ble-synced` listener, which refetches
`sleep-sessions` on that one event because nothing refetches it on invalidation. It is the same
workaround `home-day-timeline` carried and had removed in slice 1 — but it cannot be deleted the same
way, because this screen's sleep read is a `[userId]` effect with a local-first store seed and a
`fetchWithRetry` wrapper. Moving it to `useCachedValue` is a genuine state refactor and wants its own
PR. The remaining 13 sites unmount on navigate and are latent.

## The lesson, which is about the check rather than the sweep

The check shipped with a mutation test, and that test proved it caught a **new** site. Nothing proved
the sites it already listed were real — the baseline was generated by the same regex it was meant to
constrain, so an over-count was self-consistent and invisible. Two sessions then planned work around
those numbers.

A scanner's baseline is a measurement, and it needs checking against a hand count once, at the start.

## Verification

- The rewritten check is mutation-checked both ways: a synthetic `useEffect(…, [])` + `cachedFetch`
  fails it; the same fetch moved into a `useCallback` behind real deps does not.
- Every phantom hand-verified by reading the enclosing hook and its dependency array.
- `pnpm dev`: Home renders *"Good evening, Test User."* and the avatar initials — the display name
  reaches state through the hook — with one `/api/user/profile` request and zero console errors.

**Not verified:**
- **The stale-greeting bug this fixes was reasoned from the invalidation groups, not reproduced.**
  Changing a display name and watching Home update would need the profile-edit flow driven end to
  end; what is confirmed is that two groups clear the key and that the screen previously read it
  exactly once.
- **No device run.** JS-only; reaches the APK on the next Railway deploy with no rebuild.
- The corrected counts are for `app/` and `components/` only, which is the check's own scope.

<a id="2026-08-19-fetch-once-slice-1"></a>

# 2026-08-19 — Q-359 slice 1: six leaf cards adopt `useCachedValue`

**Branch:** `chore/adopt-use-cached-value` · **Lane B** · v1.325.6

Q-402 shipped the mechanism — `subscribeToInvalidation` + `useCachedValue` — and Q-359 froze the 36
sites still doing it the old way behind a shrink-only ratchet. This is the first slice of the sweep:
**six files, seven baseline sites, 36 → 29.**

| file | sites | mounted by |
|---|---|---|
| `components/home-day-timeline.tsx` | 2 | Home (tab shell) |
| `components/calendar-widget.tsx` | 1 (+1 keyed) | Health |
| `components/activity/exercise-detected-card.tsx` | 1 | Home |
| `components/health/hr-recovery-profile-card.tsx` | 1 | Health |
| `components/health/strength-progress-card.tsx` | 1 | Health |
| `components/cardio/trends-section.tsx` | 1 | `/cardio` |

Leaf cards first, deliberately: each owns one key and converts without touching screen state, which
the four tab-screen orchestrators (`session-select-content`, `health-content`, `nutrition-content`,
`workout-select-content` — nine sites between them) do not.

`calendar-widget`'s second effect is the bonus. The ratchet only counts `useEffect(…, [])`, so its
`calendar-data:${year}-${mm}` fetch — deps `[viewYear, viewMonth]` — was never in the baseline, and
it goes stale in exactly the same way: the deps change on a month flip, not on a write. The hook
handles a changing key, so both converted.

## The `today` option, and why the sweep needed it

`useCachedValue` could only speak plain `cachedFetch`. Three of the sites on the list —
`home-day-timeline` among them — call `cachedFetchToday`, the variant that treats an entry stored on
a previous day as a miss. Adopting the hook would have meant **switching their variant**, and
`training-stress` shows why that is not a local decision: it is read at two sites and warmed by
`sync-provider` with `today: true`, so changing one reader silently splits the key across two
freshness semantics. That is the drift the one-variant rule exists to stop.

So the hook takes `today?: boolean` and picks `cachedFetchToday`/`readTodayCacheSync` from it. The
flag is a property of the **key**, not a preference, and nothing in the type system says so — pass
it wrong and there is no error, no throw, just a *seed* that misses, so the card paints blank for one
frame and fills in after the network. That reads as slowness, not as a bug.

`lib/hooks/__tests__/use-cached-value-today-agreement.test.ts` is the guard: it parses every
literal-key `useCachedValue` call and cross-checks the flag against `sync-provider`'s warm list,
which is the one place each warmed key already declares its variant. Mutation-checked in both
directions — flipping `weights-summary` to `today: true` fails it by name, and breaking the call-site
regex fails the "finds the call sites at all" assertion rather than passing vacuously.

## A hand-built workaround the mechanism replaced

`home-day-timeline` carried a `ta:oura-ble-synced` window listener, added by Q-91 because the widget
— mounted in the shell, never unmounted — did not refetch after a BLE drain invalidated its entry: a
just-synced night kept showing the pre-sync bed/wake time. **That is Q-402's bug with a workaround
for one event.** The invalidation signal covers every writer instead, so the listener is gone.

Safe to drop because the dependency it now leans on is guarded rather than assumed: both dispatch
sites (`lib/oura-ble/sync.ts`, `components/sync-provider.tsx`) call `invalidateOuraSync()`
immediately before dispatching, and `lib/__tests__/cache-groups.test.ts` already asserts that group
clears `home-day-timeline`.

**Three sibling listeners remain** — `session-select-content`, `health-content`, `sleep-content` —
and should go the same way as those files convert.

## The grouping was wrong again

The can-bite group has now been miscounted twice. The first correction was 14 → 19 (sheets do not
unmount here; the tab screens render them unconditionally with a null prop). The second, found this
slice: `cardio/trends-section.tsx` was filed as "Health, via health-sections" and is not rendered
there at all — its only renderer is `cardio/cardio-content.tsx`, and `/cardio` is not one of the five
tabs in `components/shell/tabs.ts`. **It was 18, not 19.** Converting it was still right; the count
was not. Both errors came from reading the directory a file sits in instead of grepping for its
renderer and checking that against `tabs.ts`, which is now written into the check script.

## Verification

- `pnpm dev` exercised: Home, Health and `/cardio`. Every converted card renders and its route is
  requested — `day-timeline` 1, `oura/workouts` 1, `weights-summary` 2 (warm pass + card, expected),
  `hr-recovery-profile` 1, `calendar-data` 1, `workout-data` 3, `cardio-trends` 1 — with **zero
  console errors** on all three surfaces.
- `home-day-timeline`'s "Today's Timeline" heading renders, which is what proves the `today: true`
  envelope is being read correctly; a wrong flag shows nothing.
- Ratchet: 36 → 29, and it proved itself live by failing on all six files before the baseline was
  lowered.

**Not verified:**
- **The refetch-on-invalidation half was not driven end to end for these six.** The signal is
  unit-tested (`cache-fetch.test.ts`) and the hook shipped verified in Q-402, but no test drives a
  write → invalidation → refetch through one of *these* cards. Both vitest projects are
  `environment: 'node'` with no `@testing-library/react`, so the React half is not unit-testable, and
  the E2E fixture Q-359 asks for (a seeded body plus `ta_ss_cards`) still does not exist.
- **No device run.** JS-only; reaches the APK on the next Railway deploy with no rebuild.
- The seed moved from `useLayoutEffect` to the hook's `useEffect` in `calendar-widget` and
  `hr-recovery-profile-card`. That is a one-frame difference in when the cached value paints, not a
  behavioural change, and the standing instant-paint rule asks for an effect rather than a
  `useState` initializer either way.

<a id="2026-08-19-fetch-once-slice-2"></a>

# 2026-08-19 — Q-359 slice 2: four more files, and the last easy ones

**Branch:** `chore/adopt-use-cached-value` · **Lane B** · v1.325.7

Second slice of the fetch-once sweep. **Four files, four sites, 29 → 25**, and the can-bite group
falls from 12 to **8**.

| file | key | mounted by |
|---|---|---|
| `components/health/training-stress-line.tsx` | `training-stress` | Health, via training-load-card |
| `components/activity/exercise-review-sheet.tsx` | `hr-profile` | Home, with a null `sessionId` |
| `components/activity/activity-detail-sheet.tsx` | `hr-profile` | Health, with a null `log` |
| `app/workout-select/workout-select-content.tsx` | `muscle-recovery` | `/workout-select` |

`training-stress-line` is the first real use of slice 1's `today` option — `training-stress` is a
date-less today key, warmed `today: true` and read that way by the done-screen badge, so this is
exactly the site that could not have adopted the hook before the option existed. The agreement test
proves it both ways: dropping the flag fails with *"reads 'training-stress' with today: false, warm
list says true"*, and adding a spurious one to `weights-summary` fails the mirror.

Both sheets carry the same shared `hr-profile` key, and the conversion is load-bearing there rather
than cosmetic: two groups in `lib/cache-groups.ts` call `invalidateCache('hr-profile')`, so the
entry really is cleared by writes and really was never re-read.

## One deliberate behaviour change

`workout-select-content` previously wrote `recoveryMuscles` only `if (d?.muscles?.length)` — so an
empty response left the previous list on screen. The hook writes what the server returned, so an
empty recovery list now renders as empty. That is the honest reading: the old guard preserved a
stale list on a legitimately-empty response, and "keep the last non-empty value" is the shape that
hides exactly the staleness this sweep exists to remove.

## A correction to slice 1's prediction

Slice 1's backlog note said `lib/__tests__/q165-cache-seeded-reads.test.ts` would red when the two
sheets converted, because it asserts `readCacheSync<` and `cachedFetch<` appear literally in them.
**It did not.** Each sheet has *two* fetches and only the `hr-profile` one is a fetch-once site; the
keyed `hr-window:` fetch stays, so both strings survive. It stays green, and the note is corrected in
the backlog rather than left as a wrong prediction for the next session to trip over.

The `hr-window:` fetches are staying for a reason worth recording: their key is per-session
(`hr-window:${query}`) and both sheets are mounted with a **null** prop, so there is no key until one
is selected. `useCachedValue` has no way to express "no key yet" — it always fetches — so those sites
need either a skip/null-key affordance on the hook or to stay as they are. They are not in the
ratchet's baseline (their deps are not `[]`), and the window they describe belongs to a finished
session, so the data is immutable once fetched.

## What is left, and why it is not a fourth slice of the same shape

The remaining 8 can-bite sites are **entirely** in the tab-screen orchestrators:
`session-select-content` (4), `health-content` (2), `nutrition-content` (2). These were left for last
deliberately — each seeds four to eight keys inside one shared `useLayoutEffect` and feeds screen
state that other effects also write, so converting one is a state refactor, not a swap. One file per
PR from here.

## Verification

- `pnpm dev` exercised: Health and `/workout-select`. `hr-profile` 1, `training-stress` 1,
  `muscle-recovery` 2 (warm pass + card, expected — it is in the warm list), the recovery card
  renders, **zero console errors** on both.
- Full unit suite: 4,138 passed. `tsc` clean, lint 0 errors.
- Ratchet 29 → 25, proving itself live on all four files before the baseline was lowered.

**Not verified:**
- **The refetch-on-invalidation half is still not driven end to end.** Same reason as slice 1: both
  vitest projects are `environment: 'node'` with no `@testing-library/react`, and the Home-card E2E
  fixture Q-359 asks for still does not exist.
- **No device run.** JS-only; reaches the APK on the next Railway deploy with no rebuild.
- The empty-response change above was reasoned from the diff, **not observed** — the local seed has
  muscle-recovery data, so the empty branch was never rendered here.

<a id="2026-08-19-invalidation-refetch-hook"></a>

# 2026-08-19 — Q-359 slice 4: the can-bite group reaches zero

**Branch:** `chore/adopt-use-cached-value` · **Lane B** · v1.325.9

Fourth and last shell-level slice. **12 sites across 10 files remain, and the CAN-BITE group — the
only one that is a live bug — is empty.** Everything left unmounts on navigate and is latent.

## What was left, and why it needed a second hook

The survivor was session-select's `ta:oura-ble-synced` listener, refetching `sleep-sessions` after a
BLE drain. Slice 1 deleted the identical listener from `home-day-timeline` simply by converting that
widget to `useCachedValue` — the hook refetches on invalidation, so the bespoke listener had nothing
left to do. That trick does not work here: this screen's sleep read seeds from the local SQLite store
*and* wraps its fetch in `fetchWithRetry`, and `useCachedValue` replaces a read outright — it holds
the value, seeds it and fetches it. A read it cannot own still needs the half the hook exists for:
**something has to ask for a new value when a write clears the old one.**

So `lib/hooks/use-invalidation-refetch.ts`: `useInvalidationRefetch(keys, onInvalidated)`. It is the
escape hatch for reads `useCachedValue` cannot take over, and three screens had already hand-rolled
it against one event.

**Subscribing to the invalidation is strictly wider than listening for the event**, and that is the
actual bug fixed here rather than a tidy-up. `sleep-sessions` is cleared by `invalidateBiometrics` as
well as `invalidateOuraSync` — so a manually-edited sleep row, or a Health Connect ingest, left all
three screens stale until a remount. Only the BLE path self-healed, because it was the only writer
that thought to dispatch an event.

Converted, per the sibling-surface rule, all three at once:

| screen | was | now |
|---|---|---|
| `session-select-content` | listener → `cachedFetch('sleep-sessions')` | `useInvalidationRefetch('sleep-sessions', …)` |
| `health/sleep/sleep-content` | listener → `cachedFetch('sleep-sessions')` | same |
| `health/health-content` | listener → `fetchMeta()` | `useInvalidationRefetch(['body-metadata', 'sleep-sessions', 'readiness-score'], fetchMeta)` |

session-select keeps its listener for the part that is **not** a cache read — it bumps `refreshTick`,
which re-runs four gated effects (readiness, body-battery, training-load, oura-hr-day).

## Coalescing, which the three-key call site needs

`invalidateCache` is called **once per key**, so a group clearing all three of health-content's keys
would fire the subscription three times and run its whole meta load three times over. The hook
collapses a burst into one call through a zero-delay timer. Not a micro-optimisation: `fetchMeta`
issues three requests and a local-store read.

## Verification

- `pnpm dev`, all three screens: Home, Health and `/health/sleep` each render and fetch, **zero
  console errors**. Request counts rise by exactly one per screen visit — a subscription that fired
  on its own writes would show a climbing count, and does not.
- `lib/hooks/__tests__/use-invalidation-refetch.test.ts` guards the pattern from coming back and is
  **mutation-checked**: reintroducing a `cachedFetch` inside a `ta:oura-ble-synced` listener fails it
  by filename. It also pins the two properties that are silent when wrong — two-way prefix matching,
  and the coalescing.
- Full unit suite 4,142 passed. 49 of 49 custom rules. `tsc` clean, lint 0 errors (the six warnings
  in the touched files pre-date this diff — verified by stashing).
- `check-component-size` caught the growth on session-select; the baseline is raised by two with the
  reason, which is what that check is for.

**Not verified:**
- **The staleness this fixes was reasoned from the cache groups, not reproduced.** What is confirmed
  is that `invalidateBiometrics` clears `sleep-sessions` (asserted in `cache-groups.test.ts`) and
  that these screens previously refetched it only on one event. Driving an edited sleep row through
  to a visibly-updated Home would need the sleep-edit flow end to end.
- **The React behaviour of the hook is not unit-tested** — both vitest projects are
  `environment: 'node'` with no `@testing-library/react`. The test is a source guard; the runtime
  evidence is the dev-server pass above.
- **No device run.** JS-only; reaches the APK on the next Railway deploy with no rebuild. The BLE
  drain path itself is device-only and was not exercised — but it is the path that already worked,
  and it is unchanged for `refreshTick`.

## One unrelated failure found while verifying, and filed rather than absorbed

The full local E2E run turned up `goal-invalidation.spec.ts` failing — *"a steps-goal edit reaches
Health without a reload"*. It is **not this change**: it fails identically on an unmodified
`origin/main` checkout at `968516f`. The panel renders `steps / goal` and the local seed's most
recent `steps` value is 2026-08-17, with today's `body_metrics` row carrying NULL — so there is no
step count to draw the goal into and the locator never appears. Filed as **Q-360**; the durable fix
is a seed generated relative to the run date rather than from literal dates.

Worth stating plainly because the tempting reading was the wrong one twice over: first that a
neighbouring change had broken it, then — once it reproduced on `main` — that it was safe to ignore
because CI is green. Neither is a finding. The finding is that a static seed and an assertion against
*today* drift apart by one day per day, which is the rolling-window class CLAUDE.md already names one
layer down.

<a id="2026-08-19-label-line-budget"></a>

# 2026-08-19 — the default label printed none of the ingredient list it promised (Q-399)

Lane B. v1.325.0. Two component files, one test file, one E2E assertion, one follow-up filed.

## What the owner saw

*"I dont see the B2 default we wanted… where is my b2 default? should of shipped?"* — against
v1.324.6, with the style selected. It **had** shipped (Q-397, #105), it **was** the default, and it
**was** correctly selected. It simply drew no ingredients, which is the one thing that style exists
to do.

## The arithmetic, confirmed

`drawSquareCentredLabel` walks the column top-down and then asks how many 8-unit lines fit above the
code. At the shipped geometry:

```
L = (189 − 137) / 2 = 26          bottom = 163
y = 30 + nameSize(12) + 7 + caloriesSize(21) + 6 + macroSize(7.5) + 5 + rule gap(8)  =  96.5
codeTop  = 163 − codeUnits(66) = 97
maxLines = floor((97 − 96.5 − 2) / 8) = floor(−0.19) → 0
```

**Zero, and negative before the clamp.** `fitText` shrinking a long name cannot rescue it — the name
contributes at most 12 of the 66.5 units consumed, so nameSize 12/10/8/6/4 all give 0. The budget had
been reasoned against a different set of gaps than the painter drew.

## Why nothing caught it

Three independent gates each did the wrong thing quietly:

- The renderer returned `ingredientLines: 0` — correct, and reported.
- The sheet's *"Printing N ingredients"* copy was gated on `> 0`, so the line that would have said so
  **removed itself** in exactly the case worth reporting.
- The picker went on promising *"the full ingredient list"*.
- The unit test asserted the code **size** (0.529 mm/module) and nothing about whether a list fit
  beneath it. A bigger code scored better on the only number under test.

So the feature reported a smaller code as a win while printing none of the thing the code was
shrinking to make room for.

## The trade, resolved rather than dodged

Q-399 concluded the centred stack could not carry the list **and** a better code than `band`'s
0.369 mm per module. At the shipped type sizes that is right — three lines forces `codeUnits` 42.5,
i.e. 0.341. It is wrong at the type the mockup was actually drawn at.

Giving back 3 units of calories height (21 → 18) and 7 units of gap (7/6/5/8 → 5/4/4/6) takes the
header from **96.5 units to 86.5**:

| codeUnits | lines | mm per module |
|---|---|---|
| 56 | 2 | 0.449 |
| 52 | 2 | 0.417 |
| **50** | **3** | **0.401** |
| 46 | 3 | 0.369 |

**50 units, three wrapped lines, 0.401 mm per module** — above the old default's 0.369, and roughly
seven ingredients once the run wraps inline. The margin is one step wide: 52 gives two lines, not
three, which is why this is derived rather than picked.

Q-399 warned *"do not simply set it to 58"*. It was right, and there is now a test saying so.

## What stops it recurring

- **`stackGaps` is spec data, not literals in the painter.** `centredStackLineBudget(style)` reads
  the same four gaps the painter draws, so the constant and the layout cannot disagree.
- **The budget is a pure function.** Both vitest projects are `environment: 'node'`, so arithmetic
  left inside a canvas painter cannot be asserted at all — the same split that made
  `fitIngredientLines` testable in Q-393.
- **The test asserts the promise, not a constant:** every style with `ingredients: true` must have
  room for ≥ 1 line, and the default for ≥ 3. Plus two regression cases that reproduce v1.324.6's
  geometry as zero, and 58 units as zero.
- **The sheet reports zero loudly.** The `> 0` gate is gone; the line is gated on the *style*
  claiming a breakdown, and a count of zero renders in destructive colour with `role="status"`.
- **The picker no longer promises the full list** — "as much of the ingredient list as fits".
- **An E2E assertion on the default style**, alongside Q-393's on the square one.

Mutation-checked at both levels. Restoring v1.324.6's five numbers turns **four** unit tests red,
including *"every style that claims a breakdown has room to draw one"*.

## What the fix uncovered: the code was fuzzy, not just small

Shrinking the code box from 66 units to 50 made `e2e/meal-label.spec.ts`'s **decode of the rendered
canvas** start failing — and then passing again on a re-run, at identical geometry. The screenshot
showed a visibly correct, complete QR. That flakiness is the finding.

`drawCode` sizes a module as `box / 33` in sheet units against a canvas scaled by a constant, so the
module width in device pixels is `box × scale / 33` — **fractional for every style that ships**. At
the 3.12 scale that shipped: `band` 4.35 px per module, the new default 4.73, none of them whole.
Every module edge landed mid-pixel and antialiased to grey. The `+0.04` bleed already in `drawCode`
is an acknowledgement of exactly that, papering over the seams rather than removing them, and its own
comment says they "cost scan margin". A 6.24 px module out-votes the fuzz; a 4.73 px one does not.

**This is the printed artwork, not the preview** — share/save hands the viewer these pixels. So the
fix was to double the canvas to `DEFAULT_RENDER_SCALE = 6.24`: a 50 mm label is now 1,179 px, i.e.
**600 dpi**, and the default's module is 9.5 px. The decode is reliable again and every style's
artwork improved, including `band`, which was the tightest at 4.35 px and had never been checked
against a printer at that resolution.

Snapping the grid to whole device pixels is the real fix and is **filed as Q-358, not done here**:
flooring shrinks the drawn box, which makes `codeMm`, the sheet's mm-per-module line and
`mealLabelCodeMetrics` all disagree with the artwork — and that figure is precisely what the owner
reads before printing and what `meal-label-code-size.test.ts` asserts. At 600 dpi the shrink is ~5%
rather than the ~15% it would have been at 300, so it is a better change on the new base anyway.

`drawCode` is now the only place a code is drawn. The round painter carried a byte-identical inline
copy of the same arithmetic, which is the "One Formula, One Place" class and would have meant fixing
Q-358 in one of two places.

## What was NOT exercised

- **No print.** The two physical checks Q-389 owes are unchanged and are the ones that matter for a
  code this size: print at 50 mm and scan it. **0.401 is finer than the 0.487 originally believed
  safe** — that figure was the ÷25 reading and was never real, but the owner has still not scanned
  anything at 0.401. The 600 dpi artwork should help and is untested on paper.
- **The module grid is still fractional** (Q-358). What changed is that there is now enough
  resolution for it not to matter to a decoder. That is a margin, not a fix.
- **No device run.** JS-only; reaches the APK through a Railway deploy with no rebuild.
- The character budget per line (`charsPerLine`, measured from the real font) is unchanged and
  untested in isolation — "roughly seven ingredients" is inferred from it, not counted on paper.

<a id="2026-08-19-label-save-to-gallery"></a>

# 2026-08-19 — Q-400: the label can leave the app now (and prints at 50 mm)

**Branch:** `fix/label-save-to-gallery` · Implementation Lane A · **needs a new APK** — the Kotlin
half does not reach the device through a Railway deploy.

## What was wrong

`meal-label-sheet.tsx` had one button, "Share or save", with two paths and both missed on the
canonical runtime. `navigator.canShare?.({ files })` is narrower than share-with-text and is not
reliably available in the Samsung WebView, so the guard correctly returned false — and the
`<a download>` fallback behind it is a silent no-op there: no file, no error, no toast. The feature
had only ever worked in `pnpm dev`.

A second defect sat on the same button and was invisible everywhere: `canvas.toBlob` writes a PNG
with **no `pHYs` chunk**, because the canvas API cannot set one. A PNG that declares no physical
size prints at the viewer's default, 96 dpi almost everywhere — so the 1,179 px label drawn to be
50 mm arrived at **312 mm**. That survived the deliberate 300 → 600 dpi change, because raising the
resolution was never the problem.

## What shipped

- **`android/…/media/MediaSavePlugin.kt`** + registration in `MainActivity`. Writing the file is not
  the hard part; being *visible* is — a file in app storage, or even in `Pictures/`, does not appear
  in the Photos app until it is registered with MediaStore, which is why this is a bridge and not a
  `@capacitor/filesystem` call. On API 29+ the insert creates the file inside the collection, so it
  needs no storage permission at all; `IS_PENDING` hides the half-written row until the stream
  closes, and a failed write deletes the pending row rather than leaving one the gallery cannot show
  and the user cannot delete.
- **`lib/media/save-to-gallery.ts`** — `saveImageToGallery(blob, filename)`. Never throws; the
  failure reason comes back as a value, because every caller ends in a toast.
- **`packages/shared/src/nutrition/png-density.ts`** — `withPngDensity` / `readPngDensity`. Splices
  a 21-byte `pHYs` chunk after `IHDR` with its own CRC. Idempotent, and a no-op on non-PNG input, so
  it is safe on every path without tracking whether it has already run. Both the save and the share
  path go through it — two copies of this would drift and only one would be easy to notice.
- **Two buttons, not one.** Putting a file in the Photos app and handing it to a print app are
  different intents, and one button doing whichever happened to be available is what produced this
  bug. Save to gallery is primary; Share is secondary.
- **Every branch ends in a toast** — saved, downloaded, shared, or the reason it failed.
- **The style persists**, in one `localStorage` key. The owner's own framing was *"Happy for it to
  persist if its easy"*, so: no column, no settings surface, no migration. Seeded in an effect, never
  a `useState` initializer.

## The decision worth not re-litigating: the native path never falls through to the download

The obvious shape is "try native, else download". That is wrong here, and dangerously so: inside the
WebView `<a download>` does nothing, so a fall-through would toast **success** and produce no file —
strictly worse than the dead button it replaced. So on the device, a missing plugin (an APK older
than this change) and an unsupported Android version each return a stated failure. The download
branch is reachable from a browser only.

Below API 29 this reports unavailable rather than falling back. The legacy route needs
`WRITE_EXTERNAL_STORAGE`, a runtime grant and a prompt written for a device tier that does not exist
here — the supported device is API 35 — and an untestable code path plus an unrequested manifest
permission is worse than a stated gap. **Known limitation, recorded rather than hidden.**

## The `canShare` guard stays

Removing it is the tempting "fix" and it is explicitly wrong: `navigator.share` with files where it
is unsupported rejects, and the catch swallows `AbortError`, so removing the guard turns a dead
button into a dead button that also lies in the log. What changed is that declining now *says so*
and points at Save.

## Verification

`npx tsc --noEmit` clean · `pnpm lint` clean · `pnpm check:rules` **Ran 49 of 49** · full suite
against the local DB **512 files / 4,197 tests passed**.

- **12 unit tests on the chunk**, which read it back out of the bytes rather than trusting the
  writer. One of them encodes a *real* PNG (deflated `IDAT`, correct CRCs) and re-walks every chunk
  after the splice. The written file was then parsed by an independent decoder: `file(1)` still
  reads it as a valid PNG, and the chunk reads **23622 px/m, unit 1 → 600.0 dpi**, i.e. a 1,179 px
  label measures **49.9 mm** where an unstamped one measures **311.9 mm**.
- **Two new E2E tests** (`e2e/meal-label.spec.ts`) driving the real button: Save to gallery produces
  a download whose bytes carry a `pHYs` chunk above 560 dpi and whose toast appears, and the chosen
  style survives a reload. Both pass.
- The existing "renders a printable label in every style" test **times out locally at 180 s**, and
  it does so on unmodified `main` too — checked by stashing this work and re-running. It is the
  sandbox's dev-server compile cost, not a regression here; CI is green on it.

## Not exercised

**The gallery write itself.** It goes through the Capacitor bridge, which does not exist in a
browser, so nothing in the sandbox reaches it — the E2E proves the blob and its metadata, not the
delivery. Verification is: install the new APK, tap Save, open the Samsung Gallery, find the file.

**The print.** The `pHYs` figure is verified in the bytes and the arithmetic is exact, but whether a
label printer honours it is a physical measurement. `metrics.codeMm` in the sheet says what the code
should measure, so the check is a ruler and not a judgement call.

**This unblocks Q-411.** The owner said *"I can only do a print once the option to save to gallery
exists"* — three questions now come from one print: does the file reach the gallery, does it print at
50 mm rather than 312, and does the circle template crop the corners or scale the square inside the
circle.

<a id="2026-08-19-meal-type-reassign"></a>

# 2026-08-19 — Q-412: move a meal type's entries instead of making the user delete them

**Branch:** `feat/meal-type-reassign` · Implementation Lane A · JS/server only, no APK needed.

## What was wrong

Deleting a meal type that had logs answered **409 "Meal type has food log entries — reassign them
first"**. There was no reassign, anywhere: `meal_type_id` was not a settable field on any route, and
no UI offered to move a logged item between meal types. So the message named the one action that
would clear the block and the app had never implemented it.

The only escape a user could actually perform was **deleting every food log ever recorded against
that meal type** — throwing away nutrition history to change a setting. The owner's case, dropping
from five meal types back to three, is the ordinary one.

## What shipped

`DELETE /api/nutrition/meal-types/[id]?reassignTo=<uuid>` moves every live log onto the target and
soft-deletes the source, **in one transaction** — a reassign that succeeds followed by a delete that
fails would leave the user halfway with no way back. Without the parameter the old behaviour stands,
except that the refusal now **names the number of entries in the way** and says what can be done
about them, so a caller can offer the choice rather than repeat an instruction nobody can follow.

**Each moved row is re-stamped against the new window** (Q-413). A 3 pm snack reassigned to Lunch
would otherwise keep a 15:00 time sitting outside Lunch's 12–15h window — the exact inconsistency the
move exists to tidy. That goes through `resolveEatenAt`, not a second copy of the midpoint
arithmetic: the SQL in migration 203 is a one-off historical correction, and every *live* path uses
the one implementation.

The update is one statement per moved row, on purpose. Each row resolves against its **own** `date`,
so there is no single timestamp to set; this is a settings action bounded by one meal type's history,
and a row-count-shaped optimisation would trade clarity for nothing measurable. A first attempt used
a single `UPDATE … FROM unnest(…)` and Drizzle would not marshal the arrays — worth knowing before
reaching for that shape again.

## Two entry premises that were wrong, and were checked rather than assumed

The backlog entry called for "the outbox mutation, the `pushMutations` branch, `getSyncDelta` and the
`applyDelta` mapping" — a full sync chain. Re-verified against the code:

- **`meal_types` is not an outbox domain.** Meal-type CRUD is already online-only, so the reassign
  needs no outbox mutation and no push branch. Nothing was added that would have had no caller.
- **The pull direction needed one real fix, and it was not in this PR's scope** —
  `applyDelta`'s `food_logs` conflict arm updated only 4 of 8 columns, so a server-side
  `meal_type_id` change could never reach a device that already held the row. That was found while
  scoping this item and shipped with Q-413 as **Q-325**, because it also silently voided that
  change's timestamp corrections. Without it this feature would have looked correct on the web and
  done nothing on the APK.

`updated_at` is bumped on every moved row, which is what carries the move out on the next pull —
`getSyncDelta` cursors on it, so that is load-bearing rather than incidental.

## Verification

`npx tsc --noEmit` clean · `pnpm lint` clean · `pnpm check:rules` **Ran 49 of 49** · full suite green.

**8 DB-backed tests**, covering the move, the delete, that the live log count is unchanged (the
entries move, they do not go away — that distinction is the whole point), the re-stamp against the
new window, that a time already inside the new window survives, self-target, a target that is not the
user's, and the `updated_at` bump.

One of those tests had to be rewritten because its premise was wrong, and the reason is worth
keeping: since Q-413 a create resolves against its **own** window, so a log written under Snack
(15–17) can never come out holding a time inside Lunch (12–15). The "already inside the new window"
case only arises from a pre-Q-413 row or overlapping windows, and the test now sets the stored time
directly to produce that shape.

**Live against `pnpm dev`** with two logs under Afternoon Snack (15–17), both stamped 16:00:

| request | result |
|---|---|
| `DELETE` with no target | **409** — *"This meal type has 2 entries. Move them to another meal type, or delete them."* with `logCount: 2` |
| `?reassignTo=` itself | **400** — *"Pick a different meal type to move the entries to"* |
| `?reassignTo=` an id that is not the user's | **404**, nothing changed |
| `?reassignTo=not-a-uuid` | **400**, nothing changed |
| `?reassignTo=<Lunch>` | **200 `{moved: 2}`** — both rows now under Lunch at **13:30**, Afternoon Snack gone from the live list |

After each refusal the logs were re-checked and still sat under Afternoon Snack, untouched.

## Not exercised, and what is deliberately not here

**The device.** `food_logs` is an offline-first domain and the local mirror is where a sync half fails
silently. The pull path is fixed (Q-325) and unit-pinned at the statement level, but it has not been
run against a real device database. The on-device check: reassign a meal type with logs, then confirm
on the APK that the entries appear under the new type with the same calories and that the day total
is unchanged — and that it survives an app restart.

**The dialog is Lane B and is not in this PR.** The endpoint had to land first. What Lane B needs:
the 409 body now carries `code: 'MEAL_TYPE_HAS_LOGS'` and `logCount`, so the manager can open a
picker of the remaining live meal types instead of firing a delete that can only fail. The entry also
asks for a warning *before* the attempt and for the dialog to say plainly that this **rewrites
history** — a 3 pm snack moved to Lunch reads as Lunch on every past day, which is the intent but
should not be a surprise.
