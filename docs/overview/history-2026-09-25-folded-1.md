# Session journal — batch folded 2026-09-25

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-09-24-chore-or-159-owner-decisions"></a>

# 2026-09-24 — four owner decisions answered, and the clinical baseline leaves the public repo

**Branch:** `chore/or-159-owner-decisions` · **Lane:** O · docs + `scripts/private-paths.json`

The owner asked where things stood and what needed him. Four questions were put in one sitting, each
with a recommendation first, per **Decisions That Come Back To Me**. All four came back.

## What he decided

| | Decision |
|---|---|
| **Branch protection** | **Keep parked** — asked a second time, with the correctness framing rather than the throughput one. |
| **TN-64 — readiness gates nothing** | **Extend the recommender to `ai_dynamic` and persist ACWR**, keeping his confirmation step. |
| **RV-199 — three privacy items** | **Apply all three.** |
| **RV-113 — the tab-switch blink** | **Leave it.** |

## The clinical baseline is out of the tree

`docs/clinical-baseline-2026-08-27.md` held a DEXA, an RMR, a 58-analyte blood panel, the provider's
scan reference and the instrument serial — in one file, in a public repo. It is removed, registered
in `scripts/private-paths.json` under a new `personal-health` kind so CI refuses it back, and the
**nine** links to it are repointed to plain text. He was sent the file before it was deleted.

**A fact the recommendation had not accounted for, found by reading the document instead of the
entry describing it:** it called itself the *durable* copy, and `BF-2`, `BF-33` and `BF-1` were each
filed waiting on exactly these values, with BF-41's own rule requiring its schemas be written from
the real report. This was working data. That did not change the decision — it changed the execution,
from a silent delete to pointers that tell a future entry where the values went.

**Two things deliberately not done, both reversible by him:**
- **The derived figures stay** — the 28.5 % vs 25.3 % scale pair, RMR 1325 vs 1549, the Cunningham
  comparison. A figure in engineering prose is a different exposure from a panel with a scan
  reference, several entries reason from them, and they are in git history either way.
- **No history rewrite.** Declined inside the recommendation he accepted: irreversible, breaks every
  clone and open PR. **The data remains in public git history** — removing the file does not undo
  that, and the entry says so rather than implying a clean removal.

## Where the other three went

**TN-64** was `Lane: O` only because it needed his call on what the app should *do*. He made it, so
it re-laned to **A** the same hour, with the build split three ways: persist ACWR first (nothing
stores it, which is why half this entry's finding was inference), then widen the
`phaseMode === 'automatic'` condition, and keep `POST /api/confirm-early-deload` in the path — the
app proposes, he confirms. The entry now says explicitly **not** to move the 45 / 1.2 thresholds in
the same change, because then nobody can tell whether a prompt fired from the gate opening or the bar
moving.

**RV-113 was removed and then REINSTATED in the same PR, because the owner reversed it.** Asked
whether a blink was worth one line, he first said leave it. Told the reasoning — and told that the
blink's visibility had never actually been established — he answered: **"speed/performance/efficiency
when switching pages tabs is my highest priority. If this can fix speeds do it."**

**So it is built, and the entry now carries a warning against the claim he was sold it on: it removes
a BLANK, not a DELAY.** The 58–109 ms gap is the same frames as `DV-12`'s long task, and that task is
what costs the time. Dropping the opacity ramp shortens it by nothing; it paints the content during
the block instead of leaving the user on the background. Real perceived-latency win, zero throughput
win — and worth stating loudly, because the pass test (`perf.js longtasks`) will show **no
improvement** and someone will read that as failure.

**`DV-12` re-laned `DV → B` and moved to position 2, batched with RV-113.** That is the entry holding
the 68–118 ms, and **it was parked on a measurement that has since been taken**: its own *"Not
established"* asked for a CPU profile to name what dominates the task, and sweep 3 ran it — the canvas
`font` setter, 7–48 ms, under chart.js `update → _tickSize → _computeLabelSizes → set font`. Every tab
switch re-runs a chart.js update that re-measures axis labels. That is CLAUDE.md's trap (b) exactly,
*a probe already run is no longer DV's*, and the entry's own text already said to hand it back to B
with the profile attached. What is left — which chart — is a grep, not a phone.

**The two ship together.** Content painted promptly on top of a blocked main thread still reads as
sluggish; the pair is what he asked for.

**Branch protection was asked twice and parked twice.** What it costs is written onto `LB-52` so the
next session inherits the reasoning instead of re-deriving it: every merge stays hand-caught against
a base moving every ~8 minutes, and a green merge is still no evidence the checks passed. The
mitigation is a habit, not a mechanism. The entry now says **do not re-ask without a new fact.**

## One approval that was not an answer

RV-199's third item recommended *"exclude the cookie store, and decide on the ring key
deliberately."* Reading "all three" as approving a ring-key answer would have been putting words in
his mouth — he approved the decision being **taken**. So item ③ split: the cookie exclusion is
`OR-159` (Lane A, decided), and `OR-160` asks the ring-key question on its own, with the recommendation
to back it up encrypted. That one matters more than its size: an uninstall destroys the ring's BLE
key permanently, and a backup is the only thing between him and that. `OR-159` carries a warning not
to settle `OR-160` by implication while editing the same manifest.

## Verification

`pnpm check:rules` — **Ran 78 of 78**, all passed, including the broken-relative-links step that the
removal initially failed with four links in the backlog. `check-backlog-pointers` — OK, 489 entries,
no duplicates, no cycles.

No product code changed. Items ② (a GitHub account setting) and ③ (`android/**`) are not the
Orchestrator's to execute and are routed rather than done.


## Amendment — the perceived-latency sweep (OR-161, OR-162, OR-163)

The owner followed his RV-113 reversal with a wider instruction: *"Perceived latency is just as
important. We need to do another check to make sure we apply the same logic everywhere."* Three
entries, and the third is the honest one.

**`OR-161` — the correct pattern is 50 lines above the broken one.** `app/globals.css` holds both
transitions. The route push/pop (`ta-axis-y-in`/`-out`) fades the outgoing screen out by 40 % and
holds the incoming at 0 until 25 %, a deliberate overlap whose own comment says *"the screen is never
fully empty mid-transition."* The tab switch has no outgoing half at all. So RV-113's fix does not
need inventing.

**Two code comments assert the defect does not exist** — *"this animates content that is already
painted"* in the CSS and *"content that is genuinely there"* in `tab-shell.tsx`. Both are false
against RV-113's measurement, and they are why it survived a year of reading. They get fixed in the
same PR: a comment denying a defect is worse than no comment.

**`OR-162` — DV-12's mechanism, confirmed from source rather than the phone.** Its profile guessed
*"a responsive resize when a panel leaves `content-visibility: hidden`"*, and the source bears it
out: `tab-shell.tsx:205` un-lays-out every hidden panel, so on reveal every `<canvas>` inside goes
from no box to a real one and chart.js re-measures its axis labels. All three charts sampled are
configured the way that arms it (`responsive: true, maintainAspectRatio: false`); 20 files import
`react-chartjs-2`. **The obvious fix is a regression** — removing `content-visibility` re-introduces
the 21.3 % main-thread burn it was added to stop — so the entry says to ask why the update fires
before optimising what it does.

**`OR-163` — and this one exists because the first two are not the sweep.** They came from following
two known defects outward, aimed at one interaction. Filing them as the answer would be the LB-108
failure again: a result computed from the wrong starting set that looks complete. So OR-163 states
the method instead — the two classes kept apart, a third (first paint, where CLAUDE.md already bans a
repeat-visit skeleton flash), interaction-first rather than file-first, and a before-number required
per finding, because perceived latency is exactly where an unmeasured improvement is
indistinguishable from a preference.

Two gaps recorded rather than worked around: **there is no `Lane:` value for Review**, whose work this
is, so it sits in `O` alongside the same gap `OR-150` notes for Tuning; and **the device agent's
session is archived** while its title still ends in 🟢, so the session list reads as though it is
live. Class 2 needs it.

<a id="2026-09-24-chore-rv-189-queue-re-read"></a>

# 2026-09-24 — RV-189: five entries removed, four rerouted, and a park with no field to hold it

**Branch:** `chore/rv-189-queue-re-read` · **Lane:** O (Orchestrator) · docs-only

Review sweep 59 re-read 59 READY entries in Lanes A and B against the code and filed `RV-189`
listing what should leave the queue. This is the Orchestrator acting on it.

## Every removal was re-verified, not taken from the sweep

Scans of this file have overstated reality five times in this session, so each of the five
"already shipped" claims was checked against the code or the merge before the entry was cut:

- **LB-123** — `shouldCache?: (data: T) => boolean` exists at `lib/sqlite/cache.ts:279`, guards the
  `setCached` at `:386`, is threaded at `:443`/`:449`, and `done-screen.tsx:125` passes it. Shipped.
- **LB-114** — `batteryConfidence` now reads `sufficient: sampleCount > 0 && (…)`
  (`packages/shared/src/health/body-battery-inputs.ts`), which closes both the 00:00–01:00 and
  07:00–08:00 windows. Shipped.
- **Q-272** — #1521 landed the rebalance; its stated residue is `LA-134`, which exists as its own
  entry, so nothing is lost by removing the parent.
- **Q-3b** — both halves closed inside the entry: (a) tried and rejected, superseded by the awake-time
  fragmentation cap; (b) re-investigated and does not reproduce.
- **Q-112** — umbrella, children a–e all merged, and `/health/day` exists. Its `Needs: Q-112e` pointed
  at an entry already gone.

## The one that changed something else

Removing `LB-123` cleared `RV-79`'s `Needs:`, and `RV-79`'s body said in two places that no
`shouldCache` option exists. Left alone, the queue would have offered a buildable entry whose text
argues against building it. Both passages are corrected in place and the measurement under them is
kept — it is what justifies passing the predicate.

## Three entries whose own verdict is "don't build" became `Reference:`

`RV-77`, `Q-28` and `OR-137` each concluded, in their own bodies, that the change should not be made,
and each kept printing as work. `Reference:` is the field for an entry that exists to be read; the
reasoning is worth more than the queue slot it was occupying. `OR-137` says explicitly to revisit the
moment `feedback_submissions` is non-empty — the first real report is both the reason to build it and
the fixture to test it with.

## A scoring question that was invisible because it sat inside another entry

`TN-9` carries two halves under one owner sign-off. The check-in half has a chosen mechanism; the
`activityBalance` half offers two options and picks neither, which makes it a scoring change with no
proposal. Split out as **`OR-155`** with `Needs: OR-150`, per the rule that a decision buried in
another entry's body does not get routed. `TN-11` joins it on the same test, taking `OR-150` from
thirteen to fifteen.

## What could not be expressed, and was not faked

`RV-189` asked for `LA-134` to be parked. It cannot be. `next-item.js` parks on exactly three things
— an unmet `Needs:` naming another entry, a `Gate:` of `owner` or `device`, and the legacy prose
marker — and `LA-134`'s blocker is the **calendar**: its fit needs days that do not exist until
2026-10-04. Borrowing a field that names the wrong blocker would have made the queue read correctly
and mean something false, so the entry stays READY with the date stated at the top of its body, and
the gap is filed as **`OR-157`** (an `Until: YYYY-MM-DD` field that clears itself with no edit).

`OR-157` is deliberately not built here. It has exactly one live case, which is the honest argument
for waiting; the entry says to build it on the second case, or sooner if `LA-134` is picked up and
dropped once.

## Also

- **`TN-37`** was printing READY while its own step 3 says *"do not start without its own plan"* and
  no plan exists. Filed **`OR-156`** for the plan and pointed `TN-37`'s `Needs:` at it. The plan entry
  records the trap the sweep caught: skimming step 2 as "drop the reads" disables wear filtering on
  the HRV and RHR baselines.
- **`TN-53`** re-laned B → A. What is left is a diagnosis whose evidence points engine-side, and
  handing a surface lane an undiagnosed defect produces a guess at the render layer.
- **`Q-48`** re-laned A → O. Its migration halves shipped; what is left is planning.

## A trap hit while writing this

`OR-157` had to quote the legacy park marker to explain the gap, and quoting it **parked `OR-157`** —
the detector matches the glyph followed by the word within 40 characters. Same shape as the duplicate
`Lane:` field TN-63 caught twice. The entry now describes the marker instead of printing it.

## Verification

`pnpm check:rules` — **Ran 78 of 78**, all passed. `check-backlog-pointers` — OK, 485 entries, no
duplicates, no cycles, all `Needs:` targets known. Queue is **−127 lines** net despite three new
entries.

Nothing here touches product code, so no runtime surface was exercised and none needed to be.

<a id="2026-09-24-docs-dv12-gate-device"></a>

# 2026-09-24 — DV-12 and OR-162 head a lane they cannot be started from

**Branch:** `docs/dv12-gate-device` · **Lane B** (LB-145) · docs-only

`#1587` shipped half the `tab-switch-speed` batch and left `DV-12` + `OR-162` open, because the
measurement they turn on needs the S25 and the Device Verification session is archived. Both then
rose to the top of Lane B's READY list — **work nobody can start, heading the list of what to start
next.**

This is exactly the defect `LB-142` fixed on `RV-166` a few hours earlier, and I walked into it from
the other side. `RV-166` was blocked by a question and said so in prose inside its `Lane:` line;
these two are blocked by hardware and said so in prose in their body. `next-item.js` reads fields,
not paragraphs, so in both cases the runner offered blocked work as ready.

**Fix: `Gate: device` on both.** It is the field CLAUDE.md defines for this — it parks the entry
until someone picks the phone up, and lists it under `--sittings`, which is where a device question
belongs. Neither entry's lane changed: the *fix* is still Lane B's, and `Gate:` records that the
next action is not.

**The field must lead its own bullet.** `- **Lane: B** · **Gate: device** · …` parses as nothing —
`backlog-entries.js:80` anchors `Gate:` immediately after the dash, so a mid-line mention is
invisible. The first attempt here did exactly that and the entries stayed READY. Confirmed after:
PARKED 29 → 31, Lane B READY 20 → 18, and both appear under `--sittings`.

## Also: OR-162's cheapest option is not the cheap one

Its direction (a) is chart.js `resizeDelay`, *"currently set nowhere in the repo"* — which reads as
adding a prop. Measured here: **20 files call `ChartJS.register` individually and there is no shared
chart module.** `ChartJS.defaults.resizeDelay` would cover them all from one place, but that place
does not exist and would have to be imported before the first chart is constructed. So (a) is
"create a shared defaults module and route 20 files through it", and the entry now says so — it
changes which of the three directions is actually cheapest.

## Not done

No code. No chart change, no device measurement; `DV-12`'s pass test is unchanged and still owed.

<a id="2026-09-24-fix-lb-134-unsound-merge-gate"></a>

# LB-134 — the merge is not a green check, and CLAUDE.md said it was

**PR:** `fix/lb-134-unsound-merge-gate` · **Lane:** O · docs only. No code, no CI change.

## What was verified

`LB-134` reported that PR #1467 merged while its `Tests` job was failing. Re-read from the API
rather than taken from the entry:

- Merged at **10:18:18Z**.
- `Tests` (job `107136618616`) reported **failure at 10:18:29Z** — eleven seconds later.
- `E2E` also failed, at 10:47.

So the merge went past a **PENDING** check, not a reported failure. That is a sharper falsification
than the entry claimed: CLAUDE.md's exact words were *"it cannot merge a genuinely pending check"*,
and it did.

## The mechanism, confirmed the same day

`enable_pr_auto_merge` was re-probed on a **green** PR at 09:15 UTC and still answers *"Protected
branch rules not configured for this branch"*. `main` is protected by a Ruleset with no classic
branch-protection rule beside it — so the merge API neither enforces the required checks nor offers
auto-merge. **One missing setting causes both**, which makes this entry's remaining half and `LB-52`
the same fix.

## What changed

Two CLAUDE.md passages that instructed every agent to trust an unsound gate:

1. The Standing Instruction claiming branch protection *"requires a PR with all CI checks passing"*.
2. The CI/CD line calling the merge *"the reliable green check"*.

Both now state that the checks are not enforced at merge, cite the measurement, and point at the
real read — `get_job_logs` with `failed_only: true`, where an empty list is the green signal and the
output does not flood context the way `list_workflow_jobs` does.

## Why this matters more than it was filed as

`owner-branch-protection` was put to the owner as a **throughput** problem: auto-merge is unavailable
so every merge is hand-caught against a moving base. It is also the reason **no merge in this repo is
gated on its tests**. The batch is now marked as a correctness question, to be said plainly when it
is next raised.

## Not done

Turning the required checks on is the owner's and stays in `LB-52`. The test-assertion half of
`LB-134` (`expect(getActiveProgram).not.toHaveBeenCalled()`) is unrelated to this correction and is
untouched here.

## Not exercised

Documentation only.

<a id="2026-09-24-fix-or-158-client-roots"></a>

# 2026-09-24 — OR-158: the E2E detector looked for client roots where they aren't

**Branch:** `fix/or-158-client-roots` · **Lane:** O (Orchestrator) · `scripts/` only, no product code

This corrects **my own LB-108 fix from earlier today** (#1557). It replaced a prefix list with
computed reachability, and the computation started from the wrong roots.

## How it surfaced

The LB-108 work left one thing owed: the fix could not be verified by reading the diff, only by
watching the E2E job **duration** on the first PR to touch a client `lib/` file. Checking for one on
merged history found **#1569** — which changed `instrumentation-client.ts` and `lib/observability/
sentry-scrub.ts`, and whose E2E job skipped. Running the detector against that commit's file list
reproduced it: `false`.

## Two defects, both measured

**1. Roots were grepped inside `lib/` only.** Almost no client component lives in `lib/` — they live
in `app/` and `components/`, which the prefix rule catches, so *their* `lib/` imports were never
walked. Measured: **47 `lib/` modules are imported directly by a `'use client'` file under
`app/`/`components/` and were not marked reachable**, including `lib/cache-groups.ts` and
`lib/haptics.ts`. A PR touching only `lib/cache-groups.ts` skipped the browser run — the exact class
LB-108 existed to close. The entry's own *"81 of 282 reachable"* figure was produced by this wrong
root set and was therefore also wrong.

**2. `instrumentation-client.ts` matched nothing.** Next identifies it by filename, so it carries no
`'use client'` and no grep found it; it is not under `lib/` and not under the `app|components|e2e`
prefixes. It runs in every browser session. It is now a named root, with a comment saying any future
convention-named entry point needs adding by hand — that is the price of the directive being the
signal.

## The correction that the correction needed

Fixing the roots alone took the reachable set from **81 to 179 of 282**, which is too many, and the
reason was a third defect in the same walk: **it counted `import type` as an edge.**
`early-deload-card.tsx` type-imports one symbol from `lib/health/readiness-payload.ts`, which
re-exports `lib/data/index.ts` — so `lib/data/postgres/adapter.ts`, a server-only Drizzle adapter,
arrived in the browser-reachable set behind a type the compiler erases. That would have undone
LA-63's whole point. Dropping erased edges gives **124 of 282**, and the adapter correctly skips
again. A mixed `import { type A, b }` keeps its edge, because `b` is real.

Worth naming: 179 *looked* like a successful fix. The number that exposed it was a specific file that
had no business being in the set, not the total.

## Verified behaviour

| Changed file | Before | After |
|---|---|---|
| `lib/cache-groups.ts` | skip ❌ | run ✅ |
| `instrumentation-client.ts` | skip ❌ | run ✅ |
| `lib/data/postgres/adapter.ts` | run (type-only edge) ❌ | skip ✅ |
| `lib/resume-repaint.ts`, `lib/hooks/use-resume-repaint.ts` (the PR #1173 pair) | run ✅ | run ✅ |
| `lib/sqlite/cache.ts` | run ✅ | run ✅ |
| `app/api/**`, `docs/**` | skip ✅ | skip ✅ |

## Verification

`pnpm check:rules` — **Ran 78 of 78**, all passed. `scripts/__tests__/e2e-ui-touched.test.ts` — **17
passed** (4 new, covering each defect and the LA-63 regression).

The known floor is unchanged and still stated in the file: static `from '…'` imports only, so a
dynamic `import()` built from a variable is not seen.

**This will make more PRs run the browser suite, which is the point** — the previous behaviour bought
its speed by skipping browser code. No product code changed, so no runtime surface was exercised.

<a id="2026-09-24-fix-rv167-cadence-coverage"></a>

# 2026-09-24 — RV-167: a cadence stream that starts late no longer stores a fifth of a walk's steps

**Branch:** `fix/rv167-cadence-coverage` · **Lane B** (LB-142)

## What was wrong

Review sweep 57's data census measured it: the 2026-09-04 treadmill walk `d66aa0d7` holds **34
cadence bins, the first at tSec 1470** of an 1,800-second walk, and stored **584 steps**. The other
nine full-strap walks stored 2,888–3,870. HR was present throughout, so the strap was connected and
only the accelerometer stream came late.

Nothing looked wrong from the outside. `cadence_spm` read a healthy 116.9 because the mean is taken
over the bins that exist, not over the walk — a stream covering the last five minutes at a normal
pace produces a normal average. The step count is the only figure that carries the gap, and
`body-metadata` adds it on top of ring steps, so that day's total came out about 2,400 short.

## What shipped

`lib/stores/cadence-coverage.ts` — `cadenceCoverage()` measures nominal series cover
(`bins × CADENCE_SERIES_BIN_SEC`) against the activity's own duration, and `stepsEstimateIfCovered()`
returns null below `MIN_CADENCE_COVERAGE = 0.5`.

**Null below a floor, not scaled.** Scaling a 19%-covered stream up to 100% invents the missing four
fifths and presents the invention as a measurement — the same shape as the phantom walk duration
BF-190 removed two PRs ago, where an early exit saved the whole *planned* session. A missing number
is recoverable; a fabricated one that looks plausible is not.

**The floor is a judgement, not a fit.** The nine good walks' coverage was never recorded, so 50% is
conservative: it discards the measured walk (19%) with room to spare and keeps anything whose stream
covers over half the activity. That reasoning is on the entry, so nobody later reads 0.5 as measured.

**Both write paths, not just the one named.** The entry pointed at `walk-summary.tsx:171`. A grep for
`stepsEstimate` found `lib/stores/activity-store.ts:240` integrating off the same tracker on the
manual-activity screen, with the same absence of a coverage check — the same bug on a second surface,
so it was fixed in the same PR per the sibling-surface sweep.

**Why `lib/stores/` and not `lib/activity/`.** `lib/activity/` is imported by
`app/api/oura/workouts/route.ts` and `app/api/day-timeline/route.ts`, which makes it Lane A by the
path rule. `lib/stores/` is Lane B outright and already holds the one consumer that is not a
component. Reversal cost is a file move and two imports.

## Verification

`lib/stores/__tests__/rv167-cadence-coverage.test.ts` — 10 tests. The first reproduces the production
walk's numbers exactly; the rest hold the boundaries that are easy to get wrong: the cap at 1 (a walk
stopping mid-bin nominally covers 100.6%), the exact-floor case in both directions, and the
distinction between *poor* coverage and *unjudgeable* coverage — a zero duration or an empty series
returns null rather than 0, because "cannot tell" must not discard good steps.

**Control run:** with both call sites reverted to the raw `stepsEstimate`, 3 of the 10 fail; restored,
10 pass. The source assertions are what catch a future revert of the wiring.

Not exercised: the device. Whether the H10's accelerometer stream commonly starts late is now the
open half — a walk that trips the floor stores no steps at all, so if this is frequent the answer is
to fix the stream, not to lower the floor. RV-167 stays in the queue as `Lane: DV` with that as its
`Keep:`, with an objective pass/fail (start a walk with the strap already worn; record the tSec of
the first bin against the walk's start).

## Also in this PR

**RV-166 gets a `Needs: RV-170`.** It was blocked — its rider question (*does a guided or treadmill
walk on a prescribed day count as doing the run?*) is unanswered — but the block lived in prose
inside the `Lane:` line, so `next-item.js` offered it as Lane B's ready work twice. `Needs:` is the
field the runner reads; prose is not.

<a id="2026-09-24-fix-rv171-restrictions-not-erased"></a>

# 2026-09-24 — RV-171: a failed request while the meal-plan setup opened erased every allergy

**Branch:** `fix/rv171-restrictions-load-guard` · **Lane:** B · **Domain:** nutrition

## What was wrong

The sheet loaded dietary restrictions with a bare `fetch` whose failure path was
`if (!d) return` / `.catch(() => {})`, so `restrictions` stayed at its initial `[]`.
`handleGenerate` then PUT `{ entries: restrictions }` **unconditionally** into
`replaceUserDietaryRestrictions`, which **deletes every row for the user** before inserting.

So one 429, 5xx or dropped request while the sheet opened wiped the owner's allergies and
intolerances — and the plan was then generated without them, because the generate route reads them
back from the database. The only visible hint was an empty restrictions step.

The code's own comment said it: *"a new plan must never start from a blank slate and quietly forget
an allergy."* That is exactly what a failed load caused.

## The fix

Two guards, and both are load-bearing:

- **`loadedRestrictions: RestrictionSelection[] | null`** — what the server actually had. `null`
  means no successful load, and the write cannot fire in that state. This is the half that stops
  the erasure.
- **`sameRestrictions(loaded, current)`** — no write unless something actually changed. Writing an
  unchanged set is a delete-and-reinsert of every row for no benefit, which is the same blast
  radius as the bug for none of the value.

Skipping the write is safe either way, because the generate route reads the stored restrictions
itself. The PUT's response is now read, and a refused save says so rather than being swallowed.

A failed load renders an error line saying the saved restrictions are untouched and the plan will
still use them — true, and the reassuring half matters as much as the warning.

**`sameRestrictions` compares sets, not lists.** The picker rebuilds the array on every toggle, so
order shifts without the selection changing; ordered comparison would make almost every open look
like an edit and re-run the very delete-and-reinsert the guard exists to avoid.

## Verification

- `components/nutrition/__tests__/rv171-restrictions-not-erased.test.ts` — **10 tests**. Five drive
  `sameRestrictions` as the pure function it is (order-insensitivity, a severity change, addition,
  removal, and the asymmetry the `every` half alone would miss); five assert the guards on source.
- **Control-run against `origin/main`: the 5 guard assertions go red**, the 5 logic ones correctly
  pass either way.
- `pnpm check:rules` · `tsc --noEmit` clean · lint clean.

**Not exercised: the browser path.** The setup sheet is only reachable with no active plan, and the
seeded e2e user has one, so driving it would have meant reshaping the fixture for one spec. The
failure path is therefore argued from source and from the extracted logic, not observed. Stated
plainly rather than papered over.

`sameRestrictions` moved to `components/nutrition/restrictions-diff.ts` — vitest's unit project does
not transform JSX, so nothing is importable out of a `.tsx`. Same pattern as
`meal-count-reduction.ts` beside it.

## Next

Lane B's queue head is RV-166, then RV-167, RV-176.

<a id="2026-09-24-fix-rv176-timezone-escapes"></a>

# 2026-09-24 — RV-176: the timezone rule's escapes, one medium and twelve latent

**Branch:** `fix/rv176-timezone-escapes` · **Lane B** (LB-143)

Review sweep 58 found thirteen client surfaces deriving a date, a month or an hour from the device's
clock rather than the user's timezone. All are invisible while the phone sits in Brisbane, which is
why they survived the timezone rule, the two Custom Rules checks meant to enforce it, and months of
daily use.

## The medium

`components/health/health-score-detail.tsx` keyed its whole day to `todayInTz(DEFAULT_TZ)` —
Brisbane, for every user. That one `today` feeds three things: the offline seed's local-store
lookup, the row it picks out of that read, and the date the AI insight card asks for. A user west of
Brisbane asks for tomorrow's insight and seeds from a day that has not happened.

The heart-rate detail screen had the identical bug and was fixed in place rather than filed, so its
`useUserTimezone()` shape is copied here verbatim — including the reason its own comment gives, that
placing buckets in one zone while asking for another's date is what put a Brisbane morning on screen
as an afternoon.

## The twelve latent

- **One device-local clock render** — `exercise-detected-card.tsx` hand-rolled a 12-hour formatter
  off `getHours()`. Replaced with `formatTimeOfDay(ms, tz)`.
- **Seven day-window starts** built from tz-less `todayMidnightUtc()` + `toAestDay()` across
  `session-select-content.tsx` (×3), `log-value-sheet.tsx`, `metric-log-sheet.tsx`,
  `health-content.tsx` and `sleep-content.tsx`. Every one of those files already held
  `const tz = useUserTimezone()` and simply did not pass it — the shape CLAUDE.md warns about, where
  a default every caller is supposed to override is what makes forgetting silent. In
  `sleep-content.tsx` the hook was declared *below* the effect that needed it, so it moved up and
  the effect gained `tz`; two other effects needed `tz` adding to their dependency arrays.
- **Four calendar-month cache keys** from `new Date().getMonth()` —
  `session-select-content.tsx` (×2), `workout-screen.tsx`, `calendar-widget.tsx` — plus
  `year-review-content.tsx`'s trailing-12-month axis. On the first or last day of a month the device
  and the user disagree for up to ten hours, so a screen seeds from, or writes to, a key for a month
  the user is not in.
- **Four meal-bucket picks** from the device hour, in `nutrition-content.tsx`,
  `food-logger-sheet.tsx`, `saved-meals-sheet.tsx` and `assign-step.tsx` — now
  `Math.floor(secondsSinceLocalMidnight(tz) / 3600)`. `assign-step.tsx` additionally re-implemented
  `mealTypeForHour` inline **twice**, which is the One Formula break the entry flagged; both now call
  the shared one, whose `?? [0]` fallback matches what the copies did.

## One new helper, and why it exists

`lib/calendar-month.ts` — `calendarMonthInTz(tz)` and `previousCalendarMonth(m)`. Four sites needed
the same derivation and a fifth needed the month before it, so hand-rolling it at each would have
been the duplication this repo treats as a bug by definition. The back-step uses `Date.UTC` overflow
rather than adjusting the year by hand, per the rule that produced `2026-06-31` and a 500 (#23).

It sits in `lib/` rather than `packages/shared/src/date-utils.ts` because that file is Lane A's.
Nothing under `app/api/**` reaches it, so the path rule puts it on Lane B — recorded as a claimed
path in the baton rather than assumed, since a bare `lib/*.ts` module is the ambiguous case.

## Verification

`lib/__tests__/rv176-timezone-escapes.test.ts` — 8 tests. Three drive the new helper (the December
underflow, the zero-pad the cache key depends on, month bounds in two zones 26 hours apart). Five
scan every client `.tsx` and would fail on a reintroduction.

**Control run:** with `app/` and `components/` reverted, 5 of the 8 fail; restored, 8 pass.

Two traps the scanner documents, both of which cost a round here:
- It **strips comments first**. Several of these fixes explain themselves by quoting the pattern
  they replaced, so a scanner that reads comments flags the fix as the defect.
- Arity is **per function**: the tz is `todayMidnightUtc`'s first argument but `toAestDay`'s second.
  A regex cannot express it either — `toAestDay\([^,)]+\)` matches the *corrected*
  `toAestDay(new Date(x), tz)` by stopping at the inner paren, so the check balances parens and
  counts commas at the call's own depth.

Local gates: `pnpm check:rules` **Ran 78 of 78, all passed** · `tsc --noEmit` clean ·
`check-test-typecheck` none above baseline · lint introduces no new warnings (the two remaining in
`session-select-content.tsx` name `userId` and `dayKey` and were confirmed present on `main`) ·
2,742 tests pass across the three touched suites.

**Not exercised: the device, and any timezone but Brisbane.** Every one of these is by construction
invisible at `Australia/Brisbane`, which is the only zone the owner's phone has been in — so the
behaviour change is reasoned and test-scanned, not observed. The honest statement is that the
*escapes* are gone, verified by source; that a user in another zone now gets the right day is
implied by the helpers, not measured.

## Left open

The two Custom Rules blind spots that let this class through are **RV-179** (`Lane: O`) and did not
close here. Nothing in CI catches a reintroduction; the vitest scan above is what holds it at zero
in the meantime, and RV-179 now says so, so widening those scripts can shrink this file rather than
duplicate it.

`components/profile/personal-details-section.tsx` keeps `new Date().getFullYear() - 10` as a
date-of-birth bound. Device and user disagree about the year for a few hours once a year, on a bound
that already carries a decade of slack — not a defect, and the test asserts it as the one expected
name rather than silently skipping it.

<a id="2026-09-24-fix-tab-switch-speed"></a>

# 2026-09-24 — tab-switch-speed: the blank is gone, the block is not

**Branch:** `fix/tab-switch-speed` · **Lane B** (LB-144) · batch `tab-switch-speed`, **half shipped**

The owner named tab-switch speed his highest priority. The batch was four entries: two work
(`RV-113`, `DV-12`) and two evidence (`OR-161`, `OR-162`). **`RV-113` and `OR-161` shipped. `DV-12`
and `OR-162` did not, deliberately** — see the last section, which is the substantive part of this
entry.

## What shipped

**`RV-113` — the opacity ramp is gone from `ta-tab-enter`.** The outgoing panel is hidden in the
same React commit that reveals the incoming one, so an incoming ramp from `opacity: 0` played over
an empty screen: a per-frame sampler on the S25 caught 58–109 ms with neither panel painted, on 10
of 10 switches. Material 3's fade-through fades the *outgoing* content out first and that half was
never implemented, so the ramp was the second half of a cross-fade with no first half. The scale
settle stays.

**Kept `scale(0.96)`, not the `0.97` the entry and its relay both specified.** The scale was never
part of the defect, and the comment beside it records why 0.96 was chosen over the spec's 92% — a
full-screen panel makes 92% read as a zoom. Changing a deliberately-chosen value while fixing an
unrelated one is how the reason gets lost.

**`OR-161` — the two comments that asserted the defect could not happen.** `globals.css` claimed the
animation ran over "content that is already painted"; `tab-shell.tsx:186` claimed "content that is
genuinely there". Both were false and both are why it survived review. Rewritten to say what is
actually true and why re-adding a ramp re-opens RV-113. OR-161's other half — that the route
transition 50 lines above already holds a deliberate ~15% overlap — is what made the fix a deletion
rather than a design.

## What did not ship, and why that is the right call

`DV-12` holds the actual time: one long task of 68–118 ms on every tab tap, profiled on the S25 to
chart.js `update → _tickSize → _computeLabelSizes → set font`. `OR-162` established the mechanism
from source — hidden panels carry `[content-visibility:hidden]`, so on reveal every `<canvas>` goes
from no box to a real one and the responsive resize observer fires. It offered three fixes and said
none was measured, and that **the count of canvases mounted across the five tabs should be taken
first**, because its cheapest option only pays if the cost is many charts rather than one expensive
one.

**I took that count, and the question turns out to be wrongly posed.**
`e2e/or162-canvas-census.spec.ts` drives the real app at 384 px, visits every reachable tab, and
counts. With four panels mounted it read **0 canvases — none hidden, none active.**

The zero is not the harness failing. **No chart is unconditional in a tab panel.** Charts reach one
only through the owner's configuration and data: Home via `home-card-widget.tsx` → `HrDayChart`,
Health via `health-sections.tsx` → `TimeInZoneCard`, `trends-section.tsx` → `TrendChart` and two
`TrendSparkline` cards, Nutrition via `day-tools-section.tsx` → `WeeklyNutritionChart`. And
`TrendSparkline` is `dynamic(ssr: false)`, so it is not in the bundle until something renders it.

So there is no single number to take, and "many cheap charts or one expensive one" **cannot be
settled off-device** — it depends on which Home widgets the owner has enabled and which Health
sections have data. Both entries now say so, and DV-12 says the canvas count and the long-task
measurement must be taken in the *same* sitting, because either alone is useless.

Shipping a speculative chart.js change into the owner's highest-priority path, against a defect that
does not reproduce in the harness, with no way to measure whether it helped, is the exact shape
CLAUDE.md calls "verified but broken". One direction was also cheaper on paper than in fact:
OR-162's option (b), holding the canvas size across the hidden state, cannot be done with
`contain-intrinsic-size` — that sizes the contained element, not the descendant canvases, which
still have no box. It means JS. That is recorded too.

## The spec

It asserts the invariant both entries rest on — every hidden panel carries a computed
`content-visibility: hidden` — and logs the census. It deliberately asserts **no** canvas count:
that would either pin the seeded account's poverty or break the moment the seed gains data.

## Verification

`pnpm check:rules` **Ran 78 of 78, all passed** · `tsc --noEmit` clean · `pnpm test` full suite ·
`pnpm build` clean · the census spec passes against the running app.

**Not exercised: the device.** The Device Verification session is archived. RV-113 is a perceptual
change to the app's most frequent interaction, so what it needs is a *look*, not a measurement —
and `projectOverview.md` carries the Known-Issues row saying so. That row also warns off the obvious
wrong check: `perf.js longtasks` will show no improvement from RV-113, because it removes a blank
and not a delay. Reading that as a failed fix is the mistake the batch was assembled to prevent.

<a id="2026-09-24-lane-a-bf195-low-reception"></a>

# 2026-09-24 — BF-195: the app had no state for "online with no throughput"

**Lane A** · branch `lane-a/bf195-low-reception`

The owner: *"I went to an area with low reception and nothing really worked on the app."* A gym is
the canonical low-reception location for this app, and the one screen that must work there — the
session list — was the one rendering nothing.

## Why offline-first did not help

Connectivity was a boolean. `navigator.onLine` and Capacitor's `networkStatusChange` both answer
*"is the radio attached"*, and in low reception it is. So `cachedFetchCore`'s offline branch — the
one that explicitly paints saved data — never ran, the request was issued with **no timeout**
(verified: zero `AbortController`/`AbortSignal` anywhere in `lib/sqlite`, `lib/hooks`,
`lib/local-store`), and it never settled.

The owner's screenshots split three ways, and the split is the evidence: **Health → Body worked**,
painting from `readCacheSync` seeds; everything gated on a fetch showed an empty skeleton. The
architecture was sound where it was applied. What failed was the layer above it.

## What shipped

**A timeout, at the one fetch site.** `AbortSignal.timeout(8000)` makes the request *throw*, and the
throw lands in `cachedFetchCore`'s existing catch — machinery that already keeps the cached value and
reports through `onError`/`onRevalidateError`. That converts an unhandled state into a handled one
for every screen, rather than adding a second failure path. 8 s is a starting value, not tuned.

**`online` now means requests are completing.** A module-level reachability flag in `cache.ts`
(`requestsCompleting()` / `subscribeToReachability()`), flipped false by a timeout and true by any
settled response; `useOnlineStatus` ANDs it with the radio state.

Two deliberate asymmetries there:

- **A rejected response counts as reachable.** A 500 proves the connection carried a request and
  brought an answer back, which is the question the flag asks. Requiring `ok` would strand the app
  "offline" behind a server error on a perfectly good connection.
- **An ordinary network throw does not flip it.** DNS failure, refused, server down — a different
  failure, already handled correctly, and calling it "no reception" would put an Offline banner in
  front of a working connection. `AbortSignal.timeout` rejects with a `TimeoutError`, which is the
  discriminator.

## A correction to the entry's chain, found by writing the test

The entry's chain reads as though the skeleton persisted because no callback fired. It did not.
`session-select-content.tsx` clears `refreshing` in a **`finally`** — which never ran, because the
promise never settled. **Settling is the fix.**

I wrote the test asserting `onError` fires on a timeout with nothing cached, and it failed. The code
was right and the test was wrong: once a timeout has marked us unreachable, the app is in the
sanctioned offline-first state, where an error card would be wrong. The screen shows its empty state
and the banner tells the truth. The test now asserts the promise *settles* — the mechanism — rather
than a callback that should not fire.

## A sibling guard I had to update without weakening

`lib/__tests__/cache-http-layer-bypass.test.ts` asserted `toEqual({ cache: 'no-store' })` — an exact
match on the whole `fetch` init, deliberately, so nothing unexpected can be passed. Adding `signal`
broke it. Relaxing it to a partial match would have silently retired that guard, so it now checks the
key set is exactly `['cache','signal']` and pins both values. The `no-store` rule it protects is a
strict one.

## Verification

`tsc` clean · `typecheck:tests` clean · Custom Rules **78 of 78** · `lib/sqlite` + `lib/hooks`
**77/77** · full suite **9,680 passed**.

Mutation pass: **6 mutants, 5 killed** — removing the signal, not marking unreachable on timeout,
never restoring reachability, treating *any* throw as low reception, and dropping the flag from the
`isOnline` test — plus **1 deliberately equivalent control** that survived correctly (the
early-return guard rewritten as if/else).

## Not verified, and it is the important part

**No device, and nothing here reproduces in the sandbox**, where the network is fast and
`getLocalStore` returns null. The honest reproduction is **network throttling, not airplane mode** —
airplane mode exercises the path that already worked.

**The banner is still a false promise on a seedless screen.** `offline-indicator.tsx` says *"Offline
— showing saved data"*. The engine now makes it appear at the right *times*; it cannot make that
sentence true on a screen with nothing saved. That copy is Lane B's, and it is on the entry's Keep.

## The abort was wrong, and CI is what said so

Everything above describes the **first** version of this fix, which cancelled the request at the
threshold with `AbortSignal.timeout(8000)`. It shipped to a PR, and **E2E failed** — 7 failures
across 5 specs, the first E2E failure of the day on any branch.

The diagnosis took a wrong turn worth recording. I first hypothesised that the E2E suite had rotted
on `main` and my branch merely happened to be the one that ran it. That was checkable and I checked
it the lazy way — a list of run conclusions — which showed several `success` results and no obvious
pattern. It was misleading: most of those runs **skipped** the tests entirely, because a "does this
change touch the UI?" gate short-circuits E2E on non-UI PRs, and a skipped job still reports
`success`. Reading the per-step conclusion instead of the job conclusion settled it in one query:
four branches genuinely ran the suite to completion that day and all four passed, including
`fix/rv176-timezone-escapes` which started 21:29, *after* my failing run. The suite was healthy.
The break was mine.

**The mechanism.** CI runs E2E against `pnpm dev` deliberately (a production server cannot reach the
local non-SSL Postgres), so first-compile responses legitimately take 9–19 seconds — I had measured
exactly that locally earlier and talked myself out of it. The 8 s abort fired on real, working
requests. `day-rollover-checkin.spec.ts` asserts *"a same-day resume must not refetch"* and saw
**Expected: 1, Received: 2**: the abort killed the first request, and the screen went back for the
data it never got.

**Why the redesign is better than a bigger number.** The threshold was never the defect. Cancelling
was. An abort on a slow-but-working connection destroys a request that was about to succeed and
shows an error instead of the data — that is the *worse* outcome in exactly the state BF-195 exists
to handle, and it silently changed the request semantics of every GET in the app. The watchdog now
**observes**: a `setTimeout` reports the request as slow and the request itself runs to completion
untouched. The user on a weak connection gets an honest "no throughput" indicator *and* their data
when it lands. `fetch` is back to a single `{ cache: 'no-store' }` argument, so the exact-match
guard in `cache-http-layer-bypass.test.ts` is restored to its strict form rather than relaxed.

A second correctness gain came free: one slow response is no longer a diagnosis. A cold container, a
heavy aggregate, or a dev server compiling on demand all produce a single long request on a good
connection, so two in a row are now required before the app calls itself unreachable.

**Verification of the redesign:** `tsc` clean · `typecheck:tests` clean (318 errors / 89 files, none
above baseline) · lint clean · Custom Rules **78 of 78** · full suite **9,684 passed, 1,036 files,
0 failures**. Mutation pass re-run: **5 mutants, 5 killed** — threshold 2→1, re-introducing the
abort, `markSettled` not resetting the run, dropping the `clearTimeout`, and a hard network throw
claiming low reception — plus **1 deliberately equivalent control** (`8000` → `8_000`) that
survived correctly. Re-introducing the abort is now killed by **three** tests, so the exact break
CI found is pinned at unit level and cannot return silently.

**Process note, recorded against myself.** I had the evidence for this before I had the conclusion:
I measured 9061/10190/18978 ms responses locally, called them "strong evidence" the timeout was
firing, then walked that back when a local run showed no failures — without noticing that my local
dev server was warm and CI's is not. The local run could not have reproduced it. Reaching for the
cheap CI query (per-step conclusions) an hour earlier would have cost one minute.

<a id="2026-09-24-lane-a-rv165-height-calibration"></a>

# 2026-09-24 — RV-165: the DEXA offset was fitted to a height the owner had already corrected

**Lane A** · branch `lane-a/rv165-height-calibration`

Body composition is computed **once, at ingest**, from the profile of that moment. The owner
corrected their height from 160 to 158 cm to match a DEXA printout, so every earlier reading is still
a 160 cm number. That would be a history question and nothing more — except the DEXA calibration
offset is derived **live** from those stored values, so one stale pair biases every corrected
body-fat reading the app shows today. Measured: **+3.2 where it should be +2.3**, about a point.

## The entry's first fix shape is unnecessary

It proposed *"store what composition needs from the raw sample"* — a migration, and one that could
not recover history anyway. Nothing extra needs storing. Two properties of the formula make the
original inputs recoverable from columns already written:

1. **`bmr_kcal` is Mifflin-St Jeor** — `10w + 6.25h − 5a + sexTerm` — with **no impedance term**, and
   linear in height. The height used at ingest falls straight out of it.
2. **Impedance enters the model through `bodyFatPct` alone.** Every other output is a function of
   body fat, weight, height, age and sex. Once the height is known, the impedance follows.

## Verified against production, not derived on paper

08-27 and 09-01 carry the **same weight (71.7 kg)** and BMRs of **1557** and **1545**. The 12 kcal gap
is 12 / 6.25 = **1.92 cm**, and solving each gives exactly **160** and **158** at age 33 — the
documented correction, recovered from the table alone. The 08-27 impedance comes back at **~494 Ω**,
inside the file's own 300–1200 Ω band, and re-deriving at 158 cm gives **26.2** against the stored
25.3.

The test fixture is those real rows, and there is a separate round-trip case that pins the algebra
with no production data in it at all.

## Where it lives

`heightUsedForStoredBmr` and `recomputeStoredBodyFatPctAtHeight` sit in
`lib/scale-ble/composition.ts`, beside the formula they invert. Only the **inverse** lives there —
the forward half calls `computeBodyComposition`, so the two cannot drift. `getBodyFatCalibration`
restates each reading at the current profile before pairing, using the age **at the reading** rather
than today's: a birthday in between would otherwise shift the recovered height by 0.8 cm and quietly
poison the inversion.

## The mistake worth recording

**My first version dropped any reading it could not re-derive.** That sounds cautious and is not.
Readings without a stored BMR are common; dropping them left **zero pairs**, so the calibration
returned null and *no correction was applied at all* — strictly worse than the bug being fixed.
`body-fat-correction-consumers.test.ts` caught it with "expected 25.3 to be 28.5".

The reasoning error was treating *"I cannot verify this reading"* as *"this reading is wrong"*.
Absent a BMR there is no evidence of staleness, only an inability to check. A reading that cannot be
re-derived is now **kept as stored** — exactly today's behaviour — so the change can substitute a
better value but can never produce a worse calibration than the one it replaces.

## The guards overlap, which makes them easy to test wrongly

An absurd body-fat value usually implies a **negative** impedance index, which is caught before the
plausibility band is ever reached. So a carelessly chosen fixture passes even with the guard it is
meant to pin deleted — and the mutation pass showed exactly that: two guards survived deletion. The
three refusal cases are now each computed to clear the earlier guards and stop at their own (bf = 3
at BMR 1424 lands on a perfectly plausible 562 Ω; bf = 21.0 at BMR 1557 clears the sign check and
resolves to 186 Ω, under the floor).

## Verification

`tsc` clean · `typecheck:tests` clean · Custom Rules **78 of 78** · `lib/scale-ble` + shared health
**1,022 passed** · the two calibration suites **14/14**.

Mutation pass: **7 mutants, 5 killed**, 2 equivalent controls survived correctly. Two of the kills
exist only because the first pass found them surviving.

## Not done, deliberately

**The stored rows are untouched.** Every `body_metrics` row before the correction still holds 160 cm
composition. Restating them is a history edit — **RV-170** — and the owner's call. This fixes only
what is derived at read time.

**Whether +2.3 is right in any absolute sense is unmeasured.** It is one DEXA pair, and
`deriveBodyFatCalibration`'s own comment is explicit that n = 1 supports an offset and not a ratio.
What changed is that the pair is now compared like for like.

<a id="2026-09-24-lane-a-tn74-zero-1rm-investigation"></a>

# 2026-09-24 — TN-74: the zero 1RM is mostly the design, and the rest was fixed months ago

**Lane A** · branch `lane-a/tn74-zero-1rm` · **docs-only — no code change is owed**

TN-74's first task was explicitly *"identifying that supplier"*, not changing the formula. It has an
answer, and the answer retires most of the entry.

## 76% of the defect is the contract

Grouped in production over 494 non-deleted exercise logs:

| `exercise_deloaded` | logs | `estimated_1rm = 0` |
|---|---:|---:|
| true | 32 | **32 — all of them** |
| false | 462 | **10** |

`estimateOneRm` returns zero when `deloaded` (`1rm.ts:166`), and `adapter.ts:1482` states the
contract outright: **"`estimated_1rm > 0` IS the deload test, not a proxy for one."** Zero *is* how a
deload is encoded. So 32 of the 42 are the design working, and the entry's headline rate of 8.5% is
really **2%**.

That also kills the entry's acceptance criterion. It asked for NULL instead of 0 so downstream could
distinguish "no estimate" from "an estimate of zero" — but adapter queries use `> 0` **as** the
deload test, so switching to NULL changes what those queries mean rather than tidying storage.

## The 10 real ones are two sessions, and the bug is already fixed

Both "Pull": 2026-08-09 and 2026-08-16, five logs each. Every exercise in both zeroed — including the
bodyweight Pull-Up, which takes a different code path — so the zeroing is **session-wide**, which is
what the `deloaded` early return does and what a per-set formula fault cannot do.

`log-exercise.ts:308-317` carries its own account of it (Q-298): the estimate uses
`deloadedForEstimate = exerciseDeloaded === true || (isAnyDeload && !isBaseline)`, which includes a
**phase-level** deload, while the row *used to* store `exerciseDeloaded ?? false`. A phase deload
therefore zeroed the 1RM and stamped the row `false`. Line 317 now stores `deloadedForEstimate`.

The rows are residue from before that fix, and they were written that way at log time —
`updated_at - logged_at` is **2–7 minutes, same day**. Nothing edited them afterwards.

## The central open question dissolves

The entry asked what supplies a positive 1RM to the 138 logs with no loaded flagged set. Nothing
does. `amrapAverage1Rm` and `calculate1RM` filter with `!flagged || style![i]?.useFor1rm`, so when
**no** set is flagged, `!flagged` is true and every set is used. "No `use_for_1rm` set" means "use
them all", not "compute from nothing".

## Two hypotheses I tested and refuted — recorded so nobody re-runs them

**That the rows lost a deload flag to RV-172's sync bug.** Plausible, and wrong: RV-172 nulled
`exercise_deloaded` in the *device's* SQLite, and these rows were last touched minutes after logging.
A later sync push would have moved `updated_at`.

**That the style's flagged set positions outran the sets performed.** Measured: 08-16 and 08-23
Barbell Shrug both have a 4-set style with all four flagged and both logged 2 sets — 08-16 stored
**0**, 08-23 stored **108.75**. Identical inputs, opposite outputs. The style is not the variable.

## What is still owed, and it is small

**The four zero-1RM/positive-`target_80` rows** are all the same 2026-08-06 deload session, correctly
flagged, and their `updated_at` is 6–7 hours later on 08-07. Some later write path set `target_80`
without touching `estimated_1rm`. **Which path is not established** — that is the one thing here
still worth chasing.

**`target80` is an accepted input that does nothing.** `log-exercise.ts:48` takes
`target80: z.number().optional()`; line 224 destructures `target80` from `estimateOneRm` and shadows
it. A caller can send the field and it is silently discarded.

## Not done, deliberately

**No repair of the historical rows.** Rewriting stored estimates is a data rewrite and the owner's
call; the code that produced them is already fixed, and nothing here establishes that a wrong
prescribed weight ever reached a screen — the entry itself flagged that as needing the device rather
than the table.

**Nothing was measured on the device or the surface.** Every figure above is a production `SELECT`
through `claude_ro`, which is row-scoped to the owner, so these are the owner's logs and no claim is
made about anyone else's.

<a id="2026-09-24-lb138-back-path-spec"></a>

# LB-138 — the entry I filed reached the wrong conclusion, and the app's own comment says so

**Branch:** `fix/lb138-back-path-spec` · **Entry:** LB-138 (resolved, removed from the queue) · **Version:** unchanged

## What LB-138 claimed

I filed this after bisecting `e2e/la109-back-from-subroute.spec.ts`'s second test to `ef95595c11d`
(#1431). The failing assertion received **`"blank"`** — `about:blank` — and I wrote that *"in the
WebView that is the back gesture leaving the app or landing on nothing."*

The **mechanism** was right. `show()` flips tabs with `history.replaceState` on purpose — *"tab flips
are peers, not a history trail"* — so after `/health` → flip to Home → push to `/health?tab=training`
there is one entry, and #1431 converting the streak card to `navigateToTab` is what removed the push
that used to sit under it.

## Why the conclusion was wrong

On the APK the Capacitor `backButton` listener intercepts before the WebView's history is reached.
For a tab route `backActionForPath` answers `"home"`, so the listener calls
`navigateToTab(router, "/")`. `mobile-auth-handler.tsx` states the reason in place:

> The shell replaced rather than pushed to get here, so there is nothing to pop.

Chromium has no such listener. **That is the entire difference.** The `about:blank` result is a
web-harness outcome, and there is no defect on the runtime this app supports.

## So the fix was in the spec

The second test now dispatches the same tab navigation the listener does, instead of
`page.goBack()`, and proves exactly what its own docstring says it must: that **Home's tree renders**
rather than the tab whose tree is stale.

Scoped to that test alone, which is the part that needed checking rather than assuming.
`tabKeyForHref` is an **exact** path match, so `/more/details` resolves to no tab and
`backActionForPath` answers `"pop"` — a real `history.back()`. The first test's `page.goBack()` is
therefore the correct simulation and is untouched.

**Nothing new was added to pin the decision.** `components/shell/__tests__/back-action-on-tab.test.ts`
already covers all four cases — every tab → `home`, `/` → `minimize`, sub-routes → `pop`, and the
full-screen workout route → `pop`. A second copy would be noise.

## Verification

- `e2e/la109-back-from-subroute.spec.ts`: **4 passed**, both tests.
- The changed test cannot pass vacuously: the URL is `/health?tab=training` when the dispatch fires,
  and the `waitForFunction(pathname === '/')` immediately after it would time out if the event name
  were wrong or the shell did not handle it. The navigation is proven to have happened before the
  tree assertion runs.
- `pnpm check:rules` **Ran 77 of 77** · `tsc --noEmit` clean.

**What I did not do, and it matters:** I did not re-run this test against a deliberately broken
`tab-shell.tsx` to show the tree assertion still catches a regression. The docstring's original
"goes red unfixed" claim was about the **first** test; it records that this second one *passed
unfixed*, so it has always been a pin on already-correct behaviour rather than a repro. That is
unchanged by this edit.

**BF-49 stays open and is not addressed here.** Device sweep 3 reports *"back from a timeline row
lands on Health, not where you started"* — a real device symptom, and this spec's docstring already
recorded a measured negative result against linking the two.

<a id="2026-09-24-lb139-nutrition-content-ceiling"></a>

# LB-139 — getting Nutrition's tab screen back off its ceiling

**Branch:** `fix/lb139-nutrition-content-ceiling` · **Entry:** LB-139 (Lane B) · **Version:** unchanged

## Why

DV-17's six-line fix left `app/nutrition/nutrition-content.tsx` at **exactly 800 of the 800 lines**
`check-component-size` allows. It passed, and the next line anyone added would not — including a
one-line bug fix, which is the worst possible moment to be forced into an extraction. Filed rather
than improvised inside the device-reported defect it came from.

## What moved

Three changes, all pure moves, no behaviour change:

- **`components/nutrition/nutrition-settings-sheet.tsx`** (new) — the Nutrition Settings sheet. It
  was the largest block in the file that owned its own markup rather than wiring up a component that
  already existed, and it was the sole user of `Sheet`/`Switch` and of the `MealTypeManager` dynamic
  import, so all of that went with it.
- **`components/nutrition/meal-plan-sheets.tsx`** (new) — the manage / edit / setup trio and their
  three `dynamic({ ssr: false })` boundaries, which cross unchanged. They are grouped because they
  hand off to each other — Manage's *rebuild* opens Setup and its *edit meals* opens Edit — so which
  one is open is one decision, not three.
- The hand-rolled delete-log confirm dialog → the existing **`ConfirmDialog`** primitive. It was a
  near-exact duplicate: same title/message/two-button shape, differing only in `max-w-sm` and
  `pt-2` vs `mt-2`. This is the smaller half of the line saving and the better half of the change.

`dynamic` is no longer imported by the screen at all.

**800 → 749.** Fifty-one lines of headroom, and the two extracted files are 51 and 61 lines.

## What was deliberately not done

The `FoodLoggerSheet` / `WaterLogSheet` / `QuickEditLogSheet` / `EndOfDayReview` wiring stayed. Those
are already separate components; wrapping them would move about thirty props from one file into
another and reduce no coupling. The entry also named "the plan-related state cluster" as a candidate
— extracting that means a hook, not a component, and it is a real refactor rather than a move, so it
did not belong in the same change as a ceiling fix.

## Verification

- `pnpm build` green — `/nutrition` compiles at 457 kB. `npx tsc --noEmit` clean; lint clean on all
  three files (the one warning on `nutrition-content.tsx:170` predates this branch).
- Full `components/nutrition/__tests__` suite: 37 files, 337 tests, green. The five other test files
  that read `nutrition-content.tsx` as source — including DV-17's own new spec — all still pass, so
  nothing this change moved was something a guard was watching.
- Four existing nutrition e2e specs against `pnpm dev`: **11 passed**, including the one that
  opens a sheet on this screen.
- Two throwaway Playwright probes (run, not committed — a pure move does not earn a permanent
  spec) drove the extracted surfaces in a real browser: the **settings sheet** opens with its
  reminder switch and Meal Types section, and the **delete-log confirm** now renders as the
  shared `ConfirmDialog` with its message and a Cancel that closes without deleting the row.
- `pnpm check:rules`: **Ran 77 of 77**, all passed. `check-component-size`: no file over 800 beyond
  the four recorded hotspots.

## What verifying it turned up

The third probe — the meal-plan **setup** sheet — never opened, and **it fails identically on
`origin/main`** with the refactor stashed out, so it is not this change. Filed as **LB-140**, at the
top of Lane B. The short version: no console error, no failed chunk, nothing in the tree 20 s after
the tap, and the only asymmetry is that the two overlays that DO open are statically imported while
this one is `dynamic({ ssr: false })` — the exact shape LB-129 measured and fixed for
`EndOfDayReview`. It is unverified outside the dev server, which is the entry's first action.

**Not exercised:** the APK. This is a WebView-delivered JS change with no native surface, but the
sheets themselves open from touch on the device and nothing here was opened on one. Samsung WebView
rendering, safe-area insets and drifted production data were not tested. A production build was not
exercised either: `pnpm build` is green, but `next start` will not come up in this container
(`routesManifest.dataRoutes is not iterable`), so every browser result above is the dev server.

<a id="2026-09-24-review-dv-results-and-new-probes"></a>

# 2026-09-24 — Review reads the device agent's three sweeps: nine probes answered, three findings unfiled, five probes parked in the wrong lane

**Branch:** `review/dv-results-and-new-probes` · **Agent:** Review · **Docs only.**

The owner asked whether the device agent's results had come back and whether more device sweeps were
worth running. Sweeps 1–3 ran on 2026-09-23/24. This PR files what they found that had no entry,
moves five of Review's probes out of the lane where DV could not see them, and files six new probes.

## What came back

Nine of the seventeen Review probes are answered and closed: RV-128, RV-129, RV-133 and
RV-137…RV-142. Headline numbers: cold-start FCP 1020 ms; 90 warm visits with no first-mount outlier
(so Q-51 should be re-placed); every tab tap is one 68–118 ms long task (DV-12); tab paint slows
from 61–103 ms to 126–449 ms after about 2 h of use (BF-22); every tab switch shows 60–110 ms with
neither panel painted (RV-113); and Nutrition paints a skeleton on every visit (DV-17).

## Findings that had no entry

- **RV-145:** RV-139 failed its own pass line (Home requests `/api/workout-data` twice per visit)
  and was closed with the failure recorded only in the journal. The source does not name the second
  caller, so this goes to DV with the `initiator.stack` method.
- **RV-146:** RV-130's font-preload warnings. `Archivo` and `Instrument_Serif` serve one printer
  and are preloaded on every cold start. Lane B.
- **RV-147:** sweep 1's note that `upsertBodyMetric` merges, which makes a line in
  `data-layer-rules.md` stale. Lane O.
- **RV-148 was drafted and withdrawn before this PR opened.** It would have flagged that a
  weigh-in check leaves the day's weight `manual`, which outranks the scale, while two journals
  file it under "all undone". The owner had already accepted exactly that on 2026-09-23
  (`device-sweep-1-plan.md`, answer 1). Re-filing it would re-open a settled decision, so the
  number is left unused.

## Five probes that were in Lane O and belonged in DV

OR-135 moved RV-124, RV-126, RV-130, RV-131 and RV-132 to `O` with one note, *"already RUN on the
S25 … what it needs now is its findings filed"*. That was true of RV-126 alone. RV-124 has five of
seven rows unchecked. RV-130's resume half was never run. RV-131's remaining half needs real
airplane mode. **RV-132 was never run at all.** Because `O` is invisible to `--lane DV`, all four
stopped moving. They are now `Lane: DV` with what is owed stated on each. **RV-126 is removed**,
because every result it produced has a home: DV-5 (fixed and verified), DV-10 (fixed, #1463) and
RV-108.

## New probes — Part C of the checklist (P17–P22)

These are RV-149…RV-154. All are read-only except the midnight probe, which needs an overnight
sitting:
- a timezone census of every screen (`Emulation.setTimezoneOverride`)
- fault injection on one read endpoint at a time (`Fetch.enable`)
- how long the phone runs old code after a deploy
- an accessibility-tree and broken-image census
- which `localStorage` keys a tab tap writes (the suspect is `lib/sqlite/cache.ts:82`, feeding
  DV-12)
- the app left open across midnight

## Worth the owner knowing

- **Sweep 1 ran on gesture navigation; sweeps 2 and 3 ran on three-button navigation.** The group
  held back for "sweep 4" (RV-37, RV-127's clearance half, Q-168) needs only the phone switched back
  to gestures.
- **DV-15's fix (#1485, v1.465.23) deployed after sweep 3 ran on v1.465.17**, so the three
  reproductions predate it. The fix has not been checked on the phone; the device check is on the
  entry.

## Not done

No product code and no device run. Q-51's re-placement and the DV lane's ordering are the
Orchestrator's.

<a id="2026-09-24-review-sweep-55-device-verification-debt"></a>

# 2026-09-24 — Review sweep 55: 155 device checks that no queue shows the device agent

**Branch:** `review/dv-verification-debt` · **Agent:** Review · **Docs only.**

The owner asked what else the device agent could check. The agent works from `next-item.js`, which
reads only the backlog. This sweep looked everywhere else an owed device check can live. Six
read-only agents triaged the rows, one chunk each; production reads were run here. Full result:
`docs/reviews/2026-09-24-sweep-55-device-verification-debt.md`.

## Found

- **155 `projectOverview.md` Known-Issues rows say "NOT device-verified" and have no backlog
  entry.**
  - About 60 are checks the phone alone can run. They are filed as **RV-155**, six stations in
    Lane DV.
  - About 55 need the owner. They are grouped into six sittings as **RV-157**, Lane O.
  - About 30 are already answered, or state something no longer true. They are **RV-156**, Lane O.
- **`docs/device-verification-queue.md` holds 5 live rows of 41.** Nothing points DV at it. RV-156
  retires it, and its live rows move into RV-155, RV-157 and RV-131.
- **Seven backlog entries were misfiled behind the device gate.**
  - LB-129, BF-49, Q-104 and BF-11 are shipped work owed a look, so they now carry
    `Verify: device`.
  - BF-22 is a diagnosis DV was already carrying, so it now carries `Lane: DV`.
  - Q-51's gate was answered by sweep 1, so it now carries `Lane: O`: close it or move it down.
  - LA-36 is unbuilt work, and its gate had parked it behind a check that can only happen after it
    ships, so the gate is removed.
- **Q-270's owed read, asked for on 2026-09-04 and never run:** `training_load_gate =
  'insufficient_met'` on **20 of 20** days. The OTS route is called and refuses every day, which
  contradicts the entry's own 08-30 finding that the MET gate clears by midday. The result is
  recorded on the entry, and the next step is Lane A's.
- **Production reads closed five rows:**
  - bodyweight `planned_pct` is null on 0 of 38 sets;
  - bodyweight volume is positive on 19 of 19 exercise logs;
  - `activity_score` is present on 31 of 31 days;
  - BDI is present on 31 of 31 days;
  - `prep_time_sec` is present on 104 of 104 exercise logs.
  `chronic_stress_score` has never had a value (129 days); Q-525 already tracks that.

## Why, and the guard

Writing "NOT device-verified" in a Known-Issues row was how a device check was owed while the
owner was the one running them. The device agent replaced the runner, not the list, so the list
went dark. **RV-158** proposes a CI check on new rows of that shape, the way RV-143 closed the
gated-entry gap.

## Not done

- No device run and no product code.
- `projectOverview.md` is untouched. Moving rows is RV-156's, and the Orchestrator's.

<a id="2026-09-24-review-sweep-56-reads-nobody-ran"></a>

# 2026-09-24 — Review sweep 56: the reads nobody ran

**Branch:** `review/sweep-56-owed-reads` · **Agent:** Review · **Docs only.**

The owner asked for Q-351, Q-353 and Q-144 to be checked, and for another sweep.

- **Q-351, Q-353 and Q-144 are all resolved.** They were fixed in #48, in #79, and on 2026-08-08.
  Their Known-Issues rows are stale; closing them is RV-160.
- **Sweep 56** looked for entries waiting on a read anyone could run. Of 105 candidates, about 33
  were run today and 23 changed their entry. The headline, re-checked here: **12 of 27 recent
  nights are missing from `sleep_sessions`**, and the entry saying the problem does not reproduce
  is wrong.
- Also found: an **unattributed rewrite of 106 stored score rows** at 02:37 UTC (RV-159). A
  never-run baseline re-derive blocks five pass tests (RV-161). The strap log goes silent overnight.
  LA-110's cause turned out to be the new program's baseline block.
- Filed:
  - RV-159: attribute the rewrite.
  - RV-160: close what is answered.
  - RV-161: five owner decisions, each with a recommendation.
  - RV-162: a `Due:` field so an owed read fires on its date.
  Dated reading notes went onto 23 entries.
- Not done: no product code and no production writes. `projectOverview.md` is left to the
  Orchestrator.

Write-up: `docs/reviews/2026-09-24-sweep-56-reads-nobody-ran.md`.

<a id="2026-09-24-review-sweep-57-data-census"></a>

# 2026-09-24 — Review sweep 57: a census of the owner's data, and the decisions sent to the Orchestrator

**Branch:** `review/sweep-57-data-census` · **Agent:** Review · **Docs only.**

The owner asked for two things: send the decisions to the Orchestrator, and do another sweep.

- **Decisions.** No Orchestrator session was running, so the queue is the channel, and position is
  what makes an entry visible. RV-161 and RV-157 sat at ranks 17 and 13, past the top-10 view, and
  now open Lane O. **RV-170** follows them: the history-row policy, which had never been an entry.
- **Sweep 57** checked every daily series in production for gaps, duplicates, stuck values,
  impossible values and cross-table contradictions. Most of it is clean. Seven new entries:
  - **RV-163:** four rules for "last night"; a daytime rest graded as the night on 09-23.
  - **RV-164:** a goal recommendation marked applied without its writes.
  - **RV-165:** the height correction never reached stored body composition, so the DEXA offset is
    off by a point.
  - **RV-166:** prescribed runs are never marked done.
  - **RV-167:** a strap walk's steps are undercounted when its cadence starts late.
  - **RV-168:** a join key is wiped on every program save.
  - **RV-169:** the stress history's self-heal never ran.
- **RV-159 is answered:** a body-comp re-stamp, with no scores recomputed. **BF-38's fix is failing
  on real data.**

Write-up: `docs/reviews/2026-09-24-sweep-57-data-census.md`. No product code and no production writes.

<a id="2026-09-24-review-sweep-58-rules-and-performance"></a>

# 2026-09-24 — Review sweep 58: the rules no check enforces, and where the time goes

**Branch:** `review/sweep-58-rules-and-perf` · **Agent:** Review · **Docs only.**

The owner asked for three things: send the decisions to the Orchestrator, do another sweep, and do
a performance sweep with the device agent's help.

- **Decisions:** already at the head of Lane O (RV-161, RV-157, RV-170, behind OR-150). There are
  no new owner questions.
- **Rules census** (RV-171 to RV-179). The headline is **RV-171**: a failed request in the
  meal-plan setup silently deletes every saved dietary restriction. Also **RV-172**: the sync pull
  nulls supplement ticks' time and frozen vial dose. Also **RV-173**: Coach runs without the prose
  guards.
- **Performance** (RV-180 to RV-186). **RV-180** is the likely cause of DV-13's outage: every row
  re-sorts 12,396 clock anchors. **RV-181**: one HR query is 51% of all database time. The device
  agent gets one sitting (**RV-186**) to record baselines before the fixes.
- The bundle agent stopped on a usage limit after its build finished; its analysis was completed
  here. The `@sentry/conventions` 499 KB lead was checked and is false (657 bytes shipped).

Write-up: `docs/reviews/2026-09-24-sweep-58-rules-and-performance.md`. No product code and no
production writes.

<a id="2026-09-24-review-sweep-59-queue-against-code"></a>

# 2026-09-24 — Review sweep 59: the queue re-read against code, and the deploy failure reproduced

**Branch:** `review/sweep-59-queue-vs-code` · **Agent:** Review · **Docs only.**

- **Queue re-read.** 59 READY entries in Lanes A and B were checked against `main`:
  - 5 are already shipped (LB-123, LB-114, Q-272, Q-3b, Q-112);
  - 2 are wrong as written;
  - 7 are not startable;
  - 4 are partly done;
  - 17 have moved lines or a missing step.

  Each has a dated note. RV-189 asks the Orchestrator to remove, park and reroute. TN-10 and Q-507
  gained `Needs:` fields.
- **Production is 22 merges behind** (1.465.26 live, 1.465.31 on `main`), because the Railway build
  runs out of heap (DV-14). Reproduced locally with a 3 GB cap:
  - the changelog is **not** the driver (cut to 9.8 KB, still fails);
  - source maps make no difference;
  - removing the Sentry wrapper lets the compile pass.

  **RV-188 heads Lane A**: raise the heap in the build script now, then trim Sentry's build hooks
  and stop Railway re-running lint and type-check.
- OR-138 gained a security note: a `set_config` pivot through the admin query route, inferred from
  source and deliberately not probed.

Write-up: `docs/reviews/2026-09-24-sweep-59-queue-against-code.md`. No product code and no
production writes. The build experiments ran on local scratch copies only, and the two temporary
edits were restored before the worktree was removed.

<a id="2026-09-24-review-sweep-60-security-and-privacy"></a>

# 2026-09-24 — Review sweep 60: security and privacy

**Branch:** `review/sweep-60-security-privacy` · **Agent:** Review · **Docs only.**

- **Nine Lane A entries**, placed directly under RV-188 (whose deploy fix every one of them waits on):
  - **RV-191** (HIGH), first: the feedback screenshot is unchecked and the admin panel opens it as
    a URL.
  - **RV-190**: admin query session settings persist on the pooled connection. Reproduced locally.
  - **RV-192**: unverified registration plus Google auto-linking.
  - **RV-193**: the refresh token is in the client-readable session.
  - **RV-194**: Sentry scrub gaps.
  - **RV-195**: three low auth and social gaps.
  - **RV-196**: the native plugin can reveal, clear or redirect the ring key. Needs an APK.
  - **RV-197**: the CSP allows WebSockets to any host.
  - **RV-198**: CI pinning and token scope.

  Every one that touches auth or security is marked for the owner to confirm before merge.
- **RV-199** (Lane O, `Ask:`): three privacy questions for the owner.
  - The clinical baseline doc in the public repo.
  - The personal email on commits.
  - Android backup rules.
- **OR-138** now says to build RV-190 first.
- **The Dependabot standing entry** records the new `adm-zip` high advisory and its fix, still
  below threshold.

Write-up: `docs/reviews/2026-09-24-sweep-60-security-and-privacy.md`. Exploit mechanisms were tested
on the local database only. Nothing was probed on production, and the repo being public, the
entries omit exploit steps.

<a id="2026-09-24-rv103-balance-refresh-gap"></a>

# RV-103 — the failure line was fifteen seconds away, and nothing filled the gap

**Branch:** `fix/rv103-balance-refresh-in-flight` · **Entry:** RV-103 (sweep-2 FAILURE addressed, device check owed) · **Version:** unchanged

## The failure

RV-103 shipped on 2026-09-22 and the device check **failed** on sweep 2. With `energy-balance`
blocked at the network, logging a food left the card on **"320 kcal left" for 7 seconds** with no
failure line and no Retry — a pre-write number presented as current.

The tempting reading is that the reporting never worked. It does. Every channel the original fix
added is wired correctly, and **none of them could have fired in seven seconds.**

## Measured, not reasoned about

`fetchWithRetry` makes four attempts with 2.5 s + 5 s + 7.5 s of backoff between them. Driven with
fake timers:

| at | attempts run | `onExhausted` |
|---|---|---|
| 7 s | 2 | not yet |
| 15 s | 4 | fired |

So the honest report is **fifteen seconds** away. The other channel cannot help: `onRevalidateError`
fires only when a cached value was painted, and the write's own `invalidateNutritionWrite()` has just
emptied the key — on the post-write path it is silent by construction. That leaves fifteen seconds
in which the screen has nothing to say and says nothing.

That is the defect: **not a missing failure state, a missing in-flight one.**

## Fix

`useEnergyBalanceRefetch` exposes `refreshing`, raised when a refetch starts and cleared on all three
exits — a painted value, exhaustion, and a failed revalidation. `EnergyCard` renders *"Refreshing
your budget…"* in the **same slot** the failure line uses, so the card does not reflow when one
becomes the other, and the two are mutually exclusive at the render site as well as at the hook.

Nothing about the retry ladder changed. Shortening it would trade self-healing for speed, and
`fetch-with-retry.ts` is Lane A's file in any case; the gap is covered where it is felt.

## Verification

- **Three new tests.** The timing table above is one of them, driving the real `fetchWithRetry` with
  a dead fetch and fake timers. **Control-run against `origin/main`: two of the three go red** — the
  hook and card assertions. The timing test passes on `main` too, and that is correct: it documents
  the mechanism the device hit rather than guarding this change. Saying so beats implying all three
  discriminate.
- One older assertion in the same file needed loosening: it pinned `if (d) setBalance(d)` as exact
  text, and the in-flight clear now sits beside it. The invariant it exists for — never write null
  into the balance — is unchanged and still asserted.
- `app/nutrition/__tests__` + `components/nutrition/__tests__`: 42 files, **370 tests** green.
- `pnpm check:rules` **Ran 77 of 77** · `tsc --noEmit` clean · test-typecheck at baseline.

**Not exercised:** the S25, which is the point of the entry and why it keeps its `Keep:` under
`Lane: DV`. The device check now covers both lines — refreshing within about a second, the failure
line and Retry replacing it at ~15 s, both legible at the S25 width. Blocking the route needs CDP at
the network layer, because `page.route` cannot see service-worker fetches. Samsung WebView
rendering, safe-area and drifted production data untested.

<a id="2026-09-24-rv111-scanner-back-dismiss"></a>

# RV-111 — the scanner had no back entry of its own, so back threw away the whole flow

**Branch:** `fix/rv111-scanner-back-dismiss` · **Entry:** RV-111 (shipped, device re-check owed) · **Version:** unchanged

## The defect

Log Food → Barcode, then one hardware back, and **no dialog is left** — the scanner and the Log Food
sheet both gone, the capture flow discarded. Confirmed on the S25 in sweep 2, with
`body.scanner-active` set and the app's own window holding focus, so the JS listener really did run.

The scanner **replaces the sheet's body** rather than opening a surface of its own, and neither host
registered a back-stack entry. `SheetContent` renders `BackDismiss` once, so the listener saw exactly
one open surface — the sheet — and popped that.

## Fix

`useSheetBackDismiss(showBarcode, …)` in `capture-actions.tsx` and `useSheetBackDismiss(scanning, …)`
in `ingredient-picker.tsx`. Two lines, exactly what the entry specified.

**Nothing in the stack needed changing, and I checked rather than assumed**, because the entry flags
an ordering risk that is not cosmetic: the scanner injects a global
`body.scanner-active > *:not([data-scanner-overlay]) { visibility: hidden }` and only removes it on
unmount, so a press that closed both surfaces at once would leave the app blank.

It cannot. `handlePop` closes every surface whose `depth > arrivedDepth`, and popping the scanner's
entry (depth 2) lands on the sheet's (depth 1), so `arrivedDepth` is 1 and only the scanner closes.
`sheet-back-stack.test.ts`'s LB-17 case already proves the general property — three layers unwind one
press at a time — which is why this change re-tests the **call sites** rather than the logic.

## Verification

- Three new tests: both hosts register the surface; the hook sits **before** the early return that
  swaps the body (a hook after it would run conditionally, which React forbids and which would also
  miss the exact frame the surface is needed); and neither file hand-rolls `popstate`/`pushState`,
  which is how BF-34's sibling bug happened.
- **Control-run against `origin/main`: two of the three go red.** The third — the no-hand-rolling
  guard — passes on `main` too, and that is correct: it guards a future wrong approach rather than
  this change. Worth stating rather than letting "three tests" imply otherwise.
- `components/nutrition/__tests__` + `components/__tests__` + `lib/hooks/__tests__`: 60 files,
  **462 tests** green. `pnpm check:rules` **Ran 77 of 77** · `tsc --noEmit` clean · lint clean.

**Not exercised:** the scanner itself. It wants a camera, so the sandbox cannot drive it at all —
there is no browser-level check of this fix, only the stack logic it relies on and the source
assertions. The entry keeps a `Keep:` under `Lane: DV` for the S25 re-check: one back returns to the
Log Food sheet with the scanner gone and nothing hidden, a second closes the sheet. Samsung WebView
rendering, safe-area and drifted production data untested.

<a id="2026-09-24-rv144-touch-floor-profile-inputs"></a>

# RV-144 — four profile inputs under the touch floor, and the gate that could not see them

**Branch:** `fix/rv144-touch-floor-profile-inputs` · **Entries:** RV-144 (shipped), LB-140 (re-laned) · **Version:** unchanged

## The defect

Three inputs on `/more/details` — display name, birth year, height — rendered at **346 × 23** at the
mobile-chromium viewport. Review measured 318 × 21 on the S25 and, on a second pass, ~33 px of real
vertical touch area against the repo's 44 px floor. The cause is one class string shared by all of
them: `border-0 bg-transparent p-0 h-auto` collapses the `Input` primitive's `h-9` to a bare text
line, so the row looks right and the control is a third of the size it reads as.

They now carry `min-h-[48px]`, which is the only change to how they render.

**48, not the 44 the entry asked for.** `globals.css`'s own floor for `button`/`[role=button]` is 48
and `e2e/touch-target-size.spec.ts` asserts 48. Shipping 44 would have satisfied the entry and still
failed the repo's own gate the moment that route was covered by it — which is the next paragraph.

**A fourth input, from the sibling sweep the entry asked for.** The same class string is on the
weight-goal input in `components/profile/edit-profile-sheet.tsx`. Fixed here too.
`goal-targets-section.tsx` only *mentions* the pattern in a comment — LB-63 removed it there.

## Why nothing caught it

`touch-target-size.spec.ts` measured five paths: `/`, `/health`, `/workout`, `/nutrition`, `/more`.
All five are tab roots. **`/more/details` is a pushed route, so no automated check has ever looked at
it**, and the three inputs sat undersized for as long as that list has existed. Adding the route is
the durable half of this change; the `min-h` is the part that stops being needed if someone rewrites
the screen.

Measured both ways: with the route added and the fix in, **8 of 8 pass**. With the route added and
the two component files stashed out, `/more/details` fails naming exactly `input 346×23` three
times. So the assertion discriminates, and it independently reproduces Review's finding at a
different viewport.

Nothing else on that route is below the floor.

## LB-140 — re-laned to DV, and why the probe is not worth retrying

LB-140 (the step-by-step meal-plan setup sheet that never opens) was filed with "reproduce on a real
build" as its first action. That was attempted here and **cannot be done in a container**:

- The first failure, `routesManifest.dataRoutes is not iterable`, was a corrupted `.next` left by
  deleting `.next/types` during LB-139. A clean `pnpm build` fixes it, and the manifest's
  `dataRoutes` is `[]` — iterable.
- The real blocker is deliberate. `next start` sets `NODE_ENV=production`, and
  `instrumentation-node.ts`'s `fatalOrLoud` **throws on boot** when the model constants cannot be
  fetched: *"could not list the bucket: SignatureDoesNotMatch (403)"*. The gate is keyed on
  `NODE_ENV` rather than on whether credentials exist, precisely so a real deploy that lost its
  storage variables fails loudly — and the file states outright that no session sandbox can
  authenticate to that bucket.

So the remaining question — does this reproduce outside the dev server — can only be answered on the
phone, with an objective pass/fail nobody has run. That is the lane rule's definition of DV work, so
the entry moved there with the blocker written into it. It returns to Lane B if it reproduces and
closes if it does not, because then the finding is a dev-server artefact. The letter stays `LB-`:
the letter records who found it.

## Verification

- `pnpm check:rules`: **Ran 77 of 77**, all passed — including *"Controls have accessible names"* and
  the safe-area rules that sit next to this class of change.
- `touch-target-size.spec.ts`: 8 of 8 with the fix; `/more/details` red without it.
- `tsc --noEmit` clean, lint clean on both component files.

**Not exercised:** the S25 itself. This is a CSS-only change delivered through the WebView, and the
spec measures the same box a finger lands on, but the device gate is Review's 44 px measurement on
real hardware and that has not been re-run. Samsung WebView rendering, safe-area insets and drifted
production data were not tested. A production build could not be started here, for the reason above.

<a id="2026-09-24-rv146-meal-label-fonts"></a>

# RV-146 — two fonts nobody on the page uses, and the reason the obvious fix was wrong

**Branch:** `fix/rv146-meal-label-fonts` · **Entry:** RV-146 (shipped, device check owed) · **Version:** unchanged

## What was wrong

`app/layout.tsx` loads `Archivo` and `Instrument_Serif` for Q-389's printable meal label and nothing
else. `next/font/google` preloads by default, so every cold start on every screen fetched both faces
before first paint and Chromium logged *"preloaded using link preload but not used within a few
seconds"* four times per visit — Review counted that across ten visits on the S25.

`display: "swap"` was already there and the code comment explains it correctly: swap keeps these off
the **render** path. It does nothing about the **network** path, which is what was being paid for.

## Why the entry's own fix would have shipped a silent fallback

The entry proposed `preload: false` and no more, reasoning that the renderer already awaits
`document.fonts.ready` so the faces would still arrive in time. I measured it in Chromium before
changing anything, and that reasoning does not hold:

| after | `document.fonts.check('700 12px "Archivo"')` |
|---|---|
| `await document.fonts.ready` | **false** |
| `await document.fonts.load('700 12px "Archivo"')` then `ready` | **true** (1 face loaded) |

`fonts.ready` settles loads that are **pending**; it does not **start** one. A webfont is fetched
lazily, when something rendered uses it — and nothing on the page renders in these faces, because
the only consumer draws to a canvas. So with the preload gone the fetch would never begin, `ready`
would resolve against a font set that does not contain the face, and `ctx.font` would fall back
without raising anything. That is precisely the silent substitution the existing await was written
to prevent.

So the fix is both halves: **no preload, and the renderer asks for the face by name before it
waits.** `meal-label-render.ts` now loads each weight it draws with (400, 500, 700 — checked against
every `ctx.font` in the file) and then awaits readiness. `document.fonts.load` is given the bare
first family rather than the whole list: measured, the bare form reports 1 face loaded, the full
list reports 0 while still loading it, and the unambiguous form is the one worth shipping.

## The older defect the probe walked into

Reading the family back is done by `resolveFamily`, and it read
`getComputedStyle(document.documentElement)`. `app/layout.tsx` sets every `next/font` variable on the
**body** class, and a CSS custom property inherits downward only. Measured on `/nutrition`:

```
on <html>:  --font-geist-sans ""  --font-geist-mono ""  --font-archivo ""  --font-instrument-serif ""
on <body>:  "Geist, …"            "Geist Mono, …"       "Archivo, …"       "Instrument Serif, …"
```

All four empty. `resolveFamily` therefore returned its generic fallback for **every** style, so the
printable label has never drawn in any of its four intended typefaces — not Archivo, not Instrument
Serif, and not Geist or Geist Mono either. It is a one-word fix (`document.body`) and it ships here,
because without it the explicit font load this change adds is loading a family nothing asks for.

This is the fourth entry in a row whose stated cause was not the whole cause. Reading the code — and
here, running the browser — before accepting the entry keeps paying.

## Verification

- **Browser-measured**, three probes, not committed: the variable resolution above; `check()` false
  after `ready` and true after `load`; and the family-list vs bare-family difference.
- New `components/nutrition/__tests__/rv146-label-font-loading.test.ts`, 4 tests, **control-run
  against `origin/main`: all 4 red**. It pins the pair together — no preload, load before ready,
  every drawn weight declared, and the family read off `document.body`.
- `components/nutrition/__tests__`: 38 files, 341 tests green. `e2e/meal-label.spec.ts`: 6 passed,
  including the all-styles render.
- `pnpm check:rules` **Ran 77 of 77**, all passed. `tsc --noEmit` clean.

**Not exercised:** the S25, which is what the entry's own pass test asks for and why it stays queued
with a `Keep:` under `Lane: DV`. The sandbox can read a font set; it cannot read the device's
cold-start FCP (1020 ms at sweep 1), and the four console warnings need a real cold start to confirm
gone. Samsung WebView rendering, safe-area and drifted production data untested. The label's printed
output was checked by the e2e render, not by eye on paper.

<a id="2026-09-24-tuning-activity-contributor-behaviour"></a>

# 2026-09-24 — the Activity Score's contributors, measured off its own stored breakdown

Tuning session. Docs-only: two new entries and an amendment, no product code.

## What was measured

`oura_daily_derived.activity_contributors` persists the Activity Score's per-contributor breakdown.
**30 days carry a populated one** (2026-07-28 → 2026-09-24), which makes the model checkable against
stored values rather than a reconstruction. A reconstruction from raw steps and tonnage was built
first, validated against the stored score (median error 0, mean +0.3, **sd 8.8**), and then used only
where nothing is stored — the per-day error is too large for single-day claims.

## TN-76 — four of six contributors do not behave as documented

- `strengthFreq`, the **largest weight at 25**, reads **100 on 29 of 30 days** (sd 2.2, min 88). Q-137
  raised `strengthFreqGoal` from 3 to 5 *specifically* to de-saturate it and predicted "3 sessions →
  ~73". It did not work: the owner trains at or above the goal, so the curve's cap at ratio 1.0 is
  where they sit. The model's largest weight is a constant.
- The renormalised weight base is **75 (19 days) or 85 (11 days), never 100**, so the strength lane
  holds **60%** of the score on most days against the documented 45%. `activeEnergy` (weight 15) is
  absent on all 59 rows; `zoneMinutes` (10) appears on 11 and is 0 on 9 of those.
- The **over-exertion taper has never fired** — ACWR max 1.32 against a 1.5 start.
- **29 of 59 stored rows carry the contributors object with no contributors in it**, so half the
  persisted audit trail is empty. Which writer produces that shape is not established.
- Only `steps` (sd 16.2) and `strengthVolume` (sd 12.4) move the number. Final score: mean 67.9,
  sd 7.4, range 53–82.

Proposal: shift `strengthFreq`'s weight toward `strengthVolume` rather than raise the goal a second
time. Incomplete until someone states how many stored days it moves — computable, and required,
because it re-scores history.

## TN-77 — "previous day's activity" reads today's training window

`readiness-payload.ts:471` and `build-day-audit.ts:182` both compute yesterday's activity score with
**today's** rolling 7-day strength window, and pass none of `zoneMinutes`/`moveHours`/`acwr`. Two
effects: the window is off by a day (differs on 83 of 115 reconstructed days, ≥5 points on 34, worst
−15, mean signed −0.15 so noise not bias), and the prev-day value sits on a weight base of 63 where
the same-day score sits on 75 or 85 — **71% strength against 60%**. Two scales feeding one composite.

## Q-524 amended

The entry measures against `users.steps_goal = 7,000`. **It reads 5,000 now** — applied 7,000
(06-30) → 6,000 (08-11) → 5,000 (08-31, 09-14) — so the gap against the scored 10,000 widened from
1.43× to **2.0×** while the entry sat unbuilt. Checked and **ruled out** an automated overwrite:
`source: 'scheduled'` describes creation, and `status: 'applied'` is only written by a button. The
new finding is that the derived path is **unanchored** — the LLM emits the number, clamped only to
[3,000, 20,000], with the 14-day mean and the current goal as its only anchors, and the live 5,000
sits 37.5% below the `DEFAULT_STEP_GOAL = 8000` the file cites Paluch 2022 for. A fitted correlation
across the four applied recommendations is n=4 and is explicitly not offered as evidence.

**Q-524 also carried no `Lane:` field** despite being decided twice and stating "Lane A has
everything it needs", so `next-item.js` read it as UNCLASSIFIED and no implementer was ever offered
it. Assigned `Lane: A` — the path rule resolves it unambiguously.

## Not exercised

Docs-only, so no runtime surface was touched. Every figure is one user, one activity level, one
training pattern; `strengthFreq`'s saturation is a fact about someone training 5×/wk, not about the
curve. Nothing here tests the score against TN-73's validated RPE residual, which is the one
instrument that has passed a positive control.

<a id="2026-09-24-tuning-activity-energy-double-count-answer"></a>

# 2026-09-24 — the activity double-count question, answered from existing entries

Tuning session, third entry of the day. Docs-only, and deliberately small: no new backlog entry,
because the finding already had two.

## The question

Q-524 proposes deriving the step goal from a target net walking energy, and left a named blocker:
*"the Activity Score already scores `steps` (weight 18) and `activeEnergy` (weight 15) separately —
deriving the step goal from an energy target makes those two contributors measure the same walking
twice. Decide the double-count before shipping."*

## The answer: not live, and probably never

**Nothing to double-count with.** `activeEnergy` reads `body_metrics.active_calories`, which holds a
value on 16 of 147 days and none since 2026-07 (Q-521). Its intended replacement,
`oura_daily_derived.active_calories_est`, is NULL on all 110 days — plumbed through Zod schema,
column, adapter write, sync mapper and local store, with no code anywhere that computes a value
(Q-184, already filed; re-confirmed here rather than re-discovered).

**And the owner's chosen direction removes the other half.** Q-184's own 2026-08-14 check says do not
build the estimate: direction C was chosen on 2026-08-11, and direction B — now Q-204 — replaces
`zoneMinutes` and the dead `activeEnergy` with one physiologically-grounded contributor. If Q-204
lands there is no `activeEnergy` term to collide with. The double-count appears only if Q-184 is
built instead, which that entry advises against.

So the blocker is cleared: sequence the formula `Needs: Q-204` if it is built first, otherwise the
collision cannot occur.

## The more useful half: a cross-reference that prevents a wrong fix

TN-76 (merged earlier today) measured the 15-weight `activeEnergy` absence as distorting the lane
balance — strength holding 60% of the score against a documented 45%. The obvious repair is to revive
its input, and that is the wrong move for exactly the reason above. TN-76 now carries a warning
pointing at Q-204, with the note that Q-204 would also subsume TN-78's threshold question, since
`zoneMinutes` is the other contributor direction B removes.

That connection is the actual output of this session: three entries filed today (TN-76, TN-77, TN-78)
all describe symptoms of restructuring work that was already queued and chosen a month ago.

## Not exercised

Docs-only; nothing ran. No new measurement of the app's behaviour — the production reads here
(147 days of `body_metrics.active_calories`, 110 of `active_calories_est`) confirm counts that Q-521
and Q-184 already recorded, and are reported as confirmation rather than as new findings. Whether
Q-204's single contributor is the right model is not assessed and is not Tuning's to assert without
the proposal in hand.

<a id="2026-09-24-tuning-battery-v6-has-no-backfill"></a>

# 2026-09-24 — the battery fix shipped, and my plan's claim that it re-scores history was wrong

**Branch:** `tuning/battery-v6-has-no-backfill` · **Agent:** Tuning · **Docs-only.**

TN-55 shipped. Verifying its own acceptance test turned up an error in the plan I wrote, not in the
implementation.

## What shipped, correctly

`app/api/body-battery/route.ts` carries `CHARGE_RATE` **0.120**, `DRAIN_RATE` **0.080**,
`STRESS_DRAIN_RATE` **0.020**, `MODEL_VERSION` **v6** — exactly as specified. Production deployed it
(1.465.25 → **1.465.26**).

## What cannot happen

The route's write-through persists **`date: todayIso` only**, and `upsertBodyBatteryDaily` has **exactly
one caller** — that route. No backfill, no wide pass, no admin re-derive exists for
`body_battery_daily`. So v6 appears one day at a time as the app is opened, and **every stored
historical day keeps the model that wrote it, permanently.**

The plan (§5) said *"this change re-scores all 84 stored days"*. It does not and cannot. I inferred a
recompute from the `MODEL_VERSION` bump — which only *labels* which model wrote a row — without checking
that a path existed to rewrite one. The plan is corrected in place; the owner's 2026-08-26
"recompute rather than freeze" decision is **unsatisfied**, not implemented.

## What the owner will see

| model | days | mean end | days at zero | last |
|---|---:|---:|---:|---|
| v1 | 16 | 66.3 | 0 | 2026-07-15 |
| v4 | 18 | 62.9 | 0 | 2026-08-03 |
| **v5** | 52 | **15.2** | **27** | 2026-09-24 |
| **v6** | **0** | — | — | — |

A battery trend spanning today will show a **step from ~15 to ~60 that is a model change wearing the
clothes of a recovery**. Filed as **TN-72, `Lane: A`**, recommending a bounded admin re-derive on the
`backfill-derived-scores` pattern — the inputs survive for the whole span, so the days are re-derivable.
Two alternatives are on the entry, including freezing history and labelling the discontinuity, which
reverses the owner's decision and is therefore his call.

**This is TN-62's shape on a second metric.** A `MODEL_VERSION` bump plus a write path that only touches
today produces a history that silently mixes models — worth checking wherever else a versioned score is
persisted per day.

## The acceptance test has NOT run

TN-55's pass test is distributional — median daily net near 0, mean end ~61, sd ~25, ~0% of days at
zero, ~9% railing at 100. **Zero v6 rows exist**, so none of it is measured, and the battery must not be
described as fixed. Still owed alongside it, from the plan's own caveat: `DRAIN_RATE` fell 7.5× and
Q-521 measured drain tracking *wear time* rather than exertion (`corr(hr_sample_count, drained)` +0.518
vs `corr(steps, drained)` −0.153), so a workout day must be confirmed to still separate from a rest day.
If it does not, that is a separate defect and must **not** be patched by raising `DRAIN_RATE` back.

## Not exercised

Nothing runs. Read-only `claude_ro` queries, **row-scoped to the owner**, plus source reading and one
`/api/version` check. **Not established:** anything about v6's behaviour — no row exists yet. The first
real check is after a few days of reads accumulate. `pnpm check:rules` result below.

<a id="2026-09-24-tuning-estimated-1rm-zeros"></a>

# 2026-09-24 — the field that sets your prescribed weight stores zero on 42 loaded sessions

**Branch:** `tuning/estimated-1rm-zeros` · **Agent:** Tuning · **Docs-only.**

With TN-73's instrument validated, the obvious next target is the number that actually decides what the
owner is told to lift: `estimated_1rm`, from which `target_80` — the prescribed weight — derives.

## The measurement

Of 494 non-deleted exercise logs, **42 store `estimated_1rm = 0`** (8.5%) and **38 store `target_80 =
0`**. None are NULL; every row carries a number, and for 42 that number is zero.

**They are not bodyweight movements** — my first hypothesis, and wrong. The zero logs carry Sumo
Deadlift at 82.5 kg, Barbell Shrug at 87.5 kg, Hip Thrust at 85 kg, at normal rep counts. Only Pull-Up
and Hanging Leg Raise among the 25 affected exercises are unloaded.

## The mechanism, and the part it does not explain

Logs with no `use_for_1rm` set carrying weight: **30 of the 42 zeros (71%)** against **138 of the 452
non-zeros (31%)**. Mean flagged sets per log is 0.76 on the zeros versus 1.79 elsewhere. So "nothing
eligible to compute from" covers most of it, and `calc1RM` returning `weight` when `weight <= 0` is how
that lands as a stored 0 rather than a NULL.

**The leftover is the finding.** Twelve zero logs *do* have a loaded flagged set. And 138 non-zero logs
have *no* eligible set yet store a positive 1RM. The same input condition gives 0 thirty times and a
positive number 138 times — so **`estimated_1rm` is not a function of the log's own sets.** Something
else supplies it much of the time, and when that supplier is absent the field falls to zero. Finding the
supplier is the first task, not touching the formula.

## A correction to my own first reading

I measured the stored 1RM-to-weight ratio rising with rep count — 1.246 → 1.352 → 1.467 → **1.663** at a
mean 17.4 reps — and read it as an uncapped formula, which would have been the historical "wrong high-rep
guard → inflated PRs" bug. The code is more careful than that: `repFactor` averages Epley with a Brzycki
term **frozen at its 20-rep value**, and `amrapScaleFactor` de-rates high reps deliberately (1.0 / 0.97 /
0.93 / 0.88). **And the ratio cannot test the guard anyway** — `estimated_1rm` is per exercise-log, so
dividing by each contributing set's weight attributes one estimate to several sets. The rise is largely
that join artefact. Written onto the entry so nobody re-runs it and files the wrong defect.

Filed **TN-74, `Lane: A`**, with the acceptance criterion that a log with no eligible set should store
**NULL** rather than 0 — downstream needs to tell "no estimate" from "an estimate of zero" — and noting
four logs that pair a zero 1RM with a *positive* target80, which is the inverse inconsistency.

## Not exercised

Nothing runs. Read-only `claude_ro` queries, **row-scoped to the owner**, plus source reading. **Not
established:** what supplies the positive 1RM on the 138 logs with no eligible set; why 12 loaded logs
still read zero; and whether a zero ever reached a prescribed weight the owner actually saw — that needs
the surface rather than the table, and is the part a device pass could answer. `pnpm check:rules` result
below.

<a id="2026-09-24-tuning-ots-nan-confirmed-by-test"></a>

# 2026-09-24 — the failure breaking the load column is asserted by a passing test

Tuning session, sixth and final entry of the day. Docs-only, and short: it discharges one caveat.

## The loose end

TN-79's root-cause amendment identified the mechanism by reading code — the OTS validator rejects any
NaN in the MET series when `noOts === 0`, and the route deliberately supplies NaNs for non-wear gaps —
but said plainly that the route had not been run, so it was inference. The named loose end was whether
any *other* caller passes a dense series and therefore works, which would be the contrast case.

## Answered, and it closes the diagnosis without running anything

**There is exactly one production caller.** `runTrainingStressScore` is called from
`packages/shared/src/health/training-stress.ts` and nowhere else; every other reference is the test
file. So there is no working contrast case — the model has never produced a value from real data in
this app, only from a fixture.

**And a passing test asserts precisely the failure.** `ots.test.ts` contains a case named *"rejects a
NaN-containing MET series (validator error 2)"*: it copies the golden vector, sets `bad[10] = NaN` —
one NaN in 1,440 minutes — and asserts null. The route supplies roughly 275 per day. It is written as
`it` rather than the `itVendor` its neighbours use, because, per the file's own comment, the validator
case is decided before any threshold is consulted and so needs no vendor constants. It therefore runs
green on every CI pass.

**The golden vector is dense.** `bad[10] = NaN` is a mutation applied to make it invalid, so the
fixture contains none — which is exactly why parity passes while production gates.

So the mechanism is no longer an inference. It is the documented, tested contract of the model,
violated by its only caller, with the violation asserted green on every run.

## What it adds to Q-204

A risk its cost estimate did not carry, and not a reason against direction B: the "complete ported
model" has been exercised end to end against a fixture and nothing else. Parity with the TorchScript
reference is real and is not the same as having ever scored one of the owner's days. Q-204 now says to
scope B expecting the first real run to surface something.

## The test that should ship with the fix

One that feeds the route's own grid shape — a realistic series *with gaps* — through
`computeTrainingStress` and asserts non-null. Its absence is why a green suite and a dead column
coexisted for five weeks.

## Not exercised

Docs-only; nothing ran. I did not execute the test suite or the route — the test's source and the
single-caller grep are the evidence, and both are reads. One user, one ring.

<a id="2026-09-24-tuning-ots-nan-contract-root-cause"></a>

# 2026-09-24 — the training-load column is empty because the producer and the model disagree about NaN

Tuning session, fifth entry of the day, and the one that closes the thread. Docs-only.

## What TN-79 left open, and what this settles

TN-79 (merged earlier today) established that the training-stress route runs, persists
`insufficient_met` on 21 straight days, and does so on days whose MET data comfortably clears both of
the gate's stated floors. It explicitly did not identify the cause.

The cause is an input-contract disagreement, and the label was hiding it.

`computeTrainingStress` maps **every** null from `runTrainingStressScore` to
`reason: 'insufficient_met'`. That model returns null down seven paths, only two about MET length. The
one that fires is its validator: **`validate()` rejects the input if any `mets` value is NaN when
`noOts === 0`**. The model's own type comment states the contract — *"validated: no NaN when noOts=0,
≥720 long"*.

And the route deliberately supplies NaNs. `metGridFromDaytimeSamples` leaves a null in every minute
without a sample — its comment says non-wear and charger gaps *"become nulls the OTS core cleans"* —
and `computeTrainingStress` converts those to NaN before passing `noOts: 0`.

The arithmetic agrees: ~1,100 MET values across a ~1,375-minute span is about 275 gap minutes a day,
and the validator returns on the first one. A ring that power-gates when worn-idle guarantees gaps, so
no real day can pass. That is the 21-of-21 pattern.

The intent was sound and the ordering defeats it: `cleanMets` exists to turn sub-threshold readings
into NaN for the windowed mean, so the downstream maths is NaN-aware — but `validate` runs first and
forbids exactly what `cleanMets` handles.

## The correction that matters most

`activity-goal-calibration.md` §11 and Q-204 both concluded from the empty column that direction B
has "no head start" and needs a from-scratch derivation. Wrong, and in the expensive direction:
`runTrainingStressScore` is a complete ported OTS model, 195 lines, wired end to end. **B is one
input-contract bug away from producing values.** Q-204's entry now says so and points at TN-79.

## Three fixes, and the cheap one is a trap

Passing `noOts: 1` dodges the NaN check in one character, but that flag also changes the length test,
so it ships a quietly different model — recorded as "do not". Recommended is filling the grid with a
documented imputation rule plus an explicit coverage floor, because it satisfies the contract rather
than evading it. Making the model NaN-tolerant is the smallest correct diff but edits ported code
pinned to a test vector, so only with a re-pin. Whichever is chosen, the overloaded label must be
split: a validator failure must not report as `insufficient_met`.

## Honest limit

**The route was still not run.** This is a strong inference from the code plus agreeing arithmetic,
not an observation. The confirming step is one log line — `validate(input)`'s return code for
2026-09-22; a `2` settles it. I also have not checked whether some other caller passes a dense series
and therefore works, which would be the contrast case and is worth finding before changing anything.

## Not exercised

Docs-only; nothing ran. No test written, no route invoked, no device involved. One user, one ring.

<a id="2026-09-24-tuning-planned-pct-coverage"></a>

# 2026-09-24 — the prescription is followed; the field that proves it regressed

**Branch:** `tuning/planned-pct-coverage` · **Agent:** Tuning · **Docs-only.**

TN-64 established that readiness gates no prescription. The complement is whether the prescription itself
lands, and `set_logs` carries both planned and actual.

## It lands, and that is worth recording

Where both are present (432 sets): mean load deviation **−0.81 percentage points** (sd 3.45), **214 of
432 (50%) inside half a point of plan**, reps **exact on 228**, mean rep deviation **+0.45**, and only
**17 sets under** the prescribed reps.

So the owner follows the prescribed load closely and overshoots reps rather than falling short. **The
prescription path works** — what TN-64 found disconnected is the readiness *input*, not the mechanism.
Drawing "the app's advice is ignored" from TN-64 alone would have been wrong.

## The regression

| month | sets | with a plan | coverage |
|---|---:|---:|---:|
| 2026-05 | 332 | 0 | 0% |
| 2026-06 | 165 | 0 | 0% |
| 2026-07 | 372 | 147 | 40% |
| 2026-08 | 266 | 247 | **93%** |
| 2026-09 | 151 | 109 | **72%** |

The field arrives in July, peaks at 93%, then **loses 21 points in September**. Two shapes inside that:

- **A five-session hole, 09-07 → 09-12: 24 sets, zero plans.** Those sessions also ran **4–5 sets each
  against 10 either side**, with `intensity_mode` NULL where 09-02→09-06 carry `'deload'`.
- **A steady residue** from 09-14 on, sitting at 8 of 10. Against set position the loss is even — **7 of
  40 on set 1, 7 of 40 on set 2** — so it is whole exercises lacking a plan, not late sets losing one.

## The unification I nearly filed, and why it is false

`planned_pct` derives from a 1RM, so a log with `estimated_1rm = 0` (TN-74) should have no prescribable
percentage — one root cause for two entries. Measured since 2026-07-01: **16% of sets WITH a plan sit on
a zero-1RM log (81 of 503), against 4% of sets WITHOUT one (11 of 286).** The association runs the
opposite way to the prediction, and missing `style_id` does not explain it either (13 of 286). **Two
independent defects.**

## Why it costs the analysis, not just the record

`planned_pct` is the only column that makes adherence measurable. The figures above could be computed on
**39% of sets** (503 of 1,286), and on the five-session hole not at all. Every future claim about whether
the app's advice was taken is bounded by this coverage.

Filed **TN-75, `Lane: A`**.

## Not exercised

Nothing runs. Read-only `claude_ro` queries, **row-scoped to the owner**. **Not established:** why those
five sessions differ; which exercises carry the steady residue (the even split by set position says
per-exercise, but they were not named); and whether the −0.81-point deviation is plate rounding rather
than under-loading — that check would settle it and was not run. `pnpm check:rules` result below.

<a id="2026-09-24-tuning-readiness-gates-nothing"></a>

# 2026-09-24 — the readiness score changes no prescription, and the signal that could judge it was already being collected

**Branch:** `tuning/readiness-gates-nothing` · **Agent:** Tuning · **Docs-only.**

Asked to keep looking at tuning angles. This pass stopped asking whether the scores are *accurate* and
asked whether they are *connected to anything* — and turned up one structural finding and one method.

## TN-64 — readiness gates nothing

`earlyDeloadRecommended` (`lib/health/readiness-payload.ts:665`) is the only place a readiness score
automatically changes what the app prescribes. It is wrapped in `if (program?.phaseMode ===
'automatic')`. **The active program, Bankai, is `ai_dynamic`** — so no readiness score, however low, can
propose a deload on the program actually in use.

It has also never fired under either mode, which makes this measurement rather than inference:

| check | result |
|---|---|
| `early_deload_week_start` | **NULL on all 5 programs**, including the two `automatic` ones running since 2026-06-14 |
| `is_early_deload` | **false on all 117 sessions**, 2026-04-30 → 2026-09-23 |
| days below the score threshold (45) | **12 of 71** — the score half was reachable |
| ACWR, the other half of the condition | **not stored in any table**, so unreachable retrospectively |

**The consumption side is not the bug and was already fixed.** `isEarlyDeloadWeek`
(`packages/shared/src/phase-engine.ts:125`) exists so an `ai_dynamic` program honours a confirmed deload
week — its own comment records that until Q-175 a confirmed deload never reached the AI prescription. So
the half that *honours* a deload works and the half that *offers* one is switched off for the mode in
use. Fixing the wrong half would change nothing.

This reorders the tuning queue's own priorities. Every other tuning entry sharpens a number; re-weighting
contributors or fixing the tail improves a figure no training responds to. Filed `Lane: O` with the
decision brief in the entry, per the standing rule that an owner question is a task rather than a chat
message.

## TN-65 — the validation signal was already there, and the first test is a null

`set_logs.rpe` is populated on **864 of 1,286 sets (67.2%)**, mean 7.40, sd 0.94. Every tuning
discussion so far has treated lived feedback as unavailable, and that was true of the *daily*
self-reports — `perceived_recovery_touched` 0 of 96, `session_rpe` 20 of 103 — while the per-set one was
being collected the whole time.

Controlling for exercise and planned-intensity band, **509 sets**: readiness against RPE deviation
**r = −0.060**, with poor days (<50) at **−0.009** and ready days (70+) at **−0.046** — 0.04 points on
an sd of 0.94.

**That null does not convict the score, because the load moves too.** Across 591 sets, relative load is
**0.940** on poor days against **1.036** on ready days, about 9% lighter. Equal effort at a lighter load
is the shape you want. What nothing stored can say is whether the app or the owner produced that 9% —
and since TN-64 establishes that no automatic path can reduce a prescription, self-regulation is the
more plausible reading. If so, the owner is already doing what a working score would advise.

## Two mistakes worth recording

**I filed TN-63 and TN-64 with `Reference:` used as "background reading".** That field marks an entry as
read-only, so both printed in the REFERENCE section — *"never next"* — instead of the work list. TN-63
shipped that way in #1510 and was invisible as work for about an hour. Both now read *"Where the
mechanism is:"*. This is the third time I have misused a backlog field as prose, after TN-56 and TN-59.

**The pass also produced a tidy story I am not allowed to use.** Within one session name (n=10 each),
readiness against volume: Legs +0.54, Upper +0.57, Lower +0.47, Push +0.005, Pull +0.048 — systemic
fatigue mattering on compound days and not on split days. It is the exact shape of Q-272's retracted
`r = +0.67 (n = 11)`. At n=10, r = 0.54 is not significant. Recorded on TN-65 as not-to-be-cited so the
next session does not rediscover and believe it.

## Not exercised

Nothing runs; queue and documentation only. The measurements are read-only queries through
`/api/admin/db-query`, **row-scoped to the owner**, plus source reading. **Not established:** whether
ACWR ever exceeded 1.2 on a sub-45 day during the `automatic` era (the column does not exist), whether
the 9% load reduction was prescribed or self-chosen, and whether the RPE residual is sensitive enough for
a null from it to mean anything — all three are stated as open on the entries rather than resolved here.
Two query mistakes of mine were corrected mid-pass: `readiness_contributors` stores `{score,
provisional}` objects rather than bare numbers, and the battery columns are `total_charged`/
`total_drained`. `pnpm check:rules` result below.

<a id="2026-09-24-tuning-relane-checks-to-dv"></a>

# 2026-09-24 — three owed checks moved to the device agent, and the parser that nearly stopped one

**Branch:** `tuning/relane-checks-to-dv` · **Agent:** Tuning · **Docs-only.**

Asked to re-organise the outstanding checks so each sits with the agent that can actually do it. The
answer turned out to be less about the checks and more about a field parser that silently keeps the
wrong value.

## Moved to DV — three runs that only needed a signed-in session, not a person

Each of these was waiting on the owner or on Lane A, and in all three cases what is owed is a
**measurement with an objective pass/fail**, which is the device agent's job description.

| entry | was | why it moves |
|---|---|---|
| **TN-62** — re-derive the stale readiness contributors | Lane A + owner gate | no code change; the deliverable is firing `backfill-derived-scores` and reporting what moved |
| **TN-1** — chronic stress refuses inside the granular layer | owner gate | the admin console reads it, and `scripts/device/README.md` names *"what the admin consoles read"* as in reach |
| **BF-13** — the baseline EMA seeds at zero | Lane A | the code shipped; only the run remains |

**The thing that made this possible is boring and worth stating:** both admin routes authenticate
through `auth()` + `requireAdmin` with **no bearer-token path**, so no sandboxed agent can fire them —
and `session.evaluate()` in the device harness runs *in the page*, which is signed in. That is the whole
distinction. It is not that the device is nearer the data.

**TN-62 is a production write and the owner authorised the device agent to press it (2026-09-24).**
Recorded on the entry as a deliberate decision, explicitly not generalisable: a data-dropping or
non-reversible write is still confirm-first. It also carries DV-13's hazard, because the shape matches
the console that left production unresponsive for ~8 minutes — **~370 queries per call against a
`max: 10` pool, one page at a time, dry-run first, never concurrent.**

## Kept where they were, with reasons

- **TN-2** — I claimed its gate was stale. **Withdrawn in place.** It is owed a `.constants.json` set,
  which is a real unsatisfied dependency, so the gate is honest and inert — a different thing from
  stale. TN-55 supersedes the work behind it anyway.
- **TN-58** — the two-week pass test came back to Tuning; it is one read-only query.
- Anything that is a judgement about **looks or whether something feels right** stays with the owner
  even though the phone is where he will look at it. That is the rule the re-laning was checked against,
  not an exception to it.

## TN-63 — the defect that ate TN-1's re-laning first

`laneFromLines` is **first-match-wins**, which `scripts/lib/lane.js` documents as the Q-529 failure. Add
a new field to re-lane an entry, leave the old one standing lower down, and the parser keeps the stale
one. Nothing in `next-item.js` says the entry was ambiguous.

Measured across every heading in the backlog:

- **34 entries** carry more than one lane field.
- **8 disagree** about the value — `LB-94`, `TN-32`, `OR-106`, `BF-111`, `Q-395`, `TN-19`, `Q-420`,
  `PS-7`. Three of those put an implementer letter second, so they are being served to the wrong bucket.
- The other 26 agree, which is harmless today and is exactly how the 8 were made.

**It bit twice in this session.** TN-1 kept an A-lane field on its `Branch:` line, so adding the DV one
changed nothing until the old one was **deleted rather than edited**. Then the note I wrote explaining
the trap re-created it, because the prose contained the literal token and the parser matched inside the
explanation. Filed as **TN-63 (Lane O)**: a check counting field-shaped lines per heading, Custom Rules
77 → 78. Its known cost is that an entry explaining this can no longer quote a field value inline.

## Not exercised

Nothing runs; documentation and queue edits only. **Not established:** whether the device agent's
`session.evaluate()` path actually reaches these two admin routes in practice — the README says the
consoles are in reach and the auth model says it should follow, but nobody has fired one from the
harness, so the first DV attempt on TN-62 is also the test of that assumption. The `vs_yesterday`
reading on TN-58 is two days old and deliberately **not** called a fail. `pnpm check:rules` result and
the entry count are below.

<a id="2026-09-24-tuning-resilience-two-regimes"></a>

# 2026-09-24 — resilience published five weeks of "5", then never reached 5 again

**Branch:** `tuning/resilience-two-regimes` · **Agent:** Tuning · **Docs-only.**

Still looking for a score with an independent comparator. Found that one of the comparators does not
exist, and that a metric nobody has looked at has switched regimes.

## Two disjoint regimes

| regime | days | levels seen | mean confidence |
|---|---:|---|---:|
| 2026-07-24 → 2026-08-29 | **16** | **5, and only 5** | 0.464 |
| 2026-09-07 → 2026-09-22 | **14** | **1, 2, 3, 4 — never 5** | 0.434 |
| everything else | 99 | none published | — |

No value in common, an eight-day gap between them, and a 1–5 band that spent five weeks pinned at the
top and has not touched it since. The model's own `confidence` is ~0.45 in both, so nothing in its
self-assessment marks the change.

**`confidence` is not a gate.** `stress-resilience.ts:310` computes it as `validCount / windowLength`,
so 0.464 means fewer than half the window's days were valid and the level published anyway.

## Mechanism: candidates, none established

Five rollup/stress commits land in or before the gap. **PS-30** (#923) is the interesting one — it
repaired a wear-time defect holding **22 consecutive days (2026-08-14 → 09-04) at 81,000–85,500 s of
non-wear**, overlapping the tail of the level-5 run, and resilience gates on daytime-stress coverage.
**But the level-5 run starts three weeks before PS-30's span**, so it cannot explain the regime and is
not written up as the cause.

**One tempting reading is wrong.** `daytime_stress_coverage_min` is NULL across the whole level-5 regime
and 191 min in the September one, which looks like the missing input. It is not: the column was added on
2026-09-02 (#817), so its absence is the column's age.

**The decisive test is cheap** — re-run the rollup over 2026-07-24 → 08-29 with PS-30 and the September
fixes in, and see whether those 16 days still come back as 5. Filed `Lane: A`, since the rollup is
engine territory and the test is a re-run rather than a calibration.

## Two dead columns, recorded so nobody re-derives them

- **`sleep_sessions.sleep_score`: 0 of 123 nights.** That is Oura Cloud's own sleep score, so **no
  independent comparator for our sleep score exists** — zero nights carry both. Another validation route
  closed, alongside TN-67's.
- **`oura_daily_derived.worn_hours_ble`: NULL on all 129 days**, and `oura_daily.resilience_level` on all
  rows — so the derived resilience is ours, not a Cloud passthrough.

## TN-71 — the contributor share table LA-122 2b was waiting for

That item was deliberately parked until TN-60's tail fix shipped, because the fix moves the table. It has
shipped, so the measurement is now due: each stored day's contributor `input` (Q-501) re-driven through
the **current** composite, share of movement = weight × mean absolute deviation, normalised.

| contributor | weight | share | share ÷ weight | mean | range |
|---|---:|---:|---:|---:|---|
| `hrvBalance` | 15% | **27.7%** | 1.85 | 39.5 | 3–94 |
| `restingHeartRate` | 15% | 19.4% | 1.29 | 45.9 | 5–87 |
| `recoveryIndex` | 9% | **14.4%** | 1.61 | 52.6 | 15–100 |
| `sleepBalance` | 10% | 12.6% | 1.26 | 48.6 | 9–95 |
| `previousNight` | 16% | 11.4% | 0.71 | 55.5 | 15–88 |
| `checkin` | 10% | 8.5% | 0.85 | 58.2 | 30–72 |
| `prevDayActivity` | 9% | 2.8% | 0.31 | 68.2 | 57–79 |
| `activityBalance` | 6% | 2.1% | 0.36 | 68.3 | 54–82 |
| **`temperature`** | **10%** | **1.1%** | **0.11** | 85.3 | **81–89** |

**`temperature` is the finding:** a tenth of the model, an eight-point range across the month, 1.1% of
the movement. Not broken — *stable*, which for an illness signal may be correct — but a constant with a
weight suppresses the terms that do carry signal. Together, `temperature` and the two activity terms hold
**31% of the weight and deliver 6.1% of the movement**, which makes this one weight question rather than
three. Filed `Lane: O`; nothing changes until the owner answers, and it re-scores all history so it should
happen once.

**TN-60 worked, visibly:** `hrvBalance` was 22.8% of movement before the tail fix and is 27.7% now.

### The trap I nearly published

The stored `input` field is much sparser than the rows — contributors with a real input average **0.0 of
9 in July, 1.7 in August, 8.8 in September**. My first pass covered all 71 days, fed nulls for 41 of
them, got neutral 50s back and produced a plausible table that was **41/71 synthetic**. The real window
is **25 days, 2026-08-26 → 09-24**, and it is stated on the entry as one month rather than a year —
which matters most for a temperature term. Fourth time tonight that a coverage check changed a result.

### A stale comment in the file that defines the model

Lines 11–13 of `readiness-composite.ts` say Recovery Index *"has no calibratable hours→score mapping …
so it's always neutral/provisional … never scored"*. It **is** scored — `recoveryIndexScore` maps hours
linearly against `RECOVERY_INDEX_OPTIMAL_HOURS = 5`, ranges **15–100** here, and carries **14.4% of the
movement, third largest of the nine**. The function is right and its own comment is right (`provisional`
there means the *curve* is approximate — the Q-278 distinction); the header is stale, and it is the line
a reader checks first. **Fix the comment, not the code.**

## Not exercised

Nothing runs. Read-only `claude_ro` queries, **row-scoped to the owner**, plus source and git-history
reading. **Not established:** why the regimes differ, whether either is correct, or whether the level-5
month was ever right. This is a measurement and a test, not a diagnosis — and per TN-67 there is no
external validation for this score either, so "correct" can only mean "what the vendor model yields on
sound inputs". `pnpm check:rules` result below. For TN-71: the share table is **25 days**, so it says nothing about a
year, and a temperature term is exactly what would differ across seasons. It also describes which inputs
MOVE the score, never which ones should — per TN-67 there is no external validation to appeal to.

<a id="2026-09-24-tuning-rpe-residual-validated"></a>

# 2026-09-24 — the first thing tonight to pass a validation, and it turns the nulls into a measured ceiling

**Branch:** `tuning/rpe-residual-validated` · **Agent:** Tuning · **Docs-only.**

Five attempts to validate the scores against something external had failed — contaminated, circular or
empty. Before using TN-65's RPE residual again, the obvious question was whether the instrument detects
anything at all. It does.

## The positive control TN-65 never ran

Within-session fatigue is the known effect: later sets of the same exercise at the same load should feel
harder. Residual = RPE minus the mean for that exercise at that planned-intensity band.

| set | n | mean residual |
|---:|---:|---:|
| 1 | 303 | **−0.094** |
| 2 | 253 | −0.021 |
| 3 | 145 | **+0.154** |
| 4 | 80 | +0.129 |

`corr(set_number, residual)` = **+0.156 over 782 sets** (p ≈ 1×10⁻⁵). **The residual beats raw RPE** at
this — raw gives +0.148 — so removing the load effect *strengthens* the fatigue signal. That is the
evidence the correction does real work.

**The raw comparison alone would have been a false positive:** mean RPE rises 7.30 → 7.84 across sets
1→4, but mean planned intensity rises 73.0% → 77.8% too, so part of the raw rise is just heavier sets.

**So the instrument's sensitivity is known: about 0.25 RPE points** (set 1 → set 3). That figure is what
makes the nulls mean something.

## The scores against it — matched exercise, load band AND set number, 527 sets

| | corr with residual | poor | good | difference |
|---|---:|---:|---:|---:|
| `sleep_score` | **+0.001** | −0.113 (<50, n=98) | −0.068 (≥70, n=342) | **0.045**, wrong sign |
| `readiness_score` | −0.053 | — | — | ~0.04 |

The instrument sees **0.25**; neither score moves perceived effort by a fifth of that, and the
sleep-score difference points the wrong way. **Doing one more set at the same load changes how hard
training feels roughly five times more than the gap between the app's best and worst sleep nights.**

## What it does not license

This is about **perceived effort during training** — one narrow outcome. The scores may predict things
it cannot see (injury risk, adaptation, mood, illness), and RPE is self-reported with sd 0.94. The entry
says outright: do not write "the readiness score is meaningless" on the strength of this. Write *it does
not predict how a session will feel, by a measured margin.*

## What changes for calibration work

Future scoring proposals now have an acceptance test with a floor: **move the residual, and the bar is
0.25.** A calibration that shifts it by 0.04 has been shown to sit below the instrument's resolution.
That is stronger than the distributional tests the scoring work has used, which only compare a score to
itself.

Filed **TN-73** with a `Reference:` field — and this is the field used *correctly*, in contrast to
TN-56, TN-59, TN-63 and TN-64 where I wrote it meaning "background reading" and filed buildable work as
read-only. Those entries had work in them; this one has a standard in it.

## Not exercised

Nothing runs. Read-only `claude_ro` queries, **row-scoped to the owner**. **Not established:** that
`oura_daily_derived.day` keys the sleep score to the night *ending* that morning — assumed, not checked
against the sleep-session boundary. And the 527 sets come from ~40 training days, so sets within a day
are correlated: the set-level n overstates independent observations, inflating confidence in the
correlations while leaving the group means (the 0.045) sound. Both are on the entry. `pnpm check:rules`
result below.

<a id="2026-09-24-tuning-sleep-autonomic-collinearity"></a>

# 2026-09-24 — the sleep score's two autonomic terms are one axis

**Branch:** `tuning/sleep-autonomic-collinearity` · **Agent:** Tuning · **Docs-only.**

TN-60 fixed a floor rail in the readiness composite. The obvious next question was whether the sleep
composite has the same one. It does not — it has a different problem, at the other end, and the
measurement that found it is about the model's own geometry rather than its accuracy.

## r = +0.873

Across **60 nights** carrying both terms, `corr(hrv, hr) = +0.873`. Every other pair in the model is far
looser: `hrv`–`total_sleep` 0.559, `hr`–`total_sleep` 0.498, `total_sleep`–`efficiency` 0.681.

`SLEEP_WEIGHTS` gives each of them **14 of 110**, and `sleep-score.ts:20` states the intent outright:
*"Autonomic state (hrv + hr) is now 28 of 110 (25%)."* At r = 0.873 that is one effective axis carrying
25%, not two carrying 12.7% each. The share is what the owner chose; what follows from the collinearity
is that **a single bad autonomic reading moves a quarter of the score** where two independent terms
would have partly cancelled.

## They also go flat together

`hrv` reads exactly 100 on **12 of 60** nights, `hr` on **10 of 60**, and **all 10 of the `hr` ceiling
nights are `hrv` ceiling nights too**. On those, 28 of 110 weight is a constant.

The anchor tables explain it, and the two ceilings are not symmetric. `HRV_RATIO` reaches 100 at a ratio
of **1.35** — 35% above baseline, genuinely rare. `HR_RATIO` reaches 100 at **0.85**, which is its
*first* anchor, so every night at or below 85% of baseline HR scores exactly 100 with no resolution
beyond. One ceiling is a bound; the other is an open plateau.

## What it is not

**This is not TN-60's defect and the entry says so explicitly.** TN-60's rail was demonstrably wrong —
stored history inverted its own ordering. Here the total still discriminates: nights with one railed
contributor average **82.6** (36–94), with two **79.9** (42–92), so railing does not even monotonically
inflate the score. The loss is resolution at the top of one axis.

Full distribution, nights by contributors at exactly 100: 0 → 43 (mean 60.9) · 1 → 12 (82.6) · 2 → 8
(79.9) · 3 → 5 (91.4) · 4 → 3 (95.3) · 5 → 1 (95.0). **29 of 72 nights (40%) have at least one.**

## The recommendation is the small one

Extend `HR_RATIO` below 0.85 rather than touch a weight: one array, cannot reorder any night against
another, and it adds information instead of redistributing it. Then re-measure the collinearity, since
part of the 0.873 is the shared plateau. Weight changes re-score every stored night and would walk into
the same half-applied-history state TN-62 is still waiting on.

## TN-69 — the daytime-stress scalar, third failed validation

Same pass, different metric. `daytime_stress_scaled` drives **61% of Body Battery drain** (TN-55) and
TN-33 recorded that its sign could not be settled from stored data. Three attempts today, all negative:

1. **TN-65's RPE residual** — the new tool. 38 training days, 426 sets: same-day **r = +0.159**,
   previous-day stress against today's residual **r = −0.161**. Two near-mirror magnitudes with opposite
   signs at n = 38 is the shape of nothing. The residual stays the right instrument for scoring work; it
   has nothing to grip here.
2. **Persistence.** Lag-1 over 121 day-pairs: stress **−0.041**, against readiness **+0.361** and sleep
   score **+0.582**. The scalar is independent of its own previous day.
3. **Coherence with the scores.** Over 62 days, readiness **−0.023**, sleep score **−0.003**.

**The one agreement it does show is circular.** Against `stress_high_minutes` r = −0.326 and
`recovery_high_minutes` r = +0.215, both correctly signed — but `daytime-stress-thresholds.ts` defines
those counts as thresholds on *this very series* (`STRESS_HIGH_LEVEL = -0.5`, `RECOVERY_HIGH_LEVEL =
0.5`). Same number, counted differently. That is the trap TN-67 caught in the energy check-in, one
metric over, and it is written down because it looks like external agreement.

The sign convention itself was never the open question — `daytime-stress.ts:72` states *"negative =
below baseline = stressed"* plainly. What is open is whether the series tracks real stress.

**The counter-argument that keeps this short of a verdict:** a stress *exposure* has no obvious reason
to persist day to day, unlike readiness or sleep. So −0.041 alone is not damning, and TN-69 does not
claim the metric is noise. It claims that after three independent attempts nothing supports it, and the
apparent support is circular.

**The useful consequence:** TN-55 cut `STRESS_DRAIN_RATE` 0.20 → 0.020 and called it *"a deliberate
de-weighting of an untrusted input"* — a decision taken on caution. These measurements convert that
caution into evidence. What would actually settle it is a signal collected independently of the ring,
which is the three-week log declined on 2026-09-21; nothing in stored data substitutes.

## TN-1 gains a number

While checking the stress columns: **`chronic_stress_score` is populated on 0 of 129 days**, and
`chronic_stress_contributors` on 0 of 129. TN-1 is in DV's lane awaiting a console read, so the
measurement is written onto it — the value is not wrong or stale, it **has never been produced**, and
the question to carry to the phone is *why has the producer never run* rather than *why is this number
odd*. `resilience_level` beside it is populated on 30 of 129.

## Not exercised

Nothing runs. Read-only `claude_ro` queries, **row-scoped to the owner**, plus source reading. **Not
established:** whether the collinearity is physiological (HRV and overnight HR both index
parasympathetic tone, so 0.873 is unsurprising) or an artefact of both terms being computed from the
same BLE stream — the two look identical from here. And both numbers are **our own** derived outputs, so
this measures internal geometry and is not a validation claim; per TN-67 no external validation of any
score currently exists. `pnpm check:rules` result below. For TN-69 specifically, **not established:** whether the stress
scalar's lack of persistence is a property of stress itself or of the measurement — the two are
indistinguishable from stored data, which is the whole reason three attempts have now failed.

<a id="2026-09-24-tuning-sleep-quality-is-a-default"></a>

# 2026-09-24 — a 108-day self-report that is really a 91-day constant, shown on Home and fed to a model

**Branch:** `tuning/sleep-quality-is-a-default` · **Agent:** Tuning · **Docs-only.**

TN-65 established that set RPE is the only dense lived-feedback signal the app collects. This pass went
looking for a second one and found `mood_logs`: **108 rows across 108 distinct days**, 2026-05-27 to
today, with `energy_level`, `sleep_quality` and `body_state` all **100% populated**. That looked ideal.

## One of its three fields is not data

`energy_level` has real spread — drained 6, low 18, ok 50, good 34. `sleep_quality` has **two of its
five values**: `ok` 93, `good` 15, never `terrible`, `poor` or `great`.

The distribution alone is only suspicious. The date split settles it: **every `good` falls between
2026-05-27 and 2026-06-25, and every row since is `ok`.** The field went constant 91 days ago.

`packages/shared/src/validation/mood-log.ts:13` says why, and says it deliberately: *"the check-in no
longer collects it, so a queued mutation omits it and the write path defaults to `'ok'` — without that
default the `NOT NULL` column rejects the insert and the mutation strands in the outbox forever, which
is how the check-in came back on every app open (#47)."* **The default is load-bearing and must stay.**

## The defect is downstream, and both readers are live

- **`components/home/home-card-widget.tsx:220`** renders `Sleep: {SLEEP_LABEL[moodLog.sleepQuality]}`.
  Home has shown **"Sleep: OK"** every day for 91 days, from a constant, in the card that otherwise
  reports what the owner said. He is being told what he reported about his sleep, and he did not report
  it.
- **`app/api/nutrition-goals/recommend/route.ts:110`** puts `sleep quality=${m.sleepQuality}` into an
  LLM prompt beside a genuinely measured `Xh sleep` and a real `energy=`. The model gets 93 days of a
  constant as observation. The neighbouring Q-76 comment exists because an untrue sleep figure means the
  model *"learns nothing true"* — the same hazard, one field across.

Filed **TN-66, Lane A** (it straddles an `app/api` prompt and a Home component, so the path rule sends
it to the engine half first), with the fix being to distinguish defaulted from reported — TN-57's
`*_touched` convention already exists for exactly this — and **not** to remove the write default.

## TN-67 — and the field that *is* real still cannot validate anything

`energy_level` survived TN-66 as a usable signal, so the obvious next test was readiness against it.
The result looked like the best news of the session: **n = 67, r = +0.619**, group means monotonic —
drained 40.0, low 52.1, ok 67.8, good 72.8. Sleep score against the same target, r = +0.411.

It does not survive a date split, and the split is a natural experiment I had already created:

| era | n | r(energy, readiness) |
|---|---:|---:|
| before 2026-09-19 — picker **seeded from readiness** | **62** | **+0.664** |
| after 2026-09-19 — picker **starts unset** | **5** | **0.000** |

TN-50 removed the `readinessToEnergy(readiness)` default on **2026-09-19** (#1320), and its own
measurement is the mechanism: the saved level matched what the auto-fill would have picked on **45 of
62 days (73%, against ~20–25% by chance)**. So 62 of my 67 days are the app agreeing with itself, and
the clean window is five days spanning two energy levels — unusable in the other direction too.

**No external validation of the readiness score exists today.** This extends the correction already in
[`docs/reviews/2026-09-18-what-the-score-can-and-cannot-say.md`](../reviews/2026-09-18-what-the-score-can-and-cannot-say.md)
(lines 70–74) from *"the `checkin` contributor share is not independent"* to *"`energy_level` cannot
serve as a validation target either"* — which is the use I was about to put it to.

The post-fix sample reaches n ≈ 30 around **2026-10-20**; TN-67 says to re-run the split then, and
which answer means what. One confound survives even that: the sheet still shows readiness beside the
picker by design, and **86 of 108 check-ins are filed 05:00–09:00**, when Home renders the score.
Removing the seeding closed the mechanical loop and left an anchoring one. Separating those needs the
score hidden until the check-in saves, which is a product change and the owner's call.

**This also raises TN-65.** Set RPE was never derived from a score, so it is the only validator usable
on historical data and the only route to an answer before late October.

## Why this is a tuning entry and not just a bug

It closes off the signal I was looking for. `energy_level` is usable as an external validator;
`sleep_quality` is not. An analysis that checked capture rate and spread but not the date split would
have found a 91-day run of `ok` sitting beside a sleep score and read it as the score agreeing with the
owner's perception. That is the same failure mode as the two correlations already retracted this
week — a number that looks like evidence and is an artefact.

## Not exercised

Nothing runs; queue and documentation only. Measurements are read-only `claude_ro` queries, **row-scoped
to the owner**, plus source reading. **Not established:** whether the 15 collected rows are themselves
trustworthy (they predate the field's removal and were not audited), and whether any surface beyond
those two reads the field — the grep covered `lib`, `app`, `components` and `packages/shared/src` but
not a read that reaches it through a helper. `pnpm check:rules` result below.

<a id="2026-09-24-tuning-stale-readiness-history"></a>

# 2026-09-24 — status recheck: everything shipped, and the batched recompute has a cost I didn't price

**Branch:** `tuning/stale-readiness-history` · **Agent:** Tuning · **Docs-only.**

A recheck of where tuning stands. The good news is that the whole chain filed this week has been built.
The finding is that one of my own proposals has an interim state worse than the defect it fixes.

## Shipped since the last tuning session

| entry | state |
|---|---|
| **TN-57** — the unanswered self-report | ✅ both halves: consumers honour `*_touched`, and the write path stores `null` for an untouched scale (first seen on the 2026-09-24 morning row) |
| **TN-58** — the comparative check-in | ✅ control shipped 2026-09-22 (`components/checkin/vs-yesterday-picker.tsx`); entry stays queued for its two-week pass test |
| **LB-124** — the schema + strict body | ✅ an unknown key is now rejected rather than stripped |
| **TN-59** — prose-marker CI check | ✅ Custom Rules is now **77 of 77**, up from 75 |
| **TN-60** — the ±1.5σ rail | ✅ compressive tail, band width 20, chosen by the owner 2026-09-23 |
| **TN-61** — the queue tool's silent truncation | ✅ |

**TN-55 (the Body Battery) has NOT been built** and sits at position **9** in Lane A's READY list.

## The rail fix is live and correct

Driving the shipped `computeReadinessComposite` directly:

| z | −0.93 | −1.63 | −2.46 | −3.24 | −4.37 |
|---|---:|---:|---:|---:|---:|
| **new** | 19 | 9 | 6 | 4 | 3 |
| old | 19 | 0 | 0 | 0 | 0 |

Monotonic, and the days that used to collapse onto one value are separated.

**DV-14's deploy stall was ruled out before anything else** — production is ten hours behind `main`,
which is the explanation to reach for first, and it does not apply: the tail shipped in **1.465.13**
and production is live on **1.465.17**.

## TN-62 — the interim inverts ordering

Stored history was not re-derived, **which is what I asked for**: LA-122 item 2a batches the recompute
behind TN-6, BF-13 and LA-121. Measured over 71 stored days:

- **26 rows** hold `hrvBalance` at exactly 0 or 100; **19 rows** hold `sleepBalance` there.
- The live formula **cannot emit either** — it reaches 0 only near z = −50 and never returns 100
  (z = +20 gives 99). So all 45 are pre-fix clips.
- **2026-09-23 at z = −3.24 stores 4. 2026-09-15 at z = −1.63 stores 0.** The worse night reads better.

Pre-fix the series was at least monotonic — everything past the rail was 0 together. For any trend the
owner reads before the recompute fires, this interim is worse than the defect. I proposed the batch to
stop his history shifting four times and did not consider what the half-applied state looks like.

**`computed_at` is a trap.** 57 of the 71 rows carry a timestamp of 2026-09-23 or later, so they look
re-derived. The timestamp moved; the scores did not. TN-62 states the verification as a property of the
model — no stored value may read exactly 0 or 100 — rather than as a timestamp check.

## The battery got worse while waiting

Still `model_version` `v5`, and over the last 40 days: charge **1.6**/day, drain **56.4**, net
**−54.8**, and **25 of 40 days end at zero (63%)**. When I measured 84 days on 2026-09-21 it was
−29.8/day with 29% at zero. The defect is deteriorating, and its owner-approved fix is ninth in the
queue behind two review sweeps and a device sweep.

## Not exercised

Nothing runs; this is documentation. The measurements are read-only queries through
`/api/admin/db-query`, **row-scoped to the owner**, plus the shipped composite driven locally through
esbuild. **Not established:** why `computed_at` moved on 57 rows without the scores changing — I
measured that it did, not what did it. `pnpm check:rules` **Ran 77 of 77**, all passed.

---

## Owner decisions, 2026-09-24 — and one correction they exposed

Both as recommended: **re-derive now for the rail fix and again after the batch**, and **move TN-55 to
the top of Lane A**. TN-55 is now Lane A's READY #1.

**The correction is the more important half. TN-62 and LA-122 item 2a both named the wrong endpoint.**
They said `POST /api/admin/rederive-baselines`, which re-derives the stored **personal baselines** —
the EMA means and deviations, BF-13/TN-6's mechanism. It does not touch
`oura_daily_derived.readiness_contributors`, which is what holds the stale clipped scores. Firing it
for the rail fix would have reported success and changed none of the 45 stale values.

The endpoint that does the job is **`POST /api/admin/backfill-derived-scores`** — it recomputes each
day through `buildDayAudit`, *"the same compute functions the live route serves from, no formula
restated"*. So the re-derive is **two calls in order**, because baselines feed the z-scores the
contributors are built from: `rederive-baselines` once TN-6 and BF-13 land, **then**
`backfill-derived-scores`.

**Neither can be fired from here.** Both authenticate through `auth()` + `requireAdmin` with no
bearer-token path, so they need a logged-in admin session. `backfill-derived-scores` caps at **31 days
per request** and is dry-run unless `dryRun=false`, so the 71-day history is three pages.

I nearly fired the wrong one on the strength of my own entry. The reason I didn't is that the route's
name says *baselines* and the thing needing rewriting is *scores* — worth stating because the entry
read as authoritative and was wrong.

## Also re-measured today

TN-55's own headline is now understated: the battery's last 40 days run charge **1.6**/day against
drain **56.4** — net **−54.8**, **63% of days ending at zero**, mean end **12.1**. The entry's −30/day
came from 84 days. That measurement is recorded on the entry with an instruction not to quote the
plan's before-figures without re-running the harness.

<a id="2026-09-24-tuning-tn70-resilience-regime-measurement"></a>

# TN-70 — verifying the resilience regime split, and the trap underneath it

**Branch:** `tuning/tn70-resilience-regime-measurement` · Lane A · docs + one corrected comment. No
behaviour change ships here.

## What the entry asked for, and why that is not what I did

TN-70 records that `resilience_level` published **5 and only 5** for sixteen days in July/August and
**never 5 again** across fourteen days in September, and proposes a decisive test: re-run the rollup
over the early span and see whether those days still come back as 5.

**I did not run it, deliberately.** The rollup persists to `oura_daily_derived`, so re-running it
over that span rewrites production rows — a production write, which is the owner's call rather than
Lane A's. The non-destructive form exists (`runOuraRollup` takes an injectable `io`) and is what
remains of the entry. What I did instead was cheaper and, as it turned out, more informative: read
the stored inputs the levels were computed from.

## The entry reproduces exactly, and narrows to one number

Both regimes re-measure to the entry's figures to three decimals. Its ⚠ about
`daytime_stress_coverage_min` also holds — 0 rows early against 14 late is the column's age, not a
missing measurement.

The switch is carried by **one** stored index: `resilience_daily_sleep_recovery`, 10–56 in July and
0–17.6 (mostly exactly **0**) from September. Exactly zero is the clamp, so those days are saturated
at a floor rather than measured.

**Why one index can do that.** `runStressResilience` builds its two recovery terms differently,
replicating a documented `.pt` broadcast: restorative time is a weighted *mean*, sleep recovery is a
*sum* that reduces to ≈ `windowLength × mean`. ~14×. July's window mean of ~36 becomes ~511 where
September's ~3 becomes ~42, which swamps the other two inputs and pins the label at the top band.

That also explains the shape the entry flagged as strange without naming: **the level-5 run carries
the series' highest stress (71–82) and lowest restorative time (15–26)**. The top band went to the
worst-looking days because one term outweighed the rest.

Looking behind that index, three of its four contributors fell together (sleepScore ~90→~48,
hrvBalance ~80→~10, RHR ~70→~25) while recoveryIndex moved the *other* way. A whole-composite
decline is weaker evidence for a single upstream producer fault than the entry's PS-30 hypothesis
assumes.

## The part worth reading — a bug I nearly filed backwards

`recoveryIndex.provisional` is `true` on every one of the 23 days with stored indices, and
`rollup/run.ts:1166-1168` gates its two neighbours on `provisional` but gates recoveryIndex on
something else entirely:

```
hrvBalance:       provisional ? null : score
recoveryIndex:    recoveryIndexHours != null ? score : null
restingHeartRate: provisional ? null : score
```

One of three not checking the flag, on a field that is always set, reads as an obvious miss — and
the doc comment on `ResilienceDayInput` appeared to confirm it in so many words: *"provisional/null →
today contributes no index"*.

I had written it up as a defect before checking what `provisional` means for that contributor.
`score-audit/readiness.ts:158` settles it: recoveryIndex is *"Approximation — **always flagged
provisional**"*. For this one the flag is a permanent property of the method, not the learning-period
meaning its neighbours carry (where a provisional score is a fabricated 50). **Gating it on
`provisional` would null the contributor on every day forever.**

So `run.ts` is correct as written and the **comment** was the defect. It is corrected here, with the
reason, because the next reader will notice the same asymmetry and the comment was actively pointing
them at the wrong fix.

## Verification

`tsc` clean · Custom Rules **78 of 78**. No test changes — nothing executable changed. The
production reads were `claude_ro` (row-scoped to the owner) via the admin endpoint, so every figure
above is **the owner's days only**.

## Not done

The non-destructive local rollup re-run, which is what the entry still owes. And no explanation of
*why* the recovery-side composite declined — that is a measurement, not a diagnosis, and TN-67
already records that no external comparator for this score exists.
