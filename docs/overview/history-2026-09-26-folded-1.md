# Session journal — batch folded 2026-09-26

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-09-24-tuning-training-load-gate-diagnosis"></a>

# 2026-09-24 — Q-270's route is not silent, it is failing with a reason

Tuning session, fourth entry of the day. Docs-only: one backlog entry, no product code.

## Why I was looking

The day's three findings (TN-76, TN-77, TN-78) all turned out to be symptoms of Q-204 — direction B,
chosen by the owner on 2026-08-11, which replaces `zoneMinutes` and the dead `activeEnergy` with one
physiologically-grounded contributor. So the useful question stopped being "what else is wrong with
the Activity Score" and became "is Q-204 startable". It is not: it carries `Needs: Q-270`, and Q-270
has been 🔴 and unexplained for five weeks.

## What the measurement found

Q-270's title says the route is *"neither failing nor succeeding"*. That is no longer true.
`training_load_ots` is still NULL on all 110 days, but **`training_load_gate` is populated on 21** —
every day from 2026-09-05 to 2026-09-25, all reading **`insufficient_met`**. The route runs, reaches
its gate, and persists. The 2026-08-15 warm-once-per-launch fix took, and Q-204's "the persist is
unverified" caveat is answered.

**And the gate fires on days whose data satisfies it.** Measured from the stored tag-`0x50` frames,
seven of the nine days in the hot window clear both floors with room — span 1,342–1,417 minutes
against a floor of 720, and roughly 880–1,190 MET values against a floor of 360. The two that fail
are the partial days at the window's edges, which is expected.

So the loss sits between `oura_raw_samples` and `computeTrainingStress`, not in data availability.
That is the narrowing: Q-270 can stop asking whether the producer runs.

## Two candidates ruled out, one new question opened

The `0x50` decoder exists and looks correct. The clock-anchor window does overlap the real frames on
all nine days, so it is not obviously the cause.

But checking the anchor turned up something else: **the anchor set is not self-consistent.** Five
anchors written within 8 seconds of wall-clock time carry `anchor_ds` values spanning about 25 minutes
of ring time, so at most one is a true `(ds ↔ utc)` pairing and the rest pair a ring timestamp with
its ingest instant. `getOuraClockAnchor` takes newest-by-`created_at`, and with that one the computed
day window sits 48–97 minutes later than the day's actual frame range. It still overlaps, so it is
not the gate's cause — but a day window off by up to 1.6 hours is wrong on its own terms. Left inside
TN-79 rather than filed separately, because the right anchor-selection rule is a judgement about the
ingest contract, not a measurement.

## Honest limit

**I did not run the route, so I have not found the cause.** The entry says so plainly and names the
one log line that would separate "the frames never arrive" from "they arrive and the grid collapses" —
and says explicitly not to lower the 720/360 thresholds to make the gate pass, which would fabricate
a load score from a series nobody has shown is complete.

## Not exercised

Docs-only; nothing ran. MET value counts are estimated from `body_hex` length rather than by running
the decoder — close, not exact, and the margin over the floor is wide enough that it does not matter.
Only the 9 days the hot window holds were measured; older days live in `oura_raw_packed` and were not,
so the 21-day gate run is only partly explained here. One user, one ring.

<a id="2026-09-24-tuning-zone-minutes-intensity-floor"></a>

# 2026-09-24 — the zone-minutes floor is a vigorous threshold wearing a moderate label

Tuning session, second entry of the day. Docs-only: one backlog entry, no product code.

## What was asked

TN-76 measured the Activity Score's `zoneMinutes` contributor as present on 11 of 30 days and **zero
on 9 of them**. This session asked why.

## Two wrong answers first, both checked and both recorded as wrong

**The suppression rule is leaking onto rest days** — no. Crossed against the stored `trained` flag,
`zoneMinutes` is absent on 19 of 19 training days and present on 9 of 9 rest days, plus the 2
training days where it was non-zero and therefore not suppressed. The Q-190 rule does exactly what
its comment says.

**The zeros are the ring's PPG power-gating rather than real inactivity** — also no, and this was the
plausible one: the ring's radio sleeps when worn-idle, which is what a rest day is. But the zeroed
days carry 203–2,395 samples across 21–24 distinct hours, and the day's **maximum** HR was 93–124
bpm. The readings are real.

## The actual answer

The goal and the threshold come from different intensity taxonomies. `DEFAULT_ZONE_MINUTES_GOAL = 22`
cites WHO's 150 min/week of **moderate** activity. `ZONE_DEFS` puts the Light band's floor at **60% of
heart-rate reserve**, which is where ACSM's **vigorous** range begins — and
`activeMinutesFromZoneSeconds` then calls that band `moderateMin`. Genuine moderate activity (40–59%
HRR) falls into zone 1, "Recovery", which the accumulator discards.

Measured for the owner (resting HR 54 over 36 readings, maxHr 187, reserve 133):

| threshold | bpm | reached on |
|---|---:|---:|
| app's zone-2 floor (60% HRR) | 134 | **3 of 31 days** |
| ~50% HRR | 120 | 11 of 31 |
| ACSM moderate floor (40% HRR) | 107 | **24 of 31 days** |

Daily max HR median is **118** — between the two floors. The contributor is unreachable by walking at
any duration, and because a zero is excluded on training days but included on rest days, its
practical effect is a flat rest-day penalty of **8.1 points** (range +7 to +9), larger than the whole
score's standard deviation of 7.4.

## Filed as TN-78, `Lane: O`, ungated

Recommendation attached: move the moderate floor to 40% HRR and keep the vigorous double at 60%, two
fractions in `ZONE_DEFS`. The cost is named — those bands are also a rendered legend and feed the
interval-walk targets — and the alternative (a separate pair of fractions owned by `zone-minutes.ts`)
is written up with why it loses.

**A field mistake worth recording:** this was first filed `Lane: A` + `Gate: owner`, which is the
trap CLAUDE.md names outright — `Gate:` parks an entry, so a question gated on the owner disappears
from the Orchestrator's READY list and nobody is tasked with asking it. Corrected to `Lane: O`,
ungated, plus an `Ask:` field, which is what puts it in the WAITING ON THE OWNER section (8 entries
now). `Lane: A` gets re-applied after the threshold is settled, not before.

## Not exercised

Docs-only; nothing ran. One user, one resting-HR baseline, 31 days. `hrMaxFromAge` is `220 − age`,
carrying roughly ±10 bpm of individual spread — the finding survives it (a 10 bpm lower maxHr still
puts the floor at 128 against a median peak of 118), but the 134 figure is an estimate. HR sampling
is sparse on rest days (~10/hour against ~82/hour overall), so the table counts days with any
qualifying sample rather than minutes; sparsity can only bias that downward. The entry is incomplete
until someone re-runs the zone accumulator to state how many stored days a threshold change moves.

<a id="2026-09-25-docs-lane-b-baton-now-correction"></a>

# 2026-09-25 — Lane B's baton was three PRs stale, and the cause was a silent no-op

**Branch:** `docs/lane-b-baton-now-correction` · **Lane B** (LB-148) · docs-only

The 4-hourly queue check reads the baton before anything else, on the grounds that after a
compaction it may be more current than the session's own context. This time it was **less** current:
`Updated` still read 2026-09-24 and the `Now` line stopped at RV-176, omitting RV-113+OR-161, BF-196
and RV-183 — three merged PRs.

## Why

Every one of those PRs *intended* to rewrite `Now`. `git show 57a65d05 -- docs/agents/state/implementation-lane-b.md`
shows the BF-196 diff touching only `Next ID` and the `Next` section: the `Now` replacement produced
no hunk at all.

The edits were scripted `str.replace(old, new, 1)` calls. **A `str.replace` whose `old` is not found
returns the string unchanged and reports nothing.** The first one no-oped, so the second was written
against text that had never landed, so it no-oped too, and so on. Each PR's other baton edits — the
`Next ID` bump, the `Next` and `Lessons` sections — matched and applied, which is why the file looked
maintained while its most-read line went stale.

Backlog and source edits in those same PRs all carried `assert s.count(old) == 1`. The baton's did
not. That asymmetry is the whole defect: the one file explicitly described as "what survives a
compaction, a container reclaim, or a cold restart" was the one edited without a guard.

## Fixed

`Updated` → 2026-09-25 and `Now` restored to what actually shipped. Every replace in this PR asserts,
including the two that only reshaped text to stay inside the 55-line shrink-only baseline.

Added as a lesson in the file itself, because the next session will script baton edits the same way:
**assert every scripted replace.**

## Not changed

No queue movement, no code. `Next ID: LB-148` was already correct — verified against every `LB-` in
`docs/`, where its only occurrence is the pointer line itself, so the highest *used* is LB-147.

<a id="2026-09-25-docs-or-164-ruleset-was-disabled"></a>

# 2026-09-25 — the ruleset was `Disabled`, and two recorded mechanisms were wrong

**Branch:** `docs/or-164-branch-protection-active` · **Lane:** O · docs-only

`main` is now genuinely protected. It was not, for five and a half weeks, and the reason is one field
nobody opened.

## What was actually wrong

The `ProtectMain` ruleset was created **2026-08-17** with six required checks already configured and
its **Enforcement status set to `Disabled`**. Every rule in it — required checks, `deletion`,
`non_fast_forward`, PR-before-merge — was listed and inert.

That single fact explains both symptoms the queue had been carrying as separate mysteries:

- **PR #1467 merged at 10:18:18Z with `Tests` still running**, and that job reported failure eleven
  seconds later. `main` took a red commit.
- **`enable_pr_auto_merge` answered *"Protected branch rules not configured for this branch"*** on
  three separate probes. That error was **literally true** and was read as a statement about
  Rulesets.

## The part worth keeping: both explanations on file were guesses

`LB-134` and two CLAUDE.md passages blamed *"a Ruleset with no classic branch-protection rule beside
it"*. `LB-52` was filed as *"GitHub's auto-merge API does not see a Ruleset"*. Neither was true.

Both were plausible, both were written with confidence, and both sent sessions looking for a classic
branch-protection rule that was never the answer — including me, hours earlier, telling the owner to
add one. **Nobody opened the ruleset and read its enforcement field**, which is the cheapest check
available and the first one a person would make. The API error was taken as evidence for a theory
instead of at face value.

CLAUDE.md's opening instruction has now been **wrong in both directions**: it first said the checks
were enforced, then that they were not, and neither version had the mechanism right.

## The other half, which is worse

The same disabled ruleset held `deletion` and `non_fast_forward`. So CLAUDE.md's standing claim that
*"`main` blocks force-pushes and deletions"* was **also false** for those weeks, and no session had
reason to doubt it. Nothing appears to have exploited it — the sandbox git proxy cannot push to
`main` regardless — but the guarantee every agent was reading did not exist. It does now.

## The configuration as it stands

Read back from the API rather than the settings screenshots, after the owner's edits at 19:11:30
+10:00:

| | |
|---|---|
| Enforcement | **Active** |
| Required checks | `Lint, Tests, Build, Migration Check, Custom Rules` — **E2E deliberately absent** |
| Merge methods | **squash only** |
| Approvals | **0** |
| Bypass list | **empty** |
| Other rules | `deletion`, `non_fast_forward`, PR-before-merge |
| `strict` (branch up to date) | **off, on purpose** |

**`strict` is off deliberately and the reason should survive.** `main` takes a commit roughly every 8
minutes against a ~7-minute CI run, so requiring a current base can livelock — one docs-only PR
needed **seven** re-merges on 2026-09-24 without it. Revisit only once `enable_pr_auto_merge` is
confirmed working, which it plausibly now is, since its refusal had the same single cause.

**Two consequences to expect.** A flaky job now blocks a merge instead of slipping through. And **if
CI itself breaks there is no path to push the fix** — every fix needs green CI. The escape hatch is
adding the owner to the bypass list temporarily; it is deliberately not pre-configured, because a
standing bypass is the thing that made this ruleset useless in the first place.

## What changed here

`LB-52` removed. `LB-134` closed with the mechanism corrected rather than quietly deleted. `Q-297`'s
second residue closed and the `owner-branch-protection` batch struck from the live pointers.
`BF-106`'s inherited branch-protection notes marked superseded, its own `VACUUM FULL` gate untouched.
Both CLAUDE.md passages and `projectOverview.md` rewritten to state what is enforced and to flag that
the pre-2026-09-25 record cannot be trusted on this point.

No product code. The claim that the ruleset is Active is read from
`/repos/.../rulesets/20923840`, not from the settings page.

<a id="2026-09-25-docs-or-168-deploy-verification"></a>

# 2026-09-25 — OR-168 filed, and a lifecycle I misread three times

**Branch:** `docs/or-168-deploy-verification` · **Lane:** O · docs-only

## The correction first, because it is mine

`OR-163` recorded that the Device Verification agent was **archived** and treated it as a gap, twice
noting its title still ends in 🟢 "so the session list reads as though it is live". The owner
corrected it: **DV runs locally on his machine, so archiving when idle is its normal lifecycle.**
*"Its just inactive until its needed."*

I flagged it three separate times as a blocker on his top-priority item. It never was. The
generalisable part is that **the same signal means different things for a container session and a
local one**, and nothing in the session list distinguishes them — so a role's lifecycle is not
readable from the outside, and reading it as a defect is a guess wearing the clothes of an
observation. The entry now says so and says not to file it again.

## OR-168 — post-deploy verification, notify-only

Merging to `main` auto-deploys to Railway and **nothing checks the result.** The 2026-08-17 outage —
a database-free route unreachable for ~8 minutes — was found by the owner noticing. There is no
`railway.json` and no healthcheck.

The owner chose **notify-only over automatic rollback**, and the reason is worth keeping: an
automatic revert across a migration can leave production worse than the bad deploy did. A check that
tells you beats no check; a check that *acts* is a mechanism that can itself fail.

## Two findings that kill the obvious implementation

The naive version — poll `/api/version` until it reports the merged version — **does not work**, and
both reasons were found by reading the route rather than assuming it:

**`/api/version` cannot identify a deploy.** Its `version` comes from `CHANGELOG[0].version`, so it
moves only when a PR bumps the changelog. Most merges do not and a docs PR never does, so the poll
would sit green against the *previous* deploy. `nativeBuildSha` is the APK's sha, not the web one.

**The route is `Cache-Control: public, max-age=300`** — deliberately, as the single written exemption
in `check-api-no-store.js`. A poll can read a five-minute-old answer and confirm a deploy that has
not happened. The fix is to bust it from the caller, **not** to remove the header.

What makes it work: `RAILWAY_GIT_COMMIT_SHA` **is** available at runtime and already used —
`app/sw.js/route.ts:12` keys the service-worker cache on it. Expose it as `webBuildSha`, poll for
that.

The entry also refuses to pick a timeout. `DV-14` measured production serving 1.465.10 while `main`
was at 1.465.16, so deploy lag is real and unquantified — **measure it first**, or the first false
alarm teaches everyone to ignore the alarm.

## Verification

`pnpm check:rules` — Ran 78 of 78. `check-backlog-pointers` — OK, 499 entries. Docs only; the route
change itself is Lane A's and is not in this diff.


## Amendment — four owner answers, three of which rejected the question

Put four decisions to him in one sitting. **Three came back as product direction rather than a pick
from the options offered**, which is the more useful outcome and worth recording as a pattern: the
options were built from what the entries asked, and the entries were asking narrowly.

**`RV-164` (calorie target) — not declined, NOT TRUSTED.** It asked whether he meant to apply the
09-14 recommendation of 1,618 kcal against the 1,660 still budgeted, offering *declined* or
*slipped*. Both wrong: **"I didnt accept cause I wasnt sure if its been calibrated correctly yet."**
So the blocker is confidence in the recommender, and applying either number fixes nothing — he would
decline the next one identically. Filed as **`OR-169`**, Tuning's, because what is missing is a
derivation he can audit.

**`RV-166` (walks vs runs) — he rejected the frame.** Three ways to link a walk to a prescribed *run*
were offered; he answered **"Maybe we need it to be prescribed heart health activity and
run/walk/other activity counts."** That is a rename plus a widening, not a linking fix. Filed as
**`OR-170`** with `Gate: owner`, because it changes a screen he uses and owes a mockup. The
production data supports him: 26 prescribed runs, 0 completed, 17 pending days already carrying a
walk — the prescription and the behaviour have been different things for the feature's whole life.

**`Q-72` (sleep ratings) — he redesigned the prompt.** The recommendation was to retire the
validation, since 35 of 36 mornings sat on the neutral 3. He answered: **"Sleep is hard to rate. Its
mostly normal. Maybe instead it auto sets it as normal; but if score is high or low it asks was it a
good or bad sleep?"** Better than the option offered, and the reason is that a daily prompt collects
35 neutral answers at the cost of 36 interactions, while an outlier-triggered one collects a rating
exactly where the app's number and his experience might disagree — fewer prompts AND more signal.
Filed as **`OR-171`**; the retire-it recommendation is superseded and the entry says so.

**`RV-161` item 1 — approved as offered:** run `rederive-baselines`, dry-run first. A recompute from
stored inputs, which is the class he already approved under `RV-170`.

**The pattern, which is the thing to carry forward:** an entry that has framed its question narrowly
produces options that are all slightly wrong, and a good answer then arrives as a rejection of the
frame. Three of four here. When the owner's reply reads as "maybe we need X instead", that is the
entry's framing failing, not an evasion — file the reframe rather than re-asking the original.


## Second batch — four more, and one contradicts a standing rule

**The ring key (`OR-160`) closes as moot, and opens something bigger.** *"The oura ring key is
EXCLUSIVE to me… for other people we should not rely on cracked ouras."* He holds the key, so the
permanent-loss argument for backing it up is gone — exclude it, and his Google account stays out of
the custody chain. **`OR-172`** carries the larger half: the BLE pipeline is a re-keyed ring on his
own auth key and cannot be given to another user, so nothing user-facing may assume a ring exists.
Nobody has checked whether any screen or score degrades badly without one; the app has only ever run
for the one user who has one.

**⚠ `Q-30` produced a principle that contradicts `CLAUDE.md`, and he flagged it as unfinished.**
*"We follow the structure of only saving computed/calculated data on railway. Raw data should be
saved on ring only"* — against the Oura Direct-BLE rule that the raw bytes on the **server** are the
archival source of truth and must never be pruned, because the ring's history buffer is finite and
the sync cursor only moves forward. **A decoder fix can only back-fill by re-decoding stored bytes.**
So raw-on-ring-only means a decoder bug found next month is unfixable for every day past the ring's
buffer.

He said *"we will discuss this more"*, so **`OR-173`** records the direction and the conflict rather
than deciding. Two things separate before it becomes policy: whether he means the **ring or the
phone** (D4's device window is the phone, and ⚠ it has not shipped — `pruneRaw` has no caller), and
**how often the archive has actually been re-read**, which nobody has measured and which decides
whether replay is theoretical or load-bearing. Cost is deliberately not the argument: measured today
the archive is 1,522 rows and 1,880,515 frames, under a cent a month. `Q-30`'s ~20 MB trigger is
retired — it was set before the cost was known and the cost turned out not to matter.

**`Q-527` approved: null the corrupt fields, keep the row.** Recorded as a **stated exception** to his
own hand-edits-no policy, because it is one: the 07-29 reading is known-bad and no recompute can fix
it, since the stored input *is* the corruption. Narrow — a reading the device got wrong, not a number
anyone dislikes. Nulling beats deleting because the row records that a measurement happened; a
deleted row claims none did.

**`PS-17` moved up.** 12 of 27 recent dates missing a night, and sleep feeds readiness, the sleep
score and several trends — so it sits upstream of the scoring work waiting on Tuning. The entry now
says to establish the cause first: a night missing because the ring was off is not the same defect as
one the pipeline dropped, and the census did not separate them.

## O-lane review for DV candidates — one re-routed, and a bigger finding

The owner asked which `O`-lane entries belong to Device Verification. Forty-nine READY entries read
against CLAUDE.md's test: DV takes an entry when the next action is **a measurement nobody has taken,
with an objective pass/fail**, on hardware only that agent has.

**One qualifies, and it is the one that unblocks the rest. `OR-127` → `Lane: DV`, at rank 1.** The
device harness (`scripts/device/cdp.js`, `probe.js`) **shipped and has never been run against a
phone** — every line was reasoned from the protocol rather than observed. Its own text says *"the
first run on the S25 is the test"*. That is the definition of the field.

**It was invisible because of a `Keep:`.** The entry read *"Keep: the first real run, and the fix it
will probably need"*, which buckets it under *shipped, residue owed* — out of every lane's READY
list. **The first real run is not residue; it is the entire remaining task.** The field is removed
and the reason recorded, because this is exactly the trap `OR-100` describes: `Keep:` filing
buildable work under a heading that tells the lane not to look. It now outranks the other device work,
since the three check classes no sandbox can reach are blocked on this harness working at all — the
sittings that would clear ~109 owed checks depend on it.

**`BF-92` is a DV check behind one word of consent**, so it gets `Ask: owner` rather than a re-lane:
may a deliberate client-side error be thrown in **production** to prove Sentry receives it? That is
the whole remaining gate, and nobody has just done it because of a note that it *"may page someone"*.

**Four were rejected, each for a different reason, and the reasons are the useful part:**
`DV-1` — the pass test **has** been run on the device machine and failed with a named cause
(`spawnSync npx.cmd EINVAL`) and a named fix. The next action is a scripts change, not another
measurement. CLAUDE.md's trap (a).
`Q-51` — `RV-138` already measured it: 90 warm visits, no outlier. A probe already run is no longer
DV's. Trap (b).
`LB-141`, `LA-136` — product decisions about what the app should do. Those go to the owner even
though the phone is where he would look, per the looks-vs-measurement rule.

## The bigger finding: nine entries said they needed him and nothing asked

Scanning for it turned up **nine `O`-lane entries whose own text says they need the owner — "a
product decision", "a product preference", "it needs the owner before code" — carrying neither
`Ask:` nor `Gate:`.** They sat in READY looking like Orchestrator work.

Four were real and now carry `Ask: owner`: **`TN-67`** (saving a check-in rating to validate
readiness is a product change), **`LA-136`** (does Home get a sleep line back, driven by the
`sleepQualityFeel` that is collected and unused), **`LB-141`** (leaving a walk by the back gesture or
tab bar discards it — what should those exits do), **`RV-119`** (which of seven stacking banners
collapse).

Four were false positives and were left alone — quoted text from a Routine prompt, a demoted lane
field, and prose describing a swipe rather than a decision. **Checking each rather than bulk-adding
is the whole difference**, since an `Ask:` on an entry that is not really his is how the owner's
queue fills with things he should not be reading.

## LA-129 — started, measured, and reverted before shipping

The owner approved *"generate the doc-size baselines in CI"*. Starting it, the entry's own first
bullet said **RE-VERIFY BEFORE BUILDING** and then rejected the approach with a reason. Re-measuring
changed the answer, so the build was written and then reverted rather than shipped.

**The tax is real and it is one file.** Of the last 63 `.size` changes on `main`, **54 are the
backlog's baseline** — against `projectOverview.md` 7, and 1 each for `CLAUDE.md`, `tuning.md`,
`bugfix.md`. `RV-134`'s slack fix did not end the class, but the residue is not slack detection: every
agent edits the backlog and it genuinely grows, so two PRs raise the same number and conflict by
construction. **That is a ratchet working correctly on the wrong file.**

**The membership rule is the script's own first line** — *"the documents every session reads before
it can start"*. The backlog is not one: CLAUDE.md instructs an implementer to start from
`next-item.js`, and nobody reads 32,026 lines to orient. Its size is already controlled by the
protocol that removes finished entries and by the compaction sweep.

**So the approved fix is the wrong one, and the reason matters more than the conclusion.** Generating
all baselines in CI makes every increment inherited — `projectOverview.md` could then grow ten lines a
PR forever, and it once reached **9,647 lines** while its own opening line called it a lean index.
The narrower fix — drop the backlog from the ratchet, report its size instead — removes 54 of 63 of
the churn and keeps every ceiling that matters.

**What stopped the build was a second signal, not the first.** `doc-size-baselines.test.ts:104`
asserts the backlog *"must stay tracked"*, listing it among the orientation docs. That is an
assumption encoded as a test rather than a measurement, but it is someone's deliberate call, and
reversing it is the decision rather than an implementation detail. Two independent signals
contradicting the premise is where building stops and asking starts.

The measurement, the recommendation and the reversal cost are on `LA-129`. Redoing the
implementation is about twenty minutes once the call is made.

---

## The device agent's sweep-4 housekeeping: seven items, four applied

The Device Verification agent sent seven queue-routing items from its sweep-4 plan review. Routing
the queue is the Orchestrator's job, so they were worked here — but **each was checked against the
entry rather than applied on trust, and three did not survive that.** The pattern in all three is
the same and worth naming: they proposed reverting a decision the owner had already made on
2026-09-24, because the reasoning lives on the entry and the sweep read the lane field alone.

### Applied

**`DV-14` — removed, and it is the one that was verified hardest.** It claimed 39 of the last 40
Railway deploys failed on a build OOM. Both halves now check out as fixed: `package.json`'s build
script carries `NODE_OPTIONS=${NODE_OPTIONS:---max-old-space-size=6144}`, and the Railway
deployments query the entry itself documents returns **29 `REMOVED` + 1 `SUCCESS` across the last
30, with zero `FAILED`** (`REMOVED` is Railway's status for a deploy that succeeded and was later
superseded; an OOM ends `FAILED` and stays there). Production serves 1.465.62, matching `main`'s
changelog head. One fresh version number would only have proven the latest deploy worked, which is
why the deployment list was read instead.

*Carried forward, because it was never proven and is now moot rather than answered:* the entry's
"strong candidate for what grew" was `packages/shared/src/changelog.ts`, which is **676 KB** and
still growing. It is nowhere near 4 GB on its own, and with the heap at 6 GB the hypothesis is
untestable from here. If deploys start failing again, that file is the first place to look — and
`OR-168`'s notify-only check is what would surface it, which is the natural home for the note.

**`BF-12` — removed.** The code fix shipped *and* the device pass confirms it.
`packages/shared/src/nutrition/log-meal.ts:131` names the entry in its own comment — the web
fallback's sequential `await fetch` loop is now `Promise.allSettled` — and sweep 3 measured the row
appearing **271 ms** after the tap with no dead-store banner. Both halves, so nothing is owed.

**`BF-147` — the device field discharged.** Its own sweep-3 bullet records the look as PASSING. The
`Keep:` stays: nobody has checked the production S3 credentials, and that is not device work.

**`DV-13` — blast radius recorded.** Five items wait on it (`RV-186` row 9, the
`admin-console-sitting` batch, `BF-10`, `LB-5`, `Q-538`); two already say so in their own text. That
makes it the highest-fanout open device blocker, and what unblocks all five is Lane A's row cap and
per-request timeout — not another look at the phone. Worth its position being visible.

### Corrected rather than applied

**`Q-525` is not a duplicate of `TN-1`, and it needed no change.** TN-1 *shipped* the diagnostic
column recording why the model refuses. Q-525 is the still-open question of whether to trigger the
wide pass or relax the gate. They share a **trigger** — one hand-fired full rollup from an admin
session — not an identity. Deduping would have deleted a live question to save a line.

*And this one caught me.* The fix looked like "batch them", so a batch field was written — onto an
entry that **already carried `Batch: owner-admin-sitting`**, added by OR-148 the day before, 48 lines
further down. It was spotted only because the batch count was checked after the edit rather than
assumed. That is the `Q-529` first-match-wins shape exactly, and the reason it nearly landed is
narrow enough to be worth recording: the entry's fields were read through a `head`-truncated grep,
which is not a read of its fields. The bullet is now a note, not a field, and says so.

### Declined, with the reason written onto each entry

**`TN-62`** was proposed as not runnable until `BF-13`. The endpoints are different and the entry
already says so — BF-13 fires `rederive-baselines` (stored EMA baselines), TN-62 fires
`backfill-derived-scores` (readiness contributors) — and the owner settled the ordering on
2026-09-24: *"re-derive NOW for the rail fix, and again after the batch."* Two runs, deliberately,
the first before BF-13. Parking it would have inverted that decision and held a 🔴 LIVE score
inversion in place for the wait. This was the costliest of the three had it been applied.

**`LA-56`** was proposed as Lane A code. There is Lane A code on it — the heartbeat — but the lane
field names who acts **next**, and next is the admin run the owner assigned to the device agent
(*"It should be able to do the admin sitting too."*). The heartbeat follows the run, because the run
establishes whether a reap fires at all.

**`RV-169`** was proposed as "a production recompute, not a device check". True until 2026-09-24,
when `RV-170`'s answer authorised recompute-from-stored-inputs outright *and* routed such runs to the
device agent, on the ground that the route needs a signed-in admin session and no sandboxed agent
has one.

**`Q-168`** was asked again, and the entry already carries the answer from the last time. Its *What
is actually left* section holds exactly one item and that item **is** the screen look. There is no
second half to hand back.

### The generalisable part

Four of the seven turned on decisions recorded in an entry's body while the routing was read off its
lane field. A field says *who*; only the body says *why*, and the why is what a re-lane has to
argue with. The three declines are now written onto their entries in the same shape, so the next
sweep meets the reasoning at the point it would otherwise re-propose the change.

<a id="2026-09-25-fix-bf196-working-minutes-label"></a>

# 2026-09-25 — BF-196: two duration numbers in different units, neither saying so

**Branch:** `fix/bf196-working-minutes-label` · **Lane B** (LB-146)

The owner asked two questions a day apart that turned out to be the same question:

> *"it says if I complete on time I will finish at 51 minutes which is less than the 60 — does this
> sound right?"*
> *"Like this workout says 48 thats way under 60? Is it not counting warmup?"*

Both numbers were correct. The prescription card's estimate is measured against the **working**
budget — the session budget minus the measured warm-up carve-out (60 − 9) — so 51 against a
51-minute working budget is a session that is exactly full. The done screen's `48:00` is wall clock
from the start of the warm-up, so it *is* counting it. Neither label said which unit it was in, and
the two are naturally compared.

## What shipped

`ai-prescription-card.tsx` renders `~51 min of work`. `done-screen.tsx`'s tile is labelled **Total
time** instead of Duration.

## The entry said one string; there were three surfaces, and one had already solved it

`session-duration-picker.tsx:46` renders the same `estimatedSessionDurationMin` as
`~{n} min of work` — and `pre-workout-screen.tsx:276-284` mounts that picker **directly above** the
card, feeding both from the same field. The entry recommended `~51 min working`, which would have
put two phrasings for one quantity six lines apart on a single screen.

Shipped as **`min of work`**, matching the sibling. The wording is marginally less crisp; the
consistency is worth more, and this is the copy analogue of One Formula. Finding it took a grep for
the field name rather than a read of the two files the entry named — the fourth entry in a row where
the named surface was not the only one.

## Why the summary's naming went on the label

`48:00 total` widens a fixed `grid-cols-2 max-w-xs` tile — about 124 px of content — and breaks its
`tabular-nums`. The label is `text-[10px] uppercase tracking-wide`, where "TOTAL TIME" fits
comfortably and "INCL. WARM-UP" would wrap. Naming it there keeps the number clean and the width
unchanged.

## What this is not

Not an engine change. The plan behind 51 is correct and `expandToBudget` stays gated — the entry is
explicit that the under-fill *is* the finish-early margin. BF-197's separate finding, that the
estimate over-charges by ~14.2 min, is Lane A's and is untouched here.

## Verification

5 tests in `components/workout/__tests__/bf196-duration-units-are-named.test.ts`, including that the
card and the picker carry the same phrase and that the naming stays on the label. **Control run:**
with `components/` reverted, 4 of 5 fail.

`pnpm lint` clean · `tsc --noEmit` clean · 105 tests pass across `components/workout/__tests__`.

**Not exercised: the device.** The card's row is `truncate`, so it clips rather than wraps, and
" of work" spends width ahead of the segments that follow it (`Phase transition suggested`,
`Deload recommended`). BF-196 stays queued as `Gate: device` with that as its `Keep:` and a concrete
pass/fail.

<a id="2026-09-25-fix-lb148-reminder-timezones"></a>

# 2026-09-25 — reminders are timed in the user's zone, not Brisbane and not the phone's (LB-148)

**Branch:** `fix/lb148-reminder-timezones` · **Lane:** Implementation B

## What was wrong

The three modules that decide *when a notification fires* — `lib/meal-reminders.ts`,
`lib/supplement-reminders.ts`, `lib/workout-reminders.ts` — used two different wrong clocks, and
used them **in the same function**:

- the "have I already notified today" key came from a bare `todayInTz()`, which defaults to
  Brisbane for every user;
- the scheduled instant came from `new Date(now).setHours(h, m)`, which sets the hour in the
  **device's** zone.

So on any user not in Brisbane the two disagreed with each other: the day rolled at one hour while
the reminder fired at another, and a reminder configured for 08:00 went off at 08:00 wherever the
phone happened to be. Invisible to the owner, whose phone and profile are both Brisbane — which is
why the class survived RV-176, whose sweep scanned `.tsx` and never looked at `lib/*.ts`.

## What shipped

`lib/reminders/local-instant.ts` (new) — `instantAtLocalTime(dateStr, hour, minute, tz)`, a
`fromZonedTime` wrapper that turns a wall-clock time in a named zone into the real instant. It is
the one place that answers "what moment is 08:00 for this user".

`localDayInTz(at, tz)` beside it, because the first cut of this fix had its own version of the same
bug. Every one of these functions takes `now` as a parameter, and I keyed the schedule off
`todayInTz(tz)` — the *real* clock. In production the two coincide, so nothing would have shown;
against a dated fixture they diverge by months, which is how the existing suite caught it. The day
now comes from `now`, so both halves of each function read one clock and one moment.

`tz: string = DEFAULT_TZ` threaded through seven exported functions across the three modules, and
all **8 sites** converted — `todayInTz()` → `todayInTz(tz)`, `setHours(…)` →
`instantAtLocalTime(todayInTz(tz), h, m, tz)`. Both halves of each function now read the same clock.
Callers updated: `components/sync-provider.tsx` (3 calls) and
`app/nutrition/nutrition-content.tsx`.

**Profile timezone, not device timezone** — a structural call, recorded here because it is the one
thing that would be re-litigated. The repo derives the user's zone uniformly from the session, and
the "notified today" key *must* match the app's own day boundary or the suppression logic is wrong
by construction. Where the two philosophies genuinely differ is a travelling user: profile-zone
means his 08:00 reminder follows his home clock. That is one parameter to flip if the owner ever
wants the other behaviour.

## Verification

`lib/reminders/__tests__/lb148-reminders-use-the-users-zone.test.ts` — 8 tests. Two are behavioural
(an 08:00 Brisbane reminder resolves to 22:00 UTC the previous day, and is still upcoming at that
same instant for a New York user); the rest are scanners holding the three modules free of bare
`todayInTz()` and of `setHours`, and holding every caller to passing a zone.

**Control-run against the pre-fix source: 5 of the 8 fail.** The test has teeth, rather than
describing what the code already did.

**The four existing reminder test files were themselves written in the device's zone** and had to be
rewritten — 27 fixture literals across them. A bare `new Date('2026-06-17T09:00:00')` is parsed
device-local, and the expected instants were built the same way, so they agreed with a `setHours`
implementation *because both sides carried the bug*. They are now built with `fromZonedTime` in the
user's zone and asserted with `formatInTimeZone`. Two things fall out of that: they pass identically
under `TZ=America/New_York`, `Europe/London` and `Pacific/Kiritimati` (checked), and **14 of their 40
cases now fail against the pre-fix modules**, where previously none could.

Not exercised: the notifications themselves. `@capacitor/local-notifications` only runs on the APK,
so what is proven here is the *instant handed to the scheduler*, not that Android fires it. No
Known-Issues row is owed — the scheduling arithmetic is the whole of the defect and it is covered —
but a device sitting that happens to cross a day boundary would be the real confirmation.

## Gotcha worth keeping

The caller scan was written as `/reconcileMealReminders\([^)]*\)/` and **falsely reported three
offenders**: `[^)]*` stops at the first `)`, so `reconcileMealReminders(a, b, new Date(), tz)` ends
at `new Date(` and its `tz` is never seen. A regex cannot balance parentheses. Replaced with a
depth-counting `callArgs()` scan, which is the shape any argument-level source check needs.

<a id="2026-09-25-fix-rv183-local-first-reminders"></a>

# 2026-09-25 — RV-183: a reminder scheduled from the server for a domain the device owns

**Branch:** `fix/rv183-local-first-reminders` · **Lane B** (LB-147)

RV-183 counts requests the client sends for data it already has. Working it found one real
correctness bug, one false comment, and one claim that is wrong.

## The correctness bug, which the entry framed as waste

`sync-provider.tsx` reconciled supplement reminder notifications from `/api/supplements`, on every
launch and every resume. Supplements are CLAUDE.md's **named reference pattern** for offline-first:
the on-device store is the source of truth and the API is backup plus cross-device sync. So the
reconciler was scheduling notifications from whatever had synced.

**A supplement added or stopped offline scheduled the wrong reminder until the next pull.** The
entry saw this as two wasted GETs — "two of them are local-first domains whose data is already on
the device" — and the waste is real, but the reason it matters is that the two sources can disagree
and the device is the one that is right.

It now reads the local store first. The API stays as the fallback: `getLocalStore` returns null on
the web and whenever the store failed to open, and an empty local table is indistinguishable from an
unhydrated one, so both fall through rather than reconciling against nothing and cancelling live
reminders.

**The mapping was extracted, not copied.** `lib/supplements/local-status.ts` now holds the single
local→`SupplementWithStatus` mapping, used by `useSupplements` and the reconcile. Writing a second
one is exactly BF-112, where the inline copy dropped the dose fields, so a dose prompt worked in the
browser — where `getLocalStore` is null and the server's mapping is used — and never fired on the
APK. That failure is invisible off-device, which is why the extraction is not optional.

## The claim that is wrong

The entry says the exercise catalogue (~113 KB) is *"refetched and re-cached on every Workout tab
show"*, citing 3,040 server reads of the table.

It is not. `workout-select-content.tsx:176` passes **`freshWithinTtl: true`** with `TTL_LONG` (6 h),
and `cachedFetchCore` returns before any network call when the entry is fresh
(`lib/sqlite/cache.ts:306`). The flag has been there since the initial snapshot, and
`invalidateExerciseLibrary` — the key's only invalidator — fires on catalogue edits alone. The
ceiling is about four fetches a day per device.

The 3,040 reads are real; they are that ceiling across many days and cold starts. **A read count
localises nothing on its own**, and the entry now says so rather than leaving a future session to
"fix" a path that is already correct.

## The false comment

`more-content.tsx` claimed *"cachedFetch honours TTL_MEDIUM, so a re-show inside the window costs
nothing"*. The TTL governs whether the cached **paint** is used, never whether the request is sent —
only `freshWithinTtl` skips the round trip, and neither call passes it. So a re-show did send two
GETs, as the entry said. The comment now says what is true.

**The requests themselves stay.** Making the comment true instead would mean adding `freshWithinTtl`
to `more-user-profile` and `more-seasons`, and CLAUDE.md requires a written invalidation proof for
that — every write that changes either payload, shown to be in a group that clears the key. A missed
writer turns a brief stale paint into hours of hard staleness on the screen that shows who you are.
That proof is not written, so the flag is not added.

## Verification

7 tests in `lib/supplements/__tests__/rv183-local-first-reminders.test.ts`: the mapping keeps the
dose fields BF-112 lost, marks only what was logged today, stamps the caller's userId, and is the
only copy; the reconcile reads the device first and keeps its fallback. **Control run:** with the
call sites reverted, 3 of 7 fail.

`pnpm lint` clean · `tsc --noEmit` clean · 131 tests pass across the touched suites.

**Not exercised: the device, which is where this one actually lives.** `getLocalStore` returns null
in the web harness, so every assertion here is about source and about the mapping in isolation — the
local branch itself never runs outside the APK. The behaviour that changed is offline behaviour on a
native build, and nothing in this sandbox can reach it.

## Left open

The food-log/meal-types pair on the same reconcile has the same local-first argument, but
`reconcileMealReminders` needs a join this PR did not build. The three fetches duplicating Home's,
`next-session`, and the Lane A halves (`push-then-revalidate.ts`, `cache-groups.ts`, the 2N+1
post-write round) are untouched. RV-183 stays queued with all of it named.

<a id="2026-09-25-fix-rv183-meal-reminders-local-first"></a>

# 2026-09-25 — RV-183's meal half, and the "join" that did not exist

**Branch:** `fix/rv183-meal-reminders-local-first` · **Lane B** (LB-147)

Yesterday I shipped RV-183's supplement half and deferred the meal half, writing that
`reconcileMealReminders` "needs a join this PR did not build". **That was wrong, and reading the
function rather than assuming is what found it.**

It takes `Pick<FoodLog, 'mealTypeId'>[]` — not a joined food log — and reads exactly six fields off a
meal type: `id`, `name`, `emoji`, `remindersEnabled`, `timeEndHour`, `required`. `LocalFoodLog` and
`LocalMealType` already carry every one. There is no join anywhere in it.

What actually blocked the local read was the **declared parameter type**. Both functions said
`MealType[]`, which demands `userId`, `sortOrder`, `timeStartHour` and `createdAt` that neither
function touches — so the on-device row could not be passed without inventing four fields. Inventing
a field is how BF-112 shipped a dose prompt that worked in the browser and never fired on the APK.

## What shipped

`MealTypeForReminders`, a `Pick` of the six fields the module reads, on both `computeMealReminderActions`
and `scheduleEndOfDayReminder`. The local row then satisfies it directly, with no mapping layer at
all — which is better than the supplement half, where a mapping was unavoidable.

`sync-provider.tsx` now reads meal types and today's food logs from the local store, API as
fallback. Same correctness point as the supplements: food logs are an offline-first domain, so
reconciling reminders from the server meant **a meal logged offline kept nagging you to log it**
until the next pull. It also drops two more GETs from every launch and every resume.

**The two empty cases are deliberately not symmetric.** An empty meal-type table falls through to the
API — that is an unhydrated store, not a user with no meals, and treating it as the latter would
cancel every reminder on a cold device. Zero *food logs* does not fall through, because that is
precisely the state the reminder exists for.

## Found on the way out — filed, not fixed

The three reminder modules time every notification in **Brisbane or in the phone's zone, never the
user's**: eight sites across `meal-reminders.ts`, `supplement-reminders.ts` and
`workout-reminders.ts`. Four are bare `todayInTz()` (the "already notified today" key, so the day
rolls at the wrong hour) and four are device-local `setHours` (the scheduled instant, so an 08:00
reminder fires at the phone's 08:00).

**RV-176 fixed exactly this class and missed these, because that sweep scanned `.tsx`.** Filed as
`LB-148` rather than folded in here: it changes *when notifications fire*, on a daily surface, and
needs the user's timezone threaded into three modules that currently take none. That is its own
change with its own verification.

It is invisible for the owner — his phone and his profile are both Brisbane — which is why the class
keeps surviving.

## Verification

7 tests in `lib/__tests__/rv183-meal-reminders-local-first.test.ts`. One is a compile-time guard: a
`LocalMealType` is assigned to `MealTypeForReminders[]` with no mapping, so widening the parameter
back to `MealType` stops the file compiling. **Control run:** with the call sites reverted, 3 of 7
fail.

`pnpm lint` clean · `tsc --noEmit` clean · `check:rules` 78 of 78.

**Not exercised: the device.** `getLocalStore` returns null in the web harness, so the branch this
PR adds never executes here — as with the supplement half, the behaviour that changed is offline
behaviour on a native build.

<a id="2026-09-25-la-129-unratchet-backlog"></a>

# LA-129 — the backlog leaves the doc-size ratchet and is reported instead

**PR:** `fix/la-129-unratchet-backlog` · **Owner approved** 2026-09-25, on the narrow fix rather than
the entry's original proposal.

## What changed

`docs/doc-size/docs/implementation-backlog.md.size` is deleted. `check-doc-index-size` now prints

```
check-doc-index-size: UNRATCHETED — docs/implementation-backlog.md 32015 lines (reported, not enforced; LA-129).
```

on every run, after the `OK —` line. The other nine tracked documents are unchanged and still fail
the build when they grow past their number.

## Why, and why not the thing the entry was originally filed to do

The entry proposed **generating all baselines in CI**. That was approved in a first pass and then
**not built**, because opening the entry surfaced its own `⚠ RE-VERIFY BEFORE BUILDING` warning:
`RV-134` had considered and rejected it. Generating a baseline makes every increment inherited, which
removes the **ceiling** — and the ceiling is the whole point. `projectOverview.md` once reached
**9,647 lines** while its own opening line called it a lean index.

So the question was re-measured instead. **Of the last 63 `.size` changes on `main`, 54 were this one
file** — against 7 for `projectOverview.md` and 1 each for three others. The churn was never diffuse;
it was one document, and `RV-134`'s slack band could not fix it, because a band cannot help a file
that genuinely grows past it.

**The membership rule is this script's own first line** — *"the documents every session reads before
it can start"* — and the backlog is not one. CLAUDE.md sends an implementer to
`node scripts/next-item.js`, and nobody reads 32,000 lines to orient. Its size is already governed by
the protocol that removes a finished entry, and by the compaction sweep.

This session was itself the evidence: **four separate merge conflicts on that single line in one
evening**, across three PRs, each resolved identically and each costing a CI cycle.

## The test that pinned the opposite

`scripts/__tests__/doc-size-baselines.test.ts` asserted the backlog *"must stay tracked"*, listing it
among the orientation docs. That is what stopped the first attempt: two independent signals
contradicting the premise is where building stops and asking starts.

It is now **inverted rather than deleted**, and the choice matters: an absent expectation would let a
future `--fix` run silently re-create the baseline, which is exactly how this would come back. The new
assertion fails if `docs/implementation-backlog.md` reappears in the baselines, and its message says
to delete the file rather than raise it.

Verified empirically that `--fix` does **not** re-create a baseline for a file with no `.size`.

## Two things the change dragged in

**CLAUDE.md named the deleted file.** `check-claude-md-paths` caught it. The passage was wrong in a
more interesting way than a dead path, so it was rewritten rather than patched: the "one PR per filing
sweep" rule cited the `.size` line as making conflicts *guaranteed*. That mechanism is gone; the rule
stands anyway, because N PRs editing the backlog still have N-1 chances to collide in the file itself.
The dead path is now in that script's `DELIBERATE` list with its reason — CLAUDE.md names it
**because** it was deleted.

**CLAUDE.md grew 5 lines** and its own baseline was raised, with a note. The ratchet working on a file
it should work on, in the same PR that removes it from one it should not.

## Not done

`enable_pr_auto_merge` is still recorded in CLAUDE.md as not working on this repo, with the error
*"Protected branch rules not configured for this branch"*. That error was almost certainly the
`ProtectMain` ruleset sitting at Enforcement `Disabled`, which the owner set **Active** earlier today
(OR-164) — so it may now work. **Untested, and left claiming what it has always claimed** rather than
flipped on inference. This is the second passage today found to have been wrong in both directions;
guessing a third time is not the fix.

## Verification

`Ran 79 of 79` Custom Rules steps. 39 script test files, **381 tests**, all passing.
`check-backlog-pointers` OK, 511 entries. `--fix` confirmed not to re-create the dropped baseline.

<a id="2026-09-25-la131-rest-day-macros-one-place"></a>

# LA-131 — what a rest day means, in one place

**Branch:** `fix/rest-day-macros-one-place` · **Lane A** · `[nutrition][platform]`

## What was duplicated

`REST_DAY_CARB_REDUCTION = 0.15` was declared in two files, and so were the three lines deriving
from it — `carbShift = round(carbs × reduction)`, `carbs − carbShift`, `calories − carbShift × 4`.
The two files are `app/api/nutrition/meal-plans/generate/route.ts` and
`app/api/nutrition/meal-plans/[id]/structure/route.ts`: the **generate** and **restructure** paths
for the same plan.

The copies agreed — 0.15, identical arithmetic, verified again against `main` before touching
anything. That is what made this cheap now and expensive later: tune one and a restructure silently
re-targets every rest-day meal against a different definition of a rest day than the one that
generated it, and **neither number looks wrong**. The structure route's own comment said
*"matches the generate route"*, so the duplication was known and written down rather than accidental,
which is the part a grep would not have told you.

## What shipped

`packages/shared/src/nutrition/rest-day-macros.ts` exports `REST_DAY_CARB_REDUCTION` and
`macrosForDayType(daily, dayType)`, returning the adjusted targets plus `carbShiftG`. Both routes
import it. `grep -rn REST_DAY_CARB_REDUCTION app/` now returns **nothing** — the only remaining
mention in `app/` is a comment in a test.

## One thing the entry did not name, and it was a latent divergence

Review sweep 59 correctly found a **third** use in the generate route: the prompt line at what is
now `:305` passed `dailyCarbs * REST_DAY_CARB_REDUCTION` to `restDayCarbLine` — the **unrounded**
product — while the variant targets used `Math.round(...)`. So the sentence shown to the model
described a slightly different shift from the one actually applied.

It never produced a wrong string, because `restDayCarbLine` rounds internally and rounding is
idempotent. It is fixed anyway: the prompt line now takes `macrosForDayType(...).carbShiftG`, the
same number the targets used. That is why the helper returns `carbShiftG` alongside the macros
rather than only the adjusted totals.

## Verification

`packages/shared/src/nutrition/__tests__/rest-day-macros.test.ts`, 7 cases. The load-bearing one is
an **equivalence test**: the code that stood in both routes is transcribed into the test file and
compared against the helper across 401 carbohydrate values × 3 day types. A refactor that stops
being a refactor fails there.

Mutation pass:

| mutation | killed |
|---|---|
| drop the rounding, carry the fraction into the calories | 2 of 7 |
| the reduction drifts to 0.20 — the exact failure this entry exists to prevent | 5 of 7 |
| apply the shift on a training day too | 2 of 7 |
| **control:** `carbShiftG * 4` written as four additions | **0 — survived, as intended** |

Behaviour preserved: `app/api/nutrition` + `packages/shared/src/nutrition`, **50 files / 539 tests
passed, exit 0**, including `use-library-wiring.test.ts`, which asserts the 15% rest-day reduction
end-to-end through the generate route.

Gates: `tsc --noEmit` clean · lint 0 errors · **Ran 79 of 79 Custom Rules steps** · full suite green.

## Not exercised

Pure refactor of server-side domain math — no schema change, no local-store change, no migration, no
device path, and no user-visible behaviour, so no version or changelog bump. The two routes were not
driven by hand on `pnpm dev`; their own 50-file suite covers them and the equivalence test pins the
arithmetic directly, which is a stronger check than one manual pass would have been.

<a id="2026-09-25-la140-hrv-baseline-writer"></a>

# 2026-09-25 — LA-140: a column plumbed end to end and written by nothing

**Branch:** `la140-persist-hrv-baseline` · **Lane A**

`oura_daily_derived.night_hrv_baseline_ms` had a complete pipeline — `schema.ts`, `DERIVED_COLS`,
the row mapper, the `pushMutations` branch, the local SQLite table, the sync delta, the Zod
validator — and **no writer**. NULL on all 130 production rows.

## Why a dead column is worse than an unused one here

`computeResilienceForDay` gates `contributorsOk` on this exact field being non-null, and falls back
to a **fabricated 50** for the stress scaling (`stress-resilience.ts:395`). So a reader who finds
NULL reasonably concludes the input was missing, when in fact it was computed and discarded. TN-70
hit precisely that: it could measure the resting-heart-rate half of its regime comparison and not the
HRV half, and said so.

Scoring was never affected — the resilience compute uses the in-memory `nightHrvMs`, which is why
this survived. The cost was diagnostic, and it was paid.

## Persist, not delete

LA-140 left the choice open: persist what the rollup already computes, or delete the column and its
plumbing. **Persist**, because TN-70 has a named, live need for the value and deleting would
foreclose it permanently, where persisting costs one line. The trap disappears either way; only one
of the two options leaves the question answerable.

**It joins the GUARD, not just the patch**, and that is the part worth reading. The surrounding write
is gated on `res.dailyIndices || res.level != null || res.daytimeStressCoverageMin != null` —
resilience having produced something. Gating the night's own *input* on the score succeeding is
backwards: a day the score skipped is precisely a day someone needs the input for. `nightHrvMs` comes
from `latest.hrvBaseline`/`hrvAvgMs` at the top of the loop and does not depend on `res` at all, so
`nightHrvMs != null` joins the condition.

## What this does not do

**The 130 existing rows stay NULL, so TN-70's July-versus-September comparison is still unanswerable
from the database.** The rollup re-derives each day from the packed raw tier, so a wide pass *would*
fill history — that pass is real work and has not been run. TN-70's entry now says so rather than
implying the fix unblocked it.

## The finding that came out of asking how many others there are

Rather than assume this column was alone, I asked production how many `oura_daily_derived` columns
are NULL on every row: **eleven**. All-NULL is not proof of a missing writer — `chronic_stress_*` is
gated on 21 complete nights by its own model, `recovery_index_hours` writes from `run.ts:561` — so
each was checked against the code. **Four have no writer at all**: `active_calories_est`, `pwv`,
`worn_hours_ble`, and the derived `vascular_age` (distinct from `oura_daily.vascular_age`, a
different table that is written). None has a reader either, so deleting them and their plumbing is
probably right — a migration plus a local SQLite version bump, so it ships alone. Filed as
**LA-142**.

> **⚠ Corrected 2026-09-25, after this entry was first written.** It said **six** columns had no
> writer, and that two of them — `training_load_ots` and `training_load_high` — were read by live
> surfaces, making them LA-140's trap with consumers attached.
> **`app/api/training-stress/route.ts:89` writes both**, on its success branch. The repo-wide grep
> behind that claim truncated its output per column and never surfaced the file.
>
> The symptom I described is real: both columns are all-NULL, so `weekly-digest`'s `otsHigh` is
> permanently false and the AI chat's `trainingStress` tool always returns an empty array. But the
> cause is that the route's gate never reaches `ok` and persists a reason instead — **TN-79's
> subject, already open** — not a missing writer. Fixing the gate fills the columns.
>
> Recorded here rather than quietly edited, because the original claim shipped in this PR's body and
> the wrong half is the interesting half: an entry filed to describe "measured the wrong thing"
> made that exact mistake within the hour.

## Verification

- `tsc` clean, `typecheck:tests` at baseline, lint 0 errors, full suite green, Custom Rules 78 of 78.

**Not exercised:** no test drives the rollup's derived writes — there is no harness for
`aggregateOuraRawSamples`, and building one for a one-line persist would be disproportionate. So
**this is verified by the type system and the plumbing audit above, not by a test that watches the
column fill.** The honest check is a production read after the next rollup: `night_hrv_baseline_ms`
should stop being NULL on new days. It has not been run, because the code is not deployed yet.

<a id="2026-09-25-la141-clock-inverse"></a>

# 2026-09-25 — LA-141: the ring clock's inverse was not an inverse

**Branch:** `rv182-clock-anchor-offset` · **Lane A**

## What was wrong

`resolveDsToMs` converts a ring counter value to wall-clock time. **Q-139 deliberately removed
bracket interpolation from it**, because the slope that derives — `Δutc / Δds` — is not a property of
either clock. The ring's counter ticks at exactly 100 ms by construction, so the slope was never the
unknown; only the offset is. While the ring drains buffered history, ds advances far faster than the
wall clock and that ratio collapses: Q-139 measured **17,094 ds (28.5 minutes of ring time) arriving
in 95 seconds**, an 18× squeeze, which is how one 60-second step block came to hold 1,555 steps.

`resolveMsToDs`, its inverse, kept interpolating. Its docstring said it was *"symmetric with the
forward direction"*. It was not — it carried exactly the defect Q-139 had removed from the other
half, and asserted the opposite.

Measured on Q-139's own drain shape, a ds round-tripped **16,144 ds away from itself — 26.9 minutes
of ring time**.

This is the third time this method has been measured and found wrong in this repository. Q-139 found
the 18× compression. A later sweep ran naive interpolation against the nine most recent real nights
and found every one shifted **10–48 minutes later** (one outlier +79), because a backlog drain mints
several anchors seconds apart covering very different ds ranges, so a "bracketing" pair is often two
members of the same burst and brackets nothing meaningful. That sweep's conclusion was *"do not
re-attempt naive interpolation"*. The inverse was still doing it.

## The fix

Both directions now go through one `offsetForEpoch`, so `resolveMsToDs` is literally
`resolveDsToMs` solved for `ds`:

```
resolveDsToMs(ds)  = ds * 100 + offset
resolveMsToDs(ms)  = (ms - offset) / 100
```

They are inverses by construction rather than by two models happening to agree, which is what the
shared helper is for. The trade-off Q-139 documented carries over unchanged and is restated at the
call site rather than left to be rediscovered: one offset per epoch ignores the ring's crystal drift
across that epoch, seconds per day. That is the error accepted in exchange for removing one measured
in tens of minutes.

## Who was affected

Nine call sites in `adapter.ts` convert a wall-clock window into a ds range to query
`ring_timestamp_ds BETWEEN …`. Four of them are the ones **LA-139 moved onto the anchor series
earlier the same day**, for correctness. Their windows were skewed for any span touching a drain —
so LA-139's conversion was right about which resolver to call and sat on a resolver with a
known-class defect underneath it.

## The test that could not fail

`clock.test.ts` already asserted the round-trip property — `resolveMsToDs(resolveDsToMs(ds)) ≈ ds` —
and it **passed against the broken implementation**. Its fixture spans 10,000 ds over exactly
1,000,000 ms: a slope of exactly 100 ms/ds, the one case where interpolation and the fixed-slope
model give the same answer. The property was the right one; the fixture made it unfalsifiable.

The drain case now sits beside it, and restoring the old interpolating body fails it.

One case I wrote and then removed is worth recording, because the expectation was mine and it was
wrong: I asserted the mapping is *unmoved by a burst of anchors*. It is not, and should not be —
`robustOffsetMs` estimates over every anchor in the epoch, so a new observation legitimately refines
it. My fixture also added anchors implying a lag 6,800 s from the others, which is not a burst but a
different clock. The case now asserts what is actually true: anchors that **agree** about the clock
do not move the mapping, however many arrive.

## Verification

- Mutation pass: flipping the offset's sign kills 2 cases; **restoring the entire old interpolating
  body kills the drain case**, which is the mutation that matters, since the pre-existing test did
  not catch it. An equivalent control (`memoFor(anchors).epoch` → `currentEpoch(anchors)`, the same
  value memoised) survives.
- `tsc` clean, `typecheck:tests` at baseline, **1054 test files / 9818 tests passed**.

**Not exercised:** no device, native or safe-area surface is touched. The stored values this affects
are query windows rather than persisted rows, so nothing is rewritten; reads that previously selected
a skewed ds range now select the right one. **This has not been observed against production data** —
the drain shape is reproduced from Q-139's recorded measurement, not re-measured live.

## What this unblocks

RV-182 ②. With both directions needing only the per-epoch offset, neither needs the anchor *series*
in memory — which is the obstacle to replacing the 12,582-row read (2,190 calls, 106 s, 9.4% of all
database time) with a SQL order statistic. That work is still open and now has nothing in its way.

<a id="2026-09-25-lane-a-la138-correct-the-phase-claim"></a>

# LA-138 — correcting a measurement I filed wrong yesterday

**Branch:** `lane-a/la138-correct-the-phase-claim` · Lane A · **docs only.** No code, no behaviour
change. This exists because I put a false measurement into the queue and it would have sent the
next session to fix something that is not broken.

## What I filed, and why it was wrong

Building TN-64(b) I filed LA-138 claiming **"`program_phases` holds 0 rows for all five
programs"**, and concluded the in-deload suppression had never suppressed anything.

The zero came from a query joining `program_phases` on **`program_id`**. Phases are keyed by
**`phase_set_id`**; `program_id` is a legacy column left behind by that refactor and is **NULL on
all 46 rows**. The join matched nothing and returned a clean, confident zero — no error, no
warning.

That is precisely the failure the External API field-name rule in `CLAUDE.md` is written for: a
wrong key reads as absent and fails silently. I hit it in a diagnostic query rather than in product
code, where nothing typechecks it and no test covers it. Worth noting because the rule is filed
under *external* APIs, and this was our own schema.

## What is actually true

`program_phases` holds **46 rows across 8 phase sets**, **8 of them deload phases**.

| program | mode | phase set | phases |
|---|---|---|---:|
| Bankai (**active**) | `ai_dynamic` | none | 0 |
| Shikai | `ai_dynamic` | none | 0 |
| AI-Phase1 | `ai_dynamic` | none | 0 |
| Main | `automatic` | yes | 6 |
| Strength + Hypertrophy | `automatic` | yes | 6 |

`listProgramPhases` resolves through `programs.phase_set_id` and returns `[]` when there is none.
So the suppression works exactly as written for the two `automatic` programs, and is absent on any
`ai_dynamic` one — **by design, because that mode periodizes dynamically instead of from a fixed
set.**

The narrower finding survives: since TN-64(b) extended the early-deload gate to `ai_dynamic`, the
active program is gated with no in-deload suppression. But the fix is **not** to populate
`program_phases`, which is what my original entry pointed at. The open question is whether the gate
should consult `ai_dynamic`'s own deload notion — `ai-dynamic.ts` carries an elevated-temperature
trigger. Worst case today is a redundant prompt, since every early deload waits on the owner.

## Why the correction is in the entry rather than a quiet edit

The entry now quotes the wrong version before giving the right one. A silently-corrected entry
reads as though it was always right, and the next reader has no way to know the obvious query shape
returns a false zero. The trap is cheaper to document than to re-discover.

## Verification

Custom Rules **78 of 78** · `check-backlog-pointers` OK. No code changed. Every figure is a
`claude_ro` read, **row-scoped to the owner**.

## Not done

**No code.** The gate keeps its current behaviour; whether `ai_dynamic`'s deload state should feed
it is left open on the entry.

**`program_phases.program_id` is dead** — 0 of 46 populated. Dropping it is a migration and belongs
to whoever next touches that table.

<a id="2026-09-25-lane-a-la139-robust-anchor-resolution"></a>

# LA-139 — four reads trusted one clock anchor where six trusted the series

**Branch:** `lane-a/la139-anchor-consumers` · Lane A · `lib/data/postgres/adapter.ts` only.
**No user-visible change** — the timestamps move by minutes on a noisy series, not in a way any
screen names, so no version bump.

## What was wrong

A clock anchor is one `(ring_ds ↔ utc)` observation. Measured on production 2026-09-25, the table
holds **12,545** of them and **39 of the 40 most recent consecutive pairs disagree by more than 60 s**
about the ring's clock rate — worst **3,359 s**. Three anchors written within **4 real seconds**
carried ring times **~19 minutes apart**. They look stamped per drained batch, so a backfill writes
a pair describing history rather than now.

One pair is therefore a sample of a noisy series. `getOuraClockAnchor` returns exactly one — the
newest by `created_at`.

**The repo already knew this.** `getOuraClockAnchors`' comment states the contract: reads that
convert a ds "resolve it against the observation nearest *that frame*, not the newest", and
`resolveDsToMs` takes a **robust offset** across the epoch rather than trusting any single pair.
Six readers in the adapter use it. Four did not:

| call site | surface |
|---|---|
| `getOuraDaytimeSignals` | **production** — training stress + the temperature series |
| `getOuraBatteryEvents` | battery display |
| `getWorkoutSensorProbe` | diagnostic |
| `getDaytimeTagCoverage` | diagnostic (`/api/oura-ble/daytime-coverage`) |

All four now resolve through the shared helpers, which were **already imported** in this file — so
this is a drop-in, not new arithmetic. The ingest path is deliberately untouched: it uses
`getNewestOuraClockAnchorByUtc`, and its own comment says taking the newest is the intent there.

## A correction to what I said when I filed this

Filing LA-139 during TN-79, I wrote that the anchor inconsistency "is NOT TN-79's cause" and left it
there. The first half holds — the replay in TN-79 used the single newest anchor and still bucketed
1,000+ clean MET samples per day, so it does not *empty* the window. The implication that it was
therefore inert was wrong. A displaced window changes **which Brisbane day** a frame is attributed
to, and training stress is a per-day score. The two findings are adjacent, not unrelated.

## Verification

`tsc` clean · `typecheck:tests` clean (318 / 89, none above baseline) · lint clean · Custom Rules
**78 of 78** · full suite **1,047 files / 9,759 tests, 0 failures**.

The test builds the failure shape directly: five honest anchors agreeing that a ds maps to an
instant, then a sixth written **last** that is an hour out — the backfill shape. The frame must
still land within two minutes of truth; reading the newest alone puts it an hour away.

Mutation pass — **2 mutants, 1 killed, 1 SURVIVED**, plus 1 equivalent control that survived
correctly:

| mutant | outcome |
|---|---|
| revert to the single newest anchor | killed |
| drop the no-anchor early return | **survived — see below** |
| *control:* hoist the timestamps into locals | survived, correctly |

**The survivor is real and I am not dressing it up as equivalent.** Removing the early return does
not change the *output*: with no resolvable epoch the per-frame guard returns null for every row, so
the result is still empty. It changes the **cost** — the read would span the whole frame table
instead of returning immediately, which is DV-13's shape (a heavy admin read that hung production
for eight minutes). A test that sees cost means spying on `readRawFrames`, which is a bigger
apparatus than the guard deserves. Recorded rather than chased.

## Not verified

**No device check, and none is owed** — a server-side read path with no native or offline surface.

**Whether any stored value was actually wrong.** This fixes the reader; it does not restate history,
and nothing here measures how far past days were displaced. That is a separate question and nobody
has asked it yet.

<a id="2026-09-25-lane-a-rv173-coach-prose-guards"></a>

# RV-173 — the Coach wrote about the owner's numbers with no guards, and the test could not notice

**Branch:** `lane-a/rv173-coach-prose-guards` · Lane A · v1.465.48.

## The gap

`app/api/coach/route.ts` streams free prose through `loggedStreamText` and its SYSTEM prompt carried
none of `PROSE_GUARDS` — quote the given numbers, metric units only, no superlatives. Those guards
exist because of Q-292: across 117 audited insights, **12 absolute superlatives and 7 Fahrenheit
errors**, including a stored score of 80 described as *"perfect"* and bedroom advice in Fahrenheit
to a metric user. The Coach is the one surface that streams text about the owner's own data, and it
had none of them.

Its docstring still read *"no user-facing entry point yet — Phase 1 ships the protocol only."*
`app/coach/coach-content.tsx:51` has been driving it as the chat transport the whole time. That
stale sentence is part of why nobody added it to the list.

## The half that matters: the test discovers instead of listing

`prose-guards.test.ts` enforced the guards against a **hand-written list of ten routes**. A list
cannot notice a route nobody adds to it, which is precisely what happened.

It now discovers them: every `app/api/**/route.ts` that calls `loggedStreamText`, `streamText` or
`generateText` must reach the guards — in itself, or in a local module it imports (`health-insight`
builds its prompt in `./prompt.ts`). `generateObject` is deliberately not a prose generator: it
returns structured data, and the routes with a user-facing text field inside that object are already
covered by the explicit `PROSE_FIELD_ROUTES` list, which also checks the guards' *content*. The
discovery block is additive, not a replacement.

**Seven routes call a prose generator. Coach was the only one unguarded.**

## Two things the mutation pass earned

**A hole in my own check.** Removing comment-stripping initially **survived**, because
`reachesGuards` matched the bare identifier `PROSE_GUARDS` — so a route that *imports* the guards
and never interpolates them would have passed, which is a route with no guards and a tidy import
list. It now requires `${PROSE_GUARDS}`, matching what the explicit test always did, and that mutant
is killed.

**A silent-pass guard.** The block asserts the scan finds at least seven routes. A discovery test
whose pattern matches nothing passes with no failures and no output — the same shape as LA-138's bad
join earlier today, which returned a confident zero because it keyed on a dead column.

## A claim I made and withdrew mid-task

While surveying I reported that discovery had found a **second** unguarded route,
`nutrition/meal-plans/generate`. It had not. That route uses `generateObject`, and my grep matched a
**comment** mentioning `generateText`. Third time this session a comment has polluted a source scan,
and the reason the shipped test strips them.

## Verification

`tsc` clean · `typecheck:tests` clean (318 / 89, none above baseline) · lint clean · Custom Rules
**78 of 78** · full suite **9,771 passed**, with one unrelated file
(`planned-pct-bodyweight-migration.test.ts`, a migration test) failing only under parallel load and
passing **4/4 in isolation** — the documented local-DB contention artifact.

Mutation pass — **4 mutants, 4 killed** (one only after the fix above), 1 equivalent control:

| mutant | outcome |
|---|---|
| revert the Coach fix | killed |
| discovery stops stripping comments | survived → **exposed the identifier-vs-interpolation hole** → killed |
| the generator pattern matches nothing | killed, 8 tests |
| *control:* the two guard names reordered | survived, correctly |

## Not verified

**The guards are prompt text, so what is tested is that they reach the model — not that the model
obeys.** Q-292 was measured by auditing 117 real outputs; nothing here re-runs that. Whether Coach's
prose actually stops using superlatives is an observation over future conversations.

**No device check, and none is owed** — a server-side prompt change.

<a id="2026-09-25-lane-a-tn64-deload-gate-ai-dynamic"></a>

# TN-64 (b) and (c) — the deload gate reaches the mode the app actually uses

**Branch:** `lane-a/tn64-deload-gate-ai-dynamic` · Lane A · v1.465.43. Follows TN-64(a) (#1594),
which put the ACWR on the record so this change could be judged at all.

## The one-line change, and why it was worth three parts

```
- if (program?.phaseMode === 'automatic') {
+ if (program?.phaseMode === 'automatic' || program?.phaseMode === 'ai_dynamic') {
```

`earlyDeloadRecommended` is the only place a readiness score automatically changes what the app
prescribes. It had never fired in 118 sessions, and the reason was not the thresholds. Measured on
production: of five programs, **three are `ai_dynamic` and two are `automatic` — and the two
`automatic` ones are the oldest (May 23, Jun 5) and both inactive**, while the active program
(*Bankai*) is `ai_dynamic`. `automatic` is the legacy mode. The gate had been unreachable for every
session logged since the owner moved across.

The owner answered this on 2026-09-24, taking the recommendation as written over *delete the gate*
and over *lower the thresholds*.

## What was deliberately not done

**`manual` stays out.** Under it the owner drives the phases himself, so the app proposing one is a
different product question and nobody has answered it. A later tidy-up to `!== 'manual'` would
answer it by accident, so a test pins the exclusion.

**The thresholds are untouched** (`EARLY_DELOAD_SCORE_MAX` 45, `EARLY_DELOAD_ACWR_MIN` 1.2). Moving
them in the same change would make a new prompt ambiguous between *the gate opened* and *the bar
dropped*. A threshold change is Tuning's proposal.

**(c) required no code.** The read path only ever set a flag; `confirmEarlyDeload` is reached from
one place, an authenticated `POST /api/confirm-early-deload` that refuses any program but the
active one. That is now pinned by a test asserting `readiness-payload.ts` never mentions
`confirmEarlyDeload` — because the reversibility of (b) rests entirely on it. Widening the gate
widens **who is asked**, not what happens.

## A finding filed rather than fixed — LA-138

Building this surfaced something the entry does not mention: **`program_phases` holds 0 rows for
all five programs**, and the active program's `started_at` is NULL, which short-circuits the phase
lookup before it runs. So `inDeloadPhase` has always been `false`, and the guard meant to stop the
app recommending a deload *while already in one* has never suppressed anything.

That was harmless while the gate was unreachable. Now it is the difference between being asked once
and being asked during a deload week — still only a redundant question, since every prompt needs
confirmation. It is filed as **LA-138** rather than fixed here, because the prior question is
whether `ai_dynamic` is meant to write phase rows at all or tracks its cycle elsewhere; answering
that wrong means populating a table nothing reads.

## Verification

`tsc` clean · Custom Rules **78 of 78** · full suite green · the gate tests **12 passed** with the
sibling threshold file.

Mutation pass — **4 mutants, 4 killed**, 1 equivalent control survived:

| mutant | outcome |
|---|---|
| revert the widening (back to `automatic` only) | killed |
| over-widen to any non-null `phaseMode` (admits `manual`) | killed, 2 tests |
| inline `45`/`1.2` instead of the named constants | killed |
| the read path calls `confirmEarlyDeload` itself | killed |
| *control:* the two disjuncts swapped | survived, correctly |

**One process note.** The first attempt at the revert mutant used `sed` with `|` as the delimiter
against a pattern containing `||`; it errored and never applied, and the run then reported
**exit 0, all passed** — which reads exactly like a surviving mutant. Only the `sed` error line
distinguished them. A mutation that fails to apply is indistinguishable from one the tests miss,
so the assertion is worth making explicitly: re-run it, and check the file actually changed.

## Not verified

**Whether the prompts are any good.** This entry's own success test is *"a prompt appearing on a
genuinely low day"*, which needs the owner watching it — recorded as the entry's `Keep:`. And the
ACWR column only fills forward from 2026-09-25, so there is no history to judge against yet.

**No device check, and none is owed** — server-side logic on a read path. The card itself is
existing UI that has simply never had the chance to render.

<a id="2026-09-25-lane-a-tn64-persist-acwr"></a>

# TN-64 part (a) — record the ACWR, so the gate change can be judged

**Branch:** `lane-a/tn64-persist-acwr` · Lane A · migration **282** + `claude_ro` twin **283**.
Ships alone, as a migration must. **No user-visible change** — nothing renders this number yet, so
no version bump and no changelog entry.

## Why this is its own PR, before the behaviour change

TN-64 found that readiness gates nothing: `earlyDeloadRecommended` is the only place a readiness
score automatically changes what the app prescribes, and it has never fired. The owner answered on
2026-09-24 — extend the recommender to `ai_dynamic`, persist ACWR, keep the confirmation step — and
the entry is explicit that the order matters, (a) before (b).

It is right about the order. The gate fires on `score < 45 AND acwr > 1.2`. The score half is
stored on every day; the ACWR half was computed on each readiness read and thrown away. So from the
stored data, *"the threshold never opened"* and *"the gate was never reached"* are the same
observation. Widening the condition without recording the number first would produce a change
nobody could evaluate — and the entry's own success criterion (*"a prompt appearing on a genuinely
low day"*) needs the input on the record to tell a good prompt from a lucky one.

## Re-verifying the entry, which sharpened its central claim

Every claim checked against current `main` and production before any code:

| entry says | measured 2026-09-25 |
|---|---|
| guard at `readiness-payload.ts:665` | **:667** — one block off, the constants are at :50–51 |
| nothing stores ACWR | confirmed — `acwr` appears nowhere in `schema.ts` |
| 117 sessions, none an early deload | **118** now, still **0** |
| 5 programs, `early_deload_week_start` NULL on all | confirmed, **0 of 5** |

And one thing the entry understates. Of the five programs, **three are `ai_dynamic` and two are
`automatic`** — and the two `automatic` ones are the **oldest** (May 23, Jun 5), both inactive,
while the active program (*Bankai*, Sept 6) is `ai_dynamic`. So the finding is not "the gate rarely
fires". `automatic` is the **legacy** mode; the gate has been structurally dead since the owner
moved across, and every session logged since has been outside it.

## Decisions taken here

**The column goes on `oura_daily_derived`, beside its siblings.** The table's name is Oura-shaped
but `training_load_ots`, `training_load_high` and `training_load_gate` already live there, so daily
training load is an established tenant. A new table would split one day's row across two places.
That is evidence from the schema rather than a preference.

**It rides the readiness persist rather than getting its own pillar.** `mergeDerivedPersists`
collapses same-day entries into one statement, and this is a readiness-read-path value — a second
push would be a second pillar name for one number nobody computes separately. Both halves of the
gate now land on one row, for one day, from the same computed values the gate itself read.

**No DEFAULT, and NULL is the honest value.** Zero is a *real* ACWR — the bottom of the range, a
genuine training state — so a default would enter later correlations as data. It fills forward
only; days before 282 stay NULL because nothing recorded them.

**Half-wired on purpose — and my first version of this was wrong.** I decided ACWR should be
purely server-side, on the reasoning that nothing on the device reads it. The full suite refused
that: `oura-daily-derived-sync.test.ts` has a drift tripwire asserting every `DERIVED_COLS` column
appears in the push payload, because **the device mirror is also the backup**, and its sibling test
records the real incident — `daytime_stress_coverage_min` and `chronic_stress_granular_nights` were
in `DERIVED_COLS`, the local mirror, the outbox and the fixture, and absent from `pushMutations`, so
a device's backup dropped them silently for as long as they existed.

So ACWR is in `DERIVED_COLS` and in the `pushMutations` branch: a device that sends it is honoured.
What is still omitted, now deliberately rather than by oversight, is the **device's local SQLite
table** — nothing there computes or reads it, so a device never sends it, the COALESCE upsert leaves
the server's value alone, and `applyDelta` ignores it on the way down. The cost is that a device
backup does not carry ACWR. That is acceptable for a **derived, recomputable** number in a way it
would not be for a raw measurement, and the reason is now a comment at the column map so the next
reader does not read it as a missed wire.

## Verification

`tsc` clean · `typecheck:tests` clean (318 errors / 89 files, none above baseline) · lint clean ·
Custom Rules **78 of 78** (after advancing the backlog's next-free-migration pointer to 284).

**The two TCP-only tests were run, and they are the ones that catch a missed twin:** 2 files,
**27 tests, all passed, none skipped** — the count CLAUDE.md documents. The generated twin's diff
against 281 is exactly one line, `t.acwr` on the `oura_daily_derived` view, and the owner's id does
not appear in it (checked by grep, per Q-456).

Mutation pass on the mapper chain — **3 mutants, 3 killed**, 1 equivalent control survived:

| mutant | outcome |
|---|---|
| `acwr` dropped from the column map (write silently no-ops) | killed, 3 of 4 tests |
| `acwr` dropped from the row mapper (read returns undefined) | killed, 4 of 4 |
| schema column pointed at a non-existent DB column | killed, 4 of 4 |
| *control:* the same map entry moved onto the previous line | survived, correctly |

That is the point of the round-trip test: a new column has to be in three separate places, and
missing any one of them still compiles and still writes. CLAUDE.md names this failure by hand — it
presents as *"the save doesn't persist"*.

## Not done

**Parts (b) and (c)** — widening the `phaseMode === 'automatic'` condition to reach `ai_dynamic`,
keeping `POST /api/confirm-early-deload` in the path. (b) is the behaviour change and is the next
entry off this queue.

**Nothing is back-filled**, so (b) should not be judged until the column has days in it.

**No device check, and none is owed** — this is a server-side write on a read path with no native,
safe-area or offline surface. The web sandbox exercises the same code the device does.

<a id="2026-09-25-lane-a-tn70-contributor-read"></a>

# TN-70 — the contributor read, and the dead column it ran into

**Branch:** `lane-a/tn70-baseline-read` · Lane A · **docs only**, no code. TN-70 stays queued; this
is its cheap next step done, not the entry closed.

## Why a read instead of the replay the entry asked for

TN-70 prescribes re-running the rollup over the level-5 span. That is not doable from a container —
**191,191** raw frames plus 1,508 packed against a `db-query` capped near 1,000 rows per call, and a
~40-member `io` no test in the repo constructs. The entry now says so, and says what would unblock
it (a production-side replay, or a database restore).

The cheaper route was already implied by this entry's own earlier finding: the regime switch is
carried by `resilience_daily_sleep_recovery`, and **its contributor inputs are stored**. So "were
the July scores wrong" is a read.

## One hypothesis killed

**The baseline was not still learning in July.** `BASELINE_MIN_NIGHTS` is 14 and **0 of 68 days** in
the span were under it — the level-5 run carried 18–54 nights of history, September 63–81. That is
the obvious explanation for a young-baseline artefact and it is now closed. Recorded on the entry so
nobody spends an afternoon on it.

## One asymmetry measured

| regime | n | RHR raw | RHR score | sleep score |
|---|---:|---:|---:|---:|
| Jul 24 – Aug 29 (level 5) | 37 | 52.7 bpm | 63.9 | 79.1 |
| Sep 7 – Sep 25 (levels 1–4) | 27 | 54.8 bpm | 40.3 | 53.7 |

**Resting heart rate moved about 4% while its score moved 37%.** A small real change is being
amplified several-fold. That is consistent with a baseline re-centering as history triples, and it
is **not established as the cause** — "the owner genuinely got worse" and "the scale moved under
him" are both still live. What the read does is point at the raw series as where to separate them.

I am stating that carefully on purpose. Three times this session I formed a confident conclusion
from a suggestive measurement and had to retract it. A 4%-versus-37% gap is a reason to look at the
scoring curve, not a finding about it.

## The column that should have answered the other half

The same comparison for HRV was impossible: **`night_hrv_baseline_ms` is NULL on all 130 rows**.
Filed as **LA-140**. The plumbing is complete — schema, `DERIVED_COLS`, row mapper, push branch,
local SQLite, sync delta — and nothing writes it; `run.ts:1170` is the *input* to
`computeResilienceForDay`, not a persist.

It changes no behaviour, because the compute uses the in-memory value. The cost is diagnostic, and
it caught me: `computeResilienceForDay` gates `contributorsOk` on that field being non-null and
falls back to a fabricated `50` for the stress scaling, so seeing NULL in the table invites exactly
the wrong inference. I drew it myself before checking the producer. A column that is always null,
sitting beside a guard that tests for null, is a trap for the next reader.

## Verification

Custom Rules **78 of 78**. No code changed, so no tests were added — every figure above is a
production read through `claude_ro`, which is **row-scoped to the owner**, so all of it is the
owner's days only.

## Not done

**TN-70 is not closed.** Whether the 16 level-5 days were ever correct is still open, and the next
move is the raw series behind the contributor scores rather than another aggregate.

**LA-140 is filed, not fixed** — persist-or-delete is a real choice and the entry states both sides.

<a id="2026-09-25-lane-a-tn77-prev-day-window"></a>

# TN-77(a) — "yesterday's activity" was reading today's training window

**Branch:** `lane-a/tn77-prev-day-window` · Lane A · v1.465.46. **Part (a) only** — (b) stays open
on the entry, deliberately.

## The defect

Readiness's `prevDayActivity` contributor scores *yesterday* by calling `computeActivityScore` a
second time. Both call sites — `readiness-payload.ts:471` and `build-day-audit.ts:182` — passed it
**today's** rolling 7-day `sessions7d` and `volume7dKg`.

The material case is a training day: today's window contains this morning's session and yesterday's
cannot, so the number describing *yesterday* reacted to a workout that had not happened when
yesterday ended. Over 115 days it differs from yesterday's own window on **83 (72%)**, mean
|difference| **4.45 points**, worst −15/+10. At the contributor's **0.09** weight that is ~1.4
readiness points at worst, and the mean signed difference is **−0.15** — noise, not bias.

## What shipped

One shared helper, `strengthWindowEndingAt(sessions, dayMidMs)`, used by both prev-day call sites.
The entry notes both sites agree, which is why this is the model rather than a divergence — and why
the fix is one function rather than two parallel edits.

Verified against `main` before writing anything: both call sites are as described, and
`recentSessions` already fetches 28 days, so the corrected window is an in-memory filter and costs
no extra query.

## Two things deliberately not done

**The same-day window is untouched.** The tidy move was one helper for both days, but today's window
currently has no upper bound; giving it one would shift the same-day activity score. That is a
change nobody asked for, on a number the owner reads daily, smuggled inside an off-by-one fix. The
helper is shared where the duplication actually lives — the two prev-day sites.

**Part (b) is left open.** The prev-day call still passes no `zoneMinutes`, `moveHours`,
`strengthSessionToday` or `acwr`, so it sits on a 63-point weight base and is ~71% strength-weighted
against the same-day score's 60%/53%. The entry says this "may be deliberate". Deciding what the
contributor is *meant* to measure is a different question from fixing which day it reads, and
resolving it while here would be answering it by accident.

## Verification

`tsc` clean · `typecheck:tests` clean (318 / 89, none above baseline) · lint clean · Custom Rules
**78 of 78**.

Mutation pass — **4 mutants, 4 killed**, 1 equivalent control survived:

| mutant | outcome |
|---|---|
| drop the upper bound (the original defect) | killed |
| window reaches 8 days instead of 7 | killed |
| upper bound excludes the day's own sessions | killed, 2 tests |
| volume sum zeroed | killed, 3 tests |
| *control:* `t >= from` → `!(t < from)` | survived, correctly |

The second test is the one that earns its place: it asserts this morning's session **does** count
toward *today's* window. Without it the helper could pass by excluding real work rather than by
fixing an off-by-one.

## Not verified

**No device check, and none is owed** — server-side scoring on a read path.

**The 115-day reconstruction is the entry's, not re-derived here.** It carries the sd-8.8 per-day
error TN-76 describes, so the distribution is the claim and the per-day figures are indicative.
Nothing here measures the corrected score against the old one on real days; what is pinned is that
the window now ends where its name says.

<a id="2026-09-25-lane-a-tn79-name-the-gate-that-fired"></a>

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

<a id="2026-09-25-lane-b-back-gesture-sitting"></a>

# 2026-09-25 — the back-gesture sitting: a surface's own history entry was eating the navigation that closed it

Lane B, v1.465.61, the `back-gesture-sitting` batch (BF-165 + DV-2) as one PR.
`lib/hooks/sheet-back-stack.ts`, three call sites, one new e2e spec, one new fixture.

## One bug wearing two faces

The owner reported *"when I try click the treadmill; or any 'Other activity' nothing actually
happens"*, and — asked to narrow it — *"it just scrolls to the top of cardio hub"*. Separately,
Device Verification found *Leave* on *"Leave workout?"* closing the prompt and leaving you on the
workout you had just abandoned.

Both are the same thing. A sheet or dialog pushes a history entry when it opens and pops it when it
closes, which is correct in isolation. When the close is **caused by** a navigation, that pop lands
on the entry the navigation just created:

```
1741ms startViewTransition @/cardio     ← the Treadmill tap
1754ms pushState(/activity)
1761ms back()                           ← 7 ms later, on the S25
1779ms popstate @/cardio                ← back where it started
```

`/cardio` then re-renders at the top of its scroller, because that scroller is a nested
`overflow-y-auto` div no scroll-restoration covers. Sheet closed, same screen, scrolled to top —
the owner's sentence, exactly.

## Three cheaper fixes, each measured as failing

This is the part the entry earned over several sessions, and it is why the fix looks heavier than the
bug:

- **Wait for the pop to drain.** The module already counts self-pops (`pendingSelfPops`, BF-34). An
  `afterSelfPops(navigate)` was built and does not work: the counter is still **0** when the
  navigation is issued, so the parked callback runs inline and is eaten by a pop that has not
  happened yet.
- **Reorder the call site's three statements.** `router.push` runs inside
  `document.startViewTransition`, which suspends frame production and holds the React commit — so the
  navigation is itself what delays the surface's close past it. No ordering separates them.
- **Lengthen the navigation cap.** The push is fine and is undone afterwards. This turns a dead tap
  into a slow dead tap.

## The fix: release the entry before the navigation starts

`releaseTopSurfaceEntry()` clears the top surface's `pushed` flag synchronously, at the call site,
before anything else happens. The close then pops nothing, so there is no window left to mistime.
Tied to the surface **object** rather than a module flag — BF-34's finding that *"a state that is not
mine is indistinguishable from a real back gesture"* is the reason a bare "navigating" flag was the
known-bad shape here.

**It is two halves and the second is not optional.** Suppressing the pop alone leaves the sheet's
entry stranded underneath `/activity` at `/cardio`'s own URL, so backing out takes two presses with
the first one visibly doing nothing. So `selectType` uses **`router.replace`** when the entry was the
sheet's, overwriting it, and `push` when it was not. The `false` branch is real rather than
defensive: `openSurface` deliberately skips its push while one of our own pops is in flight.

DV-2's three `onLeave` handlers share a `leaveScreen()`: release, then **one** `history.go(-n)`. One
call rather than n `back()`s, for the same timing reason.

## The hole in my own fix, found before merge

`go(-2)` — release the dialog's entry, cross it and the screen's — is wrong on a path that is
reachable rather than theoretical. The Capacitor back handler checks the three session guards
**before** `hasOpenSurface()`, deliberately, so that a mid-workout back press *answers* this prompt
instead of closing whatever is open. With a sheet already up — the 1RM calculator, an exercise-stats
sheet — the dialog therefore opens **on top of it**, history is `[…, /workout, sheet, dialog]`, and
`go(-2)` lands on `/workout`: the screen *Leave* exists to leave.

The mistake underneath it is worth stating plainly, because it is easy to make again: **releasing an
entry does not remove it.** Clearing `pushed` only stops the surface popping it; the entry is still in
history and still has to be travelled. So the distance is `1 + releaseAllSurfaceEntries()`, and it is
**counted** rather than taken from the stack depth — a surface that skipped its push contributes 0,
and going one too far leaves a screen the user never asked to leave.

Found by re-reading the diff against the back handler, not by a test — which is the argument for that
re-read, since no test in this repo can reach the path.

## The spec reproduces it, and the control run is the evidence

`e2e/bf165-dv2-navigation-survives-surface-close.spec.ts`, with the two conditions BF-165 spent three
rounds of wrong answers establishing: **warm both destinations with a direct `goto`** (a `next dev`
cold route hangs its RSC fetch indistinguishably from a dead tap), and **make the tap land**.

Against the unfixed source:

| | |
|---|---|
| Other activity → Treadmill | **fails** — *"the navigation was undone after it landed"* |
| one back to the hub | **fails** |
| Guided walk (discriminator, no sheet) | **passes** |

That last row is the whole reason it is in the file: a fix that broke navigation generally would
otherwise pass. All three pass with the fix.

## `tapHitTested`, and the fabricated defect it prevents

`page.touchscreen.tap()` is a raw coordinate dispatch: no scrolling, no actionability check, no
complaint when the point is outside the viewport. On `/cardio` at 412×915 the three modality controls
sit at y=852, 924 and 997 — so *Run* is on screen and the two below are not, and their taps hit
nothing. That read as *"both `/activity*` destinations are dead and `/running` works"*: a perfect
href-shaped differential, and entirely a coordinate artifact. It produced a second "dead button" that
did not exist and had to be retracted. `tapInView` does not save you — it filters on **x** only.

The helper scrolls `block: 'center'` and asserts `document.elementFromPoint` resolves to the control
before dispatching, naming what it would have hit instead.

## Coverage, honestly

The sheet half is reproduced and control-run in the harness. **The dialog half cannot be** — reaching
it needs the Android system back gesture over a Capacitor channel Playwright cannot fire. What covers
the mechanism for both is `lib/hooks/__tests__/sheet-back-stack.test.ts`, nine new cases driving both
releases against an injected history, mutation-tested five ways: leaking a self-pop (2 fail),
releasing the bottom surface instead of the top (1 fail), always returning true (2 fail), counting the
stack depth instead of the pushed entries (1 fail), and taking only the top when the caller needs all
(1 fail).

## Swept, and one thing deliberately left

`components/cardio/time-picker-sheet.tsx` `start()` is the identical close-then-push shape and is
fixed with it. Its `onLogActivity` arm deliberately does **not** release: it opens another sheet
rather than navigating, so the entry stays useful for the surface replacing this one. It remains
**COULD NOT CHECK** on the device — its trigger renders only `!hasRunningPlan` and the owner has one.

BF-165 asked whether a navigation that never lands should leave its selection behind. The fix answers
it rather than deferring it: `startActivity` still runs first and the navigation now lands, so the
`ta_activity_state` it writes is correct rather than orphaned.

## Not verified

**Both device pass tests.** On the S25: Cardio → *Other activity* → *Treadmill* lands and stays, one
back returns to the hub; and start a workout, back, *Leave* → the screen leaves `/workout?session=…`
and one more back does not return to it. The device undoes the navigation **60× faster** than the
harness (7 ms against 415 ms), so the canonical runtime is where a timing claim is actually tested —
and the timing claim here is that there is no window at all.

<a id="2026-09-25-lane-b-bf177-balance-subscribes"></a>

# 2026-09-25 — BF-177: three one-shot refetches lost a race that cannot be won by timing

Lane B, one entry, v1.465.57. `app/nutrition/use-energy-balance-refetch.ts` +
`app/nutrition/nutrition-content.tsx`, one new test file.

## The defect, and why it survived three fixes

The owner: *"The kcal left in the top right; doesnt load on the same page: it requires page
switching to show."* Shipped 2026-09-19, re-reported, fixed again, **FAILED on the S25 on
2026-09-23**, fixed again, **FAILED again on sweep 2**. Each fix added another one-shot refetch at
another write site.

The Device Verification trace is what ends the argument. On the APK the food write is local-first +
outbox, and the refetch fires at the *local* write:

```
+176ms GET energy-balance → remainingKcal=857   ← the card's own refetch, BEFORE the push
+238ms POST /api/sync/push → 200                ← the outbox lands the food
+677ms GET energy-balance → remainingKcal=846   ← correct, and not the card's request
```

So the card's refetch did not merely arrive early — it **re-cached the pre-log figure**, and the
number then sat wrong indefinitely. A fourth refetch, or a delay, would be guessing at a 60–70 ms
gap on one device. On the web the write is an awaited POST, which is why
`e2e/bf177-kcal-left-updates-after-log.spec.ts` was green through all of it.

## The signal was already being sent

`packages/shared/src/nutrition/log-food.ts` fires `invalidateNutritionWrite()` **twice on purpose** —
at the local write and again through `pushThenRevalidate` once the server has it, its own comment
saying *"otherwise the refetch this triggers re-caches the pre-log figures"*. The second one had been
arriving since #1467. Nothing on the Nutrition tab was listening for it.

This is the Q-402 shape for the fourth time in this entry's life: **evicting a key and re-rendering
the component that reads it are two different things.** The fix is `useInvalidationRefetch` in
`use-energy-balance-refetch.ts`.

## Two judgement calls worth the words

**Not where the entry said.** Review sweep 59's re-read pointed the fix at
`use-nutrition-derived-refresh.ts:33` — RV-104's hook, which owns two other keys and a different
load function. The subscription belongs in the hook that already owns this key, its retry ladder and
its date, so every consumer gets it and one place decides when the balance is refetched.

**The hook now takes the date, required.** The obvious version reads `lastDateRef`, which `refetch`
alone sets — so the subscription would be dead until the hook had already fetched once, which
excludes the case subscribing exists for: a write from Home's quick-add or the wrap-up sheet while
the Nutrition tab sits mounted in the persistent shell. Made a **required** second argument rather
than optional, because the failure mode of forgetting it is a subscription that silently never
fires.

## What it costs

Nothing on the log path. `cachedFetch` de-dupes by key, so the subscription's fetch at the first
invalidation and `handleFoodLogged`'s explicit `refetchBalance` attach to one request. The explicit
calls stay: the **web fallback** branch of `logFoodEntries` never reaches `pushThenRevalidate`, so
there the one-shot is the only refetch there is.

## The test pins a chain, not a call site

`app/nutrition/__tests__/bf177-balance-subscribes.test.ts` — five assertions over four links:
log-food's post-push invalidate → `invalidateNutritionWrite` clearing `energy-balance:` → the hook
subscribing to that prefix → refetching the day on screen. Three of them live in files nobody
editing the card would open, and the fix is alive only while all four hold. Control run against
`origin/main`: the three new-behaviour assertions fail, the two pre-existing links pass — which is
the right split, since those two were always true and are here to catch the chain being cut
elsewhere.

React is not exercised: both vitest projects are `environment: 'node'` with no
`@testing-library/react`.

## A stale sentence removed from the hook

Its docblock said *"**Accepted:** the ring updates instantly and 'kcal left' lands a round trip
later"* — and stood through three fixes while the device showed the round trip landing with the
wrong number. Rewritten to say what is now true: the balance lands once the server has the write,
one push rather than one round trip.

## Corrected: one of the two "unswept" readers was already clean

The entry recorded `components/nutrition/end-of-day/day-read-through-section.tsx:37` and
`app/health/day/day-detail-content.tsx:122` as two hand-rolled `cachedFetch` readers of
`energy-balance:`. The first is **not** — it uses `useCachedValue`, which subscribes, and its
docblock explains why it differs from `/health/day`. The second genuinely is hand-rolled, and stays
so deliberately: it guards each response against a date-swipe that has already moved on, and it
refetches after its own writes. Not swept in — it is a route page, not a tab in the persistent
shell, so there is no window in which another surface's write can strand it.

## Not verified

**The S25 look.** `Verify: device` on the entry, pass test unchanged: log a food on the S25, "kcal
left" changes within 3 s without leaving the tab. Native SQLite, the outbox push and Samsung's
WebView were not exercised here — and that mechanism is the entire subject of the fix, so this is
the verification rather than a formality. Exercised: `pnpm dev`, the full suite, and the gate.

<a id="2026-09-25-lane-b-bf61-swipe-delete"></a>

# 2026-09-25 — BF-61: the test was green on the bug, so the fix shipped and the device rejected it twice

Lane B, v1.465.62. `components/ui/swipe-actions.tsx` (one gate), `e2e/food-log-swipe-delete.spec.ts`
(one new case).

## What was actually wrong

The owner: *"if I wait a second it works."* A swipe reveals the tray, and a tap on Delete inside the
next moment is swallowed by the row, which is still over it.

The 2026-08-31 fix raised the tray with `z-10` while `isOpen`. `isOpen` is `offset <= -width` — true
only once the row has travelled the **full** tray width. So the raise arrived at the *end* of the
journey rather than the start of it, and every moment before that was still the original bug. Sweep 2
tapped after a pause: 3 of 3 good. Sweep 3 fired the tap in the same `adb shell` call as the swipe, so
it landed before React had committed the rest-open state at all: **no confirmation, 2 of 2.**

The gate is `offset < 0` now. The tray is raised for the whole of the window in which it is visible,
which is the invariant that matters — **if you can see it, you can hit it.** `aria-hidden` and
`tabIndex` follow the same flag, so a visible Delete is never a clickable `aria-hidden` button.

## The uncomfortable half: the regression test was green on the unfixed component

Control-run with the fix stashed and the spec kept: *"the first tap on Delete opens the confirmation,
even mid-animation"* — **passes**. It stretches the transition to 6 s and taps after the row has
**rested open**, so it only ever exercised the half that was already fixed. That is why an entry with
a named mechanism, a regression test and a shipped fix failed on the phone twice and came back as open
work.

The window sweep 3 hit is narrower than one CDP round-trip, so no arrangement of `tap` calls can race
it here. So the new case asserts the **property** instead: *while the row is displaced at all — finger
still down, mid-drag — the tray is the topmost element over its own rect.* Held at 36 px against a
64 px tray, which is displaced-but-not-open: exactly where the old gate left the tray underneath.
Timing-free, and it covers every window the timing test cannot reach, including the uncommitted one.

| | unfixed | fixed |
|---|---|---|
| the existing mid-animation test | **✓ passes** | ✓ |
| the new displacement invariant | **✘ fails** | ✓ |

## A trap the first version of the new test walked into

It reported *"a tap mid-drag would land on BUTTON.min-h-12 …, not the tray"* — with the fix applied.
The drag had never happened: it started at the row's centre (landing on the row's own control) and
skipped the scroll-into-view and the 16 ms pacing that `swipeRowLeft` does. So the test read a true
statement about a state it had not created. It now starts 16 px from the right edge like its sibling,
and **reads the row's transform before probing**, so a failure says which half broke.

## What is covered by construction, and what is not

`SwipeActions` is shared — `meal-card.tsx` and `saved-meal-card.tsx` render the same component — so
the meal list needs no second fix. It is still unverified there on the device.

The component's existing unit test covers the drag **maths** only; vitest has no DOM project in this
repo, so the render gate is reachable from the e2e harness and nowhere else.

## Not verified — all three acceptance clauses

`Verify: device`. On the S25, swipe and tap Delete **immediately**: ① the confirmation on the **first**
press, on both the meal list and the food rows; ② the slow tap still works; ③ the next rightward swipe
closes the tray and leaves the day alone.

**Clause ③ is not separately fixed and is not claimed.** Sweep 3 saw the day jump to Yesterday only
*after* a swallowed tap — it is downstream of the same defect and may clear with it. If it survives,
it is its own entry with its own mechanism, not a re-open of this one.

<a id="2026-09-25-lane-b-dv12-mechanism"></a>

# 2026-09-25 — DV-12: the suspect was wrong, and the metric that settles it

Lane B, docs-only, on the owner's highest-priority entry. No fix — but the entry now names the right
mechanism and carries a measurement that can tell a fix from a no-op.

## The suspect is falsified

DV-12 said the lead was *"a responsive resize when a panel leaves `content-visibility: hidden`"*.
Instrumenting `ResizeObserver`, **with a control** this time:

- during load — **11 observers constructed, 6 callbacks, 5 of them on chart containers**, so the
  instrument works and chart.js does observe its container;
- on a tab switch — **0 callbacks, chart or otherwise.**

`content-visibility` does not fire a resize here. That also explains the `resizeDelay: 200` A/B I ran
earlier and recorded as inconclusive: it was debouncing an event that never happens.

## A metric that works

Patch the `font` setter on `CanvasRenderingContext2D.prototype` and count calls per tab tap. It is the
exact top self-time item in the device CPU profile, needs no chart.js internals, and is immune to the
dev-mode timing noise that made the earlier A/B unreadable.

| tap | canvas `font` setter calls |
|---|---|
| → Health (5 canvases) | **578**, then **578** again |
| → More, → Home (no charts) | **0** |
| → Health, later in the same run | **0** |

Two identical readings and a clean zero on the chart-free tabs. That is a discriminating instrument,
which is what this entry has lacked since it was filed.

## What is actually happening

`TabVisibilityProvider` increments `epoch` every time the shell re-shows a tab, and the screens thread
it into their effects' dependency arrays **deliberately** — all five tabs stay mounted, so without it a
`useEffect(…, [])` fetch would run once per app launch and the screen would show that snapshot forever.

So a tab switch refetches, the data objects are new, the charts re-render, and `chart.update()`
re-measures every axis label. **The update is legitimate.** The third Health switch costing 0 fits: that
refetch returned nothing the charts had to redraw.

## Which changes what a fix is allowed to be

Not "stop the update" — it is correct. Make a correct update cheaper or later, and that is a trade-off
against Q-402's staleness rule rather than a free win. Three candidates are on the entry, none measured:
compare fetched data by value before handing it to the chart (strongest fit — two of three Health
switches changed nothing); move the update off the tap's critical task; refetch less eagerly on show
(fights Q-402, so last).

## Two corrections this cost, both mine, both today

The "zero canvases" reading retracted in the previous entry, and now the resize suspect — which I had
repeated as confirmed-from-source before testing it. Reading the source told me *what could* fire a
resize; only the instrument told me whether anything did. **A mechanism inferred from source is a
hypothesis, and this entry has now burned two of them.**

## Not exercised

All of it is `next dev` in the harness with the seeded user. The device profile remains the authority on
the APK and agrees on the symptom. The pass test is unchanged: `perf.js longtasks`, every tab tap under
50 ms, on the phone.

<a id="2026-09-25-lane-b-dv12-ungate"></a>

# 2026-09-25 — DV-12 un-gated, and the measurement I got wrong the same day

Lane B, docs-only. `DV-12` — the owner's stated highest priority — leaves `PARKED` and heads the lane.
No code: the investigation says the obvious fix cannot yet be told apart from doing nothing.

## The gate had outlived its question

`Gate: device` was added by LB-145 because *"the remaining question needs the phone"*, and the entry's
very next line said the opposite: *"What is still unknown is answerable from SOURCE, not from the
phone."* Both halves are settled now, so the gate was parking his top priority for a question nobody
still had. What remains needs the phone only to **verify**, which is a prose
`Device check owed on merge:` — not a `Verify:`, which would file unbuilt work as shipped.

## The mechanism, from source

**20 chart components set `responsive: true`. None sets `resizeDelay`.** `tab-shell.tsx:209` puts
`[content-visibility:hidden]` on the outgoing panel and takes it off the incoming one, so both panels'
canvases change size on every tap and each `responsive` chart takes a ResizeObserver callback →
`update → _tickSize → _computeLabelSizes → set font`. That is the chain the device profile named, and
it explains why it fires on *every* tap rather than only on Health.

## I got a measurement wrong and shipped it

Earlier the same day I added to this entry: *"216, 228, 465, 91, 235 ms with `canvasTotal: 0`, so a
large cost exists independently of chart.js."* **Health does render canvases — five — but not until
~18 s in** (0 at 3 s, 0 at 8 s, 5 at 18 s: dynamic imports plus the fetches behind them). My probe
waited 1.5 s per switch, so it timed a *loading* page and I read it as a chart-free one. The seeded
user had data all along: 16 `body_metrics`, 22 `sleep_sessions`, 9 `workout_sessions`.

Corrected in place on the entry rather than deleted, because the wrong figure had already merged. The
lesson is the one I keep writing about other people's entries: **a measurement is only as good as the
precondition you did not check.** Waiting for the thing you are measuring to exist is that precondition.

## The A/B, once the charts were really there

| switch | baseline | `resizeDelay: 200` on all 20 |
|---|---|---|
| → More | 233, 255 ms | 283, 187 ms |
| → Health | 480, 319, 0 ms | 420, 407, 93 ms |
| → Home | 87 ms | 73 ms |

**No effect that survives the noise** — the spread inside each column is larger than any difference
between them. Applied by script to all twenty sites and reverted.

## And the obvious way round the dev-mode confound is closed here

`next dev` is unminified, in React dev mode, and compiles on demand, so its tab switches are dominated
by work the APK never does — which is consistent both with `resizeDelay` being ineffective and with it
being effective but invisible. The clean answer is a production profile, and **`pnpm start` cannot boot
in this sandbox**: the instrumentation hook fails with *"MODEL CONSTANTS UNAVAILABLE — could not list
the bucket: SignatureDoesNotMatch (403)"* and every request 500s.

So the remaining discriminators are to instrument chart.js's resize path and count callbacks per tap —
which answers the mechanism without needing the timing to move, and works in dev — or the phone.

## Why no fix shipped

There is no shared chart module: all twenty components call `ChartJS.register(...)` at their own module
scope and build their own inline options, so `resizeDelay` is a twenty-file sweep whichever way it is
done. **Shipping that on this evidence would repeat BF-61 exactly** — a change that looks right, with no
measurement able to distinguish it from nothing — and BF-61 came back from the device twice for precisely
that reason. The entry is startable; its first task is a measurement, not the fix.

<a id="2026-09-25-lane-b-header-row-arithmetic"></a>

# 2026-09-25 — the header row is out of width, and that is arithmetic rather than a judgement

Lane B, docs-only. `LB-157` filed `Lane: O`; `BF-139` and `BF-96` parked on it.

## What was asked and what the numbers say

The `header-row-width` batch was next in the lane. Both entries had shipped a fix, both had **FAILED
on the S25 in the same sitting**, and both diagnosed the same thing: the header row is a fixed width
budget and nothing in it defends the date. The prescribed direction was *"something must own the
date"*, with Review sweep 59 adding that a shrink-only fix is gate-free and moving the date is not.

So the first question is whether a shrink-only fix exists. Measured in the running app at 412 dp,
with each candidate date format measured in the row's own computed font:

| | px |
|---|---|
| the row | **224.0** |
| `gap-2` | 8.0 |
| chips, night | 156.1 |
| chips, `UV 5` | 200.2 |
| chips, `UV 11` | 208.6 |
| `Wednesday 30 September` | **158.7** |
| `Wed 30 Sep` | 71.7 |
| `Wed 30` | 45.3 |
| `30 Sep` | 41.7 |

The date's remaining space is **59.9 px at night, 15.8 px at `UV 5`, 7.4 px at `UV 11`**. In daylight
**nothing fits — not `30`, not two characters.** *"Make it smaller"* is exhausted, which is why a
third chip-shrinking fix would fail the same way the first two did: the slack each of them spent was
the date's, and there is none left.

That makes every remaining option one that changes what Home *shows*, and CLAUDE.md is unambiguous
about whose call that is. Filed as `LB-157`, `Lane: O`, **ungated** — the gate would park it and the
point is that someone puts it to him.

## The brief, in one line each

**Recommended: the date on its own line above the chips.** The only option that keeps every reading,
about 18 px of vertical space once, and the shape that survives the next chip — BF-139 already notes a
fourth is expected, since anything with a battery is a candidate.

Against: **moving the batteries off Home's header** (the date then gets 98.4 px, enough for
`Wed 30 Sep`, but ring and scale battery are exactly what is worth a glance rather than a visit —
which is why Q-111 put them there); **dropping the date** (free and riskless, but Android's status bar
shows the *time*, not the date, so BF-96's *"partly recoverable from the phone's own UI"* does not
hold for the day of the week); and **a responsive date** (needs no decision, but on the numbers above
it shows `Wed 30` at night and nothing in daylight, so the date appears and disappears by weather —
which reads as a bug rather than a fix).

Reversal cost is low for all three: a handful of lines in `header-meta-row.tsx`, no data, no
migration. Worth deciding quickly rather than carefully. The expensive part has been shipping twice.

## What the sandbox cannot settle, recorded so nobody tries again

The seeded DB has no weather snapshot, so `WeatherChip` renders a **56 px skeleton** and the real
three-chip row cannot be reproduced here — both entries already said so and it is confirmed. The chip
figures are the 2026-09-12 device measurements. What *was* re-measured here is the row width, the gap
and every date format, and those agree with the entry to 0.1 px, which is what makes the chip figures
worth relying on.

## Nothing shipped, deliberately

No code. An unbuildable entry heading a lane is a queue defect, and the honest fix for it is the
measurement plus the question — not a third fix that the arithmetic already refutes.

<a id="2026-09-25-lane-b-lb154-meal-types-cached"></a>

# 2026-09-25 — LB-154: the entry described the wrong defect, and the fix is an offline win

Lane B, v1.465.59. `components/nutrition/food-logger-sheet.tsx` (two call sites),
`scripts/check-bare-api-fetch.js` (one baseline row deleted).

## Two corrections before the fix

The entry says the site *"bypasses the cache entirely"*. It does not — line 245 already reads
`readCacheSync<MealType[]>('nutrition-meal-types')`, and the bare `fetch` is only the **miss path**.
The real defect is narrower and different: that fallback never **wrote** what it fetched, so every
cold scan paid a request and left the key empty for the next one, and it sat outside `cachedFetch`'s
in-flight dedup while the nutrition screen behind the sheet fetches the same key on mount.

The entry also warns that converting it *"means reconciling those two types, not just swapping the
call"* — the local store's `getMealTypes` returning a narrower row than `mealTypeForHour` wants. That
obstacle belongs to a **different** alternative. It applies to reading the local store; it does not
apply to `cachedFetch`, which returns the route's own payload. The conversion is a swap, and the
narrow-row comment stays in the file because it still explains why the local store is not used here.

## The sibling that was the better half of the fix

The same file has a second bare GET twelve lines up — `/api/nutrition/saved-meals` — baselined
together with the first. Converting it is not tidying:

`handleScannedSavedMeal` resolves local store → network. Its own docblock says why that order
matters: *"a label is scanned in a kitchen, which is exactly where the network is not."* But the
fallback was a bare `fetch`, so **offline, with a perfectly good `saved-meals` list in the cache, a
scanned label failed** and showed *"That meal is not in your library"*. `cachedFetch` consults that
cache, so the kitchen case the docblock is built around now actually holds.

One subtlety recorded in the code: `cachedFetch` can fire `onData` twice — the cached list, then the
network's — so the find resolves with `?? null` rather than `?? meal`. The fresher answer has to win
**both** ways round, including when the meal was deleted on another device and the cached list still
carries it.

## No new test, deliberately

The regression guard already exists and is stronger than a bespoke test: `check-bare-api-fetch.js`'s
baseline row for this file was **deleted rather than lowered**, so a re-introduced bare GET here fails
Custom Rules outright instead of fitting under a remaining allowance. `check-cache-ttl-divergence.js`
covers the other half — both keys take the TTL every other reader uses (`TTL_LONG` for
`nutrition-meal-types`, `TTL_MEDIUM` for `saved-meals`), and a divergent one would fail there. The
behavioural change sits inside a component closure, and React is not unit-testable in this repo (both
vitest projects are `environment: 'node'`).

## LB-155's count

67 → **65**; tracked 26 across 19 files → **24 across 18**. Amended on `LB-155`, which owns the
figure. LB-154 is removed from the queue.

## Not exercised

The scan flow itself — it needs a camera and a printed label, so neither site was driven end to end.
What was: the full suite, the scanner, and `/nutrition` compiling and rendering. The offline claim is
reasoned from `cachedFetch`'s cache-first behaviour rather than observed with the radio off, and the
APK is where that would be seen.

<a id="2026-09-25-lane-b-lb155-triage"></a>

# 2026-09-25 — LB-155: "~20 conversions remain" was three, and the triage is the deliverable

Lane B, v1.465.60. `components/activity/done-activity-screen.tsx`,
`components/nutrition/meal-plan-setup-sheet.tsx`, `scripts/check-bare-api-fetch.js` and its test,
plus `LB-156` filed for Lane A.

## Why the entry had been sitting at the top of the lane

`LB-155` shipped the *enforcement* of the bare-`fetch` rule and left "~20 conversions remain". Read
site by site rather than counted, the 24 tracked sites split four ways — and only three of them were
Lane B's to do:

| | sites | |
|---|---|---|
| **converted here** | **3** | the key was already in an invalidation group |
| **authoritative reads** | 3 | a conversion would **break** them; now a third scanner population |
| **blocked on Lane A** | 10 | the key is in no group, and `lib/cache-groups.ts` is Lane A's |
| **deliberately deferred** | 8 | per-query reads whose key would churn for nothing |

So the remaining Lane B work was **zero**, and the entry now carries `Needs: LB-156` rather than a
count.

## The three that converted

**`dietary-restrictions`** in `meal-plan-setup-sheet.tsx`. `invalidateMealPlans()` has cleared that
key since it was written — for a reader that did not exist. Two things came with the conversion, and
neither is optional: `onError`, because `cachedFetch` swallows `!res.ok` and `restrictionsFailed`
gates the one thing this screen must never do quietly (start a plan from a blank restriction set and
forget an allergy); and an `invalidateMealPlans()` after the restrictions PUT, which **did not exist
before** — `handleSave`'s call is in a different function and does not run when the user edits an
allergy and then abandons the plan.

**Both `hr-window` reads** in `done-activity-screen.tsx`, onto **one** key. The effect built its
query with `URLSearchParams`; the treadmill handler hand-built the same query as a template string.
Same window, two strings, so entering a distance re-requested a trace the screen already had. One
helper builds it now, and the key shape (`hr-window:<query>`, `HR_WINDOW_TTL`) is the one
`activity-detail-sheet.tsx` and `exercise-review-sheet.tsx` already use.

## The three that must never convert — the finding worth keeping

These are not debt and are not waiting for anyone. Each one's contract is *see what the server has,
or nothing*, so painting a cached value first is a correctness bug:

- **`meal-plan-edit-sheet.tsx`** re-reads the plan straight after PATCHing its meals, to hand the
  updated object to `onChanged`. A cached paint is the pre-edit plan.
- **`use-food-logs-loader.ts`** already caches this key on its no-store path; *this* call is the
  authoritative server copy that feeds `applyDelta`. A cached value would be applied as authoritative
  and re-insert rows the outbox has already deleted — BF-47, exactly.
- **`workout-screen.tsx`**'s `/api/achievements` is the **XP delta baseline**. `recordXpEarned`
  subtracts the pre-workout XP from this response, so a cached pre-workout value makes the gain read
  **0**. It already writes the answer back with `setCached`, which is the caching half done right.

They now live in an `AUTHORITATIVE_READS` population in the scanner, keyed by file **and** endpoint —
because `workout-screen.tsx` holds one of each kind, and a per-file exemption would have excused its
convertible sibling too. Each row covers exactly one call: a second bare GET of the same route in the
same file falls through to the baseline and fails. A row that stops matching anything is reported as
an orphan, because a reason asserted for a call that no longer exists is worse than no row.

The test asserts every row's reason is longer than a label (the shortest real one is 118 characters).
Mutation-tested: replacing one with `'needed live'` fails it; breaking a row's endpoint reports the
orphan and exits 1; adding a second bare GET of an authoritative route fails the baseline. Exit codes
read directly, not through a pipe.

## LB-156, and the sharp case that makes it real

Ten conversions need five cache keys registered in the groups whose writes change them — Lane A's
file, so filed rather than done. `day-checkin:` is why this is not bookkeeping:
`invalidateNutritionWrite` has cleared that prefix since it was written, **for a key nobody ever
created**, while `invalidateCheckinAffectsPrescription` — which the check-in writes themselves call —
does not clear it at all. Converting those three readers without LB-156 would cache a check-in that a
*food log* evicts and a *check-in save* does not: fresh by accident, stale by the write that actually
changed it.

## Counts

`check-bare-api-fetch`: 65 → **62** total; 3 authoritative; tracked 24 across 18 files → **18 across
14**. Cleared rows are deleted rather than lowered, so a regression fails outright.

## Not exercised

The done-activity screen's HR trace against a real Oura back-fill, and the meal-plan setup flow's
restrictions PUT — both were driven only by the suite and the build. The behavioural claim that the
treadmill path now reads the effect's already-fetched window is reasoned from `cachedFetch`'s
key-level dedup, not observed on the device. No device check filed: both keys are read the same way by
three and one other sites respectively, and the sandbox cannot produce the ring data that would make a
look meaningful.

<a id="2026-09-25-lane-b-mid-entry-heading"></a>

# 2026-09-25 — a shipped entry kept printing as READY, because a `##` inside it ended it

Lane B. `scripts/lib/mid-entry-heading.js` (new), `scripts/check-backlog-pointers.js`, one test file,
four headings demoted in `docs/implementation-backlog.md`.

## The symptom, and why it was not a typo

`BF-165` shipped in the `back-gesture-sitting` batch, with a `Verify: device` bullet added in the same
PR. It kept printing as **READY**. Its batch-mate `DV-2`, given a byte-identical bullet, moved to
VERIFY correctly.

The parser was reading BF-165's field. It was not reading BF-165. The entry carries two sections
written as `## ` headings — a retraction notice and a root-cause write-up — and **a `## ` ends an
entry**, in `next-item.js` and in `check-backlog-pointers.js` alike. Everything below the first one
belonged to no entry: the whole root-cause analysis, the device reproduction, the fix constraints, and
both of the fields that were supposed to take it out of the lane.

So an implementer opening the queue was told to build an entry that had shipped, and the device check
it owed was tracked nowhere.

## The rule cannot be "no `##` inside the queue"

The truncation is deliberate and load-bearing. The queue carries real **section boundaries** between
batches of entries — *"Owner request, 2026-08-25"*, *"Nutrition focus — the owner's priority"* — and a
field written under one of those belongs to no entry rather than to the last entry above it. The
checker's own comment says so.

So a check has to tell a boundary from a mis-levelled sub-heading, and the discriminator is **what
follows, not the wording**: a boundary is followed by prose and then a `### ` entry, while a truncated
entry's own FIELD bullets sit under one. Measured across the whole queue: **seven** mid-entry `## `
headings, **six** genuine boundaries with no field under them, **one** — BF-165's — orphaning two.

One detail is load-bearing and the first version of the scan got it wrong: it must scan to the next
`### `, not to the next heading. BF-165 has *two* `## ` sub-headings and its orphans sit after the
second, so a scan that stopped at the first reported the entry clean.

## What shipped

- `scripts/lib/mid-entry-heading.js` — the classifier, extracted rather than left inline for the
  reason `decorated-field.js` records: the shapes that must **not** trip it are the point, and a check
  that flagged six legitimate boundaries would be deleted rather than obeyed. Five unit cases,
  mutation-tested two ways (stopping at the next heading → 3 fail; matching any bullet rather than a
  field → 1 fail).
- `check-backlog-pointers.js` fails on it, naming the heading and each orphaned field. It is the third
  member of a family that already existed: a field written inline, a field prefixed with a warning
  glyph, and now a field below a mis-levelled heading — all three silently ignored, all three caught.
- Four headings demoted to `#### ` — BF-165's two, plus TN-30's and TN-31's, which carry no fields
  today and would have swallowed the next one added.
- The protocol at the top of the backlog now states the rule where someone writing an entry will
  read it.

## What it changed in the queue

`BF-165` parses its `Verify: device` and `Keep:` and leaves READY. Lane B's READY list goes **2 → 1**.

## Not exercised

Nothing here touches the app. No device check, no version bump — this is queue tooling and the
documents it reads.

<a id="2026-09-25-lane-b-rv99-warmup-done-green"></a>

# 2026-09-25 — RV-99: the second "done" green, and the number the entry was wrong about four times

Lane B, v1.465.58. `components/workout/warmup-screen.tsx` (three literals), one new test, and a
measurement that re-laned RV-99 and shrank `LB-152`'s question by an order of magnitude.

## Why RV-99 was heading Lane B's READY list with nothing in it

The entry says *"Lane: B for `components/**` and `app/**`"*, so `next-item.js` put it first. But its
Lane B half had already been split out as `LB-152` — the owner's call on whether ~113 hard-coded
greens and reds may get brighter — leaving Lane B nothing to build. That costs a pick-up per session
for nothing, so the entry is now `Lane: A`: the four shared modules are all that is buildable, and
they do not wait on the owner.

Establishing *"nothing left"* took two scans, and the second contradicted the first.

## The scan that found nothing, and the scan that found something

RV-99's own test for defect-versus-preference is **is there a second value for this same meaning?**
A same-file scan for a band token and its hex literal in one file returns **zero** — the
workout-clocks slice cleaned up the only one.

A co-render scan (import graph, so a parent and its children count as one screen) returns 19 pairs,
and reading them shows the scan is the wrong shape: the biggest cluster is
`movement-balance-card.tsx` using `var(--accent-green)` for **legs**, an identity colour for a muscle
group, beside ten Health cards using `#22c55e` as a **card tint**. Co-rendering is not shared
meaning.

What both scans structurally cannot see is the one that was real. `warmup-screen.tsx` paints
*"✓ Warm up complete"* in `#22c55e`; the next screen paints *"✓ Ready"* and the warmup ramp's done
segments in `var(--accent-green)` — same state, same ✓-label-plus-filled-bar idiom,
`rgb(34,197,94)` against `rgb(86,238,102)`. The modes are **exclusive**, so nothing puts them on
screen together and no same-screen scan can reach it. Only the sequence exposes it, and the user
walks that sequence in seconds.

Three literals migrated. The glow keeps its own 53% — `#22c55e88` — rather than adopting the brand
branch's 60% beside it: the colour was the disagreement, the opacity was not.

## The test guards the class, not the two files

`components/workout/__tests__/rv99-done-green-agrees.test.ts`: no screen in the workout flow may pick
a green by a *done* condition using a hex literal, plus positive assertions that both surfaces still
colour the state (or the ban passes on a file that simply stopped). It deliberately does **not** ban
the hex outright — `#ef4444` for rest-overtime is one value across `rest-ring.tsx`,
`last-set-rest-timer.tsx` and `workout-clocks.tsx`, so there is nothing to fix and migrating it would
be a restyle nobody asked for. Control run against `origin/main`: two of three fail.

## The number, counted rather than estimated

The entry has carried **173, 183, 116 and 182** at different points. Counted outside comments,
`app/**` + `components/**` holds **116 sites across 55 files** after this fix — and the count was
never the useful question. Splitting by whether a *condition* picks the colour:

- **33 conditional. All 33 read** — not a heuristic's output: **14 true bands**, 6 an
  already-consistent state red, 7 deliberate red→amber→green ramps of the exempt `hr-zones.ts` class,
  3 a trained-today state, 3 outright false positives (a per-metric identity accent sitting beside
  `#f97316` and `#06b6d4`, Steps' identity colour, and a `|| '#22c55e'` fallback default).
- **83 unconditional** — card tints, chart series, icon gradients. **Not read one by one**, and spot
  checks show they are not uniformly identity either: one is a charging/draining state table, another
  a deliberate 5-step rating ramp. So 83 is an upper bound, not a verified figure, and it is recorded
  that way.

**So RV-99's band population is about fourteen, not a hundred and thirteen.** That is `LB-152`'s
question restated: about fourteen readings get brighter — a body-fat delta, a goal's on-track label,
the monotony meter, the weekly muscle-sets bars, the streak card's broken state, the deload banner's
severity — not an app-wide restyle. Recorded on `LB-152` as well as here, because the *size* of the
change is the whole of what the owner is being asked to weigh, and "a hundred and thirteen" is the
kind of number that makes a cheap decision look expensive.

## Checked and deliberately not filed

`training-load-card.tsx`'s `monotonyColor` bands at 1.5/2 with the same three colours
`acwrBandByKey` uses, which looks like two implementations of one formula. It is not: monotony on a
0–2.5 scale against ACWR at `ACWR_THRESHOLDS`. Two metrics, two threshold sets, one palette. Written
into the entry so the next reader does not re-open it.

## No device check owed, on purpose

A token swap on one label and one bar, with both values known exactly
(`oklch(0.84 0.22 145)` against `#22c55e`) — none of the surfaces the device gate names
(offline-first, native, safe-area, gesture, notification). The workout-clocks slice took no device
look either, and adding one here would inflate a queue of 41 owed checks for a result that is already
determined. **If the owner answers `LB-152` with (c) "leave it", this file reverts with
`workout-clocks.tsx`** — the two are one decision now, which is the point of fixing a disagreement
rather than half of it.

## Not exercised

Samsung's WebView rendering of `color-mix(in oklch, …)` in a `box-shadow` — the idiom the brand
branch one line above already uses, so it is not new to this screen, but it has not been *observed*
here. Exercised: full suite, `check:rules`, lint, tsc, build.

<a id="2026-09-25-lb149-e2e-browser-death"></a>

# 2026-09-25 — the E2E browser dies and the run says nothing; four theories eliminated, one witness added

**Branch:** `lane-b/lb149-e2e-browser-death` · **Lane:** Implementation B

LB-149 was filed after two runs ended with the Playwright browser simply gone — two specs each
failing in 1.0s with `browser.newContext: Target page, context or browser has been closed`. A
1-second failure before any test body runs is a process that has died, not an assertion.

This PR does **not** establish the cause. What it does is remove four explanations that were
costing sessions, and give the next failure a witness.

## What is no longer worth testing

**The entry's own leading hypothesis is dead.** It proposed checking "worker count against runner
memory" and whether `--workers=1` removes it. `playwright.config.ts` **already sets `workers: 1`**,
with a comment explaining why (the specs share one seeded Postgres and one signed-in user). There is
no parallelism to reduce; the suggested remedy is the standing state.

**Nothing closes the browser deliberately.** No `browser.close()` anywhere under `e2e/`.

**"Memory accumulates through the run" does not fit.** The victims were `day-detail-sheets` and
`diary-nested-meal` — **#20 and #28 of 124** specs in alphabetical run order. Early, and not
adjacent to each other.

**"A heavy spec killed it" does not fit either** — and this one is the useful inversion. Because the
failure is at `newContext`, the browser was already dead *when the victim started*, so the victims
were never the suspects: the specs that were actually running when it died are the ones **before**
them. Those are `collection-screen` — 36 lines, one test, one `goto` — and
`details-tests-and-scans`. Two of the lightest files in the suite.

## What is left, and why the PR stops there

That leaves the runner. The shape is at least consistent with `pnpm dev`: the crash clusters early
because early is when the dev server compiles hardest, nothing being warm yet — which would explain
why a trivial spec can be the one holding the axe. **Consistent is not established**, and the
honest position is that no run so far recorded a single byte about why the process went away.

So rather than ship a theory, `ci.yml` now answers the question on the next failure:

```yaml
- name: If the browser died, say why
  if: failure() && steps.ui.outputs.changed == 'true'
```

One `dmesg` read. An OOM kill names the process and its RSS; an **empty** dmesg eliminates memory
outright — which is just as valuable and is precisely what nobody has been able to say. It runs only
on failure, so a green run pays nothing.

## Measurement, and a correction

The entry asks for three consecutive runs on an unchanged head — same victims means a spec pair,
moving victims means the runner. **Run 3069 passed** (`pnpm e2e`, 28m53s), so the fault is
intermittent; that is 1 of 3, and attempt 2 was re-run from the same head rather than by pushing
empty commits. Those reruns execute the *old* `ci.yml`, so they answer "do the victims move", not
"why".

Also corrected: `ci.yml` described the full E2E job as costing "~10 min". Measured on that run it is
**~29**, which matters because it is the number anyone waiting on a UI PR is implicitly told.

## A test that expired for the third time, and this PR's own lesson

CI went red on the first push, on `scripts/__tests__/next-item-visible-silence.test.ts` (TN-61) —
a file whose own comment reads *"this case has now broken twice for the same reason: it encoded a
fact about the DATA rather than the behaviour"* and *"a test that names a lane is a test that
expires."*

It was right, and this was the third time. The assertion was `ready > 10` implies a truncation line.
But the cap is on **rows**, and a batch is one row carrying several entries — so the two part
company as soon as enough batches sit near the top. Measured here: lane B printed **all 12** of its
READY entries inside 10 rows, three of them batches, and correctly said nothing; the test demanded
a truncation line for work that was in front of the reader. `next-item.js` was not wrong.

It now compares the entries the output actually PRINTS against READY's own count, which is the
behaviour rather than today's batch shape. Two things were needed to make that hold: the READY block
runs to the next **section header** (column 0), not to the next blank line — `--lane O` and
`--lane DV` print an indented note about owed device checks after a blank, so stopping at the blank
counted zero entries in exactly the two lanes most likely to be truncated. And the fix was
mutation-tested: reintroducing the original silence in `next-item.js` turns both assertions red with
the right messages, and restoring it turns them green.

**The lesson is mine, not the test's.** I skipped the full suite on this PR, reasoning that the diff
contained no TypeScript — a YAML comment and a backlog entry. That is true and it was the wrong
inference: the diff changed **data the tests assert against**. A backlog edit is a code change as far
as the queue-tooling tests are concerned, and the five files I hand-picked as "the ones that read
ci.yml" could not have caught it.

## Not this lane's

The entry's other half — *"because E2E is advisory nobody looks"* — is a question about making E2E
a required check. `CLAUDE.md` records that as deliberate and the owner's, pending `LB-56`. Nothing
here changes it.

**Not exercised:** the diagnostic step itself has not fired, because no E2E run has failed since it
was written. It is gated on `failure()`, so a green CI run on this PR proves the YAML parses and
nothing more.

<a id="2026-09-25-lb155-bare-api-fetch-carveout"></a>

# 2026-09-25 — LB-155: a rule with 67 violations, and the carve-out that makes it enforceable

**Branch:** `lane-b/lb155-bare-api-fetch-carveout` · **Lane:** Implementation B

"Client GETs of `/api/*` use `cachedFetch` with a `readCacheSync` seed, never bare `fetch`" was prose
only, and prose lost. Two entries filed against it this week — RV-79 and LB-154 — each singled out
one call site as though it were exceptional. Neither had counted.

## The defect is the missing carve-out, not any call

There are **67** bare `/api/` GETs in client code, and **about half of them should stay that way**.
So a ban would be wrong and a silent prose rule is worse: it produces a steady trickle of entries
that each fix one site and never notice the population.

`scripts/check-bare-api-fetch.js` splits it three ways and ratchets only the last:

| population | count | treatment |
|---|---|---|
| BLE + admin debug consoles | 33 | exempt wholesale — live is the useful reading while holding the device, the precedent CLAUDE.md already sets for these directories under the timezone rule |
| exempt **endpoints** | 8 | `/api/version`, `colmi/status`, `scale-ble/{pending,today}`, `sync/pull`, `oura-ble/rollup-state`, `exercise-library`, `ai-periodization/session` |
| tracked | 26 across 19 files | shrink-only baseline |

Exemptions are keyed by **endpoint, not `file:line`** — the reason belongs to the route, and line
numbers drift. Several of those eight already pass `cache: 'no-store'` explicitly, which is the tell
that the bare fetch was deliberate. Caching `sync/pull` would be a correctness bug, not a staleness
one.

## The number was wrong twice, and that is the durable lesson

I published **69**. That included a false positive: the scan dropped calls with `method:` but not the
shorthand `{ method, headers }`, which has no colon, so a POST in `supplements-section.tsx` counted
as a GET. The real figure was **68**, and it is **67** now because RV-79's own fix removed one. Each
figure was right when measured — but I had already, earlier the same day, had a sibling scan report
**7** sites where there were **191**, because its regex demanded `(` immediately after the name and
every call site was `cachedFetch<T>(…)`.

Two wrong counts from two scanners in one day, in opposite directions. So the test pins the **scan**,
not the count: the multi-line URL form, and all three ways a method can be declared. A figure from an
unpinned scanner is a guess with a number attached.

RV-79's journal entry carries an inline correction rather than a silent edit, since 69 was published
there and in its merged PR body.

## What is left, and why it is triaged inside the baseline

The ~20 conversions stay open, ordered in the `BASELINE` map itself so nobody re-derives the
judgement. Weakest are the six **per-query** reads (`?q=`, `?code=`, `?threadId=`, `?sessionId=`),
where a key must carry the query and a search-as-you-type key churns the cache for nothing.
Strongest are the **duplicated endpoints**, where one key would serve several sites: `day-checkin` at
three call sites, `phase-sets` ×2 and `workout-templates` ×2, `bedtime-estimate` ×2.

And the script's failure message carries RV-79's finding, because it is the thing most likely to be
forgotten: `cachedFetchCore` stores the response after any 2xx, so a route that can return `null`
needs `shouldCache` — without it a correct-looking conversion reintroduces the session-167 re-prompt.

**Not exercised:** nothing renders differently; this PR adds a check, a baseline and a test. `Ran 79
of 79` Custom Rules steps, up from 78 — which is why that count is read from the YAML rather than
hardcoded anywhere.

<a id="2026-09-25-or166-scoped-calendar-client"></a>

# 2026-09-25 — OR-166: 203 MB of Google APIs for one calendar call

**Branch:** `or166-scoped-calendar-client` · **Lane A**

`googleapis@172` installed **203 MB** and was imported by exactly one file. It is replaced by
`@googleapis/calendar@20` at **884 kB** — the same generated Calendar v3 client, without the other
~380 Google APIs beside it. Next traces the import graph for the server bundle, so the whole package
was walked on every build.

## The saving, measured rather than assumed

The entry was explicit that the 203 MB was measured and the build saving was not, and asked for a
before/after. Cold `pnpm build` (`rm -rf .next` each time) in this container:

| | total | Next's compile phase |
|---|---|---|
| before | 6m16s | 3.9 min |
| after | 5m09s | 3.2 min |
| after, again | 4m54s | 3.0 min |

The two after-runs sit 15 s apart, so the ~70 s gap is comfortably outside the run-to-run noise.
n=1 on the before, which is the weaker half of the comparison and is stated as such.

## The risk the entry did not name

This is not purely a repackaging, and the difference matters for this particular route.
`googleapis@172` depends on `googleapis-common@^8` + `google-auth-library@^10`;
`@googleapis/calendar@20` depends on `@^9` and `@^11`. So the swap is a **major bump of the
underlying auth and transport stack**.

That is load-bearing here because `/api/log-calendar-event` sorts a failed `events.insert` into two
answers by **reading the error**: a 403 is a consent state the user has not given and is deliberately
kept out of `error_events`, and anything else is a fault and is recorded. A changed error shape would
silently re-route a real fault into the quiet branch, or bury the common consent case in the table
every session reads to orient.

**So both libraries were driven against live Google with a bogus credential, side by side.** They
throw the identical object: `GaxiosError`, `message: 'invalid_client'`, `code: 401` **as a number**,
`status: 401`, `response.status: 401`. The contract is unchanged. `gaxios` stayed on major 7 across
both dependency chains, which is the reason.

That side-by-side also settled something for **LA-85**, the open entry saying this route's scope
check may not match what Google actually throws. Its first mechanism — `GaxiosError.code` is the
numeric status, so `errCode === 'ERR_HTTP_403'` cannot match — was read from the pinned `gaxios`
source and marked as not yet observed live. It is observed now, on a real 401 from Google, and it
holds. LA-85 still needs its genuine **403** to settle the message-matching half; that entry records
both facts.

One incidental tidy: the lockfile carried `googleapis-common` at both 8 and 9 while `googleapis` was
installed. It now carries only 9 — the swap removed a duplicate rather than adding one.

## Verification

- `tsc` clean, `typecheck:tests` at baseline, lint 0 errors, **1052 test files / 9807 tests passed**,
  **Custom Rules 78 of 78**, `pnpm build` green.
- `feedback-calendar-scale-routes.test.ts` (19 tests) passes with its `vi.mock` retargeted from
  `googleapis` to `@googleapis/calendar`. Its mock shape did not otherwise change, because the route
  uses the same two things from either package.
- The real client — not the mock — was constructed and driven end to end as far as a credential
  allows: `auth.OAuth2` constructs, `setCredentials` takes the refresh token, `calendar({version,
  auth})` builds, and `events.insert` performs the token exchange and reaches
  `oauth2.googleapis.com`, which refuses the fake client id.

**Not exercised, and it is the one step that matters most:** an event actually being created with a
real refresh token. The container has no Google credential, so this cannot be done here. OR-166 stays
in the queue as `Verify: owner` with that named as the owed check — complete a workout on the device
and look for the event in Google Calendar. Everything short of a real credential passed, and that is
not the same thing.

No version bump or changelog entry: nothing user-visible is intended to change, and claiming a
user-facing improvement for a build-time dependency swap would be noise in a log the owner reads.

<a id="2026-09-25-or168-deploy-verification"></a>

# OR-168 — nothing confirmed a deploy landed, and the lag is now measured at 205s

**Branch:** `feat/or168-deploy-verification` · **Lane A** · `[platform]`

Merging to `main` auto-deploys to Railway and nothing checked the result. The 2026-08-17 outage — a
database-free route unreachable for ~8 minutes — was found by the owner noticing.

**Notify only, never act** (owner's decision, 2026-09-25): an automatic revert across a migration can
leave production worse than the bad deploy did. A check that tells you beats no check; a check that
*acts* is a mechanism that can itself fail.

## The entry's three warnings all held

- `/api/version`'s `version` is `CHANGELOG[0].version`, so it moves only when a PR bumps the
  changelog. Neither PR merged before this one did — polling it would have sat green against the
  previous deploy, exactly as warned.
- The route is `Cache-Control: public, max-age=300`, the single written exemption in
  `check-api-no-store.js`. The header stays; every poll busts it with a query param instead.
- `RAILWAY_GIT_COMMIT_SHA` is available at runtime — `app/sw.js/route.ts:12` already keys the
  service-worker cache on it.

## One thing the entry did not know, and it mattered twice

**The deployed commit was already observable before any code change**: `/sw.js` embeds
`` `ta-${BUILD_ID.slice(0, 12)}` `` in its cache name. Checked against production, it read
`ta-cdbc613d2596` — exactly `origin/main`'s head at the time.

That solved two problems the entry leaves open:

1. **The lag is no longer "not established".** Merging [#1663](https://github.com/nekodas-neko/TrainingAi_Open/pull/1663) and polling `/sw.js` every 20s timed the
   deploy at **205s**, ending on `ta-5b10e329671b` — the merge commit. The entry says to measure
   before choosing a timeout, "or the first false alarm teaches everyone to ignore the alarm".
2. **It breaks the bootstrap.** A poller keyed only on `webBuildSha` cannot verify the very deploy
   that introduces `webBuildSha` — it would time out against a production that has not got the
   field yet. Knowing `/sw.js` carries the same value means that case is diagnosable rather than
   mysterious, and the check says so in as many words.

## What shipped

`webBuildSha` on `/api/version`, and `scripts/check-deploy-landed.js` driven by a new
`deploy-check.yml` on `push: [main]`.

**The logic is a script, not shell inside the YAML**, so it has tests. **A separate workflow, not a
job in `ci.yml`**, because `ci.yml` deliberately has no `push: [main]` trigger — re-running the full
suite per merge costs ~11 billed minutes for a result the PR run already produced, and that decision
is not being reversed for a curl loop. **Not a required check**: it runs after the merge, so gating
on it would be circular.

**The deadline is 1200s against a measured 205s** — ~6x, not 2x. The measurement is a single
JS-only deploy; a merge that changes dependencies rebuilds more, and RV-188 has Railway builds near
a memory boundary. The two failure modes do not cost the same.

**The sha comparison is a prefix match in either direction**, because `sw.js` already truncates the
same value to 12 and nothing guarantees the field's length. With a floor of 7 characters — without
one, a short string prefix-matches every commit and the check passes against any deploy at all.

## Verification

31 tests. The three timeout diagnoses are separated deliberately: an app that does not answer, an
answer with no `webBuildSha`, and an answer still carrying the previous commit are different faults,
and collapsing them into "deploy failed" sends someone to Railway when the answer is an unset
environment variable.

| mutation | killed |
|---|---|
| drop `webBuildSha` from the route | 2 of 31 |
| `webBuildSha` falls back to `''` rather than null | 1 |
| `webBuildSha` reads the APK sha instead | 1 |
| drop the cache-bust from the polled url | 1 |
| `MIN_PREFIX` 7 → 1 | 1 |
| prefix match becomes strict equality | 2 |
| an unreachable app throws instead of polling on | 1 |
| **control:** reorder the two `startsWith` operands | **0 — survived, as intended** |

The poll loop was also run against real production before the field existed, which exercises the
bootstrap case: it correctly reported "answered but carries no webBuildSha", naming
`RAILWAY_GIT_COMMIT_SHA` as the thing to check.

Gates (real exit codes): `lint` 0 · `tsc` 0 · `typecheck:tests` 0 · `check:rules` 0 · pointers 0 ·
doc-size 0 · full suite green.

## Not exercised

**The workflow itself has never run**, and cannot before this merges — `push: [main]` is its only
trigger. Its first real execution is the merge that lands it, against a production that at that
moment still predates `webBuildSha`; it should go green once the deploy completes, on the same
~205s timescale. If it instead reports "carries no webBuildSha" at the deadline, that means
`RAILWAY_GIT_COMMIT_SHA` is unset on the Railway service, which no test here can tell us.

No migration, no local-store change, no device path, no APK.

<a id="2026-09-25-perf-or-165-ci-shard-and-cache"></a>

# 2026-09-25 — OR-165: shard the tests, cache the Next build, and measure before culling anything

**Branch:** `perf/or-165-ci-shard-and-cache` · **Lane:** O · `ci.yml` and docs, no product code

An external contributor (jsboiss) said CI is too slow at ~8 minutes and proposed four fixes: cull the
10k tests, delete the Custom Rules job, gate jobs on changed files, and scope the build. The
instinct is right. Three of the four targets are not on the critical path.

## The measurement that decides it

Job durations across three runs, 2026-09-24/25:

| Job | Duration |
|---|---|
| Custom Rules | 26–37 s |
| E2E | 44 s (skips its expensive half) |
| Lint | 50–61 s |
| Migration Check | 57–66 s |
| Build | 3 m – 5 m 15 s |
| **Tests** | **6 m 42 s – 6 m 56 s** |

**They run in parallel, so wall clock is the slowest job — Tests, alone.** Everything but Build
finishes inside 70 seconds. Deleting Custom Rules saves **zero** wall clock. Gating Migration Check
on changed files saves **zero**. Both save runner minutes, which is a cost argument, not a speed one,
and should be made as such or it will look like it failed.

## What shipped

**Tests sharded four ways.** `vitest run --shard=i/4` over a matrix. Verified locally: shard 1 is
**264 of 1,055 files, 2,193 tests, 47 s** — a clean quarter.

**⚠ The aggregator job is load-bearing and the reason this could have been a disaster.** A matrix
reports `Tests (1)`, `Tests (2)`… and the `ProtectMain` ruleset — switched to Active hours earlier
today — requires a check named exactly `Tests`. Sharding without an aggregator means that check
**never reports**, which does not fail a PR: it leaves **every PR in the repository permanently
unmergeable**. A `test` job named `Tests`, `needs: test-shard`, `if: always()`, publishes the one
name. The `always()` matters as much as the job: without it a failed shard SKIPS the aggregator and
produces the same hang.

It is deliberately not guarded on `schedule`, because LB-31's nightly runs the suite and nothing
else, so this is the only job that can report its result.

**Every shard gets its own Postgres.** I had proposed segregating the ~20 DB-backed files into one
shard and changed my mind: shards are parallel, so four container starts cost nothing in wall clock,
and a database per shard means fewer files share one — which is the LA-32 collision class, reduced
rather than multiplied.

**`.next/cache` is now cached.** `cache: 'pnpm'` on setup-node caches the dependency store, not
Next's compilation output, so every CI build recompiled from cold — `pnpm build` is ~4 m 45 s of the
~5 m job while `pnpm install` is ~5 s. Keyed on lockfile + source with `restore-keys`, so a miss is
partial rather than total.

## What was refused, and why

**Culling tests.** The suite caught two real defects of mine in 24 hours, and the profile says the
cost is not assertions: `import 343 s` against `tests 517 s`. Sharding gets the same latency without
trading coverage for it.

**Deleting Custom Rules.** The premise — *"coding standards belong in CLAUDE.md, so you get it
free"* — is what this repo has the most evidence against. The cache-TTL check exists because prose
did not hold: one key carried two TTL expressions with different values. A component-level
`invalidateCache()` shipped through a green local gate (#1279). The duplicate-`Lane:`-field check
caught **me three times in one session** and I wrote the rule. CLAUDE.md is ~1,000 lines; "free"
assumes perfect recall by every agent every time.

**File-based gating of Tests.** Already used for E2E, and the mapping has been wrong twice — the
prefix list missed 47 browser-reachable files, and my replacement missed `instrumentation-client.ts`
and counted `import type` edges. **A conditional check that skips wrongly is worse than a slow one**,
because it reports green without running. Tests is where that mapping is hardest and the stakes are
highest.

**Moving the suite after the merge.** The usual advice, and impossible here: `main` auto-deploys to
Railway, so a red `main` is a broken production deploy. The pre-merge gate IS the production gate.

## Filed, not done

`OR-166` — `googleapis` installs **203 MB** for one `google.calendar()` call in one route. Lane A,
and it touches a working OAuth integration, so it gets a proper verification rather than a swap.

`OR-167` — `@phosphor-icons/react` (**41 MB**) is six files and five icons against `lucide-react`'s
270. Lane B, `Gate: owner`, because it changes icons on the screens he watches during a run.

## Verification

`pnpm check:rules` — Ran 78 of 78. `check-backlog-pointers` — OK, 498 entries. Workflow parsed with
PyYAML and asserted: a job named `Tests`, `needs: test-shard`, `if: always()`.

**The real proof is the PR itself** — a check named exactly `Tests` must appear, and the wall clock
should drop. Neither is established by reading the diff, and this must not merge until both are seen.

<a id="2026-09-25-review-sweep-61-ai-to-logic"></a>

# 2026-09-25 — Review sweep 61: where AI can be replaced with logic

**Branch:** `review/sweep-61-ai-to-logic` · **Agent:** Review · **Docs only.**

- **Owner request:** use logic instead of AI where possible, for tokens and offline use.
- **Usage:** 121 AI calls and about 235k tokens in 30 days. That is cents, so the case for this
  work is offline use, latency and correctness.
- **Five entries:**
  - **RV-200:** replace four AI rewordings of computed facts: daily-digest, session-explain,
    running-plan explain and the goals prose.
  - **RV-201:** logic-first health-insight and weekly-digest, with the week page working offline.
  - **RV-202:** a deterministic prescription fallback instead of a ~30 s failure, and a duration
    change without a model call.
  - **RV-203:** food capture checks the user's own foods before asking the model, and meal plans
    use the library by default.
  - **RV-204:** workout-review and recap from existing code.
- **Kept on the model:** Coach, builder-chat, photo and recipe scans, new meals, and naming a new
  exercise.
- **PS-31** gained a note: RV-201 and RV-200 supersede its items (a) to (c).

Write-up: `docs/reviews/2026-09-25-sweep-61-ai-to-logic.md`. Read from code and `ai_call_log` only.

<a id="2026-09-25-review-sweep-62-dv-design-capture"></a>

# 2026-09-25 — Review sweep 62: a design and feel pass for the device agent

**Branch:** `review/sweep-62-dv-design-capture` · **Agent:** Review · **Docs only.**

- **Owner request:** more UI, performance and design checks that DV can run, returned as reports
  or screenshots Review can work from.
- **21 DV probes were already queued**, so nothing was duplicated.
- **Added Part D (P23 to P28) to the probe checklist,** covering the two gaps:
  - a screen gallery Review can actually see: full-length, across states, with sheets open;
  - the feel metrics: tap latency, scroll frames, keyboard occlusion, a design-token census, and
    a motion inventory.
- **RV-205** (`Lane: DV`, after RV-186) runs Part D in one read-only sitting.
- **Screenshots go to a private Artifact, never the repo.** That narrows the baton's
  no-images-off-machine rule at the owner's request.

Write-up: `docs/reviews/2026-09-25-sweep-62-dv-design-capture.md`.

<a id="2026-09-25-route-device-checks-to-dv"></a>

# 2026-09-25 — route the device checks the DV agent can actually answer

Owner instruction: *"Make sure anything that can be done by DV agent is assigned to it. I shouldn't
need to do device checks are possible by DV."* Docs-only: field changes and notes on existing
entries, no new backlog entry.

## The honest size of it: one reassignment out of twelve

Twelve entries sat in `--sittings` as blocked on a device check. Reading each one's *next action*
rather than its gate, only one was genuinely the device agent's:

**`OR-162` → `Lane: DV`, ungated.** Its own text says what it needs: *"count
`document.querySelectorAll('canvas')` per panel, then attribute."* A measurement nobody has taken,
objective result, runnable over the DevTools protocol with nobody looking at anything. It carried
`Lane: B` + `Gate: device`, and the gate is what parked it into the owner's list. Removed rather than
kept beside the lane, because `Gate:` parks. The fix stays Lane B's once the count exists. It is now
top of DV's READY list.

## Two whose check is DV's, without changing the lane

- **`DV-12`** — `Lane: B` is right and `Gate: device` is right, because the check must follow the fix.
  What was never said is **who runs it**. `perf.js longtasks` under 50 ms is a number, not a look, so
  it should never consume an owner sitting. Noted, with instruction to run it in the same sitting as
  OR-162 — same screen, same batch.
- **`Q-34`** — its reachability half (*"tapping through from the sleep tile"*) either reaches the
  staging data or does not: a navigation reproduction with a yes/no answer, and it was on the owner's
  checklist. Its SpO₂ half turned out to be **wrongly posed**: `spo2Var` is not a stored column at all,
  it is computed per epoch in the rollup, so "is the debug column populated" has no referent.
  `oura_bucket.spo2_pct` is empty (0 rows), which is suggestive and **not decisive**, because the
  stager reads from the rollup's own accumulator. Tracing that source is a read, not a sitting.

## Nine correctly not DV's, and why — so nobody re-routes them

| entry | why the phone is involved but DV is not next |
|---|---|
| `Q-545` | Tasks 3/4/6 end in objective comparisons, but **the device half does not exist yet** — its own text says so. Next action is Lane A code. Trap (a). |
| `Q-418` | What remains is Kotlin and a new APK. CLAUDE.md names this entry as the example of trap (a). |
| `PS-8` `PS-9` `PS-12` `PS-16` | Colmi R09 hardware, not the S25 — and PS-16 records the ring being with a second wearer. |
| `Q-114` | Needs a capture of real weight-stabilisation time, i.e. the owner on a scale. His body, not DV's. |
| `Q-388` | Needs an overnight worn-ring drain reading on the current APK. |
| `PS-7` | DV could run the pose-landmarker probe, but Lane A has to build it first; owner placed it at the tail as *"a good future move"*. |

## One thing flagged and deliberately not changed

`Q-545`'s `Gate: device` parks work whose next action is Lane A code — the `DV-12`/`RV-166` defect in
reverse. Whether Lane A can meaningfully start the model-session injection from a sandbox is a
judgement about the entry's substance rather than a routing call, so it is recorded for the
Orchestrator and left alone rather than re-laned by a Tuning session reading it from outside.

## Not exercised

Docs-only; nothing ran. No device involved, and no entry was re-routed on the basis of a gate field
alone — each was read for its next action. The `oura_bucket` count is a `claude_ro` read and therefore
the owner's rows only, which is why it is offered as suggestive rather than as an answer.

<a id="2026-09-25-rv101-heatmap-ramp-and-key"></a>

# 2026-09-25 — the muscle heatmap: a ramp you could not read, and a fix that could not work

**Branch:** `lane-b/rv101-heatmap-ramp-and-key` · **Lane:** Implementation B

RV-101 said the volume ramp's bottom two stops sat under the 3:1 non-text floor, so a barely-trained
muscle looked untrained. That was right. Both of its numbers and its prescribed fix were not.

## The background was wrong, and the defect was worse than filed

The entry measured the stops against `--card`. That is not what sits next to them. An untouched
muscle is painted with the component's own `defaultFill`, `rgba(128,128,128,0.18)`, composited over
the card — `rgb(30,41,33)`. Against that:

| stop | vs `--card` (as filed) | vs the real neighbour |
|---|---|---|
| `#14532d` | 2.04:1 | **1.65:1** |
| `#166534` | 2.60:1 | **2.11:1** |

The entry listed the default fill under *"not established … was not read"*. It is on line 122 of the
file the entry cites. Reading it was the whole correction.

## The prescribed fix does not work

*"Lift the bottom two stops past 3:1"* cannot be done. The floor is at luminance 0.159 and the third
stop was already 0.269 — so two lifted stops **and** their separation from the third would have to
share a total contrast range of **1.52:1**, roughly 1.15:1 each. That is not a ramp, it is three
shades of the same colour.

Re-spacing the whole ramp is the fix, and it lands more evenly stepped than what it replaced:
1.34 / 1.45 / 1.31 / 1.24, against 1.28 / 2.16 / 1.45 / 1.31.

## The brand hue caught me out

The opening stop is `#178a42`, not a Tailwind green, because `--card` takes the user's brand hue.
green-700 measures 3.00:1 at the default hue 149 and **2.99:1 at hue 144**. I had picked green-700
and the check rejected it — `check-contrast.js` already scores token pairs at their worst hue over
the whole circle, and extending that rule to the ramp is what found it. Worth keeping as the lesson:
a contrast number computed at one hue is a number about one user's theme.

## What shipped, and what was declined

Shipped: the re-spaced ramp, and a key reading *Under 20% … At target*. The key renders in **compact**
mode on purpose — both volume callers pass `compact`, and the injured swatch above it is gated on
`!compact`, so a key written the same way would be invisible exactly where it is needed. That trap
came from the entry's own 2026-09-24 re-read.

Declined, with reasons on the entry rather than left silent:

- **Giving the ramp its own hue.** Its middle stop is still `PRIMARY_COLOR`. But the two scales are
  chosen by mutually exclusive props and never render together, and the key names the scale at the
  point of use — which is what the collision actually needed. Changing the hue family of a card the
  owner reads weekly is a restyle with no standard saying the present one is wrong. Same test that
  kept RV-99 narrow.
- **A key in role mode.** Categorical, already has its injured swatch, and adding swatches would
  change what renders at seven call sites nobody has complained about.

## Enforcement

The numbers live in `scripts/check-contrast.js`, which already owned the maths, the `globals.css`
parse and the worst-hue rule — so no second copy was written. It reads the ramp and the fill out of
the component, and refuses to report a pass if either regex stops matching.
`components/__tests__/rv101-volume-ramp-and-key.test.ts` states the rule independently; 3 of its 4
assertions fail against `origin/main`, and the fourth pins the premise that both callers pass
`compact`.

**Not exercised:** the rendering. Nothing here was opened on the S25 or in a browser. The entry keeps
`Verify: device` for that look, and it now shows up in the `workouts` device sitting.
