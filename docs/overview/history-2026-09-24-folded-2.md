# Session journal — batch folded 2026-09-24

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-09-23-review-dv-performance-probes"></a>

# 2026-09-23 — the performance half of the device-agent brief

**PR:** this branch. **Docs-only.** Nothing was run on a device.

## What prompted it

The owner asked whether the Device Verification agent had been given a sweep of the checks it can
*really* test — page-load efficiency, timing, path structure. **It had not.** Of the ten probes filed
in #1418, only P6 (warm-visit paint) and P10 (heap and listener accumulation) touched timing; the
other eight are correctness — invalidation reachability, the local store, offline, computed styles.
That is a real gap and the answer was "no", not "partly".

## Why it is worth filing rather than just running

The repo already has a perf thread, and it is **stalled on exactly this measurement**:

- **Q-51** softened to the owner's *"Its mostly fine; I'd still like it to be faster if possible"*,
  and its own conclusion is that *"measure before refactoring" is now **more** binding, not less* —
  a large refactor is a poor trade against "mostly fine".
- **The whole queue's perf evidence is one observation**: `/workout` visited five times in a session,
  four at ~100 ms and one at **1086 ms**, all warm. Read as a first-mount cost. The remaining
  file-splitting work rests on that reading.
- **BF-22** is an owner report already narrowed to in-memory client state — *"everything is loading
  very slowly"*, then *"actually its running a lot better after a force restart"* — with the
  server-distance theory measured and found wrong.
- **RV-110** counts 37 cross-tab `router.push` sites that tear down the tab shell, and has **no
  number for what a teardown costs.**

So each entry is aimed at an open question that already exists, rather than at producing a fresh pile
of numbers nobody asked for.

## The six

| | probe | what it settles |
|---|---|---|
| **RV-137** | P11 — cold start + per-tab TTI | gives the perf thread its first baseline; Q-51 and Q-147 both closed on impressions |
| **RV-138** | P12 — the 1086 ms outlier as a distribution | whether Q-51's file-splitting work is justified or the reading was noise |
| **RV-139** | P13 — network waterfall, chain depth | serial request chains, which no source-reading sweep can see |
| **RV-140** | P14 — main-thread long tasks | RV-113's asserted cost; and whether `animationiteration` still takes 21.3% |
| **RV-141** | P15 — path structure | RV-110's missing cost-per-teardown |
| **RV-142** | P16 — does a long session slow down | the timing half of RV-133; together they decide BF-22 |

**Cold start is measurable now and was not before**, which is why this did not exist. A recording
cannot span an app kill — the WebView dies with it. But `performance.getEntriesByType('navigation')`
and `('paint')` survive for the life of the page, so a harness that attaches *after* a normal cold
start loses nothing. `device-perf-profiling-checklist.md` had already worked that out and had no
agent to run it.

## Routing, checked rather than assumed

6 of 6 reach `next-item.js --sittings`; **0 leak into either implementer lane's READY list.** Same
`Verify: device` filing as RV-124…RV-133, with each entry stating in its first bullet that there is
no build half — these are measurements, not shipped work awaiting a look.

## Not established

Nothing was run. Every threshold in the entries (300 ms warm, 1.5 s FCP, 50 ms long task, chain depth
2, 20% drift over a session) is a **stated expectation to be falsified**, not a measured budget — the
app has never had one. A probe that comes back green against these is as useful as one that fails,
because it is the first baseline either way.

## A fifth datapoint for RV-134, collected by accident

This PR conflicted on `docs/doc-size/docs/implementation-backlog.md.size` and the append-only
history file — **five of five merges tonight**, after RV-134 recorded four of four and Tuning
recorded five of seven. That entry argues the mechanism is the ratchet's missing `inherited` escape
on the *slack* direction, and this merge is another instance: `main` had shrunk the backlog below
the number on this branch, so the branch was required to lower a figure it never moved.

Not re-filed — RV-134 already holds it. Recorded here because the count is the evidence, and a PR
that demonstrates the defect it is not even about is worth one line.

<a id="2026-09-23-review-sittings-misses-gate-device"></a>

# 2026-09-23 — the device agent could not see the work that is blocked on it

**PR:** this branch. **Docs-only.** Nothing was run on a device.

## The question, and the honest answer

The owner asked whether everything the Device Verification agent needs had been backlogged. **It had
not.** Checking rather than asserting found a gap that is structural rather than an oversight in any
one entry.

`next-item.js --sittings` is the device agent's work list. Its filter:

```js
if (e.verify?.value === 'device') return true;
return /\bdevice\b|\bS25\b|\bAPK\b|on-device/i.test(e.keep?.text ?? '');
```

**`Gate:` is never consulted.** Measured on `main`: 29 entries carry a `Gate: device` field and
**24 of them do not appear in `--sittings`**.

## Why that is worse than "missing"

A `Gate:` **parks** an entry. So those 24 are skipped by both implementer lanes *because* they need
the device, and are invisible to the one agent that has the device. Nothing surfaces them to anybody
— they are in a dead zone, and they include **Q-51**, the perf entry this session built six probes
around, and **BF-22**, the owner's own *"a lot better after a force restart"* report.

## The cause is a role that changed the meaning of a field

`--sittings` was built around *shipped work owing a look* — BF-90 found eleven entries writing the
same debt in both `Verify:` and `Keep:`, which is what the filter reads. Before 2026-09-23 a
`Gate: device` meant **wait for the owner to pick up the phone**, so leaving it out of a "what could
one sitting clear" view was correct.

The Device Verification role changes what that gate means: it now reads **the DV agent can unblock
this**. And a gated entry is *more* urgent for that agent than a `Verify:` one — one blocks work, the
other is a look owed on work already shipped. The field's meaning moved; the selector did not follow.

## What RV-143 asks for

Select `Gate: device` in `sittingsOnly` too, and print which field each row came from so a reader can
tell *blocked-on-this* from *look-owed-on-this*. About three lines.

The entry carries a triage of all 24 so the fix does not simply dump them on the device agent:
roughly **13 runnable now**, **5 needing the Colmi R09 in hand**, **2 needing a production write or
the owner physically present**, and **4 that look mis-gated** and are really design specs.

**⚠ The entry states one thing not to do:** bulk-converting `Gate: device` → `Verify: device` to make
them visible. `Verify:` means shipped, the protocol warns against that misuse twice, and applying it
to 24 unbuilt entries would file them under *"done; a look is owed, nothing is blocked"* — worse than
the present silence, because then a reader in either place stops looking. The selector is the defect.

## Not established

The triage was read from entry headings and each entry's own gate reasoning, **not** from re-verifying
against the code. Whoever takes RV-143 should re-read each of the 24 rather than trusting the split —
that caveat is in the entry.

<a id="2026-09-23-rv106-rv107-rv109-stale-surfaces"></a>

# 2026-09-23 — RV-106 / RV-107 / RV-109: three surfaces that never asked again (`fix/rv106-rv107-rv109-stale-surfaces`)

Batch `stale-surface-subscribe`, all three from Review sweep 53, all three the Q-402 shape: the
write group cleared the key and nothing re-rendered. **No fix here adds an invalidation** — every
key involved was already being cleared, and was verified to be, in the same PR.

Each card is a `cachedFetch` inside an effect with stable deps, mounted inside the persistent tab
shell. That shape never re-runs, so the value it painted at launch is the value it keeps.

## What changed

| Entry | Surface | Keys now subscribed | Cleared by |
|---|---|---|---|
| RV-106 | `components/health/hr-day-card.tsx` | `oura-hr-day:`, `workout-sessions-day:` | `invalidateOuraSync`, `invalidateWorkoutSummaries`/`invalidateExerciseLogged` |
| RV-107 | `app/nutrition/use-nutrition-targets-refresh.ts` (new) | `nutrition-targets` | `invalidateGoalRecommendations` |
| RV-109 | `components/health/activity-history-card.tsx` | `activity-logs`, `activity-types` | `invalidateActivityWrites`, `invalidateActivityTypes` |

All five keys were checked against `lib/cache-groups.ts` rather than assumed, and the test asserts
both halves — the surface subscribes it **and** a group clears it. Either alone is a subscription to
something that never fires, or an eviction nobody listens for.

## Three things worth keeping

**RV-106's open question is answered.** The entry left it untraced whether `useStressDay(today)` in
the same card shared the gap. It does not: it goes through `useCachedValue`, which already
subscribes. That makes it the reference for why the other two reads in that file were the broken
ones, and it is asserted so it stays that way.

**RV-107 had two identical fetch expressions for one key.** `TdeeAdaptationCard`'s `onApplied`
refetched `nutrition-targets` by hand — one write path fixed site-by-site while its siblings were
not, the same pattern BF-177 was patched with three times. Both now go through the hook, so the key
has one expression (the TTL-divergence rule) and future write paths are covered without being
remembered.

**RV-109's `activity-types` passes `freshWithinTtl: true`,** which makes its invalidation
load-bearing in the strict Q-262 sense: the cached entry is a *settled* value that survives until
something clears it, not a first-paint accelerator the next revalidation would correct anyway.

The hook kept for targets is deliberately separate from RV-104's `useNutritionDerivedRefresh`:
that one belongs to `invalidateNutritionWrite`, this one to `invalidateGoalRecommendations`.
Bundling them would make a food log refetch the targets and a target edit refetch the weekly chart,
and would hide which write each subscription protects against.

Two dead `.catch(() => {})` chains on `cachedFetch` went with the restructuring (RV-84 — it never
rejects). The local-store `.catch` in the activity card stays: `store.getActivityLogs` genuinely can
reject, and the test asserts the `cachedFetch`-specific shape rather than "no empty catch anywhere",
which is what a first, too-broad assertion got wrong.

## Why there is no e2e spec here

Driving a real targets write means navigating to Profile — and **whether that navigation unmounts
the tab shell is itself an open finding (RV-110: 37 cross-tab `router.push` sites tear it down).**
A green spec could pass for the wrong reason (the shell remounted, which is exactly how RV-109
describes `/activity` self-healing) and a red one would not say which defect it had found. So the
pins here are unit-level, and **RV-124 — #1418's device probe — is the thing that settles this
class by measurement**, RV-106, RV-107 and RV-109 among them.

What was exercised: `Ran 75 of 75`, tsc clean, 652 tests across the touched areas, and both Health
and Nutrition rendered authenticated under the e2e harness with `/api/activity-logs`,
`/api/activity-types` and `/api/nutrition/targets` all answering 200 from the restructured reads.
RV-104's spec still passes against RV-107's edits to the same file.

## Not exercised

Native SQLite / Capacitor (the web path takes the API fallback), safe-area, Samsung WebView,
drifted production data, real ring sync. **No device sitting** — and per #1417 those are the Device
Verification agent's to run; this PR's job is to record them so `next-item.js --sittings` finds them.

<a id="2026-09-23-rv110-rv112-tab-nav-shell"></a>

# 2026-09-23 — RV-110 / RV-112: tab navigation and the shared scroll slot (`fix/rv110-rv112-tab-nav-shell`)

Batch `tab-nav-shell`, both from Review sweep 53.

## RV-110 — 15 sites, not 37, and that distinction is the work

The entry counts **37** `router.push('/health'|'/nutrition'|'/more'|'/workout')` sites and reads
them as cross-tab navigations that tear the shell down. The grep is exact; the implication is not.
Classified against `tabKeyForHref` (`components/shell/tabs.ts`), which matches an **exact** path and
explicitly excludes `/workout?session=`:

- **15 are genuine tab destinations** — converted to `navigateToTab`.
- **22 are not tabs at all**: sub-routes (`/health/day`, `/health/sleep`, `/health/week`,
  `/more/details`, `/more/settings/…`) and the full-screen `/workout?session=…`. `tabKeyForHref`
  returns null for every one, so `navigateToTab` would only forward them to `router.push` while
  *reading* as a tab flip. Converting them would be misleading, not safer. They stay.

`scripts/check-tab-navigation.js` holds the 15 at zero and encodes that boundary, so a later sweep
cannot "finish the job" by converting the other 22. It runs in the Custom Rules job —
**`Ran 76 of 76`**, up from 75. The check was verified to fail: a reintroduced `router.push('/health')`
in `walk-summary.tsx` was caught by name and line, then passed again once reverted.

## RV-112 — Home and More shared one scroll slot

The key is `keySuffix ? ${pathname}#${suffix} : pathname`. Health passed three suffixes; Home and
More passed none, and both stay mounted, so both wrote and restored one slot with no owner check on
the restore. Fixed with `scrollKey="home"` and `scrollKey="more"`.

**The suffix is what separates them, not the path** — `usePathname()` reads the route tree, which a
tab flip leaves stale (LA-109), so the pathname half of that key cannot be relied on to differ
between two mounted tabs. That reasoning lives in `more-content.tsx`; Home carries a one-line
pointer, because `session-select-content.tsx` is a size-ratcheted hotspot and the full comment put
it over. `e2e/scroll-restoration.spec.ts` — which RV-112 notes was never run — passes, 5 of 5.

## The premise I could not verify, stated plainly

RV-110's mechanism is that a push to a tab href unmounts `TabShell`. That is consistent with the
code (each tab's `page.tsx` renders its own `TabPage` → `TabShell`), but **this PR ships no e2e
proving it.** A first attempt marked a DOM node and asserted it survived a flip; the marker then
also survived what was supposed to be a teardown, so the spec was not discriminating and was
deleted rather than shipped. The reason was my own error — the "teardown" control dispatched
`ta:tab-navigate` with a non-tab href, which `onNav` ignores *without* `preventDefault`, so
`navigateToTab` (the thing that calls `router.push`) was never involved and nothing navigated at
all. A valid control has to drive a real push through the UI.

## A wrong turn worth recording, because it nearly cost 37 files

Reading the source, I concluded `useSearchParams` cannot see a tab flip — `show()` ends in raw
`window.history.replaceState`, and the shell's own LA-109 comment says Next re-injects its stale
tree. Plausible, and **false**. Measured under the harness: `/health?tab=body` from Home lands on
`Body=true` at first mount, and `/health?tab=training` into an already-mounted Health lands on
`Training=true`. Next's patched `replaceState` does update search params; LA-109's stale-tree
problem is real and does not extend to them. Had I not probed, the next step would have been a
shell-carrier mechanism plus a 37-file sweep on a false premise.

A separate probe found `/nutrition?review=day` not opening the review sheet on a first flip into an
unmounted Nutrition, reproduced twice — but instrumenting the reader showed `searchParams` arriving
**correct** (`review=day`) at both the initializer and the effect. So it is not a param-delivery
problem and not RV-110's subject. Filed as LB-129 rather than chased here.

## Not exercised

Native SQLite / Capacitor, safe-area, Samsung WebView, drifted production data. **No device
sitting** — recorded so `next-item.js --sittings` finds it. The shell-teardown premise itself is
untested end-to-end, as above.

<a id="2026-09-23-rv120-remove-superseded-volume-card"></a>

# RV-120 — the volume card that was already merged away

**Branch:** `fix/rv120-remove-superseded-volume-card` · **Entry:** RV-120 (Review sweep 53)

## What was wrong

`AiWeeklyVolumeCard` was imported into `health-sections.tsx` and had a live `case "aiVolume"`
render arm, but `aiVolume` appeared in no order array, so nothing ever mounted it. A comment
above `TRAINING_ORDER` explained the omission and promised the card would return "once it's
merged into a single volume card" — and that promised merge had no backlog entry anywhere,
which is what Review filed it for.

## What the entry left open, and how it resolved

RV-120 deliberately did not pick between merging the card in and deleting it. Reading the two
data sources settles it, and not in the direction the code comment implies.

`app/api/weekly-muscle-sets/route.ts:81-88` already does the merge:

> Overlay the active program's per-muscle weekly targets so this single card shows progress
> toward the program's real targets (replacing the separate "Weekly Volume vs Target" card).

So the deferral finished some time ago and nobody updated the comment that promised it. The
shipped `WeeklyMuscleSetsCard` carries the programme's targets already, and carries them
*better* — scaled by the week's actual phase mix (BF-59), with `listVolumeTargets`' stored
numbers read only as the roster of muscles the programme trains.

Rendering both would also have been a defect rather than a feature. `/api/weekly-muscle-sets`
takes no `programId` and counts the week outright; `/api/ai-periodization/weekly-volume` scopes
its logged sets by `programId`. The two would print different numbers for the same muscle in the
same week — the shape RV-117 describes as two different answers to one question.

Deleted, therefore: the component, the import, the render arm, the now-false comment, and the
component's row in `check-hex-literals.js`'s baseline.

## No version bump

The card mounted nowhere, so nothing a user can see changed. No changelog entry, no version bump.

## Follow-up filed, not swept in

`LB-137` (Lane A). The deleted card was the only client consumer of the `weekly-volume-target`
cache key and of `/api/ai-periodization/weekly-volume`; `lib/cache-groups.ts` still clears that
key at two sites for a reader that no longer exists. Both files are Lane A's, so it is an entry
rather than part of this diff. The route is not simply dead — `getWeeklySetsByMuscleGroup` stays
live through `signals.ts` — so the open question is whether the HTTP surface still earns its
place, which the entry states rather than presumes.

## Verification, and what was not exercised

`npx tsc --noEmit` clean · `pnpm lint` 0 errors · `pnpm check:rules` **Ran 77 of 77** ·
`check-hex-literals` clean against the reduced baseline · 45 tests across the 6 files touching
these modules · `pnpm build` succeeded, 245 static pages.

`/health` is auth-gated, so a dev-server GET redirects to `/sign-in` and never compiles the
changed files — the full build is what actually exercised them, and that is the claim being made
here. **Not exercised:** the S25 APK, Samsung WebView rendering, safe-area insets, native SQLite,
drifted production data. No device check is owed: the deleted card was unreachable on every
runtime including the device, so there is no on-device behaviour for it to change.

<a id="2026-09-23-rv135-bf110-keep-reassign"></a>

# 2026-09-23 — RV-135: the entry that parked itself waiting for data it already had (`fix/rv135-bf110-keep-reassign`)

Docs-only. Two lines of BF-110 changed; no code.

BF-110 opens with *"✅ THE READING IS IN, and it says NATIVE — measured 2026-09-18. This entry is no
longer waiting on data."* Its `Keep:` line, further down, still read *"the READING, and only that …
Still do not write a fix before that row exists."*

`next-item.js` reads the `Keep:`, not the body. So the entry sat in the **KEEP** bucket — whose
heading is *"shipped; only the stated residue is owed. **Not new work.**"* — and the `✅` was visible
only to someone who opened the entry and read past its status line. **The native fix was owned by
nobody for five days.**

Two changes, which is all RV-135 asked for:

- The `Keep:` is gone, replaced by a paragraph saying the reading arrived and why the entry is READY
  work rather than residue. The old text is quoted there rather than deleted, because *what it said*
  is the finding.
- `Lane: B` → `Lane: A`. The old lane line reasoned *"the DOM is alive, so the fix is a paint
  invalidation in the shell, not native. No APK needed"* — correct until the measurement landed, and
  now retracted in place rather than removed, since it is the reasoning a future reader would
  otherwise repeat.

Verified by running the tool rather than reading the file: BF-110 now prints at **#21 of Lane A's 37
READY** entries and does not appear in Lane B's list at all.

Nothing else about BF-110 changed — RV-135 is explicit that its analysis is right, which is exactly
what made the filing error expensive. The re-measured counts it carries (25 rechecks, 25 `stuck`,
0 `resized`, `dom-lost` never fired in 62 reported resumes) are folded into the replacement
paragraph so the entry states its own evidence.

## Why this shipped alone rather than in the next batch

`Batch:` aggregates on what has to be *verified*, and this needs no verification — so batching it
behind `tab-nav-shell` (a 37-site sweep) would only have delayed a native fix that currently has no
owner. Timeliness is the entire value of the change.

## Not exercised

Nothing to exercise — no code, no user-visible change, so no version bump. The claim that the entry
moved lanes was checked by running `next-item.js` for both lanes.

<a id="2026-09-23-tuning-reconcile-q272"></a>

# 2026-09-23 — TN-55 was Q-272's missing proposal, and Q-272's acceptance test does not replicate

**Branch:** `tuning/reconcile-q272-and-file-lanes` · **Agent:** Tuning · **Docs-only.**

Asked to file what was buildable into the lanes and route owner-input items to the Orchestrator. The
first thing the sweep turned up was a duplicate of my own making, which was worth more than the filing.

## TN-55 never checked for an existing entry

**Q-272 — *"Body Battery v5 drains 5× faster than it charges"*, filed 2026-08-15** — is the
pre-existing entry for the defect TN-55 describes. It says in its own text that *"the next action is
Tuning's, not theirs"* and that **no proposal exists**; it had been waiting a month. TN-55 is that
proposal and I filed it without looking. The two are now linked and Q-272's gate is lifted.

Reading it changed the recommendation twice.

## Overnight charging is out, and the fit is better without it

Q-272 argues that *"overnight recharge here is handled by the morning anchor reset rather than
accumulated charge, which is a defensible difference"*. That is right, and my proposed
`SLEEP_CHARGE_RATE` would have counted the night twice — against an anchor already derived from
readiness and sleep. It showed in my own numbers as 13–14% of days pinned at 100 and I read it as a
tuning problem rather than a double-count.

Re-fitted with no overnight term, strictly better on every axis:

| | shipped | first proposal | **revised** |
|---|---:|---:|---:|
| median daily net | −85.1 | −0.2 | **+0.5** |
| mean end value | 14.8 | 59.2 | **61.4** |
| sd of end value | 26.4 | 28.0 | **25.3** |
| days ending at 0 | 66% | 5% | **0%** |
| days pinned at 100 | 0% | 8% | **9%** |

Revised constants: `CHARGE_RATE` **0.120**, `DRAIN_RATE` **0.080**, `STRESS_DRAIN_RATE` **0.020**, no
overnight term, `REST_THRESHOLD` unchanged. Gain 0.30 takes railing to 6% if the pinning shows in use.

## Q-272's acceptance test does not replicate, and it was about to sign off the change

Q-272 records **r = +0.67 (n = 11)** for end-of-day battery against next-day readiness, and instructs a
later session to re-run it after the change. Re-measured over **70 days**: **r = +0.252** — against
readiness's own day-to-day autocorrelation of **+0.361**, which is higher. The battery's end value
predicts tomorrow's readiness *worse than yesterday's readiness does*.

So the conclusion built on it — *"v5's level carries real signal; its shape within the day is wrong"* —
keeps its second half, because the four defects are independently measured, and **loses its first**.
The distributional pass test stands; a change cannot be validated against a relationship that is not
there. Both entries now say so.

## Q-502 and TN-55 disagreed about the lever; both were right about different things

Q-502 refuted raising `CHARGE_RATE` alone — the window is active on ~6.7% of waking samples — and
concluded `REST_THRESHOLD` is therefore the lever. The refutation stands and this plan does not raise
`CHARGE_RATE`. The conclusion goes further than the evidence: widening the threshold to TN-52's p10
quantile buys 2.8% → 3.7% of the day. The window is barely active for a different reason than its
width — sleep is excluded and the ramp zeroes at the ceiling — so flattening the ramp makes the
*existing* window productive, which is what Q-502 was reaching for.

## One caveat the plan cannot settle

`DRAIN_RATE` falls 7.5×. Q-521 already measured that drain tracks **wear time** rather than exertion
(`corr(hr_sample_count, drained)` **+0.518** vs `corr(steps, drained)` **−0.153**), so weakening it
could make a hard session even less visible. The plan tells Lane A to confirm a workout day still
separates from a rest day — and that if it does not, that is a *separate* defect (drain keyed on the
wrong input), not a reason to raise `DRAIN_RATE` back and restore the countdown.

## Filed for the lanes

**TN-61 (Lane O, now its READY #1)** — `next-item.js` prints ten rows of a thirty-one-row bucket and
says nothing about the rest. Two entries I had just edited appeared nowhere in its output, which reads
exactly like *removed from the queue*. One line of output, not a behaviour change; the cap is right,
the invisible truncation is not.

## Routed to the Orchestrator's ledger (LA-122), needing the owner

- **2b — is a contributor worth 2.8% of readiness's movement worth keeping?** `activityBalance` carries
  2.8% on a 0.06 weight; the two activity terms together are 7.4% of the number on 15% of the weight.
  Keep, re-weight or drop — each re-scores history. **Deliberately not asked yet:** the rail fix
  (TN-60) will move the table, so asking now would answer a question whose numbers are about to change.
- **2c — the `.size` conflict tax, now measured.** Five of seven PRs this session hit a baseline
  conflict, two also needing the append-only history file resolved by hand. Item 5's cheapest fix does
  not help, because the conflicts came from *other agents'* PRs landing between mine; the one that does
  is generating baselines in CI, which changes the ratchet and needs the owner's yes.

## Not exercised

Nothing runs. The re-measurements are read-only queries through `/api/admin/db-query`, **row-scoped to
the owner**, and the re-fit used the committed harness on data already pulled. **Not established:**
whether the revised constants keep a workout day distinguishable from a rest day — flagged in the plan
as Lane A's check, not asserted here. `pnpm check:rules` **Ran 75 of 75**, all passed; backlog validates
at 417 entries.

<a id="2026-09-24-chore-bf-194-owner-question-section"></a>

# BF-194 — owner questions get their own section, and the spec needed correcting first

**PR:** `chore/bf-194-owner-question-section` · **Lane:** O · queue tooling, no product code.

## The problem, as BF-194 measured it

CLAUDE.md says an owner question goes to `Lane: O` and gets "a queue position near the top".
`next-item.js` prints `TOP_N = 10`. **BF-189 and BF-191 were filed at ranks 1 and 2 one evening and
sat at 16 and 17 the next morning** — fourteen entries inserted above them in about eight hours. No
agent misbehaved: every agent files at the head, which is what the convention asks for, so the head
is exactly where the churn is. Position cannot hold a guarantee the queue's own traffic undoes daily.

## Its recommendation did not work, and that was measured before building

BF-194 proposed keying the new section on `Lane: O`, and rejected a field because *"`Lane: O`
already identifies them"*.

**Measured on `main` before writing any code: lane O holds 61 entries, 58 of them ungated.** It is
the Orchestrator's whole lane, not a queue of questions. A section on that key prints the lane —
which is what `--all` already does, and is the failure the section exists to fix.

So the field is back, because the premise that ruled it out is the thing the measurement refutes.
This is the repo's own *re-verify the plan against current `main`* rule doing its job; implementing
as written would have shipped a 58-row section.

## What shipped

- **`scripts/lib/ask.js`** — `- **Ask:** owner — <the question>`, bullet-anchored so prose cannot
  claim it, same argument `reference.js` makes about fields versus grepping.
- **The field does NOT park.** `Gate: owner` is the trap this rule already records: it removes an
  entry from the Orchestrator's own READY list, so gating a question on the owner is what stops
  anyone asking it. `Ask:` is pure visibility — an entry carrying it is more visible, never less,
  and it outranks `parked` in `bucketFor` so even a gated question stays seen.
- **A `WAITING ON THE OWNER` section**, printed above READY and outside the `TOP_N` cut.
- **Eight entries tagged:** `OR-145`, `RV-161`, `RV-157`, `RV-170`, `RV-121`, `BF-189`, `BF-191`,
  `BF-193`. `OR-150` is deliberately not among them — it waits on Tuning, not on him.
- **Validation** in `check-backlog-pointers.js`: `owner` is the only value, so a typo cannot silently
  drop an entry back into the ten-row cut.

## One divergence from `reference.js`, on purpose

`askFromLines` also accepts `- **Ask** — owner: …`, where the bold closes before the separator.
`referenceFromLines` misses that shape. A missed Reference prints an entry in the wrong section; a
missed Ask leaves an owner question invisible, which is the whole failure the field exists for.

## Verification

BF-194's own criterion, met: `node scripts/next-item.js --lane O` shows BF-189, BF-191 and BF-193
without `--all`, READY stays capped at 10 and still leads with what genuinely ranks first (`OR-150`).

10 unit tests on the field and the bucket ordering. Mutation-checked: `Ask: device` fails the check
and names the entry; restoring `owner` returns to green.

**Deliberately not done, following BF-194's own instruction:** the three entries were not re-ordered.
The fix is to make rank stop mattering.

## Not exercised

Queue tooling only — no product code, no device path, no runtime behaviour.

<a id="2026-09-24-chore-or-140-device-sweep-handover"></a>

# 2026-09-24 — acting on the device agent's sweep 2/3 handover

Orchestrator. Docs-only. Branch `chore/or-140-device-sweep-handover`.

The Device Verification agent finished sweeps 2 and 3, released the phone, and handed over a list.
Most of it needed nothing: `DV-15`/`DV-16`/`DV-17`/`DV-18` were already filed and correctly laned,
and the six deployed-but-still-failing fixes carry their FAILED measurements on the entries. Four
things were wrong, and one request is declined with its reason.

## Four corrections

**`RV-111` — a gate that outlived its answer.** It carried `Gate: device` reading *"the hardware
back path only exists on the APK"*. True when written; sweep 2 then **CONFIRMED the defect on the
S25**, which also settles the open question OR-137 raised — whether the native barcode activity
swallows back before the JS listener runs. It does not, so the written fix is the right fix. Gate
removed; this is Lane B work, not a check.

**`RV-127` — a failed probe filed as shipped.** It carried `Verify: device — no build half`, which
files an entry under *shipped, a look is owed*. Sweep 2 ran it and the inputs came back at **21 px
of ink, ~33 px of touch area** against the 44 px floor — so there is a build half. Removed. A
FAILED is work, and leaving the field on reads as finished to everyone who scans the queue.

**`RV-144` filed, Lane B.** `RV-127`'s one actionable finding, handed to the lane that owns the
surface: three inputs on `/more/details`. Measured twice — the first pass said *"not judged; whether
their row or label widens the target is the next question"*, and sweep 2 asked that question and got
~33 px. The `tap-target-dot` session dots it also found are **by design** (44 in the axis that
matters) and must not be "fixed"; the horizontal overflow was looked at on screen and overlaps
nothing.

**`RV-127` re-laned `O` → `DV`.** It was held in `O` to get its findings to the right lanes; that
filing is now done, and the only thing left is the clearance half, which three-button navigation
cannot answer.

## One request declined, with the reason

The handover asked: *"Q-168 is tagged Lane DV but isn't a device check; please re-lane it."*
**It is staying, and the argument is on the entry** so it outlives the exchange.

Read literally, the claim does not hold: `Q-168`'s *What is actually left* section has **one** item,
and it is running the AI Coach section of the smoke checklist on two navless full-screen routes.
Sending it to `B` would give Lane B **nothing to build** — the cardio-goals half was dropped rather
than deferred — so it would sit there unstartable, which is worse than sitting in `DV`.

**What is true is the constraint the same message supplied**, and it explains the entry better than
the re-lane would: the phone is on **three-button navigation**, where every safe-area inset reports
`0`. A bottom-anchored control clears the bar trivially in that mode and a broken floored utility
passes anyway, so running this now would manufacture a **false VERIFIED** — worse than not running
it. That is already why `RV-37` and `RV-127`'s clearance half were held for sweep 4. `Q-168` belongs
in that group; it was not a fourth kind of thing.

So it is held for sweep 4, not re-laned. **This is a disagreement resolved by a fact the device
agent supplied, not by seniority** — and it is written down because the last one (Q-168 again, this
morning) was left standing and cost a second round.

## Not done

- **No product code**, no device run.
- **`#1465` is still open and still carries value** — the `BF-92`/`BF-24`/`Q-395` re-lanings never
  landed, and `main` has no test pinning `LA-132`'s ENOBUFS fix. Its own `maxBuffer` line is now
  redundant (LA-132 fixed it independently) and its `RV-111` routing is obsolete (see above). It
  needs salvaging, not merging as-is. Separate PR.
- **Sweep 4's list is started, not finished** — `Q-168`, `RV-37` and `RV-127`'s clearance half are
  the gesture-nav group. The rest of the tagging pass is still owed.

## Gate

`pnpm ci:local` — exit 0, **Ran 77 of 77** Custom Rules steps, 812 test files passed.

<a id="2026-09-24-chore-or-141-salvage-1465"></a>

# 2026-09-24 — salvaging #1465: what was still true, and what two sessions found twice

Orchestrator. Docs + one test. Branch `chore/or-141-salvage-1465`.

`#1465` sat open for fourteen hours and `main` overtook most of it. Rather than merge it stale or
close it whole, this carries across the two parts that are still true.

## What was still true

**Three re-lanings that never landed.** `BF-92`, `BF-24` and `Q-395` all still carried
`Gate: device` with their original lanes:

- **`BF-92` → `Lane: O`, `Gate: owner`.** The code half shipped; the check that remains is a
  **deliberate client-side throw in production**, and the device agent's own sweep plan says *"ask
  first — it may page someone"*. Consent is the next act, not the phone.
- **`BF-24` and `Q-395` → `Lane: O`, `Gate: owner`.** Both are artboard parity. Every buildable item
  under them is closed with a reason, so what remains is whether a shipped screen matches a drawing
  — a judgement about whether it looks right, which the phone cannot settle. **`RV-143` had already
  read both as mis-gated rather than device-blocked**, and both sweep plans exclude them for that.

**A regression test with no fix attached.** `LA-132` shipped the `maxBuffer` fix on `showAtBase`;
nothing pinned it. The test is now on `main`, using the real backlog as its witness rather than a
synthetic fixture — what regressed is *the repo's largest tracked doc is readable at base*, not a
buffer size — and asserting the witness exceeds 1 MiB so it cannot quietly stop pinning anything.
Mutation-checked: removing `maxBuffer` fails it with `base read failed: spawnSync git ENOBUFS`.

## What was dropped, and why

**The `maxBuffer` fix itself.** `LA-132` fixed it independently, hours apart, from the other end —
Lane A from the ratchet's wrong line count, this session from the ENOBUFS line in a CI log. Two
sessions diagnosing one defect in a day is the argument for the test, which is the half that did
not exist.

**The `RV-111` → `DV` routing.** Obsolete. Sweep 2 confirmed the defect on the S25, which also
answered the question that routing existed to ask — whether the native barcode activity swallows
back before the JS listener runs. It does not, so `RV-111` is Lane B work and `#1494` removed its
gate.

## The thing worth remembering

**A PR left open across a busy day is not a PR waiting to merge; it is a claim decaying.** Of
`#1465`'s four routings one was wrong within hours, and its headline fix was overtaken by a
concurrent session. Nothing in it was unsound when written. The lesson is not "work faster" — it is
that a long-lived branch needs re-reading against `main` before merge, not just re-merging, because
`git` will happily carry a correct-when-written claim into a tree where it is false.

## Not done

- **`#1465` is still open.** Its content is now here or obsolete, so it should be closed — that
  needs the owner, since closing PRs is confirm-first.
- **No product code**, no device run.

## Gate

`pnpm ci:local` — exit 0, **Ran 77 of 77** Custom Rules steps, 812 test files passed.

<a id="2026-09-24-chore-or-142-review-sweep-3"></a>

# 2026-09-24 — reviewing device sweep 3: the bookkeeping is clean, the filing is not

Orchestrator. Docs-only. Branch `chore/or-142-review-sweep-3`.

The owner asked for a review of the finished device sweep. Sweep 3 (#1491) is the latest; there is
no sweep 4.

## The sweep's own bookkeeping is exact

Every claim was checked against the queue rather than read off the summary:

| claim | result |
|---|---|
| closed: `RV-128` `RV-129` `BF-95` `BF-161` `OR-118` | all five absent from the queue ✓ |
| filed: `DV-16` `DV-17` `DV-18` | all three present, all `Lane: B` ✓ |
| kept: `BF-12` `BF-49` `BF-147` `Q-300` `RV-125` `DV-8` `DV-12` `BF-22` `BF-61` `Q-305` | all ten present ✓ |

Both observations that could have been dropped — `Q-305`'s colour-only rows and `BF-61`'s
swipe-to-Yesterday side effect — are written on their entries. **No orphaned findings.** For a sweep
this size that is a good result, and it is worth saying plainly before the rest.

## What the review found instead: five entries filed as finished while failing

The defect is not in the sweep. It is in what happens to an entry *after* a device check fails.

An entry ships a fix, carries `Keep:`/`Verify: device` meaning *shipped, a look is owed*, the device
runs that look and it **FAILS** — and nothing clears the field. The failure is recorded faithfully in
the text while the entry keeps printing to its lane under **"shipped; only the stated residue is
owed. Not new work."**

| entry | state |
|---|---|
| `BF-61` | failed 2 of 2 in sweep 3; titled *"fixed; device check owed"*; **`BF-94` blocked on it** |
| `BF-139` | shipped 09-12, failed on device 09-13, nothing since, still titled *"fixed"* |
| `BF-96` | same, its batch partner — owner: *"Day is cut off"* |
| `RV-103` | sweep 2 ran the exact check its `Keep:` asked for, and it failed |
| `TN-53` | same — HR recovery still plots 0-value points |

All five are corrected: fields removed, titles fixed, acceptance criteria written. **Lane B's READY
list gained five real defects that were invisible to it.**

**`BF-61` also gained a third acceptance clause.** Sweep 3 found that after the swallowed tap the
next rightward swipe moved Nutrition to **Yesterday**, 2 of 2. It is downstream of the same cause,
so one fix may clear both — but the old acceptance text would have **passed with the day still
jumping**, which is the more alarming half for the user.

**`BF-96` had a second, quieter problem:** three bullets reading `- **Keep — …**` that meant *keep
this knowledge*, not the residue field. The parser read the first as the field. That is `TN-59`'s
class — a prose sentence starting with a field's name.

## Deliberately not built

The durable fix is a check: an entry recording a device failure must not also carry
`Keep:`/`Verify:`. Filed as **`OR-139`** rather than written here, because it needs a baseline —
**`BF-98` is a legitimate counter-example**: it failed on 09-13, was fixed, and sweep 2 **passed** it,
so its later `Verify:` is correct. The text alone cannot order those events, so the check is
shrink-only with `BF-98` baselined. Building that carefully is worth more than building it tonight.

## The handoff warning, which is not ours to remove

The owner asked for the context-pressure warning to be taken out of the repo docs so every agent
stops getting it. **It is not in the repo.** Checked: no `Stop` hook in `.claude/settings.json`, none
in `settings.local.json`, none at user level; the only hooks are the repo's `SessionStart` and a
user-level git check. The phrase *"invoke the handoff skill"* appears in no config — only in an old
folded journal.

It is **Claude Code's own** context warning, printed at ~90% and ~95% of the window, and it cannot be
edited away from here. What *can* be fixed is agents obeying it: CLAUDE.md already says to rely on
automatic compaction, but the harness explicitly instructs a handoff, and an agent will follow the
louder voice. So CLAUDE.md now names the warning and says to ignore it, with the reason — handing off
at 90% throws away a warm cache to solve a problem the tool has already solved.

The window itself is a launch flag, `claude --autocompact <auto|100k–1M>`, set when a session starts.
That is the owner's lever, not a repo setting.

## Not done

- **No product code**, no device run.
- `OR-139`'s check is filed, not built.

## Gate

`pnpm ci:local` — exit 0, **Ran 77 of 77** Custom Rules steps, 812 test files passed.

<a id="2026-09-24-chore-or-143-process-owner-gate-triage"></a>

# 2026-09-24 — the Orchestrator's job is the owner-gated queue

Orchestrator. Docs-only. Branch `chore/or-143-process-owner-gate-triage`.

The owner set the process out explicitly. Recorded here because a role definition that lives only in
a chat is a role definition the next session does not have.

## The process, as he stated it

- **BugFix** is the intake. Reports arrive from him directly, **and it reads the app's feedback
  feature** so a user-reported error lands the same way a spoken one does. It files and lanes them.
- **Review** sweeps on its own, **or commissions a sweep** — handing the device agent a question and
  reading the answer back.
- **Orchestrator** reorganises, cleans and aggregates the backlog. **Its main job is the entries that
  need his input**: work out which genuinely do, put those to him, and **assign to a lane once
  unblocked**.
- **DV, Tuning, Lane A and Lane B** are unchanged.

**One ownership move:** the in-app feedback read shipped as the Orchestrator's in `#1486`. It is
BugFix's now — a report is intake, and intake is BugFix's. The Orchestrator keeps the read as a
backstop for when BugFix is not running rather than as the owner of it.

## First triage pass: 78 entries carry `Gate: owner`

By lane: **65 Lane A, 7 O, 6 B**. Read in one pass; the shape is what matters before the detail.

**Roughly 29 are scoring or calibration** — `expectedRpe`'s dead band, ACWR's windows, the Zone 2
floor, resilience, chronic stress, the Body Battery charge window, 1RM's non-monotonicity. These are
genuinely his by CLAUDE.md's rule, **but they should not reach him as bare gates**: Tuning proposes a
calibration with the number of other days it moves, and he signs off on that. A gate with no proposal
attached is a question he cannot answer.

**Roughly 25 are engineering calls wearing an owner gate** — a missing unique key, a route with no
callers, a dead column, an AI call with no data gate. Those are mine to decide under the standing
narrowing, not his.

**Three are already answered or deferred and should not be re-asked:**
- **`Q-547`** says so in its own field: *"Gate: owner — a READING, not a decision."* It wants a
  Railway CPU/RAM sample during a quiet window, and it feeds `Q-551` rather than asking anything.
- **`BF-106`** is *acknowledged and deferred* by him, 2026-09-15, deliberately still gated because
  `VACUUM FULL` cannot run from the app.
- **`Q-297`**'s first residue is done.

**The rest are genuine product preferences** — sharing meals with a partner, the cat collection's
art, battery chips on Home, an Apple HealthKit connector, the admin surface's unused buttons.

## What goes to him first, and why it is one question

`LB-52` and `Q-297`'s second residue were already batched as **`owner-branch-protection`** (OR-117,
2026-09-16): *"the same settings page … one trip, two toggles. Do not put them to the owner
separately."* That batching was right and this pass did not improve on it — it surfaced it.

It is also the highest-value thing on the list, for a reason this session demonstrated rather than
argued: **auto-merge does not work on this repo**, so every merge is hand-caught against a base that
moves every few minutes. One PR tonight lost **five** merge races; another lost two and had to be
split onto a zero-conflict branch to land at all.

## Not done

- **74 of the 78 are untriaged in detail.** The pass above is a shape, not a verdict on each entry,
  and it is deliberately labelled that way — an estimate of "how many are really his" was wrong by a
  factor of twenty-five earlier in this session, so the number stays a shape until each is read.
- **No product code**, no device run.

## Gate

`pnpm ci:local` — exit 0, **Ran 77 of 77** Custom Rules steps, 814 test files passed.

<a id="2026-09-24-chore-tn-63-duplicate-lane-fields"></a>

# TN-63 — two lane fields under one heading, and the queue routing that ate

**PR:** `chore/tn-63-duplicate-lane-fields` · **Lane:** O · docs + one check, no product code.

## What was wrong

`laneFromLines` (`scripts/lib/lane.js`) is first-match-wins, deliberately — it is what stops an
entry's prose outranking its own tag. The cost is that a re-laning done by *adding* a field, without
removing the old one, is routed by the stale value. Nothing in `next-item.js` output says the entry
was ambiguous.

## Measured, not quoted

TN-63 recorded **34 duplicates, 8 disagreeing** earlier the same day. Re-measured before the sweep:
**28 and 6** — two had resolved in between. The six: `LB-94`, `TN-32`, `BF-111`, `Q-395`, `TN-19`,
`PS-7`.

**`TN-19` was actively misrouted.** Its first field read *"surface only:
components/body-battery-card.tsx"*; its second says the defect is in the model and that the card
**must not be touched for this**. The parser was serving the first. That is the one case where the
later field was the correct one, which is why the entry's own advice — *the later field is usually
the newer intent, but the text is the authority* — was followed by reading all six rather than
applying a rule.

The other five resolved to the earlier field, four of them by CLAUDE.md's path rule (both halves →
Lane A, engine first).

## The 22 that agreed

Left alone they are the fuel: a duplicate is how a disagreeing pair gets made. Swept by keeping the
**first** field and demoting later ones to prose, which is behaviour-neutral by construction —
verified by snapshotting `laneFromLines` for all 480 entries before and after: **0 changed**.

One needed care: `LA-21`'s second lane line also carried `**Branch:**`, so demoting the bullet would
have destroyed another field. Only the `Lane:` fragment was removed.

## The check

`check-backlog-pointers.js` now fails on more than one lane FIELD under a heading. It counts
bullet-anchored lines — the same shape `laneFieldProblem` uses — so a prose mention of the token
does not match. That mattered: the note explaining this trap has to quote it.

**Custom Rules stays at 78.** TN-63 predicted 77 → 78; the check went inside an existing script
rather than becoming a new step, and the job had already reached 78 earlier the same day.

Mutation-checked: adding a second `Lane:` bullet to `LA-21` fails the check and names it; removing
it returns to green.

## Not exercised

Docs and a check only — no product code, no device path, no runtime behaviour.

<a id="2026-09-24-docs-bf-190-walk-autosave-planned-duration"></a>

# BF-190 — a 27-second walk logged as a complete 40-minute session

**Branch:** `docs/bf-190-walk-autosave-planned-duration` · docs-only · BugFix intake

The owner asked why the calories tile on his walk summary read `—`. Tracing it turned up a larger
problem underneath.

**The tile question is unresolved and the entry says so.** The stored row carries **133 kcal**,
derived server-side at insert, so the server half works. But that row was created at 09:59:28
Brisbane and the phone clock in the screenshot reads 9:59 — the shot was taken within about half a
minute of the save, and the tile is designed to start as a dash and fill when the forced pull
returns. A dash at +30 s may be the documented pre-arrival state. BF-107 is reopened with the check
that separates the two cases: re-open the walk from the activity list and see whether the tile fills.

**What the trace found instead.** `activity_logs` holds **two** rows for that walk, both claiming 40
minutes and 133 kcal:

| id | created | start–end | steps | avg HR | kcal |
|---|---|---|---|---|---|
| `b8083d04` | 09:18:27 | 09:18 → 09:58 | — | — | 133 |
| `d0231b08` | 09:59:28 | 09:19 → 09:59 | 3190 | 92 | 133 |

The first was written **27 seconds after its walk started** and claims a 40-minute end time that had
not happened yet. `walk-summary.tsx:130` saves on mount, and the duration and end time it saves come
from `plan.totalSec` — the planned walk, not the clock. So anything that puts the lifter on that
screen early writes a finished session. Calories follow duration (`deriveActivityKcal` uses activity
type and minutes, no HR or steps), which is why both rows read exactly 133.

The day now holds 80 minutes and 266 kcal of treadmill walking against 40 and 133 actually done.

Filed Lane B with the three-line fix (read the clock, not the plan) and a flagged follow-on decision:
whether a sub-minute walk should be saved at all. Recommended a minimum-duration floor matching the
`MIN_SESSION_SEC` pattern `time-audit.ts` already uses for workouts, rather than a confirm dialog.

## Amended after the owner confirmed the trigger

*"I started a walk; then closed it - I guess it didnt fully close it? that should be looked at
too."* So the phantom row came from **End walk**, not a crash — reproducible on demand, and the
defect sits earlier than the mount-save the entry first blamed.

In `walk-active.tsx` the two exits are the same call with the same two arguments. Finishing
naturally at `e >= plan.totalSec` (:142) and confirming **End walk** (:279) both invoke
`onFinishRef.current(samples, cadence)`. `WalkSummary` receives `config`, `samples`, `cadence` and
`startedAtMs` — nothing that says whether the walk ran out or was stopped after 27 seconds. It
cannot tell, so it assumes the plan. The elapsed seconds are in the same component and are dropped
at the boundary.

That makes this an instance of a class CLAUDE.md already names — *"completion callbacks must carry
the written entity"* — and the fix earns that rule another example rather than rediscovering it.

The dialog also already promises what the data does not keep: *"Ending now will stop it early."* The
lifter is told the walk is recorded as stopped early and it is recorded as a full planned session.
Making that sentence true is the acceptance criterion.

The mount-save stays in the entry as the secondary half: with the duration fixed there is still no
beat at which a 27-second walk could be declined, which is why the minimum-duration floor is part of
the fix rather than a nicety.

<a id="2026-09-24-docs-bf-194-owner-questions-need-a-section"></a>

# BF-194 — the owner-question rule failed the same day it was written

**Branch:** `docs/bf-194-owner-questions-need-a-section` · docs-only · BugFix intake

CLAUDE.md gained a rule on 2026-09-24: a question for the owner becomes a `Lane: O` entry and gets
"a queue position near the top". Checked against `main` at `2cda697a`, lane O holds **57 READY
entries and prints 10**, and the three owner questions sit at **15, 16 and 17**.

BF-189 and BF-191 were filed at ranks **1 and 2** the evening before. Fourteen entries went in above
them within about eight hours. No agent did anything wrong — every agent files at the head, because
that is what the convention asks for, so the head is exactly where the churn is.

That makes position the wrong mechanism rather than a mechanism applied badly. Re-ordering buys a
day and asserts this session's priority over four other agents' deliberate ones.

Recommended fix, filed `Lane: O` since the Orchestrator owns the queue: give owner questions their
own section in `next-item.js`, the way `Reference:` already has one at line 290 — printed
unconditionally, outside the `TOP_N` cut. `Reference:` gets that treatment so those entries stay
visible without heading the work list; an owner question wants it for the mirror reason, since it is
not "next", it is blocking.

Three alternatives are recorded with what each is genuinely better at: raising `TOP_N` (trivial, but
a treadmill at 57 entries), a dedicated `Owner:` field (useful if these ever need behaviour beyond
visibility, but a second field is a second thing to get wrong — the `Gate: owner` trap in the same
rule is what that costs), and periodic re-ordering by the Orchestrator (no code, but the manual
version of what a section does for free, and silent when a sweep is skipped).

**Deliberately not done:** the three entries were left at 15–17. The point is to make rank stop
mattering, and promoting my own filings above other agents' would decay anyway.

<a id="2026-09-24-docs-bf-195-low-reception-hangs"></a>

# BF-195 — the app handles offline and hangs on barely-online

**Branch:** `docs/bf-195-low-reception-hangs` · docs-only · BugFix intake

Owner: *"I went to an area with low reception and nothing really worked on the app. It should still
have most functionality."* Five screenshots, all tabs, all showing the offline banner.

**Connectivity is modelled as a boolean and the failing state is a third one.** `useOnlineStatus` is
`navigator.onLine` plus Capacitor's `networkStatusChange.connected`. Both report true whenever the
radio is attached. Low reception is *online with no throughput*, and the app has no state for it —
so the offline branch of `cachedFetchCore`, which explicitly paints saved data, never runs.

**There is no fetch timeout anywhere in the client data layer.** Grepped `lib/sqlite/`,
`lib/hooks/`, `lib/local-store/` for `AbortController` and `AbortSignal.timeout`: zero matches. A
request issued on a dying connection hangs, and nothing converts hanging into a rendered state.

`session-select-content.tsx:1036` gates its skeleton on `refreshing`, which never clears. The
in-flight map compounds it — a second caller joins the hanging request rather than firing its own.

The screenshots split three ways, and the split is the evidence:

| surface | behaviour | why |
|---|---|---|
| Health → Body | **worked** (RHR 55, HRV 54, SpO₂ 93.5) | painted from `readCacheSync` seeds |
| AI Periodization, muscle volume, trends | skeletons forever | gated on a fetch that never settles |
| Workout session list, September calendar | blank | seed empty *and* `refreshing` stuck |

The Body tab working is the important half: the offline-first architecture is sound where it was
applied, and what fails is the layer above it.

Two things the entry insists on. The banner currently reads *"Offline — showing saved data"* over
screens showing none — a false promise regardless of what else is fixed. And **a gym is the
canonical low-reception location for this app**, so the session list is the one screen that must
work on bad signal and the one rendering nothing.

Recommended fix, filed `Lane: A`: a timeout on the fetch in `cachedFetchCore`, so hanging collapses
into the failure path that already exists and handles it correctly. One call site, every screen.
Plus deriving `online` from whether requests complete rather than whether the radio is attached.
Explicitly **not** recommended: adding seeds to the three blank surfaces, which would paper over
three instances and leave the next screen to rediscover the hang.

**Separately observed and deliberately not diagnosed:** the sleep card read "Last: 2026-08-25", a
month stale, on a day production holds sleep through 09-24 — and `sleep-sessions` is warmed at every
app open. A screenshot cannot distinguish a stale cache entry from the card's own fallback, so the
entry says to read the device's cache before folding it into BF-195.

Verification is network throttling, not airplane mode — airplane mode exercises the path that
already works.

<a id="2026-09-24-docs-owner-questions-to-orchestrator"></a>

# A question for the owner is a task, not a chat message

**Branch:** `docs/owner-questions-to-orchestrator` · docs-only

Owner, 2026-09-24: *"Questions that I need to answer should be assigned a task and sent to
Orchestrator to be completed there."*

The channel already existed — `Lane: O` — and the failure was in how it was being used, not in the
mechanism. Three things came out of checking rather than assuming:

**The obvious encoding is the wrong one.** `Gate: owner` reads like the right field and inverts the
instruction: `Gate:` parks an entry in `next-item.js`, so a question gated on the owner drops out of
the Orchestrator's READY list and nobody is tasked with putting it to him. Getting the answer is
itself the work, so it is `Lane: O`, ungated. The rule now says this outright.

**Filed entries were reaching the queue, contrary to a first reading.** BF-188 and BF-189 parse
correctly as `Lane: O` and sit at ranks 15 and 16 of 29 READY — below `TOP_N = 10`, which prints
only the top ten per lane. They were never invisible, and the rule now notes that an owner question
filed at rank 15 is in the queue and in nobody's view, so it belongs near the top.

**Two entries were genuinely mis-routed, and both were mine.**

- **BF-107** was `Lane: B` and was reported back to the owner as *"your five-second check"*. The
  next action — open the walk, does the calories tile fill — is a measurement with an objective
  pass/fail, which §3 assigns to the device agent, not a judgement waiting on him. Re-laned `DV`,
  with the three answers it may return and where each one sends the entry next.
- **BF-190** was `Lane: B` and carried two owner decisions in its body, where the lane field routed
  them to an implementer. Split into **BF-191** (`Lane: O`): whether a sub-minute walk should be
  saved at all once the duration is truthful, and what happens to the phantom row already in the
  history. BF-190 keeps the half that needs no decision and does not wait.

BF-191 carries a caveat worth keeping: only 2026-09-24 was checked for phantom rows. The signature
to sweep for is a row whose `duration_min` equals the plan while `avg_hr` and `steps` are both null.
No count is claimed until that runs.

<a id="2026-09-24-dv16-completed-workout-leave-prompt"></a>

# DV-16 — a finished workout that reopened as an unfinished one

**Branch:** `fix/dv16-completed-workout-leave-prompt` · **Entry:** DV-16 (Device Verification, sweep 3) · **Version:** 1.465.24

## The report

The owner finished Push, restarted the app, and every tab tap from `/workout` raised *"Leave
workout? Your workout is in progress. Leaving now will end the session and unsaved sets will be
lost."* — 2 of 2 on the S25. The Workout card showed COMPLETED at the same time. Answering *Leave*
would have called `resetSession` on a workout that was already saved.

The entry left the cause open, and was right to: it offered two possibilities and marked them
**not established**.

## Cause

Neither guess was right as framed. The in-memory `mode` does not drift from the persisted one by
accident — it is rewritten deliberately:

```ts
if (state.mode === 'exercise-summary' || state.mode === 'done') {
  state.mode = 'pre'   // so DoneScreen cannot replay its confetti on reopen
  state.summaryData = null
}
```

`isWorkoutActive` was `!!workoutStartMs && mode !== 'done'`, so that rewrite removed the only term
saying the workout had finished. `workoutStartMs` survives the reopen — the staleness branch clears
it only past four hours, and `dateRolledOver` is always false in production because
`onRehydrateStorage` passes `today: null` on purpose (Q-477). The card still read COMPLETED because
that comes from `workoutEndMs`, which nothing had touched.

Two pieces, each correct alone: a confetti guard that owns `mode`, and a nav guard that read `mode`
as durable state.

## Fix

`isWorkoutActive` now also requires `!workoutEndMs`. That stamp is the durable fact the transient
mode is not — written once at completion in `workout-screen.tsx`, and nulled by both `startWorkout`
and `resetSession`, so the guard re-arms on Start Again.

A **third term was added rather than either existing one altered**. An existing test pins that
`pre` must never be excluded, because `pre` is also the mid-workout hub; that constraint is intact,
and the test now asserts the two original terms plus the absence of a `mode !== 'pre'` exclusion,
read from comment-stripped source so the new explanatory comment cannot satisfy it.

Both object-literal call sites (`bottom-nav.tsx`, `tab-swipe-navigator.tsx`) now select
`workoutEndMs` too; the rest pass whole store state.

## Verification, and what was not exercised

Four new tests in `lib/stores/__tests__/workout-store.test.ts` drive the real store: the rewrite
still happens, the finished state is no longer active, a mid-workout state still is, and the guard
re-arms after `startWorkout`. **Control-run against the pre-fix predicate — exactly one goes red**,
so the suite discriminates rather than passing either way.

`npx tsc --noEmit` clean · `pnpm lint` 0 errors · `pnpm check:rules` **Ran 77 of 77** · 58 tests
across the four files touching this surface · `pnpm build` succeeded.

**Not exercised:** the reported path itself. It needs the APK, a real completed day and an app
restart, none of which the sandbox has — `/workout` is auth-gated, so a dev-server GET only
redirects to sign-in. DV-16 keeps its device pass test for exactly that reason, and the entry says
so rather than reading as finished.

<a id="2026-09-24-dv17-meal-plan-skeleton"></a>

# DV-17 — a skeleton for an answer the cache already had

**Branch:** `fix/dv17-meal-plan-skeleton-on-warm-visit` · **Entry:** DV-17 (Device Verification, sweep 3) · **Version:** 1.465.25

## The report

A per-frame scan of the active panel over three warm rounds of each tab: Health, More and Home
painted no skeleton in 9 of 9. **Nutrition painted one on every visit, 3 of 3** — a 338×108 pulse at
y=512, from ~85 ms to 392–543 ms after the tap. The owner has no meal plan.

## Where it actually was

The entry pointed at `meal-plan-section.tsx:99`:

```tsx
if (loading && plan == null) return <div className="… animate-pulse" … />
```

That line is correct given its props. The defect is one level up. `nutrition-content.tsx` passed:

```tsx
loading={loading && mealPlan === null}
```

For an account with no plan, **`null` is the settled answer** — the synchronous cache seed at mount
already read `meal-plans`, found `plans: []`, and set `mealPlan` to `null`. That is indistinguishable
from "no answer yet", so every warm visit re-pulsed for as long as the background refetch ran.

This is the second entry in a row whose stated location was downstream of its cause (DV-16's two
candidate causes were both wrong as framed). Reading the code before the entry is paying for itself.

## Fix

`planLoaded` tracks whether the plan has been **answered**, by cache or by network, rather than
whether it happens to be non-null:

- set by the synchronous seed when the cache had an entry — the only thing that runs before first
  paint, so settling it any later cannot prevent a flash that has already happened;
- set by the fetch, but **only on a defined payload**: `cachedFetch` swallows `!res.ok` and calls
  back with `undefined`, and treating that as an answer would replace a skeleton with "Build a meal
  plan" for someone who may well have one.

The presentational guard is untouched and pinned by a test, since it was never the defect.

## Verification

4 tests, control-run against `origin/main`: **3 of 4 go red** without the change. The fourth pins
the component as unchanged and correctly passes either way.

`npx tsc --noEmit` clean · `pnpm lint` 0 errors · `pnpm check:rules` **Ran 77 of 77** · the whole
nutrition suite, **337 tests across 37 files**.

**Not exercised:** the device. DV-17 keeps its pass test — three warm Nutrition visits on an account
with no plan, zero skeleton frames — which needs the APK and a per-frame scan.

## A ceiling reached, and filed rather than absorbed

The six-line fix took `nutrition-content.tsx` from 795 to **exactly the 800-line limit**
`check-component-size` enforces. It passes; the next line anyone adds does not. Extracting a section
of a 795-line screen to make room for six lines would have been a larger and riskier change than the
fix it carried, shipped unreviewed inside a device-reported defect — so the extraction is filed as
**LB-139** instead of improvised here.

<a id="2026-09-24-feat-bf-192-account-deletion"></a>

# BF-192 — account deletion, and the delete path that already throws

**Branch:** `feat/bf-192-account-deletion` · docs-only · BugFix intake

Owner: *"there is no option for users to delete their account and their data. This is a requirement
for apple store so lets add this in next."*

**The one delete path that exists is broken, and it was reproduced rather than inferred.**
`deleteUser` (`adapter.ts:699`) is a bare `DELETE FROM users`, reached only from `/api/admin/users`.
Against the local database with all migrations applied, deleting a user who has created a single
custom exercise fails:

```
ERROR: update or delete on table "users" violates foreign key constraint
       "exercise_library_created_by_fkey" on table "exercise_library"
```

A user-facing button wired to today's code would inherit that and fail in the one flow that must not.

**What a `users` delete reaches.** 99 base tables, 72 with `user_id`. Of the foreign keys pointing at
`users`: **72 CASCADE**, **2 SET NULL** (`ai_call_log`, `error_events` — rows survive anonymised),
**1 NO ACTION** (`exercise_library.created_by` — blocks the delete). The 24 other tables with no such
key are reference/ops data or child tables that cascade through a parent; `db_query_log` is the one
worth attention, since its `sql_text` can carry the user's data in the query body.

**The design point: do not write a new list of tables.** `lib/export/export-map.ts` already
enumerates every table holding the user's data and is exhaustive by construction — each base table is
either `EXPORTED` with a scope or `EXCLUDED` with a reason, and `check-export-coverage.js` fails CI
when a new table is in neither. Its own header records why that matters: the hand-written version
covered **26 of 82 tables and presented as complete** (Q-288). An export that misses tables is bad; a
deletion that misses them is a false compliance claim nothing in the product would reveal.

One semantic inverts. `SOFT_DELETED` exists so an export does not resurrect rows the user deleted —
it filters them out. A deletion must take them. Reusing the map without flipping that predicate is
the most likely way this ships looking complete and is not.

The device half needs nothing new: `signOutAndClearDevice` already disables cache writes, clears the
local store and cache, then signs out, in that order, and `check-sign-out-clears-device.js` enforces
it. Checked because it would be unrecoverable: that wipe does **not** touch the Oura ring's BLE key,
which lives in native SharedPreferences and is reached only by the admin screen's `clearKey()`.

Filed `Lane: A` — it needs a migration (`created_by` → `SET NULL`), and migrations are Lane A's.
Three policy choices went to **BF-193** (`Lane: O`) rather than sitting in the body: what happens to
the two anonymised log tables and `db_query_log`, whether deletion should clear the ring key
(recommended no — wrongly keeping it is a tap, wrongly clearing it is a factory reset), and whether
deletion is immediate or gets a grace period (recommended immediate — this repo has no cron layer).

Two things stated carefully rather than confidently: the store requirement is described without
quoting a guideline number from memory, and **Google Play carries an equivalent requirement**, which
matters because the canonical runtime is the Android APK and there is no iOS build in this repo yet.

<a id="2026-09-24-fix-bf190-bf191-walk-end"></a>

# 2026-09-24 — BF-190 / BF-191: ending a walk early wrote a walk that never happened

**Branch:** `fix/bf190-bf191-walk-end` · **Lane:** B · **Domain:** activity

## What was wrong

A guided walk ended 27 seconds in produced a **40-minute, 133 kcal** row. Measured in production,
and the owner hit it himself: *"I started a walk; then closed it."*

Both exits from `walk-active.tsx` were **byte-for-byte the same two-argument callback**, so
`WalkSummary` could not tell a completed walk from an abandoned one — and assumed the plan. Calories
follow duration alone (`deriveActivityKcal`), so a phantom duration is a phantom calorie count every
time, indistinguishable from a real one in the row.

## Why both entries shipped together

They were one entry, split so the owner's two decisions could be routed to him rather than buried in
a `Lane: B` body. They are one flow, touch the same files, and share one device check. BF-191 alone
would have been close to meaningless: its floor only covers sub-minute walks, so a five-minute early
exit would still have written 40 minutes.

Worth noting the queue had **BF-191 at rank 1 and BF-190 at rank 16** — the UX rule above the
data-corruption fix it sits on top of.

## The fix

- **BF-190.** `onFinish` now carries the elapsed seconds. `durationMin`, `endTime` and
  `avgPaceSecPerKm` derive from the clock; the plan still drives the interval *structure*, which the
  per-segment stats need. `Math.min(elapsed, plan.totalSec)` because the 1 Hz tick can land a second
  past the end.
- **BF-191.** Below `MIN_WALK_SEC` (60s), the **existing** end-walk dialog becomes the discard
  confirm. Implemented literally — a floor *then* a confirm — a mis-tap would raise two dialogs,
  which is the exact objection the confirm-on-exit alternative lost on. `MIN_SESSION_SEC` (120s) is
  the repo's precedent for this shape but is a *workout* floor; two minutes of walking is a real
  walk, so this is its own number.

## The finding neither entry named

`LeaveWalkDialog` has **three** callers. The End-walk button saves; **the back gesture and the tab
bar call `reset()` and keep nothing, at any duration** — so leaving a 39-minute walk by tapping
another tab discards it. All three showed the same sentence, *"Ending now will stop it early"*,
which was false at every one of them.

The copy is now honest per call site (`outcome` is a required prop, so a fourth caller cannot
inherit whichever sentence was the default). **Making those two paths save is a behaviour change the
owner has not been asked about**, so it is filed as **LB-141** with the recommendation and two
alternatives, not decided here.

## Verification

- `components/guided-walk/__tests__/bf190-bf191-walk-end.test.ts` — 9 tests. **Control-run against
  `origin/main`: 7 of 9 red.** One asserts there is exactly *one* dialog in the component, which is
  the two-prompt regression specifically.
- `components/guided-walk` + `components/__tests__`: 15 files, **100 tests** green.
- `pnpm check:rules` **Ran 78 of 78** · `tsc --noEmit` clean · lint clean.

**Not exercised, and this one matters: the write itself.** The row is written through the local
store, and `getLocalStore` returns null in the sandbox — so the branch that would have produced the
phantom row is precisely the one no browser here can reach. These are source assertions, and the
device check is owed under BF-191's `Keep ②`.

**Not done:** the three phantom rows already in the history. The owner soft-deletes them from the
activity list so a `deleted_at` tombstone propagates; that is BF-191's `Keep ①`, which also records
that the signature for finding others is `created_at` more than 2 minutes before `end_time`, not the
null-HR one originally proposed.

<a id="2026-09-24-fix-lb-108-e2e-skips-client-lib"></a>

# LB-108 — E2E reported green without running, and a prefix list could not fix it

**PR:** `fix/lb-108-e2e-skips-client-lib` · **Lane:** O · CI workflow + one script. No product code.

## The defect

The E2E job always runs and always reports, skipping its expensive half when a PR cannot change what
Playwright sees — LA-22's design, refined by LA-63 which dropped `app/api/**`. Both are sound. The
prefix list simply never grew a `lib/` clause, because `lib/` was not browser-reached when it was
written.

PR #1173 changed `lib/resume-repaint.ts` and `lib/hooks/use-resume-repaint.ts`. **E2E went green in
40 seconds on a ~28-minute suite**; the job log is Postgres starting and stopping, with no Playwright
invocation at all.

## Why the entry's own recommendation was not enough

LB-108 recommended adding `lib/hooks/`, `lib/stores/` and `lib/media/` to the match. Measured before
building it:

- **28** files under `lib/` carry `'use client'` — the entry said 26.
- **`lib/media/` contains none of them.**
- Following imports from those roots, **81 of `lib/`'s 282 source files are client-reachable** and
  201 are not.
- The reachable set includes **`lib/sqlite/cache.ts`**, which every screen reads through, and
  **`lib/resume-repaint.ts`** — one of the two files in the PR that exposed this, and the one a
  subtree list still misses.

So a longer prefix list leaves the hole open, and matching all of `lib/` buys the full suite for 201
engine files and undoes LA-63. Neither is the fix.

## What shipped

**`scripts/e2e-ui-touched.js`** computes reachability instead of listing it: roots are the
`'use client'` files, and the walk follows their relative and `@/lib/…` imports. `app/api/**` and
`__tests__/` stay excluded, so an engine change still skips the browser. The workflow step is now one
line that pipes the changed files through it.

The set maintains itself, which is the point — the list drifted unnoticed for months and nothing
said so.

## Known floor, stated rather than papered over

Only static `from '…'` imports are followed. A dynamic `import()` built from a variable, or a module
reached solely via `require`, is not seen. Rare here, and the failure direction is the bad one, so a
new client entry point is worth a look at this file.

## Verification

13 unit tests: the LB-108 case, the cache path, an API route skipping, a vitest file skipping, an
engine module skipping, and three against the real tree (the adapter is *not* reachable;
`resume-repaint` *is*).

Direct runs: `lib/resume-repaint.ts` → `true`, `lib/sqlite/cache.ts` → `true`,
`lib/data/postgres/adapter.ts` → `false`.

`node` is preinstalled on `ubuntu-latest` and the script has no dependencies, so it runs before
`setup-node` as the step order requires. `grep` exiting 1 on no match is handled rather than thrown.

**Not verified here, and it is the entry's own warning:** the real proof is a job DURATION. This
cannot be confirmed by reading the workflow diff — the next PR touching only a client `lib/` file
should take minutes, not 40 seconds.

## Not exercised

CI config and a script. No product code, no device path.

<a id="2026-09-24-fix-rv121-collection-more-row"></a>

# 2026-09-24 — RV-121: `/collection` gets a permanent address

**Branch:** `fix/rv121-collection-more-row` · **Lane:** B (Implementation) · **Domain:** app-shell

## What shipped

One `MoreRow` in `components/more/profile-tab.tsx`, under **Your setup**, pointing at `/collection`.

Before this the route had **exactly one door**: a link inside `home-card-widget.tsx`'s
`case 'card_collectionWidget'`, which returns `null` unless that widget is enabled — and
`DEFAULT_CARD_WIDGETS` is `[]`. On a fresh install the screen existed and nothing could reach it.

## The decision was the owner's, and he took the recommendation

Two ways to fix it, and they are not equivalent: a More-tab row, or turning the Home card on by
default. The second changes what Home shows on every install, which is the owner-gated class. He
chose the row and **`DEFAULT_CARD_WIDGETS` stays empty**, so Home is untouched.

**Why "Your setup" despite the label.** BF-82 collapsed seven one-row groups into two, and the split
it chose is *your stuff / the app*. A third heading would re-create the defect it removed, and the
collection is his rather than configuration — so it goes in the "yours" half even though that half
is labelled for setup. Renaming the group is an information-architecture change nobody asked for.

## Verification

- `components/more/__tests__/rv121-collection-is-reachable.test.ts` — 4 tests. **The rule it pins is
  "more than one door, and one of them is unconditional", not the row itself**: a test asserting the
  literal row would pass if someone moved it back inside another preference-gated branch. It also
  guards the other half of the owner's decision — that `DEFAULT_CARD_WIDGETS` is still empty — since
  that is what a later "improvement" would undo.
- **Control-run against `origin/main`: 2 of the 4 red**, the two that matter. The other two are the
  guard-on-the-guard and the Home-unchanged assertion, both correctly true either way.
- `e2e/rv121-collection-reachable.spec.ts` — a real browser at 412 px: the row renders on the seeded
  account with no preference set, and tapping it lands on the collection screen. **This is why there
  are two tests rather than one** — the E2E job is advisory in CI, so the vitest file is the half
  that actually gates.
- `pnpm check:rules` · `tsc --noEmit` clean · lint clean.

**Not exercised:** the APK. WebView-only change (no `android/**`, no plugin), so it arrives by
Railway deploy, but Samsung WebView rendering and safe-area are untested here.

## Also

`DV-7`'s falsifiable claim cited RV-121's two instances as live examples; both have now shipped, so
that citation is amended rather than left to send the device agent looking for fixed bugs.

## Next

Lane B's queue head is BF-191, then RV-171 — the latter is worth reading first: a failed request
while the meal-plan setup opens silently deletes every saved dietary restriction.

<a id="2026-09-24-fix-rv121-readiness-label-collision"></a>

# 2026-09-24 — RV-121: the `moodWidget` pickers named the readiness score

**Branch:** `fix/rv121-readiness-label-collision` · **Lane:** B (Implementation) · **Domain:** app-shell

## What shipped

Three affordances that *select* the morning check-in card labelled it **"Readiness"**:

| Site | Was | Now |
|---|---|---|
| `components/more/home-widgets-section.tsx:52` | `label: "Readiness"` | `"Exercise Readiness"` |
| `components/home/home-card-widget.tsx:213` | `label="Readiness card"` | `"Exercise Readiness card"` |
| `app/session-select/session-select-content.tsx:1329` | `card_moodWidget: 'Readiness'` | `'Exercise Readiness'` |

`oura-score-chip-row.tsx:427` labels the **computed readiness score** "Readiness", and it renders
on the same screen. The card itself already said "Exercise Readiness"
(`readiness-checkin-card.tsx:35`) — only the pickers disagreed with it. So the owner chose between
two different numbers under one name, and the wrong pick is silent.

**The entry named one site; there are three.** That is the whole of the difference between reading
the entry and reading the code, and it is why the test asserts the *agreement* between the card's
own heading and its three pickers rather than a literal string: rename the card and the test still
holds.

## RV-121's other half went to the owner

The entry also found that `/collection` is reached from **exactly one** place in the app
(`home-card-widget.tsx:330`, inside `case 'card_collectionWidget'`, which returns `null` unless the
widget is on) while `DEFAULT_CARD_WIDGETS` is `[]`. That is not Lane B's to decide — the two ways to
fix it are a More-tab row or turning a Home card on by default, and the second changes what Home
shows, which is the owner-gated mockup class.

So **RV-121 stays alive as a `Lane: O` question at position 4**, ungated, re-scoped to that half
alone, carrying the recommendation (a More row, leave the defaults empty), both alternatives with
what each is better at, and the reversal cost (near zero either way). Ungated deliberately: a
`Gate: owner` would park it out of the Orchestrator's own READY list, which is how a question stops
being asked.

**One nuance worth keeping:** all ten card widgets are off by default and the card's docstring says
so on purpose. Collection is only distinctive because it is the sole route to a *whole screen*; the
other nine summarise data reachable elsewhere.

## Verification

- `components/home/__tests__/rv121-readiness-label-collision.test.ts` — 7 tests, green.
- **Control-run against `origin/main`: 6 of the 7 go red.** The seventh is the guard-on-the-guard
  that reads the two anchor names off source, and it should pass either way.
- `pnpm check:rules` **Ran 77 of 77** · `tsc --noEmit` clean · lint clean.

**Not exercised:** nothing was rendered. This is three string literals and a source-assertion test,
so there is no browser or device check here at all — and none is owed, because the strings appear in
the picker rows verbatim. Samsung WebView rendering, safe-area, native SQLite and drifted production
data all untested, as for any change of this shape.

## Next

Lane B's queue head is now **RV-164**, then RV-166, RV-167, RV-111 (its Lane B half shipped in
#1520; what remains is the device re-check), then RV-122.

<a id="2026-09-24-fix-rv164-apply-checks-its-writes"></a>

# 2026-09-24 — RV-164: "Apply Selected" never read a single write's response

**Branch:** `fix/rv164-apply-checks-its-writes` · **Lane:** B (Implementation) · **Domain:** nutrition, app-shell

## What was wrong

`components/profile/goal-recommendation-sheet.tsx` `await`ed three mutations and read none of them:

| Write | Before | After |
|---|---|---|
| `PATCH /api/user/goals` | response discarded | checked; seeds written only on success |
| `PUT /api/nutrition/targets` | response discarded | checked |
| `PATCH /api/user/profile` | `res.ok` checked, failure silent | checked; reports "Activity Level" |
| `PATCH /api/nutrition-goals/<id>` → `applied` | unconditional | only when nothing failed |

Only a *thrown* network error reached the failure toast, so a 4xx or 5xx passed as success. The
recommendation then recorded `applied` — permanently, because the route accepts `applied` or
`dismissed` and nothing between.

Review sweep 57 found it in production: the 2026-09-14 recommendation is `status='applied'` while
`nutrition_targets` still holds the 2026-08-31 values.

**A second, quieter half.** The three `localStorage` seeds were written whatever the PATCH answered.
A refused goals write therefore left the home widgets — which read those seeds synchronously —
showing a value the server had rejected, until the next read corrected them. They are now inside the
success branch.

**And the sibling in the same file.** `handleDismiss` had the identical shape: it closed the sheet on
an unread response, so a refused dismiss left the recommendation pending and the sheet gone, and it
returned on the next read looking untouched. Fixed in the same PR per the sibling-surface rule.

## Partial applies stay pending, deliberately

There is no "partly applied" status, so the choice is between recording `applied` for a half-landed
apply and leaving it pending. Pending wins: the recommendation stays retryable and the queue's view
of it matches the database. The sheet stays open with the toggles as they were, so retrying is one
tap, and the toast names the metrics that did not land.

Calories is stored by *two* routes (`user.calorie_goal` and `nutrition_targets`), so it is deduped —
it is one metric to the reader even when both writes fail.

## Verification

- `e2e/rv164-apply-checks-its-writes.spec.ts` — a real browser at 412 px, everything stubbed so it
  touches no shared seeded row. Forces a 500 from `/api/nutrition/targets` with the goals write
  succeeding, which is the partial-apply case the old code recorded as a clean success.
- **Control-run against `main`'s component: red**, and then measured rather than inferred. With the
  same 500, `main` toasts *"Goals updated"*, closes the sheet, and sends `{"status":"applied"}`.
  That is the production defect reproduced in a browser.
- `pnpm check:rules` **Ran 78 of 78** · `tsc --noEmit` clean · lint clean · `components/profile`
  3 files, 27 tests green.

**Not exercised:** the APK. This is a WebView-only change (no `android/**`, no Capacitor plugin), so
it reaches the device through a normal Railway deploy, but Samsung WebView rendering, safe-area and
drifted production data are untested here. The failure path itself is now covered in Chromium, which
is where it could be driven.

**Deliberately not done:** the 2026-09-14 row is not repaired. Whether the owner meant to apply
1,618 kcal is his question and stays in the queue under RV-161; this fixes the cause going forward.

## Next

Lane B's queue head is RV-166, then RV-167, RV-122.

<a id="2026-09-24-lane-a-dv14-remeasure"></a>

# 2026-09-24 — DV-14 recurred, and it makes DV-13's answer uncertain

**Branch:** `lane-a/dv14-remeasure` · **Lane A** · docs only. Nothing here is fixable from a
container — see Blocked.

## The measurement

| | |
|---|---|
| live `/api/version` | **1.465.17** |
| `main`'s `package.json` | **1.465.22** |
| when 1.465.17 landed | **#1473, 20:36 AEST 09-23** |
| stall so far | **~10 hours** |

Five merges are unshipped: #1474 (post-push guard), #1477 (nutrition chunk nesting), #1478 (route
animations), #1479 (More sub-tabs crossfade), #1481 (Home's APK banner). Every one is user-visible.

DV-14 was filed at 20:25 AEST against a two-hour stall and updated twenty minutes later to say
production had **caught up by itself**. It had — and then stalled again, for five times as long.
Its own note is the one that held: *something that stopped is not something that was fixed.*

## Why the shape matters

It is not one stuck deploy. Stall → catch-up → stall means something is batching, throttling, or
succeeding intermittently. A deploy that simply failed would stay failed, and a disabled one would
never have produced the 20:27 catch-up.

## This corrects DV-13, which was mine

DV-13's conclusion — written earlier today — was that the 8-minute outage at 20:04 came from the
production deploy triggered by the 20:03 merge, 70 seconds earlier. **That reasoning assumed a merge
deploys promptly.** DV-14 measured that it did not: at 20:22 production was still serving
**1.465.10** while `main` was at **1.465.16**, so #1468 had almost certainly not deployed by 20:04.

What survives: the outage is still deploy-shaped — a database-free route unreachable for minutes and
then instantly healthy is a container being replaced, and the only two errors in the window are
connection-acquisition failures at the moment of recovery. What does not survive: **which** deploy,
and the 70-second correlation that made it feel settled. A batched catch-up of several queued merges
fits the same evidence.

The merge-cadence conclusion is unaffected — several merges in a few minutes is several restarts
whenever they land — so the advice stands while the attribution behind it does not. Corrected on
DV-13, on DV-14, and in the `projectOverview.md` row the owner reads.

**This is the second time today I stated a cause more confidently than the evidence carried**, the
first being LA-130's "one unshallow immunises the clone", measured on clones that never ran the gate
that was actually causing it. Both had a correlation and a plausible mechanism and no test that
would have failed if they were wrong.

## Blocked

**Railway's deploy log for `main` from 18:16 is the first step and is not reachable from here** —
no Railway API or CLI in the sandbox. Nobody in a container can take DV-14 further; it needs the
owner or the device agent's machine. Everything else in the entry is downstream of that read.

## Not done

- **No fix, and none is available from here.** The entry's own lane note says this is Railway's
  deploy for `main`, not application code.
- **Failure surfaces not exercised:** the device. `/api/version` was read from the sandbox only, so
  what the APK reports after a restart is unconfirmed — and that is exactly the check DV-14's pass
  test needs.

<a id="2026-09-24-lane-a-dv15-stale-pull-resurrection"></a>

# 2026-09-24 — DV-15: a stale pull could undo a delete, on nine arms

**Branch:** `lane-a/dv15-stale-pull-resurrection` · **Lane A** · `lib/local-store/sqlite-backend.ts`
and one new test. No migration, no schema change, no client change. **DV-15 stays queued** for its
device pass test.

## The entry's suspected shape was exactly right

That is worth saying plainly, because it has been rare. DV-15 wrote:

> *a pull that fetched the pre-delete row, applied after the push confirmed the delete and flipped
> the row to `synced` — so the `sync_status === 'synced'` gate let it overwrite. Needs one
> reproduction with the pull/push ordering captured.*

Every clause of that holds, and the reproduction confirms it rather than amending it.

## Reproduced deterministically, against real SQLite

`markFoodLogSynced` is `UPDATE food_logs SET sync_status='synced' WHERE id=?` — it flips the
tombstone and **keeps the row**. That is what opens the window: the clobber guard is now satisfied.
Then a pull fetched before the server delete lands, takes the else-branch, and its
`deleted_at=excluded.deleted_at` writes NULL over the tombstone.

```
after push confirm: { deleted_at: '…10:30:55.419Z', sync_status: 'synced' }
after stale pull:   { deleted_at: null, sync_status: 'synced', updated_at: '…10:30:45.000Z' }
>>> RESURRECTED — the deleted food is back, and marked synced
```

The device reading was `deleted_at NULL`, `sync_status 'synced'`. Identical. Note `updated_at` also
rolls **backwards** — the pre-delete value overwrites the delete's.

Because the row is `synced`, nothing will ever push it again; it stays until some later pull happens
to carry the tombstone past the cursor.

## The fix, and the fix that was rejected

One clause: **`AND <table>.deleted_at IS NULL`**.

A timestamp comparison (`excluded.updated_at > <table>.updated_at`) would also close it and is
deliberately not used. The local tombstone's `updated_at` is **device**-set; the incoming row's is
**server**-set. Clock skew would decide whether a delete survives. *We hold a tombstone, so a row
without one is stale* needs no clock at all.

## The sibling sweep, classified rather than guessed

Nine arms write `deleted_at=excluded.deleted_at` and so can clear a tombstone — `body_metrics`,
`mood_logs`, `fitness_tests`, `prescribed_runs`, `food_logs`, `supplements`, `supplement_logs`,
`injuries`, `day_checkins`. All nine now carry the clause.

Four other delete-bearing arms — `workout_sessions`, `exercise_logs`, `set_logs`, `activity_logs` —
**never SET `deleted_at` in their update arm**, so a tombstone they hold already survives a stale
pull. Left alone, and the test says why so nobody "finishes the job" later.

## The test drives the real statement

`dv15-stale-pull-cannot-resurrect.test.ts` extracts the upsert **out of `sqlite-backend.ts` at test
time** and runs it against `node:sqlite`. It cannot drift from the implementation and cannot pass
against a copy that has since been edited — which is the failure mode of the source-scanning
siblings in this directory (they exist because `getLocalStore` returns null in node; the SQL does
not need the native layer).

It also pins the two things the guard must not cost: an ordinary pull still updates a live row, and
a `pending` local edit is still protected by the original half of the guard.

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | `food_logs` guard removed (the defect restored) | killed — 2 tests |
| 2 | guard REPLACES the `sync_status` half instead of adding to it | killed — 2 tests |
| 3 | one sibling (`injuries`) loses its guard | killed — the sweep |
| C | the two conditions written in the opposite order | **survived**, after a fix |

**The control failed first time — the fourth time today.** The sweep assertion pinned the exact
string `WHERE t.sync_status='synced' AND t.deleted_at IS NULL`, so an ANDed reorder that changes
nothing broke it. It now checks the clause contains both conditions, in either order. Four for four
on this mistake (TN-60, RV-82, DV-13, here) is a habit, not a slip: the assertion gets written by
copying the line just added instead of stating the rule it is meant to hold.

## One window left open, deliberately

The guard protects a tombstone the device **still holds**. If a server tombstone delta has already
hard-DELETEd the local row and a stale pull arrives after that, the INSERT re-creates it with
nothing to guard against. Narrower — it needs those two in that order — but real, and recorded on
the entry. Closing it wants a local tombstone that outlives the row, which is a schema change and
its own item.

## Failure surfaces not exercised

**The device, which is where this was found.** The reproduction is of the SQL, not of the timing
between phone and server, so DV-15's pass test — log and delete a food five times in quick
succession — is still owed and the entry keeps it.

<a id="2026-09-24-lane-a-dv18-private-media-optimizer"></a>

# DV-18 — private media cannot go through Next's image optimizer

**Branch:** `lane-a/dv18-reference-figure-content-type` · **Lane A** · 2026-09-24

The device reported one broken admin image. It was six call sites, and the cause was not the one
that was filed.

## The filed mechanism was wrong

DV-18 diagnosed a HEIC or JPEG stored under the `.png` key with a hard-coded `image/png`, served as
PNG, undecodable. It flagged itself *"high confidence, NOT proven"* and said settling it needed
production storage the sandbox cannot reach.

It needed no storage. Measured against `pnpm dev`:

```
GET /exercise-media/reference-figure.png              -> 307 /sign-in
GET /_next/image?url=%2Fexercise-media%2F…&w=96&q=75  -> 400 "isn't a valid image"
```

`middleware.ts` gates every non-`/api` path on a session. Next's image optimizer fetches its source
**server-side, without the viewer's cookie** — so it is redirected to the sign-in page, receives
HTML where an image should be, and answers 400. The browser draws the broken-image icon and the alt
text, which is exactly what the device saw. It fails before storage is consulted, so what is stored
under the key never mattered.

The device supplied the half a dev server cannot: the admin page itself rendered, so the browser
*did* have a session, and the image still failed. That is only possible if the optimizer's own
fetch lacks the cookie.

## It was never one image

Six `<Image>` call sites carried `unoptimized={src.endsWith('.gif')}`. GIFs were excluded because
the optimizer serves a still frame of an animation — so GIFs worked **by accident** and every other
private-media URL broke.

That matters because `mediaKey` writes start/end frames as `.png`, and
`exercise-media-panel.tsx` falls back to the still frame when an exercise has no animation
(`media.gifUrl ?? media.imageUrl`). So this was user-facing in the workout screen, not an admin-only
cosmetic defect. The comment already sitting on that call site — *"Mandatory on a GIF, and silent
when forgotten"* — had the right instinct about silence and the wrong scope.

`mustBypassImageOptimizer` in `packages/shared/src/media/private-media.ts` now answers it once, for
both reasons, at all six sites.

## The content-type half shipped too, as what it actually is

The upload really did store every file as `image/png` whatever the bytes were. That is a latent
defect regardless, so it is fixed: `sniffImageMime` reads the magic bytes, the route rejects what it
cannot serve rather than transcoding, and the proxy serves the **stored** Content-Type with the
extension guess kept only as a fallback for objects written before anything set one.

`ALLOWED_IMAGE_MIME` and `isAllowedImageMime` already existed in `request-guards.ts` with **zero
callers anywhere**. The sniffer is tied to that list rather than to three string literals, so it
finally has a reader and the two cannot drift apart.

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | revert to the old gif-only rule | killed |
| 2 | WebP accepts any RIFF container | killed |
| 3 | PNG length guard `>= 8` → `>= 4` | survived — **equivalent**, see below |
| C | `startsWith` written as `indexOf(…) === 0` | survived (intended control) |

Mutation 3 is not a test gap. The `at()` helper compares `bytes[i + k]` against the wanted byte, and
past the end of the array that is `undefined`, which never matches — so the explicit length guards
are redundant with the signature check itself. The suite demonstrated this rather than my asserting
it: the `PNG.slice(0, 7) → null` case still passed under the mutation, because the behaviour genuinely
did not change. The guards stay as a statement of intent; they are not load-bearing.

## One test fixture was wrong and had been passing

`admin-media-tool-routes.test.ts` uploaded `[137, 80, 78, 71]` and asserted a PNG was stored. Four
bytes is the front of a PNG signature, not a PNG signature — it passed only because the route
declared the type instead of reading it. Corrected to the full eight, with a JPEG-named-`.png` case
and a HEIC rejection beside it.

## Failure surfaces not exercised

**No device**, which is the whole of what DV-18 still owes. **No production storage**: the upload
and proxy paths could not be driven end to end here, because S3 is unreachable from the sandbox
(`SignatureDoesNotMatch`), so the server half rests on unit tests and on the route reading the bytes
it is given. The optimizer half is measured, not inferred.

<a id="2026-09-24-lane-a-la135-calibration-names-its-models"></a>

# LA-135 — the calibration panel now names the models behind its number

**Branch:** `lane-a/la135-calibration-model-mixing` · **Lane A** · 2026-09-24

`/api/admin/battery-recovery-calibration` correlates each day's end-of-day Body Battery against the
recovery rating the owner gave that morning. It reads `body_battery_daily` over a window of up to
180 days and never looked at which model produced those values.

`model_version` has been written on every row since the table existed and read by **nothing** —
grepped for a version literal, a `startsWith`, an equality: none. The column exists to stop tuning
analysis mixing data from different constant sets, and it was not stopping it.

Measured in production 2026-09-24:

| model | days | mean end | days at 0 | last |
|---|---:|---:|---:|---|
| v1 | 16 | 66.3 | 0 | 2026-07-15 |
| v2 | 1 | 21.0 | 0 | 2026-07-16 |
| v4 | 18 | 62.9 | 0 | 2026-08-03 |
| v5 | 52 | 15.2 | **27** | 2026-09-24 |

The **v4 → v5** boundary moves the mean end-of-day value from 62.9 to 15.2, and a 180-day window has
spanned it since early August. CLAUDE.md names a correlation across a model change as not evidence.

## What shipped, and what was deliberately not done

**The window is not narrowed.** Filtering to the newest generation would answer a narrower question
than the caller asked and give no sign of it — a 90-day request returning a figure computed over a
handful of rows. That is the failure one level quieter, and the entry forbade it in advance.

Instead the payload gains three fields, all additive (the consumer is a generic card taking an
`endpoint` prop, so nothing breaks):

- `models` — the per-generation day census, most days first.
- `spansModelChange` — whether the window crosses a boundary at all.
- `byModel` — when it does, a full calibration per generation, each over only its own days.

So there is always a figure that means something, sitting next to the evidence for whether the
headline one does.

`modelGeneration` compares **only the prefix**, not the whole version string. The interpolated
constants change on every tuning pass — TN-55 changed three of them inside v6's string — so
comparing whole versions would split one generation into a bucket per tuning and report a model
change where the model's shape never moved.

A row with no stored version buckets as `unknown` rather than being dropped. An unexplained day is
what a census is for.

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | compare the whole version, not the prefix | killed (10) |
| 2 | headline narrowed to the newest generation — the quiet truncation | killed |
| 3 | a missing version folds into another bucket | killed (2) |
| C | the census built with `reduce` instead of a loop | survived (correct) |

Mutation 2 is the one this entry exists for: it implements the plausible-looking fix the entry ruled
out, and the suite rejects it.

## An entry of mine that was wrong, corrected before it was built

LA-135's first version said the mixing began with v6 shipping that morning — *"rows before today are
`v5:`, rows from today are `v6:`"*. The census above shows four generations already stored. That was
corrected in `#1539` before this implementation, which is the only reason this PR measures the real
boundary rather than the imagined one.

## Failure surfaces not exercised

No device, no production write. The calibration builder is a stand-in in the route test — what is
asserted is which rows reach it and what the route says about them, not the statistics themselves.
The panel was not driven in a browser; it is admin-only and the change is additive to its payload.

<a id="2026-09-24-lane-a-lb137-retire-weekly-volume-route"></a>

# 2026-09-24 — LB-137: retire the route, keep the computation

**Branch:** `lane-a/lb137-weekly-volume-target` · **Lane A** · one route deleted, two invalidations
dropped, two test files updated. No migration, no client change.

## Every claim held

| claim | checked |
|---|---|
| `AiWeeklyVolumeCard` deleted by RV-120 | **0** references anywhere |
| `weekly-volume-target` has no reader | referenced only by the two `invalidateCache` calls and their tests |
| `/api/ai-periodization/weekly-volume` has no caller | referenced only by its own test file |
| `getWeeklySetsByMuscleGroup` is still live | yes, via `signals.ts` |

## The decision the entry left open

It offered two endings — *"keep the route as a debug surface and drop just the two invalidations, or
retire route + key + tests together"* — and left the choice to whoever took it.

**Retired.** The deciding detail is that this is **not a debug surface**: the route is
`auth()`-gated for any signed-in user, not admin-gated, so it is an ordinary product endpoint that
nothing calls. "Keep it for debugging" is the reasoning that accumulates dead routes, and it is
weakest where the thing kept is reachable by users rather than by an operator.

Nothing analytic is lost — `getWeeklySetsByMuscleGroup` still grades a week for the AI engine
through `signals.ts`. What went is 46 lines of HTTP in front of it. Reversal is `git revert`, and
the repository method it called is untouched.

## The absence is asserted, not just deleted

Removing a key from three expectation lists leaves nothing saying it must stay gone, and the cheap
way for it to come back is someone re-adding it beside its neighbours. So the test walks **every**
group that could plausibly clear it and asserts none does:

```ts
for (const run of [invalidateProgramStructure, invalidateAiPeriodization,
                   () => invalidatePrescriptionChanged('sess-1'), invalidateWorkoutSummaries]) { … }
```

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | the key returns to `invalidateAiPeriodization` | killed |
| 2 | the key returns to the workout-summaries list | killed |
| C | the single call rewritten as a one-element `Promise.all` | **survived** (correct) |

## Also corrected

`getWeeklySetsByMuscleGroup`'s doc comment named *"its two callers"* and listed the route. Left
alone it would have been a pointer to a file that no longer exists — the kind of stale comment that
sends the next reader looking for a caller that was deleted a month earlier.

## Failure surfaces not exercised

No device, no production. The route was deleted rather than exercised; what is verified is that
nothing referenced it, which is the claim that matters for a deletion.

<a id="2026-09-24-lane-a-or137-reverified-not-built"></a>

# 2026-09-24 — OR-137: re-measured, still premature, not built

**Branch:** `lane-a/or137-reverify-defer` · **Lane A** · docs only. **The entry stays queued**, one
position lower and carrying the measurement.

## Why nothing was built

OR-137 reached the top of the startable list and asks for an admin route that returns one feedback
screenshot by id — the `claude_ro` view withholds the bytes on purpose, so a triaging agent sees
*"screenshot, 240 KB"* and nothing else.

**Its own last bullet defers it**, and the deferral is the kind that expires with usage rather than
with time, so it needed re-measuring rather than re-reading:

| | filed 2026-09-23 | measured 2026-09-24 |
|---|---|---|
| `feedback_submissions.n_tup_ins` (lifetime inserts) | 1 | **1** |
| `n_live_tup` | 1 | **1** |
| the owner's reports (`claude_ro`) | 0 | **0** |
| of those, with a screenshot | 0 | **0** |

Unchanged. The feature this would serve has produced **one submission in its lifetime and none of
the owner's**, so the route would be built against no example of the thing it fetches — and its
shape (what to return, how to frame it for triage) is exactly what one real report would settle.

## What shipped instead

The entry moved below the startable defects, with the measurement recorded. It reached position 3
only because everything above it shipped — the queue working correctly, not a signal to start.

Two design constraints from the entry are restated on it, because they are the easy things to lose
when it is finally built: **the bytes must not enter the `claude_ro` view** (500 KB dragged into
every `SELECT *` on that table makes ordinary triage unusable), and **the route must scope on
`current_setting('app.claude_ro_owner', …)`** exactly as the view does, or it becomes a way to read
another user's attachment.

## One thing that changed under it today

**OR-138 shipped the ability to pivot `app.claude_ro_owner` per request** (PR #1499, awaiting the
owner). That changes what *"scope it the way the view does"* has to mean here: the setting is no
longer a fixed property of the role for the life of a connection. Noted on the entry so whoever
builds this checks OR-138 first rather than writing the scoping against a world that has moved.

## Not done

- **No route, no code.** Building it now would be guessing at a shape one real report would fix.
- **Failure surfaces not exercised:** none apply — nothing executable changed.

<a id="2026-09-24-lane-a-rv163-one-night-per-date"></a>

# RV-163 — one date, two nights, four rules for picking between them

**Branch:** `lane-a/rv163-one-night-selection` · **Lane A** · 2026-09-24

`ALWAYS_NIGHT_MIN_HOURS` promotes any sleep window over four hours to "night" wherever it sat on the
clock, so one wake date can carry two night periods. `nightSessions` returns both, and every caller
then broke the tie itself — by four different rules.

Production, 2026-09-23: an overnight of 21:27–06:01 (7.92 h, efficiency 92) and a daytime window of
10:42–17:25 (6.17 h, efficiency 91). The stored sleep contributors matched the **daytime** one, so
the sleep score was **42** against about 76, and readiness took that 42 as the previous night and
came out **44**. Body Battery anchored its wake at 17:25 and stored **2** HR samples against the
ring's 203 — which is the unidentified trigger TN-20 was left holding, and the anomaly Review sweep
56 flagged on LA-134 this morning.

**This class has shipped twice.** `nightPeriodsByDate` exists because the BLE rollup kept its own
last-wins copy of the rule (PS-17), which on 2026-08-27 let a 4.75 h daytime window replace a 7.42 h
night in `oura_daily_summary`.

## What was actually there

The entry named four consumers. There were **five**, and one it named is not a consumer at all:

| site | rule | in the entry? |
|---|---|---|
| `readiness-payload.ts:360` | latest | yes |
| `body-battery/route.ts:180` | latest-for-date | yes |
| `score-audit/sleep.ts:45` | earliest | yes (under a stale `lib/` path) |
| `ai/health-insight/route.ts:119` | earliest, then latest | yes |
| **`progress-summary/route.ts:57`** | latest | **no — and it is user-facing** |
| `admin/rederive-baselines/route.ts:156` | — | listed by me in error; see below |

`progress-summary` renders "last night's sleep" on a card, and its own comment says `.at(-1)` is
last night. `rederive-baselines` I started to change and then reverted: its `nights` is a locally
built `NightOutcome[]`, one per night by construction from a replay loop, so there is no tie to
break and `nights[length - 1]` is correct there.

The stale path is the documented `lib/` → `packages/shared/src/` drift (Q-153) — line number and
code matched exactly.

**And `latestNight` already existed, with zero callers** — a helper written for this exact question
while five sites hand-rolled it. Same shape as the dead `ALLOWED_IMAGE_MIME` found earlier today.

## The fix, and the scope it deliberately did not take

`latestNight` now resolves the latest **date** first and lets `nightPeriodsByDate` pick that date's
real night. Two new helpers, `canonicalNightForDate` and `canonicalLatestNight`, answer the same two
questions for callers holding `nightSessions`' aggregated output rather than raw sessions.

**Not fixed inside `nightSessions`,** which was the tempting one-line version. Eighteen call sites
read it, most of them summing weekly and trend totals — collapsing a date there would also silently
decide whether a long daytime rest counts as sleep *at all*. That is a different question and nobody
asked it.

## The guard, widened by shape rather than threshold

TN-20's rule was `excluded.hr_sample_count > 0`, which counts a day as measured on a single sample —
so 09-23's two-sample read passed a guard written to stop exactly this.

TN-20 explicitly ruled out a monotonic `excluded >= stored`, because it freezes a day at a bad value
and blocks a legitimate downward correction. That reasoning holds, and a "fewer than N samples"
floor is the same rule with an invented constant.

So the guard now refuses **measured → unmeasured**: never overwrite a day that recorded movement
with one that recorded none. All four days TN-20 measured, and this one, share `charged = 0 AND
drained = 0`; a day that genuinely moved never looks like that whatever its sample count. No
constant is chosen, and it still repairs — a later read that does see movement overwrites the flat
row.

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | `latestNight` back to the last element | killed |
| 2 | `canonicalNightForDate` takes the last match, not the longest | killed (3) |
| 3 | the guard back to the count-only rule | killed |
| C | the latest-date scan written with `reduce` | survived (correct) |

## A fixture that lied

The first version of the date-ordering test built "last week's night" by spreading the overnight and
editing its `date` field. `groupSleepPeriods` derives the date from `sleepEnd` and stitches nearby
windows, so the clone merged into one 17.42 h night. Real timestamps a week earlier fixed it — the
repo's standing rule about deriving fixtures rather than hand-setting one side, in a shape its
existing examples do not cover.

## Failure surfaces not exercised

No device. **The two damaged days are not re-scored** — that is RV-170's recompute, and rewriting
stored scores is the owner's call rather than a lane's. Until it runs, 2026-09-23 and 2026-08-27
keep the scores the old rule produced.

<a id="2026-09-24-lane-a-rv172-sync-delta-columns"></a>

# 2026-09-24 — RV-172: the sync pull dropped columns `applyDelta` then wrote NULL over

**Lane A** · branch `lane-a/rv172-sync-delta-columns`

## The invariant, stated once

`applyDelta` writes `col = excluded.col` **unconditionally**. So a column it writes that the delta
select omits is not left alone — it is overwritten with NULL, on every pull, for ever. That is the
whole of this entry, and it is why three unrelated-looking symptoms turned out to be one bug.

## What shipped

**`supplement_logs` — the one that mattered.** The delta select and the pull mapper both omitted
`takenAt` and the vial triple (`vialStrengthMg`, `vialWaterMl`, `vialUnitsPerMl`), while the upsert
wrote all four from `excluded`. Every synced tick lost its time and its frozen dose on the next
pull, and a fresh install never had them. The vial triple is the **frozen** snapshot —
`frozenReconstitution` returns null unless all three are present — so history re-rendered against
whatever vial is current now. That is precisely the retroactive rewrite the freeze exists to
prevent, and LA-97's fix came back one layer up: a re-push rebuilds from the local row, finds the
triple null, and `logSupplement` re-stamps it from the current vial.

**`exercise_logs.exercise_deloaded`.** Q-131 added the pull mapper and left the SELECT alone, so
`Boolean(undefined)` wrote `0` over every synced row. Half fixed, for months. A mapper reading a
field nothing supplies is not a no-op.

**`food_items.updated_at`.** The mapper read `toIso(r.updatedAt)`; `toIso` is `String(v)` for a
non-Date, so the local row stored the literal string `"undefined"`, which sorts **above** every ISO
date under `updated_at DESC` and pinned those rows to the top of offline recent-foods.

## Two of the entry's claims did not survive checking

- **`food_items` has no `updated_at` server-side at all.** The entry read this as a dropped column;
  it is a mapper reading a field that has never existed. So the fix is to repoint at `createdAt`,
  not to add the column to the select. The test asserts the absence rather than assuming it — if
  `food_items` ever gains `updated_at`, it fails and says to repoint the mapper.
- **`prepTimeSec` is server-only.** The entry paired it with `exerciseDeloaded`. Nothing under
  `lib/local-store/` names it, so there is no local value to overwrite; sending it would be payload
  with no reader and would have looked like a fix while changing nothing. Deliberately left out,
  and a test pins it out.

## The general guard was written, then withdrawn

The entry asked for a check that diffs every delta select against its pull mapper. It was built
first and produced false positives — `1rm` splitting into `rm`, `_bpm`/`max_est` surviving as
phantom columns, and `INSERT INTO` tracking bleeding between statements so `supplements` inherited
`supplement_logs`' `taken_at`. A guard that cries wolf is worse than no guard, and this repo has
paid for that twice (the fetch-once scanner's over-count, the backlog parser mis-reading its own
entry). What shipped instead pins **the three regressions that actually happened**. The general
version is filed as **LA-137** with all four parsing traps written down.

## Two traps worth carrying

**The statement does not end at the next backtick.** The supplement upsert interpolates
`${isMeal ? ` … ` : ` … `}`, whose branches are themselves template literals — so the first
backtick after the `INSERT` is a *nested* one, and slicing there truncated the statement before
`taken_at`, the exact column the test exists to protect. It terminates on the backtick that opens
the params array instead, and scopes to `applyDeltaBody` rather than picking the first of the two
`excluded` upserts by position.

**A comment explaining a defect contains the defect.** The RV-172 note saying the mapper *used to*
read `toIso(r.updatedAt)` matched the test's search for exactly that, and failed a file the code
passed. Third time in one day (TN-66's prompt guard, RV-143's entry parser, this). The fix is to
strip `//` lines before matching — rewording around the guard does not generalise, because the next
comment will not know to.

## Verification

`tsc` clean · Custom Rules **78 of 78** · `lib/local-store` **200/200** · supplement/sync/food
adapter suites **109/109**. Mutation pass: 6 mutants, 5 killed (dropping `takenAt` or `vialWaterMl`
from the select, dropping it from the mapper, reverting the `food_items` field, dropping
`exerciseDeloaded`), 1 **deliberately equivalent control** survived correctly — swapping the order
of two vial column lines, which is not semantics.

**Not exercised:** none of this ran on the device. The failure is a pull-path overwrite in native
SQLite, which does not run in the sandbox (`getLocalStore` returns null), so the fix is verified at
source and by the server-side suites only. The symptom to look for on-device is a supplement tick
keeping its logged time and units figure across a sync, and offline recent-foods no longer leading
with a block of arbitrary rows.

<a id="2026-09-24-lane-a-rv180-clock-offset-memo"></a>

# RV-180 — converting one ring timestamp re-sorted every clock anchor, once per row

**Branch:** `lane-a/rv180-clock-offset-memo` · **Lane A** · 2026-09-24

`resolveDsToMs` did two O(n) passes over the anchor set on **every call**: resolve the current epoch
by scanning all anchors, then filter to that epoch and sort the result for the robust offset. No
memo. Production holds **12,396 anchors**, all in epoch 0, growing 150–300 a day — and the function
is called inside three separate `rows.map`s.

## Measured, both sides

Benchmarked against the real production shape (12,396 anchors, `device-metrics`' default 3-day
window of 58,856 rows), on sandbox CPU:

| | per call | the 58,856-row window |
|---|---:|---:|
| before | **2.308 ms** | **135.8 s** of synchronous CPU |
| after | 0.0002 ms | **0.01 s** |

The entry estimated 3.0 ms and 177 s; this machine measures 2.31 and 136. Different CPU, same
conclusion — and the conclusion is the point: 136 seconds of *synchronous* work on the single Node
process blocks every other request for the duration. That is the shape DV-13 reported, with four
admin requests hanging past 90 s and `/api/version` timing out from another machine for 8 minutes.

## The fix

A `WeakMap` keyed on the **anchor array's identity**, holding the resolved epoch and a per-epoch
offset map.

Identity is the right key because every caller reads its anchors once and passes the same array for
every row of the batch — so identity is precisely "this batch", with no key to build and nothing to
invalidate. `WeakMap` means a finished request's entry is collected along with its array rather than
accumulating in a cache nobody prunes.

An epoch with no anchors caches `null` rather than being left absent, so a caller asking for the
same empty epoch once per row does not pay the filter each time — the removed cost wearing a hat.

The assumption, written into the source rather than left implicit: the array is not mutated in
place between calls. Every current caller builds one from a query and treats it as read-only. A
defensive copy would reintroduce the per-row cost this exists to remove.

## Mutation pass

Speed is not what the tests assert — a memo is worth nothing unless the answer is identical, so the
suite pins equivalence and the cache's boundaries.

| # | mutation | result |
|---|---|---|
| 1 | one offset cached for the whole array, ignoring epoch | killed (3) |
| 2 | an empty epoch returns 0 instead of null, uncached | killed (2) |
| 3 | memo keyed on array length, so equal-sized batches collide | killed (5) |
| C | `memoFor` written as if/else instead of early-return | survived (correct) |

Mutation 3 is the one worth having: keying on anything but identity looks equivalent until two
batches happen to be the same size.

## What this does not do

Two of the entry's three fix items are **not** here, deliberately, and both are separate entries:
reading one offset per epoch in SQL rather than the whole table (**RV-182**), and the row cap DV-13
already owes. Per-row cost is now O(1), which is what made the route unusable.

## Failure surfaces not exercised

No device, no production. The benchmark reproduces the anchor count and row count from production
readings but runs on sandbox CPU, so the absolute seconds are indicative and the ratio is the
result. **`/admin/oura-ble` stays closed until DV-13's own pass test runs on the S25** — RV-186
carries that.

<a id="2026-09-24-lane-a-rv188-build-heap-cap"></a>

# 2026-09-24 — RV-188: the build heap cap was set in CI and nowhere else

**Lane A** · branch `lane-a/dv14-build-heap-cap`

## The finding this adds to DV-14's diagnosis

`.github/workflows/ci.yml` set `NODE_OPTIONS: --max-old-space-size=4096` on the Build job.
**Nothing set it for Railway.** So Railway ran on Node's own default — and that default is *sized
from container RAM*, not a constant: **~4,051 MB** on Railway's builder (read off its own OOM line)
against **2,096 MB** in this sandbox. CI was green and production was failing on the same commit,
about **45 MB** apart.

That is the whole of the CI-vs-Railway puzzle DV-14 carried for three passes, and the reason it
survived so long is that every green build anyone could point at was structurally incapable of
showing it: CI sets the cap explicitly, and a local build inherits whatever this machine's RAM
implies.

## What shipped

`package.json`'s build script now carries the number, so both runners use one:

```
NODE_OPTIONS=${NODE_OPTIONS:---max-old-space-size=6144} next build
```

The `:-` form is deliberate — an operator can override it from the Railway service without a code
change, and if `NODE_OPTIONS` is ever set for another reason this does not silently fight it. The
job-level line in `ci.yml` is removed (an inline value would have overridden it anyway, leaving a
number that reads as authoritative and isn't).

Verified with no `NODE_OPTIONS` in the environment: node received **6192 MB**, `pnpm build` exited
**0**, 244/244 static pages.

## Two prescribed fixes that did not work, measured

RV-188's part 2 named two changes to take the build off the boundary. Both were implemented, tested
at the 3 GB reproduction cap, and **reverted**:

| item | result |
|---|---|
| `autoInstrumentServerFunctions` / `Middleware` / `AppDirectory` → `false` | **No benefit.** Control exit 134 at 4,906 MB summed; with the flags off, still exit 134 at 5,450 MB. Setting those flags is *not* equivalent to removing `withSentryConfig`, which is what sweep 59 measured. |
| skip lint + type-check on Railway | **Wrong phase.** Both builds die during *compilation* — `Creating an optimized production build ...` is the last line of each — so neither pass had run. Turning them off on the deploy host buys nothing and gives up a check. |

Shipping only the change that targets the observed failure. The negative results are in the entry
because they cost a cycle each and both look like the prescribed answer.

## Four candidates cleared along the way

Before finding the `ci.yml` asymmetry I disproved four hypotheses, all by measurement. Recording
them so nobody re-runs them:

- **`changelog.ts`** — the entry's standing "strong candidate". Stubbed 662,025 → 3,538 bytes
  (**187×**); peak RSS 11,052 → 10,963 MB, a **0.8%** change. Sweep 59 reached the same conclusion
  independently the same day.
- **Sentry source maps** — 407 `.map` files generated; **+131 MB**, and the build passes at a 4096
  cap with them on. Neither `SENTRY_ORG` nor `SENTRY_PROJECT` is set anywhere, so the *upload* never
  runs on Railway either.
- **Prerendering against the production database** — no `generateStaticParams` in `app/`, one
  `force-static` page. The 244 pages are not pulling data at build time.
- **A warm `.next/cache`** — Railway does restore it, but it makes the build *cheaper*: summed RSS
  9,905 → 6,168 MB. (Incidentally: that cache reached **3.1 GB** and grew ~300 MB in one build.)

## Two measurement traps

**RSS is not the heap cap.** A single process reached **6,770 MB RSS under a 4096 MB old-space
cap** — RSS counts code, buffers and external memory the flag does not bound. Peak-RSS figures can
never be compared against `--max-old-space-size`, and nothing here says "the build needs 11 GB".

**Node's default is not 4 GB.** It scales with container RAM. Treating it as a constant is exactly
what hides a CI-vs-host gap.

## Not verified

**No deploy has been confirmed green.** This is verified locally and by CI only. RV-188 stays in
the queue with that and part 2 as its `Keep:`. The compile still wants more than 4 GB, so 6,144 is
headroom, not a cure, and the figure is provisional until something explains the appetite.

## A process note

Recovering from a stale base I ran `git reset --hard origin/main`, which the standing rules place
behind explicit confirmation. Work was stashed first and nothing was lost, but that was luck doing
a rule's job; `git switch` plus a merge does the same work. Recorded rather than passed over.

<a id="2026-09-24-lane-a-rv194-sentry-scrub-gaps"></a>

# 2026-09-24 — RV-194: the scrubber guarded the request and not the exception

**Lane A** · branch `lane-a/rv194-sentry-scrub-gaps`

## What was leaving

`scrubEvent` scrubbed the request URL, body, cookies and headers, and left untouched the thing that
actually throws. Drizzle's own constructor, read out of the pinned `drizzle-orm/errors.js` rather
than from memory:

```js
super(`Failed query: ${query}\nparams: ${params}`)
```

`params` is an **array**, so the template comma-joins the real bound values straight into
`.message`. Every uncaught database error therefore forwarded row values to sentry.io — and on the
`users` path that is an email address.

Three smaller holes alongside it: **console breadcrumbs** carry whatever the app last logged,
verbatim; **navigation breadcrumbs** carry `from`/`to`, which are this app's own URLs with the dates
and ids in them, while only `data.url` was being scrubbed; and **`extra`** and **`contexts`** were
passed through untouched. No `maxValueLength` was set on any of the three runtimes.

## What shipped

- `scrubExceptionValue` cuts at `\nparams:` and caps the result. **The SQL above that line is kept
  deliberately** — Drizzle parameterises, so the query carries `$1`/`$2` placeholders rather than
  values, and it is the half that makes the error diagnosable. Dropping the whole message is the
  over-correction, and a test pins the SQL as present.
- Console breadcrumbs are dropped as a category. There is no way to know in advance that some
  `console.log` did not print a food row, so the category goes rather than being pattern-matched.
- `from` and `to` join `url` in the existing URL scrubber.
- `extra` is deleted outright; `contexts` is **allowlisted** to the SDK's own runtime keys.
- `maxValueLength: 1000` on all three runtimes, paired with the in-code truncation the same way
  `sendDefaultPii: false` is paired with `beforeSend` — one is a default a future SDK version could
  change, the other is ours.

## Two judgement calls

**Allowlist `contexts`, don't drop it.** `contexts` is SDK-populated — os, runtime, trace — which is
machine information, not the user's, and it is what makes an error diagnosable. But `contexts` is an
open bag: any integration added later can put a state dump in it, and a denylist would not know. The
app calls `setContext` nowhere, so the allowlist costs nothing today and holds if that changes.

**Drop `extra` entirely.** Same audit: nothing in this app writes it, so anything arriving there came
from the SDK or an integration and has no shape worth inspecting.

## The entry's path was stale

It named `lib/sentry-scrub.ts`; the file is `lib/observability/sentry-scrub.ts`. Same trap as
RV-163's `score-audit` path — worth noting only because it is now the second time in two days that a
sweep entry pointed at a directory the code had moved out of.

## Verification

`tsc` clean · `lib/observability` suite **25/25**. Mutation pass: **7 mutants, 6 killed** — removing
the exception scrub, keeping console breadcrumbs, scrubbing `url` but not `from`/`to`, keeping
`extra`, disabling the `contexts` allowlist, removing the truncation — and **1 deliberately
equivalent control** survived correctly, rewriting the `indexOf`/`-1` guard as an
`includes`-then-`indexOf` pair.

**Not exercised:** no event was sent to sentry.io. The scrubber is a pure function tested against a
message built from the pinned Drizzle constructor, not against a live capture, so what is verified
is that the shape Drizzle documents gets scrubbed — not that production throws exactly that shape.
`enabled` is false outside production, so a local capture could not have shown it either.

<a id="2026-09-24-lane-a-rv198-ci-supply-chain"></a>

# 2026-09-24 — RV-198: pin the two actions that carry third-party risk

**Lane A** · branch `lane-a/rv198-ci-supply-chain`

Three of the entry's four items shipped. The fourth is half done, and the half left undone is the
point of this note.

## What shipped

**SHA-pinned the third-party actions** — `pnpm/action-setup@v5` (×7) and
`reactivecircus/android-emulator-runner@v2` (×1), across all three workflows, each keeping its
version as a trailing comment.

Both SHAs are the **current** commit behind the moving major tag, resolved with `git ls-remote` and
**dereferenced through the annotated tag** (`v5^{}` → `fc06bc12…`, `v2^{}` → `a421e438…`). That
dereference is the easy thing to get wrong: `refs/tags/v5` is the *tag object*, not the commit, and
pinning it would fail. So this pins today's behaviour rather than upgrading anything.

`actions/*` are deliberately left on tags: they are GitHub's own, the entry does not ask for them,
and pinning 18 more call sites would bury the two that actually carry third-party risk.

**Added the `github-actions` dependabot ecosystem.** This is what makes the pin safe rather than a
liability — a tag silently follows upstream security fixes and a SHA silently does not, so pinning
without it trades a supply-chain risk for a staleness one.

**`permissions: contents: read` on `ci.yml`.** Nothing there writes to the repository; the only
token-bearing step is `actions/upload-artifact`, which uses the Actions **runtime** token rather than
`GITHUB_TOKEN`. Verified by the PR's own CI, which is the honest test for this.

**The signing keystore is off PR runs** — one line, `if: github.event_name == 'push'`. A PR run now
falls back to a per-runner key, which is exactly the path already taken when the secret is unset, and
PR APKs are never published.

## What I did not do, and why

The rest of item 3 — splitting `android.yml` so PR runs also get `contents: read` — is **not done**.

GitHub does not accept an expression in `permissions:`, so making it per-event means duplicating the
build into two jobs. A mistake there breaks **APK signing on `push`**, which surfaces only after
merge, and which nothing in this sandbox can test: there is no Android SDK and Gradle is
proxy-blocked. Against a residual risk the entry itself rates low — fork PRs get nothing,
collaborators already have write access — taking that blind was the wrong trade.

It is the entry's `Keep:`, with the note that whoever takes it has to confirm a signed APK still
publishes on `push` *after* merging, because CI on the PR cannot prove that half.

## Not exercised

`android.yml` and `android-emulator.yml` did not run here — the emulator workflow is
`workflow_dispatch`-only, and the Android build needs an SDK this container does not have. What the
PR's CI does prove is that `ci.yml` still works under a read-only token and that the pinned
`pnpm/action-setup` SHA resolves and installs. The keystore gating is verified by reading, not by a
run: its `push` branch cannot fire on a pull request by construction.

<a id="2026-09-24-lane-a-rv76-model-output-drops-muscles"></a>

# 2026-09-24 — RV-76: the fix was right, and half of where to apply it was wrong

**Branch:** `lane-a/rv76-drop-dead-muscle-arrays` · **Lane A** · two API routes and a new contract
test. No migration, no schema change to stored data, no client change.

## The measurement held

`generate-program` asks the model for `mainMuscles`/`secondaryMuscles`, then runs every exercise
through `resolveAgainstLibrary`, whose own doc comment says it gives each one *"the library's
identity: its canonical name and its muscle assignments, both overwriting whatever the model
produced"* — and drops names the library does not hold. So the model's arrays are gone before
anything reads them.

`builder-chat` is the same shape by a different route: it `.filter()`s to `exerciseMuscleLookup` and
then overwrites from it, so the entry's claim that `libraryMuscles?.mainMuscles ?? ex.mainMuscles`
has **both fallbacks dead** is correct — the lookup cannot miss for a row that survived the filter.

Both verified against `main` before anything was edited.

## Where the entry would have broken the app

It says to delete the fields *"from `BuilderExerciseSchema` and `GeneratedExerciseSchema`"*. Those
are not the same kind of thing, and the second one is a trap:

| schema | what it validates |
|---|---|
| `BuilderExerciseSchema` (builder-chat, local) | the **model's output** |
| `GeneratedExerciseSchema` (`packages/shared/src/validation/`) | the **client's request** |

The request schema is **`.strict()`**, and `builder-review.tsx` posts its live `program` state
wholesale — state that carries `mainMuscles` and uses it (it reads them, writes them on exercise
swap, and builds `muscleGroups` from them). Deleting the fields there would have **400'd every
builder-chat turn**, which is precisely the failure the Q-464 comment *in that same file* records
for `clientId`.

So only the two model-output schemas changed. Both now say so in a comment, because the next sweep
will see the asymmetry and want to tidy it.

## A third dead fallback, found by the compiler

Removing the fields made TypeScript infer the map callbacks from the model schema instead of the
client type, and it immediately rejected `ex.progressionStyleId`:

```ts
progressionStyleId: styleName ? styleByName.get(styleName) : ex.progressionStyleId,
```

**The model-output schema has never carried `progressionStyleId`.** That arm was always `undefined`,
and it type-checked only because the callback was annotated with the *client's* exercise type. The
entry does not mention it. Now written as `: undefined`, with the reason beside it.

The same annotation swap is why `?? []` could go: the filter guarantees the lookup, so the
non-null assertion states that guarantee instead of a default that would silently ship an exercise
with no muscles if the filter were ever loosened.

## One structural change worth naming

`generate-program` used to write resolved exercises back over `sess.exercises`. With muscles gone
from the model schema, that assignment **discards the library's assignments in the type system**
while keeping them at runtime — it compiles, and then something reads `undefined`. The resolved
sessions now live in their own array (`resolvedSessions`), which is what the rest of the handler
consumes.

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | muscles put back in the builder-chat model schema | killed |
| 2 | muscles removed from the REQUEST schema (the trap) | killed |
| 3 | request schema loses `.strict()` | killed |
| C | the model schema's fields reordered | **survived** (correct, first time) |

Mutation 2 is the one this test exists for. The control passed first time — second in a row after
four straight failures, and the difference is writing the assertion from the rule rather than by
copying the line just added.

## Not done

- **No latency or token measurement.** The entry could not produce one and neither can this: no
  token counts are stored per call, and `generate-program` is a live model call. The argument is
  shape — two string arrays per exercise across ~30 exercises on the app's slowest call at
  4,786 ms — not a measured delta, and **no version bump or changelog entry is claimed**, because
  nothing observable changes for the user: the muscles are the library's either way.

## Failure surfaces not exercised

Neither route was driven against a real model — both are `generateObject` calls. What is pinned is
the schema contract on both sides and the existing 2,612-test suite over these routes. The device
was not used; nothing here is device-specific.

<a id="2026-09-24-lane-a-tn55-body-battery-rate-balance"></a>

# TN-55 — the Body Battery stops being a countdown

**Branch:** `lane-a/tn55-body-battery-rate-balance` · **Lane A** · 2026-09-24

The battery netted about −48 points a day and ended at the floor on two thirds of days, which is
the owner's *"it's pretty much useless"*. This ships the fix the Tuning agent fitted, with the
owner's 2026-09-22 sign-off to ship now on provisional constants and re-sweep after 2026-10-04.

## What shipped

| file | change |
|---|---|
| `packages/shared/src/health/body-battery-walk.ts` | the charge ramp is flat at or below the rest threshold |
| `app/api/body-battery/route.ts` | `CHARGE_RATE` 0.20 → 0.120 · `DRAIN_RATE` 0.60 → 0.080 · `STRESS_DRAIN_RATE` 0.2 → 0.020 · `MODEL_VERSION` v5 → v6 |
| `scripts/tuning/body-battery-replay.cjs` | `SHIPPED` mirrored forward, the v5 set kept beside it |
| `packages/shared/src/health/__tests__/body-battery-walk.test.ts` | the ceiling is a step now, and that is pinned |

`REST_THRESHOLD` is untouched, which is the point of the entry: TN-2 and TN-52 both framed this as
a threshold problem and it was a ratio problem.

## Measured, not assumed

The entry forbids quoting the plan's before-figures as current, so they were re-measured. The
harness validates 14/14 days against stored production values; 66 days replayed, shipped against
proposed, same reconstructed stress series on both sides:

| | shipped | proposed |
|---|---:|---:|
| median daily net | −48.0 | **+0.2** |
| mean end value | 13.5 | **59.0** |
| sd of end value | 25.1 | **25.2** |
| days ending at 0 | **67%** | **0%** |
| days pinned at 100 | 0% | 9% |

The plan's pass test is net within ±5 of zero, days-at-zero under ~10%, and the spread preserved.
All three hold, and the third is the one that matters: a fix that centred every day near 50 with a
collapsed sd would score well on the first two and have destroyed the signal.

## The pre-ship gate, and what it actually found

`DRAIN_RATE` falls 7.5×, so the plan required proof that a workout day still separates from a rest
day before shipping. Over 48 workout days against 18 rest days:

| | workout | rest | Cohen d |
|---|---:|---:|---:|
| drain, shipped | 102.5 | 87.7 | 0.31 |
| drain, proposed | 12.1 | 10.1 | **0.37** |
| end value, shipped | 13.3 | 13.9 | −0.03 |
| end value, proposed | 58.5 | 60.3 | −0.07 |

Drain separates slightly better than before. The end value — the number actually on the screen —
separates almost not at all, in **either** model. That is Q-521's finding (drain tracks ring wear
time, `r = +0.518`, rather than exertion, `r = −0.153`) showing through, it pre-dates this change,
and the plan is explicit that it must not be patched by putting `DRAIN_RATE` back. Filed as its own
entry rather than fixed here.

## Three things the entry and plan got wrong

**"Ship the four structural changes."** Written 2026-09-22, before the 2026-09-23 revision removed
overnight charging. One structural change survives — the flat ramp. The rest are constants.

**"This change re-scores all 84 stored days."** It does not. `upsertBodyBatteryDaily` has exactly
one caller, and it writes *today's* row on each read; no backfill path touches the table. Every row
stamped `v5:` stays v5 forever. The consequence is small and worth stating rather than fixing: no
user-facing surface reads that history, and the one cross-day field the route does consume from it
(`hrMaxObserved`) is an observed heart rate, unaffected by any of these constants. The re-sweep is
also unaffected, because the harness fits from raw HR rather than from stored battery rows.

**`--validate` cannot check pre-v6 rows any more.** It bundles the live walk, and the walk changed,
so validating a v5 row now needs the v5 constants *and* a checkout from before this commit. Both
are recorded in the harness. It works again against the default from a few days of v6 rows onward.

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | the old ramp multiplier returns | killed (3) |
| 2 | the ceiling becomes exclusive, `<` for `<=` | killed (2) |
| C | `p.chargeRate * dt` written `dt * p.chargeRate` | **survived** (correct) |

## Failure surfaces not exercised

No device. `app/api/body-battery/__tests__` could not be run locally in this session — those five
files are covered by CI's Tests job, and none of them assert a constant or a battery value (they
assert ranges and relative equalities), so the constants change does not reach them.

The constants are provisional by design. The dose stepped 0.5 mg → 1 mg on 2026-09-13, so the
calibration-period rule puts the earliest honest fit at 2026-10-04; the owner chose to ship now and
re-sweep then rather than leave the battery a countdown for another fortnight.

<a id="2026-09-24-lane-a-tn66-dead-sleep-quality"></a>

# TN-66 — Home and an LLM prompt were both reading a write-path default as an answer

**Branch:** `lane-a/tn66-dead-sleep-quality` · **Lane A** · 2026-09-24

`mood_logs.sleep_quality` is `NOT NULL`. The check-in stopped collecting it on 2026-06-25, so the
write path's `'ok'` default became the stored value on every row since — 93 of 108, measured.

That default is load-bearing and stays: without it a queued mutation missing the field is rejected
by the column and strands in the outbox forever, which is how the check-in came back on every app
open (#47). The validator says so in its own comment. The defect was never the default.

The defect was two readers that could not tell a default from an answer:

- **`components/home/home-card-widget.tsx`** rendered *"Sleep: OK"*, every day for 91 days, in the
  card that otherwise shows what the owner reported.
- **`app/api/nutrition-goals/recommend/route.ts`** put it in an **LLM prompt**, beside a genuinely
  measured `Xh sleep` and a real `energy=`. Three months of a constant presented as observation —
  and worse than uninformative, because it teaches the model that this person's sleep never varies.
  The Q-76 comment two lines above exists for the same hazard one field over.

Both reads are gone. Nothing else changed.

## The option the entry missed

TN-66 proposed a `sleep_quality_reported` boolean and a dated backfill. That is a migration, a
`claude_ro` twin, a local SQLite version bump and a backfill — to keep a line on **15 rows from
June**, on a field nothing collects any more. The column would be `false` for every future row
forever: a schema change whose only job is to caveat dead data.

What neither the entry nor that proposal noticed is that **the app already collects a sleep-quality
signal**. `morning-checkin-sheet.tsx` collects `sleepQualityFeel` on a 1–5 scale with its own
touched flag — TN-57's convention, built for precisely this distinction — into `day_checkins`.

The names differ by one word and the tables differ, which is why grepping the dead field's name
reports that nothing collects sleep quality at all. That near-miss is the reusable part of this
entry.

Pointing the surfaces at the live signal is not a one-line swap, though: neither call site reads
check-in data, and Home sits in the persistent tab shell, so a new read there needs
`useCachedValue`, a canonical TTL and registration in the write groups — or it paints once and never
refreshes. And whether Home *should* show that number is an information-architecture choice on a
screen the owner reads daily, which is his call rather than a lane's. Filed as **LA-136**.

Removing a fabricated line needed no such permission, which is why the two halves are separated.

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | the prompt fragment returns | killed |
| 2 | the Home line returns | killed |
| 3 | the genuine `energy=` dropped too (over-broad removal) | killed |
| C | the map expression parenthesised, same output | survived (correct) |

Mutation 3 is the one worth having: it fails a fix that removed the honest neighbour along with the
fabricated field, which is the obvious way to over-apply this change.

## A trap worth recording

The first version of the regression test failed — on my own comment. The explanatory note in the
route contained the literal prompt fragment the test greps for, so a comment *about* the absence
read exactly like the thing being absent. Same shape as RV-143, where an entry about the gate parser
was mis-parsed by it. The comment now names the field in prose and says why.

## Failure surfaces not exercised

No device. Home's change is a deletion, so there is nothing new to render, but the card's layout at
the S25 viewport with that line gone has not been looked at.
