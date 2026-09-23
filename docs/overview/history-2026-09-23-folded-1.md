# Session journal — batch folded 2026-09-23

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-09-22-rv98-opacity-contrast"></a>

# 2026-09-22 — RV-98: opacity-modified text was below AA, and the check could not see it

**Branch:** `fix/rv98-opacity-contrast` · **Lane:** Implementation B · **Version:** 1.465.3

## What shipped

`scripts/check-contrast.js` validated ten **bare token pairs** and had no opacity handling at all,
so everything from `text-muted-foreground/60` down was unguarded. Measured over `--card`: **70%
opacity is 4.64:1 and passes; 60% is 3.73, 50% 2.97, 40% 2.34, 30% 1.83** — against an AA floor of
4.5:1 for body text.

- **45 call sites raised to 70%** across 30 files.
- **Four exempted, each read in context and each with its reason written into the script**: a
  *future* day in the week strip (WCAG 1.4.3 exempts inactive components), two progress-ring
  **tracks** where `text-muted-foreground/30` is a `currentColor` fill behind a mask rather than
  text at all, and the `·` separator in the weather chip, where the values either side carry the
  meaning.
- **The calendar's `rest` marker went to FULL opacity, not the floor.** It is `text-[7px]` and the
  only thing distinguishing a past rest day from a past *untracked* one in the month grid, so it
  gets 8.36:1 rather than the 4.64:1 that merely clears AA.
- The check now parses `text-<token>/<n>`, composites, and fails with the measured ratio beside the
  file and line.

## The compositing was wrong on the first pass

`alphaRatio` initially blended the **linear** sRGB values. That put 40% opacity at **3.93:1** where
it is really **2.34:1** — an error that would have shipped a number in the failure message that
nobody could reproduce in a browser. CSS alpha-composites in the **gamma-encoded** space, so the
round trip has to be linear → encoded → blend → linear → luminance.

**What caught it was RV-98's own numbers.** The entry measured 1.83 / 2.34 / 2.97 / 3.73 and my
first output disagreed with all four. After the fix: **1.82 / 2.33 / 2.96 / 3.73** — independent
agreement to ±0.01. Given that twelve entry claims failed to survive contact across this sweep, an
entry whose measurements reproduce exactly is worth recording as such.

## Also fixed: `projectOverview.md` had three stacked version headers

Current Status opened with `**Version:** v1.465.2`, `v1.465.1` and `v1.465.0` on consecutive lines,
and carried a stray `**Version:** v1.464.8` + `**Last updated:**` pair buried mid-section. All four
are conflict-resolution residue, and **this lane's own recipe is how they got there**: *"keep BOTH
Current Status paragraphs"* is right about the paragraphs and wrong if it also keeps the header
above them. The baton now says to delete the loser's header explicitly. This is the file every
session reads first, so three contradictory version numbers at the top of it is worse than a stale
one.

## The RV-91 trap, repeated — with a second one under it

This test went red locally before it shipped, on **its own header**, which quotes the banned token
to state the rule. That is RV-91's `Cal`/`kcal` failure exactly, and **the lesson was already
written in this lane's baton** when I wrote this test. Writing a lesson down is not the same as
applying it.

Underneath it was a second bug in both tests: **`git ls-files app components -- '*.tsx'` does not
filter.** Git unions the three pathspecs, so `app` and `components` match every file beneath them
and `.ts` comes back too. RV-91's sweep has the same construction and survived only because its
`__tests__` filter happened to catch the file that would have tripped it. Both are now filtered on
the extension in JS, with the reason written beside them.

## A note on lane ownership

The entry scopes both halves to Lane B — the call sites *and* extending the script — while this
lane's baton says `scripts/**` is the Orchestrator's. Both were done here, because a guard that
ships separately from the fix it guards is a guard that arrives after the regression, and precedent
is clear: `check-cache-ttl-divergence.js` (Q-242) and `check-aest-midnight-timezone.js` (LA-19) both
shipped with the fixes they enforce. The baton's line is about the **queue tooling** — `next-item.js`,
`check-backlog-pointers.js` — not about every script in the directory.

## Verification

- `pnpm check:rules` — **Ran 75 of 75**. `tsc --noEmit` clean; the new check passes and reports the
  floor in its summary line.
- **Mutation-checked**: re-introducing a single `/40` makes the script exit non-zero and name the
  file, line and measured ratio. Stepping one site through 30/40/50/60 reproduced the whole table.
- **Controlled: all 3 unit cases go red** against the unfixed tree. One of them runs the script and
  asserts its summary mentions the floor — the vacuous case is a script that silently stops
  scanning, which would leave the rule intact while enforcing nothing.
- The test reads the exempt list **out of the script** rather than restating it, so the two cannot
  drift.

**Not exercised:** no device sitting. Contrast is computed from the tokens, not sampled from a
screen, and the 412px rendering is unchanged — but the whole point of the calendar fix is legibility
at low brightness on the S25, which only the device can confirm.

<a id="2026-09-22-tn58-comparative-checkin-control"></a>

# 2026-09-22 — TN-58: ask whether today is better or worse than yesterday

**Branch:** `feat/tn58-vs-yesterday-control` · **Lane:** Implementation B · **Version:** 1.465.0

## What shipped

The absolute "perceived recovery" 1–5 produced **two distinct values across 96 check-ins**, sd 0.29,
and **not one of them was touched**. A question with no variance cannot be a target for anything,
which is what blocks TN-33. People order two things more reliably than they score one, so the sheet
now asks for the comparison: **better / about the same / worse than yesterday**, three taps.

`components/checkin/vs-yesterday-picker.tsx` is new; `morning-checkin-sheet.tsx` holds the state,
restores a saved answer, and posts `vsYesterday` straight through. LB-124 had shipped the column,
the Zod schema, both write paths and the local store, and left `vsYesterday: null` in the sheet's
local write with a comment pointing at this entry — that placeholder is gone, because with the real
value in the payload spread beside it, key order would have decided silently which won.

**No default and no pre-selection.** The column has no default for the same reason: a neutral stored
as though it were an answer is precisely the defect TN-57 fixed, and shipping one on the question
written to escape it would recreate it under a new name. There is no `touched` flag either — unlike
the 1–5 scales there is no seeded position for an untouched save to accept, so NULL already carries
"not answered". Tapping the selection again clears it, so a mis-tap returns to unanswered.

It sits **above** the two scales. It is the question this check-in actually wants answered, and one
placed below two the owner has skipped for 81 days inherits their fate.

## The decision the entry left ambiguous

TN-58 says *"replace the absolute scale with a comparative one"* in its proposal and *"keep
`perceived_recovery` as-is and add the comparative field beside it"* in its warnings. **Added, not
replaced** — three reasons: the entry's own scope line says the control "and nothing else";
`perceivedRecovery` feeds `signals.morningCheckin` and shapes the prescription, so retiring its
control silently changes what the engine receives, which is Lane A's surface; and `sleepQualityFeel`
is a different question untouched by the finding. **Retiring the absolute control is a separate
entry conditional on the pass test**, to be filed with the measurement in hand rather than now.

## What is owed, and why it is a `Keep:` rather than a tick

**The two-week pass test cannot be run for a fortnight.** `vs_yesterday` must show **≥3 distinct
values and a touched-rate materially above zero**; the baseline to beat is 2 values in 81 days.
**If it fails, that is the finding, not a defect** — self-report is not available from this owner at
all, which settles TN-33/TN-16/TN-34/TN-55 by a different route. The backlog carries this as TN-58's
`Keep:`, with an explicit "do not quietly re-tune the control and restart the clock".

## Verification

- `pnpm check:rules` — **Ran 75 of 75**. `tsc --noEmit` clean; lint clean.
- **Unit: 2 of 5 cases discriminate**, stated in the header. Three characterise a component that did
  not exist and Lane A's schema — they pass either way and are there because the design depends on
  them: a 201-that-stores-nothing, or a three-tap check-in rejected as empty, would each stop this
  question producing the variance it exists for.
- **e2e `tn58-vs-yesterday-no-default.spec.ts`** drives the real sheet at 412px and asserts all three
  options open `aria-checked="false"`, that selecting one excludes the others, and that re-tapping
  clears it. It **deliberately does not call `suppressMorningCheckin`** — every other spec suppresses
  this sheet and this one needs it open.

**Not exercised:** no device sitting. The sheet is a daily native surface and this changes what it
asks, so the S25 pass is worth having before the fortnight's clock is trusted.

<a id="2026-09-22-tuning-four-owner-decisions"></a>

# 2026-09-22 — four owner decisions recorded, and three gates lifted

**Branch:** `tuning/record-four-owner-decisions` · **Agent:** Tuning · **Docs-only.**

The owner asked for the open questions as a prompt with recommendations. All four came back as
recommended. Recorded here and on their entries, because the whole reason LA-122 exists is that a
decision living only in a chat transcript dies with the session.

## The decisions

**1. The readiness history is re-derived ONCE, not per change.** Four entries each rewrite stored
readiness days — TN-60 (the rail), TN-6 and BF-13 (the temperature baseline), LA-121. Shipped
separately his history would visibly shift four times over a few weeks with no way to attribute any
change to the fix that caused it. So the code lands in normal separate PRs and
`POST /api/admin/rederive-baselines` fires **once**, after the last of them, dry-run first.

Recorded as LA-122 item **2a**, deliberately **not** as a `Batch:` field: `Batch:` means one PR, and
one PR here would bundle three code changes with an owner-fired production data write, which the
standing rules forbid batching. The shared thing is the recompute run, not the diff. Whoever ships the
last of the four says in its PR that the recompute is now owed.

**2. TN-60 — build the compressive tail.** Keep the linear region as it is; replace the hard clip at
±1.5σ with a curve that keeps compressing, so the 38% of days currently pinned at a rail keep their
ordering instead of collapsing onto 0/100. Gate lifted; it is now Lane A's READY #1. The
per-contributor-quantile option is recorded as considered and not chosen.

**3. TN-55 — ship the Body Battery structure now, re-sweep after 2026-10-04.** He accepted two
re-scores as the price of not leaving the battery a countdown for another fortnight. The four
structural changes take days-ending-at-zero from 66% to about 5% and do not depend on the exact
constants. **This is not in the batch above** — it writes `body_battery_daily`, a different table.

**4. LA-121 — do not port the temperature ladder; let `tempZ` stand.** The reason is the part worth
keeping: TN-6 has measured the temperature baseline **0.36 °C too low**, so porting the *sharper*
penalty on top of a wrong baseline amplifies the error rather than adding signal. Temperature already
reaches readiness through `computeReadinessComposite`. If it looks under-weighted after TN-6's rebuild
lands, that becomes a fresh question with data behind it.

LA-122 item 2 is struck as answered; its `Keep:` stands for the remaining items.

## What this changes in the queue

Three gates lifted — TN-60, TN-55 and LA-121 all carry no blocking field now and all three are
startable. LA-121's remaining work should be **behaviour-preserving** dead-code removal (the four dead
branches keep the fallback arm that already runs; the fifth site's dead disjunct simplifies away), and
the entry says Lane A confirms that rather than assuming it — if it does move a stored value it joins
the batched recompute instead of firing its own.

## Noted while checking

`next-item.js` prints only the top 10 of a bucket without `--all`, and lane A's READY is now 31. Two
entries I had just edited appeared nowhere in the output, which reads exactly like "removed from the
queue" until you check the fields directly. Worth knowing before concluding an entry has vanished.

Also seen landing from other lanes: **LA-128**, the check-in route stripping an unknown key instead of
rejecting it — the `.strict()` defect LB-124 found, now its own entry. That is the one that would have
burned TN-58's two-week pass test.

## Not exercised

Nothing runs; this records decisions and lifts gates. No measurement was taken today beyond confirming
which entries carry a recompute — the four decisions rest on measurements already filed
(`hrvBalance` railing on 38% of days, the battery's −29.8/day net, the 0.36 °C baseline offset).
`pnpm check:rules` **Ran 75 of 75**, all passed; backlog validates at 398 entries.

<a id="2026-09-22-tuning-hrv-rail-and-marker-guard"></a>

# 2026-09-22 — the rail is where readiness loses its information, and the marker defect reappeared overnight

**Branch:** `tuning/unpark-lb124-and-guard` · **Agent:** Tuning · **Docs-only.**

## The update: a correct catch against yesterday's filing

Lane B took TN-58 off READY and filed **LB-124**, because TN-58 said *"add the comparative field
beside `perceived_recovery`"* and that field exists nowhere — no column, neither Zod schema, not the
route. TN-58 named TN-57 as its engine half; TN-57's own entry says it ships **no migration**. So the
two entries I filed together left the chain unbuildable, and LB-124 says so plainly: *"Read TN-57's
scope rather than TN-58's description of it."* That is the lane system working, and the catch is right.

LB-124 also found something I would have burned two weeks on: `Body` in the check-in route is **not**
`.strict()`, so a sheet posting an unknown `vsYesterday` gets **201 and writes nothing**. TN-58's
pass test would have read "self-report is not available from this owner" when the truth was a dropped
field.

**And LB-124 was itself parked on arrival**, by a prose marker reading *"the failure mode is SILENT,
which is why this is filed rather than attempted"* — an explanation of why it was written up, not a
statement that it cannot start. Lane B's entire READY list went to zero. Unparked here; it is now
Lane A's #2, and the TN-58 chain is alive again.

## TN-60 — the readiness composite's weights are not what it says

Variance decomposition of 69 stored days (2026-07-16 → 2026-09-22), weighted sd of each contributor's
score as a share of all movement in the final number:

| contributor | declared | sd | share of movement |
|---|---:|---:|---:|
| **hrvBalance** | 0.15 | **35.8** | **22.8%** |
| previousNight | 0.16 | 23.6 | 16.0% |
| restingHeartRate | 0.15 | 24.7 | 15.7% |
| sleepBalance | 0.10 | 32.6 | 13.8% |
| recoveryIndex | 0.09 | 28.0 | 10.7% |
| temperature | 0.10 | 16.6 | 7.0% |
| checkin | 0.10 | 15.2 | 6.5% |
| prevDayActivity | 0.09 | 12.1 | 4.6% |
| activityBalance | 0.06 | 11.1 | 2.8% |

`hrvBalance` carries half again the influence its weight says; `activityBalance` half of its. Nobody
chose that distribution — it falls out of the contributors being measured on rulers of different widths.

**The mechanism is the rail.** `Z_POINTS_PER_UNIT = 50/1.5` floors and ceilings the score at z = ±1.5.
`hrvBalance` is railed on **26 of 69 days (38%)** — and the z values landing on score **0** span
**−1.63 to −4.37**. A 2.7σ spread renders as one number. On more than a third of days the biggest
contributor to readiness says "as bad as possible" and cannot say which kind of bad.

Recommendation is a compressive tail rather than a hard clip: the linear middle is unchanged, extreme
days keep their ordering, and nothing needs re-fitting. Filed `Gate: owner` because it re-scores
history.

## Two things I checked before believing them

**`recoveryIndex` is `provisional: true` on 69 of 69 days** — which looked like a contributor the app
itself flags as unsettled while scoring it at 9%. It is not a defect: `provisional` there means *the
curve is an approximation*, deliberate and documented, and Q-278 exists because that sense used to be
conflated with "input missing". Dropped before filing.

**`checkin` scores 50 on 19 days with `gap: null`** — which looked like the neutral colliding with a
real `low` reading. It does collide numerically, but the `gap` field separates them correctly (only 2
days are true `no_input`). No defect; the field does its job.

## TN-59 — the marker defect needs a check, because the sweep did not hold

Two days ago a sweep converted 17 prose markers by hand and took READY from 6 to 21. Today: **28
entries still parked by a prose marker alone**, and LB-124 filed and parked within hours. Filed for
Lane O: fail when an entry's only block is a prose marker, baseline the 28 shrink-only.

Its own drafting hit the trap twice, both recorded in the entry because they are the argument for it:
writing the marker character inside backticks parked the entry describing it, and using the
`Reference:` field for background reading filed it under *read, do not build*. **Third field-semantics
slip of the day in my own filings** — TN-56 had the same `Reference:` mistake yesterday. The pattern
is mine, not the tool's, and it is why the check is worth more than another sweep.

## Not exercised

Nothing runs; documentation and queue ordering. The decomposition is read-only over
`oura_daily_derived`, **row-scoped to the owner**, correct here since the claim is about his composite.
**Not established:** whether the rail's cost shows up in any decision the app makes — a railed
contributor loses resolution, but whether that changes a recommendation is unmeasured, and TN-60's
pass test deliberately asks only about the score's own distribution. `pnpm check:rules` **Ran 75 of
75**, all passed.

<a id="2026-09-23-chore-or-129-lane-channel"></a>

# 2026-09-23 — `chore/or-129-lane-channel` (OR-129)

**Orchestrator.** The owner asked for a working system where agents feed off each other's updates,
described precisely: *"Tasks are assigned to an agent's backlog… the agent reads whatever is in its
lane and works off it… Review agent or other agents can assign tasks to device verification agent."*

That is what implementers already do. What was missing was making the lane field able to express it.

## `Lane:` becomes the channel

`DV` joins `A`, `B` and `O` as a value, so **any agent hands work to any other by writing a field**.
Review finds something only the phone can settle → `Lane: DV`. The device agent finds a real defect
→ `Lane: B`. Anyone hits a question needing the owner → `Lane: O`. No message, no handoff doc, no
two sessions awake at once. **The queue is the channel, and an entry outlives the session that
wrote it.**

**`O` and `DV` are strict where `A` and `B` are not.** An unstated lane means *"§3's path rule
answers it"*, and that rule only ever resolves to an implementer — so untagged work showing in both
implementer lanes is the safe failure it was designed as, and the same 400 entries shown to the
Orchestrator or the device agent would bury the few genuinely theirs.

**The letter and the lane are different things**, and `DV-1` is the example that makes it concrete:
found by the device agent, carries `Lane: O`, because the work is the Orchestrator's. The letter
records who found it and never changes; the lane records who builds it.

**A device check is not a lane assignment**, and keeping them apart is the part most likely to be
got wrong later. A shipped entry owing a look keeps its own lane and carries `Verify: device` or a
`Keep:`; `--sittings` gathers those by screen and now orders groups by **queue position**, so
moving one entry up promotes a whole sitting. Merging the two would put a hundred entries in one
lane and tell it nothing about order.

**Cadence** is documented per role: hourly for the implementers and the Orchestrator, on demand for
Device Verification (it needs the phone and the owner present; a timer would fire into an empty
room). **A quiet wake-up is silent** — an agent reporting "nothing to do" every hour trains everyone
to stop reading it.

## Most of this session's other PR was already on `main`

`#1417` landed while this was being written, carrying the harness from `#1411` **plus a real device
sitting**. So a first draft of the standing-role registration was duplicated work and was dropped
rather than merged: `main`'s baton is `docs/agents/state/device-verification.md`, not the
`device.md` written here, and `DV-1` was already taken by a genuine finding (`pnpm ci:local` cannot
pass on Windows, which is where that role always runs).

What survived the reconciliation is what `main` did **not** have: the `Lane: DV` value, the strict
lanes, the `--sittings` ordering, the two README sections, and CLAUDE.md's seven-agent update.
Three planned `DV-` entries were **not** filed — the back-gesture sitting they described had already
run.

## Worth carrying

**The same prefix bug fired twice in one day, and its own file had predicted it.**
`scripts/lib/entry-id.js` opens with the story of `OR-` being added as a role whose letter never
reached the shared list, failing as *"silent deletion, not a wrong label"*. `DV-` did exactly that:
three entries written, the queue total identical with and without them, `--lane DV` printing
*"nothing startable"* while the headings sat in the file. The lane parsed and the id did not — every
piece correct on its own. CLAUDE.md now says outright that a new role's letter goes in that file in
the same PR as the role.

**And the reconciliation itself is the argument for the lane channel.** Two sessions built
overlapping answers to the same request because neither could see the other's unmerged work. A lane
entry is visible the moment it merges, to every session that reads the queue afterwards — which is
the failure mode this PR exists to reduce.

## Not done

- **Gesture navigation is still off on the phone**, which invalidates every safe-area check — the
  single owner action unblocking the largest group of owed checks.
- **`DV-1`** (Windows `ci:local`) is `Lane: O` and unstarted; it blocks the device agent's local
  gate, leaving CI as its only one.
- **The `e2e`-on-device decision is open** — `connectOverCDP` attaches, but the specs write into
  the production account.

<a id="2026-09-23-chore-or-131-drop-handoff-nag"></a>

# 2026-09-23 — `chore/or-131-drop-handoff-nag` (OR-131)

**Orchestrator, Lane O.** The `Stop` hook that warned about context usage is gone, on the owner's
call: *"I don't think we need the handoff hook anymore; this is deprecated."*

## It contradicted the rule it was built to serve

`.claude/hooks/context-usage-warn.mjs` fired at each context threshold with:

> *Wrap up soon: invoke the handoff skill to write `docs/handoff-<date>-<title>.md` (commit + push
> it), then start a fresh session and read that doc first.*

CLAUDE.md now says the opposite, in the session-start rule: **a standing agent is meant to run as
one continuous session per role** — *"rely on Claude Code's automatic context compaction rather than
writing a handoff and spawning a successor just because context is getting long; that keeps cached
tokens working for you instead of resetting them."* Handing off is the exception now — an owner
reset, or a session lost outside anyone's control — not the routine end of a generation.

So the hook was instructing every long-running session to do the thing the contract tells it not to.
A warning that fires correctly and recommends the wrong action is worse than none: it is credible.

## What it was reporting, which is its own small lesson

The message read **"~231% (461k/200k tokens)"**. The hook's own default window is **1,000,000** —
raised from 200k on 2026-08-17 precisely because the smaller number *"reported ~111% at 222k tokens
(22% of the real window) and fired the wrap-up warning while there was still most of a session
left."* Nothing in this repo sets `CONTEXT_WINDOW_TOKENS`, so the 200k came from outside it.

**The hook could not see the number it was dividing by.** A monitor whose denominator is supplied by
an environment it cannot inspect will eventually report a confident percentage of the wrong thing —
and this one did, twice, in opposite directions.

## Removed

- `.claude/hooks/context-usage-warn.mjs`
- the `Stop` entry in `.claude/settings.json` (the `SessionStart` hook that provisions the local
  Postgres is untouched and still the only one)

## On a compaction hook — it would not do anything

The owner asked whether a hook could instead compact the conversation to save tokens while it is
cached. **A `Stop` hook cannot**: it receives the transcript path on stdin and can print, and
nothing more — it cannot invoke `/compact` or any other slash command, which are the CLI's own.

More to the point, **the thing it would trigger already happens.** Automatic compaction is a harness
behaviour and is exactly what the session-start rule tells a standing agent to rely on. A hook here
would be a second mechanism racing the first.

## Not done

Nothing is left behind for a successor to find. The two historical docs that mention the hook
(`docs/handoff-2026-08-17-platform-context-warning-window.md` and the 2026-08-15 history) are
records of when it was tuned and stay as they are — an archive that describes a thing that existed
is not stale.

<a id="2026-09-23-chore-or-132-owner-decisions"></a>

# 2026-09-23 — OR-132a: four owner answers, and a date that was already in the database

**Branch:** `chore/or-132-owner-decisions` · **Lane:** O · docs and queue state only

**⚠ This is `OR-132a`, not `OR-132`.** Lane A filed a real queue entry as `OR-132` the same day
(*"five PRs are dead from the shallow-fetch defect"*) while this work was in flight under the same
number. Theirs is the canonical one — it is in the queue, this never was — so this takes the letter
suffix per CLAUDE.md's duplicate rule. The branch name keeps the old spelling because renaming it
would cost a second PR for nothing.

**`check-backlog-pointers.js` could not catch this**, and that is the point worth carrying: it fails
on a duplicate ID *inside the backlog*, and this collision was between a queue entry and a PR that
never filed one. Two sessions of the same role, neither able to see the other's unmerged work —
the exact shape CLAUDE.md warns about, in the one place the check does not reach.

The owner turned gesture navigation on, which revalidated the largest group of owed device checks,
and asked what else needed unblocking. Four questions went out; all four came back the same sitting.

| # | question | answer |
|---|---|---|
| 1 | DV-6 — a scrim behind the status bar on scroll? | **Gradient, in the shell, once** |
| 2 | LA-126 — the live nutrition targets, or the computed ones? | **"the corrected/calculated numbers only"** |
| 3 | BF-137 — the vial predates its own first dose; which is true? | **Vial opened the same day as dose 1** |
| 4 | How long should a device sitting be? | **45–60 min, clear a whole area** |

`Gate: owner` count: **104 → 102**.

## What changed

**DV-6 released.** A gradient rather than a solid strip, so the app stays edge-to-edge; in the shell
rather than per screen, because a per-screen rule is one every future screen can forget — which is
how this reached a device sweep in the first place.

**LA-126 released, with a constraint the answer created.** The owner wants the computed targets, and
**LA-125 now has to ship first**: the recommendation route serves 42 g fat / 143 g carbs where
`calculateBaseline` computes 39 / 150, so applying today would hand him the clamp's numbers while
telling him they are the baseline's — the one thing he did not ask for. Sequence is LA-125 → RV-66
re-run → he applies.

**The decision does not authorise a write to his data, and the entry's own instruction stands.** He
chose the outcome, not the mechanism. `nutrition_targets` is production data; the apply is one tap
in the sheet and it is his. He is moving 1,660 → 1,359 kcal and 150 → 111 g protein, which is a real
cut of three weeks' eating, not a correction.

**LA-125's own gate released too.** It existed so the owner saw the fat number before it shipped;
he now sees it at the point that matters — the sheet shows 39 g before the tap. A gate whose
protection is already built into the flow it guards is ceremony. The structural half (which formula
is authoritative) was taken here rather than put to him: **move the 0.6 g/kg floor into
`calculateBaseline`**, so the baseline is already safe and the clamp becomes a redundant guard
rather than a second opinion. Deleting the floor instead is rejected outright — the calorie floor
beside it is load-bearing for every cutting user. Reversal: one function, one test file.

**BF-137 released, and it did not need him for the part it was blocked on.**

## The part worth carrying

**BF-137 had been asking the owner for a date the database already held.** The entry estimated the
first Retatrutide dose at *"around 2026-09-04"* from a window count and named correcting it as the
owner action blocking the build. One query:

| dose | log_date | taken_at (Brisbane) | amount |
|---|---|---|---|
| 1 | **2026-09-07** | — NULL — | 0.5 mg |
| 2 | 2026-09-13 | 20:00 | 1 mg |
| 3 | 2026-09-20 | 20:46 | 1 mg |

The drug start is 2026-09-07, exactly, and was all along. Reading the table before writing the
prompt replaced a three-day-wrong guess with a fact and turned a blocking owner action into a
non-blocking one.

The owner's answer then earned its place on the question the data genuinely could not settle:
`opened_on` said 2026-09-10, three days *after* dose 1, so either the vial date was the auto-set
artefact BF-136 was filed about or dose 1 came from a different vial. He says same day — so the
field is wrong, and BF-184's "dose 1 predates the vial" observation resolves with it.

**Ask for the fact nobody has, not the fact nobody looked up.**

**The durable half:** build the exclusion on the **dose log**, never on `opened_on`. The exclusion
wants when the drug started; the vial field answers when this vial was mixed. They coincide here and
will not on the next vial — and the dose log gave the right date while the vial field was three days
out, which is the argument in one line.

## Not done

- **No code shipped.** DV-6's scrim is Lane B's, LA-125 and LA-126 are Lane A's. This PR records
  decisions; it does not act on them.
- **Dose 1's `taken_at` is still NULL** and nobody knows why the first log took the no-time path.
  That stays open in BF-184 as a code question, not an owner one.
- **The vial's `Opened on` is still 2026-09-10 in production.** Correcting it is one tap in the app
  and it is the owner's; nothing is blocked on it.

## Gate

`pnpm ci:local` — exit 0, **Ran 75 of 75** Custom Rules steps, unpiped. Docs and queue state only;
no product code, nothing to exercise on the device.

<a id="2026-09-23-chore-or-134-device-gate-triage"></a>

# 2026-09-23 — OR-134: `Gate: device` was doing three different jobs

**Branch:** `chore/or-134-device-gate-triage` · **Lane:** O · queue state only

The owner asked whether device-testing items had actually reached the DV agent. `OR-133` made them
*visible*; this asks whether the ones now visible are really the device agent's to run.

They are not all the same kind of thing. **`Gate: device` is carrying three meanings that lead to
opposite next actions**, and nothing in the field distinguishes them:

1. **A check the phone can settle** — the entry has shipped or reproduces on the APK. This is the
   Device Verification agent's work and the gate is correct.
2. **A build that has to happen first**, where the phone is how the result is *verified*. The gate
   parks buildable work behind its own verification, so nothing can ever discharge it.
3. **Hardware that is not in the building** — a Colmi R09, not the S25. No sitting and no lane can
   hurry it, and the DV agent cannot touch it.

## Kind 2 — two circular gates released

Same shape as `BF-165` and `LA-49` earlier this month: *a condition for becoming startable that can
only be met by someone who can already start it.*

**`LA-115`** read *"needs a new APK and an on-device Health Connect permission grant"*. Both true,
neither blocking — the fix is a patch to the pinned plugin's `RecordConverter`, Kotlin, compile-gated
in the sandbox like every other `android/**` change. The APK and the grant are how it is **verified**,
and they can only follow the build.

**`TN-44`** read *"every new type needs a plugin patch and a new APK"* — which is a description of
the **work**, not a reason it cannot start. Worse: this entry carries an owner decision from
2026-09-17, eight lines below the gate, **not to block** and to build against synthetic data. A gate
contradicting a decision recorded on its own entry is the clearest possible case of a field nobody
re-read.

Both now carry what is genuinely owed — a `Verify: device` after the build, where the
external-field rule applies: a wrong key reads as `undefined`, so a green build proves nothing.

Gates: **102 → 100.**

## Kind 3 — marked, not released

`PS-8`, `PS-9` and `PS-16` are gated on the **Colmi R09**, which is with a second wearer. The gate is
correct and the entry is genuinely blocked; what was wrong is that it read as owed *device-check*
work, which invites the DV agent to pick it up and the owner to feel it is theirs to clear. Each now
says outright that it is not an S25 sitting and is waiting on hardware returning.

## The finding I did not act on, and why

**Three entries carry a bare `Gate: device` with no reason after it** — `Q-168`, `Q-7b`, `PS-12`. A
gate with no clause cannot be evaluated: it does not say whether the phone is needed to build, to
check, or because hardware is missing, and those lead to three different next actions.

**Deliberately not released.** Two of their neighbours turned out to be circular and one guards
hardware that is not here — so un-gating on the assumption that this one is circular too would be
exactly the unchecked move that created the problem. They are flagged where the next person to touch
them will read it: write the reason or remove the gate.

That is the general rule worth keeping: **a gate is a claim, and a claim with no reason attached
cannot be discharged by anyone except the person who wrote it — who is gone.**

## And the half of OR-130 I missed, found by its fourth occurrence

The gate run for this PR failed on `app/api/user/goals/route.ts` — byte-identical to `main`, named
as this branch's new violation. That is OR-130's bug, whose fix shipped this morning.

**The fix did not fire, and the log proved why: no warning appeared.** So the base read did not
fail. OR-130 instrumented `fileAtBase`, the path where a *per-file* read fails. **That is not the
path that fires.** When no base ref resolves at all, `fileAtBase(null, …)` returns `null` without
consulting git — so no per-file warning can exist — and `verdict` turns that `null` into `'fail'`.

The ratchet then runs in **absolute mode** while its output still reads as a judgement about the
branch. Four occurrences, and every one of them spent its diagnosis on the wrong half.

`resolveBaseRef` now says so when it comes up empty, naming the refs it tried. **No verdict changes**
— absolute mode is stricter than the base-aware one and stays exactly as it is. What changes is that
a reader can tell which mode produced the answer in front of them, which is the whole of the defect.
The ref list is injectable so the path is testable; callers pass nothing.

**This does not belong in a docs-only triage PR** and is here because it blocked it: the gate could
not go green without it. Said plainly rather than filed as a tidy coincidence.

### Then the flake hit a fifth time, and the reason no warning ever fired is measured

`execFileSync`'s return value is **stdout only** — verified: a child writing to stderr does not
appear in it. The ratchet scripts are spawned that way by their own tests, and
`strict-schema-inert.test.ts` asserts on exactly that return value. **So a warning written to
stderr cannot appear in anything that test sees or reports.**

Across five occurrences, *"no warning fired"* was taken as evidence **three times** — including the
conclusion earlier in this very entry that the no-base path must be the one firing. It was never
evidence. The diagnostic was being written where the observer structurally could not look.

Both warnings move to stdout, with two tests pinning it: one proving `execFileSync` drops stderr,
one proving a spawned `base-ref` run reports its warning. **No verdict changes** — this is where the
message is written, not what the ratchet decides.

**A diagnostic in the wrong stream is worse than none, because its silence reads as information.**
That is the lesson of OR-130 and OR-134 together: OR-130 built the warning and this is the first
occurrence where anyone could have read it.

**The flake itself is still undiagnosed** at five occurrences. What changes is that the sixth will
say something.

## Not done

- **The other 18 of the 24 are not individually classified.** The three kinds are now named and the
  clearest cases of each are fixed; the rest need the same read and it is real work, not a sweep.
- **No product code**, no device run, nothing to exercise on the S25.

## The compaction sweep rode along, because the gate said it was mine

The entries directory hit **61 against a 60-file runaway limit**, and the check named the reason
this PR had to deal with it: *"This branch adds 1 of them, so the sweep is yours: you are already
here."* A threshold that lands on whoever happens to cross it is the right design — it cannot
accumulate into a chore nobody owns.

`node scripts/fold-journal-entries.js --limit=25` (dry-run first) folded 25 entries into
`history-2026-09-23-folded-1.md`, held back 6 cited by an agent baton, and rewrote citations in two
domain indexes. 73 → 48 loose entries.

The script's closing instruction is worth repeating because it is the right instinct: *"now run
`check-doc-links.js` and fix what it names — do not reason about which links moved."* Run: **OK, 838
files checked.**

## Gate

`pnpm ci:local` — exit 0, **Ran 75 of 75** Custom Rules steps. Full log kept, not tailed.

<a id="2026-09-23-chore-or-135-assign-every-entry"></a>

# 2026-09-23 — OR-135: the DV lane has work in it for the first time

**Branch:** `chore/or-135-assign-every-entry` · **Lane:** O · queue state + one rule

The owner asked for everything to be assigned to an agent, with device work reaching the DV agent.
`node scripts/next-item.js --lane DV` now prints **9 READY**. It printed 0 before.

## The rule, in his words

> *"Only device testing that can be done by DV goes to DV; if its device testing based on
> looks/design that should stay in orchestrator waiting for user input."*

So a lane names who acts **next**, and for the device that means what the phone can **answer** —
a measurement or reproduction with an objective pass/fail — rather than everything the phone is
involved in. A judgement about looks or layout goes to the Orchestrator and waits for him, even
though the phone is where he will look at it. `DV-6`'s status-bar scrim was correctly his call.

## What actually moved, and it is smaller than the first plan

**16 entries carried no lane at all** — every one a `DEVICE PROBE`. They split:

- **9 outstanding → `DV`.** Each states it has no build half and names its own method. The
  measurement is the deliverable.
- **7 already run on the S25 → `O`.** Their results are recorded in the entry; the device is no
  longer what they need, their findings need filing. **Re-running a probe that has answered is the
  device agent's time spent on a question nobody is asking.**

`Q-253` (a paid real-hardware device farm) is **struck** — owner: *"Drop it — the real S25 is
better."* It was filed before the DV agent existed; breadth across devices he does not own loses to
the one device he does.

`PS-8`, `PS-9`, `PS-12`, `PS-15`, `PS-16` stay queued, marked **waiting on hardware, not on the
device agent**. They name the Colmi R09, not the S25, and the owner confirms it is coming back.

## Three traps, each of which mis-assigned real entries

**(a) "The agent can run the check" is not "the entry belongs to DV".** `RV-143` — Review's
independent filing of this same finding, hours earlier — listed ~13 entries as runnable by the
agent. **Three of three I sampled should not go to DV:** `Q-418`'s remaining work is Kotlin and an
APK, `LA-36`'s is a local-store read mapper, and `BF-49` was already reproduced on device pass A2,
so its next act is Lane B's fix. Bulk-applying that list would have mis-assigned about a dozen
entries — and RV-143's own text says to read each against its entry rather than trust the split.
It was right.

**(b) A probe that has already run is no longer DV's.** Seven of sixteen, which nothing in the
queue distinguished.

**(c) The `Verify:` field was doing the opposite of its job on these entries.** It means SHIPPED,
so the 9 outstanding probes filed under *"done; a look is owed, nothing is blocked"* — which is
exactly why the DV lane read 0 while holding its entire queue. The field is replaced with plain
prose naming the measurement as the deliverable. **This is the mirror of RV-143's warning** (never
convert a gate into a verify to gain visibility) and rests on the same reasoning: that field is a
claim that work has shipped, and applying it to unbuilt work hides the work.

## One mistake worth recording

The first pass at this corrupted seven entries: I built a list of regex matches and then mutated
the string inside the loop, so every insertion after the first landed at a stale offset — one
spliced into the middle of the word MEASURED. Reverted and redone iterating in reverse. **It was
caught by reading the result rather than by any check**, which is the argument for looking at what
a bulk edit actually produced.

## The DV lane gaining entries broke a test, and the test was the wrong one

`next-item-visible-silence.test.ts` — written this morning for TN-61 — asserted that `--lane DV`
output *"does not contain `showing`"*, using DV as its everything-fits case **because DV was empty
at the time**. The moment it held 9 entries the assertion failed, on this: `RV-128` is titled
*"does the tab switch drop a frame **showing** neither panel?"*

A substring assertion over a report that prints **user-written titles** is a false positive waiting
for someone to write the word. It now matches the truncation line's actual shape and checks the
READY count is genuinely under the cap, so it tests the behaviour rather than a word.

Worth noting against the entry it came from: TN-61 was about a tool whose silence could not be
distinguished from absence. Its test then made the mirror error — asserting on a token that could
appear for an unrelated reason.

## Not done

- **The remaining ~107 device checks still sit on their building lanes.** That is correct for most
  of them by trap (a) — the next act is a fix, not the phone — but each needs its own read, and
  that is real work rather than a sweep.
- **`RV-143` is not struck.** Its tooling half shipped in OR-134; its triage stays as reference,
  now with the caveat that its axis is not the lane axis.
- **No product code**, no device run.

## Gate

`pnpm ci:local` — exit 0, **Ran 76 of 76** Custom Rules steps. Full log kept, not tailed.

<a id="2026-09-23-chore-or-136-device-gate-reasons"></a>

# 2026-09-23 — OR-136: the three gates with no reason, and a gate that blocked its own lane

**Branch:** `chore/or-136-device-gate-reasons` · **Lane:** O · queue state only

`--lane DV` goes **9 READY → 11 READY, 0 PARKED.** Three entries carried a device gate with no
reason after it; none of the three turned out to mean the same thing.

## The three

**`Q-168` — the reason was written, just not beside the field.** Its own *What is actually left*
section says it plainly: `/coach` and `/coach/confirm/[toolCallId]` are navless full-screen routes
with bottom-anchored controls, the shape that has regressed 11+ times, and the AI Coach section of
the smoke checklist is what settles it. **Reassigned from `B` to `DV`** — that check is one the
phone answers, because a bottom-anchored control either clears the gesture bar or it does not and a
safe-area inset is a number rather than a matter of taste. The cardio-goals half was dropped rather
than built, so nothing waits on Lane B. A FAILED result goes back to B with what reproduces it.

**`Q-7b` — the gate was simply wrong.** Nothing in it is a question the phone answers: ten
`oura_daily_derived` columns have no producer, which is engine work, and the producer they wait for
is the on-device rollup — `Q-545`'s build. Recorded as a dependency on Q-545 instead of a gate
nobody could discharge.

**`PS-12` — already answered.** OR-135 had written its reason the day before (it waits on the Colmi
R09, not the S25). The flag was stale.

## The shape that kept appearing: a gate naming its own lane

Removing Q-168's gate surfaced `DV-8` sitting under PARKED with `Lane: DV` and `Gate: device` — the
device agent's own work, hidden from the device agent by a gate naming the device agent. **A gate
names what someone ELSE must do first. When the lane and the gate name the same actor there is
nothing to wait for**, and the entry is simply that actor's work.

Filed by the device agent itself, which is how easily this hides. Q-168 acquired the same shape the
moment it moved to DV, and removing it there was the fix rather than a second thought.

## And then a decorative glyph parked it

With the gate off, Q-168 moved to **UNMIGRATED MARKER**. Its line opened `⛔ Device verification —
the blocking one`, and the queue parser reads that glyph followed by *block* within forty characters
as a real marker. The glyph was decorative; *"the blocking one"* was prose.

That is **`TN-59`'s class caught live** — an entry parked by a prose marker alone, invisible to
everyone. Reworded rather than left: say what blocks in words, keep the glyph for a field.

## Worth carrying

Three entries, one symptom, three different causes: a reason written in the wrong place, a gate that
was factually wrong, and a flag that was already stale. **Bulk-releasing them on the assumption they
were all circular would have been wrong twice**, and OR-134 said so when it declined to guess. That
restraint is what this entry spent.

## The same test broke again, for the same underlying reason

`next-item-visible-silence.test.ts` failed a second time in two passes. This morning it asserted the
DV output *"does not contain `showing`"* and went red when `RV-128` — *"does the tab switch drop a
frame **showing** neither panel?"* — entered the lane. I fixed that by matching the truncation
line's shape, **and left the other half of the mistake in place**: it still used DV as its
everything-fits case, hard-wiring the fact that DV was small. Today DV reached 11 and it went red
again.

Both failures are one error: **the test encoded a fact about the data rather than the behaviour.**
It now asserts the invariant across every lane — the truncation line appears if and only if the cap
hid something, and its total matches that lane's READY count. **A test that names a lane is a test
that expires.**

## The finding I was about to file already existed

Q-7b's body carries a paragraph reading *"New detail worth chasing separately: `/api/training-stress`
does compute and persist an OTS, yet `training_load_ots` is empty across the entire history"*. It
reads as an unfiled finding, and the No-orphaned-findings rule says an unfiled finding is a dropped
one — so the plan was to open an entry for it.

**It is `Q-270`, and Q-270 is far past that note.** 🔴, re-measured **0 of 104 days** on 2026-08-30,
with all four gates ruled out individually *and* the MET gate shown to clear by ~12:07 local rather
than late evening. A new entry would have been a worse duplicate of a well-developed one.

**The only thing that stopped it was grepping the column name before writing.** Q-7b now points at
Q-270 outright, so the next reader does not make the same move. **A paragraph that reads like an
orphan is not evidence of one** — the rule says file what is unfiled, not file what looks unfiled.

## The prose-marker scan (TN-59), run but not acted on

Scanning for the shape OR-136 caught live — the block glyph followed by *block* within forty
characters — returns **5 entries**: `RV-99`, `Q-538`, `Q-1b`, `Q-34`, `PS-7`.

They are **not one class**, which is why the first pass stopped at the scan.

**⚠ That scan was wrong in two places, and re-running it before acting is what caught it.** It named
five entries; the regex actually matches **seven locations, five of them queue entries**, and the
membership differs. `PS-7` is **not** among them — the fifth is the `▶ Oura on-device models
program`, whose *"activity detection (P3) ⛔ blocked — needs daytime raw motion"* is a genuine
block. Two further hits are in the `## Protocol` and `## Queue` prose, where the marker is being
**documented** rather than used, and must stay.

**More importantly, the remedy count was wrong.** Only **one** of the five was actually parked *by
the marker*: `Q-538`, `Q-1b` and `Q-34` each already carry a real `Gate:`/`Needs:`, so the tool
never reported their glyph at all, and their prose is honest — `Q-538` and `Q-34` genuinely are
blocked, and `Q-1b` is parked twice over (`Gate: owner`, plus a genuine marker further down; its
meta mention is an accurate description, not a defect). **None of those three needed an edit.**

The earlier reading came from `grep -B2`, which showed a `Gate: device` belonging to the *preceding*
entry as though it were `RV-99`'s. Reading one entry's own output settled it.

## TN-59, built

`RV-99` was **a false park**: its only reason was *"⛔ The blocking hazard was NOT the one the entry
named"* — a **correction** recording that the hazard the entry had originally named was the wrong
one, which is the opposite of a reason not to build it. No `Gate:`, no `Needs:`. It had been
startable the whole time, sitting in Lane B's PARKED list. Reworded to *"The real hazard"*; Lane B's
READY went **23 → 24**.

One entry is not worth a check on its own. What is, is that the shape regenerates: line 23892 of the
backlog already predicted *"[the entry drops] under UNMIGRATED MARKER the moment its gate came
off"* — which is exactly what `Q-538`, `Q-1b` and `Q-34` will do, since each is held today only by a
gate that will one day clear. So the check earns its place on the three entries that are **currently
passing**, not on the one that failed.

- **`scripts/lib/backlog-entries.js`** — the queue parser, extracted from `next-item.js`. The tool's
  own comments make this argument: `lane.js`, `keep.js`, `reference.js` and `queue-buckets.js` were
  each pulled out to be testable, and the same file records the lane rule being briefly
  re-implemented inline and drifting within a day. A second copy of the `⛔ block…` regex would fail
  more quietly still — an entry parked in one reader and ready in the other.
- **`scripts/check-prose-parked-entries.js`** — fails on an entry parked by the prose marker with no
  `Gate:` and no unmet `Needs:`. **Baselined at zero**, the strongest baseline a shrink-only check
  can have. It reports the *shape* and refuses to guess which kind of marker it is reading — TN-59's
  own load-bearing caution, and the reason the bare-glyph rule was retired at a 75% false-positive
  rate. Wired into Custom Rules: **Ran 77 of 77**.
- **8 tests**, against synthetic queues, because the real backlog is at zero and therefore cannot
  exercise a single judgement the check makes. The offender rule lives in the lib and is *imported*
  by both the check and its tests — the first draft restated it in the test, which is the drift the
  extraction existed to prevent.
- Verified by reverting `RV-99`'s wording and watching the check fail with that entry named, then
  restoring it. A check never observed failing is not a check.

## The goals-route flake — occurrence six, and the first hard evidence

`strict-schema-inert.test.ts` failed again mid-gate, reporting
*"`app/api/user/goals/route.ts` has 1 non-strict request schema(s) and is not in the baseline"*. Run
directly, seconds later, the same check printed **OK — 38 non-strict across 24 files (baseline
held)**.

**Why five occurrences produced nothing.** `execFileSync` returns stdout on success, but on a
non-zero exit it throws an error carrying only the command and stderr — `err.stdout` is a separate
property, and the test printed the error. The base-ref helpers warn on **stdout** by design, so if a
warning had fired it would have been discarded. *"No warning fired"* was used as evidence in three
of the five diagnoses, against a stream nothing was reading. This is the second time in two days
that this property of `execFileSync` has produced a false finding.

`run()` now re-throws with **both** streams labelled. It fired on this run — and the result
**refuted the hypothesis it was added to confirm**:

> **stdout was empty.** No base-ref warning at all.

That eliminates the leading theory. `resolveBaseRef()` returning null warns; `fileAtBase` exhausting
its retries on an unreadable read warns. Neither happened, so the base ref resolved and was read
cleanly. What reached `verdict()` was therefore either **the file reported absent at base** or **a
base count of 0** — and `verdict()` collapses absent, zero and a real number into one word, which is
precisely why six occurrences could not be told apart.

So the check now **reports what it saw**: `(base origin/main: 2 non-strict)` or `(base …: file
absent)` on every failure. Measured immediately after, on a quiet tree: base ref `origin/main`,
file present at 3,870 bytes, byte-identical to the working copy, check green.

**Still undiagnosed, and the trigger is still unconfirmed.** What changed is that occurrence seven
cannot be ambiguous: it will name the base ref and the count that produced the verdict. Two
hypotheses remain open and the evidence does not yet separate them — a concurrent `git fetch` from
another agent moving `origin/main` mid-run, or a genuine transient path-absent from `git show`.

## Not done

- **The remaining ~105 device checks stay on their building lanes.** Most correctly so.
- **`Q-7b`'s separate finding is untouched**: `/api/training-stress` computes an OTS yet the column
  is empty across all history, so its gating conditions are never met in practice — a live route
  returning gated forever, which is a different failure from "no producer exists". It stays in the
  entry, unfiled, and should become its own item.
- **No product code**, no device run.

## Gate

`pnpm ci:local` — exit 0, **Ran 77 of 77** Custom Rules steps (76 before this branch added
`check-prose-parked-entries`). Full log kept, not tailed.

<a id="2026-09-23-chore-or-139-report-triage-loop"></a>

# 2026-09-23 — the Orchestrator reads in-app reports, and can stop re-reading them

Orchestrator. Docs-only. Branch `chore/or-139-report-triage-loop`.

## What the owner asked for

> *"i want this agent to be able to read reports sent within the app — through the report feature.
> Can you make this happen? So you review; then assign it to a lane and clear it."*

## The capability already existed, and that is the finding

*Report an Issue* on `/more` (`components/more/feedback-section.tsx` → `POST /api/feedback`) writes
to `feedback_submissions`, and **`claude_ro.feedback_submissions` has been exposed since migration
142**. It was read live this session with the ordinary admin db-query endpoint before anything was
written. So no new access was needed — what was missing was **a line telling sessions to read it**
and **a way to stop re-reading the same report forever**.

Worth stating plainly because it nearly became a build: the answer to *"can you make this happen"*
was mostly *"it already does"*.

## The feature has essentially never been used

Measured 2026-09-23:

| | |
|---|---|
| rows visible in `claude_ro.feedback_submissions` | **0** |
| `feedback_submissions.n_tup_ins` (lifetime inserts, a counter not an estimate) | **1** |

The view is **row-scoped to the owner** like every `claude_ro` view, so that single report belongs
to someone else and is invisible here by design. **A zero from this read means *none of the
owner's*, never *nobody has reported anything*** — the same trap the `error_events` rule already
records, in a new table.

That number drove the design rather than decorating it: see below.

## Two owner decisions

**Clearing is a watermark in the Orchestrator's baton, not a status column.** Offered against a
migration adding `status`/`triaged_at`/`backlog_id` plus a Lane B surface so a reporter would see
*"triaged → LB-xyz"* in the app. The owner took the watermark. **The argument that decided it is the
usage number**: a migration and two lanes' work is a lot of machinery for a feature with one
lifetime submission, a migration's revert is a corrective migration, and a line in a markdown file
costs nothing to abandon if reports start arriving and the answer changes.

**The screenshot gap is real and is now filed.** The view withholds `screenshot_data` and exposes
`octet_length(...) AS screenshot_bytes`, so a UI bug arrives as *"screenshot, 240 KB"* — and for a
layout or rendering fault reported from a phone, the picture is most of the report. The owner chose
to fix it. **Not by adding the column to the view**: it is a base-64 data URI up to 500 KB, which
would drag into every `SELECT *` on that table and make the endpoint unusable for ordinary triage.
Filed as `OR-137` for Lane A — a route returning **one** screenshot by id, carrying the same owner
scoping the view uses, and explicitly marked not urgent.

## What shipped here

- **`CLAUDE.md`** — the report read joins the session-start list beside `error_events` and the
  database size, with the query, the loop, and both things the read cannot tell you.
- **`docs/agents/state/orchestrator.md`** — the watermark, starting at the epoch, with the rule for
  moving it: only once every report above it has become a backlog entry or been recorded as
  not-a-defect with its reason.
- **`docs/implementation-backlog.md`** — `OR-137` for the screenshot route.

**The loop is read → review → file with a lane → move the watermark.** A report is never answered by
replying to it; it becomes a queue entry, per **No orphaned findings**.

## Reading the reporter's data — the owner widened the scope

Second owner request the same session:

> *"The orchestrator or a set agent should be able to use the claude read only feature and read the
> data of the user who made the report. The app is in development mode so each user has consented to
> having their data used for training."*

**No migration is needed, and that is the finding that makes this small.** Every `claude_ro` view
already filters on `current_setting('app.claude_ro_owner', true)::uuid` — Q-456 moved them off the
hard-coded id. The views do not change. What is fixed is **where that setting comes from**:
`bootstrapClaudeRoOwner` issues `ALTER ROLE claude_readonly SET app.claude_ro_owner = '<uuid>'` once
at boot, binding the scope to the **role**, globally, for every request.

So the change is one endpoint: an optional `userId`, applied as
`BEGIN; SET LOCAL app.claude_ro_owner = '<uuid>'; <the caller's SELECT>; COMMIT`. Absent `userId`,
behaviour is byte-identical to today. Filed as **`OR-138`**, Lane A, third in the queue.

**`SET LOCAL` rather than `SET` is load-bearing.** The endpoint reads through a **pool**, so a plain
`SET` would persist on that pooled connection and silently re-scope whichever later request reused
it. That is a cross-request data leak, not a tidiness point.

**This is an auth/security change and the carve-out still applies** — it widens the endpoint from
*one user, structurally* to *whichever user the caller names*. The owner asked for it and the
consent basis is recorded. The entry recommends one restriction: **allow the pivot only to a user
who has actually filed feedback**, so the widening stays tied to the justification given. One
predicate to delete if he wants it broader later; the broad version cannot be un-shipped.

**A probe I did not run, deliberately.** The obvious next question is whether a caller can *already*
pivot today by sending a bare `SET` as its own statement — the endpoint rejects SQL containing a
`;`, so it cannot be smuggled alongside a `SELECT`, but a lone `SET` on a pooled connection is a
different question. The attempt was blocked as credential exploration, which was the right call: the
answer came from reading the route instead, and the entry records it as **unverified** rather than
asserting it either way. If it does stick, the current single-user guarantee is already softer than
it reads.

## Not done

- **No report was triaged**, because none of the owner's exist. The loop is armed, not exercised.
- **No product code**, no migration, no device run.

## Gate

`pnpm ci:local` — exit 0. Full log kept, not tailed.

<a id="2026-09-23-device-bf166-mid-workout"></a>

# 2026-09-23 — BF-166 verified in full on the S25, and the leave-workout prompt's *Leave* does not leave

**Branch:** `device/bf166-mid-workout` · **Agent:** Device Verification · **Docs only.**

Second sitting of the day, after #1417. The owner switched the phone to gesture navigation and OK'd
starting a workout on his account for BF-166's last check, on condition it was deleted afterwards.

**What I was on:** S25 Ultra, Android 16, APK 1.460.4, web v1.465.4, portrait, **gesture navigation**
(`navigation_mode` 2 — `probe.js` now reads a **15px** bottom inset, against 48px under three-button),
system back via `adb shell input keyevent 4`, route from `location.pathname`.

## BF-166 — ✅ VERIFIED ON THE S25, and it leaves the queue

Workout → *Start Workout* → session screen → *Start Workout* → countdown → store `mode: "warmup"`:

| step | result |
|---|---|
| back | *"Leave workout?"* raised, route unchanged |
| back again, prompt open | prompt **stays** — the ordering the listener's comment requires |
| *Stay* | prompt closes, still `warmup` |
| back, then *Leave* | store resets to `pre` — and see DV-2 |

With the first sitting's sheet checks (#1417) that is every part of the entry's `Keep:`. Its
Known-Issues row moved to `known-issues-resolved.md`.

## DV-2 — ❌ *Leave* keeps you on the abandoned session's screen

`onLeave` resets the store and calls `history.back()`, but the dialog pushed its own surface entry
when it opened and only **one** pop happens, so the back meant to leave the screen is spent on that
entry. Traced twice with `history` instrumented. BF-165's mechanism in a dialog instead of a sheet,
so it is batched with BF-165 (`back-gesture-sitting`, Lane B). The walk and activity leave dialogs
carry the same `onLeave` and were not device-checked.

## Production data — nothing to delete

Starting a workout is a store-only action; the server hears about a workout only when a set is
logged (`workout_log`) or it completes (`complete_workout`). A `fetch` wrapper logged every non-GET
for the whole test: the only one was `POST /api/ai-periodization/session/<id>/prescribe`, which
opening any session screen sends. `GET /api/workout-sessions/day?date=2026-09-23` returned
`sessions: []` afterwards. Side effect worth knowing: *Start* also calls `cancelWorkoutReminder()`
three times over this test; `reconcileWorkoutReminder` re-arms today's reminder on its next pass.

## Also

- **Node upgraded on the device machine** to 22.23.2 (winget `OpenJS.NodeJS.22`), at the owner's
  instruction; `pnpm exec vitest run` now starts. DV-1's Node half is done here.
- **My first attempt pressed back during the start countdown**, before anything was active — back
  then correctly left the screen. Recorded in the baton so it is not mistaken for a failure again.
- PR #1411 is left for the Orchestrator to close, per the owner.

## Not exercised

The walk and activity leave dialogs, the `active` phase (only `warmup`), any set logging, landscape,
light theme, and every safe-area check (valid now, not yet run).

<a id="2026-09-23-device-first-run"></a>

# 2026-09-23 — First sitting on the real S25: three shipped fixes verified, one bug reproduced, and the harness works

**Branch:** `device/first-run` · **Agent:** Device Verification (new, local) · **Docs + `scripts/device/**`.**

The owner plugged the S25 into a local Claude session and asked for an agent that tests the APK
alongside the Orchestrator. The Orchestrator had already written the harness (OR-127, PR #1411)
without ever seeing a phone, plus a prompt for the role. This session became that role, ran the
harness for the first time, and worked the `back-gesture-sitting` batch plus BF-111.

**What I was on for every result below:** Samsung SM-S938B, Android 16, WebView Chrome 152, APK
**1.460.4** (debug), web **v1.465.4** (production Railway), portrait, **three-button navigation**,
signed in as the owner. System back sent as `adb shell input keyevent 4`. Route read from
`location.pathname` in the page, never an inspector's address bar.

## Outcomes

| entry | outcome | evidence |
|---|---|---|
| **LA-109** | ✅ VERIFIED ON THE S25 | Home → More tab → *Profile details* (`/more/details`) → back → `/more`, More tab active (`text-brand`); screenshot matched |
| **LB-107** | ✅ VERIFIED ON THE S25 | back from `/health`, `/workout`, `/nutrition`, `/more` → `/` each time; back from `/` → focus on the Samsung launcher; relaunch "brought to the front", same pid 5517, same `performance.timeOrigin` — minimised, not finished |
| **BF-100** | ✅ VERIFIED ON THE S25 | `/more` scrolled, *Profile details*, back: 675→675 and 1075→1075, with the system back **and** the page's own back button; repeated after `am force-stop` (1075→1075). Details opened at the top each time |
| **BF-166** | ✅ VERIFIED, except one part | back closed the sheet and left the route alone on `/nutrition` (*My Foods*, *Add food*), `/` (mood check-in — app **not** minimised) and `/program` (*New Program*, where the first back closes the keyboard the autofocused field raised). **COULD NOT CHECK** the mid-workout leave prompt: it needs a workout started on the production account |
| **BF-165** | ❌ REPRODUCED ON THE S25 | Cardio → *Other activity* → *Treadmill*: `pushState(/activity)` at 1754 ms, the sheet's `back()` at **1761 ms**, `popstate` → `/cardio`. The harness saw a 415–428 ms gap; the device gives 7 ms |
| **BF-111** | ❌ the screenshot it waited on | About: `App v1.465.4` ✓, "Up to date — v1.460.4" ✓, **"built 23 Aug" ✗** — the rolling `apk-latest` release's `published_at`; the APK asset was uploaded 2026-09-20 |

LA-109, LB-107 and BF-100 left the queue. BF-165 stays READY for Lane B with the device trace and a
sibling close-then-push site (`components/cardio/time-picker-sheet.tsx`, unreachable on the owner's
account because it only renders without a running plan). BF-111 lost its owner gate and is Lane A
work now (`lib/github-release.ts:86`). Device checks owed: 104 → 100.

## What the protocol-only harness got wrong

It connected first time; the rest is recorded in `scripts/device/README.md` → *What the first run
corrected*. The ones that change what anyone does next:

- **Playwright's `connectOverCDP` attaches** to the WebView (98 ms, `/json/version` exposes a browser
  websocket). So `e2e/**` could run on the real APK — **but the phone is on the owner's production
  account and those specs write**. That is an owner decision, filed in the baton as blocked.
- **Three-button navigation reads a 48 px inset, not 0**, so "non-zero inset" had been taken as
  proof of gesture nav. `probe.js` now reads `navigation_mode` from Android. The phone is on
  three-button, so **no safe-area check is valid yet**.
- **The capture workflow would have published the owner's data.** The runbook said to push
  screenshots to a `device-captures/*` branch; the repo is public and every capture shows the
  owner's account (the first one showed his email). Changed to text-only; `device-probe/` is
  gitignored; `tour.js` says so when it finishes.

## Two traps I walked into, both caught before they became findings

- **`tap()` centres its target, which pins the scroll offset** — my first BF-100 run measured 825→825
  three times because 825 is where centring put the row. It proved nothing. Shift the scroller after
  centring, then tap without re-scrolling.
- **A focus check read `.stdout` off a helper that returns a string** and reported the app as
  backgrounded while it was on screen — which briefly looked like "back from `/health/readiness`
  both navigates and minimises". It does neither wrongly; the check was broken.

## Also

- Windows could not check out `main` at all: a stray file named `ord.endsWith('ss')||` (added by
  accident in #672) has a `|` in it. PR #1414 deleted it (merged the same day, before this
  PR), so a fresh Windows clone checks out cleanly now.
- New role written into `docs/agents/README.md`, `prompts/device-verification.md` and a baton at
  `state/device-verification.md`, with the `DV-` prefix. It runs locally, so its successor is opened
  by the owner, not by `create_session`.

## The local gate, stated exactly

`pnpm ci:local` on this Windows machine: **lint** 0 errors; **`check:rules` — `Ran 75 of 75`, 4 FAIL**
(steps 27, 30, 50, 68), every one a Windows path or shell problem in files this diff does not touch;
**typecheck** clean; **typecheck:tests** `spawnSync npx ENOENT`; **test** could not start
(`rolldown` needs Node ≥ 22.12, this machine has 22.9). Filed as **DV-1** (Lane O). So the test
gate for this PR is CI, and the doc checks were run individually: `check-backlog-pointers` OK
(416 entries), `check-doc-index-size` OK.

## Not exercised

Gesture navigation (the phone is on three-button), safe-area clearance anywhere, offline/airplane
mode, the local SQLite reads, any write path, the mid-workout back, landscape, `record.js` and
`tour.js` (not run yet), and light theme (everything above is dark).

<a id="2026-09-23-device-probe-sitting-2"></a>

# 2026-09-23 — Probe sitting 2: stopped by an incident the harness caused, and the guard that follows

**Branch:** `device/probe-sitting-2` · **Agent:** Device Verification · **Docs + `scripts/device/**`.**

Short sitting after the owner reconnected the phone (gesture nav, inset 15 px, web v1.465.4, APK
1.460.4). It was meant to finish BF-61's immediate-tap check and RV-133's 30-minute idle. It did
neither, and the reason is the most important thing in it.

## The incident

To test BF-61 — a swipe-to-delete tray whose first tap used to miss — I sent **raw `adb shell input`
taps and swipes**, which are real touches wherever the coordinates point. During those runs the app
left the Nutrition tab twice (to `/health/activity`, then to `/`) without the scripts noticing,
because the hidden Nutrition panel kept answering their DOM reads. Later raw taps landed **outside
the app**: the owner reported the app closed and another app (Tasks) opened on his phone, and he had
to reopen it himself. Nothing was written to his data — the only raw inputs were swipes and taps on a
diary row and a Cancel — but it was his phone, mid-use, and the harness had no guard against it.

**The fix is structural, not a note to be careful:** raw input now goes only through `rawTap` /
`rawSwipe` in `scripts/device/pw.js`, which refuse unless the app holds the foreground **and** is on the
expected path, checked immediately before sending. The runbook and the baton both say never to call
`adb shell input tap|swipe` directly.

## What was still learned

- **BF-61 is still COULD NOT CHECK**, and the entry now says why the three "failed" immediate taps were
  not evidence: the tray was already open before the swipe, and the tap aimed at the row, not Delete.
  A 1.5 s control tap opened *Edit Serving*, which is how that was caught.
- **Back from the *Edit Serving* sheet is correct** — one push, one pop, still `/nutrition` 3 s later.
- **A second swipe on an already-open tray does not change tab.**
- **Sitting 2's idle census never ran**: after the cold reload, `nav a[href="/"]` matched **two**
  elements and Playwright's strict mode threw. Tab-bar locators are scoped to the visible one now;
  whether the shell really mounts two tab bars after a reload is the first check of sitting 3.

## Not exercised

Everything the sitting set out to do: the idle measurement, BF-61's immediate tap, the remaining
write types, frames and the route census.

<a id="2026-09-23-device-probe-sitting"></a>

# 2026-09-23 — Probe sitting 1 on the S25: BF-177 fails on the device, and why the browser said it passed

**Branch:** `device/probe-sitting` · **Agent:** Device Verification · **Docs + `scripts/device/**`.**

First run of the Playwright-over-CDP tooling (#1424) against the phone, working Review's probe
checklist (`docs/device-agent-probe-checklist.md`, RV-124…RV-133). Web v1.465.4, APK 1.460.4,
portrait, **gesture navigation** (bottom inset 15 px), signed in as the owner, with his approval for
five write types, each undone straight after. The phone disconnected before the last steps.

## The finding that matters: BF-177 is FAILED on the S25

Logging a food from the Nutrition tab updates the diary and the ring, and **"kcal left" does not
move** — for 6 s sampled every second, and still a minute later — while the server already has the
right number. With response bodies captured the mechanism is plain: the hook's one-shot balance
refetch fires at the **local** write and reaches the server **~60 ms before the outbox push**, so it
gets the old figure; the correct post-push response arrives ~500 ms later on another subscriber's
request, and the card never takes it. The browser e2e is green because on the web path the write is
an awaited POST. That is the Canonical Runtime rule in one bug: *green on web, wrong on the device.*
BF-177 is back in Lane B's READY with the trace and a fix direction (subscribe the card to the key).

## The rest of the sitting

| probe | outcome |
|---|---|
| P4 layout sweep (RV-127) | Clean on clearance, `truncate`+flex, nesting. Spills looked at and benign. Three 21 px-tall inputs on `/more/details` left unjudged. Found **DV-4**: the Sleep card's Deep hours in `#1e3a70` ≈ 1–1.6:1 contrast |
| P7 console (RV-130) | 0 failed requests. **499+** *"Rendering was performed in a subtree hidden by content-visibility"* — layout forced inside hidden tabs, unattributed |
| P10 long session (RV-133) | Walk half flat by round 3 on heap, listeners, nodes, timers. Idle half not run |
| P3 local store (RV-126) | First read of the on-device SQLite. Tombstones present, food renders offline. Found **DV-5**: pushed rows left `pending` (33 food tombstones, one set) |
| P8 offline (RV-131) | Offline write on screen in 256 ms, queued, pushed 2.0 s after reconnect. No tab blank. No offline banner (probably not reachable by page emulation) |
| P1 invalidation (RV-124) | Food log and delete only → BF-177 |
| P2 fetch-once (RV-125) | Baseline without writes; not a verdict yet |
| BF-61 swipe-delete | Slow tap works; the immediate tap is still owed |
| P5/P6/P9 | Not run |

**DV-6** (owner-gated): scrolled content passes under the status bar's clock with nothing behind it.

## Harness, as used

Four fixes, all in `scripts/device/`, and each recorded in the README's new section: `home()` returns
through the router (four back presses after a sweep landed on `/cardio`); the sweep measures the
touch box, not the ink, and compares clearance with a 0.5 px tolerance; `census.js` records metrics
per round; `recordNetwork({ bodies })` keeps response bodies. `selftest.js` still 18/18.

## Production data

Five food writes over the sitting — log, delete, log, delete, offline log, delete — **all deleted**.
Afterwards the server returned **no Cocoa logs** for 2026-09-23 and intake back at **434 kcal**.

## Not exercised

The other four write types, every surface off the Nutrition tab except Home's card, the 30-minute idle,
the offline restart, frames (P5/P6), the route census, and light theme.

<a id="2026-09-23-device-probe-tooling"></a>

# 2026-09-23 — The probe tooling, built and self-tested while the phone was unplugged

**Branch:** `device/probe-tooling` · **Agent:** Device Verification · **`scripts/device/**` + docs.**

The owner asked what was waiting. Nothing was assigned in `Lane: DV`, but **111 device checks are
owed** (`--sittings`) and Review had filed **RV-124…RV-133** with a full method doc,
`docs/device-agent-probe-checklist.md` (P1–P10). Most of those probes need the network layer, the
local store, offline switching or long-session counters — none of which the harness had. So this
session built them, with the phone unplugged, and the owner approved all five write types the
write-based probes need (each deleted straight after).

## What was built

- **`pw.js`** — Playwright's `connectOverCDP` on the WebView socket, as the probes' driver. `tap`
  keeps the hit-test-before-touch rule and drops the centring that pinned BF-100's first
  measurement. Adds `recordNetwork` (over CDP, for initiator stacks), `recordConsole`,
  `watchAfter` (P1), `offline` (P8), `metrics` + `instrumentTimersAndReload` (P10), and a
  read-only `localQuery` against the app's own SQLite (P3).
- **`sweep.js`** — P4: bottom clearance against the real inset, horizontal overflow, sub-44px
  targets, `truncate` on flex, nested interactives. Reads the nav mode and refuses to vouch for
  clearance off gesture nav.
- **`census.js`** — P2, P7 and P10 in one tab walk: per-endpoint request counts by visit, every
  non-2xx and console message grouped, heap/listener/timer counts at start, end and after idle.
- **`selftest.js`** — all of the above against a local fixture in desktop Chrome, through the same
  `connectOverCDP` path. **18 of 18 pass.**

## The e2e question, answered

The owner asked whether running `e2e/**` on the phone was worth it. **Not as it stands**: 62 of
121 specs read or write the local test database, ~80 assume the seeded account, and the suite signs
in — which on the phone means signing the owner out, and sign-out wipes the device's local data.
What *is* worth it is Playwright as this role's driver, which is what `pw.js` is. A small
read-only phone regression pack stays optional, after the probes.

## Not exercised

Everything on the phone: none of `pw.js`, `sweep.js` or `census.js` has run against the WebView.
`localQuery` has only been seen refusing a write and reporting a missing plugin; whether the
plugin answers a query on the app's open connection is unknown. Whether `offline(true)` reaches the
service worker's requests on this WebView is unknown.

<a id="2026-09-23-device-sweep-1"></a>

# 2026-09-23 — Device sweep 1: the performance baseline, the approved writes, and a slowdown that builds with use

**Branch:** `device/sweep-1` · **Agent:** Device Verification · **Docs + `scripts/device/**`.**

S25 Ultra, web v1.465.10, APK 1.460.4, gesture navigation, owner's account. Run on his go-ahead with
his decisions recorded in `docs/device-sweep-1-plan.md`: weigh-in and mood overwrite accepted, only
the writes the checks need, the owner-present OS block skipped. The phone showed 🔴 throughout and 🟢
at the end.

## Performance — the first baseline this app has had

| probe | result |
|---|---|
| **P11 cold start** (RV-137) | first contentful paint **1020 ms**; tabs show content 61–103 ms after it, settle ≤ 1.4 s (Workout) |
| **P12 distribution** (RV-138) | **90 warm visits, no outlier** — every first visit ≤ 1.3× its route's median, slowest 164 ms. Q-51's 1086 ms did not recur, so by its own rule Q-51 should be re-placed, not built |
| **P13 waterfall** (RV-139) | Home fetches `/api/workout-data` twice per visit; Home and Health each have one 2-deep chain; the rest are flat |
| **P14 long tasks** (RV-140) | **every tab tap = one 68–118 ms task** in React's delegated click handler; scrolling produces none; `animationiteration` no longer shows at all |
| **P15 paths** (RV-141) | back stack correct in 2 presses; **RV-110 and RV-112's fixes hold** (same document across a cross-tab jump; separate scroll offsets) |
| **P16 + P10 long session** (RV-142, RV-133) | tab paint **61–103 ms → 126–434 ms after ~2 h of use, 134–449 ms after 30 idle minutes**; listeners 608 → ~2,200, flat while idle. Evidence for BF-22 |

## Writes (all undone, server checked after)

- **Food log + delete:** **DV-5's fix verified** — the new tombstone is `synced` straight after the push.
  **BF-177 still reproduces** on v1.465.10.
- **Weigh-in (RV-108):** logged today's own 69.4 kg. A weigh-in clears **3 of 202** cache keys. The
  local row kept every other column — `upsertBodyMetric` merges, so CLAUDE.md's warning about
  `metric-log-sheet` is stale.
- **Supplement tick (BF-185):** a re-ticked dose gets **`taken_at: null`**, not a rewritten time.
- **RV-45 verified and removed:** supplement and injury deletes, online and offline, no error toast.
  Filed alongside: **DV-10** (supplement deletes never tombstone locally) and **DV-11** (Manage
  Supplements' switches have no accessible name).
- **Mood (LB-116):** could not check — the sheet is unreachable once today's check-in is logged.
- **DV-4 verified and removed:** the Sleep card's hours now print in the foreground colour.

## Corrections I owe

- **DV-8's two headline claims were my misreading in sitting 1**: the session is in the local table,
  and the "server id" was the program session that `/api/workout-sessions/day` returns as
  `sessionId`. Corrected on the entry. A first pass today repeated the same misreading across 12
  sessions and was caught before it was filed — the repeating ids gave it away.

## Harness

`perf.js cycles` now saves per route and records a mid-visit reload instead of crashing (the first 70
visits were lost to that). Git Bash rewrites `/`-leading arguments — use `MSYS_NO_PATHCONV=1`. Both in
the runbook.

## Not exercised

The 53 automatable screen checks (block 4), admin (6) and resume (7), frames/paint (3) — next sitting.
Light theme, landscape, real airplane mode, and anything needing hardware.

<a id="2026-09-23-device-sweep-2-plan"></a>

# 2026-09-23 — Sweep 2 planned as stations: one visit, many entries

**Branch:** `device/sweep-2-plan` · **Agent:** Device Verification · **Docs only.**

The owner asked what could be combined into a larger device pass. Re-reading the queue against sweep
1's table: of the checks the phone alone can settle, **~45 automatable and 8 write checks** group into
**eight stations** — one screen and at most one write cycle each — in `docs/device-sweep-2-plan.md`.
The largest is Nutrition: about sixteen entries share one visit and one food + one saved-meal
log/delete. About 3 h 45 min in all. Everything that needs a morning before check-in, the owner
changing phone settings, hardware, a declined write or a design judgement is listed as out of the
pass, with what each needs.

**Queue hygiene in the same PR.** RV-137, RV-138, RV-140, RV-141, RV-142 and RV-133 were fully measured
in sweep 1 and RV-139 all but its byte half (invisible through the service worker), so all seven
leave the queue; their numbers are in `2026-09-23-device-sweep-1.md` and on Q-51 and BF-22. The one
result with no other home — **every tab tap is a 68–118 ms long task** — is filed as **DV-12** (Lane B).
The removal refused any entry whose span held a `## ` line, the shape that split BF-165 in sweep 2.

<a id="2026-09-23-device-sweep-3-plan"></a>

# 2026-09-23 — Device sweep 3 plan

**Branch:** `device/sweep-3-plan` · **Agent:** Device Verification · **Docs only.**

`docs/device-sweep-3-plan.md`: six stations, about 2 h 30 min. They cover the three shell probes and
DV-12's profile, RV-125's write half, DV-8, the sweep-2 nutrition leftovers (BF-95, BF-61, BF-12,
BF-161, BF-49), the workout cards (Q-300, OR-118, Q-305) and BF-147. `/admin/oura-ble` stays closed
until DV-13 is closed. The phone is on three-button navigation, so inset checks are left out rather
than failed.

<a id="2026-09-23-device-sweep-prep"></a>

# 2026-09-23 — Sweep 1 prepared: the performance probes built, every owed device check read

**Branch:** `device/sweep-prep` · **Agent:** Device Verification · **Docs + `scripts/device/**`.** The
phone was unplugged throughout; nothing here touched it.

The owner asked for everything needed to run one large sweep, and to wait for his go-ahead.

## The plan — `docs/device-sweep-1-plan.md`

Every one of the **116** entries `next-item.js --sittings` lists was read against its backlog text
and bucketed by what the sitting can actually settle: **53 automatable, 9 pre-approved writes, 9
writes needing the owner, 18 hardware, 6 owner judgement, 21 not really device checks** (a diff
against the runner's list: none missing, none extra). Plus Review's Part B, P11–P16. Ordered into
ten blocks, about three hours, with the owner-present block optional.

**Two writes are riskier than "approved" suggested**, and the plan asks rather than assumes: a manual
weigh-in **overwrites the day's real weight** and outranks the scale afterwards, and a mood check-in
is one per day, so a test would overwrite the owner's real answers if he has already checked in.

Found while building it, recorded in the plan for the Orchestrator: BF-107 and LA-57 still print as
owed though one is closed and one refuted; BF-95's failure note reads like BF-61's symptom; BF-99's
line lives in `calorie-zone-bar.tsx`; BF-139/BF-96 would only repeat a failure nothing has fixed.

## The tooling — `scripts/device/perf.js`

`coldstart` (navigation and paint entries after a real cold start, then each tab's first visit),
`tti`, `cycles` (the full list of mount durations per route, never a mean — RV-138 decides Q-51 on
it), `longtasks` (long tasks plus long-animation-frame script attribution, for the old
`animationiteration` finding) and `backstack` (guarded; stops at Home). Every visit is measured the
same way — ms to content (no loading block, real text) and to settled (no `/api` in flight for
400 ms) — and carries its request waterfall and long tasks, so an outlier can be read as network,
thread, both or neither.

**One thing the self-test caught before the phone could:** the serial-chain detector compared a
request's start with the previous one's *load end*, but `fetch` resolves on headers, so a chained
request starts before the body finishes and the chain was invisible. It now chains on
response-received. `selftest.js`: **22 of 22**.

`pw.js` also gained request timings and bytes, and **`back()` now refuses when the app is not in the
foreground** — KEYCODE_BACK goes to whichever app holds the screen, the same hazard as sitting 2's
blind taps.

## Not exercised

All of it on the phone. `perf.js` has only run against the desktop fixture.

<a id="2026-09-23-docs-or-126-raw-archive-brief"></a>

# 2026-09-23 — OR-126: the raw-archive brief, and the premise it found had moved

**Branch:** `docs/or-126-raw-archive-brief` · **Lane:** O · docs only

Q-29 Task 5 proposes dropping the server-side Oura raw archive. It was put to the owner as a
yes-on-principle; he asked for the case first, which made the missing brief our debt rather than his
indecision. This is that brief —
[`docs/oura-raw-archive-retention-brief.md`](../oura-raw-archive-retention-brief.md).

**It recommends keeping the archive**, and OR-126 explicitly allowed that outcome: the entry's own
instruction was *"do not write this as an argument for the drop"*.

## The brief answered a question that had changed underneath it

Q-29 Task 5 names `oura_raw_samples.body_hex` as *"the archival source of truth"*. That was true
when written and stopped being true when the packer shipped (Q-541 Task 4). Measured 2026-09-23:

| | rows | role | payload | span |
|---|---|---|---|---|
| `oura_raw_samples` | 189,263 | **7-day hot window** | 4.5 MB hex | 8 days |
| `oura_raw_packed` | 1,467 | **the archive** | 25 MB blob | 1,811,765 frames |

**So Task 5 as written would drop a week-long scratch buffer.** The packer moves each sealed bucket
into one compressed blob and proves it first — insert, read back out of the database, unpack, prove
the frames equal, and only then delete. Readers span both tiers, so nothing outside the packer knows
which side a frame is on.

## Two more load-bearing facts had moved

**The device's 14-day window has not shipped.** `pruneRaw` has no caller anywhere in the app, and
its predicate needs `rolled_up = 1`, which only D2 Task 5 sets. On-device 2026-08-18: **209,326
rows, 0 rolled up, 31.2 MB**, growing ~3.4 MB/day and past Android Auto Backup's 25 MB quota, so
none of it is backed up. The "what survives on the device" half of the trade does not presently
exist. This was already in `projectOverview.md`; nothing had connected it to Q-29.

**The 76 MB that makes `oura_raw_samples` look expensive is 45 MB of index plus bloat against 4.5 MB
of payload.** That is BF-106's `VACUUM FULL` — a *larger* lever than this one that loses nothing,
and one the owner has already deferred rather than declined.

## The cost, so nobody re-derives it

Railway bills on use at $0.15/GB/month. The archive is 25 MB = **$0.004/month**, growing 0.72
MB/day, so **$4.66 a year ten years out**. Reversal cost of dropping: none, ever — the ring's
cursor only moves forward and cannot be rewound. The brief says outright that this is not a cost
problem rather than implying a saving.

## What changed beyond the brief

- **`CLAUDE.md`'s raw-archive rule was wrong** and had been since the packer shipped. It named
  `body_hex` as the server's source of truth, which pointed every session at a 7-day scratch buffer.
  Corrected, with the device half beside it: do not cite the device as a surviving copy until the
  window lands.
- **Q-29 now carries a reconcile rather than a question.** Per the backlog protocol's re-verify
  rule, a task whose three load-bearing facts have all moved is reconciled before anyone builds from
  it. Asking against a stale premise is worse than not asking, because the answer would not mean
  what either side thought it meant.
- Linked from the devices domain index, positioned ahead of the older docs that still describe the
  single-tier model.

## Not done

- **Q-29 Task 5 is not rewritten or struck** — that is a decision about the task, and it belongs
  with whoever next touches the D-track, not to a docs PR that happened to notice.
- **The owner has not been re-asked**, deliberately. The brief exists so he can answer; the
  reconcile has to happen first or he would be answering about the wrong table.
- **No production write, no code change.** `BF-106`'s `VACUUM FULL` remains deferred and untouched.

## Gate

`pnpm ci:local` — exit 0, **Ran 75 of 75** Custom Rules steps, **8,063 tests passed**. Docs only.

**⚠ The first run of that gate exited 1 and its evidence was lost**, because the output was piped
to `tail -5` — five lines cannot show which file failed. Two subsequent runs of the identical tree
exited 0. Recorded as a **third occurrence on OR-121** rather than dropped, with the instruction
that a gate run is kept whole (`> /tmp/gate.log 2>&1; echo $?`) rather than tailed. Nothing is
diagnosed from it and it is not evidence for any cause — including OR-130's, which shipped earlier
the same day and whose own warning did not appear.

<a id="2026-09-23-fix-dv1-windows-ci-local"></a>

# 2026-09-23 — `fix/dv1-windows-ci-local` (DV-1)

**Orchestrator, Lane O.** The Device Verification agent runs on Windows by definition — next to the
phone — and its prompt makes `pnpm ci:local` the pre-push gate. On 2026-09-23 it could not produce a
clean run for reasons that had nothing to do with its diff, so it shipped on CI alone.

## Three of the four failures were one bug wearing three names

`check-sign-out-clears-device`, `check-e2e-stub-dates` and `check-strict-request-schemas` each walk
the tree with `path.join` and then use the result as a **key** into a table hand-written with
forward slashes. On Windows the walk yields `app\api\x`, the lookup misses, the allowance is not
found, and a baselined file reports as a new violation.

**It is invisible to CI, which is why it survived.** CI is Linux, where `path.sep` is already `/`,
so all three are correct there and always have been. They fail only for a human on Windows — and a
check that cannot pass on the machine that must run it is worse than no check, because it trains
that session to treat its own gate as noise.

One helper now, `scripts/lib/repo-path.js`, used by all three.

## The helper's own test caught the helper

DV-1 specified `.split(path.sep).join('/')`. That is correct for the actual use — normalising a path
*this* platform just produced — and wrong as a helper: on Linux it returns a Windows path unchanged,
so it can only be tested on Windows.

The first draft did exactly that and `scripts/__tests__/repo-path.test.ts` failed on two of five
cases. It now replaces backslashes unconditionally, and the test feeds the Windows shape in
**literally** rather than deriving it from `path.sep` — a test built from this runner's separator
would pass against the broken code. The trade (a POSIX file whose *name* contains a backslash would
be mangled) is documented: these are lookup keys, not paths handed back to the filesystem.

## The fourth could not run on Windows at all

Step 68 shelled out to `grep -rl … | grep -v …`, which under `cmd.exe` dies with *"The system cannot
find the path specified."* It is a Node walk now, **verified to find the identical 28 files** — set
diffed against set, because a rewrite that quietly narrowed the scan would be worse than the bug it
replaced.

Plus `npx` → `npx.cmd` on win32 (named explicitly rather than `shell: true`, which would re-parse
the argument list), and `engines.node` raised to `>=22.12` so a Node mismatch fails at install with
a message rather than at test time with a missing rolldown binding.

## A real defect found while fixing it — OR-130

A full gate run failed once on `app/api/user/goals/route.ts`, a file **byte-identical to `main`**.
The run was not piped, per OR-121's own instruction, so the diagnostic survived and was decisive.

`fileAtBase` in `scripts/lib/base-ref.js` returns `null` for **two different facts** — *"the file
does not exist at the base"* (the branch added it: a real violation) and *"I could not read the
base"* (nothing is known) — and `verdict` maps `atBase === null` to `fail`. This clone is shallow,
so `git show origin/main:<path>` fails transiently, and a read failure is reported as an accusation.
Confirmed by direct call, not inferred.

That matters more than one red run: `base-ref.js` exists so a branch is judged on what it *changed*,
and its own header records the earlier version reading as *"your change was too big"* when the change
was eleven lines. This reintroduces that failure non-deterministically, which is worse — a gate that
accuses at random teaches the reader to stop believing it.

Filed as **OR-130** with the fix and one warning attached: **decide the CI case first.** CI checks
out at depth 1, so if the base is unreadable there too, "do not fail on unreadable" disables the
ratchet everywhere rather than just locally.

## It is also OR-121's second occurrence — and does not close it

OR-121 asked for exactly this: *"the next occurrence settles it."* This one is diagnosed. But it is
a **different script** — the first instance was `check-tz-aware-cache-guards.js`, which does not use
`base-ref` at all. Two flakes of similar shape are not evidence of one cause, and recording them as
one would retire an open question on a resemblance. **The first instance stays unexplained.**

## The device machine answered while this was being written

Two things landed on `main` from that side, and both change the picture:

**The Node half is resolved by the owner** — 22.23.2 via winget, so `vitest` starts. The
`engines.node` floor still ships: the point is that the *next* machine fails at install with a
message rather than at test time with a missing rolldown binding.

**With the tests actually running, two more failures surfaced.** One of them —
`strict-schema-inert.test.ts` — shells out to `check-strict-request-schemas.js` and inherits its
path bug, so **the work here fixes it**. The other does not: `check-hex-literals` times out at 30 s,
three full scans of `app/` + `components/` against a filesystem that makes them slower. That stays
open on DV-1, with the instruction attached — **measure before raising the timeout.** A scan three
times slower than it needs to be is the finding, and a bigger number would hide it.

## Not done — and this is the honest headline

**None of this is verified where it matters.** Three of the four bugs are invisible on Linux by
construction, and Linux is all this session has. Every fix is reasoned from the reported failure and
confirmed only where confirmation proves little. DV-1 keeps a `Keep:` naming the one thing that
settles it: `pnpm ci:local` on that Windows machine, unpiped, exiting 0. That is the Device
Verification agent's run, not this one's.

The local machine is also on Node 22.9 against a `>=22.12` floor — the upgrade is the owner's.

<a id="2026-09-23-fix-dv11-switch-accessible-names"></a>

# 2026-09-23 — DV-11: 17 of 25 switches had no accessible name

**Branch:** `fix/dv11-switch-accessible-names` · **Lane:** B · eleven files, one guard, one test

Device Verification found one unnamed switch on the supplements sheet — a `role="switch"` button
with no `aria-label` and no labelled-by, announced as "switch, on" with nothing to say what it
controls. The sweep that followed found the same defect on **17 of the app's 25 switches**, across
settings, meal types, goal recommendations, the workout builder and the admin activity manager.

All 25 have a name now.

## The entry named one sheet; the class was app-wide

Each of those switches sits beside a visible `<p>` that names it perfectly well on screen and to
nothing else. That is why the class survives: it looks right, and only a screen reader disagrees.
The device sweep found the supplements sheet because that is the screen it was on.

## Why the existing check did not catch them

`scripts/check-icon-button-names.js` walked `<button>` and `<Button>` opening tags and **skipped
self-closing ones outright**, because a self-closing button has no body and the icon-only shape
cannot apply. A `<Switch />` is the opposite: self-closing is its only shape, so it was never
examined.

Extended rather than duplicated — Custom Rules stays at **`Ran 76 of 76`**. The tag walker is now
parameterised, which matters because PS-34's comment on that walker exists precisely to stop anyone
hand-rolling a second `[^>]*` version that ends the tag at the `>` of an inline arrow.

**Unlike the icon-button half, this pass is not a heuristic.** A `Switch` renders a thumb and no
text child, ever, so "no naming attribute" means "no accessible name" with nothing to trade against
under-reporting. The baseline stays **empty**: an unnamed switch is a regression, not a debt row.

## The first measurement was wrong, and that is the reusable part

Matching `<Switch` a line at a time reported **26 of 28**. The truth is **17 of 25**. Nine were
false positives — three were the primitive's own definition, and six were multi-line switches whose
`aria-label` sat on a later line.

That is the same mistake made earlier the same day, on a three-line call whose timezone argument sat
on line 3. **Read the tag to its balanced close, not the line.** It is now a baton lesson.

`scripts/__tests__/switch-accessible-name.test.ts` drives the exported detector directly and pins
nine shapes: same-line and later-line names, a genuinely unnamed multi-line switch, an inline arrow
(PS-34's shape), a `>` inside a quoted attribute, `aria-labelledby`/`title`, `<SwitchGroup>` not
being mistaken for the primitive, and several in one file at their own lines.

The CLI half is now behind `require.main === module`, so importing the detector has no side effect.
The sibling `check-admin-guard-catch.js` exports without that guard, and importing it runs a full
repo scan that can `process.exit(1)` on an unrelated regression.

**Control runs:** removing the name from a self-closing switch and from a multi-line one each fail
the check at the right file and line; both restore green.

## Not done, and not claimed

**`Verify: device` + `Keep:`** — the pass test is a screen reader on the S25 announcing each switch
with its name. The sandbox proves the attribute is present; it cannot prove what TalkBack says. Two
labels are worth a second look on device: the supplement row uses the supplement's own name, and
the goal-recommendation rows use `row.label`.

Also not exercised: Samsung WebView rendering, native SQLite / Capacitor, drifted production data.

## Also in this PR

The **Lane B baton** was rewritten in full — owed for three PRs. It is shrink-only, so making room
for three new lessons (the test-typecheck gap, the two fetch traps, and balanced-close matching)
meant cutting older narrative and moving LB-129's ruled-out candidates into LB-129's own entry,
where they belong. It came back to exactly 55 lines rather than raising the ratchet.

<a id="2026-09-23-fix-dv4-sleep-legend-contrast"></a>

# 2026-09-23 — DV-4: the Sleep card's stage hours were printed in the stage colour

**Branch:** `fix/dv4-sleep-legend-contrast` · **Lane:** B · one line of product code, one test

Home's Sleep card coloured each legend value with its own stage colour. Deep's `#1e3a70` against the
page root measured **≈1.6:1**, and against the card's own purple paint in the device screenshot
**≈1:1** — the number was there and could not be read. Device Verification found it on the S25
during the P4 sweep. The hours now inherit the foreground; the stage colour stays on the dot and the
stacked bar.

## The entry named the fix, and the sibling sweep changed which fix it was

DV-4 proposed rendering the hours in a foreground token, and flagged that `hypnogram.tsx` also
imports `STAGE_COLOR` and "was not read". Reading all four consumers turned that loose end into the
argument for the change:

| consumer | how it uses `STAGE_COLOR` | |
|---|---|---|
| `hypnogram.tsx` | SVG `fill`, and a legend dot's `background` | fill |
| `sleep-phase-trend-card.tsx` | Chart.js `backgroundColor` | fill |
| `health-metric-sheet.tsx` | bar + dot `background`; **hours in the inherited foreground** | fill |
| `home-card-widget.tsx` | dot + bar `background`, **and the hours as `color`** | the bug |

So the sleep detail sheet already renders the *identical* legend the right way. This was not a
design decision to make — it was one surface out of step with three, and the shape to copy was
fifteen lines away in a file the entry had not opened. Nothing else needed changing.

## Why a palette fix could not have worked

The card's background is owner-customisable (`ColorSwatchPicker`, `cardColors.sleepWidget`), so
there is no card colour for which all four stage colours clear 4.5:1 — and stage colours are picked
to read against *each other* in a stacked bar, not against a background. REM, Light and Awake passed
only because they happen to be light. Darkening Deep would trade one unreadable pair for another the
first time the owner picks a dark card.

`accentCardStyle` (`packages/shared/src/utils.ts`) is what makes the foreground token safe: every
card paints a translucent `--muted` base under a 30%→12% accent wash, so the card's own 2xl hours
figure already relies on the foreground reading against exactly this background. The legend value
now sits on the same footing as the number above it.

## The test is the rule, not the line

`components/home/__tests__/dv4-stage-colour-is-never-text.test.ts` sweeps every `STAGE_COLOR`
consumer for the palette reaching a CSS `color` inside a `style` object. Three things make it worth
more than an assertion on one span:

- It **guards the siblings**, which are correct today and have no other protection.
- It asserts the dot and the bar are **still coloured**, so it cannot be satisfied by deleting the
  palette.
- It pins the contrast ratio, so the premise is checked rather than quoted.

Control run: with the colour put back it fails naming `home-card-widget.tsx:166`.

A first draft flagged two false positives — `{ label: 'Deep', color: STAGE_COLOR.deep }` in both
`home-card-widget.tsx` and `health-metric-sheet.tsx`, which are data fields that happen to be named
`color`. Scoping the check to lines containing `style=` separates them, and lowercase `color:`
excludes `backgroundColor:` on its own.

## Not done, and not claimed

**The device look is owed** — the entry keeps a `Verify: device` and a `Keep:`, so
`next-item.js --sittings` lists it. The sandbox can compute the ratio and does; it cannot see the
card, and it cannot see a custom card colour at all.

**DV-6 was considered for this PR and deliberately left out.** It is the next Lane B item and both
would be checked in one look at Home, which is the batch rule's own axis. It turned out to carry a
design question this diff should not smuggle: the app scrolls five independent inner containers
rather than the document (`PullToSync`, plus Nutrition's own), so a shell-level "fade in on scroll"
needs a capture-phase `scroll` listener and a rule for which panel counts — and the scrim's colour
has to compose with `DynamicBackground`, which sets `--page-bg: transparent`, so the obvious
`var(--page-bg)` gradient would be invisible exactly when it is needed. `--pt-safe-value`
(`max(1rem, inset + 0.5rem)`) is the right height and already floors the three-button-nav case where
insets read 0. Recorded so that work starts from here.

<a id="2026-09-23-fix-dv6-status-bar-scrim"></a>

# 2026-09-23 — DV-6: a gradient behind the status bar, once, in the shell

**Branch:** `fix/dv6-status-bar-scrim` · **Lane:** B · one component, one controller, one wire-up

On Home, scrolled, the energy bar's caption ran behind the status bar's clock with nothing between
them. The owner was offered a solid strip and chose the fade, so the app stays edge-to-edge and
nothing loses the ~28 px a flat backing costs. It fades in on scroll and is absent at rest.

## Why one listener in the shell, and why it has to be capture

The owner's constraint was "in the shell once, not per screen" — a per-screen scrim is a rule every
future screen can forget, which is how this defect reached a device sweep in the first place.

That is harder than it sounds here, because **this app has no document scroll**. Every tab scrolls
its own inner container: three through `PullToSync`, and Nutrition owns a separate one. `scroll`
does not bubble, so a listener on an ancestor sees nothing — unless it registers in the **capture**
phase, which does reach it. One `document.addEventListener('scroll', h, true)` in `TabShell` covers
all five panels with no screen opting in.

The shell marks the panel on show with `data-tab-active`, and the controller scopes each event with
`closest()`. Without that, a hidden panel or a sheet scrolling would paint over the screen you are
actually looking at.

## The open question the entry recorded, and its answer

A panel keeps its scroll offset while hidden, so flipping back to a tab left scrolled down fires no
scroll event and a naive implementation shows nothing until you touch it.

The controller keeps a `Set` of every element it has seen scroll — bounded by the number of
scrollers in the app, a handful — and on each activation re-reads the ones inside the newly active
panel. A tab never scrolled is absent from the set and correctly shows nothing. Detached nodes are
dropped on the way past, so a torn-down screen cannot pin the scrim on.

## The logic is not in the component, and that is not a style choice

**Every vitest project in this repo is `environment: 'node'` and cannot transform `.tsx` at all** —
measured: importing the component fails at parse, first with JSX in the test and then with JSX in
the component itself. That is why there are no component-rendering tests here, and it is a hard
constraint rather than a convention to argue with.

It matters because of how this fails on device: a dead scrim and a mis-scoped one look identical —
nothing there. So logic left inside the component is logic nothing can drive, and the device check
cannot isolate it either. The decision moved to `lib/shell/status-bar-scrim-controller.ts`, a plain
`.ts` module with **12 tests** (jsdom through a per-file `@vitest-environment` docblock, which needs
no config change). The component is the div.

Its four wiring constraints are pinned by reading its source, since the tests register the listener
themselves and so would otherwise prove the controller's logic while saying nothing about whether
the component asks for capture.

**Control runs, because a green test that cannot fail proves nothing:** with `reevaluate` neutered
the tab-flip test fails; with the component's `true` capture flag removed the wiring test fails.
Both restore green.

## Two things measured rather than assumed

**`var(--page-bg)` is the wrong colour to fade from.** `DynamicBackground` sets it to `transparent`
when active, so a gradient built from it is invisible in exactly the case the scrim exists for. It
fades from `var(--background)`, which holds the theme base either way.

**The height is the `pt-safe` utility, not a hand-written `--pt-safe-value`.** An empty `pt-safe`
div is exactly inset-height and the gradient paints over the padding box. Referencing the variable
directly **fails** the Custom Rules check that every safe-area utility be a defined class — the run
reported `pt-safe-value` as used-but-undefined, which is the check doing its job on a name that
merely looks like a utility. The utility floors at 1rem, which matters because three-button
navigation reports the inset as 0.

## Not done, and not claimed

**The device look is owed** (`Verify: device` + `Keep:`). The sandbox cannot judge the one thing
most likely to need tuning: how the gradient composes with `DynamicBackground`'s sky, in both
themes. Also not exercised: Samsung WebView compositing of a fixed, animated-opacity layer.

Also filed: **LB-130** — `docs/doc-size-baseline-history.md` is now the guaranteed-conflict file
that `.size` used to be, on the same append-to-one-shared-file shape LA-33 and RV-134 already
fixed twice. Measured across five re-merges of #1449 in an hour.

## The compaction sweep was run, and then handed back

Merging `main` took `docs/overview/entries/` past the 60-foldable limit, and since BF-36 that guard
fails only a branch that **adds** an entry — which every feature PR does, so it lands on whoever is
holding the door. This branch ran `scripts/fold-journal-entries.js`, folded 40 entries, and both
link checks came back clean.

**None of that is in this diff, because #1447 ran its own sweep at the same time and landed first.**
The two folds collided as an add/add conflict on `history-2026-09-23-folded-1.md`, each holding a
different set of entries. Hand-merging two folds is precisely how a journal entry gets silently
duplicated or dropped, so this branch discarded its own fold, took `main`'s state wholesale, and
re-checked: `main`'s sweep had already cleared the guard, so nothing was owed. The only file this PR
adds under `docs/overview/` is its own journal entry.

**The reusable part is the resolution, not the sweep.** Two sessions folding on the same day write
the same `history-<date>-folded-N.md`, and `git` surfaces it as add/add rather than as anything
resembling "you both did the chore". Take one side whole and re-run the script; never splice.

## Two things the first CI run caught that the local gate did not

**`npx tsc --noEmit` does not typecheck test files.** The Build job runs
`scripts/check-test-typecheck.js` against `tsconfig.tests.json`, a separate project with its own
per-file baseline (320 errors across 90 files, recorded). A clean `tsc --noEmit` says nothing about
a spec, and this PR went red on one line in its own new test —
`let paint: ReturnType<typeof vi.fn>` erases the signature, so passing it where a
`(shown: boolean) => void` is wanted does not typecheck. **The local command is
`node scripts/check-test-typecheck.js`**, and it belongs in the gate beside `check:rules`.

**Fixing that surfaced a defect the mock had been hiding.** Replacing `vi.fn` with a plain counter
turned "paints only on a change" from green to `expected 6 to be 1`: every case's controller was
still attached to `document`, because nothing detached it, so six controllers painted on one
scroll. A per-test spy hides this by construction — each assertion reads only its own mock — and
the shared counter is what made it visible. The listeners are detached in `afterEach` now.

Worth stating plainly: the earlier "12 passed" was partly luck. The leaked controllers all saw the
same DOM and computed the same answer, so `shown` agreed and every other assertion held. The four
control runs were re-done against the fixed harness for that reason — neutering `reevaluate`,
zeroing the threshold, removing the active-panel scoping, and dropping the component's capture flag
each fail their own test and restore green.

<a id="2026-09-23-fix-home-ia-merge-part1"></a>

# 2026-09-23 — home-ia-merge, part 1: the APK banner and the picker's duplicate question

**Branch:** `fix/home-ia-merge-part1` · **Lane B** · v1.465.22

## What shipped

**RV-116 — the widget picker offered two entries for one question.** `nutritionDonut` and
`energyBalanceWidget` both read `energy-balance:${today}` through the same hook, and the pair has
already shipped two budgets 271–274 kcal apart, both labelled "left" (Q-401/Q-415). The picker now
says under its heading that Energy Balance is an **alternative** to Nutrition, not an addition, and
the Energy Balance chip dims while Nutrition is on and it is off.

Dimmed, never disabled: it is a real choice, just not one to make *on top of* Nutrition. Disabling
would hide the alternative rather than rank it.

**Deviation from the entry's letter.** It said "relabel the picker entry". The chips sit in a
wrapping row built for 384 px and a label long enough to carry "alternative to Nutrition" wraps that
row, so the sentence went under the heading where it has room to say the whole thing. Same intent,
better fit; reversal is moving one `<p>`.

**RV-119, first half — the APK banner is gone**, along with its `apkBannerDismissed` state, its
`apk-banner-dismissed` key, and the `Download` and `X` imports it was the last user of. No design
judgement was involved: the canonical runtime *is* the APK, and the same download row already sits
at More → About.

## Why the rest of RV-119 did NOT ship

The entry says *"Owner gate SATISFIED 2026-09-22 — mockup shown at 384 px dark … Build to it; a
departure from it needs a fresh yes."*

**The mockup was not preserved.** Nothing in `docs/design/` from that date; the sweep write-up
describes the problems, not the approved layouts. So "build to it" cannot be followed — an
implementer either invents a collapse layout, which is the precise departure the gate exists to
prevent, or re-asks the owner something he already answered.

The banner split itself is written down and unambiguous (illness advisory and early deload stay
full-width; exercise-detected, goals check-in, day-review and weekly recap collapse). What is missing
is what a "collapsed strip" LOOKS like, which is exactly what a mockup carries and prose does not.

Filed as **LB-135**: an owner gate recorded as satisfied without preserving the artefact is not
actionable, and the same wall is waiting in RV-117 and RV-118, which carry the identical line.

## Verification

- Full suite **811 files / 8231 tests / 0 failed** (exit 0) · `pnpm build` clean · `tsc --noEmit`
  clean · `pnpm check:rules` **Ran 77 of 77** · lint clean on both changed files (the `X` import
  warning my own deletion created is fixed, not baselined).

## Not exercised

Device. Both changes are visual — a removed banner and a dimmed chip — and the sandbox can only
prove the code paths changed. Also not exercised: native SQLite, safe-area, Samsung WebView.

<a id="2026-09-23-fix-lb129-day-review-cold-flip"></a>

# 2026-09-23 — LB-129: the day review on a cold flip into Nutrition

**Branch:** `fix/lb129-day-review-cold-flip` · **Lane B** · v1.465.19

## What shipped

`EndOfDayReview` is now a **static** import in `app/nutrition/nutrition-content.tsx` rather than a
second `dynamic({ ssr: false })` nested inside the tab's own lazy chunk. The screen is already
code-split and warmed on idle by the shell, so the inner boundary kept almost nothing out of the
initial bundle while adding a chunk that has to be fetched at the moment the sheet opens.

**This is a plausible fix, not a demonstrated one, and the entry says so.** Reversal is one line.

## What was actually measured

Instrumented in the Playwright harness, driving the real app:

- **The param is not the problem.** At the failing timing the effect reads
  `sp=review=day loc=?review=day` and `reviewOpen` goes `false → true`. No error, no `pageerror`.
- **`EndOfDayReview`'s component body never runs** while `reviewOpen` is true — its chunk had not
  resolved. The defect is downstream of the param, in chunk loading.
- **It is a race with a clean bracket:** flip the instant `settleRouteBoundary` returns and the
  sheet does not appear within 12 s; wait 1500 ms and it opens; 6000 ms, sooner.

## Why this is not closed

**The harness cannot separate this from a dev-compiler artefact.** It drives `pnpm dev`, where a
cold chunk is compiled on demand — seconds, visible in the server log. With the fix reverted and the
window widened to 20 s the sheet *did* appear, so the chunk resolves late rather than never. In a
production build it is prebuilt.

A production-mode run would settle it and is **not available in this sandbox**: `next start` sets
`NODE_ENV=production`, which turns the pg pool's SSL on, and the local Postgres speaks none, so every
request dies. Only the device or a Railway preview can tell the two apart. `Gate: device`.

## Two traps, both of which cost a pass

- **The obvious probe gives a false pass.** Flip, then read `[role="dialog"]` — Home auto-opens the
  Morning Check-in for a user who has not done one, so the role is satisfied before the flip and the
  assertion passes without the day review ever appearing.
- **The spec was deleted rather than committed.** It passed with the fix *and* with the fix
  reverted, so it was a green tick proving nothing — the same failure LB-133 was about. A regression
  guard for this needs a control run showing it red first, and on this evidence none can be written
  in the sandbox.

## Also ruled out

The **back-dismiss machinery**, the most tempting candidate because `sheet-back-stack.ts` carries a
documented bug where *"the dialog closed on the frame it opened"* (BF-34). `handlePop` runs only on
a `popstate`, and a tab flip emits none — `tab-shell.tsx:103` uses `replaceState`. The timeline also
shows the sheet never opening rather than opening and closing.

## Not exercised

Device, native SQLite, safe-area, Samsung WebView, drifted prod data — and, unusually, **the
production build itself**, which is the one surface that would make this conclusive.

<a id="2026-09-23-fix-lb131-dv9-sleep-timezone"></a>

# 2026-09-23 — LB-131 + DV-9: two sleep surfaces took Brisbane by default

**Branch:** `fix/lb131-dv9-sleep-timezone` · **Lane:** B · two call sites, one test

`computeSleepStartConsistency(starts, tz = DEFAULT_TZ)` and `timingPoints(nights, mode, tz =
DEFAULT_TZ)` both already accepted a zone. Nothing on the client passed one, so the Sleep screen's
consistency figure was computed in the **device's** clock and the timing chart's axes in Brisbane —
correct for the only user today, wrong the moment a phone and a profile disagree.

This is the shape CLAUDE.md names outright: *a default every caller overrides is a safety net, and
it is what makes forgetting silent.* Neither surface looked broken, and neither would until someone
travelled.

## Shipped as one PR, because the entry asked for it

LB-131 said "ships with DV-9 — one tz resolved once per screen, not twice", and they touch the same
screen, so they batch on the axis that matters: one device look clears both.

## Built differently from the plan, deliberately

The entry prescribed threading the session timezone from the screen through into the card. The card
is rendered by `sleep-trend-toggle-card.tsx`, which has no other use for a zone — so a threaded prop
is a parameter a future render site can omit, which is **the same hazard as the default**, moved one
level up. The card reads `useUserTimezone()` instead: a context fed from the root layout's `auth()`
call, present in the first server render, so the card is correct wherever it is mounted.

Reversal cost is a prop and two edits. Recorded in the entry as well as here, per the standing rule
that a structural call gets written down with its reason.

## The sweep found the intermediary, and no third site

Neither entry mentioned `sleep-trend-toggle-card.tsx`; grepping the render chain did. Between `app/`
and `components/` each helper has exactly two call sites, and the API route's
(`app/api/user/bedtime-estimate`) was already passing a zone — which is what made the client half
look deliberate rather than missed.

## The test guards the call sites, not the maths

DV-7 already pinned the helpers themselves with explicit `+10:00` fixtures passing under UTC,
Brisbane, New York and `Etc/GMT-13`. What had no guard is whether anything *passes* a zone, which is
exactly what regressed. `components/health/__tests__/lb131-dv9-sleep-tz-call-sites.test.ts` sweeps
every client call site of both helpers and also asserts the value comes from `useUserTimezone()`
rather than a hardcoded string or an `Intl` read — either would typecheck and be the bug.

**A first draft matched one line at a time** and reported the API route's three-line call as having
no zone. That is a false positive, not a find: the `tz` was on the third line. The check now reads
each call to its balanced closing paren.

**Control runs:** reverting either call site fails the sweep; hardcoding `'Australia/Brisbane'`
fails the session-source assertion. All three restore green.

## Not done, and not claimed

**Both keep a `Verify: device`.** DV-9's pass test is the one assertion the sandbox structurally
cannot make — override the device timezone (CDP `Emulation.setTimezoneOverride`), leave the profile
alone, and the consistency figure must NOT move. That needs two clocks that disagree. LB-131's is
the owner setting a profile zone far from Brisbane and watching both chart axes follow the profile.

Also not exercised: Samsung WebView rendering, native SQLite / Capacitor, drifted production data.

<a id="2026-09-23-fix-lb132-post-push-invalidation"></a>

# 2026-09-23 — LB-132: invalidate again once a local write reaches the server

**Branch:** `fix/lb132-post-push-invalidation` · **Lane B** · v1.465.15

## What shipped

Five local-first write paths queued their mutation, fired a bare `pushMutations` and evicted their
caches on the same beat. Each now pairs that immediate call with `pushThenRevalidate`, carrying its
own group's invalidator(s):

| Site | Invalidators |
|------|--------------|
| `app/session-select/components/log-value-sheet.tsx` | `invalidateBodyMetricWrite` + `invalidateReadinessInputs` |
| `components/mood-checkin-sheet.tsx` | `invalidateCheckinAffectsPrescription` |
| `components/morning-checkin-sheet.tsx` | `invalidateCheckinAffectsPrescription` + `invalidateHealthTrends` |
| `components/nutrition/end-of-day/end-of-day-review.tsx` | `invalidateHealthTrends` |
| `components/activity/exercise-review-sheet.tsx` | `invalidateActivityWrites` + `invalidateOuraWorkoutReview` |

## Why the second half is load-bearing

The entry left one question open — whether the pull path already re-invalidates — and it bounded
whether any of group ② was worth doing. It is answered: **`lib/local-store/sync-engine.ts` fires no
cache invalidation at all.** No `invalidateBiometrics`, no `invalidateCache(`. Nothing downstream
closes the window.

`pushThenRevalidate`'s own docblock names the cost exactly: invalidating only *before* the push
makes every `useCachedValue` subscriber refetch while the server still holds the pre-write state and
**re-cache the stale payload**, which then stands for the key's full TTL because nothing invalidates
again. That is LB-4 — the 42 kcal Energy Balance reading. Every one of the five groups clears a
server-computed aggregate (readiness, the prescription, health trends, the day log), so each had a
real window rather than a theoretical one.

The immediate call stays in all five. Offline the push never resolves usefully, so a push-only
invalidation repaints nothing at all.

## What this was NOT

Group ① of LB-132 is **empty** — both its candidates were verified correct before this session, and
the entry now says so in place, so a later sweep does not patch a working file. The same test emptied
four more apparent offenders: `use-plan-meal-logging.ts`, `manual-bedtime-card.tsx`,
`more-content.tsx`, `sync-health-card.tsx`. `log-value-sheet.tsx` looked like the defect from its
call line too — its invalidation sits 39 lines below the push, inside the same `try`, so only the
far-side half was missing there.

**RV-108 remains the only genuine missed invalidation found in the app.**

## Verification

- `components/__tests__/lb132-post-push-invalidation.test.ts` — 17 assertions. Per site: the exact
  far-side call, the immediate call still present, no bare `pushMutations` on the write path. Plus
  each group really clearing a server-computed key, and `sync-engine.ts` still invalidating nothing
  (so the far-side calls are not later removed as redundant).
- Control run: reverting `mood-checkin-sheet.tsx` to the bare push failed 2 of its 3.
- `tsc --noEmit` clean · `check-test-typecheck` at baseline (320/90) · lint clean on all five ·
  `pnpm check:rules` **Ran 77 of 77** · `pnpm build` green · 12 related test files, 85 tests green.

## Not exercised

**The changed branch is unreachable in the web sandbox.** `getLocalStore` returns null there, so
`pnpm dev` runs the API fallback arm — the one this PR does not touch. The build proves it compiles
and the test proves the calls are present; neither watches an eviction on a phone. Also not
exercised: native SQLite, safe-area, Samsung WebView, drifted prod data.

**Owed:** the device pass, recorded as `Keep:` on the entry — log a morning check-in and an
end-of-day review on the S25 and confirm the prescription and health-trends surfaces move when the
push lands rather than at TTL.

## Found while shipping this — filed as LB-133

`scripts/check-invalidate-after-push.js` is CI step 37, has no baseline, and reported
`no write invalidates around its push` for the whole time these five sites carried the defect.
Reverting one fixed site and re-running still reported clean, so it is blind to the shape rather
than to a formatting variant.

The cause is `WINDOW = 12` — a ±12-line text window around the push. All five sites sit further out
(14, 26, 35, 39 and 53 lines). Its docblock already records that widening the window failed once:
LB-6 looked six lines up, missed five written below, and the window became ±12. The fix is to match
the **enclosing block** to its balanced close, as `check-admin-guard-catch.js` learned under Q-548,
with the blind spots pinned as fixture cases.

Recorded with the measurements because **this PR removes the evidence** — all five instances are
fixed here, so the detector can no longer be tested against live offenders.

<a id="2026-09-23-fix-lb133-post-push-guard-blind-spot"></a>

# 2026-09-23 — LB-133: the guard for the post-push class could not see the class

**Branch:** `fix/lb133-post-push-guard-blind-spot` · **Lane B** · v1.465.17

## What was wrong

`scripts/check-invalidate-after-push.js` runs as Custom Rules step 37 and printed
`no write invalidates around its push` for the whole time five live sites carried exactly that
defect. It had no baseline and no allowlist, so the clean line read as proof rather than as an
unmeasured claim. Reverting a fixed site and re-running still reported clean — it was blind to the
shape, not to a formatting variant.

The cause was `WINDOW = 12`: a ±12-line text window around the `pushMutations` call. The five sites
LB-132 fixed sit 14, 26, 35, 39 and 53 lines from their invalidation.

## The measurement

The five real pre-fix sources were recovered from git (`git show 66c04c3fdf0:<path>`) and run
through both detectors, because #1467 had already removed every live offender:

| | old detector | new detector |
|---|---|---|
| five real pre-fix sources | **missed all five** | caught all five, at their exact lines |
| the same files after the fix | clean | clean |

## Why the scope is the handler

Widening the window was never an option — that fix already failed once. LB-6 looked only at the six
lines *above* each call, missed five written below, and the window became ±12 both ways, which is how
it reached the state above. A larger number catches today's five, misses the sixth, and starts
matching an unrelated `invalidate*` in a neighbouring function.

Brace-matching the immediately-enclosing block is not enough either: three of the five put the push
and the invalidation in *different* blocks of one handler — two sibling async IIFEs, or a nested
`try` and its parent. So the scope is the function block just inside the component/hook body. Wide
enough to span those siblings, narrow enough that an unrelated handler in the same file is out of
scope. `app/more/more-content.tsx` is the case that proves the second half matters: it holds an
`invalidate*` call **and** a bare push, in different handlers, and is correctly clean.

## It found a sixth offender immediately

`lib/home/rest-day.ts:65`, fixed in the same PR. `chooseRestDay` queued the mutation, fired a bare
`pushMutations`, then `await`ed `invalidateRestDayChoice()` — which clears `next-session`,
`next-session-prescription` and `collection`, all server-computed, and the file's own docblock says
`getNextSession` prefers the stored `rest_days` row. The recomputed recommendation only arrives once
the push lands. **The old scanner never looked at `lib/` at all**; the new one scans it, taking the
file count from 945 to 1,224.

**Lane call (structural, mine):** `lib/home/rest-day.ts` appears in neither lane's path list. It is
reached only from `app/**` and `components/**`, so §3's rule puts it in B. Reversal cost is nil — a
three-line change in one file.

## Verification

- `scripts/__tests__/invalidate-after-push.test.ts` — ten cases, written as **shapes rather than
  distances** and taken from the real pre-fix sources: the far-below invalidation, the sibling
  IIFEs, the nested try, the module-scope helper, and five that must NOT be flagged (two handlers, a
  bare flush, an awaited push, a `.then` chain, the import line).
- Control: the old detector run against all five real pre-fix sources missed every one.
- `tsc --noEmit` clean · `check-test-typecheck` at baseline (320/90) · lint clean ·
  `pnpm check:rules` **Ran 77 of 77** · full vitest suite green.

## Not exercised

The rest-day fix changes when an invalidation fires on the device; the sandbox can prove the call is
present and cannot watch an eviction on a phone. Also not exercised: native SQLite, safe-area,
Samsung WebView, drifted prod data. **Owed:** the rest-day device look, folded into LB-132's pass.

## Also in this PR

LB-129 gained a ruling-out rather than a fix: the back-dismiss machinery **cannot** be the cause of
the day-review sheet failing to open on a cold flip, even though `sheet-back-stack.ts` carries a
documented bug where *"the dialog closed on the frame it opened"*. `handlePop` only runs on a
`popstate`, and `tab-shell.tsx:103` navigates with `replaceState`, which does not emit one. The
entry's claim that `<EndOfDayReview>` renders unconditionally was also re-checked and holds. That
leaves the nested `dynamic({ ssr: false })` chunk as the only live hypothesis.

## Also found here — `main` was red, and the merge call did not stop it (LB-134)

Running the full suite for this change surfaced
`app/api/next-session/prescription/__tests__/prescription.test.ts` failing 4 of 6 **on `main`** —
reproduced in a clean worktree at `main`'s HEAD, byte-identical to GitHub's copy (so not a stale
checkout), and unchanged with `DATABASE_URL` unset (so not environmental).

**Cause:** #1466 (RV-82) changed the route to read `recommendation.program`, since `getNextSession`
already fetches it. The test still stubbed `getActiveProgram` and its `getNextSession` mock had no
`program` field, so `program` was null and **every case fell into the rest-day branch** — including
the two that still reported green. *"Never calls a prescription-mutating repo method"* was passing
**vacuously**, because that branch returns before any of them is reachable.

**⚠ Correction, made before this PR merged: the test fix is NOT this branch's.** #1472 fixed it
concurrently on `main`, and an earlier draft of this entry and of LB-134 claimed it here. This
branch keeps #1472's version and adds one line it lacks —
`expect(getActiveProgram).not.toHaveBeenCalled()` — which pins RV-82's actual point, that the route
must not fetch the program twice, so the stub cannot go stale in silence again.

**The part that is this session's, and matters more than the test.** The failing `Tests` job did not
block the merge: #1467 was squash-merged at 10:18 while `Tests` was failing on its head
(`efb8ee295e6`, run 35847259425, job 107136618616), and `merge_pull_request` returned success.
**`main` took a red commit.**

That falsifies a rule this repo leans on: *"attempting the merge is the reliable green test … it
cannot merge a genuinely pending check."* It can. The likely reason is already recorded elsewhere in
CLAUDE.md — `enable_pr_auto_merge` fails here with *"Protected branch rules not configured for this
branch"* — meaning required checks are not actually enforced, which also makes the same file's claim
that protection *"requires a PR with all CI checks passing"* wrong.

Branch-protection configuration is the owner's call, not a lane's, so LB-134 is filed `Lane: O` with
both decisions named: whether to enforce the checks, and correcting the two CLAUDE.md passages that
currently instruct every agent to use an unsound gate. Until then, read the `Tests` conclusion
explicitly before merging — `get_job_logs` with `failed_only: true` is the cheap form.

<a id="2026-09-23-fix-or-130-base-read-failure"></a>

# 2026-09-23 — OR-130: a ratchet that could not read its base blamed the branch

**Branch:** `fix/or-130-base-read-failure` · **Lane:** O (Orchestrator) · docs + `scripts/lib` only

## What was wrong

`fileAtBase` in `scripts/lib/base-ref.js` returned `null` for two different facts — *"this file is
not at the base"*, which is what a branch adding a file looks like, and *"I could not read the
base"*, which is nothing known at all. `verdict` maps a `null` base to `'fail'`, so the second
became an accusation: a file byte-identical to `main`, named as this branch's new violation, on a
branch that had not touched it.

Eleven scripts read the base through this helper.

## The CI question, decided first, because it inverts the fix

The entry carried a warning: CI checks out at depth 1, so *"do not fail on unreadable"* might
disable the ratchet everywhere rather than just locally. Measured rather than reasoned about.

`.github/workflows/ci.yml` fetches the base with `git fetch --depth=1 origin main || true`. **When
that fetch fails, no ref resolves at all** — `resolveBaseRef` returns `null`, every `atBase` is
`null`, and `verdict` falls back to the plain absolute comparison, which is *stricter* than the
base-aware one. The CI step's own comment says as much.

So turning an unknown base into a pass would not have fixed this bug. It would have disabled every
base-aware ratchet in the repo on any fetch blip. **The outcome of an unreadable base is therefore
unchanged on purpose; only the lying stopped.**

## What shipped

- `showAtBase` classifies git's own stderr. `does not exist in` / `exists on disk, but not in` is
  the only wording counted as absent. Measured against git on the day, not recalled.
- Anything else is a read failure: three attempts with a 40 ms / 160 ms backoff, then a warning
  carrying git's own words.
- `resolveBaseRef` also probes the tree behind the commit it picks. A resolvable commit is not a
  readable tree, and a base we cannot see should degrade to no base rather than failing one file at
  a time.
- Seven regression cases, plus three that pin the strict fallback so a later session does not
  "finish the job" by turning it into a pass.

## The part worth carrying: the mechanism was never reproduced

The entry stated the cause confidently — a shallow clone, `git show` failing when the blob is not
in the pack. **That did not survive testing.** 24 concurrent runs of the affected script triggered
nothing, with and without the fix, and `git show origin/main:<path>` succeeds for every path asked
directly.

So the retry is a reasonable guess and the diagnostic is the part that earns its place: the next
occurrence prints git's own reason, which is the evidence this instance never produced. A fix whose
mechanism is unconfirmed should say so in its own comment, or the next session inherits a certainty
nobody measured.

It fired again during this session's own gate run — third sighting, same shape, clean on a direct
re-run a minute later. That is the argument for instrumenting it rather than retrying harder.

## Not done

- **`OR-121`'s first instance stays open.** It was `check-tz-aware-cache-guards.js`, which does not
  use `base-ref` at all. Two flakes of similar shape are not one cause.
- **No device surface touched** — this is a build-gate script. Nothing to exercise on the S25, and
  no offline-first, native, safe-area or notification path involved.

## Gate

`pnpm ci:local` — exit 0, **Ran 75 of 75** Custom Rules steps, **8,058 tests passed**, run unpiped.

<a id="2026-09-23-fix-or-133-dv-lane-starved"></a>

# 2026-09-23 — TN-61 and the starved DV lane: one defect, two places

**Branch:** `fix/or-133-dv-lane-starved` · **Lane:** O · `scripts/next-item.js` + one test

Two findings that look unrelated and are the same thing: **the tool's output is correct and the
conclusion a reader draws from it is wrong, because what is missing is never accounted for.**

## TN-61 — the truncation line could not fire

READY caps at 10. There *was* a `… and N more (--all)` line, which is why this read as a missing
feature rather than a bug. It was computed from:

```js
const shown = ready.filter((e) => !e.batch || shownBatches.has(e.batch)).length
```

That counts every **unbatched** entry, whether or not the cap reached it. So the line fired only
when a *batch* collapsed rows, and **never when the cap hid them**. With Lane A's READY at 31 and
no batches involved, `shown` was 31, `ready.length` was 31, and ten rows printed in silence.

TN-61 found it the way you would: two entries it had just edited (`TN-55`, `LA-121`) appeared
nowhere in the output, which reads exactly like removed-from-the-queue — the failure the backlog's
own two-deletions rule exists to catch.

It now counts what was actually printed, and says so:

```
      … showing 10 of 16 — `--all` for the rest.
      An entry you cannot see here is BELOW THE CUT, not gone from the queue.
```

**The cap stays at 10**, per the entry's own warning. An implementer wants the next few items, not
thirty-one; what was wrong was that the truncation was invisible.

**One correction to TN-61:** it says *"READY and PARKED alike"*. Only READY truncates — KEEP,
VERIFY, REFERENCE, UNCLASSIFIED and PARKED all print in full. Nothing was changed there.

## The starved DV lane — found while reading, fixed in the same change

`node scripts/next-item.js --lane DV` printed **`nothing startable`** while **116 device checks were
owed**. The device agent's documented start ritual answered "there is nothing for you".

**The lane filter is not the bug, and it must not be "fixed".** `Lane:` says who *builds* a thing. A
check owed on the phone sits on the entry that built it — a Lane B screen fix with a device check
owed is still Lane B's entry, not DV's. `--lane DV` is *correctly* near-empty.

Correctly empty is indistinguishable from *there is nothing for me* unless the tool says otherwise.
So it does now, on both assigned-only lanes (`O` gets it too — Review and BugFix hand the
Orchestrator device work as well):

```
  116 device check(s) are owed across the whole queue and are NOT listed above —
  they sit on the entries that built them, whatever lane those are. `--sittings` groups them.
```

This is the same starvation Lane B hit in August for a completely different reason — 0 startable
against 48 parked. Worth naming as a pattern: **a lane reading zero is a claim about the whole
queue, and a queue tool should never make that claim without checking it.**

## The third place, and it was the one that mattered: `--sittings` hid the blocking work

The owner asked whether device items had actually reached the DV agent. Measured:

| | count |
|---|---|
| entries carrying `Gate: device` (parked — **blocked**) | **44** |
| entries carrying `Verify: device` (shipped, a look owed) | 61 |
| entries carrying **`Lane: DV`** | **0** |

Not one item has ever been routed to the device agent through the lane channel. That is defensible
on its own — `Lane:` says who *builds* a thing, and a check owed on the phone sits on the entry that
built it. What is not defensible is the next number: **24 of the 44 parked entries were invisible to
`--sittings`**, the one view the device agent has.

`owesDeviceCheck` tested `Verify:` and a device-flavoured `Keep:`. It never tested `Gate:`. So the
view showed **116 optional looks and hid the 24 that were blocking** — the priority exactly
inverted. An entry with `Verify: device` has shipped and works; the look is worth doing and blocks
nobody. An entry parked on `Gate: device` proceeds only when the phone answers.

They now print in their own section, first, and deliberately **not merged** into the owed list: one
means *go and confirm this still works*, the other means *this cannot proceed until you look*, and a
sitting that cannot tell them apart spends the owner's attention on the wrong half. The header says
outright that some of the 24 need an APK or hardware built first — `Gate: device` says the phone is
required, not that a check is all that remains. Three of them (`PS-8`, `PS-9`, `PS-16`) are blocked
on a Colmi R09 that is with a second wearer, which no tool can infer.

## The test, and that it was checked against the bug

`scripts/__tests__/next-item-visible-silence.test.ts` runs the real script against the real backlog
rather than a fixture — a fixture would have pinned the *formatting*, and what broke was the
**count being derived from the wrong set**.

Reverted the fix and re-ran: **4 of the 5 cases fail.** The fifth ("does not claim truncation when
everything fits") passes either way, correctly. A regression test that has not been run against the
bug is a guess.

## A note on this branch's own last merge

RV-134 landed while this was open, and this re-merge is its second confirmation. The `.size` file
still conflicted — both sides had edited it *before* the band existed — but resolving it by taking
**main's value verbatim** now passes: 55 lines of slack against a 544-line band, exit 0, no new
number written.

That is a materially simpler drill than the one this session has been running all night. The
resolution for a `.size` conflict is now *take main's side* rather than *recompute from the merged
tree*, because a few dozen lines of staleness is no longer a failure. Recomputing is still correct;
it is just no longer necessary, and "take theirs" is a thing a tired session gets right.

## Not done

- **TN-59 is untouched** — an entry parked only by a prose marker. Different mechanism, still open.
- **No product code.** This is a queue tool; nothing reaches the device or the app.

## Gate

`pnpm ci:local` — exit 0, **Ran 75 of 75** Custom Rules steps, **8,075 tests passed**.

The first run exited 1, and because the log was kept whole rather than tailed it named its own cause
in the first line: the backlog had shrunk 23 lines under its baseline when TN-61 left the queue.
Fixed in one edit. Two earlier gate failures today were piped to `tail -5` and became OR-121 entries
instead of fixes — the difference is the redirect, not the diagnosis.

<a id="2026-09-23-fix-rv-134-size-conflict-tax"></a>

# 2026-09-23 — RV-134: the conflicts were not the ceiling, they were slack detection

**Branch:** `fix/rv-134-size-conflict-tax` · **Lane:** O · `scripts/` + one test

## The measurement the entry was missing

Counted across one night's work on this repo:

| branch | re-merge commits |
|---|---|
| `chore/or-125-owner-decisions` | **12** |
| `fix/dv1-windows-ci-local` | 5 |
| `docs/or-126-raw-archive-brief` | 3 |
| `chore/or-132-owner-decisions` | 2 |
| `fix/or-133-dv-lane-starved` | 1 |

**23 re-merge commits across five branches in one night**, nearly every one of them resolving a
one-line `docs/doc-size/<path>.size` file where **neither side was wrong** — the merged tree's own
count was the answer, and no human judgement was involved in any of them.

## The cause was not where the entry looked

RV-134 described a ratchet that "blames a branch for a shrink it did not cause", which reads as a
problem with the *ceiling*. It is not. The ceiling only fails a branch that grows past it, and that
is rare and genuine.

**Slack detection was the cause.** The rule failed on *any* gap between the file and its number, so
every PR that shrank a tracked doc by even one line had to edit the baseline file — and a one-line
file is the one thing two concurrent PRs cannot both write. Striking a completed backlog entry
shrinks the backlog, and striking a completed entry is what almost every PR does.

So the conflict was not a side effect of the ratchet. It was **slack detection putting a shared
one-line file into nearly every diff in the repo.**

## The fix, and what it deliberately does not do

`check-doc-index-size.js` now tolerates slack within **`max(25, 2%)`** of the baseline and fails only
beyond it.

**Slack detection is kept, not removed**, and that is the whole design constraint. It exists because
CLAUDE.md once sat **429 lines** under its number — the most-read file in the repo able to grow by
half its own length with nothing complaining. 429 against a ~900-line baseline is far outside any
band, and a test pins exactly that case.

**Why a scaling band.** The tracked docs run from a 53-line baton to a 27,000-line backlog. A flat 25
would fail the backlog on 0.1% drift; a flat 500 would let a baton double. The floor carries the
small files and the percentage the large ones, and a test pins that no document's band ever reaches
half its own length.

**Growth is untouched and still fails at the first line over.** The asymmetry is deliberate: growing
past the ceiling is the thing the ratchet exists to catch and the fix there is moving prose. Slack is
a stale number, and a number that is 0.08% stale is not worth a merge conflict.

**Tolerated slack is printed, never silent.** A check that quietly accepts drift is how the 429-line
gap accumulated. The band changes who has to act and when — not whether anyone can see it.

## It demonstrated itself while being written

Striking RV-134 from the queue shrank the backlog by 32 lines. Under the old rule that would have
forced a `.size` edit on this branch, conflicting with the two PRs already in flight. Under the band
(543 for a 27,170-line file) it reported and passed, and this PR touches no `.size` file at all.

Both of the night's real cases fall inside their bands: 23 lines under 27,128, and 7 under 877.

**Then it was verified rather than predicted.** This branch had to be re-merged onto a `main` that
had moved twice while it was open — exactly the situation that produced the 23 commits. The merge
came back clean, the check exited 0 reporting **32 lines of slack inside a 545-line band**, and
**no baseline edit was required**. Under the old rule that same re-merge would have demanded the
backlog number be lowered 27,230 → 27,198, in a one-line file that another PR was holding open at
that moment.

## What remains, correctly

Two PRs that both **grow** past the same ceiling on the same day still conflict. That is a genuine
disagreement about one number and the case a ratchet should conflict on. `LB-120` is annotated with
this rather than struck, since it describes the same subject and should be re-verified against the
new behaviour before anyone builds from it.

## Not done

- **No merge driver.** It was the other candidate and it loses: `merge.<name>.driver` has to be
  configured in every clone — CI, this sandbox, the Windows device machine — and silently does
  nothing where it is missing, which is the current behaviour wearing a disguise.
- **Baselines are still stored, not derived.** Deriving them from the base branch removes the
  ceiling altogether: a file could grow ten lines per PR forever, each increment "inherited". That
  trades a merge conflict for the thing the ratchet is for.

## Gate

`pnpm ci:local` — exit 0, **Ran 75 of 75** Custom Rules steps. Full log kept, not tailed.

<a id="2026-09-23-fix-rv108-weigh-in-invalidation"></a>

# 2026-09-23 — RV-108: a weigh-in cleared 3 of 202 cached keys

**Branch:** `fix/rv108-weigh-in-invalidation` · **Lane:** B · one write path, one sweep, two queue calls

Measured on the S25: logging a weight cleared **3 of 202** cached keys. The sheet's local-store
branch ended at a bare `pushMutations`, and the only invalidation was the *consumer's* — which takes
its `invalidateReadinessInputs()` arm when `onSaved` receives a fresh row, so the body-metric keys
were never evicted at all. Recovery was TTL expiry.

The fix is the one the entry named: copy `water-log-sheet.tsx` exactly — `pushThenRevalidate(userId!,
invalidateBodyMetricWrite)` **and** an immediate `invalidateBodyMetricWrite().catch(() => {})`.

Both halves are load-bearing for different reasons. The immediate call repaints the device that
wrote the row; the post-push one covers what the server derives. An offline write's push never
resolves usefully, so a push-only invalidation repaints nothing.

## The sweep narrowed the fix rather than widening it

Every `pushMutations` call site in `app/`, `components/` and `lib/` was read. **Only this one had no
invalidation at all.** The rest are filed as LB-132, split by how wrong they are: two with no
invalidation in a different domain, five with the immediate half and no post-push half. Two more —
`more-content.tsx`'s pull-sync and `sync-health-card.tsx`'s failed-mutation retry — push without
writing and are correct as they stand.

**`log-value-sheet.tsx` was nearly "fixed" and must not be.** Home's quick-log writes the same
`body_metrics` domain through the same shape, and a ±10-line window around its push shows no
invalidation, so it reads as this defect byte-for-byte. It calls `invalidateBodyMetricWrite()` and
`invalidateReadinessInputs()` **39 lines later, inside the same `try`**. The patch was written and
its own assertion refused to match — patching it would have double-invalidated a correct file.

That is the third time in one day a fixed-line window produced a false finding: a three-line call
whose timezone argument sat on line 3, an over-count of unnamed switches labelled on the next line,
and now this. The baton lesson is widened accordingly — read the enclosing block, not a window.

## Two queue heads re-channelled, because both were blocked at their next action

Working top-down put DV-12 and RV-113 ahead of this, and neither is buildable by Lane B as it
stands. Both were left in `Lane: B` at the head of the queue, where every Lane B session pays to
rediscover that. CLAUDE.md's lane rule separates them cleanly:

- **DV-12 → `Lane: DV`.** Its own "Not established" line says the next step is a CPU profile of one
  tap to name the component that dominates. That is a measurement nobody has taken, with an
  objective output, on hardware only the device agent has. The fix will still be Lane B's.
- **RV-113 → `Lane: O` + `Gate: owner`.** Its two open questions "decide whether this is worth doing
  at all", and both are **looks** judgements on the app's most frequent interaction — is a 180 ms
  blink perceptible, does `bg-page` resolve transparent under the owner's wallpaper. The rule sends
  a feels-right judgement to the owner, not to the device agent. Building the one-line fix first
  risks changing a daily interaction he never asked to have changed.

**`check-backlog-pointers.js` caught a real defect in that edit**: `Gate: owner` written inline on
the `Lane:` bullet is ignored, so RV-113 would have stayed READY with a gate that did nothing. It
has its own bullet now, and the runner parks it.

## Not done, and not claimed

**`Verify: device` + `Keep:`** — log a weight on the S25 and confirm the surfaces reading
`body-metadata`, `day-log:` and `energy-balance:` move without waiting for TTL. The sandbox proves
the calls are present; it cannot watch 202 keys on a phone.

**Still not established, and it bounds LB-132's worth:** whether `pushMutations` → `pullDelta`
reliably fires `invalidateBiometrics` on the device that wrote the row. RV-108 left that open and
this PR does not close it.

Also not exercised: Samsung WebView rendering, native SQLite / Capacitor, drifted production data.

<a id="2026-09-23-fix-rv114-route-transitions"></a>

# 2026-09-23 — RV-114: pushed routes animate

**Branch:** `fix/rv114-route-transitions` · **Lane B**

## What shipped

Seven call sites swapped from `useRouter` to `useTransitionRouter`. Import-only, as the entry
predicted. The plan was re-verified against `main` first: all seven still matched, and every usage
is a `push` or a `back` — never a `refresh` — so nothing animates that should not.

| File | navigates |
|---|---|
| `components/more/friend-leaderboard.tsx` | `push('/profile/…')` |
| `components/more/friend-feed.tsx` | `push('/profile/…')` |
| `app/nutrition/nutrition-content.tsx` | `push('/coach?scope=nutrition')` |
| `app/register/register-form.tsx` | `push('/sign-in?registered=1')` |
| `app/coach/coach-content.tsx` | `back()` |
| `app/coach/confirm/[toolCallId]/confirm-content.tsx` | `back()` ×4 |
| `app/collection/collection-content.tsx` | `back()` |

## The asymmetric pair was the point

Both friends surfaces pushed `/profile/${userId}` with a plain router while that screen's own back
runs the `"back"` keyframes — **open hard, close animated**, the exact inversion
`lib/hooks/use-back-or-fallback.ts` exists to prevent. Nothing at the call site looks wrong, which
is why it is pinned by a test rather than left to review.

## The `/coach` hazard is answered, not deferred

The entry flagged that `lib/view-transition.ts`'s 300 ms cap freezes the outgoing screen if the
destination never commits, and that `/coach` and `/coach/confirm/[toolCallId]` are dynamic routes.

Reading it: `navigate()` is called unconditionally inside the promise executor, **before** the
commit poll starts. The deadline only resolves the promise that ends the frozen snapshot. So a
destination that never commits costs a held frame, never a lost push — a 300 ms hold, exactly as the
entry expected, now with a reason attached rather than a "check this".

## Verification

- `lib/__tests__/rv114-pushed-routes-animate.test.ts` — 9 assertions: each of the seven uses
  `useTransitionRouter` and carries no bare `useRouter`; both friends surfaces still push a profile
  *and* animate it; and `useTransitionRouter` still spreads the real router, so a change there
  cannot silently drop `refresh`/`prefetch` from seven call sites without a type error.
- Control: reverting `friend-feed.tsx` fails 2 of 9.
- `tsc --noEmit` clean · `pnpm check:rules` **Ran 77 of 77** · full suite green · build clean.

## Deliberately not done

**No repo-wide ratchet.** 16 files still use a plain `useRouter` and most are right to: a tab href
needs no transition (`useTransitionRouter` already no-ops for those) and a `refresh()` is not a
navigation. Widening this is its own entry, not a free extra.

## Not exercised

Device. This is motion on daily paths and the sandbox can only prove the call sites changed —
whether the shared-axis transition reads right on the S25 is a look judgement. `/coach` is the one
worth watching, being a dynamic route. Also not exercised: native SQLite, safe-area, Samsung WebView.

<a id="2026-09-23-fix-rv115-more-subtab-crossfade"></a>

# 2026-09-23 — RV-115: More's sub-tab swap crossfades and starts at the top

**Branch:** `fix/rv115-more-subtab-crossfade` · **Lane B** · v1.465.21

## What shipped

Profile ↔ Friends on the More tab swapped via two `<div style={{display}}>` inside one shared
scroller: no motion, and the scroll offset carried across. Both views now swap through the existing
`<TabPanels value={tab}>` — the primitive Friends' own child views already use — and the scroller
returns to the top on each swap.

## The entry's fix was not implementable as written

It said "reset `scrollTop` in `onValueChange`". `PullToSync` owns `scrollRef` privately and exposed
no prop, so the call site cannot reach the element it needs to move.

Added `scrollResetKey` to `PullToSync` instead. **Structural call, Lane B's:** the reset belongs with
the component that owns the scroller rather than being threaded out to every caller, and Health's
three-tab scroller can use it next. Reversal is deleting one prop and one effect.

It deliberately skips its first run. `useScrollRestoration` re-asserts a saved offset across a whole
window after mount, so a mount-time reset would fight the restore — the same scroll-key machinery
RV-112 dealt with earlier today.

## The `mode="wait"` caveat resolves — checked, not assumed

`TabPanels` is `AnimatePresence mode="wait"`, so the outgoing panel unmounts. The entry flagged that
this could trade a hard cut for a skeleton. It does not: both panels re-seed synchronously from
cache — `profile-tab.tsx` in a `useLayoutEffect` with `readCacheSync`, `friends-tab.tsx` with
`readCacheSync('friends-list')`.

**But it costs UI state, which the entry did not name.** Unmounting discards Friends'
feed/leaderboard choice and Profile's expanded sections on every swap. Accepted: More's traffic is 7,
the data is untouched, and the alternative — keeping both mounted for a real crossfade — needs
absolute positioning inside `PullToSync`'s scroller and risks the layout bugs that machinery already
carries. It is written into the code comment so it is not later rediscovered as a bug.

## One limitation, deliberately not fixed

Switching sub-tabs *within* the restoration's re-assert window after entering More can still let the
restore win. That is the behaviour today, so it is an incomplete fix rather than a regression.

## Verification

- `components/__tests__/rv115-more-subtab-crossfade.test.ts` — 5 assertions. The load-bearing one is
  that **both panels still seed from cache**: delete that seeding and this swap silently becomes a
  skeleton flash on every switch, and nothing in More would fail.
- Control: removing `scrollResetKey` fails 1 of 5.
- `tsc --noEmit` clean · `pnpm check:rules` **Ran 77 of 77** · full suite green · build clean.

## Not exercised

Device. A 150 ms crossfade is a feel judgement and the sandbox can only prove the primitive is wired
in. Also not exercised: native SQLite, safe-area, Samsung WebView, drifted prod data.

<a id="2026-09-23-lane-a-dv10-supplement-delete-tombstone"></a>

# 2026-09-23 — DV-10: the missing tombstone, and the column wipe underneath it

**Branch:** `lane-a/dv10-supplement-delete-tombstone` · **Lane A** · `lib/local-store/**` plus the
one call site. No migration, no schema change.

## The entry's measurement was right; its consequence is latent, not live

Device Verification measured it on the S25: deleting a supplement online and offline removed it
from the server and from both lists, but the local row kept `deleted_at: null`. An injury deleted
the same way tombstones correctly.

The entry then said this is *"the 'deleted item comes back' shape (BF-47) waiting for a read path
that does not filter it"*. Checked rather than assumed, and it is **waiting**, not happening:
`getSupplements()` filters `active=1 AND deleted_at IS NULL` — **both** — so the list is right
today, and `applyDelta`'s supplements arm hard-deletes the row on the next pull
(`DELETE … WHERE id = ? AND sync_status='synced'`). The gap is real and worth closing; it is not a
live "my supplement came back".

**It is also not a consequence of DV-5**, which shipped earlier today and touched the *confirm*
arms. Checked, because the two are adjacent.

## The defect the entry did not find, on the same line

The delete called `upsertSupplement({ …the fields this sheet happens to hold, active: false })`.
That upsert writes **every** column, with `?? null` for anything absent — and the rebuilt record
omitted `defaultAmount`, `unit`, `startedOn`, `stoppedOn` and `dosePrompt`.

So **deleting a supplement blanked five columns on the local row.** The one that matters is the
presence window: BF-69's own comment says a date *outside* `startedOn`/`stoppedOn` is a **TRUE
ZERO** while a date inside it with no contribution is **UNKNOWN** and must be excluded from an
aggregate. Nulling them converts one into the other for any local aggregate read between the delete
and the next pull.

It also had a smaller edge: `name: existing?.name ?? ''`, so a delete issued when the list was out
of step would write an empty-named row.

## The fix

`deleteSupplement(id)` on the store, mirroring `deleteInjury`:

```sql
UPDATE supplements SET deleted_at=?, active=0, sync_status='pending', updated_at=? WHERE id=?
```

`active=0` as well as the tombstone, because `getSupplements` filters on both and dropping either
half leaves the row in the list the delete was issued from. `pending` rather than `synced`, because
`applyDelta` prunes only `synced` rows and the push's confirm arm (Q-124) is what flips it — a
delete landing as `synced` would be prunable before its own push had been acknowledged.

An `UPDATE` rather than an upsert is the whole point: an upsert cannot express *"leave the other
columns alone"*, since it always supplies every one.

**Sibling sweep:** `active: false` appears at one other site, `chest-strap-pairing.tsx`, where it is
local React state for a BLE link and has nothing to do with this. One call site to change.

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | drop `deleted_at=?` (the tombstone) | killed |
| 2 | delete also blanks `name` | killed |
| 3 | `sync_status='pending'` → `'synced'` | killed |
| 4 | call site reverts to the rebuilt upsert | killed |
| C | `SET` clause reordered, same placeholders | **survived** (correct) |

## Not done, and what is still owed

- **The device check is DV-10's own pass test and has NOT been run here:** on the S25, delete a
  supplement and confirm `SELECT deleted_at FROM supplements WHERE id=…` is set. These tests are
  source-level scans, for the reason their siblings are — both vitest projects run in `node`, where
  `getLocalStore` returns null, so there is no local SQLite to drive.
- **The column wipe is fixed going forward, not repaired in place.** A row already blanked by a
  previous delete stays blanked until the next pull replaces it — which it will, because the server
  row is the source of those fields and `applyDelta` overwrites a `synced` row wholesale.
- **Failure surfaces not exercised:** the device, the APK, and any real offline transition.

<a id="2026-09-23-lane-a-dv13-device-metrics-blocking"></a>

# 2026-09-23 — DV-13: the outage was probably us deploying, and the route was still wrong

**Branch:** `lane-a/dv13-device-metrics-blocking` · **Lane A** · one admin route and its new test.
No migration, no schema change, no client change. **DV-13 stays queued** — see Keep.

## The entry said to measure before fixing, and measuring changed the answer

DV-13 was filed with the Oura BLE admin console as the suspect for an eight-minute production
outage, explicitly flagging that the cause was **not proven** and naming the first two reads:
`error_events`, and Railway's logs for 20:00–20:15 AEST.

**`error_events` for the window holds exactly two server rows, and they are at 20:12:36–37** — the
moment of *recovery*, not the stall:

```
GET /api/day-timeline   [cause: timeout exceeded when trying to connect] Failed query: select …
/api/body-battery       [cause: timeout exceeded when trying to connect] Failed query: select …
```

That is a **pool-acquisition** failure — the app could not obtain a database connection — which is
what a container looks like while it warms, and is neither a slow query nor a blocked event loop.

## The merge timeline, which nobody had put beside it

```
19:47:07  #1463      19:51:20  #1466      20:03:30  #1468      20:18:18  #1467   (AEST)
                                    outage: 20:04:40 → 20:12:41
```

**Four merges in sixteen minutes, each auto-deploying to Railway production — and #1468 landed 70
seconds before `/api/version` first went slow.** A replaced container explains a database-free route
timing out for minutes and then answering in 0.5 s, without needing a blocked loop at all. Those
merges were mine, earlier in this same session, which is the part worth saying plainly: the
measurement that looked like a device-agent finding is substantially an artefact of how fast this
lane was merging.

## The route was still doing something indefensible

`device-metrics` called `toAestDay` — `formatInTimeZone` — **once per raw row**:

| measurement | value |
|---|---|
| rows in the owner's default `?days=3` window | **58,856** |
| cost of one `formatInTimeZone` call | **11.2 µs** |
| synchronous time before any decoding | **656 ms** |
| extrapolated at `?days=14` | **~3.1 s** |

On sandbox CPU, so worse on Railway. Nothing else runs on the process while that happens — and the
siblings named in the entry (`samples/summary`, `rollup-state`, `samples/pack`) have **no such
loop**, which is checked, not assumed. So a documented "single-row read" appearing to hang is the
signature of *the process being occupied*, not of that route being slow. That part of the entry's
reasoning was right.

The fix memoises the day lookup **by minute**. No UTC offset is finer than a minute, so every
timestamp in a minute is in the same local day in every zone — the result is identical and the
formatter is called at most 1,440 times per day of window instead of once per row.

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | route memo keyed by hour | killed |
| 2 | bucketing loop bypasses the memo | killed |
| 3 | the TEST's own helper keyed by hour | killed — by Kathmandu and Chatham |
| C | key written `60000` rather than `60_000` | **survived**, after a fix |

**Mutation 3 is why the zone list is what it is.** An hour-keyed memo passes every whole-hour zone;
only the 45- and 45/60-minute offsets catch it. **The control failed first time** — the source scan
pinned the literal `60_000`, so the identical `60000` broke it. That is the third time today an
assertion pinned syntax instead of contract (TN-60, RV-82, here); it now matches the value in either
form.

## Keep — DV-13 is NOT closed

1. **That `device-metrics` caused the outage is still not established.** 656 ms, or even 3 s, does
   not account for a 90-second abort, and the deploy correlation is the better explanation for that
   window. Do not close this entry by pointing at the fix that shipped.
2. **The loop is cheaper but still unbounded** — the row cap and the explicit per-request timeout
   from the entry's fix direction are not done.
3. **Railway's logs for 20:00–20:15 AEST are unread** — no access from the sandbox.
4. **The device pass test needs the phone.**

## Failure surfaces not exercised

The device, and production. The route was not executed end-to-end — it needs an admin session — so
what is pinned is the bucketing's equivalence and the route's use of it, measured against the real
row count read from production rather than a guess.

<a id="2026-09-23-lane-a-dv3-migration-user-race"></a>

# 2026-09-23 — DV-3: the advisory lock was the wrong lock, and the race is reproducible

**Branch:** `lane-a/dv3-migration-user-race` · **Lane A** · test infrastructure only. No product code,
no migration, no schema change.

## What DV-3 reported

One CI failure on PR #1419 (a docs-only change): `Tests` red with
`insert or update on table "exercise_estimates" violates foreign key constraint
"exercise_estimates_user_id_fkey"`, 1 file of 997, **green on re-run**. The entry was explicit that
it had read the test rather than reproduced it, and named three possible fixes.

## Two of the three suggested fixes were unavailable, and the third was already in place

- *"take the same advisory lock the migration runner uses"* — **the test already takes it.**
  `personal-records-reconcile-migration.test.ts` has used `migrationTestLock` since Q-171.
- *"move it to the `rollup`-style serial project"* — **there is no serial project.** `vitest.config.ts`
  has `rollup` and `unit`; `rollup` differs only in its 60 s timeout, and both run files in parallel
  workers.
- *"scope what it runs to its own users"* — possible, but `migration-test-lock.ts`'s own header
  argues against scoping a data migration, since table-wide is what it is for.

## What the advisory lock actually covers, and the gap

It serialises **migration tests against each other** — sixteen files take the key. It says nothing
about ordinary tests. Measured: **171 test files run `DELETE FROM users`; nine of them take the
lock.** The other 162 can delete a user at any moment.

Migrations **163 and 164** both carry
`INSERT INTO exercise_estimates … SELECT … FROM personal_records` with no user filter. At READ
COMMITTED the `INSERT … SELECT` fixes its snapshot at statement start, so it reads a foreign user's
`personal_records` rows, blocks on the referential-integrity check while that user's `DELETE` is
still uncommitted, and fails the moment the delete commits.

## Reproduced, not inferred

Hold an uncommitted `DELETE FROM users` on a second connection, start the migration, wait until it
is **observably blocked** (polled from `pg_stat_activity`, not slept on), then commit the delete.

| | result |
|---|---|
| `pool.query(sql)` | `23503 exercise_estimates_user_id_fkey`, **3 of 3** |
| `LOCK TABLE users IN SHARE MODE` first | green, **3 of 3** |

## The fix

`runMigrationSql(pool, sql)` in `migration-test-lock.ts` prepends `LOCK TABLE users IN SHARE MODE`
to the migration, inside the same implicit transaction that `pool.query` of a multi-statement
string already creates. Adopted by **both** exposed files — `personal-records-reconcile` (the one
DV-3 named) and `cable-exercise-merge`, which carries the identical INSERT and is the file Q-171
already recorded failing one run in three.

`SHARE` is the weakest mode that conflicts with the `ROW EXCLUSIVE` a `DELETE` takes, and it is
self-compatible, so migration tests do not block each other on it. Taking it **first** is what keeps
it deadlock-free: ordinary tests hold only their own short `DELETE FROM users` lock and never wait
on a table this transaction already holds.

Not a retry — Q-171 forbids it, and DV-3 repeated the prohibition.

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | lock removed entirely | killed — FK violation returns |
| 2 | weakened to `ACCESS SHARE` (does not conflict with `DELETE`) | killed |
| C | strengthened to `EXCLUSIVE` (still conflicts) | **survived** (correct) |

Mutant 2 is the one worth keeping: it proves the test pins the lock's **conflict semantics** rather
than the word `SHARE`, so a future "tidy-up" to a weaker mode cannot pass.

## Not done, and a residual risk stated plainly

- **The other 162 `DELETE FROM users` files are untouched.** This closes the two migrations that
  insert into a user-referencing table; it does not make the shared test database safe in general.
- **Deadlock is reduced, not proven impossible.** A test that deleted a user *and* wrote a
  migration-touched table inside one explicit transaction could still deadlock with this lock
  ordering. None does today. Postgres would detect it rather than hang.
- **Failure surfaces not exercised:** none that apply — this is test infrastructure, runs only
  against a real Postgres, and touches no product code, no device path and no UI.

<a id="2026-09-23-lane-a-dv5-pending-after-push"></a>

# 2026-09-23 — DV-5: four confirm arms that could never mark a pushed row synced

**Branch:** `lane-a/dv5-pending-after-push` · **Lane A** · engine only, no UI, no migration.

## What DV-5 reported, and what survived checking

Device Verification measured 33 tombstoned `food_logs` rows on the S25, all
`sync_status='pending'`, against an **empty** outbox — three of them from pushes that had
returned 200. That part reproduced exactly at source.

`pushMutations` confirms a drained mutation by re-reading the row through the **UI-facing
getter** and upserting it back with `syncStatus: 'synced'`. `getFoodLogs` is
`… WHERE date = ? AND deleted_at IS NULL`, so a delete's row is never found, the `if (rec)`
guard silently does nothing, and the outbox entry is dropped regardless. The tombstone is then
`pending` forever — and `applyDelta` only ever overwrites `synced` rows, so no later pull can
correct it and the local prune (`DELETE … AND sync_status='synced'`) can never reclaim it.

## The sibling sweep found three more, one of them worse than the reported one

Every delete-capable domain was checked against its getter:

| domain | getter filters `deleted_at IS NULL` | was broken |
|---|---|---|
| `food_logs` | yes | delete only — **the reported one** |
| `injuries` | yes | delete only |
| `supplement_logs` | yes | delete only |
| `plan_meal_answers` | yes | **every write** — the domain had no confirm arm at all |
| `supplements`, `saved_meals`, `activity_logs` | yes | already fixed (Q-124, Q-328) |

`plan_meal_answers` is the one worth naming: it was absent from the confirm chain entirely, so
every answer stayed `pending` after a successful push, not only the deletes — and `applyDelta`
gates **each of that table's columns** on `sync_status='synced'`, so those rows were unreachable
by the server from the first write.

## What shipped

Three new keyed marks beside the existing `markFoodLogSynced`/`markActivityLogSynced`:
`markInjurySynced(id)`, `markSupplementLogSynced(supplementId, logDate)` and
`markPlanMealAnswerSynced(planMealId, logDate)` — narrow `UPDATE`s that read nothing back, which
is the whole point. `markSupplementLogSynced` carries `source='manual'` in its `WHERE`, because
the branch that uses it cannot apply the read path's `(r.source ?? 'manual') === 'manual'`
narrowing, and without it confirming one delete would also mark that supplement's **meal**
contribution synced.

## One existing test had to be rescoped, and it came out stronger

`supplement-contribution-chain.test.ts` asserted the manual narrowing by slicing **400
characters** after the arm's opening line. The new delete branch pushed the narrowing past that
window and the test went red on a change it should not have cared about. It now slices to the
arm's **real extent** (up to the next `} else if (m.domain === …)`) and additionally asserts that
`markSupplementLogSynced`'s body contains `source='manual'` — so the delete branch is covered
where it never was. Both halves were mutation-checked; each kills its own mutant.

## Mutation pass

Six mutants, all killed; two deliberately equivalent controls, both survived.

| # | mutation | result |
|---|---|---|
| 1 | food delete branch removed | killed |
| 2 | food delete reads `payload.foodLogId` | killed |
| 3 | non-delete path short-circuits to the mark | killed |
| 4 | injury delete branch removed | killed |
| 5 | supplement log keyed on a wrong date | killed |
| 6 | `plan_meal_answers` arm deleted entirely | killed (3 tests) |
| C1 | `const id = …; if (id)` → `if (typeof … === 'string')` | **survived** (correct) |
| C2 | plan-meal arm rewritten with an equivalent nullish guard | **survived** (correct) |

## Not done, and not claimed

DV-5 also reported **one `set_logs` row pending since 2026-09-19 whose
`exercise_logs.workout_session_id` is not in the local `workout_sessions` table**. That is **not**
this defect: the `workout_log` arm calls `markWorkoutSynced(wsId, exerciseLogId)`, a keyed
`UPDATE` that reads nothing back, so a filtered getter cannot explain it. Read at source and left
unexplained rather than assumed — carved out as **DV-8**, `Gate: device`, because nothing in the
sandbox can open a local SQLite file.

**Failure surfaces not exercised:** native SQLite (`getLocalStore` returns null under node, so
every local-store test in this repo is either a fake-store or a source scan), the real on-device
store, and any Samsung WebView behaviour. The proof here is source-level and unit-level; the
**pass test in DV-5 — an empty outbox with zero pending rows — can only be run on the device.**

## Queue

- **DV-5** removed; **DV-8** filed for the unexplained half.
- **LA-129 repositioned.** It had landed at the top of READY because it was filed beside the entry
  it argued with, and queue position *is* priority here — which silently promoted a change the
  owner had deliberately deferred. Moved below the defects, with the reason recorded in the entry.
