# Session journal — batch folded 2026-09-28

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-09-28-chore-or-close-answered-asks"></a>

# 2026-09-28 — closing four asks that were already answered, and one that was answerable

**Branch:** `chore/or-close-answered-asks` · Orchestrator

`Ask: owner` was 12. Five of those needed no answer from him: three were already resolved elsewhere,
one was routed to the wrong place, and one turned out to be derivable from the repo. **Now 8.**

## Struck as complete

- **`BF-202`** — both sweep passes are run and all thirteen buried decisions carry an `Ask:`. Its
  own text said to strike it once they were surfaced.
- **`RV-170`** — the history-row policy was settled on 2026-09-24 and **both riders are now
  resolved**: `RV-164`'s 1,618-vs-1,660 question is the blocking input on `OR-191`, where it
  belongs, and `RV-166` was dissolved by merging walk and run.

## The check that made striking `RV-170` safe

I wrote that the policy "is recorded in each of" the five entries that cite it, then checked rather
than shipping the claim. **Four of five restate it; `LA-21` did not.** Striking the entry would have
left `LA-21` pointing at a policy with no surviving statement anywhere it could reach. The policy —
recompute-from-stored-inputs **yes**, hand-edits **no**, per `BF-81` — is now written into `LA-21`
in the same change, with its own limb named: the midnight `started_at` rows are a hand-edit, so
**mark them known-bad rather than rewriting them**.

## Shrunk

**`RV-221`** — items 1 and 2 are closed. The `RV-213` mockup is no longer owed because the change
was **declined** on 2026-09-27, and the calorie target is `OR-191` now. Only the merge-time yes on
six security fixes remains, and that is needed when each PR goes green, not now.

## Re-routed, not deferred

**`BF-201`** decision 2 — the rep→%1RM table — goes to **`Lane: T`** before it goes to him. The
entry's own text sets the bar: *"Tuning owes … a proposal stating how many of his past sessions the
change would move."* Picking a table without that number is picking blind, and the recommendation
turns on exactly that quantity — the observed curve is recommended *because* it changes nothing on
day one, against a textbook table that would silently re-weight every session. The proposal makes
the question answerable. **Decision 1 (the p75 margin) is not blocked by this** and ships with
`BF-197`.

## Answered here rather than asked

**`LB-173`** — which of the two "Start Workout" buttons should change. The entry declined to
recommend, saying *"there is nothing in the repo that favours either direction"* and that choosing
would be *"dressing a coin toss as analysis"*. Honest, and untested.

**Measured across `components/**` and `app/**`: of 43 full-width primary `<Button>`s, 33 are
text-only and 10 carry a decorative leading icon — 77%.** (Eight more render a `Loader2` spinner
while saving; those are a state indicator, not a leading icon, and counting them would have put the
split at 18 v 33 and muddied it.) So the session card is the house convention and the pre-workout
screen is the outlier. **Drop the dumbbell.** It is a restyle fixing a consistency defect, which
CLAUDE.md's mockup rule explicitly exempts, and it is the opposite shape to `LB-164` — that was
adding a label he never asked for; this removes an inconsistency in the direction 33 other buttons
already point. Lane B, two lines.

**Not exercised:** documentation only. Gates: `Ran 83 of 83` Custom Rules, `check-doc-links`,
`check-backlog-pointers` — clean by exit code.

<a id="2026-09-28-docs-home-banner-stack-mockup"></a>

# 2026-09-28 — redrawing the Home banner mockup that was approved and then lost

**Branch:** `docs/home-banner-stack-mockup` · Orchestrator

`RV-119` carried an owner approval from 2026-09-22 and nothing an implementer could build to: the
mockup was shown in a session and never saved. Asked yesterday whether to redraw or build to the
written split, he chose redraw.

[`docs/design/2026-09-28-home-banner-stack.html`](../design/2026-09-28-home-banner-stack.html) ·
[hosted](https://claude.ai/artifact/V3PRnnjchdhAA9nXYwgXLt)

## The split was not re-asked, and was verified rather than trusted

The entry says two banners stay full-width and four collapse. **Checked against `main`**:
`app/session-select/session-select-content.tsx:1128–1192` renders `IllnessAdvisoryBanner`, the
auto-detected walk/run prompt, the `earlyDeloadRecommended` banner, `showGoalsCheckin`, the
day-review `DismissibleBanner` and `WeeklyRecapBanner` — six, not seven, because the APK banner
already shipped as removed. The split stands as agreed.

## What the page actually asks

One question: what a collapsed strip looks like. Two treatments drawn.

- **A — one strip.** The four notifications become a single row showing what is waiting and how
  many, expanding inline on tap. Recommended: it is the only version that reliably puts a real card
  in the first screen, and the four are the same kind of thing, so grouping them is honest rather
  than a height trick.
- **B — thin rows.** Each keeps its own line at about half today's height, one tap to act or
  dismiss.

**The trade is stated rather than hidden:** B costs height, A costs a tap, and which is worse
depends on whether he treats these as a to-do list or as noise. An item behind a tap is an item he
may not action.

## A limit worth stating

Heights are drawn to scale against each other, **not measured on the device**. A real screenshot
needs all six banner conditions true simultaneously, which no sandbox can arrange. Whichever
treatment he picks owes a device look at the real stack before it is called done — recorded on the
entry, not just here.

## `LB-135` is struck as superseded

Its job was exporting the lost artefact. The artefact is unrecoverable, so redrawing replaced
exporting. The rule it leaves behind is the durable part: **a mockup is not shown until it is in
`docs/design/`** — an approval whose picture lives only in a transcript records that a decision
happened and loses what was decided, which is what kept `RV-119` unbuildable for six days.

**Not exercised:** a static page. No component changed, nothing rendered on a device.

<a id="2026-09-28-docs-resting-hr-cell-mockup"></a>

# 2026-09-28 — the Resting HR cell, and why both proposed fixes were impossible

**Branch:** `docs/resting-hr-cell-mockup` · Orchestrator

`LB-172` needed a mockup before it could reach the owner. Drawn:
[`docs/design/2026-09-28-resting-hr-cell.html`](../design/2026-09-28-resting-hr-cell.html) ·
[hosted](https://claude.ai/artifact/7ngUaPpJieYqDkfBpJAiEC)

## The defect

Three of Home's four cells are 0–100 scores. The fourth is a heart rate, drawn in the same ring at
the same weight, so **58 reads as a score** and nothing says otherwise but the words underneath.

## Both fixes `RV-211` proposed are unavailable, and the entry measured it

| Proposed | Measures | Against | Verdict |
|---|---|---|---|
| `"58 bpm"` at the value's font | 140 px | 82 px cell | 1.7× the whole cell |
| `"Resting HR (bpm)"` in the label | 97 px | 60 px label today | overflows by 15 px |

So "just add bpm" is not a small change — it is not available in either place the entry meant. What
is free is the caption slot under the number: the component already draws a cue word there at
7.5 px, and in the default style that slot renders nothing.

## The fork, and what actually decides it

There are **nineteen** user-selectable ring styles. `nolabel` removes the label deliberately — the
glyph is the name — and `overlap` has no caption slot, so no single treatment fits all nineteen.

- **(a) a `bpm` caption**, only where a label already exists. Recommended: one word, reversible in
  one component, and it does not re-open a visual language he has chosen between nineteen times.
- **(b) drop the ring on the HR cell.** The honest version of "it is not a score" — a ring encodes
  0–100 progress and 58 bpm has no such scale. Fixes all nineteen styles.

**The page asks one question that settles it without taste entering into it: does he use `nolabel`
or `overlap`?** In those two, (a) changes nothing and the ambiguity is at its worst, because nothing
names the metric at all. If he does, (b) is the only option that works.

**Not device-verified** — drawn from harness geometry, not screenshotted, since the row needs live
scores. (b) owes a device look before shipping because it changes a shape rather than adding a word.

**Not exercised:** a static page. No component changed.

<a id="2026-09-28-e2e-six-always-red"></a>

# LA-176 — five of the six were the app changing and nobody updating the spec

**Branch:** `fix/e2e-six-always-red` · **Lane B** · `components/**`, `e2e/**`.

Six E2E specs failed on every PR that ran the full suite, and nothing noticed because E2E is
advisory. The entry asked for a triage before any fixing: regression or stale test, one line each.
Reproduced all six locally against `main` first.

| spec | verdict | cause |
|---|---|---|
| `home-card-invalidation-refetch` | **product defect** | every Home section is `aria-disabled="true"` |
| `la109-back-from-subroute` | **product defect** | same |
| `food-log-swipe-delete` | **stale fixture** | seeds a NULL `meal_type_id` |
| `meal-plan-library-surface` | **stale test** | LB-159 flipped the default the day before |
| `one-calorie-budget` | **stale test** | RV-208 ① added thousands separators |
| `rv38-body-battery-no-data-badge` | **stale test** | RV-211 ② replaced the badge with stronger copy |

## The one real defect

`HomeSortableSection` passes `disabled: !editMode` to dnd-kit's `useSortable`. **That stops the
drag; it does not stop the decoration.** Measured at 412 px, every Home section carried
`role="button" aria-disabled="true" tabindex="0" aria-roledescription="draggable"` — outside edit
mode, permanently. A screen reader announced each card as a disabled button, each section took a tab
stop that does nothing, and Playwright, correctly following ARIA, refused to act on anything inside
them.

Attaching the ref only in edit mode is the whole fix. `bf205-home-section-drag.spec.ts` still passes
both its cases, so reordering and the edit-mode-only handles are intact.

**It reached further than the two specs.** Of the six "sometimes fails" specs the entry also listed,
five now pass — including all five tabs of `tabs-instant-paint` and all three of
`tn85-sleep-verdict-on-home`, both Home surfaces.

## The stale four, and one of them is mine

`food-log-swipe-delete` seeded `food_logs` with `(SELECT id FROM meal_types … LIMIT 1)`. The six
default meal types are created **lazily by the app** on the first nutrition read, never by the
database seed — so on a fresh database, which is every CI run, that subquery is NULL and the insert
dies on a not-null constraint. It passed locally only because an earlier run had already made the
app create them. **That is the whole reason this one failed on CI and on nobody's machine.** The
spec owns its meal type now.

`meal-plan-library-surface` asserted the saved-meals toggle starts off. **LB-159 — mine, shipped the
day before — made it start on for an account that has saved meals**, and I did not update this spec
or the picker's own docstring, which still said "off by default". Both corrected, and the spec now
exercises both directions rather than only the off→on tap.

`one-calorie-budget` interpolated the budget bare into `\d[\d,]* / ${total} kcal`. RV-208 ① gave
that exact card `toLocaleString()`, so `2548` renders `2,548`. `rv38` asserted a "Limited data"
badge that RV-211 ② deliberately suppressed for a zero-data account in favour of "No data yet" —
*"the stronger statement of the same thing"*. RV-38's requirement is unchanged and still asserted;
what satisfies it moved.

## What is left, filed as LB-178

Fixing the fixture unblocked six tests in `food-log-swipe-delete` that had never executed. They
pass — but across three runs, two failed a **different** swipe-timing test each and the third passed
8/8. And `tn53-sparkline-does-not-span-gaps` fails after five other specs and passes alone. That is
order- and timing-sensitivity rather than a failing assertion, and it is what LB-56's "should E2E be
required" decision actually needs measured.

## Verification

`tsc` clean · Custom Rules **83 of 83** · lint 0 errors, 831 warnings · full unit suite green ·
build clean. All six specs pass, `bf205-home-section-drag` still passes, and the six intermittent
specs are five-of-six.

**A local diversion worth recording:** `check-test-typecheck` reported 2 errors in
`lib/health-connect-sync.ts` that also appeared on clean `main` while CI was green. It was local
`node_modules` drift — `pnpm install --frozen-lockfile` cleared it. Not a repo defect, and CI
installs frozen so it never saw it.

**Not exercised:** the device. The a11y fix is a ref attachment with no layout change, and the rest
is test code.

<a id="2026-09-28-fix-bugfix-prompt-github-intake"></a>

# 2026-09-28 — the BugFix contract said to read GitHub; its pickup prompt did not

**Branch:** `fix/bugfix-prompt-github-intake` · Orchestrator

Answering the owner's question about how an outside contributor's PRs and issues get actioned in
future, I checked whether the intake path actually exists rather than describing the intent.

## The gap

`docs/agents/README.md` §1 assigns GitHub intake to BugFix — `list_issues`, `list_pull_requests`,
and the same read → triage → file loop — added 2026-09-25 after the contributor said his items were
never touched.

**`docs/agents/prompts/bugfix.md` did not mention GitHub at all.** `grep -E "list_issues|GitHub|
issue|inbound"` over it returned **zero** hits. A fresh session is told to read four documents and
then start triaging owner reports; reaching the GitHub instruction depends on it getting to §1 of
the README and carrying it over. The prompt is the operative instruction, and it is what a session
actually follows.

**That is the same shape as the original failure.** The channel existed in principle and nobody was
told, at session start, to look.

## The fix

The prompt now names **three intake channels** to read at session start, before any owner report:

1. **GitHub** — open issues and every PR not self-authored, with the 2026-09-27 rule attached: an
   inbound PR is review/comment/approve, never merge.
2. **`claude_ro.feedback_submissions`** — *Report an Issue* on `/more`.
3. **`error_events`** — faults nobody saw, which prune at 30 days.

Two of the three are silent — nothing chases the agent for them — so the prompt says to do this at
session start rather than when owner reports run out. The contributor's own words are quoted in the
prompt, because a rule with its incident attached survives compaction better than a rule alone.

## Not covered by a check

Nothing verifies that a pickup prompt and the contract agree; this was found by reading. The other
six prompts were not audited for the same class of drift, and that is worth a sweep rather than an
assumption.

**Not exercised:** documentation only, no code. Gates: `Ran 83 of 83` Custom Rules,
`check-doc-links: OK (897 files)`.

<a id="2026-09-28-fix-next-schema-number-script-name"></a>

# 2026-09-28 — the migration-number guidance named a script that does not exist

**Branch:** `fix/next-schema-number-script-name` · Orchestrator

An outside contributor (`jsboiss`) asked how the migration-numbering problem he raised as issue
#1620 had been resolved, since he could see a PR documenting it and no behaviour change. Checking
the answer found the work had largely shipped — and found a defect in the part he would actually
touch.

## What shipped, so the answer is on the record

- **The manual counter is gone.** `scripts/next-schema-number.js` computes the next free Postgres
  migration number and local SQLite version, **counting numbers claimed by branches that have not
  merged**. It replaced a hand-maintained table in `docs/implementation-backlog.md` that a CI check
  pinned to `max(merged) + 1` — which could only restate the filenames and could never reserve
  ahead of them. That table is what he asked to have removed, and it is removed.
- **The CI gate is now a duplicate check only** (`check-migration-numbers.js`): it fails when two
  migrations claim the same leading number, because `migrate.js` applies in filename sort order and
  `schema_migrations` tracks by filename, so a duplicate makes apply order ambiguous and neither
  file can be renamed once applied. It does **not** enforce an ordering counter.
- **`BF-214` (#1795) removed the bulk of the pain.** `claude_ro` views were re-issued as a full
  numbered migration on every schema change — **59 copies, 92% of the migration corpus** — and two
  landing together silently destroyed each other. They are now one generated file,
  `lib/data/postgres/claude-ro-views.sql`, overwritten in place and taking no number.

## The defect, fixed here

`check-migration-numbers.js` and `scripts/lib/migration-claims.js` told the reader to run
**`node scripts/next-migration-number.js`** — a file that **does not exist**. The script is
`next-schema-number.js`, and it also mislabelled itself in its own no-refs fallback message.

That text is what prints **when the duplicate check fails**, so at the one moment the guidance
matters, it named a missing script. Three references corrected.

## The finding it did not fix — `OR-202`

The tool now runs, and its output is close to unusable: a single run prints lines hundreds of
characters wide, with number `274` reporting the same filename across **44 branches**. Every one is
a phantom — stale branches still carrying the 59 `claude_ro_views_*` migrations `BF-214` deleted.

**A real collision is buried in that noise** (`284: merged 284_sleep_verdicts vs
origin/health-sample-storage: 284_apple_health_samples`). A tool whose true finding cannot be seen
is not doing its job, and this is the one outside contributors are pointed at. Filed as `OR-202`
with a recommendation to collapse identical claims rather than prune other agents' branches.

## What this means for PR #1608, not yet communicated

His PR is **41 lines of real change plus a 1,690-line generated view migration**
(`291_claude_ro_views_apple_health_samples.sql`). That pattern was deleted four days ago, and
`claude-ro-views-file.test.ts` **fails any PR adding a migration that creates the `claude_ro`
schema** — so it will fail CI despite `mergeable_state: clean`, which is a git-level answer and not
a CI one. His numbers 290/291 do not collide; `main` is at 295.

Net effect is in his favour: 1,690 of his 1,759 lines disappear. **Not yet posted** — the owner
asked how this stood before deciding what to tell him.

**Not exercised:** no product code changed; three comment/message strings in scripts.

<a id="2026-09-28-fix-stress-bucket-fixture-rename"></a>

# 2026-09-28 — the two stress E2E fixtures follow `LA-114`'s column rename

**Lane B.** Branch `fix/stress-bucket-fixture-rename`. Test-only; no product code, no version bump.

## What shipped

`e2e/tn35-stress-against-events.spec.ts` and `e2e/tn3b-stress-on-hr-chart.spec.ts` now `INSERT` into
`oura_daytime_stress_buckets.bucket_mid` instead of `bucket_start`, in both the column list and the
`ON CONFLICT` target.

`LA-114` renamed that column earlier the same day (migration `202609280647_rename_stress_bucket_mid.sql`)
because it had **always** held the bucket's midpoint — `t = bucketStart + bucketMs / 2` — so a join
written against an epoch-aligned 30-minute series landed 15 minutes out and returned nothing. The
rename swept the schema, the adapter, the rollup IO and the two routes. It did not sweep the two E2E
fixtures that write the column directly in SQL, so both files died in `beforeAll` with
`column "bucket_start" of relation "oura_daytime_stress_buckets" does not exist` before reaching an
assertion. This is the sibling-surface half of that rename.

## How it was found, which is the part worth keeping

Not by reading the diff — by reading the **CI log of the run I had already merged**. `LA-176` (#1893)
cleared six always-red specs, and auto-merge fired on the five required checks while the advisory E2E
job was still running, so I noted in that PR that I had never seen CI confirm the six. Polling it
afterwards produced the verdict, and the `bucket_start` error was in the Postgres output underneath
two spec failures I had assumed were mine to explain.

Both stress failures are **deterministic**, not flaky. That distinction is the reason this got its own
fix rather than a line in the flake entry: they would have inflated `LB-178`'s flake rate by 40% and
aimed that investigation at test ordering, which is not where they live.

## Verified

- The exact patched fixture statement, upsert path included, executed against the local DB:
  `INSERT … (user_id, day, bucket_mid, level) … ON CONFLICT (user_id, bucket_mid) DO UPDATE`. The PK is
  `(user_id, bucket_mid)`, so the conflict target matches the index it infers.
- `npx tsc --noEmit` clean · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors (831 warnings,
  inside the standing band) · `check-test-typecheck` none above baseline · full `pnpm test` green.

**A bare rename was checked for semantics rather than assumed to be safe.** The column means a
midpoint, and both fixtures write `:00`/`:30` grid times, which is *not* where a real midpoint lands
(`:15`/`:45`). That is deliberate and moves no assertion here: the consumer
(`/api/body-battery/stress-day`) maps `bucketMid.getTime()` straight to `t` with no shift, so the
fixture writes and the route reads one value; tn35's event at 07:30 sits inside the middle bucket on
either reading; and tn3b only asserts the legend renders when measured points exist. Re-anchoring the
fixtures to `:15`/`:45` would have changed their meaning beyond the rename for no gain, so it was not
done. A comment in each file records this.

**Not exercised:** neither spec was run end-to-end locally — E2E needs a built app and the full suite
is ~36 min on one worker. The failure fixed is a SQL column that does not exist, which the statement
test above reproduces and clears exactly; CI's E2E job is the confirmation, and it is advisory.

## Also in this PR

`LB-178` gains its **first full-CI census** (run `36396363930`): 257 passed, 5 failed, 6 flaky,
1 skipped, 3 did not run, **36.3 min**. Its own stated first step was a repeat-run census, and this is
one taken against CI rather than locally, where the order-sensitivity cannot reproduce. Three readings
from it:

- `food-log-swipe-delete:238` failed in CI exactly as in two of three local runs — the most
  reproducible of the set, and where that entry should start.
- `diary-nested-meal` is new to the list and appeared on two lines at once (`:231` hard, `:197`
  flaky); `:231` already had history in the backlog under runs #1280 and #1377.
- At 36.3 min the suite finished **under** `LB-166`'s 45-minute cap, which it had been hitting. Six
  specs each burning a timeout before failing were most of the difference, so `LA-176` bought back
  roughly the margin the cap was eating.

`or162-canvas-census:30`'s failure is noted there for completeness and left to `OR-162`, which already
records that the census reads 0 canvases in the harness and that the harness cannot answer its
question.

<a id="2026-09-28-home-body-battery-failure-line"></a>

# LB-175 — three of the four rows in my own entry were wrong

**Branch:** `fix/home-body-battery-failure-line` · **Lane B** · `app/session-select/**`.

LB-175 was filed a day earlier from a **text diff** of what disappeared when every read failed on a
cold start. Re-measured by reading what the screens actually *say*, three of its four rows do not
survive.

| row as filed | measured |
|---|---|
| Home · body battery absent | **correct** — the one section that vanishes in silence |
| Home · greeting and avatar absent | **wrong** — they fall back to `TrainingAI` and `?`, both neutral |
| Health · `ESTIMATED 1RM` absent | **wrong** — replaced by *"Couldn't load your strength progress"* |
| Health · `AVG DURATION` absent | **wrong** — replaced by *"Couldn't load your weekly stats"* + Try again |

A diff names what left the screen. It cannot say whether what replaced it is wrong, and here the
replacements were the honest failure lines the entry was asking for. `strength-progress-card.tsx`
already had `onError`, and `weekly-stats-hub.tsx` already checked `error` **before** `loading` with
a comment explaining why the other order is the defect.

## What shipped

Home's body-battery read carried `.catch(() => {})`, which cannot fire — `cachedFetch` resolves a
boolean rather than rejecting (RV-84) — and `{bodyBattery && <BodyBatteryCard …>}` removed the card
with nothing in its place. It now takes an `onError` and renders one line in the card's slot, only
when there is no cached arc to show: a stale arc beats a banner, which is the posture every other
read on this screen already takes.

## What the re-measurement found instead

Health prints **seven** explicit failure lines and is largely honest. What is not honest is the
empty-state copy underneath them — `BURNED`, `BMI`, `BALANCE`, `RESTING HR`, `HRV` and `SPO₂` all
read **"No data"**, and the energy-budget card says *"Add your height, age and sex in Profile"*,
which tells the owner to redo something he did months ago because one read did not land. That is one
shape across a dozen cells and a decision about what an empty metric cell should say, rather than the
per-card `onError` this entry was about, so it is filed as **LB-176**. `GOALS` is the only Health
section still vanishing silently and goes with it.

## Verification

`tsc` clean · Custom Rules **83 of 83** · lint 0 errors · full unit suite green · build clean.

`e2e/rv150-failed-read-says-so.spec.ts` gains the case and a healthy-cold-start twin.
**Control-run:** against `origin/main` only the new failure case goes red; the healthy one passes in
both runs, so the line cannot be reached except by an actual failure.

**Not exercised:** the device. Render-only, no native or offline-first surface, so the 412 px harness
covers the path it has.

<a id="2026-09-28-lane-a-bf111-apk-date-from-asset"></a>

# 2026-09-28 — BF-111: the APK's build date comes from the APK

Device Verification's 2026-09-23 screenshot showed About reading "built 23 Aug" for an APK built on
2026-09-20. Measured live on 2026-09-28: the `apk-latest` release was **created 2026-08-23** and
never moves, and only its `app-debug.apk` asset is replaced (last uploaded 2026-09-25). So
`published_at` has been the first build's date for every build since.

`mapApkRelease` now dates the build from the asset's `updated_at`, and falls back to the release date
only when there is no asset. The module comment claiming the release is recreated on every publish
was wrong and is corrected. Tests cover both cases, and the old source fails the first.

**Owed:** a look at More → About on the S25, recorded as a `Keep:` on BF-111. The card renders only
on native.

<a id="2026-09-28-lane-a-bf15-unclassified-role-default"></a>

# 2026-09-28 — BF-15: a missing exercise role is Accessory, not a Main lift

The owner reported isolation work rising to "a main level". The cause: both schema defaults and
twenty read sites turned a missing `exercise_role` into `primary`, the goal's heaviest band with an
AMRAP last set. All of them now fall back to `UNCLASSIFIED_EXERCISE_ROLE` (`accessory`):

- Postgres, via migration `202609280717`, which changes the default only.
- The local SQLite CREATE constant.
- Server, device and UI fallbacks, including the label and badge helpers, which had to agree with
  the editor's pill.

A `git grep` test fails on any `?? 'primary'` that returns. It had to run git without a shell:
`cmd.exe` passes single-quoted pathspecs literally, so the first version matched nothing on
Windows and a mutant survived.

**Defect (a), fixed in the same change as the plan required:** an Accessory exercise whose
Accessory phase had no style kept its own style, which could be null, leaving no prescribed
percentages. It now keeps its own style only when it has one, and otherwise takes the phase's
lighter style.

**The plan's whole-session rule was built, measured, and removed.** Re-run on the owner's sessions
from production on 2026-09-28, it scored **87% (61 of 70) on the plan's fixture**, below its own
90% bar. BF-16a corrected the muscle counts after the plan was written, and the hip thrusts now
list 5 muscles against the squat's 4. So the rule anchored AI-Phase1 and Shikai's Legs on the hip
thrust, against the owner's own "squat for legs". Lower days anchored on single-leg hip thrusts over
the split squat, and there were two Secondary/Accessory judgement calls. The catalogue has no field
that separates the squat from the hip thrust (one main muscle each), so a fix would have been a
heuristic fitted to this fixture. Every whole-session creation path already takes roles from the
model, with Primaries capped in code (BF-126). So the rule had no caller to justify it. The
single-add rule (never Primary) did ship, for Lane B to wire into the editor.

Tests: 9 in `bf15-session-roles.test.ts`, plus the updated label and export tests. The
defect-(a) and fallback-guard mutants are killed, the CI replay is clean, and the full suite is
green apart from the known comment-blindness interaction, which passes alone.

<a id="2026-09-28-lane-a-bf187-drain-on-open"></a>

# 2026-09-28 — BF-187: opening the app asks the ring for its data

Removing the Oura Cloud sync on 2026-08-13 also removed the only open/resume trigger. Since then,
opening the app never asked the ring for anything, and freshness was bounded by the hourly drain:
a median 25-minute lag after waking, measured on the resident nights. The owner asked for the sync
to happen "as soon as the app is opened", and he lifted the APK cost so the cooldown could live in
the native service.

`OuraRingService.drainIfStale(maxAgeMs)` starts a drain unless one finished within `maxAgeMs`, or
one is in flight, or the ring isn't ready. The service is the only thing that can see the hourly
autonomous drains and survive a WebView reload. `sync-provider.tsx` calls it through
`syncOuraRingIfStale()` on mount and on Capacitor `resume`, with a 10-minute cooldown. When a drain
starts, the same settle-then-announce path as pull-to-refresh runs, so cards refill when the rollup
lands (~10–40 s), not on first paint. The changelog says so, so the owner knows what to expect.

Verification: Kotlin compiled locally (a typo in the new code fails the build), and there are JS
tests for started, fresh, older APK and wiring (the always-settle mutant is killed). The device
check is owed and recorded as `Verify: device` and a Known-Issues row.

<a id="2026-09-28-lane-a-bf198-whole-session-predeload"></a>

# 2026-09-28 — BF-198: `Full` works on a whole-session deload

The owner, on an Upper reading "AI Prescription · Deload" with `Full` selected: *"How am I supposed
to select a full workout when the prescription is deloaded?"* He could not. `Full` reverts each
exercise to the `preDeload` block its prescription recorded, and the whole-session deload builder
never wrote one. Production held both shapes: Upper and Pull at 5 of 5 deloaded with 0 records, a
per-exercise Lower with 1 of 1.

The expensive half was invisible. Sets done at full weight under the override were still logged as
a deload, so they could not set a PR.

## The fix

`buildWholeSessionDeloadPrescription` records `preDeload` for every exercise with a base style. The
numbers come from `buildRulesPrescription`: the program's own sets, reps, pct and rest, fitted to
today's budget. A whole-session deload has no model numbers to keep, so the program is the honest
source. Everything downstream already existed: `session-data` turns `preDeload` into
`preDeloadStyle`, and `applyDeloadReverts` clears `deloaded`, which is what lets the sets count.

An exercise with no base style gets nothing and stays deloaded under `Full`, the same as the
per-exercise path without a record. The stored Upper and Pull prescriptions keep the dead toggle
until they are regenerated.

## Verification

- `bf198-whole-session-predeload.test.ts`, 5 cases: still a deload at the deload numbers; `preDeload`
  equals the rules plan; under a tight budget it carries the FITTED set count; nothing for a
  style-less exercise; and it arrives in `buildWorkoutExercises` as a `preDeloadStyle`.
- Mutants: not recording `preDeload`, killed. An unfitted set count first SURVIVED, because at a
  90-minute budget nothing is trimmed. The tight-budget case was added and kills it. Control
  (`?? undefined`) survived.
- 64 files / 710 tests in `ai-periodization`, `workout` and `components/workout`, plus the three
  DB-backed prescription route tests (74), pass.

## Not exercised

The seed program is not AI-dynamic and cannot reach a whole-session deload, so this was not driven
through `pnpm dev`. The device, and the card's copy (BF-198 Keep ①).

<a id="2026-09-28-lane-a-bf200-styleless-deload"></a>

# 2026-09-28 — BF-200: a deload week now lightens an exercise that has no style

The owner, mid-deload on Upper: *"it seems like skull crusher weight is the same as my active
workout."* Four exercises were at 52%; Skull Crusher was at 3 × 30 kg, his working weight.

## How it was found

The entry offered two mechanisms (the pct applied to an inflated PR, or no pct at all) and said the
arithmetic could not separate them. Production could:

| 09-25 deload session | deloaded | style | sets | planned_pct |
|---|---|---|---|---|
| Incline Bench, DB Row, Lateral Raise, Chin-Up | true | set | 2 | 52 |
| **Barbell Skull Crusher** | **false** | **none** | **3 × 30** | **none** |

Skull Crusher has had no progression style since 2026-09-10. On 09-25 the AI prescription was not
driving the load, so each exercise started from its base style, and the Q-185 deload override in
`buildWorkoutExercises` swapped in the deload style. That override required a non-empty
`progressionStyle`. The deload style is built from the goal alone, so the requirement did nothing
except exempt a style-less exercise, which then fell back to 3 sets at target-80: 29.25 → 30 kg.

A third idea, that the prescription's `sessionExerciseId` no longer matched a replaced row, was
checked and refuted: all five ids match.

## The fix

One condition in `packages/shared/src/workout/session-data.ts`. A style-less exercise has nothing to
revert to, so its `preDeloadStyle` stays null and "revert to full weights" restores what it had.

## Verification

- `bf200-styleless-deload.test.ts`, 5 cases: the style-less exercise deloads exactly like the styled
  one; nothing is left to revert; it is untouched outside a deload week; a baseline never deloads;
  a static program is untouched. The first case failed before the fix.
- Mutants: restoring the old condition, and dropping the baseline guard, were both killed. The control
  (operand order) survived.
- All 47 test files around the builder pass (482 tests).
- `pnpm dev`: `/api/workout-data` returns 200 and builds every seeded session. The seed program is not
  AI-dynamic, so this branch is reached only by the unit test.

## Left, and recorded on BF-200 as Keep

How the style came off around 09-10; style-less exercises logging no `planned_pct` on ordinary days
(TN-75); the 57.75 kg PR that still looks inflated. Not exercised: the device.

<a id="2026-09-28-lane-a-bf214-numeric-migration-order"></a>

# 2026-09-28 — BF-214 ②: migrations order by number, and new ones are named by the minute

Both appliers sorted migration filenames as strings. `ensureSchema` and `migrate.js` now sort by the
leading integer, with ties broken by filename (`sortMigrationFiles`). Every existing prefix is three
digits, so the order production applied is unchanged; a test asserts this against the real
directory. Once the sort was numeric, the prefix could stop being a shared counter.
`next-schema-number.js` now hands out a UTC minute, `YYYYMMDDHHMM`. If a claim already holds that
minute, it hands out the next one instead. A branch can sit open for days and its prefix stays
valid. Only two migrations written in the same minute collide, and `check-migration-numbers.js`
still catches that case.

`migrate.js` now exports the sorter and runs `main()` only when executed directly. That lets one
test hold both copies to a single order. Mutation pass: 6 of 6 killed, control green. One mutant
(local time in place of UTC) only bites where the machine's zone is not UTC, which is true here and
in production but not on CI's runner. The CI replay is clean.

What is left is a reply on issue #1620, a public comment. BF-214 stays in `O` as a Keep line with a
draft.

<a id="2026-09-28-lane-a-bf216-ble-view-offset"></a>

# 2026-09-28 — BF-216: the device pipelines read BLE notifications through the view

The Colmi V1 frame, the Colmi V2 big-data chunk and the chest strap's live heart-rate measurement
each built a `Uint8Array` from `view.buffer`. That ignores the `DataView`'s offset and length, so it
reads correctly only while the BLE plugin hands over a view that starts at zero, which it does
today. All three now read `new Uint8Array(v.buffer, v.byteOffset, v.byteLength)`. Lane B's pairing
screen was fixed earlier the same day.

`bf216-ble-view-offset.test.ts` was holding the three sites as named Lane A debt. It now asserts the
view-scoped form in both files. Reverting one site fails it; this was checked by reverting the
strap read.

Not exercised: a real notification on the device. The bytes are identical while the plugin's
offset stays 0, which is the current behaviour, so nothing on the device changes.

<a id="2026-09-28-lane-a-dv19-activity-merge-orphans"></a>

# 2026-09-28 — DV-19: why one walk was three rows, and the two sync defects behind it

## The trace

Device Verification found the 24 Sept treadmill walk as three local rows, and listed twice. The
production rows, read through the read-only endpoint, gave the timeline: `b8083d04` was created
**09:18:27, as the walk started**, with the plan's 40 minutes. `d0231b08` was created 09:59, as it
ended. The device's `4b5c23e0` (updated 09:19:12.887) and the server's `b8083d04` (updated
09:19:13.245) are the same push, 0.4 s apart.

- **The 09:18 row** is a walk ended within seconds and saved at the plan's duration. That is BF-190
  and BF-191 (#1570), which shipped the next day. It was not rebuilt.
- **The orphan** is the push merging on `(user, date, start_time)`. `saveActivityLog`'s overwrite path
  targets that index so a same-minute collision merges instead of wedging the outbox. It keeps the
  server row's id, so the device row it came from is confirmed `synced` and never comes back from
  the server.
- **Two saves 45 s apart** point at `WalkSummary` saving on every mount. Left for Lane B on the entry.

## The fixes

- `sqlite-backend.ts` `applyDelta`: applying a live server activity deletes any other `synced` row at
  the same date and start second. A pending row is kept (its push has not happened), and so is a row
  at another second (the server can hold both). This is the same shape LA-165 gave `set_logs`.
- `adapter.ts` `saveActivityLog`: the index the merge targets covers tombstones, so a new activity at
  the minute of a deleted one landed on the deleted row and stayed deleted. `deleted_at` now clears
  when the incoming id differs. A stale edit to the deleted activity itself carries the same id, so
  delete still wins over it.

Swept the other natural-key upserts. `body_metrics` is keyed by date on the device, and manual
`supplement_logs` carry a local unique index on the same key, so `activity_logs` was the only
id-keyed local table with a natural-key merge.

**Mutation pass:** never revive, always revive (typed NULL), no pending guard, compare the minute
only, and no retire were all killed. The control, `length < 6` for `= 5`, survived.

## Not exercised

The device path. `getLocalStore` is null on the web, so it has a Known-Issues row with the S25 pass
test. The owner's existing orphan clears when `b8083d04` is deleted or changed.

<a id="2026-09-28-lane-a-la114-bucket-mid-rename"></a>

# 2026-09-28 — LA-114: the stress bucket column is named for what it holds

`oura_daytime_stress_buckets.bucket_start` has always held the bucket's midpoint. A join written
the obvious way against a 30-minute series on the :00/:30 grid therefore returned nothing, and
that cost an hour on 2026-09-16. The rename was tried that day and reverted, because every
historical `claude_ro` view migration selected `t.bucket_start` and all of them failed on replay.
**BF-214 ① deleted those migrations**, which removed the blocker. What remains is migration 275's
`COMMENT ON COLUMN`: one replay exemption with its reason, not a dozen.

Migration `202609280647_rename_stress_bucket_mid.sql` is the **first migration named by the UTC
minute** (BF-214 ②). It renames the column to `bucket_mid` and is idempotent, renaming only while
the old name exists. The Drizzle column, the views file and two tests follow. The rehearsal on the
snapshot database kept all 802 rows and their values. The CI replay is clean (275 exempt), and 32
related test files are green.

This also corrected BF-214 ②'s own test. It asserted "numeric order equals string order on the
real directory", which held only until the first timestamp file existed. It now asserts the real
invariant: `NNN_` files keep their order, and every timestamped file runs after them.

**Deploy note:** for the minute an old container overlaps a new one, old code writing
`bucket_start` fails. The ingest cursor advances only on a 2xx, so the device re-sends and nothing
is lost.

<a id="2026-09-28-lane-a-la115-hc-record-converter"></a>

# 2026-09-28 — LA-115: Health Connect's HRV, SpO₂ and HR-series records convert

The pinned plugin's `RecordConverter` returned `record.toString()` for any type without a branch.
Three types the sync reads had none, so their fields were `undefined` and every record was dropped
silently. The patch adds the three branches, written from connect-client 1.1.0-alpha11's own
sources jar (found in the local Gradle cache) rather than from memory. It also fixes the TS union,
which the earlier patch had widened with the wrong HRV type. The five `as any` casts that hid the
gap are removed, and `tsc` is clean without them.

**Kotlin compiled on this machine for the first time from a lane.** It used the Android SDK and
Android Studio's JBR, with Gradle online to fetch its compiler. A deliberate typo failed at the
patched line, so the build compiled the new file. One trap: `npx cap sync android` on Windows
writes pnpm's shortened directory names into `capacitor.settings.gradle`. Never commit that; CI
regenerates it on Linux.

Merging publishes a new APK, because `pnpm-lock.yaml`'s patch hash moved. The device check is
owed (Known-Issues row, `Verify: device` on the entry).

<a id="2026-09-28-lane-a-la137-pull-column-guard"></a>

# 2026-09-28 — LA-137: a guard that runs the pull instead of parsing it

`applyDelta` writes every column it lists, so a field the server's select or the client's mapper
loses is overwritten with NULL on every pull. RV-172 found three and shipped a guard pinned to
those. The general source parser was withdrawn for false positives: nested template literals,
bleeding statement bounds, two upserts per table, and junk snake→camel names.

This guard parses no TypeScript. It generates one server row per delta table with every column
set, reading `information_schema` and creating a parent row for each foreign key; programs →
phase_sets → programs is broken at its nullable edge. It then runs the client's real `pullDelta`
against the real `/api/sync/pull` handler, into the real local schema on `node:sqlite`. From the
statements that actually executed, it reads each column's bound value. NULL, false, 0, NaN or
`'undefined'` mean the field was lost; the fixture never uses those values. It covers all 30 local
tables, the `INSERT OR REPLACE` program tables included.

**It found two, both fixed here:**
- `workout_sessions.session_id` is sent as `programSessionId` (the Drizzle property). The mapper
  read `sessionId`, so every pull NULLed the device's workout→program-session link. Q-131's fix
  had read the same wrong key.
- `day_checkins.food_logging_completed_at` was never mapped, so another device's completion never
  arrived.

Mutation pass, each mutant named by the guard: a select dropping `barcode`, both fixes reverted,
RV-172's coerced `exercise_deloaded`, and a dropped `taken_at`. Control green.

**It deviates from the entry's "Custom Rules step".** It needs Postgres and `node_modules`, so it
runs in `Tests`, where it can execute the code instead of reading it.

<a id="2026-09-28-lane-a-la143-backfill-session-exercise-ids"></a>

# 2026-09-28 — LA-143: `session_exercises.exercise_id` backfilled, under the add/backfill policy

RV-168 made `saveProgram` fill the foreign key, but rows saved before it stayed NULL: 88 of the owner's
112. Migration 295 is migration 099's backfill re-run `WHERE exercise_id IS NULL`, so it cannot
overwrite a Coach-set value. `exercise_library.name` is UNIQUE, so the match is never ambiguous.

The policy's two conditions (OR-182), met as follows:

- **Snapshot, taken and restored.** The pre-image, the 88 NULL ids, was saved before merge. The whole
  loop was rehearsed on the owner's real data (a snapshot database): 88 NULL → 0, the restore from
  the pre-image touched exactly 88, re-applying filled them again, and a second run was a no-op.
- **Count against prediction.** The prediction is 88 for the owner. The migration also checks
  itself: it counts the matchable NULL rows immediately before the UPDATE and raises, rolling
  back, if the UPDATE touches a different number. Dropping `IS NULL` from the UPDATE makes it raise,
  which the test's mutation run showed.

**Owed after deploy:** read the owner's rows in production and expect 0 NULL where 88 were. The undo,
if it is ever wanted, is `SET exercise_id = NULL` on the saved ids.

<a id="2026-09-28-lane-a-la145-date-validity"></a>

# 2026-09-28 — LA-145: every date field that checked a shape now checks for a real day

A date regex accepts `2026-02-31` and `2026-13-01`. Both then reach a `date` column and fail at the
driver (`22008`) as a bodiless 500. LA-145 counted 25 files with the shape regex and 9 with a
validity check, and said the fix was per-file triage, not a sweep.

## Triage, re-measured on `main` today

26 files carry the shape, 16 check validity. Of the other 10:

| file | outcome |
|---|---|
| `admin/timing-baseline`, `dexa-scans`, `measured-rmr` routes | `.refine(isCalendarDate)` on the field |
| `validation/injury.ts` (`startedDate`, `resolvedDate`), `validation/supplement.ts` (window date → `startedOn`/`stoppedOn`) | same |
| `sentry-scrub.ts`, `sync-health`, `health-connect-ingest` | false positives, as the entry said: redaction, and two routes that validate through an import the grep cannot follow |
| `water-log` | **false positive, not in the entry's list**: it accepts a client date only when it equals today or yesterday, both real days, and falls back to today otherwise |
| `validators/chat.ts` | **dead**: nothing has imported it since Q-189 deleted the route. Deleted, along with `validators/tts.ts` beside it, which was dead the same way |

`plan-meal-answers`, in the entry's list, had been fixed since.

## Verification

- Each of the three routes has a new case: an impossible day gets 400 and never reaches the
  repository (`2026-02-31`, `2026/02/30`, `2026-13-01`). The shared fields have a test asserting the
  same, and that real days in both separators (and 2024-02-29) still pass.
- **Mutation pass: removing the refine from each of the five files is killed.** The control (changing
  the error message) survived.
- `pnpm dev` over HTTP: `dexa-scans`, `measured-rmr` and `admin/timing-baseline` return 400 for
  `2026-02-31` and 200 for a real day; timing-baseline still accepts `null` to clear;
  `POST /api/injuries` with an impossible `startedDate` returns 400.
- `docs/module-map.md` named the two dead validators as the validators; it now names the live ones.

## Not exercised

The device. These are server-side validation changes, delivered by the Railway deploy.

<a id="2026-09-28-lane-a-la163-windows-portable-tests"></a>

# 2026-09-28 — LA-163: the full suite passes on Windows

The first local Lane A session measured nine tests in six files failing on the owner's Windows
machine and passing on Linux CI. A local red that is not the diff costs a debugging session each
time, and a lane is about to run here for good (OR-195).

**Result: 1,127 files, 10,618 tests, exit 0 on Windows**, the first clean local run.

## The three shapes

- **Paths compared against `/` literals (four files):** `personal-details-one-editor`,
  `rv208-one-duration-form`, `mutation-schema` and `constants-delivery` built relative paths with the
  OS separator and compared them to forward-slash strings, so an exemption list missed on Windows.
  Each normalises to `/` at the comparison; the expected values are unchanged.
- **A `DATE` read as an instant (one file):** `node-postgres` returns a `DATE` column as a JS `Date`
  at LOCAL midnight, which is 00:00Z on CI and 14:00Z the day before in Brisbane.
  `user-profile-partial-patch` now compares the calendar parts in that same zone, which is what the
  column means. It passes under the machine's zone and under `TZ=UTC`.
- **A timeout (one file):** `check-comment-blindness` runs `check-hex-literals` three times, and one
  run takes 15 s here against ~6 s on Linux. **Profiled: 98% of it is `spawnSync`.**
  `scripts/lib/base-ref.js` starts one `git show` per file for the base comparison, and a process
  spawn is expensive on Windows. The limit is 120 s with that reason written beside it, and the real
  fix, one batched git read, is filed as **LA-167** (Lane O).

## Found on the way

`storage-footprint-real-counts` raced its neighbours in its FIRST test too. #1817 fixed only the
second. `expected 350 to be 349` on a full suite; now a lower bound, and restoring the BF-54 estimate
still fails it.

## Verification

Each fixed test was run on Windows and passes. `user-profile-partial-patch` also passes under
`TZ=UTC`, and the footprint test still kills the BF-54 bug. Then two full suites: the first had the
one remaining footprint race, the second was clean.

## Not exercised

Linux, beyond CI running these same files. The changes normalise inputs and loosen nothing on Linux,
apart from the lower bound and the timeout, both covered above.

<a id="2026-09-28-lane-a-la165-offline-log-edits-local"></a>

# 2026-09-28 — LA-165: the device half of offline log edits, and a confirm guard that never fired

The local-store half of RV-175. With this, Lane B's LA-166 can make the three handlers write
locally and queue, instead of fetching first and losing the change offline.

## What changed

- **A pending mode on the three local writes** (`updateExerciseLogLocally`,
  `deleteExerciseLogLocally`, `deleteWorkoutSessionLocally`). The default still writes `synced`,
  which is right after a 2xx. `{ pending: true }` is for an offline write, so a pull that lands before
  its push cannot restore the old sets or resurrect a deleted log.
- **Confirms for the three new domains**: `markExerciseLogSynced` and `markWorkoutSessionTreeSynced`,
  dispatched from `sync-engine`'s push-confirm loop.
- **An edit that adds a set now shows it.** `updateExerciseLogLocally` only ever UPDATEd, so an added
  set appeared nowhere until a pull. It now inserts a missing set, and clears `deleted_at` on a
  re-added one, as the server's upsert does. The pull's `set_logs` apply then drops a SYNCED local
  copy of the same `(exercise_log_id, set_number)` in favour of the server's row, so the set is not
  shown twice. A pending copy is left alone.

## The bug found on the way

`markSessionSynced` guards its flip with "is another mutation for this session still queued?". The
confirm loop runs **before** `deleteMutations` removes the batch, so the guard counted the mutation
it was confirming. **Proven against a real SQLite:** a session whose only queued mutation was
confirmed stayed `pending`. By the code (not observed on a device), the stranded-workout sweep then
found it five minutes later and re-queued a `workout_log` push for every exercise in the session,
and only that re-push flipped it back. So every session RPE and every outbox completion cost a full
re-upload of the workout. One helper, `otherQueuedMutations`, now serves all three guards and excludes
the batch being confirmed. That includes siblings confirmed alongside it, which are also still
queued during the loop.

## Verification

- `la165-offline-log-edits-local.test.ts`, 12 cases on a real in-memory SQLite: pending vs default;
  added, truncated and re-added sets; the pull replacing a synced local copy and sparing a pending
  one; each confirm, a later queued edit holding the flip, and `markSessionSynced` both with and
  without the batch ids.
- `sync-engine` dispatch: all four confirms receive the batch ids, and the batch is deleted.
- **Mutation pass: 6 killed, 1 control survived.** Killed: the guard counting its own mutation again;
  the edit ignoring `pending`; the dedupe also dropping a pending set; no dedupe; an added set not
  inserted; batch ids not passed.
- The four SYN-4 tests asserted `sync_status='synced'` in the SQL text; the status is a bound
  parameter now, so they read the parameters. Flipping the default to `pending` still fails them.
- All 19 local-store and SQLite test files pass (272 tests).

## Not exercised, and one known edge

The device: `getLocalStore` is null on the web, so nothing here ran outside the test harness. A
Known-Issues row carries the S25 pass test. **Edge left:** if a push is applied on the server but its
confirmation is lost, the locally added set stays pending while the server's copy arrives, and the
two coexist until a later change re-sends the server row. Client-supplied set ids in the edit payload
would close it.

<a id="2026-09-28-lane-a-la168-rollup-workout-window-overlap"></a>

# 2026-09-28 — LA-168: a rollup pass no longer thins a workout it cuts through

## What was wrong

The BLE rollup bins ring HR at 15 s inside a workout (±10 min) and at 5 minutes elsewhere. It
rewrites its HR window every pass, upserting what it regenerates and deleting the other `ble` rows
from its cutoff forward. The workout windows came from `readWorkoutWindows(since)`, which selected
sessions whose **start** was at or after the cutoff. The incremental cutoff is the watermark minus
3 days, and it slides forward pass by pass. So a pass whose cutoff landed inside a workout (after its
start, before its end plus pad) did not see the workout. It re-binned the rest of the session at
5 minutes and deleted the 15-second rows.

**Production evidence.** For 09-06 the stored rows switch from 15-second to 5-minute spacing at
09:43:42, 45 seconds after the 09:42:57 start. Every 5-minute row carries `updated_at` 09-09 13:01,
three days later. Snapshot-against-now counts for ring-only sessions: 180 → 13, 103 → 12,
110 → 31, 32 → 5, 87 → 52, 164 → 99. Strap sessions are unaffected where the strap covers.

## The fix

- `rollup-io.ts`: the read now selects workouts that **overlap** the cutoff: unfinished, or completed
  at or after it, bounded to a day before it.
- `run.ts`: passes the cutoff minus the 10-minute pad, so a session that ended just before the cutoff
  still owns its padded bins.

`oura-ble-workout-window-overlap.test.ts` has three cases: a cutoff mid-workout, a cutoff in the pad
of a finished one, and a cutoff inside an unfinished one. All three fail before the fix and pass after it.
**Mutation pass:** reverting to start-only failed all three, removing the pad failed the pad case,
and dropping the unfinished arm failed its case. The control, a 48-hour look-back, which is
equivalent here, passed as it should.

## Not done

Rows already thinned stay thinned. Recovery needs a full-window rollup and reaches back only 14 days.
The Known-Issues row records that and the owner decision. Server-only change, so no APK is needed.

<a id="2026-09-28-lane-a-la170-evaluate-finished-day"></a>

# 2026-09-28 — LA-170: a finished day gets a whole-day training-load verdict

TN-79's read showed `/api/training-stress` only ever evaluating today. It re-persists on every call,
so a day's stored gate was the last evaluation made during that day, and a morning one cannot pass
the 720-minute MET floor.

- **Migration 292** adds `oura_daily_derived.training_load_evaluated_at`. It is the first real
  migration after BF-214, so `claude-ro-views.sql` was regenerated in place, and the diff is the one
  column. Like `acwr` it is server-only: in `DERIVED_COLS` and the push branch so the drift tests
  hold, and absent from the device mirror, so a device never sends it.
- **The route** stamps every write. When today is read, it re-evaluates yesterday in the background
  if yesterday's verdict was stamped before yesterday ended, or was never stamped. A verdict
  computed after the day's end is final, so this runs at most once per day.
- **Noted for the device rollup (OR-123):** the gate and grid columns are in the device mirror.
  Nothing on the device writes derived rows today, but once the on-device rollup pushes them, a
  stale pulled gate could overwrite a final one. Revisit then.

**Mutation pass:** no yesterday pass, inverted finality, the gated arm left unstamped, and the pass
also firing on an explicit `?date=` were all killed. The control survived.

**Not observed yet:** the production effect, which needs a day past deploy. TN-79 names the read.

<a id="2026-09-28-lane-a-la174-migration-tests-use-helper"></a>

# 2026-09-28 — LA-174: migration tests run their SQL through the helper built for them

`planned-pct-bodyweight-migration.test.ts` deadlocked under the full suite and passed alone. The repo
had already solved this class: `runMigrationSql()` prefixes `LOCK TABLE users IN SHARE MODE`, so a
table-wide data migration cannot interleave with the suite's user deletes (DV-3). That test called a
bare `pool.query(migrationSql())` instead. **Eight migration test files did the same.** The advisory
lock they all take only serialises migrations against each other.

- All eight now call `runMigrationSql`. `q228`'s idempotency case reads the query result, so it takes
  the last entry of the multi-statement result.
- **No retry.** `migration-test-lock.ts` explains why (Q-171), and it was followed.
- A static test fails if any file that takes the migration lock runs migration SQL with a bare
  `pool.query`; putting one bare call back fails it.
- The 12 migration test files pass 65/65.

Out of scope: `q536-merge-redrain-clock-epochs` runs an Oura clock-epoch migration without the lock
helper. Its tables are not the shared workout tables this deadlock involved.

<a id="2026-09-28-lane-a-la36-food-item-image-local"></a>

# 2026-09-28 — LA-36: the device's food reads carry the picture

BF-35 stores a food's picture on the device as bytes, precisely so it renders offline, but all
three local reads dropped it. `searchFoodItems` used `SELECT *` and the mapper skipped the column.
Recent foods and the item embedded in a day's logs never selected it. The server's `rowToFoodItem`
returned it from every read, so the canonical runtime was the one surface losing the field. All
three now return `imageDataUri` (null when absent). An in-memory SQLite test fails on all three
with the fix reverted. The 74 local-store and nutrition test files pass.

No list renders a food item's picture yet, so this changes nothing on screen by itself. The
render is Lane B's, and the entry is re-laned there.

<a id="2026-09-28-lane-a-la61-normalise-email"></a>

# 2026-09-28 — LA-61: one account per email, whatever the case

Registration lower-cased and trimmed an email before storing it. The Google sign-in path passed the
provider's raw value to three lookups that used an exact match. Google lower-cases in practice, so
this never fired, but a differently-cased address would have made a second account or missed an
invite. The owner approved both halves: normalise on the way in, and add the functional index.

- **Code.** `normalizeEmail` (`packages/shared/src/validation/email.ts`) now runs inside the
  repository on every write and every lookup: `upsertUser`, `createEmailUser`, `addInvite`,
  `getUserByEmail`, `isInvited`, `removeInvite`, and the friend-request lookup. Lookups compare
  `lower(email)`, so a row the migration left alone is still found. The three route-level inline
  `.toLowerCase().trim()` calls are replaced by the helper.
- **Migration 296.** It records a pre-image of every rewritten address in
  `email_normalisation_preimage`, which sits on `claude_ro`'s DENIED list and is exported as
  third-party. It then rewrites `users` and `invited_emails` with a count self-check, and builds
  unique `lower(email)` indexes. A row whose normalised form another row already holds is left
  exactly as it was, and if that happens the index is not built. Both emit a NOTICE. Merging two
  accounts is a human decision.
- **Rehearsed on the snapshot database:** the owner's single row was already normal, so there was
  nothing to rewrite, and both indexes were built. Other accounts cannot be seen from here
  (`claude_ro` is owner-scoped), so the migration's guards handle them instead of a count. The
  pre-image table is their snapshot. It is exact and inside the same transaction, and undoing it
  is one UPDATE per table.
- **Tests.** There are two files, one for the migration (throwaway database) and one for the
  repository. Mutation pass: 11 of 11 mutants killed (5 in the migration, 6 in the adapter), and
  both equivalent controls stayed green.

Not exercised: a real Google sign-in. This path runs through NextAuth's callback, which the suite
does not drive.

<a id="2026-09-28-lane-a-la65-mixed-sets-reference"></a>

# 2026-09-28 — LA-65 becomes a Reference, and BF-197 is unparked

The owner answered LA-65: five exercises at two sets fill the hour, so the transition constant
stays as it is. He also wants to mix 2-set and 3-set exercises. The check LA-65 asked for,
whether anything forces a uniform set count, came back no. The budget stage (`expandToBudget`,
`fitToBudget` in `time-budget.ts`) sizes sets per exercise, one set at a time by role priority, so
a mixed session comes out of it naturally. `la65-mixed-set-counts.test.ts` pins that. LA-65 now
carries `Reference:` as its own text asked.

**This unparked BF-197.** Its `Needs:` line read "— nothing. Supersedes … `LA-65`", and the
parser takes an ID on that line as a dependency. Once LA-65 became a permanent Reference, that
would have parked BF-197 for good. The "supersedes" note now has its own bullet, and BF-197 lists
as READY.

<a id="2026-09-28-lane-a-la82-hr-profile-degrade"></a>

# 2026-09-28 — LA-82: the HR profile degrades on a failed read, and names what it assumed

`resolveHrProfile` guarded one of its three reads. A transient fault in `getUserById` or
`listBodyMetrics` took down every caller: the cardio hub, cardio trends, zone minutes, the HR
profile, both HR server pages, and three shared computations. It also made the hub's own four
`.catch`es on `listBodyMetrics` unreachable. All three reads are guarded now, and so is the hub's own
copy of the user read.

As decided on 2026-09-25, the failure is carried in the existing source fields rather than hidden:

- `maxHrSource: 'estimated-age-unread'` is only set when the estimate actually wins. A corroborated
  observed max above it makes the age irrelevant.
- `restingHrSource: 'unavailable'` is separate from `'default'`, which still means "no readings".

Both are exposed on `/api/cardio-week`'s `heart` block. **Rendering them is Lane B's**, and LA-82
stays in the queue re-laned to B with that as its remaining work. Until then, the Health card shows
an age-unread max as an ordinary estimate.

**Mutation pass:** an unguarded user read, no marker, the marker applied over an observed max, no
`unavailable`, and an unguarded route read were all killed. The control (log wording) survived.

<a id="2026-09-28-lane-a-la89-delete-hr-sync"></a>

# 2026-09-28 — LA-89: `/api/oura/hr-sync` deleted, with the evidence it was dead

Approved 2026-09-27 on condition the route was proved dead first. The evidence:

- **No caller in code.** In `app/`, `lib/`, `packages/`, `components/`, `android/`, `scripts/` and
  `public/`, the only references were tests and two comments in `complete-workout` recording that its
  POST back to this route was replaced by an in-process call (Q-122).
- **Nothing reaching it in production**, as far as can be seen: zero `error_events` rows name it
  since the table's oldest row (2026-08-30). That is owner-scoped and failures-only, so it is
  supporting evidence, not proof. The code search is the proof.
- **What it wrapped stays.** `syncAndAttributeSessionHr` is still called by `complete-workout` and the
  outbox's `complete_workout` branch.

Removed with it: its cases in `final-backfill-calibration-routes.test.ts` and
`rv55-56-route-input-500s.test.ts`. The module map and `docs/oura-ble-operations.md` §6 now list
five `app/api/oura/` routes.

<a id="2026-09-28-lane-a-lb118-sore-provenance-signals"></a>

# 2026-09-28 — LB-118: the explain page can tell a suggested sore tick from a chosen one

The next-session `signals` block, which the "Why this?" page renders, carried the check-in's
`soreMuscles` without the provenance the scorer was fed twenty lines above it. It now carries
`suggestedSoreMuscles` from the same mood log, `null` when the check-in predates provenance. That is
what LB-117 (Lane B) needed. Fetching `/api/mood` separately on the page was the wrong answer: it
could be a different check-in from the one behind a cached recommendation. The type field is
optional, so a stored payload from before this still parses. The DB test covers both the value
and the null, and removing the field fails both cases.

<a id="2026-09-28-lane-a-lb150-today-envelope-user-tz"></a>

# 2026-09-28 — LB-150: the "today" cache envelope keys on the user's day

`cachedFetchToday` stamped its `{date, data}` envelope with the bare `todayInTz()`, and
`unwrapToday` checked it the same way, so both used Brisbane. They agreed with each other, which is
why no test saw it. But every server route computes "today" in the user's zone, so for a New York
user a reading from their previous day passed the guard for 14 hours of every 24. About ten keys
write the envelope and fourteen read it.

- `lib/sqlite/cache.ts` holds the user's timezone (`setCacheTimezone`). The stamp and the check both
  read that one value, so they cannot drift apart, which is the failure a stamp-only or check-only
  change would create.
- `UserTimezoneProvider` sets it **during render**, before any child's mount-time seed read. Before
  it is set, the value is the Brisbane default, so the owner's behaviour is unchanged.
- **Tests:** at 20:00 UTC (the 4th in Brisbane, the 3rd in New York), a New York user reads the 3rd's
  entry, refuses the 4th's, and a fetched payload is stamped the 3rd. The provider's call is pinned in
  its source, because the node-only vitest cannot render a `.tsx` component. Mutations: a
  timezone-blind check (3 failures), a timezone-blind stamp (1) and an unwired provider (2) were all
  killed.

**Not device-verified, and it does not need to be for the owner:** a Brisbane user is unchanged. The
effect is for any other timezone.

<a id="2026-09-28-lane-a-lb151-push-in-flight"></a>

# 2026-09-28 — LB-151: the outbox drains once at a time, and a latecomer's mutation still goes

`pushMutations` had no concurrency guard, and eleven call sites reach it: the pull gesture, the
sync-health card, push-then-revalidate and the per-domain writes. Two overlapping calls both read the
same pending rows and both sent them.

## First, the question the entry said to settle: wasteful or wrong?

**Wasteful, for the writes that matter most.** Completion is stamped `WHERE completed_at IS NULL`,
and the phase counter increments only on a real stamp. `logExerciseFromPayload` ensures the session
by the client's id and upserts the log. So a double drain doubled the upload, not the data. That set
the bar: a guard that must not lose anything, rather than an urgent correctness fix.

## The guard

A per-user single flight **plus one trailing drain.** The naive version, handing a latecomer the
running drain's promise, would be wrong in a quieter way. That drain read the outbox before the
latecomer's mutation existed, so the mutation would sit until some later push. Instead, every caller
that arrives mid-drain shares one trailing drain that starts when the first finishes. The body is
now `pushMutationsOnce`; `pushMutations` is the wrapper.

## Verification

- Four tests: latecomers share one trailing drain and nothing goes out while the first is on the
  wire; a finished drain lets the next start fresh; a failed drain does not wedge the next; and a
  SECOND wave of latecomers gets its own trailing drain.
- **Mutation pass: 4 killed, 1 control survived.** Killed: no guard; latecomers handed the running
  drain; the running entry never cleared; the trailing entry never cleared. The last one survived at
  first, because a single wave cannot see a stale trailing promise; the second-wave test was written
  for it and kills it.
- The two DV-8 source-scanning tests located the drain by the text `export async function
  pushMutations`, which is now the wrapper. They point at `pushMutationsOnce`, where the heals live.
- All 27 client test files that touch `pushMutations` pass (307 tests).

## Not exercised

The device, where the eleven callers actually overlap. The behaviour is pure JS with no native
dependency, so the unit tests exercise the real code path.

<a id="2026-09-28-lane-a-lb153-one-chart-palette"></a>

# 2026-09-28 — LB-153: one categorical palette, and none of it means good or bad

The owner's decision (2026-09-27) was to merge the three index palettes, set cards included, with no
colour that also means good, warning or bad elsewhere. Set 1 had been amber and set 2 green, which
read as a verdict on the set.

- `CATEGORICAL_PALETTE` and `categoricalColor(i)` in `packages/shared/src/chart-colors.ts`, beside
  `resolveColor`. Six hues from blue through pink (sky, violet, pink, indigo, cyan, fuchsia). Past
  six, the golden angle steps within the same 200°–330° band, so it can never land on green, amber
  or red.
- Converted: `setColor` (the set cards and the PiP view), the AI chat charts' default series
  colours, and the HR-recovery traces. The swept sibling, `calibration-card.tsx`'s `RATING_COLOR`,
  is a good→bad **scale**, so it keeps its verdict colours on purpose.
- The hex-literal baseline lost two rows (chart-message and hr-recovery-chart now hold none).
- A test pins the rule: no palette colour matches a verdict or ACWR band colour, and the generated
  tail stays in band. Putting green back fails it, and so does a full-wheel tail.

**The specific hues are Lane A's call, reversible in one constant.** The owner set the rule, not the
colours. **Not seen on a device:** the set cards are the surface he sees every session, so a
look on the S25 is owed. DV can confirm the colours render; whether they look right is his.

<a id="2026-09-28-lane-a-lb156-register-cache-keys"></a>

# 2026-09-28 — LB-156: five cache keys registered with the groups their writers call

LB-155's remaining bare-`fetch` conversions were blocked on five keys no group cleared. Re-verified
first: `phase-sets` and `workout-templates` were already in `invalidateProgramStructure`. The other
three:

- `day-checkin:` joined `invalidateCheckinAffectsPrescription`, the group the check-in POSTs call.
  Only `invalidateNutritionWrite` cleared it before, so a converted reader would have been evicted
  by a food log and left stale by the check-in that changed it.
- `bedtime-estimate` joined `invalidateBiometrics` and `invalidateOuraSync`, both sleep writers.
- `plan-meal-answers:` joined `invalidateNutritionWrite`. **Its writer calls no group at all**, so
  LB-155 must make that POST call it. This is recorded on LB-155.

Tests assert each group clears its key. Removing the check-in registration fails its test.

**Also re-sequenced Q-231** (retire the "Exercise detected" card): the surface half goes first,
because removing the route first would leave the card's GET and three review-sheet PATCHes hitting a
404. It is now Lane B. `repo.getOuraWorkouts` stays, because HR-recovery episode detection reads the
frozen rows.

<a id="2026-09-28-lane-a-lb170-rate-limit-flush-accepted"></a>

# 2026-09-28 — LB-170: a rate-limit increment lost on deploy is accepted, and now says so

The limiter's flush to Postgres runs after the response, and nothing awaits it. So a deploy that
replaces the container mid-flush drops that increment. LB-170 asked for a judgement, preferring a
recorded decision unless draining on shutdown was cheap.

**It is not cheap.** Nothing in the app handles SIGTERM, and there is no lifecycle layer
(`docs/module-map.md` §0), so draining would mean inventing process-level hooks for a counter. The
loss is a count low by the few requests in flight during one deploy, the same class as the cold-replica
lag the file's header already accepts. `lib/rate-limit.ts` now records that decision beside the
other one, along with LB-168's warning not to drain in the shared test setup.

Comment-only change; nothing to test. LB-170 leaves the queue.

<a id="2026-09-28-lane-a-lb177-socket-url-probe-tests"></a>

# 2026-09-28 — LB-177: probe-database tests work on the Unix-socket URL

Two migration tests create a throwaway database: LA-143's, and LA-61's from earlier today. Both
built its URL with `new URL(DATABASE_URL)` and a `pathname` rewrite. `setup.sh` writes a Unix-socket
URL (`postgresql://u:p@/db?host=/tmp&port=5433`) whose empty host makes `new URL` throw. The file
then failed while its tests read as skipped, so `pnpm test` exited 1 with nothing failing.

`withDatabase(url, name)` in `migration-test-lock.ts` swaps only the path segment after the `@`,
so it handles both forms. Both files use it now, and they RUN on the socket form rather than
skipping. This was checked with the socket-shaped URL `@/db?host=localhost&port=5434`: the old code
threw `Invalid URL` and the new code passes 10 of 10. `lb177-with-database.test.ts` pins the helper
and fails if any test in that directory sets `url.pathname` again.

LA-159's held branch (#1847) has a third copy. It will pick this up when it next merges `main`.

<a id="2026-09-28-lane-a-lb95-personal-records-route"></a>

# 2026-09-28 — LB-95: a route that reads personal records with their dates

`personal_records` had no read that kept the date: `listPersonalRecords` returns a name → 1RM map,
and `/api/weights-summary` reports only the active program's exercises. BF-133's detail section
requires every value to carry the date it was read, so neither source could feed it.

`GET /api/personal-records` returns the caller's records for every exercise, newest first, each
with `achievedAt`. It reads through a new `listPersonalRecordsDated` placed beside the old map
read, whose 10 call sites keep their shape. The route test (real Postgres) pins the order, the
dates, and that another user's record never appears; mutating the user filter or the order fails it.

Not exercised: a signed-in `pnpm dev` call. The test drives the real handler against the database,
with only the session mocked. LB-95 is re-laned to B for the More-screen group.

<a id="2026-09-28-lane-a-local-snapshot-port"></a>

# 2026-09-28 — the admin DB snapshot was cut off at `pg_stat_statements`, and the loader committed what it got

Setting up a persistent Lane A environment (owner's goal: a local agent with a prod-shaped test
database that survives between PRs) was the first real use of `pnpm db:snapshot` on this machine,
and it found four defects.

- **Server (production):** `/api/admin/db-snapshot` streams every `claude_ro` view, and one of them,
  `pg_stat_statements`, has no public base table. `getPrimaryKeyColumns` threw on it, so every
  snapshot ended after `personal_records`, with `users`, `workout_sessions`, `set_logs` and 28 more
  missing. The stream reported it only as a trailing `{"error"}` line after a 200. Views with no
  base table are now omitted with a reason.
- **Loader:**
  - It ignored that error line and TRUNCATE-then-committed, emptying every table the stream never
    reached. It now refuses a failed stream before touching anything, and checks the per-table
    counts *before* COMMIT, rolling back on a mismatch.
  - node-postgres binds a JS array as a Postgres array literal, so a json/jsonb column holding an
    array failed with "invalid input syntax for type json". Those values are now stringified.
  - A view can carry a computed column the table lacks (`food_items.image_bytes`, four `has_*`
    flags on `oura_tokens`). Only the target's columns are loaded, and the rest are named.
  - The port guard was pinned to 5433 and it ran `setup.sh`, which assumes the cloud container's
    cluster. The port now comes from `LOCAL_DB_PORT`, and the step runs `migrate.js` against the
    target.

`docs/local-agent-environment.md` §④ records the persistent-worktree setup: one worktree per lane,
installed once (12.5 s), its own `.env.local` with no production database, and its own database
that can be rebuilt or snapshotted.

**Not verified yet:** a full successful load. It needs the server fix deployed. Checked instead:
the loader refuses the current broken stream and leaves the seed intact (1 user, 9 sessions).
