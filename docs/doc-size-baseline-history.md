# Doc-size baseline — change history

Every raise and every ratchet-down of the baselines in `docs/doc-size-baseline.json`, with the
reasoning that was recorded at the time. This file is append-only and is **not** read by any
check — it exists so the reasoning survives without living in the script.

It was extracted on 2026-08-19 from `scripts/check-doc-index-size.js`, which had reached 1,091
lines of which 955 were these comments. Every PR that added a documentation line had to prepend
a paragraph here, in the same region of the same file, which made it the most frequent merge
conflict in the repository — touched by 32 of the last 40 commits. **Eight records had already
been duplicated by conflict splicing** — deduped 2026-08-20, see the dated section at the bottom
of this file. The figure of "two blocks, duplicated verbatim" recorded here at extraction time
was an undercount and wrong about the shape: no copy was byte-identical, which is exactly why a
headline-matching scan found a quarter of them.

**Raising a baseline no longer edits a script.** Change the number in the JSON, and add a dated
section here saying why. Conflicts in an append-only log resolve by keeping both.

---

## 2026-08-26 — `docs/implementation-backlog.md` 11882 → 11903 (Q-406 blocked at `Gate: owner`)

Q-406's warning-row decision was taken to be built and turned out not to be buildable. Option A moves
the mismatch sentence *"to the food's detail"*, and **this surface has no food detail**: the external
food-database row's tap is `onAddExternal` → `createFoodItem` + `accept()`, so it adds the food to the
meal with no inspect step, no confirmation and no quantity sheet in between. Building A as decided
would have deleted the only visible explanation and left an amber icon on a row that adds on tap.

**Why the finding is in the queue rather than a journal entry.** It re-opens a `Gate: owner` and names
the three ways out; whoever takes Q-406 next has to read it *before* writing code, and the backlog is
the file they read. A journal entry is where a shipped change is explained — this is a change that was
deliberately not shipped, and the reason has to sit on the entry it blocks.

Trimmed from 24 lines to 21 before raising: the three options became one bullet rather than a numbered
list, and the conversion note lost its restatement of what `FoodRow` is.

## 2026-08-25 — the compaction chore, first pass (`docs/implementation-backlog.md` 12146 → 11799)

**A RATCHET DOWN of 347 lines, and the first time this file has been made smaller on purpose rather
than as a side effect of finishing work.** The owner approved the chore this log proposed two records
above: an entry long because it was written as an *investigation*, and now answered, moves to
`docs/reviews/` with a pointer left in the queue.

**Two entries, chosen by a rule rather than by size.** BF-4 (229 → 21) and Q-388 (165 → 23) — both
investigations concluded today, so the extraction could be vouched for rather than guessed at. Being
long was explicitly *not* the criterion: the top fifteen entries are 2,863 lines, 23% of the file,
and most are long because they specify unbuilt work, where the length is the deliverable.

**The test a pointer has to pass:** someone deciding the question should not need to open the review
doc. So each entry keeps the measured conclusions that bear on the decision — BF-4's input-token
correlation and the never-run payload bound, Q-388's drain figures and the firmware night-gating that
makes "run it at night" a no-op — and sheds the working.

**Do not read this as licence to shrink the file generally.** The remaining thirteen of the top
fifteen should stay until their own investigations conclude. A queue file that is short because its
specifications were thrown away is worse than a long one.

---

## 2026-08-25 — LA-24 shipped and Q-304b closed (`docs/implementation-backlog.md` → 11948)

**The file ends the day at exactly the number it started it on.** Both moves are entries leaving
rather than prose being cut: LA-24's Kind 2 was decided by the owner and shipped as migration 224, so
its entry went; Q-304b was decided *against* and collapsed from 62 lines of open investigation to 27
of recorded decision.

(Set from 12021 here because LA-28's own reduction to 11997 is in a PR that had not merged when this
branch was cut. Both land at the file's real length, which is the only number that matters — this is
exactly the case the "never splice, re-derive from the file" rule exists for.)

**Worth reading with the three raises above it, because the shape of the day is the point.** The file
went 11948 → 11989 → 12005 → 12021 → **11948**. Every raise was an entry being *corrected* — a
premise production contradicted, where the measurement tables are what stop the next session
re-running the same queries. Every reduction was an entry being *finished* or *answered*. Net zero,
which is the right steady state for a queue file: it should breathe with the queue rather than
ratchet upward with prose.

The compaction chore the BF-4 record proposed is still worth doing — several answered entries belong
in `docs/reviews/` with a pointer left behind — but it is no longer urgent on size grounds alone.
## 2026-08-25 — LA-28 shipped (`docs/implementation-backlog.md` 12021 → 11997, a RATCHET DOWN)

**−24, and it is the first move in the other direction today.** LA-28 completed, so its entry left
the queue. The baseline follows the file down rather than banking the slack — the point of a
shrink-only ratchet is that headroom cannot be saved up and spent later.

Worth recording beside the three raises above it (11948 → 11989 → 12005 → 12021 → **11997**): the net
for the session is **+49**, not the +73 the BF-4 record named, because completing an entry gives the
lines back. The raises were for entries that were *corrected*; this is one that was *finished*. That
is the distinction to watch if the trend is ever argued about — a queue file growing because work is
being recorded is different from one growing because work is being done.

---

## 2026-08-25 — BF-4 re-measured (`docs/implementation-backlog.md` 12005 → 12021)

**+16, and this is the THIRD raise of this file in one session (11948 → 11989 → 12005 → 12021, +73
total). That is a real cost and is recorded as one rather than absorbed.** The number is 16 rather
than the 19 first written because LA-26 merged in between and its LA-26 → LA-28 swap freed 3 lines;
the baseline was set to the file's real length instead of keeping the slack, which is the whole
point of a shrink-only ratchet. All three are the same
shape: a queue entry whose premise production contradicted, where the measurement tables are what
stop the next session re-running the same queries.

The gross addition here was **38**; half of it was paid for by deleting prose the finding made
stale, which is the only reason the raise is 19:

- The paragraph asking which structured-output strategy the SDK uses and whether `maxOutputTokens`
  helps — migration 208's own header answered both on 2026-08-24, and the entry never caught up.
- The "all 30 calls by shape" table, compressed to two lines now that the correlation figure
  (r=+0.958 on input, −0.122 on output) carries the same conclusion more sharply.
- The retry ruling-out and the unchanged-dependencies list, both settled.

**If this file needs a fourth raise, compact it instead.** The entries being corrected are long
because they were written as investigations; several are now answered and could move to
`docs/reviews/` with a pointer left behind. That is a compaction chore, not a per-PR fix, and it is
the right response to this trend rather than another +19.

---

## 2026-08-25 — LA-27 answered (`docs/implementation-backlog.md` 11989 → 12005)

**+16, and it closes an investigation rather than opening one.** LA-27 was filed hours earlier in
the same file asking why a third of `exercise_logs.estimated_1rm` could not be re-derived. It is
answered: those logs predate `set_logs.planned_pct` persistence (0% of sets before July, 40% in
July, 94% in August), so the prescription was applied at log time and never written to the set row.
Not data loss.

**The +16 is almost entirely the recoverability breakdown, and that is the part worth the lines.**
Of 257 pre-August logs missing the column, 90 carry no style (factor 1.0 is correct), 167 could be
re-derived via `style_id` → `style_sets`, **but 76 of those belong to a style edited after the log**.
Progression styles are user-editable, so re-deriving those substitutes today's prescription for the
one actually trained under. That number is what turns Q-304b from "blocked pending investigation"
into "the recompute is worse than the defect", and losing it to a size baseline would cost the next
session the same four production queries.

**Deliberately kept out:** the mechanism is now stated once, in LA-27. Q-304b carries only the
consequence and points at it — the first draft had both in full and was 22 over instead of 16.

---

## 2026-08-25 — Q-304b re-measured and LA-27 filed (`docs/implementation-backlog.md` 11948 → 11989)

**+41, and it is a new queue entry plus a rewritten one, not accreted prose.**

Q-304b asked for a recompute of 30 `personal_records` rows, gate already cleared by the owner on
2026-08-24. Measuring against production before building it produced three findings, each of which
blocks the entry as written, and none of which fits in a line:

1. The specified method moves **zero rows by construction** — `personal_records` derives from
   `exercise_logs.estimated_1rm`, a stored column, not from `set_logs`.
2. The blast radius is **277 logs, not 29 sets** — `amrapScaleFactor` discounts from 6 reps up, not
   the 13+ the entry describes.
3. **115 of 357 eligible logs cannot be reproduced by either formula**, and it is time-localised:
   August reproduces 68/68, July 9/102.

Finding 3 became **LA-27** rather than a bullet inside Q-304b, because it blocks Q-304b rather than
belonging to it, and because it is the one an implementer should take first. That entry is ~28 of
the 41 lines.

**The two measurement tables are deliberately kept in the queue rather than moved to a review doc.**
They are what stops the next session re-running the same four production queries, and the entry's
whole failure mode was a number nobody re-checked.

---

## 2026-08-25 — Q-112 re-planned into five phases (`docs/implementation-backlog.md` raise withdrawn)

Q-112 — the unified day review — was a single spec-sized entry that said of itself *"whoever picks
this up should write a proper implementation plan first"*. The plan is now written
([`2026-08-25-unified-day-review.md`](superpowers/plans/2026-08-25-unified-day-review.md)) and the
entry became an umbrella plus **Q-112a–e**, each one PR with its own lane, branch and `Needs:`.

**A +19 raise was prepared and then withdrawn**: the original entry carried 28 lines of direction
and the umbrella replacing it carries 9, because the reasoning went to the plan rather than the
queue — and by the time the branch was cut, `main` had shrunk the file enough that the growth fitted
inside the existing headroom. Recorded because "no raise needed" is worth knowing was checked, and
because without moving that reasoning out it would have been a ~60-line raise.

**Why the re-plan was needed, recorded because this is how a queue entry goes stale silently:**
Task 27's central premise — that no per-day read-through screen exists — stopped being true on
2026-08-08, two days after it was written, when Q-110 shipped `/health/day`. An implementer taking
the entry at face value would have built a third day surface and re-implemented seven working
sections.

## 2026-08-25 — PS-6 filed (`docs/implementation-backlog.md` raise withdrawn, again)

**PS-6**: the queue tooling has never known the `OR-` prefix, in three regexes across two scripts.
Its length is mostly the one fact that makes it urgent rather than cosmetic: `next-item.js` **drops**
an entry whose heading matches no known prefix (`current = id ? {…} : null`), so an `OR-` entry is
not mislabelled, it is absent, with nothing printed to say so.

**A second entry, OR-1, was withdrawn from this PR before merge.** It reported the red E2E on
`main`, and another session filed the same failure as **BF-23** while this branch sat in CI — with a
better diagnosis. OR-1 concluded the `Log Body Weight` button had been deleted, because the string
greps to nothing outside two specs; BF-23 establishes it is **composed at runtime**
(`metric-tiles-card.tsx:96`, `` aria-label={`Log ${def.label}`} ``) and that the failure is a
**regression from one of tonight's six merges**, not a stale test. BF-23 anticipates the exact wrong
inference OR-1 drew — *"a future session searching for the string will find nothing and conclude it
was deleted; it was not."* Keeping both would have put a refuted diagnosis in the queue beside a
correct one.

**PS-6 is filed under `PS-`, not `OR-`, on purpose** — an `OR-` entry describing this bug could not
appear in the tool that reports it. That is recorded in the entry so the letter does not read as a
mistake later.

**The raise to 11648 was withdrawn on the rebase and the number stands at 11638** — the second time
in one session. #454 landed while this branch was in CI and removed enough completed entries to take
the file to **11534**, under the original baseline even carrying these two entries' +64. Ratcheting
down to 11534 was again declined for the same reason as the earlier withdrawal: the shrink belongs
to the PRs that made it, and banking it here would fail the next agent to add an entry. **Worth
noticing as a pattern rather than a coincidence** — on a queue this active, a raise taken at the
start of a CI cycle is often unnecessary by the end of it, so check the real count after the rebase
before keeping one.

## 2026-08-25 — `projectOverview.md` 7937 → 7941 (`docs/implementation-backlog.md` raise withdrawn)

The owner supplied the Railway charts three queue entries had been parked on, and the readings
falsify **Q-549**'s premise: `prod_DB` holds **423 MB flat**, not 0.79 GB.

**The first draft of this cost +8 and +50, and the ratchet was right to refuse it.** Most of those
lines were *measurement*, not queue state — the settings dump, the arithmetic, the caveats, the
reasoning about where 0.79 GB came from. That belongs in a reference doc, and it now lives in
[`docs/reviews/2026-08-25-railway-and-db-readings.md`](reviews/2026-08-25-railway-and-db-readings.md)
(new, unratcheted), linked from the platform index. What is left in the backlog is three short
pointer blocks — the finding, the consequence for that entry, and a link — which is entry content.

**The backlog raise to 11658 was withdrawn on the rebase and the number stands at 11638.** #444,
#447 and #449 landed while this branch was in CI and removed enough completed entries to take the
file to **11572** — under the original baseline even carrying this branch's +20. Ratcheting it down
to 11572 here was considered and rejected: that shrink is those PRs' to claim, and banking it in
this one would fail the next agent to add an entry (BF-11's plan is imminent) for a saving this
branch did not make.

The `projectOverview.md` +4 is one new Known-Issues row: the database is growing **~1.6 MB/day
against `CLAUDE.md`'s stated ~0.4**, almost all of it `oura_raw_samples` doing its job.
`CLAUDE.md` mandates a row for exactly this, and it is filed as a *measurement awaiting a third
reading* rather than a defect — two points off a baseline taken immediately after a repack is not
a trend, and the honest next step is another reading, not a fix.

## 2026-08-25 — `docs/implementation-backlog.md` 11811 → 11848 (Q-154 decided, two corrections)

Three owner-facing edits, none of them new entries.

**Q-154's gate cleared** — the owner chose option 2 after being shown the three sparkline states
rendered at true size from the real geometry rather than described. Most of the added length is the
part that stops the decision being over-read: option 2 licenses dropping *the halo and the dimmed
dots*, not accepting today's primitive as-is. The other five differences are general wants any
caller could have, so they stay primitive props — and the `±0.5` padding in particular must not
survive, since it halves the amplitude of a small-range series.

**Q-395 finding 14's overclaim struck.** It promised grouped sections would reclaim "most of the
vertical space"; the measurement was 16% → 11%, a screen 111 px shorter out of 2,649. Lane B
measured that at the time and wrote it in the journal and in a code comment, but nobody struck it
here — so the owner read the original promise, expected a big visual change, and reported not seeing
one. **The lesson is the cheap half: when an implementer refutes a claim, strike the claim where the
claim lives**, not only where the work happened.

**Q-406's park note was written and then dropped on the rebase — it was already out of date.** The
owner had asked to park the per-row-warning question and check back once the other nutrition agents
had possibly settled it. They had: `main` now carries **the warning design decided 2026-08-26,
option A**, the owner's pick, with the gate cleared and the treatment specified — plus the thumbnail
shipped in v1.380.0. Recording "parked, not answered" on top of that would have re-opened a settled
question, so this branch took `main`'s side whole for that region. **The check the owner asked for
was the rebase itself**, and the answer was yes.

## 2026-08-24 — `CLAUDE.md` 1154 → 1155

One line on the backlog-conflict rule, because the class recurred a third time and the rule now has a
check behind it. #348 removed four resurrected entries and wrote the rule; **#349 put LB-4 back four
commits later**, from a branch cut before #348 landed. A rule cannot reach a branch that predates it,
so the line records what `check-backlog-pointers.js` catches (a heading with no body — the shape all
three took) and what it deliberately does not (a resurrection that restores a full entry, which wants
git history CI does not have at depth 1).

## 2026-08-23 — BF-9, the trainer role

**`docs/implementation-backlog.md` — no raise needed in the end.** The owner wants to build programs for other
people from his own app instead of borrowing their phone.

81 lines added, 54 net. Long for an unplanned feature, and the length is almost entirely the security
surface. Every write in this app is `user_id` scoped by design; this feature deliberately breaches
that, and `saveProgram` is *already* parameterised by user id — so the only thing between the feature
and one account writing into another is a guard that does not exist yet. An entry that said "add a
trainer role" and stopped would leave a planning session to rediscover that, and the discovery order
matters: the cheap reading is "reuse `isAdmin`", which would hand every trainer the operator console
and the read-only SQL endpoint.

The other half is what should *not* be built: `friendships` already implements the consent handshake
(only the addressee can accept), `users.friend_code` the discovery, `invited_emails` the onboarding,
and `programs` is already in the sync delta, so delivery to the trainee's device needs no new work.
Four things not to rebuild is worth the space it takes to name them.

**Amended in the same PR** once the owner approved the shape and gave the population — ~3 users, 5 at
most, all known to him, *"so risk woudl be accepted"*. That removes real work (no permission matrix,
no audit trail, no tenancy model) and the entry says so. It also needed a paragraph saying what the
acceptance does **not** cover, because the cheap misreading is "small trusted group, skip the
guards": the ownership checks stop a *bug* writing to the wrong account, not an attacker, and with
five people sharing one database a mis-scoped write corrupts a real person's history and then syncs
it to their device. `isAdmin` stays off the table for the same reason — it is an operator permission,
not a trainee one.

**Final bookkeeping, after the merge:** this entry was drafted twice as a raise (11517 → 11571, then
→ 11599) and ended up needing neither. #124 landed first and removed the 66-line Q-479 entry it
completes, which more than absorbed BF-9 — so the baseline stays at **11517** and this section
records a raise that did not happen rather than deleting the reasoning for one. Twice in one day a
drafted raise has evaporated because parallel work shrank the file underneath it; the lesson is to
treat the number as provisional until the merge lands, not to skip the note.

---
## 2026-08-23 — Q-479 shipped; four docs still said it never would (`docs/q479-shipped`)

**projectOverview.md 7879 → 7897 · docs/agents/state/implementation-lane-a.md 150 → 152.**

The owner merged #124 on 2026-08-23, reversing their own 2026-08-18 decision to carry Q-479 as an
accepted risk. Four places still asserted the opposite, and one of them is the first thing every
session reads:

- **projectOverview +13**, across the two Q-479 rows. The Lane A row led with *"ACCEPTED RISK …
  deliberately unmerged"* about a fix that is now on `main`; Review's row still read as open. Both
  now name the merge, and the Lane A row states the one thing still owed — production and the
  24-hour window were **not** exercised end to end, so it stays in the live list rather than being
  archived.
- **the Lane A baton +2**: it instructed successors that #124 *"must NOT be merged"*. That line had
  been carried forward through three batons after the decision it described was made, which is the
  argument for the rewrite-in-full rule rather than against it — a copied line outlives its reason.

Both figures are the script's own, measured on the merged tree.

## 2026-08-23 — the owner confirms BF-8, and settles BF-7

**`docs/implementation-backlog.md` 11474 → 11517.** 43 lines across two amendments, both in place
rather than as new entries.

BF-8 was filed the same day as an unreported observation from a screenshot — the Intensity control
reading "Full · As prescribed" above a deload. The owner then confirmed it from experience: *"I was
under the assumption I was doing my full session but it looks like it has been deload."* A second
screenshot showed the active session header omitting it too, which traced both surfaces to one wrong
predicate — `isDeloadActive` answers "is the phase a deload week", never "is today's session a
deload". Promoted to the head of the queue and re-tagged 🔴, because a training decision was made on
a wrong reading of the app's own display.

BF-7 shrinks in scope rather than growing: the owner anchored the length slider to the session's
configured budget and dropped 15 minutes, which settles two of that entry's three findings outright —
the second at zero cost, since the floor and the warmup-clamp arithmetic tuned to it now stand
unchanged. The reasoning stays in the entry even though the questions are answered; a plan that knows
why 15 was dropped will not reintroduce it.

---

## 2026-08-23 — BF-7 and BF-8, both out of one screenshot

**`docs/implementation-backlog.md` 11377 → 11474.** One owner request (a 45-minute session length)
and one defect intake found in the same image without being asked (the Intensity toggle reading
"Full · As prescribed" above a card reading "Deload session").

97 lines, and BF-7 carries most of it because three separate things stop it being a control swap: the
on-screen minutes are derived rather than fixed, the relativity behind that is a **recorded owner
decision that explicitly rejected the absolute ladder now being asked for**, the requested 15 minutes
sits below a floor that a second constant is tuned to meet exactly, and a slider fires a ~2.4 s AI
call per detent on a path that deliberately bypasses its own cooldown. Any of those discovered
mid-implementation costs more than the paragraph that prevents it — the July decision in particular
is a code comment nobody would think to grep for.

BF-8 is short by comparison and is the reason to keep reading screenshots for what was not reported.

---

## 2026-08-23 — BF-4 amended from the archived history

**`docs/implementation-backlog.md` 11367 → 11390.** The owner pointed at the pre-cut repo, and its
3,225 commits corrected two claims BF-4 had already been merged asserting: that the image payload was
the prime suspect (the camera call is byte-identical since 2026-06-12, so it cannot be what changed),
and that the AI call was measurably not the regression (instrumentation only landed 2026-07-22, so
the data cannot see June at all).

49 lines for a correction to an existing entry, of which the net raise is 23 — the rest is absorbed by
what landed on `main` in parallel. The corrections sit **above** the original analysis rather than
replacing it, which is the reason for most of the length and is deliberate: an entry that quietly
rewrites its own conclusion teaches nobody why the first reading was wrong, and this one was wrong in
a way that will recur — a measurement whose window is narrower than the question being asked.

---

## 2026-08-23 — BF-4, the photo-scan slowdown

**`docs/implementation-backlog.md` 11381 → 11367 — a ratchet DOWN, not a raise.** An owner report that
the nutrition photo scan got much slower, filed high in the queue rather than at the tail: it is a
live regression on a daily-use flow, not a note for later.

The entry adds 82 lines, and it was written expecting a raise to 11463. It merged against a `main`
that had removed Q-362b in #297, which took out more than the entry put in — so the file ends up
*under* its own baseline and the honest bookkeeping is to bring the number down to what the file
actually is. Recorded this way deliberately: the first draft of this note claimed a raise that never
happened, which is the failure mode a size log exists to prevent.

82 lines is a lot for one bug, and most of it is evidence that redirects the work rather than
describing the symptom. The obvious diagnosis is the AI call, and production latency data refutes it:
18 image scans across a month average 4,168 ms, the *earliest* one is above that average, and the
model never changed. An entry that only said "scan feels slow" would send an implementer straight at
the prompt. The table is what stops that, so it stays in the entry rather than moving to a review doc
nobody opens first.

The rest is the field-name trap (`getPhoto` takes `width`/`height`, its sibling `takePhoto` takes
`targetWidth`/`targetHeight`, and the wrong pair is silently ignored — a downscale that never
happens, which reads as a fix that did not work), and the note that nothing times the client half at
all, so the reported quantity has no measurement anywhere.

---

## 2026-08-23 — BF-1's owner decision, and the public-repo hazard it exposes

**`docs/implementation-backlog.md` 11350 → 11381.** The owner cleared BF-1's gate by choosing
crop-before-upload, which unblocks the entry but also answers a question nobody had asked: what
happens to the example report they have ready for testing.

31 lines, and the largest single block of it is the warning that this repository is public and a real
pathology report must never become a test fixture. That is worth queue space rather than a passing
mention. The identifiers BF-1 exists to strip are exactly what a committed fixture would publish, git
history makes it permanent, and the obvious next step for anyone building this — drop the sample in
under `__tests__/fixtures/` — is the step that does it. A warning that is not sitting in the entry
being implemented is a warning that arrives too late.

The rest records two verified constraints the decision surfaced: the upload path is image-only
(`ALLOWED_IMAGE_MIME` has no PDF) while a lab report is usually a PDF, and no crop UI exists in the
app today, though `Camera.getPhoto({ allowEditing: true })` may supply one for free.

---

## 2026-08-23 — three owner feature notes (BF-1, BF-2, BF-3)

**`docs/implementation-backlog.md` 11328 → 11350.** Three feature requests the owner sent as one
message, filed by BugFix intake at the tail of the queue: the DEXA calibration filter for the
scale's body-fat estimate, dosed-substance tracking (GLP-1s, creatine), and blood-panel import.

The branch adds 184 lines; the net raise is 22 because the queue-hygiene work that landed on `main`
the same day trimmed 162. 184 for three entries is above the ~30-lines-per-entry budget intake
normally works to, and it is deliberate rather than drift. Each of these is a *feature* heading for a planning session
rather than a defect for an implementer, so the entry has to carry the trace that stops the plan
re-deriving it: for BF-2 that is the six-step chain from the BIA estimator to the calorie and
protein goals plus the measured 15.4 kcal/day-per-body-fat-point sensitivity; for BF-3 the three
specific schema facts that rule the existing supplements model out; for BF-1 the finding that the
app's own AI logging is already clean and the exposure is the provider call itself. Dropping any of
that would move the work into a planning session instead of removing it.

Whoever writes those plans should take the corresponding entry back down to a pointer at the plan
doc in the same PR — that is the ratchet-down this raise is anticipating.

---

## 2026-08-20 — Lane A's baton, second raise in one day (`fix/queue-blockers-as-fields`)

**docs/agents/state/implementation-lane-a.md 124 → 150.** 113 → 124 → 150 in a single day, and a
ratchet raised twice by the same author on the same file is exactly the erosion these baselines exist
to prevent. So: what it bought, and what should happen instead.

The growth is four more traps (a helper extracted for testability but never wired to its caller;
green not proving a CI-only path ran; a check that adds a network call adds a way to fail) and a
**Now** section that says why each of the top three queue items is not startable — which is the single
most useful thing a successor can be told, and it cannot be derived from the queue.

**The honest conclusion is that the ratchet is the wrong instrument here, and PS-4 is the fix.** A
baton is rewritten in full at every handoff, so its number measures one session, not accretion; 150 is
PS-4's own ceiling, and I trimmed twice to reach it rather than raising to whatever fell out. The
durable part — inherited findings none of which is recorded elsewhere — should move to permanent homes
(the Oura ones to `docs/oura-ble-operations.md`) at the next handoff, which is the real reduction. The
baton now says so in place.

## 2026-08-20 — LA-13 closed (`feat/migration-replay-check`)

**projectOverview.md 7883 → 7889.**

Six lines, and four of them are carrying the near-miss rather than the feature: the first version of
the check was **green with a migration deliberately broken**, because the SQLSTATEs that are benign on
an ordinary run are the failure signal under replay. A reader who takes "CI now catches non-idempotent
migrations" at face value would not know how narrowly that became true, or why the acceptance
criterion said *demonstrated, not argued*.

## 2026-08-20 — Lane A's baton, rewritten mid-session (`docs/lane-a-baton-refresh`)

**docs/agents/state/implementation-lane-a.md 113 → 124.** A raise, and it is worth saying why rather
than quietly taking it.

The predecessor's 113 covered a session that shipped three items; this one covers six, and most of the
growth is a **Traps** section — `reset --soft` does not merge, a rebase replays conflict resolutions
as new content, a count that moves further than your change explains is the bug. That is the part a
successor cannot re-derive.

**The ratchet is an awkward fit on this one file and the number should be read with that in mind.** A
baton is *rewritten in full* at every handoff, so its size measures one session's state rather than
accretion — which is what the ratchet exists to catch everywhere else. PS-4 (baton compaction) sets
the real target at **~150 lines**, and 124 is comfortably under it. Trimmed from 126 first; the
remainder is content, not padding.

## 2026-08-20 — Q-421 handed to Lane B (`feat/migration-replay-check`)

**projectOverview.md 7877 → 7883.**

Six lines, and the first raise made under the new rule — which now names the branch's own contribution
in the failure message (*"6 of which this branch added"*), so the number is no longer something to
work out by subtraction.

The lines are carrying two facts a reader cannot reconstruct: that Q-421 is finished as far as Lane A
is concerned, and that the queue tool was routing an entry to the wrong lane. The second is the kind
of thing that silently wastes a session.

## 2026-08-20 — Q-424 closed: this file's own failure mode, fixed (`fix/doc-index-baseline-order-independence`)

**projectOverview.md 7870 → 7877.**

The last raise made under the old rule, and the one that explains why nine of the entries below exist.
The ratchet compared the tree against a committed number, so it was answering *"is this file over"* —
a fact about `main` as much as about the branch — and two independently-green PRs could merge into a
red `main`. It now asks whether **this branch** grew the file, and an inherited overage is reported
rather than failed.

**Expect this log to get shorter.** Most of the recent entries are re-measurements forced by the base
moving mid-PR, not decisions about documentation. Those stop being necessary: a branch that did not
grow a file no longer has to touch its number at all.

## 2026-08-20 — Q-362a closed (`fix/day-log-workout-durations-key`)

**projectOverview.md 7864 → 7870.**

Six lines, and half of them are carrying the *shape* rather than the fix: this shipped additively, so
the index has to say that the old colliding record is still being emitted on purpose. A reader who
takes "closed" to mean the name-keyed record is gone would go looking for a consumer bug that does
not exist — and would not know LA-15 is what finishes it.

## 2026-08-20 — RV-33 closed (`fix/ownership-refusal-status-two-routes`)

**projectOverview.md 7857 → 7864.**

Seven lines. The index needs the *shape* of this one because it recurs: the refusal was already
correct and the repository was already throwing the right error — what was missing was the handler
guard, so a 404 arrived as an empty 500 and filed itself as a server fault. Naming the two routes and
the `updateMealType` hardening is what stops the next reader assuming the ownership check itself was
absent.

## 2026-08-20 — RV-32 and RV-34 closed (`fix/style-id-ownership-on-create-paths`)

**projectOverview.md 7848 → 7857.**

Nine lines for a security batch, and the length is carrying one specific thing: production shows no
row that was ever mis-linked, **and** `claude_ro` is row-scoped to the owner, so the victim's rows are
exactly the ones that query cannot see. Recording the clean count without that caveat would read as
"this never happened", which the data cannot support. The rest — which paths, which FK, what the
unscoped join leaked — is the shortest form that lets a reader decide whether to open the journal.

Measured at the end, on the base this actually merges into, which is the lesson from the entry below.

## 2026-08-20 — Q-331 closed (`test/session-energy-cross-surface-parity`)

**projectOverview.md 7838 → 7848.**

Ten lines, because the entry was filed as a hardening item and closed as a live defect: the done
screen and the day screen were estimating the same workout with two different formulas, for 42 of 78
sessions. A reader of the index needs the *defect*, not the test — so the index says which sessions
were affected and that a mutation-verified test now holds the two together, and the journal entry
carries the measurement and the vacuity trap the test had to get past.

**This number was drafted three times before it was right** — 8058, then 7885, then no raise at all,
as two compactions and four other PRs moved the base underneath it. Only the last one was measured on
the tree this PR actually merges into. Draft the prose when the lines are written; take the number at
the end, on the final base, or it is a figure that looks deliberate and is stale.

## 2026-08-20 — PS-3 closed (`fix/non-idempotent-migrations`)

**No raise — recorded because one was drafted twice and both figures went stale.**

Three lines went onto the existing migration-gate handoff paragraph, recording that the four
migrations retried on every cold start are now idempotent and the dev database records 206 of 206.
Against `main` at the time that needed 8055 → 8058; a compaction landed mid-PR and it became
7875 → 7878; a second compaction landed and the file now sits at **7806**, comfortably under the
7875 already on `main`. So the raise was withdrawn rather than carried.

Worth a block despite raising nothing: a baseline drafted against a `main` that then compacts is a
number that *looks* deliberate and is stale. Re-measure on the merged tree at the end, not when the
lines are written.

## 2026-08-20 — re-measured a third time, after #263 (`fix/migrate-classifies-idempotent`)

**projectOverview.md → 8055 · docs/implementation-backlog.md → 11647 ·
docs/agents/state/implementation-lane-a.md → 113.**

Three PRs landed on `main` while this one was open — #261, #263 — and a parallel session pushed its
own merge onto this same branch. Each time both numbers were rebuilt from `origin/main` and
re-measured on the merged tree rather than spliced.

**Correcting the entry below:** the baton ratcheted to **113**, not 103. The 103 was measured before
the wrap-up added its `next-item.js` guidance, and the number that shipped is the later one. Left as
a correction rather than an edit, because this log is append-only and a silently-edited figure is
exactly what makes the other entries untrustworthy.

## 2026-08-20 — re-measured after #261 landed mid-PR (`fix/migrate-classifies-idempotent`)

**projectOverview.md → 8055 · docs/implementation-backlog.md → 11647.**

Both numbers were rebuilt from `origin/main` and re-measured on the merged tree, not spliced from
either side of the conflict — the two sessions had each raised the same two numbers for different
reasons, which is precisely the case where taking one side loses the other's growth.

**And the conflict itself had already been mis-resolved once, on `main`.** The BugFix session's
wrap-up replaced the `Session handoff:` link in `projectOverview.md` but left the *previous*
handoff's description attached to it — so the index credited the 2026-08-20 energy-intake handoff
with "six findings from a live APK reinstall and Oura re-sync" and Q-536's closure, which belong to
the 2026-08-17 one. Fixed here by rebuilding the block so each of the three links carries its own
description. Worth knowing because it is the same splice failure this history file exists to
prevent, one file over.

## 2026-08-20 — session wrap-up (`fix/migrate-classifies-idempotent`)

**projectOverview.md 8043 → 8050 · docs/implementation-backlog.md 11573 → 11578 ·
docs/agents/state/implementation-lane-a.md 163 → 113 (a net ratchet DOWN of 50).**

- **projectOverview +7**: the session-handoff pointer, which is part of the wrap-up ritual.
- **backlog +5**: a `Gate: owner` field added to Q-420 and Q-422. Both listed as **READY** under
  `scripts/next-item.js` while each says in its own body that it waits on the owner — the blocker
  was in prose, which is exactly what the `Gate:` field replaced. Expect more of these; the tool can
  only see the field.
- **the baton −50**: rewritten in full rather than appended to, which is the rule. Its size is a
  direct read of whether that rule was followed, so the number goes down with it.

## 2026-08-20 — Lane A's baton, ratcheted down (`fix/migrate-classifies-idempotent`)

**docs/agents/state/implementation-lane-a.md 163 → 103.**

A ratchet *down*, not a raise. The baton is rewritten in full at every handoff rather than appended
to — that is the rule that stops it accreting — so its size is a direct read of whether the rule was
followed. Lowering the number is what makes the next drift visible.

## 2026-08-20 — PS-3's open question, answered against production (`fix/migrate-classifies-idempotent`)

**docs/implementation-backlog.md 11559 → 11573.**

Fourteen lines annotating PS-3, and every one of them is a measurement or a scope reduction rather
than narrative:

- **The question the entry says to answer first is answered.** `claude_ro.schema_migrations` holds
  206 of 206 filenames, the four among them. Production skips all four; this is local-only. Without
  that on the entry, the next session repeats the query — and it is a production read, not a
  grep.
- **They were never failures.** The four raise SQLSTATEs `ensureSchema()` treats as *already
  present*; `migrate.js` had no classifier. Recorded because the entry's own framing ("4 failed") is
  what a reader would otherwise carry forward.
- **What is left is smaller than the entry implies**, and the note says so outright so the item is
  judged on quiet rather than on the original framing.
## 2026-08-20 — the Orchestrator role

**CLAUDE.md 1107 → 1115.** A sixth standing agent, owning queue and docs hygiene: clearing entries
that announce their own completion, assigning batches, resolving lanes, reconciling docs against
reality. The CLAUDE.md growth is the two rules an implementer needs without opening the contract —
the completed-heading check and its `Keep:` opt-out, and the role's place in the letter list.

`docs/agents/state/orchestrator.md` joins the ratchet as a new row at 62 lines, not a raise.

---

## 2026-08-20 — the CSP could not start a WASM session (`fix/csp-wasm-unsafe-eval`, Q-546)

**projectOverview.md 8018 → 8043.**

One Known-Issues row, 25 lines. It is longer than a header change usually warrants because three
things about it are not obvious from the diff and would otherwise be re-derived:

- **Why the missing directive survived.** `onnxruntime-web`'s parity test passes under Node, which
  enforces no CSP at all — so it proved the model matched its golden while nothing could have loaded
  it in a WebView. A reader who does not know that reads the green test as coverage.
- **What is still owed on the device, and that it is two separate things.** That the app still loads
  on the S25 under the new header, and — not possible yet — that a real WASM session instantiates,
  which cannot be asserted until the first client-side model lands.
- **One thing measured and deliberately not acted on:** `onnxruntime-web` 1.27 can create a worker
  from a blob URL when threading is enabled, which `script-src` would also have to permit. Recorded
  so the next session does not re-measure it, and left alone because widening a security header on
  speculation is the wrong order.

The backlog shrank in the same PR (Q-546 removed), so only this number moves.

---

## 2026-08-19 — the extraction itself (`claude/agent-setup-task-numbering-5gojd9`)

**projectOverview.md 8009 → 8018 · docs/implementation-backlog.md 11177 → 11338 · CLAUDE.md 1085 → 1100.**

*(The backlog figure was recomputed after merging `main`, which had itself raised that number to
11225 inside the old script — the conflict this change exists to remove, hit once more on its own
branch. Resolved by taking the rewritten script whole and re-measuring the merged file, never by
splicing either side's number.)*

The first raise recorded here rather than in the script, which is the point of the change.

- **CLAUDE.md +15.** The standing-instruction block on entry numbering was replaced: reserved bands
  out, per-agent prefixes in, plus the lane rule that supersedes the path enumeration, the readiness
  query as an implementer's first command, and the `Needs:`/`Gate:` field definitions. It is longer
  than what it replaced because the old text was one rule and the new text is four, each of which a
  session has to follow without reading `docs/agents/README.md` first.
- **implementation-backlog.md +113.** Four new entries (`PS-1`…`PS-4`) at ~25 lines each, the
  rewritten header documenting the three fields, and 17 added `Needs:`/`Gate:` lines — **against
  Q-543's 38-line entry removed as complete**, so the net is smaller than the gross.
- **projectOverview.md +9.** One Current Status paragraph naming the new prefixes and the query
  command, since that is the thing every session needs to know before it can file anything.

**Amended the same day — batching (`Batch:` field).** implementation-backlog.md → 11353, CLAUDE.md →
1107. The owner asked at what level 210 entries should aggregate into PRs; the answer and its
measurements are documented in `docs/agents/README.md` §3, with a one-paragraph pointer in each of
the other two. CLAUDE.md's +10 is the rule an implementer must have without opening the contract:
never batch a migration, batch native hardest, a sweep is already a batch.

Five files were added to the ratchet in the same change — the agent batons, at their measured sizes
(BugFix 136, Lane A 163, Lane B 413, Tuning 563, Review 1,281). Those are entry rows, not raises.

---

## Extracted history (verbatim, oldest at the bottom as it was written)

```
2026-08-18 (Review sweep 39, Q-556 cross-user isolation): backlog -> 9953, projectOverview -> 7876.
Rebuilt from origin/main after a parallel compaction sweep landed the same history file --
splicing the conflict hunks would have produced two baselines for one number.

Keeps the orientation documents readable. Same ratchet shape as check-component-size.js.

These files are what every session reads before it can start, and they are the ones that rot,
because appending to them is always the locally cheapest move. By 2026-08-17 projectOverview.md
had reached 9,647 lines — 3,361 of them a Current Status section holding 157 dated notes in no
date order, describing work going back ten weeks — while its own opening line called it a lean
index. The backlog carried a 397-line header, 268 of which were one nested chain of
"Previously N (updated ... Previously N (updated ...". Prose asking for restraint did not hold;
nothing measured it.

So: a shrink-only baseline. A file may sit at or below its recorded size and may never grow.
A change that genuinely has to add lines raises the number here in the same PR, which puts the
growth in the diff where it can be seen, rather than letting it drift up one commit at a time.

2026-08-18 (Review, Q-554 orientation-index paths): backlog -> 9876, projectOverview -> 7806.
One queue entry and its row. Both keep the module-map specifics (row 232, decodeStepsPacket, zero
references) because "a doc named a path that does not exist" is forgettable while "the map read to
avoid re-implementing things listed something never built" is the reason the check exists.

2026-08-18 (Review, Q-553 known-issue duplication): backlog -> 9841, projectOverview 7805 -> 7785.
projectOverview RATCHETS DOWN here even though an entry was added: Q-139's stale 69-line "OPEN"
body became a compact device-check row and Q-81's duplicate archive copy was cut, so the removals
outweigh the addition and the net is -20. The baseline is shrink-only, so locking the lower number
in is the point -- reclaimed space cannot quietly refill.

Raised 2026-08-18 (Review, Q-499 reproduced + Q-552 ledger): backlog -> 9809, projectOverview -> 7805.
Q-499's entry grew rather than a new one being added: it was filed on static reading and is now
reproduced, and the before/after (1 node -> 0, control at 1) is what makes it actionable. Plus one
new entry for the Q-block ledger near-miss.

Raised 2026-08-18 (Review, silent card failures, Q-499): backlog -> 9762, projectOverview -> 7773.
One queue entry and its row. Both keep the 78/18 and 12-candidates/2-confirmed splits, because the
honest scope IS the finding here -- a row that said "12 cards vanish" would be a defect count this
sweep did not earn, and the next reader would inherit it as fact.

Raised 2026-08-18 (Review, unbounded request bodies, Q-498): backlog 9690 -> 9727,
projectOverview 7722 -> 7747. One queue entry and its row. Both keep the 113/7/93/3
coverage split and the line numbers showing the ingest route parses at 40 and checks the secret
at 58 -- the ordering is the finding, and a summary that drops it reads as "add a size cap",
which is the smaller half of the fix.

Raised 2026-08-18 (Review, admin range-loop termination, Q-497): backlog 9652 -> 9690,
projectOverview 7693 -> 7722. One queue entry and its row. The entry keeps the measured loop
trace (iter 32 = 10000-01-01, still looping at 5000) because the defect is invisible from the
source -- every guard on the route reads correct, and only the trace shows the exit condition
inverting. It also names the second site, which writes.

Raised 2026-08-18 (Review, health-connect ingest, Q-493..Q-496): backlog 9557 -> 9652,
projectOverview 7655 -> 7693. Four queue entries and one row, for four findings on one route.
The rows carry the measured before/after pairs (81 kg -> 499 kg; 1 limiter key at 20 vs 30 at 1)
because both findings are counter-intuitive from the source alone -- the limiter returns an
identical 401 either way, so without the numbers the next reader re-runs the experiment.

Raised 2026-08-18 (Review, CLAUDE.md prose counts, Q-492): backlog 9520 -> 9557,
projectOverview 7631 -> 7655. One queue entry and its row. The measurement they carry is the
count-by-count table, which is the whole finding — a summary of it would leave the next reader
re-deriving nine numbers to know which are trustworthy.

Raised 2026-08-18 (Review, aria-expanded collapsibles, Q-491): backlog 9477 -> 9520,
projectOverview 7603 -> 7631. One queue entry and its row. The lines that earn their place are the
MEMBERSHIP diff, not the count: CLAUDE.md's nine and today's nine are different sets (one fixed,
one never listed, two moved), so citing the count alone would hide that the list is what drifted.
Both also carry the meta-pattern — three hand-maintained counts in CLAUDE.md found stale this run
(Q-480, Q-490, Q-491) while every ratcheted count is current — which is the argument for fixing
this with a script rather than a sweep.

Raised 2026-08-18 (Review, render rules part 2): projectOverview 7576 -> 7603. No queue entry —
all four rules held. The row is worth its lines because it records the three raw counts that look
like findings and are not (85 index keys, all on static lists; a 62-field useShallow pick holding
actions rather than hot-path values; 25 bare readCacheSync hits, three of them false positives in
the orchestrator and one of those the COMMENT stating the rule). Without it the next sweep
re-derives all three and may file them.

Raised 2026-08-18 (Review, memo-stability audit, Q-490): backlog 9439 -> 9477, projectOverview
7551 -> 7576. One queue entry and its row. Both lead with the CLEAN number (64 of 66 memos hold,
no inline arrows anywhere) because without it the entry reads as though memoisation is broken
here, and both carry the fix caveat that the per-meal site wants SCALARS rather than a useMemo —
a useMemo there needs one memo per row, which is worse than the bug. Both also flag that no render
counts were measured; the claim is from object identity, not a profiler.

Raised 2026-08-18 (Review, ms-offset → calendar day, Q-489): backlog 9393 -> 9439, projectOverview
7523 -> 7551. One queue entry and its row, and the lines that earn their place are the NEGATIVE
ones: most instances of the banned ms-offset pattern are CORRECT (rolling instant windows feeding
hours-based consumers like computeMuscleRecovery), so an implementer who greps the pattern and
"fixes" all twelve would break muscle recovery. Both also carry the measured DST table, which
cannot be re-derived without re-running the transition arithmetic.

Raised 2026-08-18 (Review, local-first write coverage): backlog 9387 -> 9393, projectOverview
7501 -> 7523. No new entry — the sweep BOUNDS Q-488 (it is one handler, not a class), which is the
question an implementer has to answer before budgeting the work, so it rides on that entry. The
row also carries two things a later audit would otherwise get wrong: the file-level version of
this check is unsound (it clears the very file Q-488 is in), and "no pull mapping" is not evidence
of a gap, because saved_meals is push-only and kept fresh by hydrate-on-read by design.

Raised 2026-08-18 (Review, server-only writes to local-first domains, Q-488): backlog 9384 -> 9387,
projectOverview 7468 -> 7501. One queue entry and its row. Both carry three lines that decide how
it gets triaged and fixed: it SELF-HEALS via the tombstone (visible inconsistency, not data loss);
the originating screen is CORRECT because it reads the server-side day-log aggregate, which is why
nothing on that screen could reveal it; and making the delete work offline is a separate, larger
question that must not be folded into the one-call fix.

Raised 2026-08-18 (Review, seed-only read paths — case (b)): projectOverview 7439 -> 7468. No
queue entry; the audit found no gap. The row is worth its lines for two things that are otherwise
rediscovered by running a bad test: the mechanical seed-only check (readCacheSync minus
cachedFetch) OVER-REPORTS, because revalidation also happens via a raw fetch+setCached and via a
local-store read+setCached — and the third is the app's most authoritative path, so a
network-shaped test marks it stale. Plus: a `Q-NNN:` comment here is usually a fix's rationale,
not an open defect. That misread cost a false alarm twice in this run (Q-117, Q-126).

Raised 2026-08-18 (Review, load-bearing cache audit): projectOverview 7411 -> 7439. No queue entry
— the audit found no gap. The row is the *result table* plus two things that would otherwise be
rediscovered the hard way: session-select-content.tsx:896's "never invalidated" comment is the
comment on the Q-117 FIX, not a live defect (it reads exactly like one), and case (b) of Q-262's
test — seed-only read paths — remains unaudited and is the likelier source of a stale-value report.

Raised 2026-08-18 (Review, production verification round 2): backlog 9359 -> 9384,
projectOverview 7369 -> 7406. No new queue entries — six existing ones amended in place with what
production says, which is the cheapest possible place to carry it. The backlog growth is those
amendments; the projectOverview row carries the pull-69 / push-0 table because that asymmetry is
the evidence for Q-475 and cannot be re-derived after error_events prunes at 30 days. It also
carries the two queries that look like evidence and are NOT (water is too sparse; null-weight-with-
steps is the expected shape), so the next reader does not pick them up.

Raised 2026-08-18 (Review, Tier-A enqueue silence, Q-486): backlog 9312 -> 9359,
projectOverview 7339 -> 7369. One queue entry and its row. The lines that earn their place are the
three "do not": do not undo the layering (local write, then a direct POST as primary, then the
outbox — that ordering is deliberate and documented in the file), do not convert the four calls to
`await` (they are fire-and-forget so the UI stays instant), and do not treat this as reproduced —
it needs a broken local SQLite on a device and the web sandbox cannot reach the code path at all.

Raised 2026-08-18 (Review, implausible-value sweep, Q-485): backlog 9264 -> 9312,
projectOverview 7309 -> 7339. One queue entry and its row, both carrying the two lines that stop
it being implemented wrongly: the shared BOUNDS are correct and must not be touched (One Formula,
One Place is holding — only the behaviour differs), and the fix is NOT "throw everywhere", because
a throw quarantines the mutation and the poison-pill rule forbids that for a validation failure.
An entry missing either line produces a worse app than the bug does.

Raised 2026-08-18 (Review, unvalidated-create-bodies sweep, Q-484): backlog 9214 -> 9264,
projectOverview 7277 -> 7309. One queue entry and its row. Both carry two caveats inline that are
the reason the entry is safe to act on: the 10 MB figure is NOT a storage number (TOAST compressed
a single repeated character to ~120 kB, real text would not), and the 33 no-schema routes are a
CANDIDATE count, not a defect count — 31 are unaudited and are neither broken nor fine. An entry
that dropped either caveat would get implemented against numbers that do not mean what they say.

Raised 2026-08-18 (Review, malformed-route-id sweep, Q-482/Q-483): backlog 9049 -> 9138,
projectOverview 7243 -> 7277. Two queue entries and the row indexing them. Q-482 carries its
14-route table inline because the finding IS the list — an implementer needs to know which routes
to guard, and re-deriving it means re-running 39 probes. Both carry the evidence-reading caveat
(a 500 is conclusive, a 400 is not, because the probe sent an empty body) — without it the routes
absent from the table read as verified-correct, which they are not.

Raised 2026-08-18 (Review, empty/n=1 account sweep): projectOverview 7213 -> 7243. No queue entry
— the sweep found nothing to file. The row exists for the method correction inside it: a probe
that greps a JSON response for NaN/Infinity detects neither, because JSON.stringify serialises
both to null. That check had already produced two clean-looking runs before it was caught, and it
is the kind of thing a later sweep repeats unless it is written where orientation reads it.

Raised 2026-08-18 (Review, outbox-replay-idempotency sweep, Q-481): backlog 9005 -> 9049,
projectOverview 7184 -> 7213. One queue entry and its Known-Issues row. Both carry the SYNC-P7
caveat inline — the additive write is deliberate and an implementer who "fixes" it to an absolute
set reintroduces the clobber it was written to prevent — and both carry the activity_logs result
that looks like it contradicts sweep 9 and does not (different writers). Those two are the lines
that stop the entry being implemented wrongly, which is the only reason the entry exists.

Raised 2026-08-18 (Review, server-side verification sweep, Q-480): backlog 8967 -> 9005,
projectOverview 7157 -> 7184. One queue entry and one Known-Issues row, both for a sweep that
found nothing. The lines are the *inventory of what was checked* — which repository and shared
helpers thread the session tz, that all four timezone-sensitive SQL sites are parameterised, that
all 104 rate-limit keys are user- or IP-scoped — and that inventory is the entire value: without
it the next sweep re-derives it, and Q-477's fix scope stays unbounded. A clean result costs lines
exactly once.

Raised 2026-08-18 (Review, auth/session-boundaries sweep, Q-479): backlog 8846 -> 8894,
projectOverview 7122 -> 7157. One queue entry and its Known-Issues row. Both carry the measured
A/B inline (POST /api/exercises 201 against GET /api/admin/errors 403, same cookie, same instant)
because a privilege-persistence claim without its control is not a finding, and both carry the
harness warning that produced a false clean on the first run — a session-staleness test needs a
cookie jar that is written back. The sweep's prose is in
docs/reviews/2026-08-18-auth-session-boundaries.md, which this ratchet does not govern.

Raised 2026-08-18 (Review, non-default-timezone sweep, Q-477/Q-478): backlog 8908 -> 9005,
projectOverview 7068 -> 7122 (the last 8 record that #112 fixed Q-473 and that Review re-ran the
original reproduction against the merged code — 'shipped' and 'fixed' are different claims and
the measurement is what separates them). Two queue entries and the one Known-Issues row indexing them.
Both entries carry their measured layer table inline (server / todayInTz(tz) / todayInTz() /
localDateString(), with the value each produced for the same user at the same instant) because the
finding IS that table, and reproducing it needs a moment when three calendar dates are
simultaneously live plus a fresh login to re-stamp the JWT. The sweep's prose is in
docs/reviews/2026-08-18-timezone-non-default-user.md, which this ratchet does not govern.

Raised 2026-08-18 (Review, outbox-under-failure sweep, Q-475/Q-476): backlog 8802 -> 8908,
projectOverview 7028 -> 7068. Two queue entries and the one Known-Issues row indexing them.
Q-475 carries its backoff arithmetic inline (30 s / 2 m / 8 m / 32 m, five attempts, ~42.5 min to
dead-letter the queue) because the whole finding is that number: the entry is unreadable as a
priority call without it, and re-deriving it means stopping a database. The sweep's prose is in
docs/reviews/2026-08-18-outbox-under-failure.md, which this ratchet does not govern.

Raised 2026-08-18 (Review, write-concurrency sweep, Q-473/Q-474): backlog 8634 -> 8722,
projectOverview 6991 -> 7028. Two queue entries and the one Known-Issues row indexing them —
entries, per the same split as every raise above. Q-473's entry carries its four-trial
measurement table inline because the run is not cheaply repeatable (each trial needs a fresh
workout row and a 65-second wait for the rate-limit window), and an implementer fixing a race
needs the reproduction rate, not a claim. The sweep's prose is in
docs/reviews/2026-08-18-write-concurrency.md, which this ratchet does not govern.
Baseline recorded 2026-08-17, immediately after the cleanup that produced these numbers.

Raised 2026-08-17 (Tuning, Q-500/Q-501): backlog 5698 -> 5722, projectOverview 6372 -> 6382.
Two new queue entries replacing one (Q-271 superseded by Q-500, plus Q-501) and one rewritten +
one new Known-Issues row. This is queue and open-issue content, which is what these two files are
for — the growth the ratchet exists to catch is narrative and dated notes, not entries.

Raised 2026-08-17 (Review, Q-450…Q-455): backlog 5722 -> 5903, projectOverview 6382 -> 6428.
Six new queue entries from the failure-cells sweep and the one Known-Issues row that indexes
them. Same justification as above: entries, not narrative. The sweep's actual prose lives in
docs/reviews/2026-08-17-failure-cells-running-the-app.md, which this ratchet does not govern —
which is the split it is meant to enforce.

Raised 2026-08-17 (BugFix intake, Q-387): backlog 5945 -> 5972, projectOverview 6443 -> 6461.
One owner-reported queue entry and its Known-Issues row — entries, per the same split as the two
raises above. Recorded because the first draft was 24/48 over and the ratchet was right to catch
it: the trace, the measured table and the three-option assessment are what an implementer needs,
and roughly a third of the rest was showing the work. Intake adds an entry per report, so this
ceiling will be pushed regularly — the answer is a periodic sweep moving *cleared* entries out,
not a standing allowance for verbose ones.

Raised 2026-08-17 (BugFix intake, Q-388): backlog 5972 -> 6057, projectOverview 6461 -> 6484.
One owner-reported queue entry, and a deliberately larger one: ~20 of its 85 lines are measured
production tables (7-day event counts by tag, and by hour of day) behind an owner-scoped
claude_ro view that **prunes at 30 days**. Re-deriving them after that window is impossible, so
they are preserved in the entry rather than cited. The prose around them was cut from a first
draft 100 over. If a later sweep moves this entry out, the tables go with it.

Raised 2026-08-17 (Q-530 planning): backlog 6057 -> 6154, projectOverview 6484 -> 6488.
One queue entry for the planned snapshot endpoint, plus a re-measurement folded into the existing
Q-288 rather than filed as a second entry. The projectOverview half is three lines correcting a
wrong number already in the index (/api/export covers 26 of 82 tables, not 27 of 80) and naming a
defect that changes how it must be fixed — a correction to an existing row, not new narrative.
The backlog half also carries Q-530's ordered step list and the new optional `Lane:` field on
Q-530/Q-288 — routing an implementer to the right lane and flagging a shared unlisted path, which
is queue mechanics rather than narrative and is exactly what this file governs.

Raised 2026-08-17 (Lane A, Q-536 diagnosis): backlog 6417 -> 6474. The Q-536 rewrite (+19) replaces
a refuted diagnosis with the measured one and keeps the refuted text folded in a <details>, which
is the cheapest way to stop it being re-derived; Q-314 (+38) is the new queue entry for the root
cause, +8 more when Q-536's repair shipped and its entry had to say which half is done. Entries
and a corrected entry, per the same split as the raises above. projectOverview
6547 -> 6568 for Q-536's Known-Issues row: a live, unrepaired data-correctness fault on displayed
health values, which is exactly what that section indexes. +3 more when the repair shipped, to
say which half is done and which is still owed — the distinction the row exists to carry.
Raised 2026-08-17 (one-off DB-storage planning session, Q-530…Q-535): backlog 6057 -> 6191,
projectOverview 6484 -> 6505 — this session added 134 and 21 lines respectively, and the two
raises landed the same day, so these numbers are the sum rather than either branch's figure.
Both were recomputed from the merged files rather than spliced from the conflict hunks, which is
how a merge of two same-day ratchet raises silently drops one side. Six queue entries and one
Known-Issues row — entries, per the same
split as the raises above. The analysis itself (the measurements, the five costed options, the
D4 prerequisite audit) is in docs/superpowers/plans/2026-08-17-db-storage-raw-samples-retention.md,
which this ratchet does not govern. Two of the six entries are blocked on an owner decision and
carry the "what this irreversibly gives up" summary inline deliberately: an implementer must not
have to open the plan to discover that the item is a one-way door.

Raised 2026-08-17 (DB-storage planning, renumbered to Q-538…Q-542 on merge): -> 6594 / 6597.
Five queue entries plus an amendment folding two more into a concurrent session's Q-534 rather
than filing duplicates of it. The amendment is longer than a cross-reference because it corrects
a measured claim in that entry (autovacuum had run; the null reading was a post-crash statistics
artifact) and a wrong correction is more expensive than a long one.

Raised again 2026-08-17 for the disk_full incident (Q-536): backlog -> 6235, projectOverview -> 6534.
A live production outage entry and its Known-Issues row. Both carry the proven mechanism inline
(n_tup_upd=681,005 with n_tup_hot_upd=0) rather than citing it, because the counters reset at
crash recovery and cannot be re-derived later — the same reasoning as the Q-388 raise above.

Raised 2026-08-17 (Lane A, Q-536): projectOverview 6618 -> 6642, backlog 6584 -> 6649. The Q-536
entry rewrite replaces a refuted diagnosis with the measured one and says which half of the repair
shipped and which is still owed; Q-314 is the new queue entry for the root cause; the
projectOverview row is a live, unrepaired fault on displayed health values. Entries and a
corrected entry, per the same split as the raises above.

Raised 2026-08-17 (Lane A, Q-536 follow-up): projectOverview 6647 -> 6653, backlog 6649 -> 6665.
v1.318.0's migration rolled back in production on every boot and the repair never landed; both
entries now say so, because "shipped" was recorded here and was false. A correction to an existing
row and an existing entry, which is the cheapest possible place to carry it.
Raised 2026-08-17 (Lane A): backlog 6649 -> 6671. Two measured corrections onto Q-534 — its
finding 4 is not a drop-in index drop (the index has two live consumers that would become
sequential scans of the largest table), and the redecode's own re-stamp cost, which that entry
gates but did not quantify. Both are corrections to an existing entry, which is cheaper to carry
here than to have an implementer discover by dropping the index in production.

Raised 2026-08-17 (Review, Q-456…Q-459): projectOverview 6655 -> 6679. One Known-Issues row
indexing the repo-migration architecture sweep. Entries and open-issue content, not narrative —
the sweep's prose is in docs/reviews/2026-08-17-repo-migration-architecture.md, which this
ratchet does not govern.

Raised 2026-08-17 (BugFix intake, Q-389): backlog 6682 -> 6700. One owner-requested feature entry
(printable saved-meal labels). Only +18 because a sweep had left the file 47 under its ceiling —
which is the intended cycle working: entries land, cleared ones leave, the number does not ratchet
on every single filing.

Raised 2026-08-17 (BugFix intake, Q-389 amendment): backlog 6700 -> 6721. The owner settled the
two questions the entry was waiting on (50x50mm label; name + calories + code, macros optional;
handwritten date line), so the "open questions" block became a spec. +16 net for replacing four
lines of questions with the answers plus the QR quiet-zone/payload constraint the mockups
surfaced. Amended in place rather than filed as a second entry, per this role's dedup rule.

Raised 2026-08-17 (Lane A, Q-541 tasks 0-2): backlog 6721 -> 6731. A status block on the Q-541
entry saying which tasks shipped and which remain, and that nothing reads the new table yet. The
item stays in the queue, so this is queue state rather than narrative — and the distinction it
carries is the one an implementer most needs: the destructive step has not been written.
Raised 2026-08-17 (BugFix intake, Q-389 round-label revision): backlog 6721 -> 6735. The owner
added that labels rotate between square and CIRCULAR dies, which changes the binding constraint
from the square to the inscribed circle, and removed the per-serving line. Both are spec changes
an implementer would otherwise build against wrongly, plus the measured consequence: circle-safe
composition shrinks the code to 12.2-15.9mm and print ink-spread is the failure mode to expect.
Raised 2026-08-17 (Q-530 secret settled): backlog 6770 -> 6781. Q-530's step-3 gate flipped from
"blocked on the owner" to the settled decision, plus the two operational notes that stop the next
session misreading it — a stale container reading the variable as absent, and the fact that
nothing can verify either copy until the route exists.

Raised 2026-08-18 (BugFix intake, Q-389 multi-style + 25x25 redraw): all four label styles ship
with the user cycling between them, black band as the owner's default, the write-on line loses its
MADE word, and the mockups are redrawn with the 25x25 code a meal id actually needs. The build
consequence is the part worth carrying: the renderer becomes template-lookup rather than one
baked-in layout. Also records the measured pitch at 25x25 (band, the default, is tightest at
0.487mm) and that it cannot be recovered without dropping content — with the drawn variant that
shows the cheapest way to. Merged with a concurrent session's work on the same entry rather than
over it, and rebuilt from origin/main's numbers: this file conflicted four times in one evening,
and splicing is how one side gets silently dropped.
Raised 2026-08-18 (Review, Q-460…Q-462): projectOverview 6689 -> 6735, backlog 6781 -> 6927 (recomputed on the third same-day merge of this file).
Three queue entries from the workout write-path sweep plus the Known-Issues row indexing them.
Entries and open-issue content, which is what these files are for; the sweep's prose lives in
docs/reviews/2026-08-18-workout-write-path.md, outside this ratchet.

Raised 2026-08-18 (BugFix intake, Q-390): one owner-reported queue entry. The owner asked for a
cosmetic change — render the deload flag as "Mon (D)" rather than on its own line — and the trace
found the flag is an extra flex row inside an items-end container, so a flagged day's bar sits
~12px higher than an unflagged one on a chart whose purpose is comparing days. The entry carries
the geometry, because that is the part an implementer would otherwise fix cosmetically and leave
broken. Rebuilt from origin/main's numbers rather than spliced.

Raised 2026-08-18 (BugFix intake, Q-391): one owner-reported queue entry. The owner asked for a
calories-burnt stat on the day screen's Training card. The trace found the feature had already
been considered and deliberately deferred, with both the blocker (estWorkoutKcal from a client
component) and the intended shape (server-side in /api/day-log) already on record — so the entry
cites that rather than re-deriving it, and carries the two things that would otherwise be got
wrong: the existing workoutKcal is a DAY total already rendering in the same screen's Energy
section, and the estimate is duration-only, so sitting it beside measured volume implies a
derivation that does not exist.

Raised 2026-08-18 (BugFix intake, Q-392): +64 for one owner-reported queue entry — preferences are
localStorage-only, so a reinstall or a second browser starts from defaults. Most of the length is
the inventory table of which preference lives in which key and file, which is the work an
implementer would otherwise repeat. Also records that the pattern already exists (Q-241 made goals
server-authoritative and left hydrateGoalSeeds behind), and that users.food_region is a dead
column whose setting is device-only — the cheapest possible proof of the approach.

Raised 2026-08-18 (BugFix intake, Q-393 + Q-394): the label ingredient-breakdown entry, plus the
broken-main entry marked resolved rather than deleted — Q-356's fixture fix cleared it, and the
sweep that entry called for is still open, which is the part worth keeping. Q-393 gained the two
answers checked against shipped code: the QR encoder is real (qrcode@1.5.4 at EC M) and save/share
already exists, so the only open question there is the physical print.

Raised 2026-08-18 (BugFix intake, Q-393 prioritised): +7. The owner moved the label-breakdown entry
to the top of the queue and approved every drawn variant as a shippable style, so the entry gains
the priority marker and the note that this is no longer a pick-one decision — only the default is
still open, and that is a stored preference belonging to Q-392.

Raised 2026-08-18 (session wrap-up, Q-548..Q-551): four entries the session measured but had not
filed — the bare catch that made a DB outage read as 403, Postgres holding 0.79 GB for 171 MB, the
oura_heartrate index ratio, and the owner decision on leaving Railway (deliberately deferred behind
Q-545 so it is not decided on a pre-fix, deploy-inflated baseline).

Raised again the same day for Q-310's Known-Issues row: a shipped fix that still owes a device
check, so it belongs here rather than in the resolved archive, which only takes an entry when
nothing is still owed. The evidence lives in the journal entry; only what is owed is here.

Raised 2026-08-17 (Q-532, Lane B): 6547 -> 6562. Same shape as the line above and the same
justification — a shipped fix owing a device check cannot go to the resolved archive. Fifteen
lines for three facts a session must not have to dig for: the sandbox cannot reproduce this at
all, so the owner's drain run is the only verification; and no regression guard exists, because
neither vitest (node-only, no @testing-library/react) nor the E2E harness (needs admin + a live
radio) can reach the code. The mechanism, the five-site sibling sweep and the CI-rule option
that was considered and declined all stayed in the journal entry.
Raised 2026-08-17 (Q-451, Lane B): 6653 -> 6655. Recomputed from the merged file, not spliced
from the conflict hunk — this raise and the Lane A one above it landed the same day, which is
the exact case this file's earlier note says silently drops one side.
Striking a fixed item usually shrinks this and this one nearly did (the replacement bullet was
cut from 12 lines to 7). The two it is over are the two the original entry had no reason to
carry: that the fix is **observed but not guarded**, and the Q-352 pointer to why. A struck item
that can silently regress is exactly what a session must not have to discover for itself.

Raised 2026-08-17 (Q-281, Lane B): projectOverview 6679 -> 6689, backlog 6735 -> 6770. Same
shape as the two raises above and the same reason: a shipped fix owing a device check cannot go
to the resolved archive. The ratchet was right to catch the first draft at 20 over — the audit's
findings, the FactorBar judgement call and the Q-278 corrections all moved to
docs/reviews/2026-08-17-score-presentation-audit.md, which this file does not govern. What is
left is the owed check (a 7.5px band word, verified only in a browser harness, on a style the
owner selects) and the one pointer that stops Q-278 being planned on premises this audit
refuted. Two stale lines were corrected in the same pass: the version, four minors out of date,
and an open-PR snapshot naming three PRs of which two had long since closed. The backlog half is
Q-281's audit result folded into its entry plus the two refuted premises annotated onto Q-278 —
a correction to an existing entry, which is cheaper here than an implementer discovering it.

Both numbers are RECOMPUTED FROM THE MERGED FILES, not spliced: this raise collided with the
Q-389 backlog raise directly above, which is the same-day collision this file keeps warning
about. Splicing would have kept 6682 and silently un-done Q-389's raise.
Raised 2026-08-17 (Q-389 planning, Lane B): backlog 6781 -> 6791. Recomputed from the merged
file — this collided with a concurrent raise to 6781, exactly the same-day collision this file
keeps warning about, and splicing would have silently un-done that side. Three corrections folded into
the existing Q-389 entry rather than filed separately, per the "a wrong correction is more
expensive than a long one" precedent above: its QR module maths was ~16% optimistic (a 21x21
code cannot hold a UUID at all — v1 holds 17 bytes, so the floor is v2 25x25 and the pitch is
0.49-0.64mm, on a margin the entry already calls thin); its per-serving worry is already
satisfied by oneServingItems; and that in turn exposes the real bug, that SavedMeal.totals is
the whole recipe, so a naive renderer prints double what scanning the label logs. Each is
corrected where the wrong claim lives, so an implementer cannot read the stale number and build
to it. The plan itself is in docs/superpowers/plans/, which this ratchet does not govern.

Raised 2026-08-18 (Q-541 task 3, Lane A): 6735 -> 6744. Nine lines onto the disk-full item, and
eight of them exist to stop a reader drawing the wrong conclusion from the other eight raises:
Tasks 0-3 have shipped and the database has NOT shrunk by a byte, because nothing writes a blob
yet. Without that the section reads as progress against the 500 MB deadline when there is none.
Carries the re-measured 819 MB (up from 786) and the Q-315 pointer. Recomputed from the merged
file.
Raised 2026-08-18 (Tuning, Q-503 Sleep Score recalibration): 6735 -> 6751. One Known-Issues row
for the shipped recalibration, marked ⚠️ not ✅ because two things are still owed — an unmarked
step in the trend chart where the old and new model scores meet, and no device verification.
Recomputed from the MERGED file rather than spliced: this collided with same-day raises from
other lanes twice, which is the case the note below warns silently drops one side.

Raised 2026-08-18 (Q-534 finding 4 / Q-541 task 7, Lane A): 6843 -> 6853. Ten lines on the
disk-full item, and they carry the one distinction that item most needs: the outage's MECHANISM
is gone, not merely mitigated — with every reader deriving the timestamp, the re-stamp that
rewrote 681,005 rows is a no-op. Plus the caveat that keeps the number honest: 136 MB is the
measured index size, not a reclaim that has happened, since the drop runs on the next deploy and
the space only returns to the file after a VACUUM FULL.

Raised 2026-08-17 (Q-541 tasks 0-2, Lane A): 6791 -> 6801. RECOMPUTED FROM THE MERGED FILE on
each of the two merges this branch took, not spliced — the Q-530, Q-389 and Lane A raises all
landed the same day and each pass would have silently un-done the other side.

Raised 2026-08-17 (Q-51 re-verification, Lane B): backlog 6833 -> 6853. A correction to an
existing entry whose Task 3 reads as closing it and does not: Task 3 measured HOME cold start
(FCP 472ms, 439 of it the document fetch), while the entry's own callout is about first mount of
/WORKOUT (1086-1348ms, rscCount 0, entirely client-side). Different screen, different number,
still unmeasured. Also re-measures the two file sizes the premise rests on — both have grown
since the entry was written, and the entry states one of them three different ways. Left in the
entry rather than a review doc because the next session to take this item reads the entry, sees
a green Task 3, and would close it. Recomputed from the merged file, same as the raise above.

Raised 2026-08-18 (Q-541 task 3, Lane A): 6853 -> 6867. The Q-541 entry's status block gains
fourteen lines and none of them are narrative: which read sites moved, and the three findings an
implementer of tasks 4-7 would otherwise re-derive — that an aggregate cannot use the reader's
identity dedupe (it double-counted 80 frames as 120), that event_name had to become derived, and
that a dormant tag needs a cold fallback in three places. The rest of the story is in the plan
and the journal entry, neither of which this ratchet governs. Recomputed from the merged file.

Raised again the same day for the new Q-315 entry: 6867 -> 6894. `error_events` holds 4 live rows
in 49 MB, found while measuring production for Q-541 — 6% of the database, reclaimable by one
statement. Filed rather than taken, per "no orphaned findings", and it earns its 27 lines by
carrying the measurement, the reason nothing re-grows (Q-539 already fixed the write path), and
the free-disk caveat that decides whether it can run after the volume is cut back.

Recomputed 2026-08-18 from the MERGED file after Lane A's Q-541/Q-315 raises met a concurrent
one: 6894 + the other side's delta = 6988. Both prose blocks above are kept and only the number
was rebuilt — splicing either conflict hunk would have silently un-done the other lane's raise,
which is what every note in this file keeps warning about.
Raised 2026-08-18 (Tuning, Q-504): 6947 -> 6979. One queue entry for the Readiness range
recalibration, carrying the measured before/after table for the five action thresholds that ride
on the readiness scale — the reason the item is held rather than shipped.

Recomputed 2026-08-18 (Q-541 task 3, Lane A) from the MERGED files, both numbers rebuilt rather
than spliced: this branch's raises met concurrent ones on both files in the same day, which is
the collision every note above warns about. Lane A's own deltas were +9 on projectOverview (the
disk-full item now states that Tasks 0-3 shipped and the database has NOT shrunk by a byte,
without which the section reads as progress against the 500 MB deadline where there is none)
and +41 on the backlog (the Q-541 status block, and the new Q-315 entry for error_events
holding 4 live rows in 49 MB).

Raised 2026-08-18 (Q-541 task 4, Lane A): 7020 -> 7055. Two things: the Q-541 status block gains
the packer's settled decisions, and Q-316 is a NEW entry — the packer has no button because
components/** is Lane B's, so the affordance is filed rather than written. Its 23 lines are what
stop the next lane building the wrong thing: the route contract it should call, and the warning
that its confirm copy must not read like the lossless VACUUM beside it, because this is the one
control in the app that deletes archival frames.
Raised 2026-08-18 (Q-389 shipped, Lane B): projectOverview -> 6862, backlog -> 7109, BOTH
recomputed from the merged files after a fourth same-day ratchet collision on this branch.
The backlog number is DOWN on the incoming 7276 because Q-389's 145-line entry was removed on
completion, which is what finishing an item is supposed to do to this file. A shipped feature whose
two remaining checks are both PHYSICAL and cannot be automated at all: a test print (the QR is
0.49-0.66mm per module, so ink spread is the expected failure and it presents as "the scanner is
broken"), and the camera scan path, which the Capacitor plugin makes unreachable from the
sandbox. Neither can go to the resolved archive while it is still owed, and neither is
discoverable from the diff. The backlog SHRANK by 145 lines in the same PR - Q-389's entry was
removed on completion - so the net across both index files is well down.
Raised 2026-08-18 (Tuning, Q-505): 7020 -> 7056. One queue entry for the Activity Score decision,
carrying the measured cause and the two coherent answers inline — the item is blocked on the
owner choosing between them, and an implementer must not have to open the review to learn that.
Recomputed from the MERGED file; this is the third same-day ratchet collision on this branch.

Recomputed 2026-08-18 (Q-541 task 4, Lane A) from the MERGED files — all three numbers rebuilt,
no hunk spliced, because both files moved on both sides of this merge. Lane A's own delta was the
Q-541 status block for the packer plus the new Q-316 entry (the packer has no button, because
components/** belongs to the other lane, and the entry carries the warning that its confirm copy
must not read like the lossless VACUUM beside it).

Raised 2026-08-18 (Q-315 route, Lane A): 7144 -> 7156. Twelve lines splitting Q-315 into the half
that shipped and the half that has not: the route exists and is verified, and nobody has pressed
it against production. Without that split the entry reads as done and the 49 MB never gets
reclaimed. Carries the one thing an implementer must not get wrong — the allowlist is the safety
boundary because the table name is interpolated, and `in` accepts `toString` where
`hasOwnProperty` does not.

Recomputed 2026-08-18 (Q-534 finding 4 / Q-541 task 7, Lane A) from the MERGED files, on each of the
two merges this branch took. Lane A's own delta: +10 on projectOverview, carrying the distinction
that item most needs — the outage's MECHANISM is gone, not merely mitigated, because with every
reader deriving the timestamp the re-stamp that rewrote 681,005 rows is a no-op — plus the caveat
that keeps the 136 MB honest (it is the measured index size, not a reclaim that has happened). On
the backlog, finding 4 is struck in place with the three consequences the entry did not anticipate,
so the next session does not re-derive them or assume findings 1-3 went with it.

Raised 2026-08-18: 1010 -> 1044. The "Decisions That Come Back To Me" section, which sets the
default shape for anything gated on an owner decision — recommendation first, alternatives with what
each is better at, reversal cost, plain English — and pushes cheap reversible choices back down to
the session rather than surfacing them. It belongs in the index: it governs every session's
behaviour rather than recording one session's work. Drafted at 49 lines and cut to 34 before
raising, since a rule about brevity that arrives verbose argues against itself. Recomputed from the
MERGED file after three same-day collisions with concurrent raises.

Recomputed 2026-08-18 (Q-315 route, Lane A) from the MERGED file, on each merge this branch took.
Lane A's delta was +12, splitting Q-315 into the half that shipped and the half that has not: the
route exists and is verified, and nobody has pressed it against production. Without that split the
entry reads as done and the 49 MB never gets reclaimed.

Raised 2026-08-18 (owner-directed session, Q-543): -> 7257. One entry for the doc-index BASELINE
object being the repo's most reliable merge conflict — three of the four CI rounds on #69 were
base collisions on THIS object, none on the content being changed, and filing the entry hit it a
fourth time. Recomputed from the MERGED file.
Raised 2026-08-18 (Tuning): -> 7366, recomputed from the MERGED file. Q-506 — the illness radar
has never produced an action-bearing flag in 46 days because one of its four biomarkers is scored
against a baseline whose deviation is 18.7x too large. The measured biomarker table and the
cold-start numbers are the entry: without them the next reader lowers the threshold instead of
fixing the baseline, which is the mistake Q-504 already made and reverted.
Raised 2026-08-18 (Tuning): 7366 -> 7454. Q-507/Q-508, the last two un-calibrated scores. Both
entries carry measured tables rather than conclusions on purpose: Q-507's whole point is that a
16% firing rate looks healthy until you see WHICH days fire (mean readiness 79 against 65), and
Q-508's is that the golden vector cannot catch the defect, which only lands with the arithmetic
shown. Strip either table and the next reader tunes the constant. Recomputed from the MERGED file.

Raised 2026-08-18 (Q-535 Lane A half, Lane A): 7462 -> 7491. Two things the queue cannot afford
to lose: Q-535 now says the 502 is NOT gone yet and why the default was left alone (both
consoles report completion from the synchronous shape, so flipping it blind would have them
state that started work had finished), and half its own premise expired the same day — the
row-walking phase became a no-op, so the `scanned=1098158` figures it quotes are historical.
Plus the new Q-318 entry carrying the exact response contract, so the other lane does not have
to read the route to build against it.
Raised 2026-08-18 (Tuning): 7514 -> 7596, recomputed from the MERGED file. Q-509/Q-510 (BLE-era
input drift) plus Q-501's "did it land" half marked resolved. Q-509's entry carries the
anchor-vs-input ratio table because that ratio IS the finding — strip it and the entry reads as
"refit says 3.31, ship 3.31", which is the exact conclusion readiness-composite.ts pre-registered
against.

Raised 2026-08-18 (Q-356, Lane A): 1044 -> 1056, recomputed from the merged file on each merge this
branch took. The date-arithmetic section already said "never hardcode one side of a rolling window";
it did not cover the shape that broke every branch for two hours a day — both sides derived from the
clock, but from DIFFERENT timezones. Twelve lines for the mechanism, the two correct fixture shapes,
and the one thing a regression test for this class must do (construct the failure band rather than
wait for it, because faketime cannot move Postgres's clock). This is the file every session reads
before it can start, and the rule it sits beside is the reason this bug was filed rather than
repeated.

Recomputed 2026-08-18 (Q-535 Lane A half, Lane A) from the MERGED file, on each merge this branch
took. Lane A's delta was +29:
Q-535 now states the 502 is NOT gone yet and why the default was left alone, that half its own
premise expired the same day (the row-walking phase became a no-op, so its scanned figures are
historical), and a new Q-318 carrying the exact response contract so the other lane need not
read the route to build against it.
Raised 2026-08-18 (Tuning): 7596 -> 7636. Q-511 — the audit of "did the sleep recalibration miss
a consumer of the sleep scale?" (it did not) turned up that the Body Battery anchor flip was worth
17.7 points and the recalibration removed 82% of it. The entry is long because most of it is a
PROTECT-THIS warning: the obvious future "fix" of lifting sleep scores back re-opens an
owner-reported bug in another pillar, and that only lands with the numbers attached.

Raised 2026-08-18 (Q-395, BugFix intake) from the merged file. Net +18 after Q-390's entry
left with #81. Q-395 is an owner-requested visual uplift of the nutrition surface, and a
bare "make it nicer" is not implementable — the length is the three findings that carry a
CI check (hex literals vs the runtime-themeable --brand, the shrink-only ratchet already
aimed at them, and both landing files sitting ON the 800-line limit so line one fails),
kept separate from the two that need mockups first.
Raised 2026-08-18 (Q-393, Lane B): backlog 7800 -> 7828. Note `main` was ALREADY over this
baseline by 28 when measured here, so this raise unblocks every branch, not just this one — a
baseline that main itself exceeds fails the Custom Rules job on unrelated PRs. The lines are
Q-393's shipped/not-shipped annotation, which carries the measured module-pitch table: every
earlier figure in Q-389/Q-393 divided by the module count and not by the module count plus the
quiet zone the renderer draws inside the code box, so all of them read ~24% large. That table is
what stops the next session sizing a label against a number the printer will not honour.
Raised 2026-08-18 (Q-395 round 2, BugFix intake). The owner asked for mockups and a UI
review of the nutrition screens before any code. Four findings came back that the entry
did not have: every control is 44 px against this repo's own 48 dp rule, the srv/g toggle
rebuilds a primitive that already exists, the toggle chooses an INPUT mode for a value the
row prints both ways (with three drawn ways out and a recommendation), and #22c55e is also
MACRO_COLORS.protein, so the obvious sweep would repaint the protein macro.
Raised 2026-08-18 (Q-395 round 3 + Q-396, BugFix intake). The owner sent MyFitnessPal
screenshots and asked for a rework rather than a repaint, so Q-395 now carries the settled
direction: the root cause is a list row carrying an editor, which supersedes the three
srv/g options as a fork, plus the one-row-component decision and the sequencing warning
that the two landing files are already on the 800-line limit. Q-396 is the new entry for
meal thumbnails — it exists mostly to write down why the users.avatar precedent (a 5 MB
data URI) must not be copied onto a row that syncs, and what the cap has to be instead.

Raised 2026-08-18 (Q-464 ratchet, Lane A): 8257 -> 8310, recomputed from the MERGED file — Lane
A's delta was +53. Two blocks, both carrying measurements a successor would otherwise have to
re-derive. Q-464 gains the two corrections found while
implementing it — that it IS a live bug after all, and that its `sync/push` caveat applies to
every schema pushMutations parses rather than one route — plus what the 89 remaining schemas
still need. And a new Q-472 for the live one: the Water widget's web fallback posts a key no
schema names, so the value was discarded behind a 200, and since Q-464 shipped it now fails
loudly instead — which is the intended improvement but makes it user-visible.

Raised 2026-08-18 (Q-397, Lane B): backlog 8257 -> 8573. `main` was **376 lines over this
baseline on its own**, so the Custom Rules job was failing on every branch, not just this one —
several entries landed without the raise that should have ridden with them. Recomputed from the
merged file: main's content, minus Q-397 (shipped by this PR), plus its closing annotation on
Q-393. Recorded rather than nudged, because the second time a shared ratchet is quietly
exceeded is the point at which people start assuming it is broken instead of binding.
Raised 2026-08-18 (Q-397 + the Q-395 review fold-in, BugFix intake). Recomputed from the
MERGED file after taking main's side of this baseline, rather than splicing the conflict
hunks — two same-day raises spliced together silently drop one side. Q-397 records that the
shipped ingredient label is the analysis Q-393 was corrected away from, with the measured
mm-per-module table and the owner's choice of B2 as the default; Q-395 gains the six review
notes and the 11-section prod checklist an implementation PR ticks off.
Raised 2026-08-18 (Tuning): -> 8540, recomputed from the MERGED file. Q-512/513/514 — the first
calibration sweep of the workouts pillar. The entries carry their measured tables because every
conclusion is counterintuitive: the ACWR thresholds and RPE_DEAD_BAND are RIGHT and must not move,
while the call sites and the clamped input feeding them are wrong. Strip the tables and the next
reader tunes a constant instead of fixing the input — three times over.
Raised 2026-08-18 (Tuning): -> 8592. Q-515 — first calibration of the heart-rate pillar. The tables
are the entry: the July/August collapse and the fraction sweep together show that tuning the
constant cannot fix it, which is the opposite of what the entry title suggests on its own.
Raised 2026-08-18 (Tuning): -> 8775, recomputed from the MERGED file. Q-517 — adaptive-TDEE can hand
the user a maintenance below their own BMR. The replay table is the entry: 75% of windows are
correctly refused, which is why the obvious response (tighten the coverage gates) is wrong, and
the 1,052-vs-1,000 near-miss is only legible with the numbers beside it.
Raised 2026-08-18 (Q-387 decision, Q-398, Q-395 round 5 — BugFix intake). Recomputed from
the MERGED file after taking main's side; this branch took three same-day raises from other
lanes, and splicing conflict hunks is how one side's raise silently disappears. Four blocking
design questions were answered: the completeness control is an explicit button at the foot of
the log (Q-387 options 2 and 3 closed with reasons), the meal plan becomes a generator of
saved meals (Q-398), targets stay in Profile with a shortcut, and the pass covers the full journey.

Raised 2026-08-18 (Lane B, Q-478 shipped). Five lines on an existing row rather
than a new one. Two of them are corrections to the original finding that a striking-through
would have destroyed: the "loading state never clears" consequence was overstated (a second
unconditional clear runs after the await, so it is a round-trip-long skeleton, not a hang) and
the today-envelope helpers were deliberately left alone. The row stays open because Q-477 — the
larger half, including the ratchet on bare todayInTz() — is untouched, and a reader needs to
know which half of a two-Q row shipped.
Raised 2026-08-18 (Lane B, Q-399): 7893 -> 7901. Eight lines on the label row, and six of them
are the failure mode rather than the fix: the default drew ZERO ingredient lines for a full
release and every gate stayed quiet, because the sheet's report was gated on `> 0` and the only
test on that style asserted the code's SIZE. A row that just said "fixed the label" would leave
the next reader believing the tests covered it. The other two update the print-test gate, which
now names a second pitch to scan.
Raised 2026-08-18 (Lane A, Q-479 owner-deferred): projectOverview 7893 -> 7920. An accepted-risk
row for a finding the owner chose not to fix — a revoked admin keeping catalogue write access for
up to 24h, which needs a revocation to open and there is only one permanent admin. It is longer
than a typical row on purpose: it has to stop the next session re-implementing a fix that already
exists and is green on an unmerged PR, and it has to record what would make the risk live again.
Raised 2026-08-19 (Lane A, session-start error_events ritual): 7928 -> 7930. The voice-logging
Known Issue said 4 occurrences, last seen 2026-08-08; production says 12, last seen 2026-08-18,
and the message changed spelling on 08-17 — the JS half shipped again into a device that still
cannot run it. A stale count on a live issue reads as "contained" and it is not. Paid for in
part by moving the `claude_ro` row-scoping lesson out of this entry: it is a standing rule in
CLAUDE.md's ritual, not a paragraph inside one device issue.
Raised 2026-08-19 (Tuning, Activity contributor audit): 7930 -> 7933. The comprehensive
review's "the rest, in brief" line said Q-137 should be closed in Q-277's favour; Q-277 is
now itself answered and removed, so the line had to say what the answer WAS (49% of effective
weight cannot vary) rather than point at a queue entry that no longer exists.
Raised 2026-08-19 (Lane A, Q-400 save-to-gallery): 7933 -> 7951. A device-verification row, which
is what this section is for — the change needs a new APK and neither of its two fixes is
observable from the sandbox. It carries the measured figures (600.0 dpi, 49.9 mm vs 311.9 mm)
because "the PNG now declares its size" is a claim and those are the evidence, and it names the
one physical print that also settles Q-411, so the owner does not do two.
Raised 2026-08-19 (Lane A, the food_logs device checks): 7951 -> 7982. Three changes landed on
one offline-first domain in a day (Q-413, Q-325, Q-412) and none is device-verified; the
standing rule says that is a row here, not a line in a lane's private baton, because this file
is what every session reads before it can start. One row rather than three, because the same
offline path carries all of them and one session on the device settles them together. It also
records the migration's deliberately-narrow scope, which leaves a few historical rows outside
their meal's window — a stated cost is not a bug report, and it is the kind that gets rediscovered.
2026-08-20 (Tuning): Known-Issues row for the sleep row's time-in-bed range reading as
time-asleep. A Known Issue rather than a queue entry because the Tuning Q band is exhausted.
2026-08-20 (Tuning): Q-529 scope correction -- the score DOES recompute; what survives is a
~9-minute provisional-renders-as-final window. The refutation stays inline because the
original claim shipped and an implementer must not act on it.
Raised 2026-08-18 (Tuning): Q-518 — the readiness model stamp is erased by a sibling
writer within hours. The two timestamped readings are the entry: without them this reads as a
design opinion about COALESCE rather than an observed clobber, and it is the evidence that
invalidates PR #85's claim.
Raised 2026-08-18 (Q-399, Q-400 — BugFix intake). Two owner reports against v1.324.6, both
on the label that shipped hours earlier. Q-399 carries the worked arithmetic proving the new
default can never draw an ingredient line at any name size, and the harder finding behind it:
the centred stack cannot carry the full list AND a better code than the old default, so the
promise has to give somewhere. Q-400 is the share button being a silent no-op on the APK —
both its paths only work on web, which is the green-on-web dead-on-device class.
Raised 2026-08-18 (Lane B, Q-488 re-tag): 9905 -> 9924. The entry said the fix was one call in
one Lane B handler. It is not: the local store has no deleteActivityLog, and upsertActivityLog
omits deleted_at from both its INSERT list and its DO UPDATE SET — so the obvious fix compiles,
type-checks, lints clean and does nothing. Those nineteen lines are the column-list evidence and
the re-tag to Lane A. A one-line "re-tagged to Lane A" would send the next session down the
same dead end, because the dead end reads as correct in every check the sandbox can run.
Ratchets DOWN 2026-08-18 (Lane B, Q-478 shipped). The entry was removed and
Q-477's pointer to it rewritten. Shrink-only means locking the lower number in, so the space
an implemented item vacates cannot quietly refill.
Raised 2026-08-18 (Q-401 — BugFix intake). Recomputed from the MERGED file after taking
main's side; this branch absorbed several same-day raises from other lanes and splicing the
hunks is how one side's raise silently disappears. The Nutrition tab shows two calorie
budgets 274 apart, and the entry proves they are two TDEE models rather than staleness:
BMR x (1.375 - 1.2) = 266 kcal. It also records the owner's decision to adopt one number
that rises with measured activity, and why the wizard's multiplier is the real change.

Then ratchets DOWN 2026-08-18 (Lane B, Q-490 shipped): Q-490's entry out, Q-357's in, net
seven fewer, recomputed from the merged file on top of the raise above. Q-357 is the four
defeated memo call sites Q-490's review said did not exist ("no inline arrows exist
anywhere"); the new check freezes them rather than leaving them to be rediscovered.
Raised 2026-08-19 (Lane B, Q-399 shipped): Q-399's entry removed, Q-358 filed in its place, net
larger. Q-358 is the finding Q-399 surfaced rather than the one it set out to fix: every meal
label's QR is drawn on a fractional device-pixel grid, so every module edge antialiases to grey.
Its lines are the two pixel-per-module tables — the defect is invisible from the source (the
arithmetic reads correct) and only the numbers show why a smaller code stopped decoding.
Ratchets DOWN 2026-08-19 (Lane B, Q-402 shipped): Q-402's entry out, Q-359 in, net fourteen
fewer. Q-359 is the 36 sibling fetch-once effects Q-402's mechanism now covers — filed rather
than swept, and its lines are the reason NOT to sweep: most are latent, some are deliberately
fetch-once, and a shrink-only ratchet may beat the sweep outright.
Ratchets DOWN 2026-08-19 (Lane B, Q-411 shipped): Q-358's entry out, nothing filed in its
place, 43 fewer. Q-358 was built rather than deferred because Q-411 resized every code and the
fractional-grid flake it describes came straight back — a decode E2E that passes on a coin flip
cannot gate the change that caused it, so the two had to land together.
Raised again the same day (Q-402's fixture gap): the seven lines record WHY the fix could not
be driven end to end — the seeded user has no body and Home renders no card widgets by default,
so three probes measured zero requests. That is a reusable finding: every future Home-card guard
needs the same fixture, and its absence is part of why a shell-only staleness bug reached a user
report rather than a test.
Raised 2026-08-18 (Lane A, Q-479 owner-deferred): the ⛔ annotation on the Q-479 entry — the
owner accepted the risk, so the entry stays in the queue rather than being removed, and has to
carry "do NOT implement, the fix is green on PR #124" plus what would make it live again. An
accepted risk that reads like an open item is how the decision gets re-litigated.

Then raised 2026-08-19 (Lane B, Q-401's Lane B half shipped), recomputed from the merged file
on top of that: the Q-401 entry STAYS — its load-bearing half (retiring ACTIVITY_MULTIPLIERS as
a second TDEE model) is Lane A's and untouched. The new lines say which half landed and, more
importantly, that the two numbers still disagree: this PR makes the disagreement legible, it
does not remove it. An entry struck here would read as "the calorie budgets were unified",
which is the claim nobody has earned yet.
Raised 2026-08-19 (Lane B, Q-406 headroom half): the entry STAYS and grows, because its
mechanism was wrong in two measurable ways and a struck entry would leave the next session to
rediscover both. (a) Extracting a food row frees ZERO lines from either landing file — neither
contains row markup, which is the whole premise. (b) The four call sites are four different
shapes, so a faithful extraction needs a variant-heavy wrapper, and unifying them properly is a
visual change the entry itself forbids. The lines are the per-site evidence; without it the
correction is an opinion and the entry gets attempted as written a second time.
Raised 2026-08-19 (Lane B, Q-359 ratchet), recomputed from the merged file: the entry stays —
the ratchet ships, the sweep does not. The added lines are two corrections a struck entry would
have destroyed: the count was one low (a scan that missed single-line effects), and the
can-bite grouping was 14 when it is 19, because the tab screens mount their sheets
unconditionally with a null prop. "Judge by mount site, not filename" is the reusable half, and
the error ran in the reassuring direction.
Raised 2026-08-19 (Lane A, Q-387): backlog 10436 -> 10454. The Lane A half shipped, so its entry
gains the handover block Lane B needs to build against — the endpoint's contract, the Undo, and
the warning that the feature is INERT until the button exists. A half-shipped item that does not
say which half is how the other lane rebuilds the wrong one.
Raised 2026-08-19 (Lane A, Q-409): 10618 -> 10635. Same shape, same reason: the route half
shipped and the entry has to say what the payload now hands Lane B. The 17 lines are almost
all one warning — `recipeYield: null` means the numbers are for the WHOLE recipe, so the
picker must ask for serves. The narrative went to the journal entry instead, which is why
this is 17 lines and not the 31 it started at.
Ratchets DOWN 2026-08-19 (Lane B, Q-411 shipped), recomputed from the merged file: two entries
are removed and the cluster's pointers rewritten. The caveat Q-411 leaves behind is the
load-bearing part and is kept in full — the square canvas only helps if the owner's circle
template CROPS; if it SCALES, the default module goes to 0.397, fractionally WORSE than the
0.401 it replaced. A struck entry with no caveat would leave "the codes got bigger" as the
record, which one print could falsify. Q-358's entry goes with it: it was built rather than
deferred because Q-411 resized every code and the fractional-grid flake it describes came
straight back, and a decode E2E that passes on a coin flip cannot gate the change that caused it.
Raised 2026-08-19 (Tuning, Q-522 + Q-523): 10670 -> 10759. Two queue entries for the coverage
check Q-521 had deferred, plus Q-521's own caveat replaced by the measured result. Both
entries carry their measured tables inline on purpose: the finding is that two inputs are
constants dressed as measurements, and "48 of 59 days score exactly 100" is the part an
implementer must not have to re-derive before deciding whether to use them.
Rebuilt from origin/main after a parallel PR raised the same baseline -- splicing the
conflict hunks would have produced two baselines for one number.
Raised 2026-08-19 (Tuning, Q-524 + the Activity contributor audit): 10832 -> 10878. Q-524 is
added and Q-277 is REMOVED -- its "first action" was to dump the per-component parts and count
each lane's realised range, which the audit did, and its untested hypothesis is now tested, so
the investigation is finished and the remedy lives in Q-505. Net +46 rather than +70 because of
that removal. Rebuilt from origin/main after a parallel PR raised the same baseline -- splicing
the conflict hunks would have produced two baselines for one number.
Raised 2026-08-19 (Lane B, Q-359 slice 1 shipped), recomputed from the merged file: the entry
stays in the queue — 29 of 36 sites remain — and gains what the slice learned. Those lines are
the reason the next slice does not repeat it: the `today` option and why the sweep needed it,
the three sibling BLE listeners that should go the same way, the grouping error, and the one
test that will red when the next three files convert. An entry that only said "6 of 36 done"
would cost the next session all of that.
Raised 2026-08-19 (Lane A, Q-322 slice 2): 10519 -> 10526. Seven lines recording what the slice
actually did — above all that `sync/push`'s 4 MB cap is MEASURED (a worst-case 100-mutation
batch is 0.57 MB) and must not be lowered without re-measuring, because that route is the
outbox and a rejected batch is the app's worst-case data-loss path. A cap with no stated
derivation is one someone tightens later on a hunch.
Raised 2026-08-19 (Lane B, Q-359 slice 2 shipped): the entry still stays in the queue — 25 of
36 remain — and the added lines are two things the next session needs. One is that the eight
survivors are ALL tab-screen orchestrators and want one file per PR, not another batch. The
other is a correction: slice 1 predicted a named test would red on this slice and it did not,
and a wrong prediction left in the queue costs more than the lines it takes to fix.
Raised 2026-08-19 (Tuning, Q-525/Q-526 + three owner decisions): 10934 -> 11093. Two queue
entries, plus Q-523/Q-524/Q-276 recording owner decisions and Q-72 recording the yardstick
answer. The decisions carry their measured tables inline because each REVERSES what the entry
previously told an implementer to do -- Q-523 no longer needs owner labels, Q-276 is no longer
blocked behind Q-272, and Q-72's "get more spread in the ratings" is now explicitly withdrawn.
A stale instruction is worse than a long one. Rebuilt from origin/main after a parallel PR
raised the same baseline -- splicing the conflict hunks would produce two baselines for one number.
Raised 2026-08-19 (Lane B, Q-359 slice 3): the added lines are a correction, and correcting a
number in place would have been cheaper and wrong. The scanner this Q shipped was over-counting
by ten of twenty-five, so two sessions planned work around sites that did not exist — the entry
has to say WHICH files were phantom and why, or the next session re-derives it from the same
bad numbers.
Raised 2026-08-19 (Tuning, Q-527 + the fitted Body Battery drain model): 11160 -> 11234. Q-521's
sketch is replaced by concrete parameters, and the entry now carries the LINEAR-split failure
inline -- without it an implementer reaches for the obvious allocation first, and every linear
split lands the typical day next to empty. Recording what does NOT work is the expensive half.
Rebuilt from origin/main after a parallel PR raised the same baseline -- splicing the conflict
hunks would have produced two baselines for one number.
Raised 2026-08-19 (Tuning, daily-vs-weekly windows): -> 11273. The owner asked how a daily
heart-minutes goal squares with a weekly target; the answer reshapes Q-505 and had to go
INTO Q-505 rather than sit in a review nobody opens before building. It also retires the
strengthFreq-ceiling framing added earlier the same day, and a superseded framing left
standing beside its replacement is worse than the extra lines.
Raised 2026-08-19 (Lane A, Q-324): 10934 -> 10982. A new entry for the fresh-database test
contention that reds CI intermittently. It is long for an entry because the reproduction is the
valuable part — the failure cannot be reproduced by running `pnpm test` locally, so an entry
that only named the symptom would send the next reader down the same dead end this one took.
Raised 2026-08-19 (Lane B, Q-359 slice 4): the can-bite group reached zero, and the added lines
are what stops the entry reading as finished when it is not — twelve latent sites stay queued,
and the second hook (`useInvalidationRefetch`) needs its existence and its reason recorded
where the next session looks, or the next read that cannot use `useCachedValue` gets a fourth
hand-rolled event listener.
Raised 2026-08-19 (Lane B): Q-360 filed — `goal-invalidation.spec.ts` asserts a goal reaches
Health by reading a line that only renders when today has a step count, and the local seed's
steps stop three days back. Filed rather than fixed in the same PR because the durable fix is
in the seed, which no lane lists.
RATCHETS DOWN 2026-08-19 (Tuning, Q-528): 11374 -> 11236, even though an entry was added — a
parallel compaction landed more than this adds, and shrink-only means the reclaimed space is
locked in rather than left free to refill silently. A destructive-replace finding, plus corrections
to Q-525's diagnosis and Q-522's open question. The corrections had to land IN those entries:
Q-525 previously told an implementer the gate was unsatisfiable, which is a different
instruction from "the evidence is missing, rebuild first", and Q-522 was about to be fitted
against heart rate when the drift-proof anchor exists as an empty table.
Raised 2026-08-19 (Lane B, Q-414 measured): the entry told the implementer to check what the
movement pipeline stores per interval. It stores 1.2% of counted steps, which makes two of the
entry's own rules unsatisfiable together — the numbers are inline because the next session
would otherwise re-measure production to find that out, and because "check the granularity"
reads like a formality until you see 11 rows against 668,749 steps.
Raised 2026-08-19 (Lane A, Q-324 partially done): 11208 -> 11220. A partial-completion
annotation, which is what this file's own protocol asks for when a plan only half lands. It
carries the measured numbers because the point of the note is the DIFFERENCE between what was
fixed (the mechanism, with figures) and what was not (the timeout, which did not reproduce) —
an entry saying only "partially done" is the one a later session re-implements from scratch.
Raised 2026-08-19 (Lane A, Q-323 Lane A half): 11208 -> 11222. The annotation carries the API
contract — `GET /api/nutrition/energy-balance` now returns `macroTargets: { base, scaled,
earnedKcal }` — because without it Lane B's obvious move is to re-derive the split client-side,
which is the second implementation the one-formula rule exists to prevent. It also restates
what the split preserves (the carbs:fat ratio, not each macro's share), since the original
wording reads as the other one.
Raised 2026-08-19 (Lane B, Q-414 corrected): the previous raise recorded a measurement and the
wrong conclusion from it — that no honest burn curve could be drawn. The owner pointed at the
daily HR chart, and HR is timestamped, all-day and dense. The correction stays inline with the
numbers because the wrong conclusion is the more quotable one, and a session reading only the
table would re-derive it.
Raised 2026-08-19 (Lane A, Q-405 premise check): 11197 -> 11223. Three measured facts written
onto the entry BEFORE the recommender was built, because each one changes the design and two of
them contradict the entry as written — the catalogue has no default-role column, and the owner's
own exercise is not in the catalogue at all, so its muscles are model-proposed and cannot be
turned into a prescription. Cheaper here than as a rediscovery.
2026-08-19 (Tuning): +3 on Q-72, marking motivation/resting_soreness/wake_mood RETIRED -- the
entry listed three dead scales beside two live ones as if all five were evidence.
Ratchets DOWN 2026-08-19 (Lane B, Q-414 shipped): its entry out, Q-361 in, net smaller. Q-361 is
what building Q-414 uncovered rather than what it set out to do — two routes 500 in every
sandbox session because their vendor constants file is gitignored, so the Energy card has never
once been renderable locally. Its lines are the evidence that "tested on pnpm dev" was untrue
for a family of screens, which is not a claim to leave to memory.
2026-08-20 (Tuning, Q-529): owner-reported sleep score stamped 23s before its session
finished arriving. The ordering timestamps and the near-twin comparison live in the entry
because they are what distinguish this from Q-520 rather than a duplicate of it.
2026-08-20 (Tuning): Q-529 scope correction -- the score DOES recompute; what survives is a
~9-minute provisional-renders-as-final window. The refutation stays inline because the
original claim shipped and an implementer must not act on it.
Ratchets DOWN 2026-08-19 (Lane B, Q-416 shipped): its entry out, nothing filed in its place.
The pointer above it keeps four lines rather than being struck, because the print of the FIXED
artwork is still owed — the complaint came from paper and only paper closes it.
2026-08-20 (Tuning): owner acceptance criterion on Q-529 -- accurate on first open. The
62-minute ring upload cadence and the three-link ordering live in the entry because an
implementer who shortens the rollup alone fixes the 4-minute term and none of the 62.
Raised 2026-08-18 (Lane B, Q-488): 1075 -> 1077. Two lines for the inverse of the
offline-first rule directly above it — a domain read local-first needs EVERY write to update
the local store, deletes included, and including a write made from a screen that itself reads
server-side. Only the written half was here, and the missing half is what shipped the bug:
the delete looked correct from the screen that made it because that screen reads the server
aggregate, while three local-first surfaces kept the row. It belongs beside the rule it
inverts, not in a journal entry, because the next person to write a delete handler reads this
section and not that entry.
Raised 2026-08-19 (Lane B, Q-402): 1077 -> 1078. One line, and it is the half of the cache rule
that was missing rather than a restatement: every group evicted `energy-balance:` correctly and
the owner still had to restart the app, because nothing told the component to look again. The
rule sits in the cache-invalidation list because that is where someone writing a write path
reads, and it names the wrong fix (a shorter TTL) because that is the one they would try.
Raised 2026-08-19 (Lane A, Q-360 retired): 1078 -> 1085. The idempotent-seed note said the
seed will not re-run and stopped there; the consequence — a database left alone for days holds
history that ends days ago, so a "today" assertion fails locally and passes in CI — was the
part that cost a backlog entry. It names the check to run first, because the reflex it trains
otherwise is "CI is flaky", and it belongs beside the behaviour it follows from rather than in
a journal entry nobody reads before debugging.
docs/overview/entries/ is a holding area. Its README sets the compaction chore at ~20 files;
that is a chore trigger, not an error, so CI does not fail there — failing at 20 would block
unrelated PRs for a tidiness task. This is the runaway guard instead: the directory reached 509
before anyone swept it, and at that size it stops being a readable recent-window.

**Counted against the limit: entries a sweep can actually remove.** An entry that a durable doc
links to (projectOverview.md Known-Issues rows, docs/domains/*/README.md, the agent batons) must
NOT be folded — doing so broke 48 links on the first sweep, several inside another lane's baton.
Those entries are a floor, not growth, and the floor is now 41 of 60.

Counting them made the guard fire on a condition its own remedy cannot fix. Measured 2026-08-18:
a sweep took the directory 62 -> 41, and it was back over the limit **twenty minutes later** —
at which point every lane's next feature PR failed on a tidiness rule, because a journal entry
rides in every feature PR. The second sweep that day cleared 19 and landed on 41 again. Chasing
a floor with a sweep that may not touch it is not a guard, it is a periodic outage.

So the limit applies to the UNLINKED count, which is exactly what a sweep clears, and still
catches the thing this guard was written for: if nobody sweeps, unlinked entries pile up and it
fires. A separate, much higher ceiling on the TOTAL keeps the 509-file readability failure
caught, since that scenario is real and is not about sweepability.
An entry is "linked" when any .md outside the entries directory mentions its filename. Read once
into a single blob rather than grepping per entry — 60 entries x the whole docs tree is the kind
of thing that quietly adds a minute to every CI run.
```

## 2026-08-20 — `docs/implementation-backlog.md` 11559 → 11610, `docs/agents/state/bugfix.md` 136 → 161

Session wrap-up for the workout-energy intake cluster.

**Backlog (+51):** one entry, Q-424 — a shrink-only ratchet can leave `main` red and nothing looks.
Found by walking into it: a branch cut from pristine `origin/main` failed `pnpm check:rules` on a
change that could not have caused it, because two docs PRs had each merged green against a baseline
the other was also raising. #254 (this file's own origin) fixed the conflict *frequency* by moving the
numbers here; it did not make the check order-independent, which is what the entry is about.

**Baton (+25):** the BugFix baton is rewritten in full at each handover, not appended, so its size
tracks how much state the role is carrying rather than accumulating. This rewrite added the traps that
cost time in the session — the `wc -l` off-by-one, the baseline conflict procedure, `total_count: 0`
having two causes — and one superseded decision recorded with its correction, which is worth more
lines than the decision was.

## 2026-08-20 — Review session wrap-up (sweeps 29–39)

**`projectOverview.md` 8043 → 7863, a ratchet DOWN of 180 lines.** Eight Known-Issues rows were
struck to `known-issues-resolved.md` because their findings had shipped — each verified in source on
`main` first, not inferred from the queue's silence. The shrink-only baseline exists so reclaimed
space cannot quietly refill, so the lower number is the point of the exercise rather than a side
effect.

**`docs/agents/state/review.md` 1281 → 1308, a raise of 27 lines.** A "session closed — read this
first" block at the top of the Review baton: which of the previous run's thirteen findings shipped
(ten) with the evidence, which three remain open so a successor does not re-file them, the one probe
that never reached its ownership check and is therefore **unknown rather than clean**, and where to
start given that four consecutive documentation sweeps had already covered that seam. It sits in the
baton rather than the handoff because the baton is what a cold successor reads as state; the handoff
is the narrative behind it.

## 2026-08-20 — `claude/tuning-agent-0q9yl7`

**CLAUDE.md (+9):** the session-start database read told sessions to trust `pg_stat_user_tables`
because it is not row-scoped — true, and silent on the difference between its size columns (exact,
read from the filesystem) and its row counters (planner estimates, with `last_analyze` NULL on every
table here). A Tuning session read `n_live_tup = 1` off an `oura_daily_summary` holding 45 rows and
filed a data-loss incident that had never happened. Nine lines naming the split, giving the two
measured counter-examples, and saying to run `count(*)`.

**Backlog (+19):** one entry, TN-1 — chronic stress refuses inside its granular layer and persists no
reason why. It replaces the retracted half of Q-528: both of that score's countable gates were
measured this session and both pass, which moves the question from "is the history there" to "why does
the model refuse", and nothing outside the pass can currently see the answer. Q-528 and Q-525 were
rewritten in place rather than added to, so the entry is most of the growth.

**Tuning baton (+19, after trimming a superseded note):** the session retracted a finding this baton
itself carried, so the correction has to sit *above* the claim it replaces while the original bullet
stays legible as the record of the misread — a successor who reads only the new block learns the fact
but not the failure mode. The rule that produced it is rewritten in place with its counter-examples
rather than deleted, for the same reason.

## 2026-08-20 — the extracted history is deduped (PS-2, `docs/baseline-history-dedupe`)

**No baseline moved.** This is the one deliberate exception to the append-only rule, authorised by
PS-2: eight records inside the fenced *Extracted history* block had been duplicated by conflict
splicing before the extraction, and the block is no longer byte-verbatim as a result. Everything
else in it is untouched — nothing summarised, nothing pruned.

**The entry's own three premises were wrong, which is the finding worth keeping.** PS-2 said one
block (Q-553) was duplicated **twice, byte-identical**, and that two blocks recorded contradictory
figures. Measured:

| PS-2 said | Actually |
|---|---|
| one duplicated block | **eight** duplicated records |
| duplicated twice | **two** of them appear **three** times — Q-356 and the Q-464 ratchet |
| byte-identical | **none** was; every copy had been reworded on the merge that re-landed it |
| `projectOverview -> 7785` contradicts `7805 -> 7785` | not a contradiction — one states the prior value, the other does not |

**Why the undercount happened, and it will happen again to anyone who repeats the method.** Three of
the eight groups differ in their *first line* — `… from the MERGED file.` against `… from the MERGED
file, on each merge this branch took.` — so a scan that groups records by their opening line finds
five of eight, and a scan for byte-identical blocks finds none. What actually finds them is a
similarity sweep over whole records: at a 0.70 ratio the file now reports zero pairs, and every one
of the eight sat above 0.80.

**Deduping is a merge, not a delete.** Each copy had drifted, so each carried something the others
did not, and dropping either side loses a fact. Every surviving record is the union: Q-356 keeps its
`1044 -> 1056` figure from one copy and its "recomputed on each merge" note from another; the Q-464
ratchet keeps `8257 -> 8310` from two copies and Lane A's `+53` delta from the third; Q-553 keeps the
prior value `7805` and states the net (−20) outright, since one copy's loose "shrank by ~70 lines"
was Q-139's removed body rather than the net. A sentence-level audit before and after confirms every
distinct sentence survives once.

**Two records were rescued from being lost to the dedupe**, because they had been glued to a
duplicate with no blank line between them: the Q-310 Known-Issues raise (inside the second
Q-548..Q-551 copy) and the `1010 -> 1044` "Decisions That Come Back To Me" raise (inside the Q-534
copy). Both are now records in their own right. **This is the real hazard in a file like this** — a
lost separator makes an independent record invisible to any per-record tool, and it would have been
deleted as part of the duplicate that swallowed it.

**`git log` could not be used, and PS-2 assumed it could.** The entry says to reconcile the
figures "against `git log` for the commits that raised them". This repository's history begins
**2026-08-19**, with no commit earlier than that, and every record in the extracted block is dated
2026-08-18 or before. The commits that raised those numbers are in the archived private repo, not
here. The reconciliation above is therefore from the copies' own content, and says so rather than
implying a provenance it does not have.

## 2026-08-20 — `projectOverview.md` 7875 → 7838, `docs/implementation-backlog.md` 11666 → 11328, `docs/agents/state/review.md` 1308 → 170

Review sweep 40 — the non-workout write surface and the first audit of ownership rule (b).

**Backlog (+94 from this branch, net −358 after merging `main`'s archive sweep):** three entries. RV-32 and RV-34 batch as one PR over the program-config write path;
RV-33 is the Q-462/Q-463 status class on two routes that fix missed. RV-32 carries a measured
impact-bound (the leak stops at the style *name*) because the entry is otherwise easy to size as either
much larger or much smaller than it is.

**projectOverview (+35 from this branch, net −37 after the same merge):** one Known-Issues row. It is here rather than queue-only because a write path
accepting another account's row id is the kind of thing every session's orientation read should see, and
because the clean result beside it — rule (b) audited and sound — is what stops the next sweep re-running it.

**Review baton (−1,138):** rewritten from 1,307 lines to 169, which is PS-4's complaint discharged for one
of the batons. The 24 lines the wrap-up session added on the same day — what shipped from sweeps
29–39, the three findings still open, and the one route left unverified — are carried across, since
that is state and not history. Nothing was lost: all 39 earlier sweeps have their own `docs/reviews/` write-up, each
linked with a summary from the pillar indexes, and every finding is already a Known-Issues row or a queue
entry. What the baton keeps is state — next ID, current lens, what is blocked, and the method notes that
cost a session each to learn. **The baseline is lowered to 170 in the same PR**, so the shrink ratchets
rather than leaving 1,138 lines of headroom for it to grow back into.

## 2026-08-20 — `projectOverview.md` 7838 → 7841, and `main` was the one over it (superseded the same hour)

**Raised from a PR that touches neither `projectOverview.md` nor this baseline.**
`feat/home-card-invalidation-guard` is a test-only change — a Playwright spec and two `e2e/fixtures.ts`
helpers. Merging current `origin/main` into it turned Custom Rules red, and the file it named was one
this branch never edited: `origin/main`'s own `projectOverview.md` is **7841** against a stored
**7838**. So the job is failing on every open branch, not this one, and the three lines are somebody
else's landed content rather than growth to justify.

Raised to main's actual number rather than trimming, for the same reason as the 2026-08-18 Q-397
entry: reverting three lines of another lane's just-landed work to satisfy a counter is the wrong
trade, and **the second time a shared ratchet is quietly exceeded is when people start assuming it is
broken instead of binding**. Recorded here so the raise is attributable to a merge rather than read
back later as this branch's own growth.

This is the failure mode **Q-424** is queued for — a shrink-only ratchet can leave `main` red and
nothing in the repo notices until the next branch merges main in. Third recorded occurrence.

**Superseded within the hour, and the resolution is the point.** By the time this branch merged
`main` again to open its PR, another lane had raised the same number to **7848**. The conflict fell
on that one line. Resolved by taking `origin/main`'s file whole and **re-measuring the merged tree**
— 7847 lines, which the script counts as 7848 — rather than splicing either side's hunk. Two same-day
raises spliced together silently drop one side, which is the accident this log exists to prevent, and
7841 was only ever the number `main` happened to carry when it was read.

## 2026-08-20 — Lane B's baton ratchets DOWN, 413 → 134

**A shrink, not a raise.** The seventh Lane B handoff rewrote `docs/agents/state/implementation-lane-b.md`
in full, as the handoff ritual requires, and it came out at **134** lines against a stored 413. The
baseline is shrink-only precisely so reclaimed space cannot quietly refill, so the lower number is
locked in here in the same PR rather than left as headroom for the narrative to leak back into.

What went: six runs of accumulated "This run" sections and their per-item detail, which is what
journal entries and the linked reviews are for. What stayed is what a cold successor needs as state —
what is in flight (nothing), what was refuted and must not be re-proposed, what is owed on the device,
what paths are claimed (none), and the gotchas that cost this run time.

**PS-4 is now three of six.** Orchestrator 62, Lane A 113, Lane B 134 are under the ~150-line target;
BugFix 161, Review 170 and Tuning 582 are not. The entry's own thesis holds — each fell at its role's
own handoff rather than in a compaction pass — with one exception it should expect: Tuning at 582 is
4× the target and will not come down as a side effect of a routine rewrite.

## 2026-08-23 — `projectOverview.md` 7889 → 7916, for one Known-Issues row (LB-1)

**27 lines, and the check attributed all 27 to this branch** — the first raise since LA-16 gave the
ratchets a base tree, and the message now says "27 of which this branch added" rather than leaving
you to work out whether `main` was already over. That is the whole point of that change and it paid
for itself immediately here.

The row is a user-facing capability gap: no reachable UI can edit or delete a logged exercise, a
workout session or an activity log, because the four controls that did live in a sheet nothing can
open. It is longer than a typical row on purpose. Two sessions have already fixed bugs *inside* that
unreachable sheet — the second was this lane, one PR ago — so the expensive thing is not knowing the
defect, it is re-deriving that the surface is dead. The row carries the measurement that settles it:
which controls exist, which routes have no reachable caller, and the one trash icon nearby that turns
out to be a drop-set indicator.

Trimmed from 29 before raising. What stayed is the evidence; what went was a second telling of the
mechanism already stated in the paragraph above it.

## 2026-08-23 — Lane B's baton ratchets DOWN again, 134 → 97

Second consecutive Lane B handoff to shrink it: 413 → 134 on 2026-08-20, now **97**. The baseline
drops with it each time, because the shrink-only rule exists so reclaimed space cannot quietly refill
and leaving 37 lines of headroom is an invitation.

What went was the previous run's seven-PR narrative — that is what journal entries are for, and the
baton links them. What the rewrite **added** is a `## Waiting on the owner` section, because this run
ends with a gated entry (LB-1) and a successor needs to see that before the queue, not after it.

**PS-4 is three of six, measured rather than assumed:** Lane B **96**, Orchestrator **61**, Lane A
**149** are under the ~150-line target; BugFix **160** and Review **169** are just over; Tuning
**581** is nearly four times it and is still the one that will not come down as a side effect of a
routine rewrite. (A first draft of this note said "four of six" from memory and was wrong by one —
Lane A sits one line under the line, which is not a margin worth rounding in either direction.)

## 2026-08-23 — `projectOverview.md` 7916 → 7924, `docs/implementation-backlog.md` 11390 → 11417

Q-545's D2 Task 2 (the rollup extraction behind `RollupIO`). Eight lines of Current Status and a
27-line annotation on the Q-545 queue entry.

Both are index material rather than narrative. The status entry is seven lines and points at the
journal for everything else — the two premise corrections the extraction turned up (the port is 22
store operations, not the five the plan sketched from a line count; `run.ts` still reaches
`onnxruntime-node`) are 25 lines in
[the entry](overview/entries/2026-08-23-oura-rollup-io-port.md), not here. The backlog annotation
stays in the queue because Q-545 is **not finished** — Task 2 of seven shipped, and the next
implementer needs to read those two corrections *before* sizing Task 3, which is exactly what the
queue entry is for.

Both numbers were re-measured on the merged tree rather than spliced from the conflict hunks — the
backlog baseline moved under this branch while it was open.

## 2026-08-23 — `docs/implementation-backlog.md` 11417 → 11432

Fifteen lines of `Lane:` / `Gate:` / `Needs:` fields on Q-499, Q-549, Q-551 and Q-547 — four entries
that sat at the head of the Lane A queue offering work no Lane A implementer could do, each of them
already saying so in prose the tooling cannot read.

This is the queue file doing its job rather than growing: the fields are what
`scripts/check-backlog-pointers.js` validates and what `scripts/next-item.js` sorts on, and the
alternative to the fifteen lines is the next four implementers each re-reading four entries to
discover the same thing.

## 2026-08-23 — `docs/implementation-backlog.md` 11432 → 11447

A third dependency of Q-545's Task 3, recorded on the queue entry because it changes what Task 3
*is*: the vendored model constants cannot reach the device. `constants/index.ts` reads them
synchronously with `node:fs` — deliberately, because two ports evaluate them at module scope — and
they sit on the rollup's real call path twice, through the step pipeline and through
`daytimeStressLevel`.

Fifteen lines in the queue rather than the journal because the answer (async getters, cached assets,
or an API route) is a decision to take *before* starting Task 3, and the queue entry is what the
implementer reads first.


## 2026-08-23 — `docs/implementation-backlog.md` 11447 → 11463

Six lines correcting a claim this queue file had carried for five days and that #306 repeated:
plan Task 1's "the production CSP has no `wasm-unsafe-eval`" was true when it was written and
stopped being true on 2026-08-20 (Q-546, #259).

Kept in the queue rather than pushed to the journal because it is what an implementer would
otherwise act on: the stale line said the neural port was blocked behind a one-line security header,
and the real remaining gap — `getWebSession` has no importers, all seven session consumers
hard-import the node loader — is a different and larger piece of work.

The larger half of the +21 is a five-row table measuring exactly which value imports carry `run.ts`
into server-only code, and what each one needs. It is queue material rather than journal material
because it is the scope of the next task: three of the five want the same injection, one is a file
split, and one is a `sourceRank` move. Without it the next implementer re-walks the graph — and is
likely to walk it wrong, since following type-only imports too makes the answer look like "the whole
Postgres layer".

## 2026-08-23 — `projectOverview.md` 7924 → 7927, `docs/implementation-backlog.md` 11463 → 11474

Eleven lines on Q-545 recording that the model half of the rollup port shipped, and — the reason it
belongs in the queue rather than only in the journal — that the entry's remaining blocker is now
**exactly one** thing: the constants loader. An implementer opening this entry should not have to
reconstruct which of the five measured edges are closed.

The three in `projectOverview.md` say the same thing in the Current Status entry the extraction
already had, because that entry's closing sentence named `onnxruntime-node` as the blocker and it no
longer is.

## 2026-08-23 — `projectOverview.md` 7927 → 7928, `docs/implementation-backlog.md` 11474 → 11501

Twenty-seven lines retracting a claim this entry made earlier the same day. I wrote that the model
constants "cannot reach the device" and that answering it was "a design decision rather than a port"
to be taken before Task 3 starts. It is a port: **Q-221 already built the mechanism** — inject the
table, serve it from an auth-gated route through the same accessor, fetch and cache it on the device
— and the rollup already depends on it for the steps-decoder table.

The lines are queue material, not journal material, because they are the difference between the next
implementer opening a design question and following an existing pattern. They also carry the
three-row measurement of exactly which getters are involved (one done, two to do), which is the
scope of the work.

The one line in `projectOverview.md` is the same retraction in the Current Status entry, which had
called the constants loader the blocker without saying which kind of blocker it is. "Port" and
"decision" send an implementer to different places.

## 2026-08-23 — `docs/implementation-backlog.md` → 11520, all 19 lines this branch's

**Corrected while resolving a merge, and the correction is the point.** Before merging `main` the
ratchet read *"over by 19 — 8 of which this branch added"*, and a first draft of this note recorded
8. After merging, `git diff origin/main --numstat` says **19 added, 0 removed** — the 8 was measured
against a merge-base that `main` had since moved past, so it undercounted this branch's own share.
The diff against current `main` is the number that survives; the ratchet's attribution is only as
current as the base it was computed from.

**Still much better than before LA-16**, which is worth saying plainly: the pre-merge reading
correctly separated `main`'s own overage from this branch's, and without it the options would have
been to trim someone else's landed work or raise blind. The lesson is to re-read it **after** the
final merge, not to distrust it.

**Recomputed twice more before the PR opened** — 11482, then 11492, now **11520** — because `main`
landed three times while this branch was in review. Every one of those was resolved by taking
`origin/main`'s file whole and re-measuring the merged tree, never by splicing the conflicting line.
The branch's own contribution held at **19** across all three, which is the check confirming it is
attributing correctly rather than drifting with the base.

The 8 are BF-4's shipped/still-open annotation. That entry stays queued — the payload bound is Lane
B's half and it merged; the named dated change (#112's structured-output conversion), the
client-elapsed-time sink and the Railway cold-start check are all Lane A's and all open. An entry
that shipped half of itself has to say which half, or the next session re-derives the split.

Trimmed from 19 to 8 before raising: what went was a second telling of the field-name trap and of
why the payload was demoted, both of which the entry already states above the annotation.


## 2026-08-23 — Lane B's baton 97 → 102, five lines, and an argument against its own ratchet

**Raised three hours after I ratcheted it down to 97**, which needs saying rather than glossing. A
fourth PR shipped in the same run and the shallow-clone gotcha got sharper with a second measurement,
so the file grew by five lines of state that a successor genuinely needs: what BF-4's Lane B half
did and did not establish, and that `git fetch origin main` **re-shallows this clone every time**,
not merely on resume.

I trimmed first and got two lines back before the returns went flat — the `Next` section was stale
anyway, since BF-4's Lane B half is now done, and rewriting it was the only real cut available.
Swapping two-line bullets for two-line bullets is not a trim, and pretending otherwise wastes a
session's attention on a counter.

**Lane A's note of 2026-08-20 already reached the right conclusion and it applies again here:** *"the
ratchet is the wrong instrument here, and PS-4 is the fix. A baton is rewritten in full at every
handoff, so its number measures one session, not accretion."* Two lanes have now independently hit
that on the same file class. The durable answer is not a lower number, it is moving the inherited
findings to permanent homes — which is what PS-4 asks for and what neither lane has done yet.

## 2026-08-23 — `docs/implementation-backlog.md` 11520 → 11522

Q-545's constants item is closed, and eleven lines say so and correct the count that went with it:
the entry claimed three getters, and there are four. `cumulative-stress.ts` reads its constants
through a relative import, and the scan that produced the three-row table only matched the aliased
form — the import-graph walk found it, a name grep did not.

Two net lines because the closure also strikes the "the only thing standing between here and a
device rollup" pointer it replaces.

## 2026-08-23 — `projectOverview.md` 7928 → 7934, `docs/implementation-backlog.md` 11522 → 11497

Shrink. Q-471 shipped and its entry is removed (the protocol: a finished entry must not linger in
the queue), against six lines added to Q-545 for the `Gate: device` that its remaining tasks now
carry.

The six in `projectOverview.md` are Q-471's Current Status entry, trimmed to the finding and the
number that matters — 44 of the 89 redundant calls were the artefact, 45 are real — with the
measurement in the journal.

## 2026-08-23 — `projectOverview.md` 7934 → 7941, `docs/implementation-backlog.md` 11497 → 11469

Q-470's Current Status entry, against its queue entry being removed for shipping — the backlog
shrinks 28 lines, which is the trade the protocol wants.

Seven lines rather than three because the reusable part is the *reason*: a rate limit is a counter
over a window and cannot tell "already running" from "ran a minute ago". That sentence is why the
bug existed with a rate limit already in place, and it now also has a `docs/module-map.md` row so
the next fire-and-forget background call does not repeat it.

## 2026-08-23 — `projectOverview.md` 7941 → 7948, `docs/implementation-backlog.md` 11469 → 11406

Q-474 shipped; its 63-line entry leaves the queue, which is most of the backlog's shrink.

Seven lines of Current Status because the durable part is not the rename but *why nobody noticed*:
the identifier `programSessionId` meant the dead column, and a repro fixture that populated it read
as evidence that a race did not exist. That is the kind of thing a session re-derives expensively.

## 2026-08-23 — `projectOverview.md` 7948 → 7956, `docs/implementation-backlog.md` 11406 → 11424

Q-476's route half shipped. The entry stays — its write-time companion is still owed — so this is
growth on both files rather than the usual trade.

The eighteen backlog lines are mostly one correction: the fix shape the entry carried, quoted from
an unreachable adapter comment, said to report the rejection as *retryable*. Q-475 later gave that
flag a specific meaning — "the server could not write" — under which it would back off the whole
queue for a mutation that can never succeed. An implementer following the entry as written would
have built the wedge the route exists to prevent.

## 2026-08-23 — `projectOverview.md` 7956 → 7963, `docs/implementation-backlog.md` 11424 → 11391

Q-468 shipped and leaves the queue; Q-472 and Q-476 gain a `Gate:` line each. Net shrink on the
backlog.

The seven status lines carry the measurement rather than the fix — two stacked changes, undo the
first, and the row goes back to its original value while the history says otherwise. That table is
the reason the entry existed, and it is the thing a reader needs to recognise the shape again.

## 2026-08-23 — `CLAUDE.md` 1124 → 1135, `projectOverview.md` 7963 → 7970, `docs/implementation-backlog.md` 11391 → 11368

Q-394 closes (57 lines out) against LA-19 going in; the backlog shrinks 23.

The eleven `CLAUDE.md` lines are the one part of this that belongs in a rule rather than a journal:
`aestMidnight`'s timezone argument, and — the part that is expensive to re-derive — **how to find
this class at all**. Reading does not find it. Shifting a test user's timezone into its own
00:00–02:00 band does, on any clock. That method took two accidental discoveries and two lost PRs to
arrive at, and it fits in a paragraph.

## 2026-08-23 — `projectOverview.md` 7970 → 7971, `docs/implementation-backlog.md` 11368 → 11334

Shrink. LA-19 shipped the day it was filed and its entry leaves the queue; `CLAUDE.md` and
`projectOverview.md` are edits in place, not growth — both said "13 do not" and now say the count is
zero.

## 2026-08-23 — `projectOverview.md` 7971 → 7977

Six lines, and they are a Current Status entry rather than material that belongs elsewhere: Q-392's
engine half shipped and the index has to say so, including the part a later session would otherwise
re-litigate — that the merge is locked because the unlocked version loses the other device's key,
and that the entry was re-scoped to Lane B rather than closed. The detail is in the journal entry
and the module-map row; this is the pointer to it.

`docs/implementation-backlog.md` held at its 11334 baseline exactly — the re-scoped Q-392 entry
gained a fourteen-row key table and shed the prose the journal and module map now carry.

## 2026-08-23 — `docs/implementation-backlog.md` 11334 → 11377

Eighty-one lines, and they buy a 269-line entry becoming four an implementer can actually pick up.
Q-395 described a nutrition rework across sixteen screens as **one** queue item, so `next-item.js`
offered it as a single startable thing while its own body sequenced it into phases. It is now the
spec and the completion checkpoint, parked behind Q-395c; the work is Q-406 → Q-395a → Q-395b →
Q-395c, chained with `Needs:`.

**The arithmetic, stated properly, because a first draft of this note got it wrong.** The split was
81 lines before trimming and 25 after — but it was measured against a base that then moved. The
`ring-service-device-pass` batch shipped in between and took the file to **11295**, well under the
11334 baseline, which that PR left unlowered. So this raise spends 39 lines of existing slack and
adds 42 of its own. Recording it as "+25" would have been true of a tree that no longer exists.

The phases were rewritten to point back at Q-395's findings rather than restate them, which is also
the only way the decisions stay in one place. What did not get cut are the ⚠ warnings each phase
carries — the 11-section coverage list, the `Saved meals`/`My Meals`/`My Foods` rename sweep, and
the `FoodLibrarySheet`/`SavedMealsSheet` capability diff. Those are the failure modes that make a
rework lose a section quietly, and they have to be where the work is, not one entry away.

## 2026-08-23 — `docs/agents/state/implementation-lane-b.md` 102 → 109

The Lane B baton, after a run that shipped thirteen items. Compressed three times first — the run
list rewritten to one or two lines per PR, the stale "do not re-litigate" entries cut (Q-359's is now
in the entry's own removal), and four gotchas folded — and it still needs seven more lines than the
old baseline.

What the seven carry, none of it derivable from the code: the **blocker** that Q-395's drawings are
not in the repository, which parks the largest contiguous chunk of the queue and needs the owner;
why Q-406's last two call sites are deliberately unconverted (converting the diary row before
Q-395a's sheet exists deletes the only way to correct a logged food); that `toBeVisible()` does not
mean in-viewport, which read exactly like a dead button for two debugging rounds; and that on a doc
conflict "keep both" is right only for *independent* entries — it duplicated Q-406 when the two sides
were one entry rewritten.

A baton is rewritten wholesale by each successor, so this number falls back at the next handover.

## 2026-08-23 — `projectOverview.md` 7977 → 7983

Six lines: a Known Issues row for LA-20, a live production 500 found by the session-start
`error_events` read. It belongs in the index rather than only in the journal because what is
outstanding is a *production* verification — the next session has to know to check `error_events`
before believing the fault is gone, and "it stopped" is not "it was fixed".

(The 7984 in the LB-4 branch and this 7983 are the same section being edited twice in one day; the
number here is the merged count, not a second raise on top of that one.)

## 2026-08-23 — `projectOverview.md` 7977 → 7984

Seven lines: one Current Status entry for LB-4, a user-visible staleness fix. The section is
supposed to grow by one entry per shipped change and shrink on the compaction sweep, and this is
that growth rather than detail that belongs elsewhere — the mechanism, the mutation results and the
six deferred call sites are all in the journal entry and the LB-6 backlog entry.

Worth noting for whoever runs the next sweep: Current Status is now ~178 lines across a dozen
entries, and three separate PRs today each had to trim prose to avoid tripping this check. That is
the ratchet doing its job, but it is also the signal that the sweep is due — the older half of the
section describes work that has been on `main` for days.


## 2026-08-23 — `projectOverview.md` 7977 → 7886, `docs/implementation-backlog.md` 11310 → 10975

Both shrink, and both ratchets are tightened to lock the gain in rather than left at the old number.

`projectOverview.md` loses 91 net: the 112-line `disk_full` Known-Issues entry moved whole to
`known-issues-resolved.md` — the database is 210 MB with zero dead tuples and the re-stamp mechanism
is gone, so nothing was still owed on it — against 21 lines added for the resolution note and a
ring-key progress note.

`docs/implementation-backlog.md` loses 335: Q-534 closed on measurement rather than implementation.

## 2026-08-23 — `projectOverview.md` 7983 → 7989

Six lines: a Current Status entry for the Q-454/Q-455/Q-465 route-hardening batch.

Worth recording *how* this nearly went wrong, since the Lane B baton warned about it and it happened
anyway. Resolving the merge with a blind "keep both sides" **duplicated the ring-service paragraph**
— main had compacted the same entry I had written, so the two sides were one entry reworded, not two
independent ones. The tell was the arithmetic: the check reported 14 lines added by a branch whose
own addition is 6. "Keep both" is right for genuinely independent appended entries and wrong for a
rewritten one, and the only reliable way to tell them apart is to read the resolved text.

## 2026-08-23 — `projectOverview.md` 7869 → 7879

Ten lines: the Current Status entry for the Q-454/Q-455/Q-465 route-hardening batch, restored after
a merge. The count moved because the surrounding section shrank underneath it, not because the entry
grew.

## 2026-08-23 — `CLAUDE.md` 1148 → 1154

Six lines in the `CLAUDE_DB_READONLY_URL` section: the owner id has left the generated `claude_ro`
views (Q-456) and is now set at boot from the environment. It belongs in the rules because the
failure mode when *no* variable is set is *the views return zero rows* — and a session that reads
`error_events` at start-up and gets nothing needs to recognise a missing setting rather than
conclude production is quiet.

## 2026-08-23 — `docs/implementation-backlog.md` 11202 → 11129

Removing four entries that had already shipped and were **resurrected by one of my own merge
resolutions**. Recorded here rather than only in a commit message, because the mechanism is the one
this file already warned about two entries above and it still got through.

Resolving a backlog conflict with "keep both sides" is wrong when each side has *deleted a different
completed entry*: keeping both restores both. That is what happened in #334 — LB-4, Q-454, Q-455 and
Q-465 came back into the queue after shipping, and nothing catches it, because
`check-backlog-pointers` only fails on a queue heading that says ✅/SHIPPED and a resurrected entry
reads exactly like an open one.

The rule that follows: on `docs/implementation-backlog.md` a conflict is almost always **two
deletions**, and the resolution is to keep neither side. On append-only files
(`known-issues-resolved.md`, this one) it is almost always two additions, and keeping both is right.
Read the headings before choosing — the two cases are indistinguishable from the marker alone.

## 2026-08-23 — `CLAUDE.md` 1135 → 1136

One line, beside the existing `package.json`/`changelog.ts` conflict rule, because it is the same
class and the same place someone resolving a conflict would look: a backlog conflict is two
deletions and keeping both resurrects two shipped entries. It belongs in the rules rather than only
in this file's history, since this file is read after the mistake and `CLAUDE.md` before it.

## 2026-08-23 — counts re-measured after the resurrected-entry removal

`projectOverview.md` 7884 · `docs/implementation-backlog.md` 10972 · `CLAUDE.md` 1136, all read off
the merged files rather than carried across from either side.

A second thing learned in the same merge: **never text-merge `doc-size-baseline.json`.** "Keep both"
on a JSON file produces two `files` blocks and an unparseable document — the same blind resolution
that resurrected the four entries this branch removes, failing a different way. On a JSON baseline
take main's copy and re-measure; the numbers are derived from the files, so there is nothing to
merge.

## 2026-08-23 — `CLAUDE.md` 1136 → 1148 (raise, +12)

The session status light (🟢 live / 🔴 wrapped) became a rule for **every** session rather than only
the six standing agents, and that cannot live in `docs/agents/README.md` — an ad-hoc session never
opens it. So a Standing Instruction (7 lines) plus a fourth step in Session Wrap-Up (5 lines).

The trigger is why it belongs in the index at all: the owner says *"wrap up this session"*, which
lands on the Session Wrap-Up ritual, and that ritual had three steps and no mention of the light.
Documented anywhere else, the convention would have lived in a file the sessions that most need it
never read. The mechanism — two MCP calls — stays in `docs/agents/README.md` under *The trailing
light*; the index carries only the rule and the trigger.

Mid-branch this went 1136 → 1135 (the rewritten session-titles bullet came out a line shorter) and
then up to 1148. Recorded as the single net change, since the branch squash-merges. The lesson kept
from the detour: do not ratchet a baseline down while the convention it measures is still being
worked out — it bought nothing and had to be undone within the hour.


---

## 2026-08-24 — LB-3, the day-overlay retirement

**`projectOverview.md` 7897 → 7900, then 7905 → 7908 (+3) on merge.** A Tuning session raised the
same number to 7905 while this branch was open, so this ended up as a second raise on top of
theirs rather than the one it was written as.

**Two sessions raised this file on the same day, and that is the finding.** The trims were tried
first here — this PR's note went from six lines to four to three, and the two statements it had to
correct elsewhere were rewritten shorter — and the remainder is genuinely new. But three rounds of
shaving prose to fit four lines, twice in one day by two different sessions, is a file past its
maintenance point, not two careless notes.

**No fully-resolved Known Issue was available to archive instead**, which is the mechanism the
wrap-up rule points at first: every ✅ entry scanned states what it still owes, and Q-479's says so
outright — *"Kept here rather than archived: the PR states production and the 24-hour window were
not exercised end to end… Archive it once that is confirmed against production."* Archiving one
anyway to buy three lines is exactly what that rule forbids.

**So the next session that needs room should not raise it again — it should compact the
shipped-notes section**, which is where the growth is. Filed for Orchestrator.

**The original note, as written:** A four-line note for user-visible work, on a file that
has sat at exactly its number for several PRs in a row.

The trims were tried first and the raise is what is left. This PR's own note started at six lines
and is now four; the two statements it had to correct elsewhere in the file (both said the sheet
still existed and was reachable, which stopped being true here) were rewritten shorter rather than
longer. That recovered three of the six. The rest is genuinely new.

**What was NOT available, and it is worth recording because it is the mechanism the wrap-up rule
points at first.** No fully-resolved Known Issue could be moved to `known-issues-resolved.md` to
make the room: every ✅ entry scanned states what it still owes, and Q-479's says so outright —
*"Kept here rather than archived: the PR states production and the 24-hour window were not exercised
end to end… Archive it once that is confirmed against production."* Archiving one anyway to buy four
lines would be exactly the thing that rule forbids.

**The pattern behind the raise, for whoever reads this next.** Trimming to fit has meant editing
other sessions' prose three times in one day, which is a worse cost than three lines — a session
shaving a sentence it did not write, to fit a note about work it did, is how a shared file loses
accuracy. If this recurs, the answer is a compaction sweep of the shipped-notes section, not a
per-PR raise.
## 2026-08-24 — `claude/tuning-agent-0q9yl7` (Tuning session close)

**projectOverview.md (+8):** the handoff pointer for the Tuning session that retracted Q-528. It earns
its lines by carrying the *rule* rather than the incident — `pg_stat_user_tables.n_live_tup` is a
planner estimate, it read 1 against 45 real rows and 0 against 764, and a data-loss incident was filed
off it. A reader who takes only the pointer and never opens the handoff still leaves with the thing
that prevents a repeat.

**Tuning baton: no change, and deliberately so.** It shrank 581 → 474 in this handover (rewritten in
full, not appended). The baseline stays at 582 rather than ratcheting down: a baton is rewritten whole
at every handover, so its size oscillates by design, and locking in a trough would make the next
successor raise it with a note that says nothing. The shrink is visible in the diff either way.

## 2026-08-24 — `docs/agents/state/review.md` 170 → 173; `projectOverview.md` shrinks 33 lines, number left alone

Review session wrap-up for sweep 40.

**Review baton (+3 net, after +20 and a trim):** the wrap-up added a closed-session pointer, the
🟢/🔴 trailing-light convention, and a `Now` section saying the successor is awaiting instructions —
20 lines of genuine state — the last of them a shallow-clone trap that cost a merge attempt at the very end of the session. Rather than raise the number for them, the sweep-40 section was cut from
35 lines to 20 by applying the baton's own rule: the handoff written in this same PR now carries that
sweep's narrative, so the baton keeps only the three parts that are still *state* — rule (b) clean and
rule (a) the last unevidenced one, the 27-edge FK inventory, and the PUT/POST contrast. Net +3, against +20 unchecked.

**`projectOverview.md` — 33 lines lighter, baseline deliberately not lowered.** The RV-32…RV-34
Known-Issues row was moved whole to `known-issues-resolved.md`; all three shipped and nothing is owed,
re-verified in source rather than read off the closure note. The number stays where `main` has it (7905 by the time this merged) because
**#373 was in flight raising it**, and its PR body says it went looking for a resolved
Known Issue to archive for exactly this headroom and found none. A file sitting below its number is
allowed by the ratchet's own rule; lowering it here would hand a live PR a conflict for no gain. The
next session to touch this file should ratchet it to whatever the tree then holds.

## 2026-08-24 — `projectOverview.md` 7908 → 7937 (+29); `docs/agents/state/tuning.md` 582 → 99 (−483)

**Raised** `projectOverview.md` for three new Known-Issues rows from the owner's readiness/battery
batch — **TN-2** (Body Battery floors by early afternoon), **TN-6** (the temperature baseline is
0.363 °C low, penalising readiness on 89% of days) and **TN-5** (the sleep calibration's 8-fold gain
spread) — plus an amendment correcting the LA-20 row's superseded figures and recording that TN-4's
guard made its verification unfalsifiable. Known Issues are what this index is *for*, so the growth
is the file doing its job; the one bullet that belonged elsewhere (a method rule about time-weighted
percentiles) was moved to the Tuning baton instead of being counted here.

**Lowered** the Tuning baton hard, which is the PS-4 item. It was the outlier that entry named — 582
lines against a target of ~150, nearly 4× — and PS-4 predicted it would not come down as a
by-product of a routine handoff because its bulk was narrative rather than state. It came down at
this handover by moving that narrative into the three dated reviews and the handoff doc it already
cited, keeping only state and the do-not-re-litigate list. **Five of six batons are now at or under
~170 lines.**

## 2026-08-25 — `docs/implementation-backlog.md` raised for the threshold sweep

**TN-8** (the chronic-stress fever mask — a fourth consumer of the temperature baseline BF-13 fixes)
plus a third-step-goal amendment on Q-524. Both are queue entries carrying their measurements, which
is what this file is for.

**Third parallel-merge raise in two days, and that is the ratchet working rather than failing.** The
backlog is edited by five agents at once, so a branch that was under its baseline locally goes over
once CI merges `main` into it — the local number and the merged number are different questions. The
fix each time is the same: merge `origin/main`, recount, raise in the same PR. Recorded here so the
pattern is legible rather than looking like repeated carelessness.

## 2026-08-25 — `docs/implementation-backlog.md` raised, 11532 → 11571 (Q-274)

**Fourth parallel-merge raise, and this one splits cleanly down the middle: 19 lines came from
`main`'s own growth before this branch touched anything, and 19 from Q-274's queue entry** — the two
stale-claim warnings and the `Keep:` list. The stale-claim half is the part worth the lines: the
entry's evidence for 2026-08-11/08-13 was overtaken by Q-536's clock repair, and its readiness claim
was overtaken by `nightSessions`. A reader who re-derives from either goes the wrong way.

**The Q-274 entry was trimmed first, not raised into.** Its first draft ran 34 lines; the narrative
moved to [`entries/2026-08-25-sleep-fragment-nights.md`](overview/entries/2026-08-25-sleep-fragment-nights.md)
and the queue kept what a queue needs — what is still owed, and what must not be trusted. Raising
came second, once the entry was as short as it could honestly be.
## 2026-08-25 — `docs/implementation-backlog.md` 11532 → 11590 (+58)

Four new entries, and **20 of the 58 lines were already on `main` before this branch existed** —
`main` was sitting over its own baseline when this branch merged it. That is the concurrency case
the check cannot catch on its own: a branch measured green against the baseline, another branch
merged, and the sum crossed the line with neither PR individually at fault. Worth knowing before
reading a +58 as one session's sprawl.

The 38 lines this branch actually added:

- **BF-16 split into BF-16a / BF-16b** (exercise-role data corrections). The split was forced by a
  sequencing bug found in review — the role rule reads catalogue muscle counts and the catalogue
  corrections change them, so the catalogue half has to land first and ungated.
- **BF-18** — `oura-autopack-ingest.test.ts` asserts phase 3 of a three-phase packer after polling
  only for phase 1, so it can fail on any PR regardless of diff. Found when it went red on a
  docs-only branch. The entry carries the root cause and the one-line fix rather than a plan doc,
  because the fix is one line and a plan would cost more lines than the entry.

The exercise-role *design* deliberately did **not** land here — it went to
`docs/superpowers/plans/2026-08-24-exercise-roles.md`, which is what kept this raise to 58 rather
than 165. That is the pattern to copy: an entry states the defect and the acceptance test; a design
with rejected alternatives belongs in a plan.

## 2026-08-25 — `docs/implementation-backlog.md` 11604 → 11615 (+11)

One entry: **BF-19**, the app-load-time investigation. It is 60 lines because it is mostly
*measurements* — the four candidates ruled out against production with their numbers, the deploy
count that drives the one real finding, and the two limits of the method. Trimming it to fit would
have cut the evidence, which is the part that stops the next session re-running the same queries.

Deliberately not a plan doc: there is no design with rejected alternatives here, just a finding and
a short build list. A plan would have cost more lines than the entry.

## 2026-08-25 — `docs/implementation-backlog.md` 11615 → 11638 (+23)

**BF-20**, filed after a scratch script (`m.mjs`, from #442) reached `main` and turned Lint red for
every open PR. Twenty-three lines to record a failure that cost every concurrent agent a red check
and had already happened twice under a prose-only rule, which is the argument for the guard the
entry asks for.

## 2026-08-25 — `docs/implementation-backlog.md` raised, 11638 → 11658 (temperature-baseline batch)

Twenty lines across BF-13, Q-506 and TN-8 — the three entries of one batch, so the note had to reach
all three. **It was trimmed twice before this raise.** The first draft pasted the same ~19-line block
into each entry; that became one full note on BF-13 (the root) and a two-line cross-reference on the
other two, then the full note itself was cut roughly in half.

What survives is the part a queue cannot do without: the **⛔ Keep** saying the data half is unrun.
The seed fix ships in this PR, but the owner's stored baselines are still the zero-folded ones, and
every pass test in all three entries measures the re-derivation rather than the code. An entry that
looked finished here would be wrong in the way that matters most.
## 2026-08-25 — `docs/implementation-backlog.md` raised for BF-22

**BF-22** — the owner's slow-load report traced to distance, not code. Production serves from
`iad1` (Washington DC) and the owner is in Brisbane, so every request carries ~270 ms that no server
tuning can remove; Home spends ~20 of them per open.

The lines are mostly the measurement table and the negative result, and both earn their place. The
table is what makes the finding diagnostic rather than suspected — a **static file** costs the same
as a dynamic route, which rules out the app, the auth check and the database in one comparison. The
negative result (Home's fetch count is flat across every commit since 2026-08-19) is what stops the
next session hunting a regression that is not there.

## 2026-08-25 — `docs/implementation-backlog.md` 11638 → 11678 (+40)

**BF-21**, exposing `pg_stat_statements` to `claude_ro` once the owner enables it. Filed rather than
done because it needs a migration number, which only Lane A may take — the entry exists to carry the
handover, the owner's Railway steps, and the security argument for why this one view is *not*
row-scoped (normalised query text carries shapes, never parameter values).

It also carries a deliberate expectation-damper: BF-19 already measured the database at 3 ms with a
99.90% cache hit, so a clean read here must not be treated as closing the slow-load question.

## 2026-08-25 — `docs/implementation-backlog.md` raised again, BF-22 rewritten

BF-22's first version concluded the app was slow because production ran in Virginia while the owner
is in Brisbane. **That was wrong.** `x-railway-edge` names the edge PoP the *caller* reaches, not
where the container runs, and the ~276 ms was a US-adjacent sandbox measuring its own distance. The
service is deployed in Singapore. The rewrite says so at the top, because a wrong finding left in a
queue is worse than no finding.

The entry grew because the owner then reported a force restart fixed it, which relocates the whole
question to in-memory client state — and because the rewrite carries a six-row **ruled-out** table.
That table is the point: six suspects with the measurement that killed each, so the next session
does not re-run the same greps and reach the same dead ends.

## 2026-08-25 — `CLAUDE.md` 1155 → 1159 (+4)

The ring-key block told every session to confirm the owner holds `key.hex` before proposing an
uninstall, and nothing recorded that they do. A session reaching that block had to either stall on
the question or proceed without an answer — which is what cost a live session on 2026-08-17.

Four lines in the most-read file in the repo, deliberately: the confirmation belongs beside the
warning rather than in a backlog entry nobody opens at that moment. Written as dated and perishable
rather than settled — one file on one machine goes stale silently — so the instruction to ask still
stands, now with the current answer attached.

## 2026-08-25 — `docs/implementation-backlog.md` raised, 11658 → 11665 (TN-6a)

Seven lines, and they were eleven before being cut once. What is left is the shipped note plus the
**Keep** — that this is a *suppression, not a fix*, and TN-6's ±0.05 °C pass test is what retires it.
That line is the whole reason the entry stays in the queue: a reader who takes the ✅ at face value
leaves a temperature penalty switched off permanently.

**Superseded on merge:** `main` had already moved the backlog past this number, so the raise carried
no net change and `doc-size-baseline.json` was rebuilt from `origin/main` rather than spliced.

## 2026-08-25 — `docs/implementation-backlog.md` raised, 11719 → 11803 (the device smoke run)

Net +84, and the gross is larger: **four new entries added ~130 lines** while **Q-395a and Q-395b
were removed** on the owner's device run passing. So the raise is smaller than the intake, which is
the direction this file is meant to move.

The four are BF-24 (the shipped day screen and artboard 1 are different layouts), BF-25 (the light
theme has no switch), BF-26 (the quantity sheet's controls are undifferentiated) and BF-27 (5 of 45
sheets handle the Android back gesture). Each carries the measurement it was filed on, which is the
length: BF-24 enumerates seven divergences read off the shipped source against the artboard's inline
styles, and an entry that says only *"doesn't match the mockup"* would send its implementer back to
do that reading again.

## 2026-08-25 — `projectOverview.md` 7941 → 7947 and `docs/implementation-backlog.md` 11803 → 11862 (BF-16a)

**projectOverview, +6.** Both additions are required by a standing rule to live in this file and
nowhere else. One is the Current Status paragraph the session wrap-up asks for. The other is a
Known-Issues row, because the Canonical Runtime gate gives exactly two options for a change whose
device path has not been run — the on-device smoke run, or a row here saying so. Migration 216's
correction reaches the S25 through `/api/workout-data` hydration, which was read in source and not
executed; `getLocalStore` returns null in the sandbox, so it cannot be executed here. The row names
what to check on the device, and that the migration has not yet run against production.

**Backlog, +59, of which only 20 are this branch's.** BF-16a's entry (~31 lines) was removed on
shipping and LA-24 (~51 lines) filed in its place — the eight further catalogue rows the sweep found,
with the family precedent for each, split into the five that propagate an answer the catalogue
already gives and the three that would mean originating anatomy nobody has been asked about. An entry
saying only *"more rows have this too"* would send its implementer back to redo the scan.

**The other 39 lines were already on `main` without a raise.** `main` sat at 11841 against an 11803
baseline when this branch merged it; the check has an escape hatch for growth the base branch already
carries, so it reported OK there and failed here the moment 20 more arrived. Worth knowing: a raise
can inherit someone else's overshoot, and the number recorded is the whole of it, not the part the
raising branch wrote.

## 2026-08-25 — `projectOverview.md` raised, 7947 → 7949 (BF-18)

Two lines: the Current Status paragraph the session wrap-up asks for, and its blank. It earns the
space by carrying the thing a reader needs and the journal entry cannot give them at a glance — that
a red `Tests` on an unrelated PR had a known cause with a known fix, so the next person to meet one
does not spend the session re-running it. The reproduction is in the journal entry.

**Written first as 7941 → 7943, and superseded before it merged.** BF-16a's PR (#475) landed in
between and had already raised the number to 7947, so `doc-size-baseline.json` was rebuilt from
`origin/main` and this raise re-derived on top of it rather than the hunk being spliced. Two
same-session PRs both raising the same baseline is the ordinary case here, not an unusual one — the
second one's number is only ever correct against the merged first.

## 2026-08-25 — `projectOverview.md` raised, 7949 → 7957 (TN-7)

Eight lines in two places, and the second is the one that earns it. Two are the Current Status
paragraph the wrap-up asks for. **Six extend LA-20's existing Known-Issues row**, because TN-7
changes what that row's `Keep:` means: its check is an `error_events` count, the count was
unfalsifiable while the guard only logged, and it is falsifiable again now — but only from this
deploy forward. A reader who takes a zero from the intervening day as evidence strikes a row on
silence. That correction has to sit on the row itself; anywhere else and the next person to read the
row will not see it.

**Written first as 7947 → 7955, then re-derived on 7949 when BF-18's PR (#476) landed first.** Third
same-day raise of this baseline, and the third to be superseded before merging — which is the
ordinary case when several PRs run in one session, not a sign anything is wrong. Each time the fix
was to rebuild `doc-size-baseline.json` from `origin/main` and re-derive, never to splice the hunk:
the raise is only ever correct against the merged predecessor.
## 2026-08-25 — `docs/implementation-backlog.md` raised, 11862 → 12000 (mockup parity)

The owner set the acceptance test for the nutrition arc: *"I want the design to match the mockup
images"*. That is five new entries — **BF-28** (the map every parity entry reads), **BF-29**, **BF-30**,
**BF-31**, and a **BF-26 rewritten** around the screenshot they sent.

Most of the +138 is BF-28, and it is there so the other five are short. It holds the artboard →
shipped-file table, and the three arguments that would otherwise be had once per entry: an artboard
is one screenful and a section missing from it is not thereby deleted; an owner decision beats the
drawing, and one already does (artboard 2 draws four tabs, Q-395c decided two); and the drawings'
inline `oklch`/hex literals are structure to copy and colours to ignore, since `check-hex-literals.js`
fails on the paste.

The alternative was five entries each restating that, which is longer in total and drifts. This file
grows when the queue is the only place a decision lives — and the parity rule now is.

## 2026-08-25 — `projectOverview.md` raised, 7957 → 7959 (BF-11b)

Two lines: the Current Status paragraph the wrap-up asks for, and its blank. Fourth same-day raise of
this baseline, by the same session — see the three above for why that is ordinary rather than a
symptom, and always rebuild from `origin/main` rather than splicing.

The paragraph is longer than most because it carries a number no journal entry will be read for: the
split rule's first version returned **5, 5, 1, 1, 5, 1** on five identical containers, and its second
returned 30 of 30 across six cases. A reader of the index needs to know the splitting was measured
rather than assumed, because the obvious next question — *"can I trust the candidate count?"* — has a
different answer before and after that change.

## 2026-08-25 — `docs/agents/state/implementation-lane-a.md` raised, 152 → 158 (BF-11b)

Six lines, all one finding: **the Gemini model is reachable from an agent sandbox.** No baton had
recorded it, and every Lane A session before this one worked as though an AI behaviour change could
only be reasoned about. It cannot: BF-11b's split rule returned 5, 5, 1, 1, 5, 1 on its headline case
and 30 of 30 after one wording change, and neither number was reachable by reading the prompt, by the
type checker, or by any mocked test.

The lines that come with it are the ones that would otherwise be rediscovered — there is no `tsx`, so
a probe runs as a throwaway `*.test.ts` under vitest for the `@/` alias, and a shipped live test gates
on an explicit `RUN_LIVE_AI_TESTS=1` rather than on the key, or CI quietly starts paying for
non-deterministic runs. A baton is the right home precisely because this changes what a session
believes is *possible*, which is not something you look up when you already think the answer is no.

## 2026-08-25 — `projectOverview.md` raised, 7959 → 7961 (BF-11e)

Two lines: the Current Status paragraph, and its blank. Fifth same-day raise of this baseline by this
session — rebuilt from `origin/main` each time, never spliced.

**Worth recording alongside it: the same run tripped the journal-entry runaway limit**, at 61 unlinked
against a ceiling of 60, which failed a migration PR for a reason unrelated to the migration. It was
unblocked the way the check intends — the two nutrition entries are now linked from that domain's
index, which the wrap-up rule asks for anyway — but that leaves 59 and the next session hits it
again. Filed as **LA-25** so the sweep is done deliberately rather than discovered mid-feature.

## 2026-08-25 — `projectOverview.md` raised, 7961 → 7963 (LA-25, the journal sweep)

Two lines, and the sixth same-day raise of this baseline by one session. The paragraph carries the
measurement rather than the chore: the journal README's "~20 loose files" trigger was written for a
load that no longer exists, and **17 entries landed on 2026-08-25 alone**, so a sweep clearing 25
buys about a day and a half. A reader of the index needs to know the cadence is near-daily now,
because the alternative is finding out when the guard fails their own PR — which is exactly how this
sweep started.

**Six raises in one session is itself worth a note for whoever reads this next.** None was avoidable
and none was spliced — each was rebuilt from `origin/main` and re-derived, because with several PRs
in flight the number is only ever correct against the merged predecessor. If that starts feeling like
friction rather than bookkeeping, the thing to question is whether Current Status should hold a
paragraph per PR at this merge rate, not whether the ratchet should be looser.

## 2026-08-25 — `projectOverview.md` 7963 → 7965 and the Lane A baton 158 → 167 (BF-11g)

**projectOverview, +2:** the Current Status paragraph. It carries the design correction rather than
the feature, because that is the part a future reader needs — the plan's prescribed ranking judged a
saved meal's totals, and `scaleIngredientsToTargets` moves each macro group independently, so size is
the one thing portioning always fixes.

**Baton, +9, and seven of them are one lesson.** Three timing-dependent test defects shipped and were
fixed in a single day, all by this session: an assertion that allowed an async write zero
milliseconds, one that counted rows written by two racing fire-and-forget calls, and one that paid a
4.3 s module import inside a 5 s budget. Treated as three lessons they are forgettable; the root is
narrower — *something in the test is timed that is not the behaviour being asserted* — and that is
short enough to actually ask before writing an assertion. The other two lines are the shipped list
and the migration/SQLite pointers, which a baton is wrong without.

## 2026-08-25 — `projectOverview.md` raised, 7965 → 7967 (LA-24 Kind 1)

Two lines. The paragraph carries a *retraction* as much as a change: BF-16a's Known-Issues row said
its migration had not run against production, and reading production to verify LA-24's before-values
showed it had. A caveat that has become false is worse than no caveat — it teaches the next reader to
discount the ones that are still true — so striking it is the point of the edit, not incidental to
it.

## 2026-08-25 — `projectOverview.md` raised, 7967 → 7969 (BF-20)

Two lines. The paragraph spends most of its length on the two places the backlog entry's own
prescription was wrong — an allowlist that would have failed on nine correct files, and a
`.gitignore` rule that applied literally to `*.ts` would have silently untracked a legitimate root
config. Both are the kind of thing a future reader would otherwise re-derive by breaking the guard,
and the guard is the sort that gets deleted the first time it fires wrongly. The mechanics are in the
journal entry; what belongs in the index is why the shipped version differs from the filed one.

## 2026-08-25 — the Lane A baton raised, 167 → 179 (session-state refresh)

Twelve lines, and the two that matter most are single tokens: **next free migration 219 → 220** and
**`pnpm check:rules` 56 → 57**. Both had gone stale within the same session that wrote them, and both
are facts a successor acts on without re-deriving — a wrong migration number is how the tree got its
two collided pairs, and a stale check count defeats the reason CLAUDE.md says to quote `Ran N of N`
rather than the word "pass".

The rest records why **BF-19 was skipped while sitting at #1**: it is four parts of telemetry whose
own entry says the numbers mean nothing until the reporter has run on the S25, and this session had
no device. A successor that finds the top item untouched should be able to read whether it was
judged or merely missed, and those are not the same thing.

**A baton that is stale on its numbers is worse than a short one.** It gets trusted.

## 2026-08-25 — `CLAUDE.md` raised, 1159 → 1174 (dark only)

The owner pinned the app to dark and asked for **one** UI/design. That has to live in `CLAUDE.md`
rather than only in a backlog entry, because the thing it changes is what *every future session*
does by default: design in one theme, verify in one theme, draw mockups in one theme, and stop
filing light-mode bugs.

Fifteen lines, and two of them are the ones that earn it. The first says **do not delete the light
palette** — unreachable CSS custom properties cost nothing at runtime, and deleting them is the only
irreversible half of this decision. The second draws the distinction a reader will otherwise get
wrong: **theme is pinned, accent is not.** `data-brand` is still user-picked, so a hex literal still
bypasses the colour the user chose and `check-hex-literals.js` still ratchets it. Without that line,
"dark only" reads as "literals are fine now", which would quietly break the brand picker.

The four existing light-mode rules below it were amended in place rather than deleted, each saying
which half of it dark-only retires and which half still binds — a deleted rule leaves no trace of why
it went, and two of them still guard live hazards (`var(--x)` in canvas paint; a cutout painting over
the wallpaper layer).

## 2026-08-25 — `projectOverview.md` 7969 → 7973, backlog 11799 → 11725 (LA-29)

**Raised by four lines, and the four are one Known-Issues row.** Q-304b — the decision not to
recompute 277 inflated historical 1RM estimates — was closed the same morning it was measured, and
its heading said so. It was still in the queue, and `next-item.js` was handing it to an implementer
as **READY #4**. The queue is not where a closed decision lives, but the decision has a live cost
that nothing else in the tree stated: an inflated PR shows on the badge and in the AI chat, and
drives a too-heavy prescription for any lift carrying a PR with no recent log. That is a
deliberately-unfixed, user-visible defect, which is exactly the row `projectOverview.md` exists to
carry. Four lines is the honest price of not losing it.

**The 74 that came back the other way** are those two entries leaving the queue: Q-304b (27 lines)
and Q-27 (47), the latter closed on 2026-08-04 — *"CLOSED, not doing either item"* — and never
removed. Q-27's substance is not gone either: the reasoning against moving the loose `docs/` root
files into pillar folders, and against splitting the Known Issues per pillar, is now at the foot of
[`docs/domains/README.md`](domains/README.md), which is where someone would arrive before proposing
either move again.

**The reason both sat there is that the check could not see them.** `check-backlog-pointers.js`
flags a heading that announces its own completion, and its word list had `SHIPPED`, `COMPLETE`,
`DONE`, `SUPERSEDED`, `DROPPED`, `FIXED`, `RESOLVED`, `✅` — and not `CLOSED`. It does now. The list
moved to `scripts/lib/completion-words.js` with a test, because widening it has a failure mode in the
other direction: `TN-2` reads *"the charge window has closed"* and `BF-16b` *"the retired
all-primary program"*, both open work, and a case-insensitive match flags both. It stays
case-sensitive, and `ANSWERED` stays out — an investigation can conclude while its action is still
owed, which is true of LA-27 and Q-547 today.

## 2026-08-25 — `projectOverview.md` 7973 → 7977, backlog 11725 → 11710 (LA-31)

**Eleven lines to retract a number that five documents had been repeating.** `error_events` was
described everywhere as *"49 MB against 4 live rows"* — bloat, needing a `VACUUM FULL`. The owner
pressed the button; it reclaimed **0 B**, correctly, because the table was never bloated. It holds
**6,168 real rows** (45 MB of stack traces), and 5,928 of them are one burst from an
`oura_heartrate` `ON CONFLICT` cardinality violation that was **fixed on 2026-08-13** (Q-214) — the
burst stops the same day. The 30-day prune ages them out by ~2026-09-12 with no action.

**The 4 came from `n_live_tup`,** which `CLAUDE.md` documents at length as a planner estimate that is
arbitrarily stale on this database (`last_analyze` is NULL on every table) and explicitly says to
answer with `count(*)`. Nobody ran it — including me, in a baton written an hour earlier that quotes
the rule two sections below where it repeats the wrong figure. A retraction that only deleted the
claim would leave the next session free to re-derive it from the same stat view, so the row says
where the number came from, not just that it was wrong.

**The backlog went DOWN fifteen** — LA-30 in, Q-315 out, and Lane B's own merge landing in between:
a **live** bug traded for a closed one. The owner scanned a ZMA supplement, the AI read it correctly as calorie-free, and
`review-step.tsx`'s `canSave` requires `calories > 0`, so **Next** greyed out with no message. The
server's own schema is `z.number().min(0)`, so there is no engine half — it is Lane B's, and it is
queue position 1.
## 2026-08-25 — `docs/implementation-backlog.md` raised, 11710 → 11775 (the meal photo)

One entry, **BF-32**. The owner reviewed the artboards and found the gap none of the parity entries
had: *"no spot for an image ... it should show the default one in the mockup if no image is
attached."*

The length is the evidence, and it is what stops the entry being re-investigated. The photo half
shipped **twice** — `saved_meals.image_data_uri` in Q-396, the picker and its 128 px downscale in
Q-327 — and grep proves nothing renders either one. So the entry states plainly that the feature is
**write-only**, which is a different and smaller job than "build meal photos", and names the two
places the deferral was recorded so a reader does not trip over a stale *"deliberately not here
yet"* comment and treat it as a live decision.

## 2026-08-25 — `docs/implementation-backlog.md` raised, 11775 → 11811 (the check-in lookback)

Two entries' worth of measurement, no new entry. **TN-9** gains its second cause — readiness carries
`activityBalance` at weight 0.06 and the composite's own comment says it is *"our own 0-100 activity
score for **today**"*, a partial day — so the score drifts ~1 point with no user action at all, which
the check-in half alone does not fix. Its pass test is extended to demand two byte-identical reads
twelve hours apart.

The length is doing the work the entry cannot do without it: it records that the obvious follow-up,
**imputing the check-in on unlogged days, is refuted** — LOO R² 0.047 — so the next session does not
spend itself rediscovering that a model explaining 5% of out-of-sample variance is a fabricated
number wearing a regression's authority.
## 2026-08-26 — three raised for the pillar review: backlog 11775 → 11926, `projectOverview.md` 7977 → 7987, `docs/agents/state/tuning.md` 182 → 218

**Four entries, from six owner questions.** TN-13 (the HR tile averages away 84% of the movement in
the best predictor of felt state), TN-14 (2026-08-19's 3.50 h night still feeds every baseline),
TN-15 (Body Battery has no recharge at all and drain that ignores exercise — owner-signed-off), and
TN-16, which is filed **parked**. Plus a long amendment to Q-507.

The length is carrying the thing a short entry cannot: **a refuted hypothesis.** Stress correlating
*positively* with readiness invited an obvious explanation — better sleep, denser HRV, more buckets
scored — and it was measured and refuted at r = −0.128. Q-507 now says so, so the next session does
not spend itself rediscovering it, and TN-16 says why the warning the owner asked for is parked
rather than built. TN-15 is long for the opposite reason: it **supersedes** a standing "do not
propose overnight charging or an anchor redesign" instruction, and a supersession that does not
explain itself gets reverted by the next reader.

*(Final figures after the check-in lookback PR landed on `main` in between and was merged in — both
raises are in this branch's diff, which is why the backlog number is higher than the 11890 the branch
alone reached.)*

**The baton was compacted in the same pass** (221 → 216 before the raise) so the lines it grows by
are the four new entries and two corrections, not accretion. One of those corrections retracts this
baton's own claim that the check-in "adds little independent information" — measured, ~75% of it is
information nothing else has.

## 2026-08-26 — `docs/implementation-backlog.md` raised, 11926 → 11932 (the warning-row decision)

Six lines net. Q-406's `Gate: owner` came off and was replaced by the answer: option A, an amber
triangle before the calorie column, serving line kept, sentence moved to the food's detail.

The length is mostly the two rejected options, and that is the point. **C is the intuitive answer** —
show the warning in full, in the row — so without a written record of why it lost it gets re-proposed
by the next person who reads that a warning "should be visible". Its cost is not visible from the row
itself: three call sites would carry a prop they never fill, turning the shared row back into a
wrapper, which is the thing Q-406 exists to end.

**This raise was missed on the first push and CI caught it.** The branch ran
`check-backlog-pointers` and not the doc-size check, and the PR body claimed a full `check:rules`
pass that had not been run on this branch. The claim was corrected rather than quietly fixed.

## 2026-08-26 — `projectOverview.md` 7987 → 7992, backlog 11932 → 11860 (LA-31/Q-291)

Seven lines for the Q-291 status paragraph — the day's AI surfaces can now see each other — and
twenty-eight back from Q-291 leaving the queue. Net down. **Re-derived four times: `origin/main`
moved under this branch five times while it was open** — the numbers here are against the base it
finally merged onto. Worth naming as a cost of running both lanes at once: every one of those needed
the changelog rebuilt from `git show origin/main:` and the version re-bumped across three files
(`package.json`, `changelog.ts`, and `projectOverview.md`'s header line, which is easy to forget and
which nothing checks), plus this file's numbers re-derived. None of it was splice-able.

The two lines are load-bearing rather than narrative. They record the constraint a future change
would otherwise break: **the cross-surface read graph is one-directional and must stay acyclic.**
Each surface caches on a hash of its prompt context, so two surfaces hashing each other's text would
invalidate each other indefinitely, and model output is not deterministic, so it would never settle.
That is not visible from either route's source — it is a property of the pair — which is exactly the
kind of thing an orientation doc exists to carry.

## 2026-08-26 — backlog 11903 → 11947 (PS-7, camera form capture)

Forty-four lines for one new queue entry at the tail. The entry is longer than a typical one on
purpose: it is an owner feature request whose plan rejects four alternatives with reasons, and the
entry names them so an implementer does not re-propose one before opening the plan. Everything else
about the feature — the storage arithmetic, the capture state machine, the Wear OS costing — is in
`docs/superpowers/plans/2026-08-26-camera-form-capture.md`, which is where it belongs.

**Only Phase 0 is queued, and that is the reason this raise is 44 lines and not four times that.**
The plan has five later phases. Filing them now would have added an entry each for work whose shape
is decided by a measurement nobody has taken yet, and the queue would have carried them until
someone read far enough to find out they were all gated on the same unknown.
## 2026-08-26 — `docs/implementation-backlog.md` raised, 11903 → 11958 (BF-34, the device-only delete)

One entry, and most of it is a table of **six layers ruled out**, each with the line that rules it
out. That is the expensive part of this bug and it is worth carrying in the queue rather than being
re-derived: the whole delete path was driven end-to-end on web with Playwright and it **works**, so
the failure is device-only, and an implementer who starts by re-checking the local store, the outbox
payload or the pull-clobber gate will spend the same afternoon reaching the same dead ends.

The entry ends on one question — *does the confirm dialog appear on the device at all?* — because the
answer splits it into two different bugs with two different fixes.

## 2026-08-26 — `docs/implementation-backlog.md` raised, 12002 → 12048 (BF-34 root-caused)

The owner's one-line answer — *"it opens up the confirm dialog; but then instantly minimizes"* —
turned a device-only symptom into a traced regression in **BF-27**, which shipped the day before.

The added lines are the four-step sequence and the reason the hook's existing guard cannot catch it:
`selfPopRef` is per-instance, so a closing surface's asynchronous `history.back()` lands on the
surface that just opened, whose flag is clear and whose `sheetId` does not match — indistinguishable
from a real back gesture. The `sheetId` guard was written for the parent/child cascade (LB-10); this
is the sibling case.

It is written out in full because the blast radius is **every close-one-open-another transition in
the app**, and because the obvious local fix — moving the confirm inline — would hide this instance
and leave the cause running everywhere else.

## 2026-08-26 — backlog 12048 → 12064 (PS-7 decisions, camera form capture)

Sixteen lines on the existing PS-7 entry, no new entry. The owner answered all four of the plan's
open questions the same day it was written, and one answer changed the design — the analysis is
keyed off the exercise's logged equipment rather than a whitelist of lifts. The entry carries the
three facts an implementer would otherwise re-derive: that `equipmentClassOf()` already exists and
should be reused, that it collapses dumbbell into a `standard` bucket the form profile has to split,
and that 23 of 149 production exercises carry no equipment tag at all.

**This raise was missed locally and CI caught it — worth recording because the local run was not
wrong.** `pnpm check:rules` passed on this branch at the then-current baseline of 11947. Between the
branch being cut and the PR opening, `main` merged twice and carried the baseline to 12048 with a
larger file underneath it. CI checks the *merge* result, so the same diff that was clean locally was
16 over once merged. The rule already in CLAUDE.md covers it — re-merge `origin/main` immediately
before opening each PR, not only before cutting the branch — and this is one more instance of the
cost, not a new failure mode.

## 2026-08-26 — `CLAUDE.md` 1174 → 1198, backlog 11860 → 11858, `projectOverview.md` 7992 → 8003 (Q-273)

**The only `CLAUDE.md` raise of the session, and it is Q-273's own scope item 3**: *"a rule, alongside
One Formula One Place: a correlation computed across a model change is not evidence."*

Twenty-four lines, carrying a worked example rather than an instruction. `body_battery_daily` held
**four distinct model versions over 40 days** with no recompute, and pooling them produced a
documented false conclusion — r = −0.06 recorded as evidence the model had no outcome signal, where
**v5 days alone give r = +0.67**. That number stood in the docs for eleven days. A rule stating the
principle without the example is one a future session reads past; the example is what makes it stick.

It also records two things that are properties of a *pair* of files and so are invisible from either
one: `model_versions` merges with `||` and must never regain a JS read-merge, and `updated_at` does
not identify the writing model.

The backlog ends **two lines DOWN** despite adding fifty, because Lane B's merges shrank it
underneath this branch in between. The fifty are **LA-32** (36) plus Q-273's own `Keep:` block (15), which says what the entry
still owes now that its scope item 1 is *safe* but not *complete* — the stamp can no longer be
clobbered, three pillars still do not write one, and the backfill half is deliberately untouched. An
entry that shipped half its work states the half it did not, rather than looking finished.

LA-32 is the survey of test files sharing a hardcoded user UUID with a file that deletes it — 233 UUIDs measured, 10 shared, 7 risky, 2 fixed, 6 remaining, with the table of
which. Filed rather than swept because the sweep without a CI check to hold it at zero is the weaker
half, and the entry carries the measurement so the sweep is mechanical.

## 2026-08-26 — `projectOverview.md` → 8015, backlog 12078 (LA-32, the shared test-user UUID)

Eleven lines up in the index, thirty-six back from LA-32 leaving the queue.

The eleven earn their place by recording a **ratio, not an incident**. LA-32 was filed claiming six
collisions remained; re-measuring found **one**, and the five false positives were each false for a
different reason — a program id, the canonical `claude_ro` owner two files are meant to share, and
pure-logic files that never touch `users`. The filing's rule ("shares a UUID literal, and somebody
mentions `DELETE FROM users`") is not the claim it needed to make.

That 83% noise rate is the durable part, because it decided the shape of the fix: a check that cries
wolf is one the first person it stops will baseline into uselessness, so the detection got a script
with seven tests — five of them false-positive cases — rather than a grep. Without the ratio written
down, the next person to read "six collisions" re-derives the noisy rule and ships it.

## 2026-08-26 — `projectOverview.md` and backlog raised (BF-33, the measured RMR)

The index gains a paragraph and the backlog gains a `Keep:` block. Both carry the same two things,
because both are load-bearing and neither is visible from the code.

**The ageing rule and why it is not a validity window.** BF-33 named two candidates and left the
choice open. A window fails at both ends — full trust the day before expiry, total discard the day
after — while what actually invalidates a measurement is a change in body composition, which has no
fixed relationship to elapsed time. Cunningham being linear in fat-free mass is what makes the
alternative work: the measurement carries the person's *residual* from the prediction, and that
re-applies at any later FFM. Someone re-reading `personalRmr` can see what it computes; only this
says why the obvious rule was rejected.

**That the feature is not usable yet.** The engine half stores it and the goal moves, but nothing can
enter a number. An index that said "shipped" without that would be the "fixed from intent" failure
CLAUDE.md names, one step removed.

## 2026-08-26 — `projectOverview.md` raised, backlog down 17 (Q-512, the ACWR window)

Twelve lines in, seventeen back as Q-512 leaves the queue. Net down.

The twelve record a correction rather than a fix, which is why they are in the index and not only in
the journal. **Q-512's stated consequence was wrong in a way that changed the work**: it said the
route reads `.acwr` (always null, therefore inert), and the route reads `typicalSessionVolumeKg` —
the activity score's volume-lane denominator, which is *not* gated and so always returned a number,
just a median over one week where every sibling uses four. That makes the defect a live skew rather
than a dead read, and it makes one of the two fixes the entry proposed — "drop the call" — unsafe.

Also recorded: widening the fetch is **not** the one-line change it appears to be, because
`sessions7d`/`volume7dKg` are computed from the same list and the model reads them as "this week".
Someone re-reading the diff sees the filter; only this says what it would have broken without it.

## 2026-08-26 — backlog raised 13 lines (Q-513, already fixed)

Thirteen lines to say **do not implement this**, which is worth more than the entry it sits in.

Q-513 asks for a 28-day ACWR window in `build-day-audit.ts`. The file already declares
`AUDIT_HISTORY_DAYS = 28`. Without a `Keep:` saying so, the next implementer reads a READY entry with
an explicit "first action", changes a window that is already correct, and ships a no-op PR — the
"forcing a mismatched implementation just to clear the queue" CLAUDE.md names.

The lines also keep the half that is genuinely open: the entry's *"then re-measure"*. The 38%-of-days
and mean-0.150 figures were measured against the OLD window and nobody has re-run them, so they may
already be zero. That replay is Tuning's, which is why the entry is now `Gate: owner` rather than
deleted — deleting it would lose a live question, and leaving it READY would invite the no-op.

## 2026-08-26 — `docs/implementation-backlog.md` raised, 12081 → 12131 (BF-35, filling the food tile)

One entry, and the length is a cost table the owner explicitly asked for: *"ONly if it doesnt add
more time/expense."* Answering that needed the three image sources separated, because they are not
comparable — **Open Food Facts is a field on a call already being made**, **the photo scan already
has the user's own image and discards it**, and **AI generation costs real money per image**. A
single "yes, add images" would have hidden that the third one is the only one that fails the
condition, and the entry recommends against building it.

It also corrects a premise: `food_items` does **not** prune, so the catalogue grows for the life of
the account rather than being a rolling window. Cheap either way (≈3 MB at 500 items) but worth
stating rather than discovering.

## 2026-08-26 — `docs/implementation-backlog.md` raised, 12131 → 12164 (the food-retention measurement)

The owner asked whether images are worth keeping past 7/14 days for foods never eaten again. The
answer needed production numbers rather than an opinion, and they are now in BF-35: **187 MB
database, 288 kB of it food, 81% of items logged exactly once, 55% unused in 14 days.**

The instinct is right and the rule is still unbuildable, which is the part worth writing down:
`food_logs.food_item_id` is `ON DELETE RESTRICT`, so expiring an item means deleting the history
that references it. A retention sweep could only ever remove the 26 never-logged orphans — about
10 kB. **The lever is acquisition, not expiry**, and the entry already pulls it.

Written out because the next person to have this idea will have it for the same good reason, and the
FK is not visible from the feature description.

## 2026-08-26 — `docs/implementation-backlog.md` raised, 12164 → 12195 (BF-35 routing decided)

The owner routed all three image sources — barcode → product image, photo scan → the user's own
photo, text → generate one. **Route 3 was recommended against on cost and chosen anyway**, so the
entry records the decision and moves on to how rather than whether.

The added lines are the four cost levers that actually work, because the owner's own mitigation
does not: **image models bill per image, not per pixel, so "super small" does not reduce spend.**
Cache by food name, generate off the save path, generate on the second log rather than the first
(81% of items are logged once), and rate-limit it like every other AI route.
